// js/pages/gis.js
window.CURRENT_PAGE = "gis";

function renderPage() {
  renderGISPage();
}

function gisPageEscapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

// Holds the live map instance so the report feed and the history modal can
// drive it (fly-to) and refresh its pins after a resolve/reopen.
let gisMapInstance = null;

// "Recent Community Reports" side panel — mirrors the Blotter page: the same
// unified incident/concern records (newest first), showing the case number,
// type, complainant, and status. Clicking an entry flies the map to that pin.
// "View All" opens the full Blotter page.
function renderReportFeed() {
  const feedEl = document.getElementById("gis-report-feed");
  if (!feedEl) return;
  const reports = gisAllCommunityReports()
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 8);
  if (!reports.length) {
    feedEl.innerHTML = `<div class="gis-feed-empty">No incidents filed yet. Reports filed through "File an Incident / Concern" appear here and on the Blotter page.</div>`;
    return;
  }
  feedEl.innerHTML = reports
    .map((r) => {
      const meta = GIS_REPORT_TYPE_META[r.reportType] || GIS_REPORT_TYPE_META.other;
      const complainant = r.complainant || r.reporter?.name || "Resident";
      const statusBadge = r.resolved ? "resolved" : "active";
      const statusText = r.resolved ? "Resolved" : "Active";
      return `
        <button type="button" class="gis-feed-item" data-report-id="${gisPageEscapeHtml(r.id)}" title="Show on map">
          <div class="gis-report-avatar gis-feed-avatar">${gisPageEscapeHtml(r.reporter?.initials || "?")}</div>
          <div class="gis-feed-body">
            <div class="gis-feed-title">${gisIcon(meta.icon)} ${gisPageEscapeHtml(meta.label)}
              <span class="gis-history-badge ${statusBadge}">${statusText}</span>
            </div>
            <div class="gis-feed-sub">${gisPageEscapeHtml(r.caseNo || "")}${r.caseNo ? " · " : ""}${gisPageEscapeHtml(complainant)} · ${gisPageEscapeHtml(gisTimeAgo(r.createdAt))}</div>
          </div>
        </button>`;
    })
    .join("");
}

