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
// How many entries this browser keeps in localStorage. A hard ceiling, not a
// preference: localStorage is a few megabytes for the whole origin.
const AUDIT_LOG_MAX = 500;
// How many entries the merged view may hold. Separate from the storage cap
// above — a date-filtered query pulls far more from the server than this
// browser would ever keep for itself, and truncating it to the storage cap
// would silently drop the older half of the month being examined.
//
// This used to be 2,000, which was also the server's per-response ceiling: the
// Audit Logs page therefore stopped dead at 2,000 entries and quietly claimed
// that was the whole trail. It is now a safety stop far above any single
// response, reached by paging (see auditFetchServerLogs), and the page says so
// out loud on the rare occasion it is hit.
const AUDIT_VIEW_MAX = 50000;
// One request's worth. The server caps a single response here too, so asking
// for more in one go would silently get this anyway.
const AUDIT_FETCH_PAGE = 2000;
// True when the last fetch stopped at AUDIT_VIEW_MAX with rows still to come —
// the one case where the page is showing less than the trail holds.
let auditServerTruncated = false;

// "Clear Logs" cutoff for the shared DB trail: the server is append-only,
// so a clear hides everything at or before this instant (same approach as
// the mobile app's AuditLog.clear()).
const AUDIT_CLEARED_AT_KEY = "ibmdss.audit_cleared_at";

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

// Clears the trail for real: the server snapshots every entry into the
// Archive as one batch, DELETES it from audit_log, and starts a 90-day
// countdown on the snapshot (POST /api/audit/clear). This browser's own
// localStorage copy is wiped to match.
//
// It used to only set a client-side cutoff and hide rows. That kept the
// database honest but left the barangay unable to actually dispose of an
// audit trail, and let each device disagree with the others about what
// existed. The rows are still recoverable — from the Archive, for 90 days,
// by an administrator — which is the part that made hiding feel safer.
//
// Resolves to the server's { cleared, purge_after, retention_days }, or null
// if the API could not be reached (in which case nothing was deleted anywhere
// and the caller must say so).
async function auditClearLogs(actor) {
  if (typeof apiPost !== "function") return null;
  const a = actor || {};
  let result;
  try {
    result = await apiPost("/api/audit/clear", {
      account_id: a.accountId || null,
      actor_name: a.name || null,
      actor_role: a.role || null,
    });
  } catch (e) {
    return null; // nothing was cleared — leave the local copy alone too
  }

  // Only now the local trail, so a failed server call cannot leave this
  // browser blank while every other device still shows the entries.
  // The protected AUDIT_CLEAR markers stay: the record of every previous wipe.
  try {
    const keep = auditGetLogs().filter((e) => e.action === AUDIT_CLEAR_ACTION);
    localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(keep));
  } catch (e) {
    localStorage.removeItem(AUDIT_LOG_KEY);
  }
  // Local-only entries that never reached the server are hidden by this — the
  // server has no rows to delete on their behalf.
  try {
    localStorage.setItem(AUDIT_CLEARED_AT_KEY, String(Date.now()));
  } catch (e) {
    /* best-effort */
  }
  // The deleted rows are gone from the server, so the cached copy of them and
  // the cutoff derived from it are both stale.
  auditServerLogs = null;
  auditServerCutoff = 0;
  return result;
}

// ───────── Shared DB trail (GET /api/audit) ─────────
// The web mirrors its own entries into the DB (see logAudit below), and the
// mobile app + DB triggers write there directly — so the server is the one
// place that has EVERYONE's activity. The audit page fetches it and merges
// it over the local trail (which covers offline sessions / failed pushes).

let auditServerLogs = null; // null until a fetch has succeeded

function auditClearedAtTs() {
  try {
    const raw = localStorage.getItem(AUDIT_CLEARED_AT_KEY);
    const ts = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(ts) ? ts : 0;
  } catch (e) {
    return 0;
  }
}

// Latest "Clear Logs" moment recorded on the shared trail (by either the web
// or the mobile app — both post an AUDIT_CLEAR marker when clearing). Using it
// as a cutoff is what makes a clear on one client hide entries on the other.
//
// Answered by the server (GET /api/audit/cutoff), which can see the whole
// table. This used to be inferred by scanning the fetched rows for a marker,
// which quietly stopped working as soon as enough entries accumulated on top
// of the newest clear — and a date filter, which moves the fetch window off
// "newest" entirely, would have broken it outright.
let auditServerCutoff = 0;

function auditServerClearCutoff() {
  return auditServerCutoff;
}

async function auditFetchClearCutoff() {
  if (typeof apiGet !== "function") return 0;
  try {
    const r = await apiGet("/api/audit/cutoff");
    auditServerCutoff = (r && r.cleared_at) || 0;
  } catch (e) {
    /* unreachable API — keep whatever we last knew */
  }
  return auditServerCutoff;
}

// The effective cutoff is the later of this browser's own clear and any
// clear recorded on the shared trail.
function auditEffectiveClearCutoff() {
  return Math.max(auditClearedAtTs(), auditServerClearCutoff());
}

