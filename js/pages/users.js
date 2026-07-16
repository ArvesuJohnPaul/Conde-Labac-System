// js/pages/users.js
// User Management — live account list from the API (/api/accounts) with a
// working "change role" action. Role changes hit PATCH /api/accounts/:id/role,
// which also writes the ROLE_CHANGE entry to the shared audit trail.
window.CURRENT_PAGE = "users";

// In-memory copy of what the API returned (same pattern as residency.js).
let ACCOUNTS = [];

const ACCOUNT_ROLES = ["Admin", "Officer", "Staff", "Viewer", "Resident"];

const ROLE_BADGES = {
  Admin: "badge-danger",
  Officer: "badge-gold",
  Staff: "badge-info",
  Viewer: "badge-gray",
  Resident: "badge-success",
};

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function renderPage() {
  renderUsers();
}

function renderUsers() {
  setContent(`
    <div class="page-header"><h2 class="page-title">User Management</h2><p class="page-desc">Manage roles and system access</p></div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Total Accounts</div><div class="kpi-value" id="kpi-users-total">—</div><div class="kpi-trend">Live from database</div></div>
      <div class="kpi-card danger"><div class="kpi-label">Admins</div><div class="kpi-value" id="kpi-users-admin">—</div></div>
      <div class="kpi-card info"><div class="kpi-label">Staff Accounts</div><div class="kpi-value" id="kpi-users-staff">—</div></div>
      <div class="kpi-card success"><div class="kpi-label">Resident Accounts</div><div class="kpi-value" id="kpi-users-res">—</div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">Accounts</div>
        <div class="btn-group">
          <button class="btn btn-sm btn-outline" onclick="loadAccounts()"><i data-icon=refresh></i> Refresh</button>
        </div>
      </div>
      <div class="filter-row">
        <input class="form-control filter-input" id="acct-search" placeholder="Search by name or email..." oninput="filterAccounts()"/>
        <select class="form-control filter-select" id="acct-role" onchange="filterAccounts()">
          <option>All Roles</option>
          ${ACCOUNT_ROLES.map((r) => `<option>${r}</option>`).join("")}
        </select>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Linked Resident</th><th>Created</th><th>Change Role</th></tr></thead>
          <tbody id="account-tbody">
            <tr><td colspan="6" class="table-muted" style="text-align:center;padding:24px">Loading accounts…</td></tr>
          </tbody>
        </table>
      </div>
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
  loadAccounts();
}

async function loadAccounts() {
  const tbody = document.getElementById("account-tbody");
  if (tbody)
    tbody.innerHTML = `<tr><td colspan="6" class="table-muted" style="text-align:center;padding:24px">Loading accounts…</td></tr>`;
  try {
    ACCOUNTS = await apiGet("/api/accounts");
    updateAccountKpis();
    filterAccounts();
  } catch (err) {
    if (tbody)
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:#b91c1c">
        Could not reach the server (${escapeHtml(err.message)}).
        <button class="btn btn-sm btn-outline" onclick="loadAccounts()" style="margin-left:8px">Retry</button>
      </td></tr>`;
  }
}

function updateAccountKpis() {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set("kpi-users-total", ACCOUNTS.length.toLocaleString());
  set("kpi-users-admin", ACCOUNTS.filter((a) => a.role === "Admin").length);
  set(
    "kpi-users-staff",
    ACCOUNTS.filter((a) => ["Officer", "Staff", "Viewer"].includes(a.role)).length
  );
  set("kpi-users-res", ACCOUNTS.filter((a) => a.role === "Resident").length);
}

function filterAccounts() {
  const q = (document.getElementById("acct-search")?.value || "").toLowerCase();
  const role = document.getElementById("acct-role")?.value || "All Roles";
  const list = ACCOUNTS.filter((a) => {
    const matchQ =
      !q ||
      (a.name || "").toLowerCase().includes(q) ||
      (a.email || "").toLowerCase().includes(q);
    const matchRole = role === "All Roles" || a.role === role;
    return matchQ && matchRole;
  });
  renderAccountRows(list);
}

function renderAccountRows(list) {
  const tbody = document.getElementById("account-tbody");
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-muted" style="text-align:center;padding:24px">No accounts match.</td></tr>`;
    return;
  }
  const session = typeof getSession === "function" ? getSession() : null;
  const isAdmin = session && session.role === "Admin";
  tbody.innerHTML = list
    .map((a) => {
      // An admin can't change their own role from the UI — someone else must,
      // so an admin can never accidentally lock themselves out.
      const isSelf =
        session &&
        ((session.account_id && session.account_id === a.account_id) ||
          (session.user &&
            session.user.toLowerCase() === (a.email || "").toLowerCase()));
      const canChange = isAdmin && !isSelf;
      const roleSelect = canChange
        ? `<select class="form-control" style="max-width:130px;display:inline-block"
             onchange="changeAccountRole(${a.account_id}, this)">
            ${ACCOUNT_ROLES.map(
              (r) =>
                `<option ${r === a.role ? "selected" : ""} ${r === "Resident" && !a.resident_id ? "disabled" : ""}>${r}</option>`
            ).join("")}
          </select>`
        : `<span class="table-muted">${isSelf ? "Your account" : "Admin only"}</span>`;
      return `<tr>
        <td class="table-name">${escapeHtml(a.name)}</td>
        <td>${escapeHtml(a.email)}</td>
        <td><span class="badge ${ROLE_BADGES[a.role] || "badge-gray"}">${escapeHtml(a.role)}</span></td>
        <td>${a.resident_id ? `#${a.resident_id}${a.purok ? " — " + escapeHtml(a.purok) : ""}` : '<span class="table-muted">—</span>'}</td>
        <td>${escapeHtml(a.created_at || "—")}</td>
        <td>${roleSelect}</td>
      </tr>`;
    })
    .join("");
}

async function changeAccountRole(accountId, selectEl) {
  const acct = ACCOUNTS.find((a) => a.account_id === accountId);
  const newRole = selectEl.value;
  if (!acct || newRole === acct.role) return;
  if (
    !confirm(
      `Change the role of ${acct.name} (${acct.email}) from ${acct.role} to ${newRole}?`
    )
  ) {
    selectEl.value = acct.role;
    return;
  }
  const session = typeof getSession === "function" ? getSession() : null;
  selectEl.disabled = true;
  try {
    await apiPatch(`/api/accounts/${accountId}/role`, {
      role: newRole,
      account_id: session?.account_id || null,
      actor_name: session?.displayName || null,
      actor_role: session?.role || null,
    });
    const oldRole = acct.role;
    acct.role = newRole;
    updateAccountKpis();
    filterAccounts();
    if (typeof showToast === "function")
      showToast(`${acct.name} is now ${newRole}`);
    if (typeof logAudit === "function")
      logAudit(
        "ROLE_CHANGE",
        `Role of ${acct.email} changed: ${oldRole} → ${newRole}`,
        "warning",
        "auth"
      );
  } catch (err) {
    selectEl.value = acct.role;
    alert("Could not change role: " + err.message);
  } finally {
    selectEl.disabled = false;
  }
}