// ── Community Reports history modal — the complete log of concern pins,
// active and resolved, with resolve/reopen moderation and fly-to. Built
// on demand and appended to <body> so it isn't duplicated into every page's
// static markup. Reuses the sitewide .modal-backdrop / .modal-box shell.
function renderReportHistoryList() {
  const listEl = document.getElementById("gis-history-list");
  if (!listEl) return;
  const reports = gisAllCommunityReports()
    .slice()
    // Active first (newest→oldest), then resolved (most recently resolved first).
    .sort((a, b) => {
      if (!!a.resolved !== !!b.resolved) return a.resolved ? 1 : -1;
      if (a.resolved) return (b.resolvedAt || 0) - (a.resolvedAt || 0);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  const activeCount = reports.filter((r) => !r.resolved).length;
  const resolvedCount = reports.length - activeCount;
  const countEl = document.getElementById("gis-history-count");
  if (countEl) {
    countEl.textContent = `${activeCount} active · ${resolvedCount} resolved`;
  }
  // "Clear Resolved" only offers itself when there's something to clear.
  const clearBtn = document.getElementById("gis-history-clear");
  if (clearBtn) {
    clearBtn.hidden = resolvedCount === 0;
    clearBtn.innerHTML = `${gisIcon("trash")} Clear Resolved (${resolvedCount})`;
  }
  // A pending confirm bar is stale once the list changes — hide it.
  const confirmBar = document.getElementById("gis-history-confirm");
  if (confirmBar) confirmBar.hidden = true;
  if (!reports.length) {
    listEl.innerHTML = `<div class="gis-feed-empty">No community reports have been submitted yet.</div>`;
    return;
  }
  listEl.innerHTML = reports
    .map((r) => {
      const meta = GIS_REPORT_TYPE_META[r.reportType] || GIS_REPORT_TYPE_META.other;
      const reporter = r.reporter || {};
      const when = r.resolved
        ? `Resolved ${gisPageEscapeHtml(gisTimeAgo(r.resolvedAt))}`
        : `Reported ${gisPageEscapeHtml(gisTimeAgo(r.createdAt))}`;
      return `
        <div class="gis-history-item${r.resolved ? " resolved" : ""}">
          <div class="gis-report-avatar gis-feed-avatar">${gisPageEscapeHtml(reporter.initials || "?")}</div>
          <div class="gis-history-body">
            <div class="gis-history-title">
              ${gisIcon(meta.icon)} ${gisPageEscapeHtml(r.title)}
              <span class="gis-history-badge ${r.resolved ? "resolved" : "active"}">${r.resolved ? "Resolved" : "Active"}</span>
            </div>
            <div class="gis-feed-sub">${gisPageEscapeHtml(reporter.name || "Resident")} · ${meta.label} · ${when}</div>
            ${r.comment ? `<div class="gis-history-comment">${gisPageEscapeHtml(r.comment)}</div>` : ""}
          </div>
          <div class="gis-history-actions">
            ${r.resolved
              ? `<button type="button" class="btn btn-sm btn-outline" data-history-reopen="${gisPageEscapeHtml(r.id)}">Reopen</button>`
              : `<button type="button" class="btn btn-sm btn-outline" data-history-show="${gisPageEscapeHtml(r.id)}">Show on map</button>
                 <button type="button" class="btn btn-sm btn-gold" data-history-resolve="${gisPageEscapeHtml(r.id)}">Resolve</button>`}
            ${
              deleteRecordsAllowed()
                ? `<button type="button" class="btn btn-sm btn-outline btn-danger-outline" data-history-delete="${gisPageEscapeHtml(r.id)}" title="Delete (moves to Archive)">${gisIcon("trash")} Delete</button>`
                : ""
            }
          </div>
        </div>`;
    })
    .join("");
}

function openReportHistoryModal() {
  let modal = document.getElementById("gis-history-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.id = "gis-history-modal";
    modal.innerHTML = `
      <div class="modal-box modal-lg">
        <div class="modal-header">
          <div class="modal-title">
            <div class="modal-title-icon">${gisIcon("pin")}</div>
            Community Reports History
          </div>
          <button class="modal-close" data-history-close aria-label="Close">${gisIcon("cancelX")}</button>
        </div>
        <div class="modal-body">
          <p class="modal-help-text">Every concern pin residents have submitted. Active concerns show on the map; resolving one clears it from the map and the Recent feed. <span id="gis-history-count" class="gis-history-count"></span></p>
          <div class="gis-history-confirm" id="gis-history-confirm" hidden>
            <span class="gis-history-confirm-msg">${gisIcon("warningTriangle")} Permanently delete all resolved reports? This can't be undone.</span>
            <div class="gis-history-confirm-actions">
              <button class="btn btn-sm btn-outline" data-history-clear-cancel>Cancel</button>
              <button class="btn btn-sm btn-danger" data-history-clear-confirm>Delete Permanently</button>
            </div>
          </div>
          <div class="gis-history-list" id="gis-history-list"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-danger gis-history-clear" id="gis-history-clear" data-history-clear-start hidden></button>
          <button class="btn btn-outline" data-history-close>Close</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    // Backdrop click (outside the box) and the two Close buttons dismiss it.
    modal.addEventListener("click", (evt) => {
      if (evt.target === modal || evt.target.closest("[data-history-close]")) {
        modal.classList.remove("open");
      }
    });
    // Delegated moderation actions on the history rows and footer.
    modal.addEventListener("click", (evt) => {
      const resolveBtn = evt.target.closest("[data-history-resolve]");
      const reopenBtn = evt.target.closest("[data-history-reopen]");
      const showBtn = evt.target.closest("[data-history-show]");
      const deleteBtn = evt.target.closest("[data-history-delete]");
      const confirmBar = document.getElementById("gis-history-confirm");
      if (deleteBtn) {
        deleteReportFromHistory(deleteBtn.getAttribute("data-history-delete"));
      } else if (resolveBtn) {
        gisSetCommunityReportResolved(resolveBtn.getAttribute("data-history-resolve"), true);
        afterReportModeration("Concern marked as resolved", "check");
      } else if (reopenBtn) {
        gisSetCommunityReportResolved(reopenBtn.getAttribute("data-history-reopen"), false);
        afterReportModeration("Concern reopened", "refresh");
      } else if (showBtn) {
        modal.classList.remove("open");
        if (gisMapInstance) gisMapInstance.focusReport(showBtn.getAttribute("data-history-show"));
      } else if (evt.target.closest("[data-history-clear-start]")) {
        // Two-step: reveal the confirm bar rather than deleting immediately.
        if (confirmBar) confirmBar.hidden = false;
      } else if (evt.target.closest("[data-history-clear-cancel]")) {
        if (confirmBar) confirmBar.hidden = true;
      } else if (evt.target.closest("[data-history-clear-confirm]")) {
        const removed = gisClearResolvedCommunityReports();
        if (confirmBar) confirmBar.hidden = true;
        afterReportModeration(`${removed} resolved report${removed === 1 ? "" : "s"} cleared`, "trash");
      }
    });
  }
  renderReportHistoryList();
  modal.classList.add("open");
}

// Delete one report from the history modal. Soft delete: the row is
// snapshotted into the shared Archive before it is removed, so an Admin can
// restore it from the Archive page. deleteRecord() in shell.js handles the
// permission check, the confirmation and the audit entry.
async function deleteReportFromHistory(id) {
  const r = gisAllCommunityReports().find((x) => String(x.id) === String(id));
  if (!r) return;
  const meta = GIS_REPORT_TYPE_META[r.reportType] || GIS_REPORT_TYPE_META.other;
  await deleteRecord({
    label: `${r.caseNo || r.id} — ${r.title || meta.label}`,
    what: "community report",
    icon: "map-pin",
    action: "INCIDENT_DELETE",
    category: "concern",
    details: `Community report ${r.caseNo || r.id} (${meta.label}) deleted and moved to the Archive`,
    request: async () => gisDeleteCommunityReport(id),
    onDone: () => {
      if (gisMapInstance && typeof gisMapInstance.refreshAll === "function")
        gisMapInstance.refreshAll();
      renderReportFeed();
      renderReportHistoryList();
    },
  });
}

// Shared refresh after a resolve/reopen from the history modal: re-render map
// pins, the active feed, and the modal list, then toast.
function afterReportModeration(message, icon) {
  if (gisMapInstance && typeof gisMapInstance.refreshAll === "function") gisMapInstance.refreshAll();
  renderReportFeed();
  renderReportHistoryList();
  if (typeof showToast === "function") showToast(message, gisIcon(icon));
}

async function renderGISPage() {
  setContent(`
    <div class="page-header gis-page-header">
      <h2 class="page-title">GIS Mapping</h2>
      <p class="page-desc">Interactive zone and hazard mapping for Barangay Conde Labac</p>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Mapped Buildings</div><div class="kpi-value" id="gis-kpi-buildings">—</div><div class="kpi-trend" id="gis-kpi-buildings-trend">Loading…</div></div>
      <div class="kpi-card success"><div class="kpi-label">Tagged Households</div><div class="kpi-value" id="gis-kpi-households">—</div><div class="kpi-trend" id="gis-kpi-households-trend"></div></div>
      <div class="kpi-card danger"><div class="kpi-label">Active Hazard Zones</div><div class="kpi-value" id="gis-kpi-hazards">—</div></div>
      <div class="kpi-card warning"><div class="kpi-label">Recorded Incidents</div><div class="kpi-value" id="gis-kpi-incidents">—</div></div>
      <div class="kpi-card info"><div class="kpi-label">Community Reports</div><div class="kpi-value" id="gis-kpi-reports">—</div><div class="kpi-trend">Resident-submitted pins</div></div>
    </div>
    <div class="gis-page-layout">
      <aside class="gis-side-col">
        <!-- gis-side-inner is absolutely positioned inside gis-side-col. That
             is what stops the panels from stretching the page past the map:
             an absolutely positioned child contributes nothing to its parent's
             height, so the grid row is sized by the MAP alone, and the inner
             wrapper is then told to fill exactly that height (inset: 0).
             Without this the tall briefing sized the row and left dead space
             beside the map. -->
        <div class="gis-side-inner">
        <!-- Both side panels collapse. Collapsing one hands its space to the
             other (flex: the collapsed panel drops to auto height, so the
             expanded one absorbs the remainder) — the state is restored from
             localStorage in initGisSidePanels(). -->
        <div class="card gis-side-panel gis-side-reports" id="gis-panel-reports">
          <div class="card-header">
            <button type="button" class="gis-panel-toggle" data-gis-panel="reports" aria-expanded="true">
              <i data-icon=chevron-down class="gis-panel-chevron"></i>
              <span class="card-title">Recent Community Reports</span>
            </button>
            <button type="button" class="btn btn-sm btn-outline gis-view-all-btn" id="gis-view-all-reports">Open Blotter <i data-icon=arrow-right></i></button>
          </div>
          <div class="gis-report-feed" id="gis-report-feed"></div>
        </div>
        <div class="card gis-side-panel gis-side-ai" id="gis-panel-ai">
          <div class="card-header">
            <button type="button" class="gis-panel-toggle" data-gis-panel="ai" aria-expanded="true">
              <i data-icon=chevron-down class="gis-panel-chevron"></i>
              <span class="card-title">AI Incident Briefing</span>
            </button>
            <button type="button" class="btn btn-sm btn-outline" id="gis-ai-generate" disabled>Generate</button>
          </div>
          <div class="gis-ai-body" id="gis-ai-body">
            <div class="gis-ai-placeholder">
              ${gisIcon("layers")}
              <div>Loading…</div>
            </div>
          </div>
        </div>
        </div>
      </aside>
      <div class="card gis-map-card">
        <div class="card-header">
          <div class="card-title">Barangay Map</div>
        </div>
        <!-- Populated by the map engine: Map Layers, Building Type, and
             Classification dropdowns plus the household search. Must stay
             the immediate previous sibling of the map embed. The legend is
             also engine-generated, as an overlay inside the map. -->
        <div class="gis-filter-row"></div>
        <div class="gis-map-embed" id="gis-map-page"></div>
      </div>
    </div>
  `);
  // Editing is an MIS-only capability — this is the only embed of the map
  // that gets it; the public landing page and resident-portal preview modal
  // stay read-only.
  const instance = await initGisMap("gis-map-page", { editable: true });
  if (!instance || typeof instance.getStats !== "function") return;
  gisMapInstance = instance;

  renderReportFeed();
  document.getElementById("gis-report-feed").addEventListener("click", (evt) => {
    const btn = evt.target.closest("[data-report-id]");
    if (!btn) return;
    // focusReport, not flyToReport: same camera move, but it also un-hides the
    // reports layer and rings the pin — the feed's entries include resolved
    // reports, which are not drawn on the map by default.
    instance.focusReport(btn.getAttribute("data-report-id"));
  });
  // "View All" now opens the Blotter page — the two features are merged, so the
  // full list lives there rather than in a separate history modal.
  document.getElementById("gis-view-all-reports").addEventListener("click", () => nav(null, "incidents"));

  // Handoff from the Blotter page's "View on Map" action: fly to the report
  // whose id was stashed in sessionStorage, then clear it so a later plain
  // visit to this page doesn't re-trigger.
  let focusId = null;
  try {
    focusId = sessionStorage.getItem("ibmdss.focusReport");
    if (focusId) sessionStorage.removeItem("ibmdss.focusReport");
  } catch (e) {
    /* storage disabled — the page just opens at its default view */
  }
  if (focusId) focusReportOnMap(instance, focusId);

  // KPIs are pulled straight from the map's own data (OSM + custom features,
  // minus soft-deletes) so they always track what's actually plotted below,
  // rather than hand-maintained placeholder numbers.
  const stats = instance.getStats();
  const pct = stats.totalBuildings ? Math.round((stats.taggedHouseholds / stats.totalBuildings) * 100) : 0;
  document.getElementById("gis-kpi-buildings").textContent = stats.totalBuildings.toLocaleString();
  document.getElementById("gis-kpi-buildings-trend").textContent = "Footprints on the map";
  document.getElementById("gis-kpi-households").textContent = stats.taggedHouseholds.toLocaleString();
  document.getElementById("gis-kpi-households-trend").textContent = `${pct}% of mapped buildings`;
  document.getElementById("gis-kpi-hazards").textContent = stats.hazardZones.toLocaleString();
  document.getElementById("gis-kpi-incidents").textContent = stats.incidents.toLocaleString();
  document.getElementById("gis-kpi-reports").textContent = stats.communityReports.toLocaleString();

  initGisSidePanels();
  initGisNarrativePanel();
}

// Fly to (and highlight) the report the Blotter sent us here for.
//
// Two things have to be true before the move can work, and neither is
// guaranteed at this point in the load: the map needs a measured container,
// and the report has to be in the local store. The store starts as whatever
// snapshot localStorage held, and /api/incidents is still in flight behind
// gisSyncMapState() — so a report filed on another device (or filed seconds
// ago from the app) simply wasn't there to fly to. Wait a frame for layout,
// try, and on a miss pull the server list and try once more.
async function focusReportOnMap(instance, id) {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // One frame for layout: flyToRecord places the report card from container
  // pixels, which are zero until the map has been measured.
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 200)));
  const deadline = Date.now() + 4000;
  for (;;) {
    if (instance.focusReport(id)) return;
    if (Date.now() > deadline) break;
    // gisSyncCommunityReports() is throttled and may already be in flight from
    // gisSyncMapState(), so this is as much "wait for it" as "ask again".
    if (typeof gisSyncCommunityReports === "function") await gisSyncCommunityReports();
    await wait(400);
  }
  if (typeof showToast === "function")
    showToast("That report is no longer on the map", "<i data-icon=triangle-alert></i>");
}

// ── Collapsible side panels ─────────────────────────────────────────────────
// Collapsing one panel hands its space to the other. That falls out of the flex
// column rather than needing to be computed: a collapsed panel drops to
// `flex: 0 0 auto` (just its header), so the expanded one absorbs everything
// left over. Neither panel ever pushes the column past the map's height —
// they scroll internally instead.
const GIS_PANEL_KEY = "ibmdss.gisPanels";

function gisReadPanelState() {
  try {
    const raw = JSON.parse(localStorage.getItem(GIS_PANEL_KEY));
    if (raw && typeof raw === "object") return raw;
  } catch (e) {
    /* fall through to the default */
  }
  return { reports: true, ai: true }; // true = expanded
}

function gisWritePanelState(state) {
  try {
    localStorage.setItem(GIS_PANEL_KEY, JSON.stringify(state));
  } catch (e) {
    /* a failed write only costs the preference next visit */
  }
}

// Everything in a panel except its header folds away. The header stays put —
// it carries the toggle that brings the panel back.
function gisPanelBodies(el) {
  return Array.prototype.filter.call(
    el.children,
    (c) => !c.classList.contains("card-header"),
  );
}

// `animate` is false when the state is being restored on load: a panel the
// user collapsed last visit has to arrive already collapsed, not fold itself
// shut in front of them. It is true only when they press the toggle.
function gisApplyPanelState(state, animate) {
  [
    ["reports", "gis-panel-reports"],
    ["ai", "gis-panel-ai"],
  ].forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const expanded = state[key] !== false;
    // The class goes on straight away either way: it is what re-weights the
    // flex column, and the freed space should start moving with the fold, not
    // after it.
    el.classList.toggle("is-collapsed", !expanded);
    const btn = el.querySelector("[data-gis-panel]");
    if (btn) btn.setAttribute("aria-expanded", expanded ? "true" : "false");

    if (!window.Motion) return; // css/gis.css's display:none still hides it
    gisPanelBodies(el).forEach((body) => {
      if (animate) Motion.collapse(body, expanded);
      else Motion.set(body, expanded);
    });
  });
}

function initGisSidePanels() {
  const state = gisReadPanelState();
  gisApplyPanelState(state, false);

  document.querySelectorAll("[data-gis-panel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-gis-panel");
      const next = gisReadPanelState();
      next[key] = next[key] === false;
      gisWritePanelState(next);
      gisApplyPanelState(next, true);
    });
  });
}

// ── AI Incident Narrative panel ─────────────────────────────────────────────
// A briefing on the REPORTS ON THE MAP: which open incidents need attention
// first, and which have gone neglected. The ranking is computed in SQL
// (conde-labak-server/routes/ai.js) — the model is handed an already-ordered
// list and asked to explain it, never to decide what is urgent. It also never
// counts anything and never sees a coordinate, a resident name or an address.
//
// Both languages arrive together from one call, so switching language is a
// field lookup — no network, no tokens.
//
// While a hazard zone is active the panel LEADS with it: every zone on the map,
// every building inside it — households by name, government buildings,
// businesses — and how many of the residents are senior citizens or PWDs
// (GET /api/ai/map/hazards — SQL, no model). That section is live, not
// generated: a zone drawn a minute ago shows at once instead of waiting for the
// next briefing, and every figure in it, the sentence included, comes from the
// database — never from the model's retelling of it.
let GIS_NARRATIVE = null;
let GIS_NARRATIVE_TIMER = null;
let GIS_LANG_UNSUB = null;
let GIS_NARRATIVE_BUSY = false; // a (re)generation is on screen as the skeleton
let GIS_HAZARDS = null; // GET /api/ai/map/hazards — null until read, or when unreadable
let GIS_HZ_REFRESH_TIMER = null;
let GIS_HZ_BOUND = false;
// Zones whose full household list is open, kept across re-renders.
const GIS_HZ_EXPANDED = new Set();
// Tagged buildings listed by name on a zone card before "+N more".
const GIS_HZ_BLDGS_SHOWN = 6;

// How often the page ASKS for a refresh. The server decides whether that
// actually costs anything: it will not regenerate more often than
// AI_NARRATIVE_MIN_MINUTES (6 hours), and returns the cached text for free
// when the underlying figures have not changed. So this timer is cheap to leave
// running — it is a request to re-check, not a request to re-generate.
const GIS_NARRATIVE_REFRESH_MS = 20 * 60 * 1000; // 20 minutes

async function initGisNarrativePanel() {
  const btn = document.getElementById("gis-ai-generate");
  const body = document.getElementById("gis-ai-body");
  if (!btn || !body) return;

  // Load the last stored report first. This costs NO API call, so the panel is
  // useful the moment the page opens. The hazard watch comes with it — also
  // pure SQL, and it leads the panel whatever state the briefing is in.
  const [status, latest, hazards] = await Promise.all([
    apiGet("/api/ai/status").catch(() => null),
    apiGet("/api/ai/map/narrative/latest").catch(() => null),
    fetchGisHazards(),
  ]);
  GIS_HAZARDS = hazards;

  // One delegated listener for everything clickable in the panel — case
  // numbers, hazard zones, the households inside them — bound once, to the one
  // element every re-render keeps.
  if (!body.dataset.bound) {
    body.dataset.bound = "1";
    body.addEventListener("click", onGisAiBodyClick);
  }

  if (!status || !status.enabled) {
    // Degrade, don't break: without a Gemini key the panel explains itself and
    // the rest of the GIS page is completely unaffected.
    btn.disabled = true;
    btn.title = "AI is not configured on this server.";
  } else {
    btn.disabled = false;
    btn.addEventListener("click", () => generateGisNarrative(!!GIS_NARRATIVE));
  }

  GIS_NARRATIVE = latest;
  renderGisNarrative();

  // Auto-generate on entering the page, the same way the dashboard does. Safe
  // to do unconditionally because the SERVER holds the budget: it will not
  // regenerate more often than AI_NARRATIVE_MIN_MINUTES (6 hours) and
  // returns the stored copy for free when the figures have not moved.
  //
  // With nothing stored yet there is no text to look at, so show the skeleton
  // and let the user see it working. With a stored briefing already on screen,
  // refresh silently — yanking readable content away for a spinner is worse
  // than showing slightly older text for a few seconds.
  if (status && status.enabled) {
    if (!GIS_NARRATIVE) {
      GIS_NARRATIVE_BUSY = true;
      renderGisNarrative(true);
      await refreshGisNarrative();
      GIS_NARRATIVE_BUSY = false;
      // Nothing came back (offline, or the request failed) — fall back to the
      // empty state rather than leaving the skeleton shimmering forever.
      if (!GIS_NARRATIVE) renderGisNarrative();
    } else {
      refreshGisNarrative();
    }
  }

  // Re-render in the other language when the switch is flipped. No refetch —
  // the Filipino text is already in GIS_NARRATIVE.
  if (window.L && L.subscribe) {
    if (GIS_LANG_UNSUB) GIS_LANG_UNSUB();
    GIS_LANG_UNSUB = L.subscribe(() => renderGisNarrative(GIS_NARRATIVE_BUSY));
  }

  // A zone drawn, edited or removed on this map — or a house inside one tagged
  // — re-reads the hazard watch (gisNotifyExposureChanged in js/gis-map.js).
  // Debounced: the map's first sync can push a burst of tags at once.
  if (!GIS_HZ_BOUND) {
    GIS_HZ_BOUND = true;
    document.addEventListener("gis:exposure-changed", () => {
      clearTimeout(GIS_HZ_REFRESH_TIMER);
      GIS_HZ_REFRESH_TIMER = setTimeout(refreshGisHazards, 600);
    });
  }

  // Auto-refresh. Cleared first so navigating back to this page cannot stack
  // duplicate timers, and stopped when the panel leaves the DOM. The hazard
  // watch rides the same timer — it is free, and it is what picks up a zone
  // drawn on another computer — so it runs whether or not AI is configured.
  if (GIS_NARRATIVE_TIMER) clearInterval(GIS_NARRATIVE_TIMER);
  GIS_NARRATIVE_TIMER = setInterval(() => {
    if (!document.getElementById("gis-ai-body")) {
      clearInterval(GIS_NARRATIVE_TIMER);
      GIS_NARRATIVE_TIMER = null;
      if (GIS_LANG_UNSUB) {
        GIS_LANG_UNSUB();
        GIS_LANG_UNSUB = null;
      }
      return;
    }
    // Skip while the tab is hidden — nobody is reading it, and it would
    // spend quota on a briefing no one sees.
    if (document.hidden) return;
    refreshGisHazards();
    if (status && status.enabled) refreshGisNarrative();
  }, GIS_NARRATIVE_REFRESH_MS);
}

// Which language the stored narrative should render in. Falls back to English
// for reports generated before bilingual output existed.
function gisNarrativeText(n) {
  if (!n) return "";
  const fil = window.L && L.isFilipino;
  return (fil && n.narrative_fil) || n.narrative || "";
}

function gisNarrativeSections(n) {
  if (!n) return null;
  const fil = window.L && L.isFilipino;
  const secs = (fil && n.sections_fil) || n.sections;
  return Array.isArray(secs) && secs.length ? secs : null;
}

// The briefing's sections, split into the AI's own hazard section — present,
// first, when it was written with zones active — and the rest. That section is
// never shown: the live one takes its place (gisHazardSectionHtml). In testing
// the model restated "2 residents" as "4 residents", and this is the one part
// of the briefing where a wrong number could send help to the wrong house.
const GIS_HZ_HEADINGS = ["active hazard zones", "mga aktibong hazard zone"];
function gisNarrativeParts(n) {
  const secs = gisNarrativeSections(n);
  if (!secs) return { secs: null, hazard: null };
  const zones = n.digest && n.digest.hazard_zones;
  const first = String((secs[0] && secs[0].heading) || "").trim().toLowerCase();
  if (Array.isArray(zones) && zones.length && (GIS_HZ_HEADINGS.includes(first) || secs.length > 4))
    return { secs: secs.slice(1), hazard: secs[0] };
  return { secs, hazard: null };
}

// ── Hazard watch ──
// Staff-only on the server (it names households), so it carries the acting
// account like the other AI calls.
function fetchGisHazards() {
  if (typeof apiGet !== "function") return Promise.resolve(null);
  return apiGet("/api/ai/map/hazards?account_id=" + encodeURIComponent(actingAccountId())).catch(
    () => null
  );
}

// Re-reads the hazard watch and repaints only if it moved. A failed read keeps
// what is on screen — a zone must not drop out of the panel because one request
// did.
async function refreshGisHazards() {
  if (!document.getElementById("gis-ai-body")) return;
  const next = await fetchGisHazards();
  if (!next) return;
  const changed = JSON.stringify(next) !== JSON.stringify(GIS_HAZARDS);
  GIS_HAZARDS = next;
  if (changed) renderGisNarrative(GIS_NARRATIVE_BUSY);
}

// The kinds of building in a zone (or in all of them), in the order the card
// lists them, worded in whichever language is on screen; zero kinds left out.
// A tagged group of footprints counts once, the same as on the server.
const GIS_HZ_KINDS = [
  // key, English one, English many, Filipino
  ["households", "household", "households", "bahay"],
  ["government", "government building", "government buildings", "gusali ng gobyerno"],
  ["business", "business", "businesses", "negosyo"],
  ["other", "other tagged building", "other tagged buildings", "iba pang gusali"],
  ["untagged", "untagged", "untagged", "walang tag"],
];
function gisHzKindList(types, fil) {
  const t = Object.assign({}, types || {});
  const known = GIS_HZ_KINDS.map((k) => k[0]);
  Object.keys(t).forEach((k) => {
    if (known.includes(k)) return;
    t.other = (t.other || 0) + t[k];
    delete t[k];
  });
  return GIS_HZ_KINDS.filter(([k]) => t[k]).map(([k, one, many, tl]) => ({
    key: k,
    n: t[k],
    word: fil ? tl : t[k] === 1 ? one : many,
  }));
}

// The sentence under "Active Hazard Zones", built from the live figures.
function gisHazardSummary(hz, fil) {
  const t = hz.totals || {};
  const zones = hz.zones.length;
  const s = (count, one, many) => (fil || count === 1 ? one : many);
  const head = fil ? `${zones} aktibong hazard zone` : `${zones} active hazard ${s(zones, "zone", "zones")}`;
  if (!hz.located) return `${head}.`;
  if (!t.buildings) return fil ? `${head} — walang gusali sa loob.` : `${head} — no mapped buildings inside.`;
  const kinds = gisHzKindList(t.building_types, fil)
    .map((k) => `${k.n} ${k.word}`)
    .join(", ");
  const vulnerable = [];
  if (t.seniors) vulnerable.push(`${t.seniors} senior ${s(t.seniors, "citizen", "citizens")}`);
  if (t.pwd) vulnerable.push(`${t.pwd} PWD`);
  const people = !t.residents
    ? ""
    : fil
      ? ` na may ${t.residents} residente` + (vulnerable.length ? `, kasama ang ${vulnerable.join(" at ")}` : "")
      : ` with ${t.residents} ${s(t.residents, "resident", "residents")}` +
        (vulnerable.length ? `, including ${vulnerable.join(" and ")}` : "");
  return fil
    ? `${head} ang sumasaklaw sa ${t.buildings} gusali (${kinds})${people}.`
    : `${head} ${s(zones, "covers", "cover")} ${t.buildings} ${s(t.buildings, "building", "buildings")} (${kinds})${people}.`;
}

function gisHazardSectionHtml(fil) {
  const hz = GIS_HAZARDS;
  if (!hz || !Array.isArray(hz.zones) || !hz.zones.length) return "";
  const liveTip = fil
    ? "Mga bilang mula mismo sa mapa ngayon — hindi gawa ng AI"
    : "Zone figures straight from the map, right now — not AI-generated";
  return `
    <section class="gis-ai-section gis-ai-section-hazard">
      <h4 class="gis-ai-section-head">${fil ? "Mga Aktibong Hazard Zone" : "Active Hazard Zones"}<span class="gis-hz-live" title="${liveTip}">Live</span></h4>
      <p class="gis-ai-section-body">${gisPageEscapeHtml(gisHazardSummary(hz, fil))}</p>
      <div class="gis-hz-list">${hz.zones.map((z) => gisHazardCardHtml(z, fil)).join("")}</div>
    </section>`;
}

// One zone: what it is and how bad; every kind of building inside it; how many
// people live there and how many of them will need help to leave; and every
// tagged building by name — households first, most vulnerable first, then
// government buildings and businesses — each one flying the map to it.
function gisHazardCardHtml(z, fil) {
  const esc = gisPageEscapeHtml;
  const meta = (typeof GIS_HAZARD_TYPE_META !== "undefined" && GIS_HAZARD_TYPE_META[z.hazard_type]) || {
    icon: "warningTriangle",
    color: "#eab308",
  };
  const classColor = (key) =>
    (typeof GIS_HOUSEHOLD_SUBCAT_META !== "undefined" &&
      GIS_HOUSEHOLD_SUBCAT_META[key] &&
      GIS_HOUSEHOLD_SUBCAT_META[key].color) ||
    "#64748b";
  const sev = String(z.severity || "medium").toLowerCase();
  const id = String(z.id);
  const expanded = GIS_HZ_EXPANDED.has(id);
  const s = (count, one, many) => (fil || count === 1 ? one : many);

  const head = `
    <button type="button" class="gis-hz-head" data-gis-hazard="${esc(id)}" title="${fil ? "Ipakita ang zone sa mapa" : "Show this zone on the map"}">
      <span class="gis-hz-icon">${gisIcon(meta.icon)}</span>
      <span class="gis-hz-name">${esc(z.label)}</span>
      <span class="gis-hz-sev gis-hz-sev-${esc(sev)}">${esc(sev)}</span>
    </button>`;

  if (!z.located) {
    return `
      <article class="gis-hz-card" style="--hz-color:${meta.color}">
        ${head}
        <div class="gis-hz-empty">${
          fil
            ? "Hindi makuha kung sino ang nasa loob — wala sa database ang hangganan ng barangay."
            : "Coverage unavailable — the barangay boundary is missing from the database."
        }</div>
      </article>`;
  }

  const typeMeta = (type) =>
    (typeof GIS_BUILDING_TYPE_META !== "undefined" && GIS_BUILDING_TYPE_META[type]) || null;
  const cap = (word) => word.charAt(0).toUpperCase() + word.slice(1);
  const buildings = z.buildings || 0;
  const meters = Number.isFinite(z.radius_m) ? `~${z.radius_m} m radius` : "";
  const total = `${buildings} ${fil ? "gusali" : s(buildings, "building", "buildings")}`;

  // Every kind of building inside, as counted pills in the map's type colours:
  // households, government buildings, businesses, and the untagged ones nobody
  // has identified yet (a hollow dot — they have no colour on the map either).
  const pills = gisHzKindList(z.building_types, fil)
    .map((k) => {
      const color = (typeMeta(k.key) && typeMeta(k.key).color) || "#94a3b8";
      const tip =
        k.key === "untagged"
          ? ` title="${
              fil
                ? "Mga gusali sa mapa na hindi pa naka-tag bilang bahay, negosyo o gusali ng gobyerno"
                : "Buildings on the map not yet tagged as a household, business or government building"
            }"`
          : "";
      return `<span class="gis-hz-type gis-hz-type-${esc(k.key)}" style="--type-color:${color}"${tip}><span class="gis-hz-type-dot"></span><b>${k.n}</b> ${esc(cap(k.word))}</span>`;
    })
    .join("");

  // The people — only where a household is inside to hold any.
  const stat = (key, value, label, color) =>
    `<div class="gis-hz-stat gis-hz-stat-${key}${color && value ? " is-hit" : ""}"${
      color ? ` style="--stat:${color}"` : ""
    }><b>${value}</b><span>${label}</span></div>`;
  const peopleHtml = z.households
    ? `<div class="gis-hz-stats">${
        stat("residents", z.residents, fil ? "Residente" : s(z.residents, "Resident", "Residents")) +
        stat("seniors", z.seniors, fil ? "Senior" : s(z.seniors, "Senior", "Seniors"), classColor("seniors")) +
        stat("pwd", z.pwd, "PWD", classColor("pwd")) +
        stat("solo", z.solo_parents, fil ? "Solo parent" : s(z.solo_parents, "Solo parent", "Solo parents"))
      }</div>${z.indigent ? `<div class="gis-hz-extra">+ ${z.indigent} indigent</div>` : ""}`
    : "";

  // Every tagged building by name. `household_list` is what an older server
  // sent (households only), so a panel talking to one still lists them.
  const named = z.named_buildings || z.household_list || [];
  const hidden = Math.max(0, named.length - GIS_HZ_BLDGS_SHOWN);
  const chips = named
    .map((b, i) => {
      const type = b.type || "households";
      const tm = typeMeta(type) || { label: cap(type), icon: "building", color: "#64748b" };
      const household = type === "households";
      const dots = household
        ? (b.seniors ? `<span class="gis-hz-dot" style="background:${classColor("seniors")}"></span>` : "") +
          (b.pwd ? `<span class="gis-hz-dot" style="background:${classColor("pwd")}"></span>` : "")
        : "";
      const who = household
        ? [
            `${b.residents} ${fil ? "residente" : s(b.residents, "resident", "residents")}`,
            b.seniors ? `${b.seniors} senior` : "",
            b.pwd ? `${b.pwd} PWD` : "",
            b.solo_parents ? `${b.solo_parents} solo parent` : "",
            b.indigent ? `${b.indigent} indigent` : "",
          ]
            .filter(Boolean)
            .join(", ")
        : tm.label;
      return `<button type="button" class="gis-hz-bldg${i >= GIS_HZ_BLDGS_SHOWN ? " is-extra" : ""}" style="--type-color:${tm.color}" data-gis-building="${esc(b.key)}" title="${esc(b.name)} — ${esc(who)}">${gisIcon(tm.icon)}${dots}<span class="gis-hz-bldg-name">${esc(b.name)}</span></button>`;
    })
    .join("");
  const more = hidden
    ? `<button type="button" class="gis-hz-more" data-gis-hz-more="${esc(id)}" data-hidden="${hidden}">${gisHzMoreLabel(expanded, hidden, fil)}</button>`
    : "";

  return `
    <article class="gis-hz-card${expanded ? " is-expanded" : ""}" style="--hz-color:${meta.color}">
      ${head}
      <div class="gis-hz-meta">${esc([meters, total].filter(Boolean).join(" · "))}</div>
      ${pills ? `<div class="gis-hz-types">${pills}</div>` : ""}
      ${peopleHtml}
      ${named.length ? `<div class="gis-hz-bldgs">${chips}${more}</div>` : ""}
      ${
        buildings
          ? ""
          : `<div class="gis-hz-empty">${
              fil ? "Walang gusali sa loob ng zone na ito." : "No mapped buildings inside this zone."
            }</div>`
      }
    </article>`;
}

