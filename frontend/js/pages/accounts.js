// js/pages/accounts.js
window.CURRENT_PAGE = "accounts";

function renderPage() {
  renderAccountsPage();
}

function renderAccountsPage() {
  setContent(`
    <div class="page-header">
      <h2 class="page-title">Account Claiming</h2>
      <p class="page-desc">Review and approve resident account claim requests</p>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card warning"><div class="kpi-label">Pending Review</div><div class="kpi-value">12</div></div>
      <div class="kpi-card success"><div class="kpi-label">Approved (30 days)</div><div class="kpi-value">34</div></div>
      <div class="kpi-card danger"><div class="kpi-label">Rejected</div><div class="kpi-value">3</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Accounts</div><div class="kpi-value">487</div></div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Pending Account Claims</div></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Ref No.</th><th>Applicant</th><th>Email</th><th>Purok</th><th>Submitted</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${[
              ["ACC-2025-0048","Santos, Pedro J.",    "pedro.santos@gmail.com",    "Purok 1","May 2, 2025",  "Pending"],
              ["ACC-2025-0047","Bautista, Liza M.",   "liza.b@yahoo.com",          "Purok 3","May 1, 2025",  "Pending"],
              ["ACC-2025-0046","Ramos, Antonio S.",   "antonio.ramos@gmail.com",   "Purok 2","Apr 30, 2025", "Pending"],
              ["ACC-2025-0045","dela Cruz, Juana",    "juana.dc@gmail.com",        "Purok 4","Apr 30, 2025", "Under Review"],
              ["ACC-2025-0044","Cruz, Mark L.",       "mark.cruz@outlook.com",     "Purok 5","Apr 29, 2025", "Approved"],
            ]
              .map(([ref, name, email, purok, date, status]) => {
                const badge = { Pending: "badge-warning", "Under Review": "badge-info", Approved: "badge-success" }[status];
                return `<tr>
                <td class="table-mono">${ref}</td>
                <td class="table-name">${name}</td>
                <td class="table-muted">${email}</td>
                <td><span class="badge badge-gray">${purok}</span></td>
                <td class="table-muted">${date}</td>
                <td><span class="badge ${badge}">${status}</span></td>
                <td><div class="btn-group">
                  <button class="btn btn-sm btn-outline" onclick="showToast('Viewing ${ref}')">View</button>
                  ${status !== "Approved" ? `<button class="btn btn-sm btn-gold" onclick="showToast('${ref} approved! ✓','✓')">Approve</button>` : ""}
                </div></td>
              </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `);
}
