// js/pages/audit.js
window.CURRENT_PAGE = "audit";

function renderPage() {
  renderAudit();
}

function renderAudit() {
  setContent(`
    <div class="page-header"><h2 class="page-title">Audit Logs</h2><p class="page-desc">System activity, compliance tracking, and data access records</p></div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Logs Today</div><div class="kpi-value">29</div></div>
      <div class="kpi-card danger"><div class="kpi-label">Critical Events (30d)</div><div class="kpi-value">4</div></div>
      <div class="kpi-card success"><div class="kpi-label">Compliance Score</div><div class="kpi-value">98%</div></div>
      <div class="kpi-card"><div class="kpi-label">Last Export</div><div class="kpi-value table-text-sm">May 1</div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">System Activity Log</div>
        <div class="btn-group">
          <button class="btn btn-sm btn-outline"><i data-icon=download></i> Export CSV</button>
          <button class="btn btn-sm btn-outline"><i data-icon=download></i> Export PDF</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Details</th><th>Level</th></tr></thead>
          <tbody>
            ${[
              ["2025-05-02 10:45:23","Officer Reyes","CERT_ISSUE",      "Barangay Clearance issued for Pedro Santos (CERT-2025-087)",       "info"],
              ["2025-05-02 09:12:44","System",       "INCIDENT_LOG",    "Flooding incident auto-logged from IoT sensor — Purok 3",          "critical"],
              ["2025-05-02 08:55:11","Admin",        "ACC_APPROVE",     "Account claim ACC-2025-0044 approved for Maria dela Cruz",         "info"],
              ["2025-05-01 16:30:05","Officer Cruz", "DATA_ACCESS",     "Resident record viewed — dela Cruz, Maria L.",          "info"],
              ["2025-05-01 15:22:18","System",       "BACKUP",          "Automated daily backup completed — 98.4 MB",                      "info"],
              ["2025-05-01 11:10:44","Admin",        "USER_DEACTIVATE", "User account suspended — inactive for 90 days",                   "warning"],
              ["2025-04-30 14:05:33","Officer Reyes","CERT_REJECT",     "Certificate request CERT-2025-083 rejected — incomplete docs",    "warning"],
              ["2025-04-30 09:00:01","System",       "BACKUP",          "Automated daily backup completed — 97.1 MB",                      "info"],
            ]
              .map(([ts, user, action, detail, level]) => {
                const badge = { info: "badge-info", critical: "badge-danger", warning: "badge-warning" }[level];
                return `<tr>
                <td class="table-muted table-nowrap">${ts}</td>
                <td class="table-text-sm">${user}</td>
                <td><code class="table-action-code">${action}</code></td>
                <td class="table-text-md">${detail}</td>
                <td><span class="badge ${badge}">${level.toUpperCase()}</span></td>
              </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `);
}