function gisHzMoreLabel(expanded, hidden, fil) {
  if (expanded) return fil ? "Itago" : "Show less";
  return `+${hidden} ${fil ? "pa" : "more"}`;
}

// A zone as one line of the copied briefing. Counts only: which named
// households hold senior citizens and PWDs is not something to paste into a
// document by accident, so the names stay on screen.
function gisHazardCopyLine(z, fil) {
  if (!z.located) return `${z.label} (${z.severity})`;
  const s = (count, one, many) => (fil || count === 1 ? one : many);
  const buildings = z.buildings || 0;
  const kinds = gisHzKindList(z.building_types, fil)
    .map((k) => `${k.n} ${k.word}`)
    .join(", ");
  const bits = [
    `${buildings} ${fil ? "gusali" : s(buildings, "building", "buildings")}${kinds ? ` (${kinds})` : ""}`,
    `${z.residents} ${fil ? "residente" : s(z.residents, "resident", "residents")}`,
  ];
  if (z.seniors) bits.push(`${z.seniors} senior ${s(z.seniors, "citizen", "citizens")}`);
  if (z.pwd) bits.push(`${z.pwd} PWD`);
  if (z.solo_parents) bits.push(`${z.solo_parents} solo ${s(z.solo_parents, "parent", "parents")}`);
  if (z.indigent) bits.push(`${z.indigent} indigent`);
  return `${z.label} (${z.severity}) - ${bits.join(", ")}`;
}

