// js/pages/incidents.js — Blotter / Incident Reports.
//
// Data-driven from the unified incident/concern store (gisAllCommunityReports,
// js/gis-map.js) — the same records filed through the "File an Incident /
// Concern" modal and shown as pins on the GIS map and in the GIS "Recent
// Community Reports" feed. Blotter reporting and concern reporting are one
// feature now, so there is no separate mock data here.
window.CURRENT_PAGE = "incidents";

// Cross-page handoff: the blotter has no map of its own, so "View on Map"
// stashes a report id and sends the user to the GIS page, which flies to it.
const INCIDENT_FOCUS_KEY = "ibmdss.focusReport";
// ...and the other direction: a map pin's "View in Blotter" stashes its report
// id here (gisOpenInBlotter in js/gis-map.js), and this page opens that report
// on arrival (openIncidentFromHandoff).
const INCIDENT_OPEN_KEY =
  typeof GIS_OPEN_INCIDENT_KEY !== "undefined" ? GIS_OPEN_INCIDENT_KEY : "ibmdss.openIncident";
// The report that handoff arrived for. Its row is tinted by the table renderer
// itself, not by a class added afterwards: the sync that is usually still in
// flight on arrival re-renders the whole table when it lands, and would wipe it.
let incidentFocusId = null;

function renderPage() {
  renderIncidentsPage();
  // Reports live in the shared incident table now — pull the latest; the
  // sync re-renders this page only when something actually changed (and is
  // throttled, so render → sync → render can't loop).
  if (typeof gisSyncCommunityReports === "function") gisSyncCommunityReports();
  openIncidentFromHandoff();
}

function incidentEscape(str) {
  const div = document.createElement("div");
  div.textContent = String(str == null ? "" : str);
  return div.innerHTML;
}

