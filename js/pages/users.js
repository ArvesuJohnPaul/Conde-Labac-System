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
              ["Dashboard (Full)",            "<i data-icon=check></i>", "<i data-icon=check></i>", "<i data-icon=x></i>"],
              ["Residency — View All",         "<i data-icon=check></i>", "<i data-icon=check></i>", "Limited"],
              ["Certificate — Approve/Issue",  "<i data-icon=check></i>", "<i data-icon=check></i>", "<i data-icon=x></i>"],
              ["Certificate — Request",        "<i data-icon=check></i>", "<i data-icon=check></i>", "<i data-icon=check></i>"],
              ["Blotter — File Report",        "<i data-icon=check></i>", "<i data-icon=check></i>", "<i data-icon=check></i>"],
              ["Blotter — Investigate",        "<i data-icon=check></i>", "<i data-icon=check></i>", "<i data-icon=x></i>"],
              ["Feedback — Submit",            "<i data-icon=check></i>", "<i data-icon=check></i>", "<i data-icon=check></i>"],
              ["Feedback — Manage",            "<i data-icon=check></i>", "<i data-icon=check></i>", "<i data-icon=x></i>"],
              ["GIS Map — View",              "<i data-icon=check></i>", "<i data-icon=check></i>", "<i data-icon=check></i>"],
              ["Account Claiming",             "<i data-icon=check></i>", "<i data-icon=check></i>", "<i data-icon=check></i>"],
              ["User Management",              "<i data-icon=check></i>", "<i data-icon=x></i>", "<i data-icon=x></i>"],
              ["Audit Logs",                   "<i data-icon=check></i>", "<i data-icon=x></i>", "<i data-icon=x></i>"],
              ["Archive",                      "<i data-icon=check></i>", "<i data-icon=x></i>", "<i data-icon=x></i>"],
            ]
              .map(([mod, a, o, r]) => `<tr>
              <td>${mod}</td>
              <td class="${a === "<i data-icon=check></i>" ? "perm-check" : a === "<i data-icon=x></i>" ? "perm-x" : ""} text-center">${a}</td>
              <td class="${o === "<i data-icon=check></i>" ? "perm-check" : o === "<i data-icon=x></i>" ? "perm-x" : ""} text-center">${o}</td>
              <td class="${r === "<i data-icon=check></i>" ? "perm-check" : r === "<i data-icon=x></i>" ? "perm-x" : ""} text-center table-text-sm">${r}</td>
            </tr>`)
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `);
}