// What Copy puts on the clipboard: the panel as it reads — the live hazard
// section first, then the briefing's own sections — in whichever language is
// on screen.
function gisNarrativeCopyText(n) {
  const fil = window.L && L.isFilipino;
  const { secs } = gisNarrativeParts(n);
  const blocks = [];
  const hz = GIS_HAZARDS;
  if (hz && Array.isArray(hz.zones) && hz.zones.length) {
    blocks.push(
      [
        fil ? "Mga Aktibong Hazard Zone" : "Active Hazard Zones",
        gisHazardSummary(hz, fil),
        ...hz.zones.map((z) => "- " + gisHazardCopyLine(z, fil)),
      ].join("\n")
    );
  }
  if (secs) {
    secs.forEach((sec) => {
      const lines = [String(sec.heading || "").trim()];
      if (sec.body) lines.push(String(sec.body).trim());
      (sec.items || []).forEach((it) => {
        if (String(it || "").trim()) lines.push("- " + String(it).trim());
      });
      blocks.push(lines.filter(Boolean).join("\n"));
    });
  } else {
    blocks.push(gisNarrativeText(n));
  }
  return blocks.join("\n\n");
}

// Everything clickable in the panel, delegated from #gis-ai-body so it
// survives every re-render (language switch, refreshes) without re-binding.
function onGisAiBodyClick(evt) {
  const fil = window.L && L.isFilipino;
  // "+N more" / "Show less" on a zone's household list — toggled in place, so
  // the panel keeps its scroll position.
  const more = evt.target.closest("[data-gis-hz-more]");
  if (more) {
    const id = more.getAttribute("data-gis-hz-more");
    const open = !GIS_HZ_EXPANDED.has(id);
    if (open) GIS_HZ_EXPANDED.add(id);
    else GIS_HZ_EXPANDED.delete(id);
    const card = more.closest(".gis-hz-card");
    if (card) card.classList.toggle("is-expanded", open);
    more.textContent = gisHzMoreLabel(open, Number(more.getAttribute("data-hidden")) || 0, fil);
    return;
  }
  if (!gisMapInstance) return;
  // Any item naming a case becomes a button that flies the map to that pin.
  const caseBtn = evt.target.closest("[data-gis-case]");
  if (caseBtn) {
    const caseNo = caseBtn.getAttribute("data-gis-case");
    if (typeof gisMapInstance.flyToCaseNo === "function" && !gisMapInstance.flyToCaseNo(caseNo))
      showToast((fil ? "Wala sa mapa ang " : "Not plotted on the map: ") + caseNo, gisIcon("warningTriangle"));
    return;
  }
  const zoneBtn = evt.target.closest("[data-gis-hazard]");
  if (zoneBtn) {
    if (
      typeof gisMapInstance.flyToHazard === "function" &&
      !gisMapInstance.flyToHazard(zoneBtn.getAttribute("data-gis-hazard"))
    )
      showToast(
        fil ? "Wala na sa mapa ang zone na ito" : "That zone is no longer on the map",
        gisIcon("warningTriangle")
      );
    return;
  }
  const houseBtn = evt.target.closest("[data-gis-building]");
  if (houseBtn) {
    if (
      typeof gisMapInstance.focusBuilding === "function" &&
      !gisMapInstance.focusBuilding(houseBtn.getAttribute("data-gis-building"))
    )
      showToast(
        fil ? "Wala na sa mapa ang bahay na ito" : "That house is no longer on the map",
        gisIcon("warningTriangle")
      );
  }
}

