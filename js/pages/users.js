// js/pages/users.js
// User Management — live account list from the API (/api/accounts) with a
// working "change role" action. Role changes hit PATCH /api/accounts/:id/role,
// which also writes the ROLE_CHANGE entry to the shared audit trail.
window.CURRENT_PAGE = "users";

// In-memory copy of what the API returned (same pattern as residency.js).
let ACCOUNTS = [];

// Staff & Viewer were retired — every non-admin MIS user is an Officer.
// Every role an account can be given: Admin, plus every column in the Role
// Access Matrix below (Officer and Resident, and whatever an Admin added —
// "Barangay Secretary", "Encoder"). It is a function, not a constant, because
// the matrix is loaded from the server after this page first paints: a role
// added last week has to appear in the Change Role dropdown, and a role added
// in the matrix a moment ago has to appear there without a reload.
//
// Admin is first and never a matrix column — it is the one role the matrix
// cannot take anything away from.
function assignableRoles() {
  const out = ["Admin"];
  editableRoles.forEach((r) => {
    if (!out.some((x) => roleKey(x) === roleKey(r))) out.push(r);
  });
  return out;
}

const ROLE_BADGES = {
  Admin: "badge-danger",
  Officer: "badge-gold",
  Resident: "badge-success",
};
// A role the barangay invented has no colour of its own; grey says "a role"
// without pretending to rank it against the three built-in ones.
const roleBadge = (role) => ROLE_BADGES[role] || "badge-gray";

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
      <div class="kpi-card info"><div class="kpi-label">Staff Accounts</div><div class="kpi-value" id="kpi-users-staff">—</div><div class="kpi-trend" id="kpi-users-staff-sub">Officers &amp; other staff roles</div></div>
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
          ${roleFilterOptionsHtml()}
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
// action (Delete Permissions). Persisted to shared settings so every browser
// agrees; the Officer sub-keys stay enforced by shell.js (module access, and
// deleteRecordsAllowed() for delete).
// [key, label, hint?]. "MIS Access" leads because it is the door the rest of
// the rows are inside: switch it off and the role never reaches any module.
// ── THE ROLE ACCESS MATRIX ──────────────────────────────────────────────────
// One table, laid out like the sidebar, because that is the thing an Admin is
// actually granting: the sections and their order are the MIS's own
// (js/app-shell.js SECTIONS), so "what can this role open?" is read in the
// same shape as the screen they will open it from.
//
// Three kinds of row:
//   module  — a page in the sidebar. Hides the screen; `mis` and `sms` are
//             also enforced by the server.
//   action  — something done INSIDE a module, enforced by the server
//             (conde-labak-server/permissions.js reads the same settings
//             keys). These are the indented rows, under the module they
//             belong to: editing the map sits under GIS Mapping, approving an
//             application under Account Claiming, the three text-message rows
//             under the SMS Log.
//   delete  — the one row that is not about a screen at all.
//
// Every row carries a description. The old matrix had hints on four of
// twenty-two rows, and an Admin granting "Feedback" to a new role had no way
// of knowing what that reaches.
//
// `officer` is the built-in default for the Officer column (action and SMS
// rows only — module defaults live in DEFAULT_MODULE_ACCESS below). A custom
// role starts with every action off and is granted them one at a time.
const MATRIX_SECTIONS = [
  {
    label: "Across the MIS",
    rows: [
      {
        cat: "module",
        key: "mis",
        label: "MIS Access",
        desc: "The door to everything below.",
      },
      {
        cat: "delete",
        key: "records",
        label: "Delete Records",
        desc: "Shows the Delete buttons. Deleted records go to the Archive.",
      },
    ],
  },
  {
    label: "Core Services",
    rows: [
      {
        cat: "module",
        key: "dashboard",
        label: "Dashboard",
        desc: "Today's counts and the AI briefing.",
      },
      {
        cat: "module",
        key: "residency",
        label: "Barangay Residency",
        desc: "Resident records, classifications and edit requests.",
      },
      {
        cat: "module",
        key: "certificates",
        label: "Certificate Processing",
        desc: "Certificate requests, issuing and printing.",
      },
      {
        cat: "module",
        key: "incidents",
        label: "Blotter / Incidents",
        desc: "The blotter: incident reports and resolving them.",
      },
      {
        cat: "module",
        key: "feedback",
        label: "Feedback",
        desc: "Resident ratings, comments and urgent alerts.",
      },
      {
        cat: "module",
        key: "gis",
        label: "GIS Mapping",
        desc: "The barangay map, its households and hazard zones.",
        children: [
          {
            cat: "action",
            key: "map_edit",
            label: "Map edit mode",
            desc: "Draw, tag and delete on the map. Off, the map is read-only.",
            officer: true,
          },
          {
            cat: "action",
            key: "household_residents",
            label: "Connect residents to households",
            desc: "Add or remove a household's residents, from the map.",
            officer: true,
          },
        ],
      },
      {
        cat: "module",
        key: "accounts",
        label: "Account Claiming",
        desc: "Account applications and the IDs sent with them.",
        children: [
          {
            cat: "action",
            key: "approve_applications",
            label: "Approve account applications",
            desc: "Approve, match or deny an application.",
            officer: true,
          },
        ],
      },
      {
        cat: "module",
        key: "analytics",
        label: "Analytics",
        desc: "Trends and charts. Nothing here changes a record.",
      },
    ],
  },
  {
    label: "Site Content",
    rows: [
      {
        cat: "module",
        key: "content",
        label: "Site Content",
        desc: "Announcements, history, officials and hotlines.",
      },
    ],
  },
  {
    label: "Administration",
    rows: [
      {
        cat: "module",
        key: "users",
        label: "User Management",
        desc: "Accounts, their roles, and this matrix.",
      },
      {
        cat: "module",
        key: "audit",
        label: "Audit Logs",
        desc: "Who did what, and when.",
      },
      {
        cat: "module",
        key: "sms",
        label: "SMS Log",
        desc: "Every text sent, with residents' numbers.",
        children: [
          {
            cat: "sms",
            key: "receive_reports",
            label: "Receive incident reports",
            desc: "Report texts to their own phone, any hour.",
            officer: true,
          },
          {
            cat: "sms",
            key: "text_resident",
            label: "Text a resident",
            desc: "One-off texts from a resident's record.",
            officer: true,
          },
          {
            cat: "sms",
            key: "send_sms_announcements",
            label: "Send announcements by SMS",
            desc: "Texts every resident at once. Spends credits.",
            officer: false,
          },
        ],
      },
      {
        cat: "module",
        key: "archive",
        label: "Archive",
        desc: "Deleted records: restoring them, or destroying them.",
      },
    ],
  },
];

