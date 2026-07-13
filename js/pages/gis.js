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
      const confirmBar = document.getElementById("gis-history-confirm");
      if (resolveBtn) {
        gisSetCommunityReportResolved(resolveBtn.getAttribute("data-history-resolve"), true);
        afterReportModeration("Concern marked as resolved", "check");
      } else if (reopenBtn) {
        gisSetCommunityReportResolved(reopenBtn.getAttribute("data-history-reopen"), false);
        afterReportModeration("Concern reopened", "refresh");
      } else if (showBtn) {
        modal.classList.remove("open");
        if (gisMapInstance) gisMapInstance.flyToReport(showBtn.getAttribute("data-history-show"));
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
        <div class="card gis-side-panel gis-side-reports">
          <div class="card-header">
            <div class="card-title">Recent Community Reports</div>
            <button type="button" class="btn btn-sm btn-outline gis-view-all-btn" id="gis-view-all-reports">Open Blotter <i data-icon=arrow-right></i></button>
          </div>
          <div class="gis-report-feed" id="gis-report-feed"></div>
        </div>
        <div class="card gis-side-panel gis-side-ai">
          <div class="card-header">
            <div class="card-title">AI Narrative Report</div>
          </div>
          <div class="gis-ai-placeholder">
            ${gisIcon("layers")}
            <div>An AI-generated narrative summary of the map — hazard zones, community reports, and coverage trends — will appear here.</div>
            <button class="btn btn-sm btn-outline" disabled>Generate Report (coming soon)</button>
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
    instance.flyToReport(btn.getAttribute("data-report-id"));
  });
  // "View All" now opens the Blotter page — the two features are merged, so the
  // full list lives there rather than in a separate history modal.
  document.getElementById("gis-view-all-reports").addEventListener("click", () => nav(null, "incidents"));

  // Handoff from the Blotter page's "View on Map" action: fly to the report
  // whose id was stashed in sessionStorage, then clear it so a later plain
  // visit to this page doesn't re-trigger.
  try {
    const focusId = sessionStorage.getItem("ibmdss.focusReport");
    if (focusId) {
      sessionStorage.removeItem("ibmdss.focusReport");
      setTimeout(() => instance.flyToReport(focusId), 300);
    }
  } catch (e) {
    /* non-fatal */
  }

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
}
