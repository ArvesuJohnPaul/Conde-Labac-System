// js/audit-log.js — shared audit-trail store (localStorage).
// Loaded on every page BEFORE the scripts that record entries, so any module
// can call logAudit() the moment a user action lands. Entries are read back
// by the Audit Logs page (js/pages/audit.js).
//
// Entry shape: { ts, user, role, action, details, level, category }
//   ts       — epoch millis
//   user     — display name from the active session ("Guest" when signed out)
//   role     — Admin | Officer | Resident | Visitor
//   action   — short machine code, e.g. "CERT_REQUEST", "MAP_BUILDING_DELETE"
//   details  — human-readable one-liner of what happened
//   level    — "info" | "warning" | "critical"
//   category — "map" | "concern" | "certificate" | "feedback" | "auth" | "archive" | "settings"

const AUDIT_LOG_KEY = "ibmdss.audit_log";
const AUDIT_LOG_MAX = 500;

// "Logs were cleared" marker entries: immune to clearing (every wipe must
// stay on record) but expire on their own after 90 days.
const AUDIT_CLEAR_ACTION = "AUDIT_CLEAR";
const AUDIT_CLEAR_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function auditGetLogs() {
  try {
    const raw = localStorage.getItem(AUDIT_LOG_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    // Expired clear markers drop off the trail on read.
    return list.filter(
      (e) =>
        e.action !== AUDIT_CLEAR_ACTION ||
        Date.now() - (e.ts || 0) <= AUDIT_CLEAR_RETENTION_MS,
    );
  } catch (e) {
    return [];
  }
}

function auditClearLogs() {
  // A clear never removes the protected AUDIT_CLEAR markers — the record of
  // every previous wipe (within its 90-day retention) survives.
  try {
    const keep = auditGetLogs().filter((e) => e.action === AUDIT_CLEAR_ACTION);
    localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(keep));
  } catch (e) {
    localStorage.removeItem(AUDIT_LOG_KEY);
  }
}

// Records one audit entry. Never throws — auditing must not break the action
// being audited (e.g. localStorage full or disabled).
function logAudit(action, details, level = "info", category = "system") {
  let accountId = null;
  try {
    let user = "Guest";
    let role = "Visitor";
    try {
      const session = JSON.parse(localStorage.getItem("ibmdss.session"));
      if (session) {
        user = session.displayName || session.user || "User";
        role = session.role || role;
        accountId = session.account_id || null;
      }
    } catch (e) {
      /* stay Guest */
    }
    const list = auditGetLogs();
    list.unshift({
      ts: Date.now(),
      user,
      role,
      action: String(action || "UNKNOWN"),
      details: String(details == null ? "" : details),
      level,
      category,
    });
    if (list.length > AUDIT_LOG_MAX) list.length = AUDIT_LOG_MAX;
    localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(list));

    // Mirror the entry into the shared DB trail (POST /api/audit) so web
    // actions show up alongside the mobile app's and the DB triggers'.
    // Fire-and-forget: a failed push only means the entry stays local.
    if (typeof apiPost === "function") {
      apiPost("/api/audit", {
        action: String(action || "UNKNOWN"),
        details: String(details == null ? "" : details),
        level: level,
        category: category,
        actor_name: user,
        actor_role: role,
        account_id: accountId,
      }).catch(() => {});
    }
  } catch (e) {
    /* auditing is best-effort */
  }
}
