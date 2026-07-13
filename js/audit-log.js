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

function auditGetLogs() {
  try {
    const raw = localStorage.getItem(AUDIT_LOG_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function auditClearLogs() {
  localStorage.removeItem(AUDIT_LOG_KEY);
}

// Records one audit entry. Never throws — auditing must not break the action
// being audited (e.g. localStorage full or disabled).
function logAudit(action, details, level = "info", category = "system") {
  try {
    let user = "Guest";
    let role = "Visitor";
    try {
      const session = JSON.parse(localStorage.getItem("ibmdss.session"));
      if (session) {
        user = session.displayName || session.user || "User";
        role = session.role || role;
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
  } catch (e) {
    /* auditing is best-effort */
  }
}
