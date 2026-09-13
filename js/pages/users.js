// js/pages/users.js
// User Management — live account list from the API (/api/accounts) with a
// working "change role" action. Role changes hit PATCH /api/accounts/:id/role,
// which also writes the ROLE_CHANGE entry to the shared audit trail.
window.CURRENT_PAGE = "users";

// In-memory copy of what the API returned (same pattern as residency.js).
let ACCOUNTS = [];

// Staff & Viewer were retired — every non-admin MIS user is an Officer.
const ACCOUNT_ROLES = ["Admin", "Officer", "Resident"];

const ROLE_BADGES = {
  Admin: "badge-danger",
  Officer: "badge-gold",
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
      <div class="kpi-card info"><div class="kpi-label">Officer Accounts</div><div class="kpi-value" id="kpi-users-staff">—</div></div>
      <div class="kpi-card success"><div class="kpi-label">Resident Accounts</div><div class="kpi-value" id="kpi-users-res">—</div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">Accounts</div>
        <div class="btn-group">
          <button class="btn btn-sm btn-outline" onclick="loadAccounts()"><i data-icon=refresh></i> Refresh</button>
        </div>
      </div>
      <!-- Filters use the GIS map's pill row (.gis-filter-row / -search-wrap /
           -select in css/gis.css) — the same controls the map, Barangay
           Residency and Certificate Processing use, so the whole MIS reads as
           one system rather than two generations of form controls. -->
      <div class="gis-filter-row">
        <div class="gis-search-wrap">
          ${typeof gisIcon === "function" ? gisIcon("search", "gis-search-icon") : ""}
          <input type="text" class="gis-search-input" id="acct-search" autocomplete="off"
                 placeholder="Search by name or email…" oninput="accountFilterChanged()"/>
        </div>
        <select class="gis-filter-select" id="acct-role" onchange="accountFilterChanged()">
          <option>All Roles</option>
          ${ACCOUNT_ROLES.map((r) => `<option>${r}</option>`).join("")}
        </select>
        <select class="gis-filter-select" id="acct-status" onchange="accountFilterChanged()">
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Linked Resident</th><th>Created</th><th>Change Role</th><th>Actions</th></tr></thead>
          <tbody id="account-tbody">
            <tr><td colspan="8" class="table-muted" style="text-align:center;padding:24px">Loading accounts…</td></tr>
          </tbody>
        </table>
      </div>
      <div id="account-pagination"></div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">Role Access Matrix</div>
        <button class="btn btn-sm btn-gold" id="matrix-add-role" style="display:none" onclick="addMatrixRole()"><i data-icon=plus></i> Add Role</button>
      </div>
      <p class="modal-help-text" id="role-matrix-help"></p>
      <div class="table-wrap" id="role-matrix"><div class="resident-summary">Loading…</div></div>
    </div>
  `);
  loadAccounts();
  loadPermissions();
}

// ── Role Access Matrix (dynamic roles, tap-to-toggle) ─────────────────────────
// Columns: Admin (locked — always full access) plus every editable role
// (Officer, Resident, and any custom roles an Admin adds with "Add Role").
// Tap a ✓/✗ to flip that role's access to a module (Module Access) or a delete
// action (Delete Permissions). Persisted to shared settings so the app + web
// agree; the Officer sub-keys stay enforced by shell.js (module access) and the
// app's canDeleteModule (delete).
// [key, label, hint?]. "MIS Access" leads because it is the door the rest of
// the rows are inside: switch it off and the role never reaches any module.
const MATRIX_MODULES = [
  [
    "mis",
    "MIS Access",
    "Whether the MIS appears in the navbar and can be opened at all",
  ],
  ["dashboard", "Dashboard"],
  ["residency", "Barangay Residency"],
  ["certificates", "Certificate Processing"],
  ["incidents", "Blotter / Incidents"],
  ["feedback", "Feedback"],
  ["gis", "GIS Mapping"],
  ["accounts", "Account Claiming"],
  ["analytics", "Analytics"],
  ["content", "Site Content", "Announcements & barangay officials page"],
  ["users", "User Management"],
  ["audit", "Audit Logs"],
  ["archive", "Archive"],
];

// Built-in module-access defaults per built-in role (custom roles start off).
// `mis` mirrors what the landing page did before this was configurable: staff
// get the MIS link, residents use the public portal.
const DEFAULT_MODULE_ACCESS = {
  officer: { mis: true, dashboard: true, residency: true, certificates: true, incidents: true, feedback: true, gis: true, accounts: true, analytics: true, content: true, users: false, audit: false, archive: false },
  resident: { mis: false, dashboard: false, residency: true, certificates: true, incidents: true, feedback: true, gis: true, accounts: true, analytics: false, content: false, users: false, audit: false, archive: false },
};

// Editable role columns (Admin is implicit and always full). Built-ins first;
// custom roles appended. Persisted under settings key 'matrix-roles'.
const BUILTIN_ROLES = ["Officer", "Resident"];
let editableRoles = BUILTIN_ROLES.slice();
let modulePerms = {}; // { roleKey: { moduleKey: bool } }
let deletePerms = {}; // { roleKey: { moduleKey: bool } }

const roleKey = (role) => String(role).toLowerCase();
const isBuiltinRole = (role) =>
  BUILTIN_ROLES.some((r) => roleKey(r) === roleKey(role));

function isAdminSession() {
  const s = typeof getSession === "function" ? getSession() : null;
  return !!s && s.role === "Admin";
}

async function loadPermissions() {
  try {
    const [roles, mod, del] = await Promise.all([
      apiGet("/api/settings/matrix-roles"),
      apiGet("/api/settings/module-access"),
      apiGet("/api/settings/delete-permissions"),
    ]);
    const saved =
      roles && roles.value && Array.isArray(roles.value.roles)
        ? roles.value.roles
        : null;
    editableRoles = saved && saved.length ? saved.slice() : BUILTIN_ROLES.slice();
    // Built-ins are always present, in front.
    BUILTIN_ROLES.slice()
      .reverse()
      .forEach((r) => {
        if (!editableRoles.some((x) => roleKey(x) === roleKey(r)))
          editableRoles.unshift(r);
      });
    modulePerms = mod && mod.value && typeof mod.value === "object" ? mod.value : {};
    deletePerms = del && del.value && typeof del.value === "object" ? del.value : {};
  } catch (e) {
    /* keep defaults — matrix still renders with built-in access */
  }
  renderRoleMatrix();
}

// Effective access for a role, honoring a stored override then the built-in
// default (module access) or off (delete).
function effectiveAccess(category, role, moduleKey) {
  const rk = roleKey(role);
  const store = category === "module" ? modulePerms : deletePerms;
  if (store[rk] && Object.prototype.hasOwnProperty.call(store[rk], moduleKey))
    return store[rk][moduleKey] === true;
  if (category === "module") {
    const def = DEFAULT_MODULE_ACCESS[rk];
    return !!(def && def[moduleKey]);
  }
  return false;
}

// A single ✓/✗ cell — editable ones flip on tap.
function permCell(on, onclick) {
  const icon = on ? "check" : "x";
  const cls = on ? "perm-check" : "perm-x";
  if (!onclick) return `<td class="text-center ${cls}"><i data-icon=${icon}></i></td>`;
  return `<td class="text-center ${cls}" style="cursor:pointer" title="Tap to switch access" onclick="${onclick}"><i data-icon=${icon}></i></td>`;
}

function matrixRow(category, key, label, hint) {
  const admin = isAdminSession();
  const cells = editableRoles
    .map((role) => {
      const on = effectiveAccess(category, role, key);
      return permCell(
        on,
        admin ? `toggleAccess('${category}','${roleKey(role)}','${key}')` : null
      );
    })
    .join("");
  const sub = hint
    ? `<div class="table-muted" style="font-size:12px;font-weight:400">${escapeHtml(hint)}</div>`
    : "";
  // Admin column is always ✓ and locked; every other role is tappable.
  return `<tr><td>${escapeHtml(label)}${sub}</td>${permCell(true)}${cells}</tr>`;
}

function renderRoleMatrix() {
  const admin = isAdminSession();
  const addBtn = document.getElementById("matrix-add-role");
  if (addBtn) addBtn.style.display = admin ? "" : "none";

  const help = document.getElementById("role-matrix-help");
  if (help)
    help.textContent = admin
      ? "Admins always have full access. Tap a ✓ or ✗ to switch a role's access to a module or delete action. Use “Add Role” to create a new role column."
      : "Set by an Administrator. Each role's access is shown below.";

  const roleHead = editableRoles
    .map((role) => {
      const removable = admin && !isBuiltinRole(role);
      const x = removable
        ? ` <span style="cursor:pointer;color:#b91c1c" title="Remove role" onclick="removeMatrixRole('${escapeHtml(role)}')">&times;</span>`
        : "";
      return `<th>${escapeHtml(role)}${x}</th>`;
    })
    .join("");

  const el = document.getElementById("role-matrix");
  if (!el) return;
  el.innerHTML = `
    <table class="perm-table">
      <thead><tr><th class="text-left">Module / Action</th><th>Admin</th>${roleHead}</tr></thead>
      <tbody>
        ${MATRIX_MODULES.map(([k, l, hint]) => matrixRow("module", k, l, hint)).join("")}
        ${matrixRow("delete", "records", "Delete Records")}
      </tbody>
    </table>`;
  if (typeof hydrateIcons === "function") hydrateIcons(el);
}

async function toggleAccess(category, rk, moduleKey) {
  if (!isAdminSession()) return;
  const store = category === "module" ? modulePerms : deletePerms;
  const settingKey = category === "module" ? "module-access" : "delete-permissions";
  const current = effectiveAccess(category, rk, moduleKey);
  const next = !current;
  if (!store[rk]) store[rk] = {};
  store[rk][moduleKey] = next;
  renderRoleMatrix();
  try {
    await apiPut(`/api/settings/${settingKey}`, { value: store });
    // Keep this page's cached copy of the MIS-access answer in step with what
    // was just saved, so shell.js's guard doesn't act on a stale grant.
    if (category === "module" && typeof primeMisAccessMap === "function")
      primeMisAccessMap(store);
  } catch (e) {
    store[rk][moduleKey] = current; // revert
    renderRoleMatrix();
    if (typeof showToast === "function")
      showToast("Could not save: " + e.message, "<i data-icon=triangle-alert></i>");
    return;
  }
  if (typeof logAudit === "function")
    logAudit(
      category === "module" ? "MODULE_ACCESS_UPDATE" : "DELETE_PERM_UPDATE",
      `${rk} ${category === "module" ? "access to" : "delete permission for"} "${moduleKey}" → ${next ? "granted" : "revoked"}`,
      "warning",
      "settings"
    );
}

async function addMatrixRole() {
  if (!isAdminSession()) return;
  // Name clashes are caught inside the dialog rather than after it closes, so
  // a rejected name can be corrected without retyping it.
  const name = await uiPrompt({
    icon: "users",
    title: "Add a role",
    message:
      "A new column appears in the matrix with every module and delete permission switched off. Turn on what the role should reach.",
    field: {
      label: "Role name",
      placeholder: "e.g. Barangay Secretary",
      hint: "Shown as a column header here and stored with the shared access settings, so the mobile app sees it too.",
    },
    validate: (value) => {
      if (!value) return "Give the role a name.";
      if (roleKey(value) === "admin")
        return "Admin is built in and always has full access.";
      if (editableRoles.some((r) => roleKey(r) === roleKey(value)))
        return `"${value}" is already a column in the matrix.`;
      return null;
    },
    confirmLabel: "Add Role",
    confirmIcon: "plus",
  });
  if (!name) return;
  editableRoles.push(name);
  renderRoleMatrix();
  try {
    await apiPut("/api/settings/matrix-roles", { value: { roles: editableRoles } });
  } catch (e) {
    editableRoles.pop();
    renderRoleMatrix();
    if (typeof showToast === "function")
      showToast("Could not save: " + e.message, "<i data-icon=triangle-alert></i>");
    return;
  }
  if (typeof logAudit === "function")
    logAudit("ROLE_ADD", `Role "${name}" added to the access matrix`, "warning", "settings");
  if (typeof showToast === "function") showToast(`Role "${name}" added`);
}

async function removeMatrixRole(role) {
  if (!isAdminSession() || isBuiltinRole(role)) return;
  const holders = ACCOUNTS.filter((a) => roleKey(a.role) === roleKey(role)).length;
  const ok = await uiConfirm({
    icon: "trash",
    title: "Remove this role?",
    message: "Its column and every permission stored against it are dropped.",
    target: { icon: "users", label: role },
    notes: [
      holders
        ? {
            icon: "triangle-alert",
            text: `${holders} account${holders === 1 ? "" : "s"} still carr${holders === 1 ? "ies" : "y"} this role and will lose the access it granted.`,
          }
        : {
            icon: "info",
            text: "No account currently holds this role.",
          },
      {
        icon: "clipboard",
        text: "The change is recorded in the Audit Log under your name.",
      },
    ],
    confirmLabel: "Remove Role",
    confirmIcon: "trash",
  });
  if (!ok) return;
  const rk = roleKey(role);
  const prev = editableRoles.slice();
  editableRoles = editableRoles.filter((r) => roleKey(r) !== rk);
  delete modulePerms[rk];
  delete deletePerms[rk];
  renderRoleMatrix();
  try {
    await Promise.all([
      apiPut("/api/settings/matrix-roles", { value: { roles: editableRoles } }),
      apiPut("/api/settings/module-access", { value: modulePerms }),
      apiPut("/api/settings/delete-permissions", { value: deletePerms }),
    ]);
  } catch (e) {
    editableRoles = prev;
    renderRoleMatrix();
    if (typeof showToast === "function")
      showToast("Could not save: " + e.message, "<i data-icon=triangle-alert></i>");
    return;
  }
  if (typeof logAudit === "function")
    logAudit("ROLE_REMOVE", `Role "${role}" removed from the access matrix`, "warning", "settings");
}

async function loadAccounts() {
  const tbody = document.getElementById("account-tbody");
  if (tbody)
    tbody.innerHTML = `<tr><td colspan="8" class="table-muted" style="text-align:center;padding:24px">Loading accounts…</td></tr>`;
  try {
    ACCOUNTS = await apiGet("/api/accounts");
    updateAccountKpis();
    filterAccounts();
  } catch (err) {
    if (tbody)
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:#b91c1c">
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
  // The total counts suspended accounts too — they are still accounts — so
  // say so under it rather than leaving the number quietly ambiguous.
  const suspended = ACCOUNTS.filter((a) => accountStatus(a) === "suspended").length;
  const totalTrend = document.querySelector("#kpi-users-total + .kpi-trend");
  if (totalTrend)
    totalTrend.textContent = suspended
      ? `${suspended} suspended · live from database`
      : "Live from database";
  set("kpi-users-admin", ACCOUNTS.filter((a) => a.role === "Admin").length);
  set(
    "kpi-users-staff",
    ACCOUNTS.filter((a) => a.role === "Officer").length
  );
  set("kpi-users-res", ACCOUNTS.filter((a) => a.role === "Resident").length);
}

// Narrowing the list restarts it at page one.
function accountFilterChanged() {
  resetPage("users");
  filterAccounts();
}

function filterAccounts() {
  const q = (document.getElementById("acct-search")?.value || "").toLowerCase();
  const role = document.getElementById("acct-role")?.value || "All Roles";
  const status = document.getElementById("acct-status")?.value || "";
  const list = ACCOUNTS.filter((a) => {
    const matchQ =
      !q ||
      (a.name || "").toLowerCase().includes(q) ||
      (a.email || "").toLowerCase().includes(q);
    const matchRole = role === "All Roles" || a.role === role;
    const matchStatus = !status || accountStatus(a) === status;
    return matchQ && matchRole && matchStatus;
  });
  renderAccountRows(list);
}

// Rows from an older server build carry no status column; those accounts are
// active by definition (the list only ever held active accounts back then).
function accountStatus(a) {
  return a.status === "suspended" ? "suspended" : "active";
}

function renderAccountRows(list) {
  const tbody = document.getElementById("account-tbody");
  if (!tbody) return;
  const pager = document.getElementById("account-pagination");
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-muted" style="text-align:center;padding:24px">No accounts match.</td></tr>`;
    if (pager) pager.innerHTML = "";
    return;
  }
  const page = paginate("users", list, filterAccounts);
  if (pager) {
    pager.innerHTML = page.html;
    if (typeof hydrateIcons === "function") hydrateIcons(pager);
  }
  const session = typeof getSession === "function" ? getSession() : null;
  const isAdmin = session && session.role === "Admin";
  tbody.innerHTML = page.items
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
      // Deleting your own account would sign you out of a system you may be
      // the only administrator of; the server refuses it too.
      const deleteCell = isSelf
        ? '<span class="table-muted">Your account</span>'
        : deleteButtonHtml(`deleteAccount(${a.account_id})`, "") ||
          '<span class="table-muted">—</span>';
      const suspended = accountStatus(a) === "suspended";
      const byDeath = suspended && a.suspended_reason === "deceased";
      // Suspension is an Admin action, and never on yourself — the server
      // refuses that too, for the same reason it refuses self-deletion.
      const suspendBtn = !isAdmin
        ? ""
        : isSelf
          ? ""
          : byDeath
            ? `<span class="table-muted" style="font-size:12px;max-width:150px;display:inline-block"
                 title="Change the record classification in Barangay Residency to lift this.">Lifted from the resident record</span>`
            : suspended
              ? `<button class="btn btn-sm btn-outline" onclick="setAccountSuspended(${a.account_id}, false)"><i data-icon=check></i> Reactivate</button>`
              : `<button class="btn btn-sm btn-outline" onclick="setAccountSuspended(${a.account_id}, true)"><i data-icon=lock></i> Suspend</button>`;
      const statusBadge = suspended
        ? `<span class="badge badge-danger">Suspended</span>${
            byDeath
              ? '<div class="table-muted" style="font-size:12px">Resident deceased</div>'
              : ""
          }`
        : '<span class="badge badge-success">Active</span>';
      return `<tr${suspended ? ' style="opacity:.72"' : ""}>
        <td class="table-name">${escapeHtml(a.name)}</td>
        <td>${escapeHtml(a.email)}</td>
        <td><span class="badge ${ROLE_BADGES[a.role] || "badge-gray"}">${escapeHtml(a.role)}</span></td>
        <td>${statusBadge}</td>
        <td>${a.resident_id ? `#${a.resident_id}${a.purok ? " — " + escapeHtml(a.purok) : ""}` : '<span class="table-muted">—</span>'}</td>
        <td>${escapeHtml(a.created_at || "—")}</td>
        <td>${roleSelect}</td>
        <td><div class="btn-group">${suspendBtn}${deleteCell}</div></td>
      </tr>`;
    })
    .join("");
  if (typeof hydrateIcons === "function") hydrateIcons(tbody);
}

// Delete = archive. DELETE /api/accounts/:id snapshots the account (minus its
// password hash) into the shared Archive and flips its status to 'archived':
// it leaves this list and can no longer sign in, but the row survives, so the
// certificates it processed and the map features it drew keep their
// attribution. An Admin can restore it from the Archive page. The server also
// refuses to delete the acting account or the last remaining Admin.
async function deleteAccount(accountId) {
  const acct = ACCOUNTS.find((a) => a.account_id === accountId);
  if (!acct) return;
  await deleteRecord({
    label: `${acct.name} (${acct.email})`,
    what: "user account",
    icon: "user",
    action: "ACCOUNT_DELETE",
    category: "auth",
    details: `${acct.role} account ${acct.email} deleted and moved to the Archive`,
    request: () => apiDelete(`/api/accounts/${accountId}?account_id=${actingAccountId()}`),
    onDone: () => {
      ACCOUNTS = ACCOUNTS.filter((a) => a.account_id !== accountId);
      updateAccountKpis();
      filterAccounts();
    },
  });
}

// Suspend / reactivate. Suspension is the reversible half of taking someone's
// access away: the account keeps its role, its linked resident and everything
// it ever processed, and simply cannot sign in until an Admin lifts it. Use it
// for a staff member on leave or an account under question — Delete (archive)
// is for accounts that should leave the list altogether.
async function setAccountSuspended(accountId, suspend) {
  const acct = ACCOUNTS.find((a) => a.account_id === accountId);
  if (!acct) return;
  const ok = await uiConfirm({
    tone: suspend ? undefined : "accent",
    icon: suspend ? "lock" : "check",
    title: suspend ? "Suspend this account?" : "Reactivate this account?",
    message: suspend
      ? "They are signed out of nothing right now, but the next sign-in — web or app — is refused until an Admin reactivates the account."
      : "Sign-in is allowed again immediately, with the same role and permissions as before.",
    target: { icon: "user", label: `${acct.name} (${acct.email})` },
    notes: [
      suspend
        ? {
            icon: "info",
            text: "Nothing is archived or deleted: the account stays in this list, keeps its role, and every certificate or report it handled keeps its attribution.",
          }
        : {
            icon: "lock",
            text: `They get back the modules and delete permissions the matrix grants ${acct.role}.`,
          },
      {
        icon: "clipboard",
        text: "The change is recorded in the Audit Log under your name.",
      },
    ],
    confirmLabel: suspend ? "Suspend Account" : "Reactivate Account",
    confirmIcon: suspend ? "lock" : "check",
  });
  if (!ok) return;

  const session = typeof getSession === "function" ? getSession() : null;
  const next = suspend ? "suspended" : "active";
  try {
    await apiPatch(`/api/accounts/${accountId}/status`, {
      status: next,
      account_id: session?.account_id || null,
      actor_name: session?.displayName || null,
      actor_role: session?.role || null,
    });
  } catch (err) {
    showToast(
      "Could not change the account status: " + err.message,
      "<i data-icon=triangle-alert></i>"
    );
    return;
  }
  acct.status = next;
  acct.suspended_reason = suspend ? "manual" : null;
  updateAccountKpis();
  filterAccounts();
  if (typeof showToast === "function")
    showToast(
      suspend
        ? `${acct.name} can no longer sign in`
        : `${acct.name} can sign in again`
    );
  // No logAudit() here: PATCH /api/accounts/:id/status writes the
  // ACCOUNT_SUSPEND / ACCOUNT_REACTIVATE entry itself, under the actor_name
  // this call sent it. Logging from both ends put the same line in the trail
  // twice.
}

async function changeAccountRole(accountId, selectEl) {
  const acct = ACCOUNTS.find((a) => a.account_id === accountId);
  const newRole = selectEl.value;
  if (!acct || newRole === acct.role) return;
  const ok = await uiConfirm({
    tone: "accent",
    icon: "key",
    title: "Change this account's role?",
    message: `${acct.role} → ${newRole}. It takes effect the next time they sign in.`,
    target: { icon: "user", label: `${acct.name} (${acct.email})` },
    notes: [
      {
        icon: "lock",
        text: `They get the modules and delete permissions the matrix grants ${newRole}.`,
      },
      {
        icon: "clipboard",
        text: "The change is recorded in the Audit Log under your name.",
      },
    ],
    confirmLabel: "Change Role",
    confirmIcon: "check",
  });
  if (!ok) {
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
    acct.role = newRole;
    updateAccountKpis();
    filterAccounts();
    if (typeof showToast === "function")
      showToast(`${acct.name} is now ${newRole}`);
    // No logAudit() here either — PATCH /api/accounts/:id/role writes the
    // ROLE_CHANGE entry server-side, from the actor fields sent above.
  } catch (err) {
    selectEl.value = acct.role;
    showToast("Could not change role: " + err.message, "<i data-icon=triangle-alert></i>");
  } finally {
    selectEl.disabled = false;
  }
}
