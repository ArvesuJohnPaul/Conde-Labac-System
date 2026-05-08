// js/pages/incidents.js
window.CURRENT_PAGE = "incidents";

function renderPage() {
  renderIncidentsPage();
}

function renderIncidentsPage() {
  setContent(`
    <div class="page-header">
      <h2 class="page-title">Blotter / Incident Reports</h2>
      <p class="page-desc">Log, track, and resolve community incidents and complaints</p>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card danger"><div class="kpi-label">Active Incidents</div><div class="kpi-value">3</div></div>
      <div class="kpi-card warning"><div class="kpi-label">Under Investigation</div><div class="kpi-value">8</div></div>
      <div class="kpi-card success"><div class="kpi-label">Resolved (30 days)</div><div class="kpi-value">24</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Blotter Entries</div><div class="kpi-value">142</div></div>
    </div>
    <div class="alert alert-danger"><span class="alert-icon">⚠</span><strong>INC-2025-041</strong> — Critical: Flooding at Purok 3. 14 families displaced. Active response underway.</div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">Incident Blotter</div>
        <div class="btn-group">
          <button class="btn btn-sm btn-gold" onclick="openServicePopup('incidents')">⊕ File Incident</button>
          <button class="btn btn-sm btn-outline">⬇ Export</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Case No.</th><th>Type</th><th>Location</th><th>Severity</th><th>Date Filed</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${[
              ["INC-2025-041", "Flooding / Natural Hazard", "Purok 3 — Sitio Malinis", "critical", "May 2, 2025",  "Active"],
              ["INC-2025-040", "Domestic Disturbance",       "Purok 1, Blk 4",          "high",     "May 1, 2025",  "Under Investigation"],
              ["INC-2025-039", "Property Dispute",           "Purok 2",                 "medium",   "Apr 30, 2025", "Under Investigation"],
              ["INC-2025-038", "Noise Complaint",            "Purok 5",                 "low",      "Apr 30, 2025", "Resolved"],
              ["INC-2025-037", "Theft / Robbery",            "Purok 4",                 "high",     "Apr 29, 2025", "Resolved"],
              ["INC-2025-036", "Vandalism",                  "Purok 3",                 "medium",   "Apr 28, 2025", "Resolved"],
            ]
              .map(([no, type, loc, sev, date, status]) => {
                const sbadge  = { critical: "sev-critical", high: "sev-high", medium: "sev-medium", low: "sev-low" }[sev];
                const stbadge = { Active: "badge-danger", "Under Investigation": "badge-warning", Resolved: "badge-success" }[status];
                return `<tr>
                <td class="table-mono">${no}</td>
                <td class="table-text-sm">${type}</td>
                <td class="table-muted">${loc}</td>
                <td><span class="sev-badge ${sbadge}">${sev.charAt(0).toUpperCase() + sev.slice(1)}</span></td>
                <td class="table-muted">${date}</td>
                <td><span class="badge ${stbadge}">${status}</span></td>
                <td><button class="btn btn-sm btn-outline" onclick="showToast('Viewing ${no}')">View</button></td>
              </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `);
}