function renderGisNarrative(loading) {
  const body = document.getElementById("gis-ai-body");
  const btn = document.getElementById("gis-ai-generate");
  if (!body) return;

  const fil = window.L && L.isFilipino;

  // A re-render — a hazard refresh, a language switch — keeps the reader's
  // place in the panel instead of throwing them back to the top.
  const oldProse = body.querySelector(".gis-ai-prose");
  const scrollTop = oldProse ? oldProse.scrollTop : 0;
  const keepPlace = () => {
    const prose = body.querySelector(".gis-ai-prose");
    if (prose && scrollTop) prose.scrollTop = scrollTop;
  };

  const n = loading ? null : GIS_NARRATIVE;
  const parts = gisNarrativeParts(n);
  // The live hazard section leads EVERY state of the panel — while a briefing
  // generates, and when there is no briefing at all.
  const hazardHtml = gisHazardSectionHtml(fil);

  if (loading) {
    // Regeneration takes several seconds — the model thinks before it writes.
    // A skeleton in the final shape beats a bare spinner: the panel does not
    // jump when the real sections land.
    body.innerHTML = `
      <div class="gis-ai-report">
        <div class="ai-loading-note"><span class="ai-spinner" aria-hidden="true"></span>${
          fil ? "Bumubuo ng ulat…" : "Generating briefing…"
        }</div>
        <div class="gis-ai-prose">
          ${hazardHtml}
          ${[1, 2, 3, 4]
            .map(
              (i) => `
            <section class="gis-ai-section gis-ai-section-${i}">
              <div class="ai-skel ai-skel-head"></div>
              <div class="ai-skel"></div>
              <div class="ai-skel ai-skel-short"></div>
            </section>`
            )
            .join("")}
        </div>
      </div>`;
    keepPlace();
    return;
  }
  if (!n) {
    const off = fil
      ? "Hindi naka-configure ang AI sa server na ito."
      : "AI briefings are not configured on this server.";
    const none = fil
      ? "Wala pang ulat. Pindutin ang Generate para tingnan kung aling mga reklamo ang dapat unahin at alin ang matagal nang hindi naaaksyunan."
      : "No briefing yet. Use Generate to see which reports need attention first and which have gone unresolved.";
    const placeholder = `
      <div class="gis-ai-placeholder">
        ${gisIcon("layers")}
        <div>${btn && btn.disabled ? off : none}</div>
      </div>`;
    // With zones active, the placeholder sits under them in the same scroll.
    body.innerHTML = hazardHtml
      ? `<div class="gis-ai-report"><div class="gis-ai-prose">${hazardHtml}${placeholder}</div></div>`
      : placeholder;
    keepPlace();
    return;
  }

  const when = new Date(n.created_at).toLocaleString();

  // Sectioned briefing: heading, a short body, and the case numbers as their
  // own lines so an official can scan for "which case first" instead of
  // reading to the end of a paragraph. Pre-sections reports (and any response
  // missing sections) fall back to plain paragraphs.
  const secs = parts.secs;
  const paras = secs
    ? secs
        .map((s, i) => {
          const items = (s.items || [])
            .filter((x) => String(x || "").trim())
            .map((x) => {
              const text = String(x).trim();
              // Any item naming a case becomes a button that flies the map to
              // that pin. The case number is read straight out of the text
              // rather than carried as a separate field, so this also works
              // for briefings generated before this change — and an item whose
              // case is no longer plotted simply renders as plain text.
              const m = text.match(/\bINC-\d{4}-\d+\b/i);
              if (!m) return `<li>${gisPageEscapeHtml(text)}</li>`;
              return `<li><button type="button" class="gis-ai-case" data-gis-case="${gisPageEscapeHtml(m[0])}" title="Show ${gisPageEscapeHtml(m[0])} on the map">${gisPageEscapeHtml(text)}</button></li>`;
            })
            .join("");
          return `
          <section class="gis-ai-section gis-ai-section-${i + 1}">
            <h4 class="gis-ai-section-head">${gisPageEscapeHtml(s.heading || "")}</h4>
            ${s.body ? `<p class="gis-ai-section-body">${gisPageEscapeHtml(String(s.body).trim())}</p>` : ""}
            ${items ? `<ul class="gis-ai-section-list">${items}</ul>` : ""}
          </section>`;
        })
        .join("")
    : String(gisNarrativeText(n))
        .split(/\n\s*\n/)
        .filter((p) => p.trim())
        .map((p) => `<p>${gisPageEscapeHtml(p.trim())}</p>`)
        .join("");

  // Figures-only mode: the model could not be reached (cap spent, rate limited,
  // or no key), so the server rendered the SQL figures instead. The numbers are
  // still real — only the phrasing and the suggested next steps are missing —
  // and a reader must not mistake one for the other.
  //
  // Degraded is the other case: the model was busy, so the server handed back
  // the LAST briefing it wrote. That is real prose, just older — calling it
  // "figures only" would be wrong, so it says what it is instead.
  const fallbackNote = n.fallback
    ? `<div class="ai-fallback-note">${
        fil
          ? "Hindi available ang AI — mga datos lamang ang ipinapakita."
          : "AI unavailable — showing figures only."
      }</div>`
    : n.degraded
      ? `<div class="ai-fallback-note">${
          fil
            ? "Abala ang AI ngayon — ang huling ulat ang ipinapakita."
            : "AI is busy right now — showing the last briefing."
        }</div>`
      : "";

  body.innerHTML = `
    <div class="gis-ai-report">
      ${fallbackNote}
      <div class="gis-ai-prose">${hazardHtml}${paras}</div>
      <div class="gis-ai-disclaimer">
        ${
          fil
            ? "Gawa ng AI mula sa talaan ng barangay — pakisuri bago gamitin sa opisyal na dokumento."
            : "AI-generated from barangay records — verify before use in official documents."
        }
      </div>
      <div class="gis-ai-actions">
        <span class="gis-ai-stamp">${gisPageEscapeHtml(when)} · ${gisPageEscapeHtml(n.model || "")}</span>
        <button type="button" class="btn btn-sm btn-outline" onclick="copyGisNarrative(this)">${fil ? "Kopyahin" : "Copy"}</button>
      </div>
    </div>`;
  if (btn && !btn.disabled) btn.textContent = fil ? "I-refresh" : "Regenerate";
  // Clicks — case numbers, zones, households — are delegated from #gis-ai-body
  // (onGisAiBodyClick), bound once in initGisNarrativePanel.
  keepPlace();
}