function incidentDateFiled(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// "View on Map" hands off to the GIS page, which reads the stashed id on load
// and calls the map engine's focusReport() — that pans and zooms to the pin,
// highlights it, and opens its card. Reports without usable coordinates never
// had a pin to fly to, so say that here instead of navigating to a map that
// looks like it ignored the click.
function viewIncidentOnMap(id) {
  const reports = typeof gisAllCommunityReports === "function" ? gisAllCommunityReports() : [];
  const r = reports.find((x) => String(x.id) === String(id));
  const point = r && r.point;
  if (!Array.isArray(point) || !Number.isFinite(+point[0]) || !Number.isFinite(+point[1])) {
    if (typeof showToast === "function")
      showToast("This report has no map location on file", "<i data-icon=triangle-alert></i>");
    return;
  }
  try {
    sessionStorage.setItem(INCIDENT_FOCUS_KEY, String(id));
  } catch (e) {
    /* non-fatal — the GIS page just opens at its default view */
  }
  nav(null, "gis");
}

// Arrival from a map pin's "View in Blotter": open that report's full record,
// and page the table to its row and tint it, so it is found in context too.
//
// The report may not be in the local store yet — this page starts from the
// localStorage snapshot while /api/incidents is still in flight (renderPage's
// sync), and a report filed on another device exists only in that response.
// So look, and on a miss wait for the sync and look again for a few seconds —
// the same wait the GIS page does for the reverse handoff.
async function openIncidentFromHandoff() {
  let id = null;
  try {
    id = sessionStorage.getItem(INCIDENT_OPEN_KEY);
    if (id) sessionStorage.removeItem(INCIDENT_OPEN_KEY);
  } catch (e) {
    return; // storage disabled — nothing was handed over
  }
  if (!id) return;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const deadline = Date.now() + 4000;
  let index = -1;
  for (;;) {
    index = incidentSortedReports().findIndex((r) => String(r.id) === String(id));
    if (index >= 0 || Date.now() > deadline) break;
    // Throttled and possibly already in flight — as much "wait for it" as
    // "ask again".
    if (typeof gisSyncCommunityReports === "function") await gisSyncCommunityReports();
    await wait(400);
  }
  if (index < 0) {
    if (typeof showToast === "function")
      showToast("That report is no longer in the blotter", "<i data-icon=triangle-alert></i>");
    return;
  }

  // Mark the row and page the table to it (pagerState / PAGE_SIZE are
  // js/shell.js's).
  incidentFocusId = String(id);
  if (typeof pagerState !== "undefined" && typeof PAGE_SIZE !== "undefined") {
    pagerState.incidents = pagerState.incidents || { page: 1 };
    pagerState.incidents.page = Math.floor(index / PAGE_SIZE) + 1;
  }
  repaintIncidentsList();
  const row = document.querySelector(`[data-incident-row="${CSS.escape(incidentFocusId)}"]`);
  if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
  openIncidentDetail(id);
}

// ── Full incident detail ────────────────────────────────────────────────────
// The table can only show five columns, so the narration, the respondent, the
// witnesses and the contact number — the fields that actually matter when
// someone is acting on a blotter entry — had nowhere to be read. This modal is
// that missing view. Built on demand and appended to <body>, reusing the
// sitewide .modal-backdrop / .modal-box shell (same pattern as the GIS report
// history modal).
function incidentDetailRow(label, value, opts) {
  const o = opts || {};
  if (!value && !o.always) return "";
  return `
    <div class="incident-detail-row">
      <div class="incident-detail-label">${incidentEscape(label)}</div>
      <div class="incident-detail-value${o.mono ? " table-mono" : ""}${o.block ? " incident-detail-block" : ""}">${incidentEscape(value || "—")}</div>
    </div>`;
}

function openIncidentDetail(id) {
  const reports = typeof gisAllCommunityReports === "function" ? gisAllCommunityReports() : [];
  const r = reports.find((x) => String(x.id) === String(id));
  if (!r) return;

  const meta = (typeof GIS_REPORT_TYPE_META !== "undefined" && GIS_REPORT_TYPE_META[r.reportType]) || null;
  const typeLabel = meta ? meta.label : r.reportType || "Incident";
  const reporter = r.reporter || {};
  const days = r.createdAt
    ? Math.round((Date.now() - r.createdAt) / 86400000)
    : null;

  let modal = document.getElementById("incident-detail-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.id = "incident-detail-modal";
    document.body.appendChild(modal);
    modal.addEventListener("click", (evt) => {
      if (evt.target === modal || evt.target.closest("[data-incident-close]"))
        modal.classList.remove("open");
    });
  }

  modal.innerHTML = `
    <div class="modal-box modal-lg">
      <div class="modal-header">
        <div class="modal-title">
          <div class="modal-title-icon">${typeof gisIcon === "function" ? gisIcon(meta ? meta.icon : "siren") : ""}</div>
          ${incidentEscape(r.caseNo || r.id)}
        </div>
        <button class="modal-close" data-incident-close aria-label="Close">${typeof gisIcon === "function" ? gisIcon("cancelX") : "&times;"}</button>
      </div>
      <div class="modal-body">
        <div class="incident-detail-head">
          <span class="badge ${r.resolved ? "badge-success" : "badge-danger"}">${r.resolved ? "Resolved" : "Active"}</span>
          <span class="badge badge-gray">${incidentEscape(typeLabel)}</span>
          ${days !== null && !r.resolved ? `<span class="badge ${days >= 30 ? "badge-warning" : "badge-gray"}">${days} day${days === 1 ? "" : "s"} open</span>` : ""}
        </div>
        ${incidentDetailRow("Title", r.title, { always: true })}
        ${incidentDetailRow("Narration", r.comment, { always: true, block: true })}
        ${incidentDetailRow("Complainant", r.complainant || reporter.name, { always: true })}
        ${incidentDetailRow("Contact", r.contact)}
        ${incidentDetailRow("Respondent", r.respondent)}
        ${incidentDetailRow("Witnesses", r.witnesses)}
        ${incidentDetailRow("Date filed", incidentDateFiled(r.createdAt), { always: true })}
        ${r.resolved ? incidentDetailRow("Resolved", incidentDateFiled(r.resolvedAt), { always: true }) : ""}
        ${incidentDetailRow("Coordinates", Array.isArray(r.point) ? `${(+r.point[1]).toFixed(6)}, ${(+r.point[0]).toFixed(6)}` : "", { mono: true })}
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="viewIncidentOnMap('${incidentEscape(r.id)}')">View on Map</button>
        ${
          r.resolved
            ? `<button class="btn btn-outline" onclick="reopenIncident('${incidentEscape(r.id)}');document.getElementById('incident-detail-modal').classList.remove('open')">Reopen</button>`
            : `<button class="btn btn-gold" onclick="resolveIncident('${incidentEscape(r.id)}');document.getElementById('incident-detail-modal').classList.remove('open')">Resolve</button>`
        }
        <button class="btn btn-outline" data-incident-close>Close</button>
      </div>
    </div>`;
  if (typeof hydrateIcons === "function") hydrateIcons(modal);
  modal.classList.add("open");
}

function resolveIncident(id) {
  if (typeof gisSetCommunityReportResolved === "function") gisSetCommunityReportResolved(id, true);
  if (typeof showToast === "function") showToast("Incident marked as resolved", "<i data-icon=check></i>");
  renderIncidentsPage();
  // The sidebar pill counts open incidents — one fewer now.
  if (typeof refreshNavBadges === "function") refreshNavBadges();
}

function reopenIncident(id) {
  if (typeof gisSetCommunityReportResolved === "function") gisSetCommunityReportResolved(id, false);
  if (typeof showToast === "function") showToast("Incident reopened", "<i data-icon=refresh></i>");
  renderIncidentsPage();
  if (typeof refreshNavBadges === "function") refreshNavBadges();
}

// Delete = archive. gisDeleteCommunityReport drops the record from the local
// store (so the pin leaves the map and the GIS feed immediately) and calls
// DELETE /api/incidents/:id, which snapshots the row into the shared Archive
// before removing it — an Admin can restore it from the Archive page.
// deleteRecord() in shell.js handles permission, confirmation and audit.
async function deleteIncidentRecord(id) {
  const reports = typeof gisAllCommunityReports === "function" ? gisAllCommunityReports() : [];
  const r = reports.find((x) => String(x.id) === String(id));
  if (!r) return;
  const meta = (typeof GIS_REPORT_TYPE_META !== "undefined" && GIS_REPORT_TYPE_META[r.reportType]) || null;
  await deleteRecord({
    label: `${r.caseNo || r.id} — ${meta ? meta.label : r.reportType || "Incident"}`,
    what: "blotter report",
    icon: "siren",
    action: "INCIDENT_DELETE",
    category: "concern",
    details: `Blotter report ${r.caseNo || r.id} (${meta ? meta.label : r.reportType || "incident"}) deleted and moved to the Archive`,
    request: async () => {
      if (typeof gisDeleteCommunityReport === "function") gisDeleteCommunityReport(id);
    },
    onDone: () => renderIncidentsPage(),
  });
}

function renderIncidentsPage() {
  const reports = incidentSortedReports();

  const active = reports.filter((r) => !r.resolved).length;
  const resolved = reports.length - active;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const thisMonth = reports.filter((r) => (r.createdAt || 0) >= monthStart.getTime()).length;

  setContent(`
    <div class="page-header">
      <h2 class="page-title">Blotter / Incident Reports</h2>
      <p class="page-desc">Incidents and community concerns filed by residents — logged, tracked, and resolved</p>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card danger"><div class="kpi-label">Active</div><div class="kpi-value">${active}</div></div>
      <div class="kpi-card success"><div class="kpi-label">Resolved</div><div class="kpi-value">${resolved}</div></div>
      <div class="kpi-card"><div class="kpi-label">Filed This Month</div><div class="kpi-value">${thisMonth}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Blotter Entries</div><div class="kpi-value">${reports.length}</div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">Incident Blotter</div>
        <div class="btn-group">
          <button class="btn btn-sm btn-gold" onclick="openServicePopup('incidents')">⊕ File Incident</button>
        </div>
      </div>
      <div id="incident-list-wrap">${renderIncidentsList()}</div>
    </div>
  `);
}

// The blotter list plus its pager, in one block so the page buttons can
// repaint just this part instead of the whole page (which would re-run the
// KPI maths and scroll the user back to the top).
function renderIncidentsList() {
  const reports = incidentSortedReports();
  if (!reports.length) return `<div class="table-wrap">${renderIncidentsEmpty()}</div>`;
  const page = paginate("incidents", reports, repaintIncidentsList);
  return `<div class="table-wrap">${renderIncidentsTable(page.items)}</div>${page.html}`;
}

function incidentSortedReports() {
  return (typeof gisAllCommunityReports === "function" ? gisAllCommunityReports() : [])
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function repaintIncidentsList() {
  const wrap = document.getElementById("incident-list-wrap");
  if (!wrap) return renderIncidentsPage();
  wrap.innerHTML = renderIncidentsList();
  if (typeof hydrateIcons === "function") hydrateIcons(wrap);
}

function renderIncidentsEmpty() {
  return `<div class="resident-empty">No incidents filed yet. Use <strong>File Incident</strong> to log one — it drops a pin on the map and appears here and in the GIS Recent Community Reports feed.</div>`;
}

function renderIncidentsTable(reports) {
  const rows = reports
    .map((r) => {
      const meta = (typeof GIS_REPORT_TYPE_META !== "undefined" && GIS_REPORT_TYPE_META[r.reportType]) || null;
      const typeLabel = meta ? meta.label : r.reportType || "Incident";
      const complainant = r.complainant || r.reporter?.name || "—";
      const statusBadge = r.resolved ? "badge-success" : "badge-danger";
      const statusText = r.resolved ? "Resolved" : "Active";
      const caseNo = r.caseNo || r.id;
      const actions =
        `<button class="btn btn-sm btn-outline" onclick="openIncidentDetail('${incidentEscape(r.id)}')">View</button>` +
        (r.resolved
          ? `<button class="btn btn-sm btn-outline" onclick="viewIncidentOnMap('${incidentEscape(r.id)}')">View on Map</button>
             <button class="btn btn-sm btn-outline" onclick="reopenIncident('${incidentEscape(r.id)}')">Reopen</button>`
          : `<button class="btn btn-sm btn-outline" onclick="viewIncidentOnMap('${incidentEscape(r.id)}')">View on Map</button>
             <button class="btn btn-sm btn-gold" onclick="resolveIncident('${incidentEscape(r.id)}')">Resolve</button>`) +
        deleteButtonHtml(`deleteIncidentRecord('${incidentEscape(r.id)}')`, "");
      const focused = incidentFocusId !== null && String(r.id) === incidentFocusId;
      return `<tr data-incident-row="${incidentEscape(r.id)}"${focused ? ' class="incident-row-focus"' : ""}>
        <td class="table-mono">${incidentEscape(caseNo)}</td>
        <td class="table-text-sm">${incidentEscape(typeLabel)}</td>
        <td class="table-name">${incidentEscape(complainant)}</td>
        <td class="table-muted">${incidentEscape(incidentDateFiled(r.createdAt))}</td>
        <td><span class="badge ${statusBadge}">${statusText}</span></td>
        <td><div class="btn-group">${actions}</div></td>
      </tr>`;
    })
    .join("");
  return `
    <table class="data-table">
      <thead><tr><th>Case No.</th><th>Type</th><th>Complainant</th><th>Date Filed</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}
