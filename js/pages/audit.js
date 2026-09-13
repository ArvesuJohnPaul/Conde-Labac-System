// js/pages/audit.js — renders the real audit trail recorded by logAudit()
// (js/audit-log.js) across the system: map editing, resident concerns,
// certificate requests, feedback, login/account claiming, and archive actions.
window.CURRENT_PAGE = "audit";

const AUDIT_CATEGORY_META = {
  map: { label: "Map Editing", badge: "badge-info" },
  // Resident-record actions (view / add / edit / delete) have always been
  // logged under 'resident'; without an entry here they all showed as
  // "System" and could not be filtered.
  resident: { label: "Residents", badge: "badge-gold" },
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
// Inclusive YYYY-MM-DD bounds, "" for open-ended. Unlike the filters above
// these are NOT applied in the browser — changing either re-queries the
// server, because the trail on disk is far larger than the slice held here.
let auditFilterFrom = "";
let auditFilterTo = "";
// True while a dated re-query is in flight, so the table can say so rather
// than showing a stale range as though it were the new one.
let auditLoading = false;

function renderPage() {
  // Local trail first (instant), then re-render once the shared DB trail
  // arrives — that's where the mobile app's and the DB triggers' entries
  // live (see js/audit-log.js).
  renderAudit();
  // The full budget, always — this page IS the trail, so it should never show
  // less than a filtered view of itself would.
  auditFetchServerLogs({ limit: AUDIT_VIEW_MAX }).then((got) => {
    if (got) renderAudit();
  });
}

// ── Date range ─────────────────────────────────────────────────────────────
function auditToday() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

function auditDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

// The presets people actually reach for. "All time" clears both bounds, which
// puts the fetch back on the plain newest-first scroll.
const AUDIT_RANGE_PRESETS = {
  today: () => [auditToday(), auditToday()],
  "7": () => [auditDaysAgo(6), auditToday()],
  "30": () => [auditDaysAgo(29), auditToday()],
  "90": () => [auditDaysAgo(89), auditToday()],
  all: () => ["", ""],
};

function setAuditRangePreset(key) {
  const preset = AUDIT_RANGE_PRESETS[key];
  if (!preset) return; // "custom" — the two date fields drive it instead
  const [from, to] = preset();
  auditFilterFrom = from;
  auditFilterTo = to;
  reloadAuditRange();
}

function setAuditFrom(value) {
  auditFilterFrom = value || "";
  // An inverted range returns nothing and reads as a bug rather than a typo.
  // Push the other end along instead of refusing the input.
  if (auditFilterTo && auditFilterFrom && auditFilterFrom > auditFilterTo)
    auditFilterTo = auditFilterFrom;
  reloadAuditRange();
}

function setAuditTo(value) {
  auditFilterTo = value || "";
  if (auditFilterFrom && auditFilterTo && auditFilterTo < auditFilterFrom)
    auditFilterFrom = auditFilterTo;
  reloadAuditRange();
}

// Which preset the current bounds correspond to, so the selector reflects the
// state after a manual date edit instead of lying about it.
function auditActivePreset() {
  if (!auditFilterFrom && !auditFilterTo) return "all";
  for (const key of ["today", "7", "30", "90"]) {
    const [f, t] = AUDIT_RANGE_PRESETS[key]();
    if (f === auditFilterFrom && t === auditFilterTo) return key;
  }
  return "custom";
}

// "between 1 Jul and 31 Jul" / "on 16 Jul" / "from 1 Jul onwards" — for the
// empty state and the CSV filename, so a range is never reported as a bare
// pair of ISO strings.
function auditRangeLabel() {
  const nice = (s) =>
    new Date(s + "T00:00:00").toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  if (auditFilterFrom && auditFilterTo)
    return auditFilterFrom === auditFilterTo
      ? `on ${nice(auditFilterFrom)}`
      : `between ${nice(auditFilterFrom)} and ${nice(auditFilterTo)}`;
  if (auditFilterFrom) return `from ${nice(auditFilterFrom)} onwards`;
  if (auditFilterTo) return `up to ${nice(auditFilterTo)}`;
  return "in this period";
}

async function reloadAuditRange() {
  auditLoading = true;
  resetPage("audit");
  renderAudit();
  await auditFetchServerLogs({
    from: auditFilterFrom,
    to: auditFilterTo,
    limit: AUDIT_VIEW_MAX,
  });
  auditLoading = false;
  renderAudit();
}

function auditEscapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

// The record an entry touched: "<table> #<id>" for DB-trigger entries, or a
// bare "#<id>" / "—" otherwise. Lets staff see exactly which item changed.
function auditItemLabel(entry) {
  if (entry.recordId == null || entry.recordId === "")
    return '<span class="table-muted">—</span>';
  const table = entry.table
    ? auditEscapeHtml(entry.table) + " "
    : "";
  return `${table}<code class="table-action-code">#${auditEscapeHtml(entry.recordId)}</code>`;
}

// Plain-text version of the record reference, for search + CSV.
function auditItemText(entry) {
  if (entry.recordId == null || entry.recordId === "") return "";
  return (entry.table ? entry.table + " " : "") + "#" + entry.recordId;
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
  // The server already bounded the entries it returned, but the merged trail
  // also carries local entries that never reached it — those have to be held
  // to the same range here, or a browser's own offline history would ignore
  // the filter. Bounds are whole local days, matching the server's.
  const fromTs = auditFilterFrom
    ? new Date(auditFilterFrom + "T00:00:00").getTime()
    : null;
  const toTs = auditFilterTo
    ? new Date(auditFilterTo + "T23:59:59.999").getTime()
    : null;
  return auditAllLogs().filter((entry) => {
    if (fromTs !== null && (entry.ts || 0) < fromTs) return false;
    if (toTs !== null && (entry.ts || 0) > toTs) return false;
    if (auditFilterCategory && entry.category !== auditFilterCategory) return false;
    if (auditFilterLevel && entry.level !== auditFilterLevel) return false;
    if (
      q &&
      !`${entry.user} ${entry.role} ${entry.action} ${entry.details} ${auditItemText(entry)}`
        .toLowerCase()
        .includes(q)
    )
      return false;
    return true;
  });
}

function renderAudit() {
  const logs = auditAllLogs();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const logsToday = logs.filter((l) => l.ts >= dayStart.getTime()).length;
  const critical30d = logs.filter(
    (l) => l.ts >= monthAgo && (l.level === "critical" || l.level === "warning"),
  ).length;
  const lastActivity = logs.length ? auditTimeAgo(logs[0].ts) : "—";

  const preset = auditActivePreset();
  const dated = !!(auditFilterFrom || auditFilterTo);
  // With a range set, "Total Entries" would otherwise count only what that
  // range pulled back while still calling itself a total. Say which it is.
  const totalLabel = dated ? "Entries in Range" : "Total Entries";
  const totalValue = dated ? auditFilteredLogs().length : logs.length;
  const totalSub = dated
    ? auditRangeLabel().replace(/^(on|between|from|up to)/, (m) => m)
    : "";
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
      <div class="kpi-card"><div class="kpi-label">${totalLabel}</div><div class="kpi-value">${totalValue.toLocaleString()}</div>${totalSub ? `<div class="kpi-trend">${auditEscapeHtml(totalSub)}</div>` : ""}</div>
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
      <!-- Filters use the GIS map's pill row (.gis-filter-row / -search-wrap /
           -select in css/gis.css) — the same controls the map, Barangay
           Residency and Certificate Processing use, so the whole MIS reads as
           one system rather than two generations of form controls. -->
      <div class="gis-filter-row">
        <div class="gis-search-wrap">
          ${typeof gisIcon === "function" ? gisIcon("search", "gis-search-icon") : ""}
          <input type="text" class="gis-search-input" autocomplete="off" placeholder="Search user, action, or details…"
            value="${auditEscapeHtml(auditFilterSearch)}" oninput="setAuditSearch(this.value)" />
        </div>
        <select class="gis-filter-select" onchange="setAuditCategory(this.value)">
          <option value="">All Categories</option>
          ${categoryOptions}
        </select>
        <select class="gis-filter-select" onchange="setAuditLevel(this.value)">
          <option value="">All Levels</option>
          <option value="info" ${auditFilterLevel === "info" ? "selected" : ""}>Info</option>
          <option value="warning" ${auditFilterLevel === "warning" ? "selected" : ""}>Warning</option>
          <option value="critical" ${auditFilterLevel === "critical" ? "selected" : ""}>Critical</option>
        </select>
        <!-- The date range sits on its own row: unlike the three filters above
             it does not narrow what is already on screen, it goes back to the
             server for a different stretch of the trail. -->
        <select class="gis-filter-select" onchange="setAuditRangePreset(this.value)">
          <option value="all" ${preset === "all" ? "selected" : ""}>All dates</option>
          <option value="today" ${preset === "today" ? "selected" : ""}>Today</option>
          <option value="7" ${preset === "7" ? "selected" : ""}>Last 7 days</option>
          <option value="30" ${preset === "30" ? "selected" : ""}>Last 30 days</option>
          <option value="90" ${preset === "90" ? "selected" : ""}>Last 90 days</option>
          <option value="custom" ${preset === "custom" ? "selected" : ""} disabled>Custom range</option>
        </select>
        <label class="audit-date-field">
          <span>From</span>
          <input type="date" class="audit-date-input" max="${auditToday()}"
                 value="${auditEscapeHtml(auditFilterFrom)}" onchange="setAuditFrom(this.value)" />
        </label>
        <label class="audit-date-field">
          <span>To</span>
          <input type="date" class="audit-date-input" max="${auditToday()}"
                 value="${auditEscapeHtml(auditFilterTo)}" onchange="setAuditTo(this.value)" />
        </label>
        ${
          auditFilterFrom || auditFilterTo
            ? `<button type="button" class="btn btn-sm btn-outline" onclick="setAuditRangePreset('all')">Clear dates</button>`
            : ""
        }
      </div>
      <div id="audit-table-wrap">
        ${renderAuditTable()}
      </div>
    </div>
  `);
}

// The audit trail is the longest list in the system — it is the one that most
// needed paging. #audit-table-wrap holds the table AND its pager, so a page
// button repaints both without touching the filter row (which would cost the
// search box its focus mid-typing).
function renderAuditTable() {
  if (auditLoading)
    return `<div class="resident-empty">Loading entries for this date range…</div>`;
  const filtered = auditFilteredLogs();
  if (!filtered.length) {
    const anyLogs = auditAllLogs().length > 0;
    const dated = auditFilterFrom || auditFilterTo;
    // "Nothing happened that week" and "nothing matched your search" are
    // different answers, and only one of them means the search was wrong.
    if (anyLogs && dated)
      return `<div class="resident-empty">No entries recorded ${auditRangeLabel()}${
        auditFilterCategory || auditFilterLevel || auditFilterSearch
          ? " matching your other filters"
          : ""
      }.</div>`;
    return `<div class="resident-empty">${
      anyLogs
        ? "No log entries match your filters."
        : "No activity recorded yet. Actions like map edits, certificate requests, resident concerns, feedback, logins, and archive operations will appear here."
    }</div>`;
  }
  const page = paginate("audit", filtered, repaintAuditTable);
  // The one case where the page holds less than the trail does. It is a very
  // large number of entries away, but a compliance record that quietly stops
  // short is worse than one that says where it stopped.
  const truncated =
    typeof auditServerTruncated !== "undefined" && auditServerTruncated
      ? `<div class="modal-help-text" style="margin-bottom:var(--space-2)">
           Showing the newest ${AUDIT_VIEW_MAX.toLocaleString()} entries — the trail holds more.
           Narrow the date range to reach the older ones.
         </div>`
      : "";
  return `
    ${truncated}
    <div class="table-wrap">
    <table class="data-table">
      <thead><tr><th>Timestamp</th><th>User</th><th>Category</th><th>Action</th><th>Item</th><th>Details</th><th>Level</th></tr></thead>
      <tbody>
        ${page.items
          .map((entry) => {
            const catMeta = AUDIT_CATEGORY_META[entry.category] || AUDIT_CATEGORY_META.system;
            const levelBadge = AUDIT_LEVEL_META[entry.level] || "badge-gray";
            return `<tr>
              <td class="table-muted table-nowrap" title="${auditTimeAgo(entry.ts)}">${auditFormatTs(entry.ts)}</td>
              <td class="table-text-sm">${auditEscapeHtml(entry.user)}<div class="table-muted" style="font-size:0.75em;">${auditEscapeHtml(entry.role)}</div></td>
              <td><span class="badge ${catMeta.badge}">${catMeta.label}</span></td>
              <td><code class="table-action-code">${auditEscapeHtml(entry.action)}</code></td>
              <td class="table-text-sm table-nowrap">${auditItemLabel(entry)}</td>
              <td class="table-text-md">${auditEscapeHtml(entry.details)}</td>
              <td><span class="badge ${levelBadge}">${auditEscapeHtml((entry.level || "info").toUpperCase())}</span></td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>
    </div>
    ${page.html}
  `;
}

function repaintAuditTable() {
  const wrap = document.getElementById("audit-table-wrap");
  if (!wrap) return;
  wrap.innerHTML = renderAuditTable();
  if (typeof hydrateIcons === "function") hydrateIcons(wrap);
}

// Filter handlers re-render only the table so the search box keeps focus.
// Each one starts the results over at page one: narrowing the trail while
// parked on page 30 would otherwise land on an empty view.
function setAuditSearch(value) {
  auditFilterSearch = value;
  resetPage("audit");
  repaintAuditTable();
}
function setAuditCategory(value) {
  auditFilterCategory = value;
  resetPage("audit");
  repaintAuditTable();
}
function setAuditLevel(value) {
  auditFilterLevel = value;
  resetPage("audit");
  repaintAuditTable();
}

function exportAuditCsv() {
  const filtered = auditFilteredLogs();
  if (!filtered.length) {
    showToast("No log entries to export", "<i data-icon=download></i>");
    return;
  }
  const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [
    ["Timestamp", "User", "Role", "Category", "Action", "Item", "Details", "Level"],
    ...filtered.map((e) => [
      auditFormatTs(e.ts),
      e.user,
      e.role,
      (AUDIT_CATEGORY_META[e.category] || AUDIT_CATEGORY_META.system).label,
      e.action,
      auditItemText(e),
      e.details,
      e.level,
    ]),
  ];
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  // UTF-8 BOM so Excel opens the file with the right encoding.
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  // Name the file after the range it actually covers — an export of July
// filed under today's date is a filing mistake waiting to happen.
  const span =
    auditFilterFrom || auditFilterTo
      ? `${auditFilterFrom || "start"}_to_${auditFilterTo || "latest"}`
      : new Date().toISOString().slice(0, 10);
  link.download = `audit-log_${span}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
  showToast(`Exported ${filtered.length} log entries`, "<i data-icon=download></i>");
}

async function clearAuditTrail() {
  const total = auditAllLogs().length;
  if (!total) {
    showToast("There is nothing to clear", "<i data-icon=info></i>");
    return;
  }
  const ok = await uiConfirm({
    icon: "triangle-alert",
    title: "Clear the audit trail?",
    message:
      "This is the barangay's compliance record under RA 10173. The entries are deleted from the database — not hidden — but they are kept in the Archive for 90 days first, so this is recoverable until then.",
    target: {
      icon: "clipboard",
      label: `${total.toLocaleString()} entr${total === 1 ? "y" : "ies"} currently visible`,
    },
    notes: [
      {
        icon: "archive",
        text: "Everything is moved to the Archive as one batch, where an Administrator can restore all of it.",
      },
      {
        icon: "clock",
        text: "After 90 days the Archive copy is permanently deleted, automatically. The Archive page counts down to the date.",
      },
      {
        icon: "flag",
        text: "The wipe itself is logged with your name, and survives this and every future clear.",
      },
    ],
    confirmLabel: "Clear Logs",
    confirmIcon: "trash",
  });
  if (!ok) return;

  const session = getSession() || {};
  // The server writes the AUDIT_CLEAR marker itself, inside the same
  // transaction as the delete — logging one from here too would double it,
  // and a marker written outside that transaction could survive a rollback.
  const result = await auditClearLogs({
    accountId: session.account_id || null,
    name: session.displayName || session.user || null,
    role: session.role || null,
  });
  if (!result) {
    showToast(
      "Could not reach the server — nothing was cleared.",
      "<i data-icon=triangle-alert></i>",
    );
    return;
  }
  // Re-pull rather than repaint from memory: the rows are gone server-side.
  await auditFetchServerLogs({ limit: AUDIT_VIEW_MAX });
  resetPage("audit");
  renderAudit();
  const due = new Date(result.purge_after).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  showToast(
    `${(result.cleared || 0).toLocaleString()} entries moved to the Archive — recoverable until ${due}`,
    "<i data-icon=archive></i>",
  );
}
