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

function renderPage() {
  renderIncidentsPage();
  // Reports live in the shared incident table now — pull the latest; the
  // sync re-renders this page only when something actually changed (and is
  // throttled, so render → sync → render can't loop).
  if (typeof gisSyncCommunityReports === "function") gisSyncCommunityReports();
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

function viewIncidentOnMap(id) {
  try {
    sessionStorage.setItem(INCIDENT_FOCUS_KEY, String(id));
  } catch (e) {
    /* non-fatal */
  }
  nav(null, "gis");
}

function resolveIncident(id) {
  if (typeof gisSetCommunityReportResolved === "function") gisSetCommunityReportResolved(id, true);
  if (typeof showToast === "function") showToast("Incident marked as resolved", "<i data-icon=check></i>");
  renderIncidentsPage();
}

function reopenIncident(id) {
  if (typeof gisSetCommunityReportResolved === "function") gisSetCommunityReportResolved(id, false);
  if (typeof showToast === "function") showToast("Incident reopened", "<i data-icon=refresh></i>");
  renderIncidentsPage();
}

function renderIncidentsPage() {
  const reports = (typeof gisAllCommunityReports === "function" ? gisAllCommunityReports() : [])
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

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
      <div class="table-wrap">
        ${reports.length ? renderIncidentsTable(reports) : renderIncidentsEmpty()}
      </div>
    </div>
  `);
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
      const actions = r.resolved
        ? `<button class="btn btn-sm btn-outline" onclick="viewIncidentOnMap('${incidentEscape(r.id)}')">View on Map</button>
           <button class="btn btn-sm btn-outline" onclick="reopenIncident('${incidentEscape(r.id)}')">Reopen</button>`
        : `<button class="btn btn-sm btn-outline" onclick="viewIncidentOnMap('${incidentEscape(r.id)}')">View on Map</button>
           <button class="btn btn-sm btn-gold" onclick="resolveIncident('${incidentEscape(r.id)}')">Resolve</button>`;
      return `<tr>
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