// Every row, flattened, for the lookups that do not care about the layout.
const MATRIX_ROWS = MATRIX_SECTIONS.reduce(function (all, sec) {
  sec.rows.forEach(function (row) {
    all.push(row);
    (row.children || []).forEach(function (child) {
      all.push(child);
    });
  });
  return all;
}, []);

const matrixRowDef = (category, key) =>
  MATRIX_ROWS.find((r) => r.cat === category && r.key === key);

// Built-in module-access defaults per built-in role (custom roles start off).
// `mis` mirrors what the landing page did before this was configurable: staff
// get the MIS link, residents use the public portal.
const DEFAULT_MODULE_ACCESS = {
  officer: { mis: true, dashboard: true, residency: true, certificates: true, incidents: true, feedback: true, gis: true, accounts: true, analytics: true, content: true, users: false, audit: false, archive: false, sms: true },
  resident: { mis: false, dashboard: false, residency: true, certificates: true, incidents: true, feedback: true, gis: true, accounts: true, analytics: false, content: false, users: false, audit: false, archive: false, sms: false },
};

// Editable role columns (Admin is implicit and always full). Built-ins first;
// custom roles appended. Persisted under settings key 'matrix-roles'.
const BUILTIN_ROLES = ["Officer", "Resident"];
let editableRoles = BUILTIN_ROLES.slice();
let modulePerms = {}; // { roleKey: { moduleKey: bool } }
let deletePerms = {}; // { roleKey: { moduleKey: bool } }
let actionPerms = {}; // { roleKey: { actionKey: bool } }
let smsPerms = {}; // { roleKey: { smsRowKey: bool } }

// Which settings key holds each category of row.
const PERM_SETTING = {
  module: "module-access",
  delete: "delete-permissions",
  action: "action-permissions",
  sms: "sms-permissions",
};
const permStore = (category) =>
  category === "module"
    ? modulePerms
    : category === "delete"
      ? deletePerms
      : category === "sms"
        ? smsPerms
        : actionPerms;
