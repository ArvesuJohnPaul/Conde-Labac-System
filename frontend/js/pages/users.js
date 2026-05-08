// js/pages/users.js
window.CURRENT_PAGE = "users";

function renderPage() {
  renderUsers();
}

function renderUsers() {
  setContent(`
    <div class="page-header"><h2 class="page-title">User Management</h2><p class="page-desc">Manage roles and system access</p></div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Total Users</div><div class="kpi-value">487</div></div>
      <div class="kpi-card success"><div class="kpi-label">Active Accounts</div><div class="kpi-value">472</div></div>
      <div class="kpi-card warning"><div class="kpi-label">Pending Approval</div><div class="kpi-value">12</div></div>
      <div class="kpi-card danger"><div class="kpi-label">Suspended</div><div class="kpi-value">3</div></div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Role Access Matrix</div></div>
      <div class="table-wrap">
        <table class="perm-table">
          <thead><tr><th class="text-left">Module</th><th>Admin</th><th>Officer</th><th>Resident</th></tr></thead>
          <tbody>
            ${[
              ["Dashboard (Full)",            "✓", "✓", "✗"],
              ["Residency — View All",         "✓", "✓", "Limited"],
              ["Certificate — Approve/Issue",  "✓", "✓", "✗"],
              ["Certificate — Request",        "✓", "✓", "✓"],
              ["Blotter — File Report",        "✓", "✓", "✓"],
              ["Blotter — Investigate",        "✓", "✓", "✗"],
              ["Feedback — Submit",            "✓", "✓", "✓"],
              ["Feedback — Manage",            "✓", "✓", "✗"],
              ["GIS Map — View",              "✓", "✓", "✓"],
              ["Account Claiming",             "✓", "✓", "✓"],
              ["User Management",              "✓", "✗", "✗"],
              ["Audit Logs",                   "✓", "✗", "✗"],
              ["Archive",                      "✓", "✗", "✗"],
            ]
              .map(([mod, a, o, r]) => `<tr>
              <td>${mod}</td>
              <td class="${a === "✓" ? "perm-check" : a === "✗" ? "perm-x" : ""} text-center">${a}</td>
              <td class="${o === "✓" ? "perm-check" : o === "✗" ? "perm-x" : ""} text-center">${o}</td>
              <td class="${r === "✓" ? "perm-check" : r === "✗" ? "perm-x" : ""} text-center table-text-sm">${r}</td>
            </tr>`)
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `);
}
