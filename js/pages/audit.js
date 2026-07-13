// js/pages/audit.js — renders the real audit trail recorded by logAudit()
// (js/audit-log.js) across the system: map editing, resident concerns,
// certificate requests, feedback, login/account claiming, and archive actions.
window.CURRENT_PAGE = "audit";

const AUDIT_CATEGORY_META = {
  map: { label: "Map Editing", badge: "badge-info" },
  concern: { label: "Resident Concerns", badge: "badge-warning" },
  certificate: { label: "Certificates", badge: "badge-gold" },
  feedback: { label: "Feedback", badge: "badge-success" },
  auth: { label: "Login & Accounts", badge: "badge-gray" },
  archive: { label: "Archive", badge: "badge-gray" },
  settings: { label: "Site Settings", badge: "badge-info" },
  system: { label: "System", badge: "badge-gray" },
};

const AUDIT_LEVEL_META = {
  info: "badge-info",
  warning: "badge-warning",
  critical: "badge-danger",
};

let auditFilterCategory = "";
let auditFilterLevel = "";
let auditFilterSearch = "";

function renderPage() {
  renderAudit();
}

function auditEscapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

function auditFormatTs(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function auditTimeAgo(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function auditFilteredLogs() {
  const q = auditFilterSearch.toLowerCase();
  return auditGetLogs().filter((entry) => {
    if (auditFilterCategory && entry.category !== auditFilterCategory) return false;
    if (auditFilterLevel && entry.level !== auditFilterLevel) return false;
    if (
      q &&
      !`${entry.user} ${entry.role} ${entry.action} ${entry.details}`.toLowerCase().includes(q)
    )
      return false;
    return true;
  });
}

function renderAudit() {
  const logs = auditGetLogs();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const logsToday = logs.filter((l) => l.ts >= dayStart.getTime()).length;
  const critical30d = logs.filter(
    (l) => l.ts >= monthAgo && (l.level === "critical" || l.level === "warning"),
  ).length;
  const lastActivity = logs.length ? auditTimeAgo(logs[0].ts) : "—";

  const categoryOptions = Object.entries(AUDIT_CATEGORY_META)
    .map(
      ([key, meta]) =>
        `<option value="${key}" ${auditFilterCategory === key ? "selected" : ""}>${meta.label}</option>`,
    )
    .join("");

  setContent(`
    <div class="page-header"><h2 class="page-title">Audit Logs</h2><p class="page-desc">System activity, compliance tracking, and data access records</p></div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Logs Today</div><div class="kpi-value">${logsToday}</div></div>
      <div class="kpi-card danger"><div class="kpi-label">Warnings & Critical (30d)</div><div class="kpi-value">${critical30d}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Entries</div><div class="kpi-value">${logs.length}</div></div>
      <div class="kpi-card success"><div class="kpi-label">Last Activity</div><div class="kpi-value table-text-sm">${lastActivity}</div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">System Activity Log</div>
        <div class="btn-group">
          <button class="btn btn-sm btn-outline" onclick="exportAuditCsv()"><i data-icon=download></i> Export CSV</button>
          <button class="btn btn-sm btn-outline" onclick="clearAuditTrail()"><i data-icon=trash></i> Clear Logs</button>
        </div>
      </div>
      <div class="filter-row">
        <input type="text" class="form-control filter-input" placeholder="Search user, action, or details..."
          value="${auditEscapeHtml(auditFilterSearch)}" oninput="setAuditSearch(this.value)" />
        <select class="form-control filter-select" onchange="setAuditCategory(this.value)">
          <option value="">All Categories</option>
          ${categoryOptions}
        </select>
        <select class="form-control filter-select" onchange="setAuditLevel(this.value)">
          <option value="">All Levels</option>
          <option value="info" ${auditFilterLevel === "info" ? "selected" : ""}>Info</option>
          <option value="warning" ${auditFilterLevel === "warning" ? "selected" : ""}>Warning</option>
          <option value="critical" ${auditFilterLevel === "critical" ? "selected" : ""}>Critical</option>
        </select>
      </div>
      <div class="table-wrap" id="audit-table-wrap">
        ${renderAuditTable()}
      </div>
    </div>
  `);
}

function renderAuditTable() {
  const filtered = auditFilteredLogs();
  if (!filtered.length) {
    const anyLogs = auditGetLogs().length > 0;
    return `<div class="resident-empty">${
      anyLogs
        ? "No log entries match your filters."
        : "No activity recorded yet. Actions like map edits, certificate requests, resident concerns, feedback, logins, and archive operations will appear here."
    }</div>`;
  }
  return `
    <table class="data-table">
      <thead><tr><th>Timestamp</th><th>User</th><th>Category</th><th>Action</th><th>Details</th><th>Level</th></tr></thead>
      <tbody>
        ${filtered
          .map((entry) => {
            const catMeta = AUDIT_CATEGORY_META[entry.category] || AUDIT_CATEGORY_META.system;
            const levelBadge = AUDIT_LEVEL_META[entry.level] || "badge-gray";
            return `<tr>
              <td class="table-muted table-nowrap" title="${auditTimeAgo(entry.ts)}">${auditFormatTs(entry.ts)}</td>
              <td class="table-text-sm">${auditEscapeHtml(entry.user)}<div class="table-muted" style="font-size:0.75em;">${auditEscapeHtml(entry.role)}</div></td>
              <td><span class="badge ${catMeta.badge}">${catMeta.label}</span></td>
              <td><code class="table-action-code">${auditEscapeHtml(entry.action)}</code></td>
              <td class="table-text-md">${auditEscapeHtml(entry.details)}</td>
              <td><span class="badge ${levelBadge}">${auditEscapeHtml((entry.level || "info").toUpperCase())}</span></td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

// Filter handlers re-render only the table so the search box keeps focus.
function setAuditSearch(value) {
  auditFilterSearch = value;
  document.getElementById("audit-table-wrap").innerHTML = renderAuditTable();
}
function setAuditCategory(value) {
  auditFilterCategory = value;
  document.getElementById("audit-table-wrap").innerHTML = renderAuditTable();
}
function setAuditLevel(value) {
  auditFilterLevel = value;
  document.getElementById("audit-table-wrap").innerHTML = renderAuditTable();
}

function exportAuditCsv() {
  const filtered = auditFilteredLogs();
  if (!filtered.length) {
    showToast("No log entries to export", "<i data-icon=download></i>");
    return;
  }
  const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [
    ["Timestamp", "User", "Role", "Category", "Action", "Details", "Level"],
    ...filtered.map((e) => [
      auditFormatTs(e.ts),
      e.user,
      e.role,
      (AUDIT_CATEGORY_META[e.category] || AUDIT_CATEGORY_META.system).label,
      e.action,
      e.details,
      e.level,
    ]),
  ];
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  // UTF-8 BOM so Excel opens the file with the right encoding.
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `audit-log_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
  showToast(`Exported ${filtered.length} log entries`, "<i data-icon=download></i>");
}

function clearAuditTrail() {
  if (!confirm("Clear all audit log entries? This cannot be undone.")) return;
  auditClearLogs();
  // The wipe itself is an auditable event — record it as the first entry of
  // the fresh trail.
  logAudit("AUDIT_CLEAR", "Audit log cleared by administrator", "critical", "system");
  renderAudit();
  showToast("Audit log cleared", "<i data-icon=trash></i>");
}