// Rows the server refuses to residents whatever is stored: every action row,
// and the SMS Log module (other people's phone numbers).
// Rows the server refuses to residents whatever is stored: every action and
// SMS row, and the SMS Log module. Each one either creates accounts, spends
// credits, or shows another person's phone number — and a report text carries
// a caller's number and where they are.
const residentLocked = (category, role, key) =>
  roleKey(role) === "resident" &&
  (category === "action" || category === "sms" || (category === "module" && key === "sms"));

const roleKey = (role) => String(role).toLowerCase();
const isBuiltinRole = (role) =>
  BUILTIN_ROLES.some((r) => roleKey(r) === roleKey(role));

function isAdminSession() {
  const s = typeof getSession === "function" ? getSession() : null;
  return !!s && s.role === "Admin";
}

async function loadPermissions() {
  try {
    const [roles, mod, del, act, sms] = await Promise.all([
      apiGet("/api/settings/matrix-roles"),
      apiGet("/api/settings/module-access"),
      apiGet("/api/settings/delete-permissions"),
      apiGet("/api/settings/action-permissions"),
      apiGet("/api/settings/sms-permissions"),
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
    actionPerms = act && act.value && typeof act.value === "object" ? act.value : {};
    smsPerms = sms && sms.value && typeof sms.value === "object" ? sms.value : {};
  } catch (e) {
    /* keep defaults — matrix still renders with built-in access */
  }
  renderRoleMatrix();
  // The accounts table above was painted before this landed, and its Change
  // Role dropdown is built from the same list of roles.
  refreshRoleChoices();
}

// Effective access for a role, honoring a stored override then the built-in
// default (module access) or off (delete).
function effectiveAccess(category, role, moduleKey) {
  const rk = roleKey(role);
  if (residentLocked(category, role, moduleKey)) return false;
  const store = permStore(category);
  if (store[rk] && Object.prototype.hasOwnProperty.call(store[rk], moduleKey))
    return store[rk][moduleKey] === true;
  if (category === "module") {
    const def = DEFAULT_MODULE_ACCESS[rk];
    return !!(def && def[moduleKey]);
  }
  if (category === "action" || category === "sms") {
    // Built-in defaults apply to the built-in Officer column only; a custom
    // role starts with every action and SMS row off, and is granted them one
    // at a time.
    const row = matrixRowDef(category, moduleKey);
    return !!(row && rk === "officer" && row.officer);
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

function matrixRow(category, key, label, hint, isChild) {
  const admin = isAdminSession();
  const cells = editableRoles
    .map((role) => {
      const on = effectiveAccess(category, role, key);
      // Locked cells never flip: the server refuses them whatever is stored.
      return permCell(
        on,
        admin && !residentLocked(category, role, key)
          ? `toggleAccess('${category}','${roleKey(role)}','${key}')`
          : null
      );
    })
    .join("");
  const sub = hint
    ? `<div class="perm-row-desc">${escapeHtml(hint)}</div>`
    : "";
  // Admin column is always ✓ and locked; every other role is tappable.
  return `<tr${isChild ? ' class="perm-sub"' : ""}><td><span class="perm-row-label">${escapeHtml(
    label,
  )}</span>${sub}</td>${permCell(true)}${cells}</tr>`;
}

// A section of the table: its heading, its module rows, and under each module
// the actions that live inside it.
function matrixSectionHtml(sec, colCount) {
  const body = sec.rows
    .map(
      (row) =>
        matrixRow(row.cat, row.key, row.label, row.desc) +
        (row.children || [])
          .map((child) => matrixRow(child.cat, child.key, child.label, child.desc, true))
          .join(""),
    )
    .join("");
  return (
    `<tr class="perm-group"><td colspan="${colCount}">${escapeHtml(sec.label)}</td></tr>` + body
  );
}

function renderRoleMatrix() {
  const admin = isAdminSession();
  const addBtn = document.getElementById("matrix-add-role");
  if (addBtn) addBtn.style.display = admin ? "" : "none";

  const help = document.getElementById("role-matrix-help");
  if (help)
    help.textContent = admin
      ? "Laid out like the sidebar. A plain row is a screen the role can open; an indented row is something done inside that screen, and the server enforces those. Tap a ✓ or ✗ to switch one. Use “Add Role” to create a new role column."
      : "Set by an Administrator. Each role's access is shown below — a plain row is a screen, an indented row is something done inside it.";

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
      <thead><tr><th class="text-left">Module &amp; what it allows</th><th>Admin</th>${roleHead}</tr></thead>
      <tbody>
        ${MATRIX_SECTIONS.map((sec) => matrixSectionHtml(sec, editableRoles.length + 2)).join("")}
      </tbody>
    </table>`;
  if (typeof hydrateIcons === "function") hydrateIcons(el);
}

async function toggleAccess(category, rk, moduleKey) {
  if (!isAdminSession()) return;
  const store = permStore(category);
  const settingKey = PERM_SETTING[category];
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
      category === "module"
        ? "MODULE_ACCESS_UPDATE"
        : category === "delete"
          ? "DELETE_PERM_UPDATE"
          : category === "sms"
            ? "SMS_PERM_UPDATE"
            : "ACTION_PERM_UPDATE",
      `${rk} ${category === "module" ? "access to" : category === "delete" ? "delete permission for" : "permission to"} "${moduleKey}" → ${next ? "granted" : "revoked"}`,
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
      hint: "Shown as a column header here and stored with the shared access settings.",
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
  // The new role is assignable the moment it is saved — that is the point of
  // adding one — so the Change Role dropdowns are rebuilt now rather than on
  // the next visit to this page.
  refreshRoleChoices();
  if (typeof logAudit === "function")
    logAudit("ROLE_ADD", `Role "${name}" added to the access matrix`, "warning", "settings");
  if (typeof showToast === "function")
    showToast(`Role "${name}" added — it can now be given to an account`);
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
  delete actionPerms[rk];
  renderRoleMatrix();
  try {
    await Promise.all([
      apiPut("/api/settings/matrix-roles", { value: { roles: editableRoles } }),
      apiPut("/api/settings/module-access", { value: modulePerms }),
      apiPut("/api/settings/delete-permissions", { value: deletePerms }),
      apiPut("/api/settings/action-permissions", { value: actionPerms }),
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
  // Every staff account, not only the Officers: a barangay that added its own
  // role ("Barangay Secretary") would otherwise see those accounts counted
  // nowhere at all. The sub-line names the roles when there are any beyond
  // Officer, so the number can still be taken apart.
  const staff = ACCOUNTS.filter((a) => a.role !== "Admin" && a.role !== "Resident");
  set("kpi-users-staff", staff.length);
  const otherRoles = [...new Set(staff.map((a) => a.role).filter((r) => r !== "Officer"))];
  const staffSub = document.getElementById("kpi-users-staff-sub");
  if (staffSub)
    staffSub.textContent = otherRoles.length
      ? `Officers + ${otherRoles.join(", ")}`
      : "Officers & other staff roles";
  set("kpi-users-res", ACCOUNTS.filter((a) => a.role === "Resident").length);
}

// Narrowing the list restarts it at page one.
function accountFilterChanged() {
  resetPage("users");
  filterAccounts();
}

// The options for one account's Change Role dropdown. A role the account
// already holds that is no longer in the matrix (its column was removed while
// somebody still carried it) is listed anyway, and marked, or the dropdown
// would silently show the wrong role as selected.
function roleOptionsFor(a) {
  const roles = assignableRoles();
  const orphan = a.role && !roles.some((r) => roleKey(r) === roleKey(a.role));
  return (orphan ? [a.role] : [])
    .concat(roles)
    .map((r) => {
      const selected = roleKey(r) === roleKey(a.role) ? " selected" : "";
      // A Resident account is a person's own account: it has to point at a
      // resident record, and the database says so too.
      const blocked = r === "Resident" && !a.resident_id ? " disabled" : "";
      const label = orphan && r === a.role ? `${r} (removed role)` : r;
      return `<option value="${escapeHtml(r)}"${selected}${blocked}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function roleFilterOptionsHtml() {
  return (
    "<option>All Roles</option>" +
    assignableRoles().map((r) => `<option>${escapeHtml(r)}</option>`).join("")
  );
}

// Called once the matrix has loaded, since both lists are built from it and
// the page paints before the fetch lands.
function refreshRoleChoices() {
  const filter = document.getElementById("acct-role");
  if (filter) {
    const keep = filter.value;
    filter.innerHTML = roleFilterOptionsHtml();
    // A filter on a role that has since been removed falls back to all roles.
    filter.value = [...filter.options].some((o) => o.value === keep) ? keep : "All Roles";
  }
  if (ACCOUNTS.length) filterAccounts();
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
            ${roleOptionsFor(a)}
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
        <td><span class="badge ${roleBadge(a.role) || "badge-gray"}">${escapeHtml(a.role)}</span></td>
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