// Background re-check on the refresh timer. Silent: no spinner, no toast — it
// must not interrupt someone reading the map. The server returns the cached
// text for free when nothing changed, so this usually costs no tokens at all.
async function refreshGisNarrative() {
  try {
    const next = await apiPost("/api/ai/map/narrative", {
      account_id: actingAccountId(),
      auto: true,
    });
    if (!next) return;
    const changed =
      !GIS_NARRATIVE || next.created_at !== GIS_NARRATIVE.created_at || next.stale;
    GIS_NARRATIVE = next;
    if (changed) renderGisNarrative();
  } catch (e) {
    /* a failed background refresh must stay invisible */
  }
}

// `force` skips the digest cache on an explicit click. Without it, re-clicking
// when nothing has changed reuses the stored briefing, so pressing the button
// during a demo costs one API call, not one per press.
async function generateGisNarrative(force) {
  const btn = document.getElementById("gis-ai-generate");
  if (btn) btn.disabled = true;
  GIS_NARRATIVE_BUSY = true;
  renderGisNarrative(true);
  try {
    GIS_NARRATIVE = await apiPost("/api/ai/map/narrative", {
      account_id: actingAccountId(),
      force: !!force,
    });
    GIS_NARRATIVE_BUSY = false;
    renderGisNarrative();
    const fil = window.L && L.isFilipino;
    const n = GIS_NARRATIVE;
    showToast(
      n.fallback
        ? fil
          ? "Hindi maabot ang AI — mga datos lamang"
          : "AI unavailable — showing figures only"
        : n.degraded
          ? fil
            ? "Abala ang AI — ang huling ulat ang ipinapakita"
            : "AI is busy — showing the last briefing"
          : n.cached
            ? fil
              ? "Walang pagbabago sa datos"
              : "Figures unchanged — showing the stored briefing"
            : fil
              ? "Nabuo ang ulat"
              : "Briefing generated",
      gisIcon("layers")
    );
  } catch (err) {
    GIS_NARRATIVE_BUSY = false;
    renderGisNarrative();
    showToast(err.message || "Could not generate the narrative", gisIcon("warningTriangle"));
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Copies whichever language is on screen — copying English while reading
// Filipino would be a small but confusing betrayal.
function copyGisNarrative(btn) {
  if (!GIS_NARRATIVE) return;
  const fil = window.L && L.isFilipino;
  navigator.clipboard.writeText(gisNarrativeCopyText(GIS_NARRATIVE)).then(
    () => showToast(fil ? "Nakopya ang ulat" : "Briefing copied", gisIcon("layers")),
    () => showToast(fil ? "Hindi makopya" : "Could not copy", gisIcon("warningTriangle"))
  );
}