// Server entries used to be filtered against the clear cutoff, because a clear
// only hid them. It now DELETES them (POST /api/audit/clear), so a row that
// comes back from the API is a row that was not cleared — its existence is the
// answer, and re-checking it against a cutoff is not just redundant but wrong:
// restoring a batch from the Archive puts entries back that are, by
// definition, older than the clear that took them, and the cutoff would hide
// every one of them again. The only rule left is the markers' own 90-day
// expiry, which is a display rule and not about clearing at all.
function auditServerEntryVisible(e) {
  if (e.action === AUDIT_CLEAR_ACTION)
    return Date.now() - (e.ts || 0) <= AUDIT_CLEAR_RETENTION_MS;
  return true;
}

// Pulls the shared trail. Resolves to the mapped list, or null when the API
// is unreachable (the caller just keeps showing the local trail).
//
// opts: { from, to, limit } — inclusive YYYY-MM-DD bounds passed straight to
// the API. The date range is applied server-side on purpose: the browser only
// ever holds a slice of a table with thousands of rows in it, so a range
// filtered here could only ever search that slice.
//
// `limit` is the caller's to choose because the two callers want different
// things: the Audit Logs page is the whole point of the trail and asks for the
// full budget, while the dashboard renders five lines of Recent Activity and
// has no use for two thousand rows. It must NOT be derived from whether a date
// range was given — that made "All dates" the narrowest option on the page,
// fetching 200 rows where "Last 90 days" fetched 2,000.
// `limit` is how many entries the caller wants in total, NOT how many the
// server may return at once: anything above one page is collected by walking
// `offset` until the trail runs dry. That is what makes the 2,001st entry
// reachable — the server will never send it in a first response.
async function auditFetchServerLogs(opts) {
  if (typeof apiGet !== "function") return null;
  const o = opts || {};
  const want = Math.min(Math.max(o.limit || 200, 1), AUDIT_VIEW_MAX);
  const mapRow = (r) => ({
    ts: new Date(r.created_at).getTime() || 0,
    user: r.actor || "System",
    role: r.role || "System",
    action: r.action || "UNKNOWN",
    details: r.details || "",
    level: r.level || "info",
    category: r.category || "system",
    // Which row the entry touched (trigger entries carry these; app-level
    // entries leave them null). Surfaced in the Audit page's Item column.
    table: r.table_name || null,
    recordId: r.record_id != null ? String(r.record_id) : null,
  });

  // One page of the same query. The date bounds ride along on every request,
  // or page two would be a page of a different question.
  const fetchPage = async (limit, offset) => {
    const params = [`limit=${limit}`, `offset=${offset}`];
    if (o.from) params.push(`from=${encodeURIComponent(o.from)}`);
    if (o.to) params.push(`to=${encodeURIComponent(o.to)}`);
    const rows = await apiGet("/api/audit?" + params.join("&"));
    return Array.isArray(rows) ? rows : [];
  };

  try {
    // The cutoff is a separate, whole-table question — see above.
    await auditFetchClearCutoff();
    const collected = [];
    while (collected.length < want) {
      const size = Math.min(AUDIT_FETCH_PAGE, want - collected.length);
      const list = await fetchPage(size, collected.length);
      collected.push.apply(collected, list.map(mapRow));
      if (list.length < size) break; // short page = end of the trail
    }
    // Filled the budget exactly: only asking for one more row can tell the
    // difference between "that is all of it" and "there is more we stopped
    // short of", and the page says something different in each case.
    auditServerTruncated = false;
    if (collected.length >= want) {
      try {
        auditServerTruncated = (await fetchPage(1, want)).length > 0;
      } catch (e) {
        /* leave it false — a failed probe is not evidence of more */
      }
    }
    auditServerLogs = collected;
    return auditServerLogs;
  } catch (e) {
    return null;
  }
}

// The combined trail the audit page renders: the server list (everyone's
// entries) plus any local entries that never reached the server. Local
// duplicates of mirrored entries are dropped by a fuzzy match (same
// action/details/user within 15s — the mirror POST happens right away, but
// server and browser clocks can differ slightly).
function auditAllLogs() {
  // The cutoff still governs LOCAL entries, and only them. A clear performed
  // on another device deletes the shared rows, but it cannot reach into this
  // browser's localStorage — so entries that never made it to the server, or
  // whose mirror copy has since been cleared, are held to the cutoff here.
  // Clear markers always stay.
  const cutoff = auditEffectiveClearCutoff();
  const local = auditGetLogs().filter(
    (e) => e.action === AUDIT_CLEAR_ACTION || (e.ts || 0) > cutoff,
  );
  if (!auditServerLogs) return local;
  const server = auditServerLogs.filter(auditServerEntryVisible);
  const merged = server.slice();
  local.forEach((l) => {
    const mirrored = server.some(
      (s) =>
        s.action === l.action &&
        s.details === l.details &&
        s.user === l.user &&
        Math.abs((s.ts || 0) - (l.ts || 0)) < 15000,
    );
    if (!mirrored) merged.push(l);
  });
  merged.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return merged.slice(0, AUDIT_VIEW_MAX);
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
