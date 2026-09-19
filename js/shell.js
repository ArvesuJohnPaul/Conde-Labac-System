// ════════════════════ STATE ════════════════════
let currentRole = "Admin";
let currentModule = "dashboard";
let charts = {};
let accStep = 1;
let selectedCert = "Barangay Clearance";
// 0 = nothing chosen. The modal used to open with four stars lit, which meant
// every submission from someone who never touched the control was recorded as
// "Good" — and the Feedback page's average rating, and the sentiment split
// beside it, were partly built out of opinions nobody gave. A rating is now
// something the resident hands over, and submitting without one is refused.
let feedbackRating = 0;
const SESSION_KEY = "ibmdss.session";

function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch (e) {
    return null;
  }
}

function setSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// ════════════════════ LOGIN ════════════════════
// Real sign-in lives on system.html (POST /api/auth/login — the DB decides the
// role). This stub only exists in case stale markup still calls doLogin().
function doLogin() {
  window.location.href = "../system.html";
}

function applySessionToApp(session) {
  if (!session) {
    // Not logged in — redirect to login
    window.location.href = "../system.html";
    return;
  }

  const ls = document.getElementById("login-screen");
  const app = document.getElementById("app");
  const sidebar = document.getElementById("sidebar");
  const topbar = document.getElementById("topbar");
  const main = document.getElementById("main");

  if (ls) ls.classList.add("hidden");
  if (app) app.style.display = "flex";

  currentRole = session.role || currentRole;
  const displayName = session.displayName || "User";
  const init = session.initials || "U";
  const shortName = session.shortName || displayName;

  // Update navbar user pill (desktop)
  const navPill = document.getElementById("nav-user-pill");
  if (navPill) navPill.style.display = "flex";
  const navName = document.getElementById("nav-user-name");
  if (navName) navName.textContent = shortName;

  // Update navbar user menu (mobile)
  const navUserMenu = document.getElementById("nav-user-menu");
  if (navUserMenu) navUserMenu.classList.remove("is-hidden");
  const navAvatar = document.getElementById("nav-avatar");
  if (navAvatar) navAvatar.textContent = init;
  const navAvatarLg = document.getElementById("nav-avatar-lg");
  if (navAvatarLg) navAvatarLg.textContent = init;
  // Initials are the placeholder; the real profile photo replaces them once
  // it has been fetched (loadSessionAvatar, js/account-edit.js).
  if (typeof loadSessionAvatar === "function") loadSessionAvatar(session);
  const navUserNameFull = document.getElementById("nav-user-name-full");
  if (navUserNameFull) navUserNameFull.textContent = displayName;
  const navUserRole = document.getElementById("nav-user-role");
  if (navUserRole) {
    navUserRole.textContent =
      currentRole === "Admin"
        ? "System Admin"
        : currentRole === "Officer"
          ? "Barangay Officer"
          : "Resident";
  }

  // Update sidebar user info
  const sideUser = document.getElementById("sidebar-user");
  if (sideUser) sideUser.textContent = displayName;
  const sideRole = document.getElementById("sidebar-role");
  if (sideRole)
    sideRole.textContent =
      currentRole === "Admin"
        ? "System Admin"
        : currentRole === "Officer"
          ? "Barangay Officer"
          : "Resident";
  const sideAvatar = document.getElementById("sidebar-avatar");
  if (sideAvatar) sideAvatar.textContent = init;

  // Set topbar date
  const d = new Date();
  const dateStr = d.toLocaleDateString("en-PH", {
    weekday: "short",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const topbarDate = document.getElementById("topbar-date");
  if (topbarDate) topbarDate.textContent = dateStr;

  // Set topbar title from current page
  if (window.CURRENT_PAGE && moduleConfig[window.CURRENT_PAGE]) {
    const cfg = moduleConfig[window.CURRENT_PAGE];
    const topbarTitle = document.getElementById("topbar-title");
    if (topbarTitle) topbarTitle.textContent = cfg.title;
    const topbarSub = document.getElementById("topbar-sub");
    if (topbarSub) topbarSub.textContent = cfg.sub;
  }

  // Highlight correct sidebar nav item
  if (window.CURRENT_PAGE) {
    document.querySelectorAll(".nav-item").forEach((n) => {
      n.classList.remove("active");
      const oc = n.getAttribute("onclick") || "";
      if (oc.includes(`'${window.CURRENT_PAGE}'`)) {
        n.classList.add("active");
      }
    });
  }

  if (currentRole === "Resident") {
    // Resident: no module sidebar, but the topbar stays — it carries the user
    // menu, and with it the only route to Settings and Sign out. Hiding it
    // (as this used to) left a resident who landed here with no way out but
    // the browser's back button.
    if (sidebar) sidebar.classList.add("hidden");
    if (topbar) topbar.style.display = "flex";
    if (main) main.classList.remove("with-sidebar");
    // The sidebar toggle has nothing to toggle without a sidebar.
    const sideBtn = document.getElementById("sidebarToggle");
    if (sideBtn) sideBtn.style.display = "none";
    const servLi = document.getElementById("nav-services-li");
    if (servLi) servLi.style.display = "";
    const dashLi = document.getElementById("nav-dashboard-li");
    if (dashLi) dashLi.style.display = "none";
    renderResidentPortal();
  } else {
    // Admin / Officer: show sidebar and topbar
    if (sidebar) sidebar.classList.remove("hidden");
    if (topbar) topbar.style.display = "flex";
    if (main) main.classList.add("with-sidebar");
    const servLi = document.getElementById("nav-services-li");
    if (servLi) servLi.style.display = "none";
    const dashLi = document.getElementById("nav-dashboard-li");
    if (dashLi) dashLi.style.display = "";
    // Page content rendered by each page's renderPage()
  }
}

// The session-avatar helpers (loadSessionAvatar / paintSessionAvatar /
// clearSessionAvatarCache) live in js/account-edit.js — the landing page
// paints the same avatar and does not load this file, so they belong in one
// both pages already carry. Called through typeof guards below.

function doLogout() {
  const session = getSession();
  // Log before the session is cleared so the entry still knows who left.
  if (typeof logAudit === "function")
    logAudit("LOGOUT", `${session?.displayName || "User"} signed out`, "info", "auth");
  clearSession();
  // The cached avatar is another person's face on a shared machine — it goes
  // with the session, not with the browser.
  if (typeof clearSessionAvatarCache === "function") clearSessionAvatarCache();
  window.location.href = "../index.html";
}

// ════════════════════ USER MENU DROPDOWN ════════════════════
function initializeUserMenu() {
  const trigger = document.getElementById("nav-user-trigger");
  const dropdown = document.getElementById("nav-user-dropdown");

  if (!trigger || !dropdown) return;

  trigger.addEventListener("click", function (e) {
    e.stopPropagation();
    dropdown.classList.toggle("open");
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", function (e) {
    if (!trigger.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.remove("open");
    }
  });
}

// ════════════════════ TOPBAR MODULES MENU ════════════════════
function initializeTopbarModulesMenu() {
  const trigger = document.getElementById("topbarModulesTrigger");
  const dropdown = document.getElementById("topbarModulesDropdown");

  if (!trigger || !dropdown) return;

  trigger.addEventListener("click", function (e) {
    e.stopPropagation();
    dropdown.classList.toggle("open");
  });

  // Close dropdown when clicking a module item
  const moduleItems = dropdown.querySelectorAll(".topbar-module-item");
  moduleItems.forEach((item) => {
    item.addEventListener("click", function () {
      dropdown.classList.remove("open");
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", function (e) {
    if (!trigger.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.remove("open");
    }
  });
}

// Call this after DOM is ready
document.addEventListener("DOMContentLoaded", function () {
  initializeUserMenu();
  initializeTopbarModulesMenu();
});

function scrollToServices(e) {
  e.preventDefault();
  document
    .getElementById("services-section")
    ?.scrollIntoView({ behavior: "smooth" });
}

// ════════════════════ NAVIGATION (Admin/Officer) ════════════════════
const moduleConfig = {
  dashboard: { title: "Dashboard", sub: "Overview & KPIs" },
  residency: {
    title: "Barangay Residency",
    sub: "Resident records & search",
  },
  certificates: {
    title: "Certificate Processing",
    sub: "Request management",
  },
  incidents: {
    title: "Blotter / Incidents",
    sub: "Emergency logging & tracking",
  },
  feedback: { title: "Feedback", sub: "Resident sentiment & trends" },
  gis: { title: "GIS Mapping", sub: "Interactive zone & hazard view" },
  accounts: {
    title: "Account Claiming",
    sub: "Resident registration & verification",
  },
  analytics: {
    title: "Analytics",
    sub: "Predictive insights & trend charts",
  },
  content: {
    title: "Site Content",
    sub: "Announcements & barangay officials",
  },
  users: { title: "User Management", sub: "Roles & access control" },
  audit: { title: "Audit Logs", sub: "System activity & compliance" },
  archive: { title: "Archive", sub: "Records retention & backup" },
};

// Page map for cross-page navigation
const PAGE_MAP = {
  dashboard: "dashboard.html",
  residency: "residency.html",
  certificates: "certificates.html",
  incidents: "incidents.html",
  feedback: "feedback.html",
  gis: "gis.html",
  accounts: "accounts.html",
  analytics: "analytics.html",
  content: "content.html",
  users: "users.html",
  audit: "audit.html",
  archive: "archive.html",
};

// Module permission matrix (RBAC enforcement on client-side navigation)
const modulePermissions = {
  dashboard: ["Admin", "Officer"],
  residency: ["Admin", "Officer", "Resident"],
  certificates: ["Admin", "Officer", "Resident"],
  incidents: ["Admin", "Officer", "Resident"],
  feedback: ["Admin", "Officer", "Resident"],
  gis: ["Admin", "Officer", "Resident"],
  accounts: ["Admin", "Officer", "Resident"],
  analytics: ["Admin", "Officer"],
  content: ["Admin", "Officer"],
  users: ["Admin"],
  audit: ["Admin"],
  archive: ["Admin"],
};

// Officer module-access overrides (settings key 'module-access'), set from
// the User Management Role Access Matrix. null until loaded; an entry present
// means an Admin explicitly granted/revoked that module for Officers,
// overriding the built-in default in modulePermissions.
let moduleAccessOverrides = null;

async function loadModuleAccess() {
  if (typeof loadMisAccessMap !== "function") return;
  // One fetch for the whole matrix, shared with js/mis-access.js — the "may
  // this role open the MIS at all?" row lives in the same settings blob as
  // these per-module rows.
  const map = await loadMisAccessMap();
  moduleAccessOverrides = (map && map.officer) || {};
  enforceMisAccess(map);
  applyOfficerModuleVisibility();
}

// The "MIS Access" matrix row, enforced. Revoking it hides the MIS link on the
// landing page; this is the other half — typing a pages/ URL by hand, or
// sitting on an open tab when the access is taken away, ends the same way.
//
// Residents are exempt: for them these pages render the legacy resident portal
// (renderResidentPortal), not the staff MIS, so the row governs their landing-
// page link only.
function enforceMisAccess(map) {
  const session = getSession();
  const role = session ? session.role : null;
  if (!role || role === "Resident") return;
  if (misAccessFromMap(map, role)) return;
  showToast(
    "MIS access has been withdrawn for your role.",
    "<i data-icon=flag></i>"
  );
  setTimeout(() => {
    window.location.href = "../index.html";
  }, 1200);
}

// Effective access decision for one module + role, honoring Officer overrides.
function moduleAllowedFor(module, role) {
  const base = modulePermissions[module];
  const baseHas = base ? base.indexOf(role) !== -1 : true;
  if (role !== "Officer") return baseHas;
  const def = base ? base.indexOf("Officer") !== -1 : false;
  if (
    moduleAccessOverrides &&
    Object.prototype.hasOwnProperty.call(moduleAccessOverrides, module)
  ) {
    return moduleAccessOverrides[module] === true;
  }
  return def;
}

// ════════════════ DIALOGS (confirm / prompt) ════════════════
// uiConfirm() / uiPrompt() live in js/ui-modals.js — the landing page needs
// them too (the certificate request asks before filing without documents),
// and it does not load this file.

// ════════════════ RECORD DELETION (shared) ════════════════
// Every MIS module that lists records offers a per-row Delete. Deleting never
// destroys anything: the server snapshots the row into the shared `archive`
// table (archive-service.js) and either flips its status or lifts the row out,
// so the Archive page can restore it. Three things therefore have to happen on
// every delete, and they are written once here rather than six times:
//
//   1. permission — the "Delete Records" row of the Role Access Matrix
//      (settings key 'delete-permissions'). Admin always has it; every other
//      role has it only if an Admin granted it.
//   2. confirmation — deletes are one click away from a table row.
//   3. the audit trail — logAudit() locally + mirrored to /api/audit, on top
//      of the DB trigger and the explicit ARCHIVE entry the server writes.

// { roleKey: { records: bool } }, from the same settings key the matrix writes.
// null until loaded — deleteRecordsAllowed() fails closed for non-Admins while
// it is, so a slow settings fetch can never flash a button a role may not use.
let deletePermissionOverrides = null;

async function loadDeletePermissions() {
  if (typeof apiGet !== "function") return;
  const before = deleteRecordsAllowed();
  try {
    const r = await apiGet("/api/settings/delete-permissions");
    deletePermissionOverrides = (r && r.value) || {};
  } catch (e) {
    deletePermissionOverrides = {};
  }
  // The first paint happens before this fetch lands, so a non-Admin who DOES
  // hold the permission would have been painted without Delete buttons.
  // Repaint only when the answer actually flipped — Admins (already true) and
  // roles without the permission (still false) are left alone, which keeps
  // pages that build charts on render from building them twice.
  if (deleteRecordsAllowed() !== before && typeof renderPage === "function")
    renderPage();
}

// Can the signed-in user delete records? Admin: always. Anyone else: only
// when the matrix says so.
function deleteRecordsAllowed() {
  const session = getSession();
  const role = session ? session.role : null;
  if (!role) return false;
  if (role === "Admin") return true;
  if (!deletePermissionOverrides) return false;
  const perms = deletePermissionOverrides[String(role).toLowerCase()];
  return !!(perms && perms.records === true);
}

// The Delete button markup for one table row / card. Returns "" when the role
// may not delete, so callers can drop it straight into an actions group.
// `handler` is a JS expression string, e.g. "deleteResident(12)".
function deleteButtonHtml(handler, label = "Delete") {
  if (!deleteRecordsAllowed()) return "";
  return `<button class="btn btn-sm btn-outline btn-danger-outline" onclick="${handler}" title="Delete (moves to Archive)"><i data-icon=trash></i>${label ? " " + label : ""}</button>`;
}

// Runs one delete end to end: permission check → confirm → DELETE → audit →
// toast. `opts.request` does the actual removal and may return a promise; if it
// resolves to { archived: false } the wording drops the Archive promise, for
// the few things that never reached the database and so have nothing to
// restore (a browser-only feedback mirror row, a demo baseline entry).
// Returns true when the record was deleted, false when it was blocked,
// cancelled or the request failed.
async function deleteRecord(opts) {
  const {
    label,          // what the user sees in the confirm + toast, e.g. "Santos, Pedro"
    what = "record",// the kind of thing, e.g. "resident"
    icon = "file-text", // glyph for the target chip in the confirm dialog
    request,        // async () => {}  — performs the delete
    action,         // audit action code, e.g. "RESIDENT_DELETE"
    category = "system",
    details,        // audit one-liner; defaults to "<What> <label> deleted"
    onDone,         // optional callback after a successful delete
    // false for the few things that never reached the database and so have
    // nothing to restore — the dialog must not promise an Archive entry it
    // cannot deliver.
    archives = true,
  } = opts;

  if (!deleteRecordsAllowed()) {
    showToast("You do not have permission to delete records", "<i data-icon=flag></i>");
    return false;
  }

  const ok = await uiConfirm({
    tone: "danger",
    icon: "trash",
    title: `Delete this ${what}?`,
    message: archives
      ? `It leaves ${moduleConfig[window.CURRENT_PAGE]?.title || "this list"} straight away — but nothing is destroyed.`
      : "This one was never saved to the barangay database, so it cannot be restored afterwards.",
    target: { icon, label },
    notes: [
      archives
        ? {
            icon: "archive",
            text: "It is moved to the Archive, where an Administrator can restore it.",
          }
        : {
            icon: "triangle-alert",
            text: "It is removed for good — there is no Archive copy to restore.",
          },
      {
        icon: "clipboard",
        text: "The deletion is recorded in the Audit Log under your name.",
      },
    ],
    confirmLabel: "Delete",
    confirmIcon: "trash",
  });
  if (!ok) return false;

  let result;
  try {
    result = await request();
  } catch (err) {
    showToast(`Could not delete: ${err.message}`, "<i data-icon=triangle-alert></i>");
    return false;
  }
  const archived = !(result && result.archived === false);

  if (typeof logAudit === "function")
    logAudit(
      action || "RECORD_DELETE",
      details ||
        `${what.charAt(0).toUpperCase() + what.slice(1)} "${label}" deleted${archived ? " and moved to the Archive" : ""}`,
      "warning",
      category
    );
  showToast(
    archived ? `${label} moved to the Archive` : `${label} deleted`,
    "<i data-icon=trash></i>"
  );
  if (typeof onDone === "function") onDone();
  return true;
}

// The acting account, appended to every delete so the server can attribute the
// archive entry and the DB audit trigger to a real person.
function actingAccountId() {
  return (getSession() || {}).account_id || "";
}

// Hide sidebar + topbar module entries an Officer may not open (cosmetic; the
// hard block is in nav()). No-op for Admin/Resident.
function applyOfficerModuleVisibility() {
  const session = getSession();
  const role = session ? session.role : null;
  document
    .querySelectorAll(".nav-item, .topbar-module-item")
    .forEach((n) => {
      const oc = n.getAttribute("onclick") || "";
      const m = oc.match(/nav\((?:this|null),\s*'([a-z]+)'\)/);
      if (!m) return;
      const allow = role !== "Officer" || moduleAllowedFor(m[1], "Officer");
      n.style.display = allow ? "" : "none";
    });
  hideEmptyModuleGroups();
}

// A sidebar group ("Administration") or launcher group is a heading over a list
// — with every module in it hidden, the heading labels nothing. An Officer with
// no admin modules should see the list end after Site Content, not sit under a
// header with nothing beneath it. Both groupings are handled the same way, so a
// future section needs no code here.
function hideEmptyModuleGroups() {
  document
    .querySelectorAll(".sidebar-section, .topbar-modules-group")
    .forEach((group) => {
      const items = group.querySelectorAll(".nav-item, .topbar-module-item");
      const anyVisible = Array.prototype.some.call(
        items,
        (n) => n.style.display !== "none" && !n.hidden
      );
      group.style.display = items.length && !anyVisible ? "none" : "";
    });
}

function nav(el, module) {
  const dest = PAGE_MAP[module];
  const session = getSession();
  const role = session ? session.role : null;

  // Enforce client-side RBAC for navigation (Officer overrides applied).
  const allowed = modulePermissions[module];
  if (allowed && (!role || !moduleAllowedFor(module, role))) {
    showToast("Access denied: insufficient permissions", "<i data-icon=flag></i>");
    if (!role) {
      // Not logged in -> go to login
      window.location.href = "../system.html";
    } else if (role === "Resident") {
      // Residents should use public landing/services
      window.location.href = "../index.html";
    }
    return;
  }

  if (dest) {
    window.location.href = dest; // relative within pages/
  }
}

function setContent(html) {
  document.getElementById("page-content").innerHTML = html;
}

// ════════════════════ TOAST ════════════════════
function showToast(msg, icon = "<i data-icon=check></i>") {
  const t = document.getElementById("toast");
  document.getElementById("toast-msg").textContent = msg;
  // innerHTML (not textContent) so callers can pass a small trusted icon
  // markup string (e.g. the GIS map's inline SVG icons) as well as plain text.
  document.getElementById("toast-icon").innerHTML = icon;
  t.style.transform = "translateY(0)";
  t.style.opacity = "1";
  setTimeout(() => {
    t.style.transform = "translateY(100px)";
    t.style.opacity = "0";
  }, 3500);
}

// Simulated incident alert sender (UI hook)
function sendIncidentAlert(incidentNo) {
  // UI feedback for now; backend integration (Semaphore/Twilio) to be wired later
  showToast(`Incident ${incidentNo} — alert sent to on-duty officers`, "<i data-icon=megaphone></i>");
  console.log(
    "[sendIncidentAlert]",
    incidentNo,
    "-> simulated SMS/Voice dispatched",
  );
}

// Dashboard AI briefing — POST /api/ai/dashboard/summary. The digest behind it
// carries WORKLOAD, not totals: pending certificates and how old the oldest is,
// unresolved and neglected incidents, unreviewed feedback, anything the
// sentiment pass flagged urgent. An official already knows the population; what
// they need on walking in is what is waiting and what is ageing badly.
// All arithmetic happens in PostgreSQL — the model is handed finished figures
// and only writes about them, so it cannot miscount.
//
// Both languages come back in one call and are cached here, so flipping the
// language switch re-renders instantly without another request.
let AI_SUMMARY = null;

function aiSummaryText(r) {
  if (!r) return "";
  const fil = window.L && L.isFilipino;
  return (fil && r.narrative_fil) || r.narrative || "";
}

function aiSummarySections(r) {
  if (!r) return null;
  const fil = window.L && L.isFilipino;
  const secs = (fil && r.sections_fil) || r.sections;
  return Array.isArray(secs) && secs.length ? secs : null;
}

function aiEscape(str) {
  const div = document.createElement("div");
  div.textContent = String(str == null ? "" : str);
  return div.innerHTML;
}

// Paints the briefing into #ai-summary-text. Sections render as a horizontal
// strip of columns; anything without sections (older stored briefings, or a
// failure message) falls back to plain text, so the card never breaks.
//   message — show this text instead (errors, empty states)
//   loading — show the shimmer skeleton while a regeneration is in flight
function renderAiSummary(message, loading) {
  const el = document.getElementById("ai-summary-text");
  if (!el) return;
  const fil = window.L && L.isFilipino;

  if (loading) {
    // Regeneration takes several seconds (the model thinks before it writes),
    // so a skeleton in the final layout is better than a spinner: the strip
    // does not jump when the real text lands.
    el.classList.add("ai-summary-sections");
    el.innerHTML =
      `<div class="ai-loading-note"><span class="ai-spinner" aria-hidden="true"></span>${
        fil ? "Bumubuo ng buod…" : "Generating briefing…"
      }</div>` +
      [1, 2, 3, 4]
        .map(
          (i) => `
      <section class="ai-summary-section ai-summary-section-${i}">
        <div class="ai-skel ai-skel-head"></div>
        <div class="ai-skel"></div>
        <div class="ai-skel ai-skel-short"></div>
      </section>`
        )
        .join("");
    return;
  }

  if (message) {
    el.classList.remove("ai-summary-sections");
    el.textContent = message;
    return;
  }
  // Nothing generated yet — leave the markup's placeholder text alone rather
  // than blanking it. This makes the function safe to call unconditionally on
  // every dashboard render, which is what restores the briefing after the user
  // navigates away and back (setContent rebuilds the DOM, but AI_SUMMARY
  // survives, so no refetch is needed).
  if (!AI_SUMMARY) return;

  const secs = aiSummarySections(AI_SUMMARY);
  if (!secs) {
    el.classList.remove("ai-summary-sections");
    el.textContent = aiSummaryText(AI_SUMMARY);
    return;
  }
  el.classList.add("ai-summary-sections");
  // Figures-only mode: the server could not reach the model (cap spent, rate
  // limited, or no key) and rendered the SQL figures instead. Say so plainly —
  // the numbers are still real, only the phrasing and the recommendations are
  // missing, and a reader must not mistake one for the other.
  const note =
    AI_SUMMARY.fallback || AI_SUMMARY.degraded
      ? `<div class="ai-fallback-note">${
          fil
            ? "Hindi available ang AI — mga datos lamang ang ipinapakita."
            : "AI unavailable — showing figures only."
        }</div>`
      : "";
  el.innerHTML =
    note +
    secs
      .map((s, i) => {
        const items = (s.items || [])
          .filter((x) => String(x || "").trim())
          .map((x) => `<li>${aiEscape(String(x).trim())}</li>`)
          .join("");
        return `
      <section class="ai-summary-section ai-summary-section-${i + 1}">
        <h4 class="ai-summary-head">${aiEscape(s.heading || "")}</h4>
        ${s.body ? `<p class="ai-summary-body">${aiEscape(String(s.body).trim())}</p>` : ""}
        ${items ? `<ul class="ai-summary-list">${items}</ul>` : ""}
      </section>`;
      })
      .join("");
}

// Auto-load on entering the dashboard: paint the stored briefing first (free,
// and it still works when the quota is spent), then ask the server to refresh.
// The server decides whether that costs anything — it will not regenerate more
// often than AI_DASHBOARD_MIN_MINUTES (6 hours), and returns the stored copy
// untouched when the figures have not moved. So opening the dashboard
// repeatedly is cheap.
let AI_SUMMARY_LOADING = false;

async function loadAiSummary() {
  if (AI_SUMMARY_LOADING) return;
  AI_SUMMARY_LOADING = true;
  try {
    if (!AI_SUMMARY) {
      const latest = await apiGet("/api/ai/dashboard/summary/latest").catch(() => null);
      if (latest) {
        AI_SUMMARY = latest;
        renderAiSummary();
      }
    }
    const next = await apiPost("/api/ai/dashboard/summary", {
      account_id: actingAccountId(),
      auto: true,
    }).catch(() => null);
    if (next) {
      AI_SUMMARY = next;
      renderAiSummary();
    }
  } finally {
    AI_SUMMARY_LOADING = false;
  }
}

async function generateAiSummary(scope = "dashboard") {
  const fil = window.L && L.isFilipino;
  showToast(
    fil ? "Bumubuo ng buod..." : "Generating briefing...",
    "<i data-icon=sparkles></i>"
  );
  renderAiSummary(null, true);
  try {
    AI_SUMMARY = await apiPost("/api/ai/dashboard/summary", {
      account_id: actingAccountId(),
      scope,
    });
    renderAiSummary();
    showToast(
      AI_SUMMARY.cached
        ? fil
          ? "Walang pagbabago — dating buod"
          : "Figures unchanged — showing the stored briefing"
        : fil
          ? "Nabuo ang buod"
          : "Briefing generated",
      "<i data-icon=sparkles></i>"
    );
  } catch (err) {
    AI_SUMMARY = null;
    renderAiSummary(
      fil
        ? "Wala pang buod. Pindutin ang Generate para sa buod ng mga nakabinbing gawain."
        : "No briefing yet. Use Generate for a summary of what is pending and what needs attention."
    );
    showToast(err.message || "Could not generate briefing", "<i data-icon=triangle-alert></i>");
  }
}

// Re-render the stored briefing when the language switch is flipped. No refetch
// — the Filipino sections are already here.
if (window.L && L.subscribe) {
  L.subscribe(function () {
    if (AI_SUMMARY) renderAiSummary();
  });
}

// ════════════════════ AI URGENT ALERTS ════════════════════
// The notice board above the briefing: comments the sentiment pass judged to
// need an official TODAY — a safety risk, or a service failure that has dragged
// on (GET /api/ai/alerts, raised in ai-feedback-service.js).
//
// WHY IT IS SEPARATE FROM THE BRIEFING RIGHT BELOW IT
// The briefing is prose the model writes each morning, capped and cached, and
// it summarises everything. This is a list of specific rows with a button on
// each. Folding the two together would mean the one thing that needs an action
// arrives as a clause in a paragraph — and would put the alerts behind the
// briefing's regeneration interval, so a hazard reported at 9:05 would not
// appear until the next regeneration was due. This costs nothing to read (pure
// SQL over columns already written), so it refreshes whenever the page does.
//
// It renders nothing at all when the board is clear. A card that says "no
// urgent alerts" every day is a card people stop seeing, and then they stop
// seeing it on the day it says something else.
let AI_ALERTS = null;

// Age in the words an official would use. Beyond a fortnight the exact day
// count stops carrying meaning and the size of the failure is the point —
// "4 months old" lands where "122 days old" does not.
function aiAlertAge(days) {
  const d = Number(days) || 0;
  const fil = window.L && L.isFilipino;
  if (d < 1) return fil ? "ngayong araw" : "today";
  if (d === 1) return fil ? "kahapon" : "yesterday";
  if (d < 14) return fil ? `${d} araw na` : `${d} days old`;
  if (d < 60) {
    const w = Math.round(d / 7);
    return fil ? `${w} linggo na` : `${w} weeks old`;
  }
  const m = Math.round(d / 30);
  return fil ? `${m} buwan na` : `${m} months old`;
}

function renderAiAlerts() {
  const wrap = document.getElementById("ai-alerts");
  const list = document.getElementById("ai-alerts-list");
  if (!wrap || !list) return;

  const rows = (AI_ALERTS && AI_ALERTS.alerts) || [];
  if (!rows.length) {
    wrap.hidden = true;
    list.innerHTML = "";
    return;
  }
  const fil = window.L && L.isFilipino;
  wrap.hidden = false;

  const countEl = document.getElementById("ai-alerts-count");
  if (countEl) countEl.textContent = rows.length > 99 ? "99+" : String(rows.length);

  list.innerHTML = rows
    .map((a) => {
      // The reason is the model's action line ("Certificate processing has been
      // delayed for 4 months"). The two endpoints that feed this renderer name
      // the summary differently (/alerts returns ai_summary, /feedback/insights
      // aliases it to summary) — accept either.
      const reason = (a.alert_reason || a.ai_summary || a.summary || "").trim();
      const comment = (a.comment || "").trim();
      const safety = a.urgency === "high";
      // Each alert is ONE thin line in its own box. The resident's own words
      // are the tooltip rather than a second paragraph: the job on the
      // dashboard is to decide which item to open first, and four stacked
      // quotes would push the rest of the page down for evidence nobody is
      // reading yet. The full comment is on the Feedback page's queue, one
      // click away, where there is room for it.
      const tip = comment ? `${reason}\n\n"${comment}"` : reason;
      return `
      <div class="ai-alert" data-alert-id="${Number(a.id)}" title="${aiEscape(tip)}">
        <span class="ai-alert-kind ai-alert-kind-${safety ? "safety" : "service"}">${
          safety
            ? fil ? "Kaligtasan" : "Safety"
            : fil ? "Serbisyo" : "Service"
        }</span>
        <span class="ai-alert-text">${aiEscape(reason)}</span>
        <span class="ai-alert-age">${aiEscape(aiAlertAge(a.days_old))}</span>
        <button type="button" class="btn btn-sm btn-outline ai-alert-resolve"
                onclick="viewAiAlert(${Number(a.id)})">
          ${fil ? "Tingnan" : "View"}
        </button>
      </div>`;
    })
    .join("");
  if (typeof hydrateIcons === "function") hydrateIcons(list);
}

// Open the alert where there is room to judge it: the Feedback page, with the
// entry scrolled to and lit up.
//
// WHY THE DASHBOARD NO LONGER RESOLVES DIRECTLY
// Resolving is a decision, and the dashboard row is deliberately one truncated
// line — the resident's actual words are behind a tooltip. Closing an alert
// from there means acting on the AI's summary without having read what was
// said, which is exactly the habit this feature should not build. The Feedback
// page shows the full comment, the stars, the category and the sentiment beside
// each other, and that is where Resolve and Dismiss live.
//
// The feedback id travels in the URL hash: the page is a separate document, so
// a variable would not survive the navigation.
function viewAiAlert(id) {
  const dest = PAGE_MAP.feedback + "#alert-" + Number(id);
  if (window.CURRENT_PAGE === "feedback") {
    // Already here — just move to it. Setting the hash alone would not
    // re-trigger anything if it is the hash already, so highlight directly.
    window.location.hash = "alert-" + Number(id);
    if (typeof highlightFeedbackEntry === "function") highlightFeedbackEntry(Number(id));
    return;
  }
  // Same permission gate every other cross-page jump goes through; an Officer
  // without the Feedback module gets the toast rather than a dead page.
  if (typeof moduleAllowedFor === "function") {
    const role = (getSession() || {}).role;
    if (role && !moduleAllowedFor("feedback", role)) {
      showToast("Access denied: insufficient permissions", "<i data-icon=flag></i>");
      return;
    }
  }
  window.location.href = dest;
}

async function loadAiAlerts() {
  if (typeof apiGet !== "function") return;
  try {
    AI_ALERTS = await apiGet("/api/ai/alerts?limit=20");
  } catch (e) {
    // Server down or AI never configured. Leave the board hidden rather than
    // painting an error where an alert would go — a red box on the dashboard
    // must mean "a resident is waiting", never "the fetch failed".
    return;
  }
  renderAiAlerts();
}

// The two ways an alert leaves the board, sharing one implementation because
// everything except the wording and the endpoint is identical:
//
//   resolve — the problem was real and has been dealt with. The note is sent
//             to the resident who raised it, so the loop actually closes.
//   dismiss — the model was wrong. Nothing happened, nobody is told, and the
//             note explains to the next reader of the audit log why it was a
//             false alarm.
//
// Both ask for confirmation: the alert stops being shown to anyone afterwards.
async function closeAiAlert(id, btn, mode) {
  const fil = window.L && L.isFilipino;
  const dismiss = mode === "dismiss";
  const row = ((AI_ALERTS && AI_ALERTS.alerts) || []).find(
    (a) => Number(a.id) === Number(id)
  );
  // On the Feedback page the alert is in the insights queue, not AI_ALERTS.
  const queued =
    row ||
    (typeof FEEDBACK_INSIGHTS !== "undefined" && FEEDBACK_INSIGHTS
      ? (FEEDBACK_INSIGHTS.needs_attention || []).find(
          (a) => Number(a.id) === Number(id)
        )
      : null);

  const note = await uiPrompt({
    title: dismiss
      ? fil ? "I-dismiss ang alerto?" : "Dismiss this alert?"
      : fil ? "Markahan bilang nalutas?" : "Mark this alert resolved?",
    message: dismiss
      ? fil
        ? "Para ito sa maling flag ng AI. Aalisin ang alerto, pero mananatili ang feedback at mababasa pa rin ito gaya ng iba. Walang aabisuhan na residente."
        : "For when the AI got it wrong. The alert goes away, but the feedback stays in the list and is still read like any other. The resident is not told anything."
      : fil
        ? "Aalisin ito sa dashboard at hindi na ipapaalala sa mga opisyal. Mananatili ang feedback sa listahan."
        : "It leaves the dashboard and officials stop being warned about it. The feedback itself stays in the list.",
    icon: dismiss ? "x" : "check",
    tone: "accent",
    target: queued
      ? {
          label: (
            queued.alert_reason || queued.ai_summary || queued.summary || ""
          ).slice(0, 120),
          icon: "triangle-alert",
        }
      : null,
    field: dismiss
      ? {
          label: fil ? "Bakit hindi ito urgent? (opsyonal)" : "Why is this not urgent? (optional)",
          placeholder: fil
            ? "hal. Naayos na noong isang linggo"
            : "e.g. Already fixed last week — the comment is out of date",
        }
      : {
          label: fil ? "Anong ginawa? (opsyonal)" : "What was done? (optional)",
          placeholder: fil
            ? "hal. Na-approve na ang certificate"
            : "e.g. Certificate approved and released",
          // Says plainly where the words go. An officer typing a note that a
          // resident will read should know that before they type it, not
          // after — the wording changes completely.
          hint: fil
            ? "Ipapadala ito sa residenteng nagsumite, kung may account siya."
            : "Sent to the resident who submitted this, if they have an account.",
        },
    // The note is genuinely optional — an alert dealt with over the counter
    // does not need a paragraph, and demanding one would push officers to type
    // "ok" rather than to press the button at all.
    validate: () => null,
    confirmLabel: dismiss
      ? fil ? "I-dismiss" : "Dismiss"
      : fil ? "Markahan" : "Resolve",
    confirmIcon: dismiss ? "x" : "check",
  });
  if (note === null) return; // cancelled

  if (btn) btn.disabled = true;
  try {
    await apiPost(`/api/ai/alerts/${Number(id)}/${dismiss ? "dismiss" : "resolve"}`, {
      account_id: actingAccountId(),
      note: note || "",
    });
  } catch (err) {
    if (btn) btn.disabled = false;
    showToast(
      err.message || (dismiss ? "Could not dismiss the alert" : "Could not resolve the alert"),
      "<i data-icon=triangle-alert></i>"
    );
    return;
  }

  // Drop it locally and repaint, rather than refetching: the row is gone from
  // the board the instant the officer presses the button.
  if (AI_ALERTS && AI_ALERTS.alerts) {
    AI_ALERTS.alerts = AI_ALERTS.alerts.filter((a) => Number(a.id) !== Number(id));
    AI_ALERTS.open = Math.max(0, (Number(AI_ALERTS.open) || 1) - 1);
  }
  renderAiAlerts();
  if (typeof logAudit === "function")
    logAudit(
      dismiss ? "AI_ALERT_DISMISS" : "AI_ALERT_RESOLVE",
      dismiss
        ? `Urgent AI alert dismissed as a false alarm — feedback #${id}${note ? ": " + note : ""}`
        : `Urgent AI alert resolved — feedback #${id}${note ? ": " + note : ""}`,
      "warning",
      "feedback"
    );
  showToast(
    dismiss
      ? fil ? "Na-dismiss ang alerto" : "Alert dismissed"
      : note
        ? fil ? "Nalutas — naipadala sa residente" : "Resolved — the resident has been notified"
        : fil ? "Nalutas na ang alerto" : "Alert resolved",
    dismiss ? "<i data-icon=x></i>" : "<i data-icon=check></i>"
  );
  // The same alert is also the Feedback page's Needs Attention queue. Closing
  // it from either surface has to clear it from both, so the page that is open
  // gets a hook rather than this function knowing about every page that might
  // be showing the row.
  if (typeof onAiAlertResolved === "function") onAiAlertResolved(id);
  // The briefing's "Resident Sentiment" column counts open alerts, so it is now
  // one behind. Cheap to refresh — the server returns the stored copy unless
  // the figures moved.
  if (typeof loadAiSummary === "function") loadAiSummary();
}

const resolveAiAlert = (id, btn) => closeAiAlert(id, btn, "resolve");
const dismissAiAlert = (id, btn) => closeAiAlert(id, btn, "dismiss");

if (window.L && L.subscribe) {
  L.subscribe(function () {
    if (AI_ALERTS) renderAiAlerts();
  });
}

// ════════════════════ SERVICE POPUP HELPERS ════════════════════
function openServicePopup(service) {
  // The blotter/incident service is the unified "File an Incident / Concern"
  // modal (js/incident-report.js) — it builds its own body and embedded map.
  if (service === "incidents" && typeof openIncidentModal === "function") {
    openIncidentModal();
    return;
  }
  const modal = document.getElementById("modal-" + service);
  modal.classList.add("open");
  if (service === "accounts") resetAccountClaiming();
  if (service === "feedback") {
    // Last time's refusal must not be the first thing this visitor sees, and
    // the stars start blank however the previous submission ended.
    if (window.Motion) Motion.clearErrors(modal);
    resetRating();
  }
  if (service === "gis") {
    setTimeout(() => initGisMap("gis-map-modal"), 120);
  }
}

function closeServiceModal(service, e) {
  if (e && e.target !== document.getElementById("modal-" + service)) return;
  document.getElementById("modal-" + service).classList.remove("open");
}

// ════════════════════ RESIDENT PORTAL ════════════════════
function renderResidentPortal() {
  const session = getSession();
  const portalName = escResident(session?.displayName || "Resident");
  setContent(`
    <div class="resident-portal">
      <div class="portal-welcome">
        <div class="portal-welcome-content">
          <h2>Mabuhay, <span class="gold">${portalName}</span>!</h2>
          <p>Welcome to the Barangay Conde Labac Resident Portal. Access your barangay services below — request certificates, file reports, and stay connected with your community.</p>
        </div>
      </div>

      <div id="account-section">
        <div class="services-title">Your Account</div>
        <div class="services-subtitle">Track your requests and stay updated</div>
        <div class="services-grid">
          <div class="service-card sc-blue" onclick="openMyInfo()">
            <div class="service-icon-wrap"><i data-icon=user></i></div>
            <div>
              <div class="service-title">My Information</div>
              <div class="service-desc">View your account details and your barangay record on file.</div>
            </div>
            <div class="service-arrow">View my info <i data-icon=arrow-right></i></div>
          </div>
          <div class="service-card sc-gold" onclick="openMyActivity()">
            <div class="service-icon-wrap"><i data-icon=inbox></i></div>
            <div>
              <div class="service-title">My Activity</div>
              <div class="service-desc">Track everything you sent the barangay — certificate requests, changes to your details, incident reports, and feedback.</div>
            </div>
            <div class="service-arrow">View my activity <i data-icon=arrow-right></i></div>
          </div>
          <div class="service-card sc-green" onclick="openNotifications()">
            <div class="service-icon-wrap"><i data-icon=bell></i></div>
            <div>
              <div class="service-title">Notifications</div>
              <div class="service-desc">Updates on your requests and messages from the barangay office.</div>
            </div>
            <div class="service-arrow">Open inbox <i data-icon=arrow-right></i></div>
          </div>
        </div>
      </div>

      <div id="services-section">
        <div class="services-title">Services We Offer</div>
        <div class="services-subtitle">Click on any service to get started</div>

        <!-- No Barangay Residency card: it opened a lookup over every
             resident's record to whoever was signed in. That is personal
             information under RA 10173 and no resident has a basis to see
             another's — their own details are under My Information above. -->
        <div class="services-grid">
          <div class="service-card sc-gold" onclick="openServicePopup('certificates')">
            <div class="service-icon-wrap"><i data-icon=file-text></i></div>
            <div>
              <div class="service-title">Certificate Issuance</div>
              <div class="service-desc">Request Barangay Clearances, Certificates of Indigency, Residency, Good Moral, Business Clearance, and more.</div>
            </div>
            <div class="service-arrow">Request certificate <i data-icon=arrow-right></i></div>
          </div>

          <div class="service-card sc-red" onclick="openServicePopup('incidents')">
            <div class="service-icon-wrap"><i data-icon=siren></i></div>
            <div>
              <div class="service-title">Blotter Reporting</div>
              <div class="service-desc">File an incident report for complaints, disputes, altercations, vandalism, or other concerns happening in the barangay.</div>
            </div>
            <div class="service-arrow">File a report <i data-icon=arrow-right></i></div>
          </div>

          <div class="service-card sc-green" onclick="openServicePopup('feedback')">
            <div class="service-icon-wrap"><i data-icon=message-square></i></div>
            <div>
              <div class="service-title">Feedback</div>
              <div class="service-desc">Share your comments, suggestions, or concerns about barangay services. Your voice helps improve governance.</div>
            </div>
            <div class="service-arrow">Give feedback <i data-icon=arrow-right></i></div>
          </div>

          <div class="service-card sc-purple" onclick="openServicePopup('gis')">
            <div class="service-icon-wrap"><i data-icon=map></i></div>
            <div>
              <div class="service-title">GIS Map</div>
              <div class="service-desc">View the interactive map of Barangay Conde Labac — showing puroks, hazard zones, health centers, and key landmarks.</div>
            </div>
            <div class="service-arrow">View map <i data-icon=arrow-right></i></div>
          </div>

          <div class="service-card sc-teal" onclick="openServicePopup('accounts')">
            <div class="service-icon-wrap"><i data-icon=key></i></div>
            <div>
              <div class="service-title">Account Claiming</div>
              <div class="service-desc">Already registered in the barangay system? Claim your account to access personalized services and track your requests.</div>
            </div>
            <div class="service-arrow">Claim account <i data-icon=arrow-right></i></div>
          </div>
        </div>
      </div>

      <!-- Notices -->
      <div class="notice-card">
        <div class="notice-title"><i data-icon=megaphone></i> Barangay Notices</div>
        <div class="alert alert-warning"><span class="alert-icon"><i data-icon=triangle-alert></i></span> <strong>Flood Advisory:</strong> Purok 3 residents — please monitor weather conditions. Pre-positioned relief goods at Brgy Hall.</div>
        <div class="alert alert-info"><span class="alert-icon"><i data-icon=info></i></span> <strong>Certificate Processing:</strong> Regular processing hours are Mon–Fri, 8:00 AM – 5:00 PM.</div>
        <div class="alert alert-success"><span class="alert-icon"><i data-icon=check></i></span> <strong>Free Medical Mission:</strong> May 15, 2025 at the Barangay Health Center. Walk-ins welcome.</div>
      </div>
    </div>
  `);
}

// ════════════════════ RESIDENCY MODAL LOGIC ════════════════════
// Removed with the Barangay Residency service modal itself (index.html) —
// a public lookup over every resident record is not something the portal
// should offer under RA 10173. escResident() survives because the resident
// portal header still uses it; everything else here backed only that modal.
function escResident(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

// ════════════════════ CERTIFICATE MODAL LOGIC ════════════════════
function selectCert(el, certName) {
  document
    .querySelectorAll(".cert-type-card")
    .forEach((c) => c.classList.remove("selected"));
  el.classList.add("selected");
  selectedCert = certName;
  document.getElementById("cert-selected-badge").innerHTML =
    `<span class="badge badge-gold">Selected: ${certName}</span>`;
}

// Validation feedback goes on the fields themselves — they shake, turn amber
// and say what is missing under the label (Motion.require, js/motion.js).
// A window.alert() could only name one problem, could not point at it, and
// looked like nothing else in the system: it was the last of the undesigned
// browser dialogs left in this file, after confirm() and prompt() had already
// been replaced by uiConfirm()/uiPrompt().
//
// requireFields() is the shared shim: without js/motion.js loaded it falls
// back to the alert, so no page can lose its validation entirely.
function requireFields(fields, fallbackMessage) {
  if (window.Motion) return Motion.require(fields);
  const empty = fields.some((f) => {
    const el = document.getElementById(typeof f === "string" ? f : f.id);
    return el && !String(el.value || "").trim();
  });
  if (empty) alert(fallbackMessage);
  return !empty;
}

// The same shim for a field that is filled in but wrong. Returns undefined so
// `return rejectField(...)` reads as the early exit it is.
function rejectField(id, message, fallbackMessage) {
  if (window.Motion) Motion.reject(id, message);
  else alert(fallbackMessage || message);
}

function submitCertificate() {
  if (!requireFields(["cert-fname", "cert-lname"], "Please enter your first and last name."))
    return;
  const fname = document.getElementById("cert-fname").value.trim();
  const lname = document.getElementById("cert-lname").value.trim();
  closeServiceModal("certificates");
  if (typeof logAudit === "function")
    logAudit("CERT_REQUEST", `${selectedCert} requested by ${fname} ${lname} (Ref: CERT-2025-088)`, "info", "certificate");
  showToast(`${selectedCert} request submitted! Ref: CERT-2025-088`, "<i data-icon=file-text></i>");
}

// ════════════════════ BLOTTER MODAL LOGIC ════════════════════
function submitBlotter() {
  if (
    !requireFields(
      [
        {
          id: "inc-narration",
          message:
            "Describe what happened — without this an officer has nothing to act on.",
        },
      ],
      "Please provide a narration of the incident."
    )
  )
    return;
  closeServiceModal("incidents");
  if (typeof logAudit === "function")
    logAudit("BLOTTER_SUBMIT", `Blotter/incident report filed (Case No: INC-2025-042)`, "info", "concern");
  showToast("Blotter report submitted! Case No: INC-2025-042", "<i data-icon=siren></i>");
}

// ════════════════════ FEEDBACK MODAL LOGIC ════════════════════
const ratingLabels = ["", "Very Poor", "Poor", "Average", "Good", "Excellent"];

// The star row is a <div>, not an input, so it gets nothing from the validation
// helpers on its own. Giving it a `.value` is what lets requireFields treat it
// as the required field it is — same shake, same message under it, same
// "everything that is missing is marked at once" — with no special case in the
// submit path. Nothing reads the property except that check.
function setStarValue(n) {
  const box = document.getElementById("star-rating");
  if (!box) return;
  box.value = n ? String(n) : "";
  // Motion clears a field's error on its `input`/`change` event; a div fires
  // neither, so choosing a star has to take the mark off itself.
  if (n && window.Motion) Motion.clearField(box);
}

function setRating(n) {
  feedbackRating = n;
  document.querySelectorAll(".star").forEach((s, i) => {
    s.classList.toggle("active", i < n);
  });
  document.getElementById("rating-label").textContent = n
    ? `${n} out of 5 — ${ratingLabels[n]}`
    : "Select a rating";
  setStarValue(n);
}

// Back to nothing chosen, for a modal that is opening or has just been sent.
function resetRating() {
  setRating(0);
}

function submitFeedback() {
  if (
    !requireFields(
      [
        {
          id: "star-rating",
          message: "Choose a star rating — one to five.",
        },
        { id: "fb-comment", message: "Tell us what you would like to say." },
      ],
      "Please choose a star rating and enter a comment."
    )
  )
    return;
  const comment = document.getElementById("fb-comment").value.trim();
  const category = document.getElementById("fb-category")?.value || "Other";
  const name = document.getElementById("fb-name")?.value.trim() || "";
  const contact = document.getElementById("fb-contact")?.value.trim() || "";
  // Persist so the submission shows up in the Feedback page's Recent list.
  if (window.FeedbackStore)
    FeedbackStore.add({ rating: feedbackRating, category, comment, name, contact });
  closeServiceModal("feedback");
  if (typeof logAudit === "function")
    logAudit("FEEDBACK_SUBMIT", `Feedback submitted — rated ${feedbackRating}/5 (${ratingLabels[feedbackRating]})`, "info", "feedback");
  // Next time the modal opens it asks again rather than offering the last
  // person's rating — which on a shared barangay-hall terminal is somebody
  // else's opinion entirely.
  resetRating();
  // If we're on the Feedback page, refresh the list immediately.
  if (typeof refreshRecentFeedback === "function") refreshRecentFeedback();
  showToast("Feedback submitted! Thank you for your input.", "<i data-icon=message-square></i>");
}

// ════════════════════ ACCOUNT CLAIMING STEPS ════════════════════
// Real two-phase claiming against the DB:
//   Step 1 "Verify Identity" → POST /api/residents/claim/verify — matches
//     name + birthdate, shows the found record (or the rejection) inline.
//   Step 2 "Set Credentials"  → POST /api/residents/claim — flips
//     account_claimed = true, so the resident's status becomes "Active".
let accVerifiedResident = null;
let accFooterOriginal = null; // captured on first open so reset can restore it

// Put the wizard back to step 1 every time the modal opens (previously a
// finished/half-done wizard stayed stuck where it left off).
function resetAccountClaiming() {
  accStep = 1;
  accVerifiedResident = null;
  const s1 = document.getElementById("acc-step-1");
  if (!s1) return;
  s1.style.display = "";
  s1.classList.remove("is-hidden");
  document.getElementById("acc-step-2")?.classList.add("is-hidden");
  document.getElementById("acc-step-3")?.classList.add("is-hidden");
  ["step-1-dot", "step-2-dot", "step-3-dot"].forEach((id, i) => {
    const d = document.getElementById(id);
    if (!d) return;
    d.style.background = "";
    d.style.color = "";
    d.textContent = String(i + 1);
  });
  ["step-line-1", "step-line-2"].forEach((id) => {
    const l = document.getElementById(id);
    if (l) l.style.background = "";
  });
  const resultEl = document.getElementById("acc-verify-result");
  if (resultEl) {
    resultEl.classList.add("is-hidden");
    resultEl.innerHTML = "";
  }
  const footer = document.getElementById("acc-footer");
  if (footer) {
    if (accFooterOriginal === null) accFooterOriginal = footer.innerHTML;
    else footer.innerHTML = accFooterOriginal;
  }
  const btn = document.getElementById("acc-next-btn");
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = "Verify Identity <i data-icon=arrow-right></i>";
  }
}

async function accNextStep() {
  if (accStep === 1) {
    if (!requireFields(["acc-fname", "acc-lname"], "Please fill in your name to continue."))
      return;
    const fname = document.getElementById("acc-fname").value.trim();
    const lname = document.getElementById("acc-lname").value.trim();
    const dob = document.getElementById("acc-dob")?.value || "";
    // Verify against the resident database before allowing the next step.
    if (typeof apiPost === "function") {
      const resultEl = document.getElementById("acc-verify-result");
      const btn = document.getElementById("acc-next-btn");
      if (btn) btn.disabled = true;
      if (resultEl) {
        resultEl.classList.remove("is-hidden");
        resultEl.innerHTML = `<div class="alert alert-info"><span class="alert-icon"><i data-icon=info></i></span> Verifying your record…</div>`;
      }
      try {
        accVerifiedResident = await apiPost("/api/residents/claim/verify", {
          first_name: fname,
          last_name: lname,
          birthdate: dob || null,
        });
        if (resultEl)
          resultEl.innerHTML = `<div class="alert alert-success"><span class="alert-icon"><i data-icon=check></i></span> <strong>Record found:</strong> ${accVerifiedResident.name}${accVerifiedResident.purok ? " · " + accVerifiedResident.purok : ""}${accVerifiedResident.household_name ? " · " + accVerifiedResident.household_name : ""}</div>`;
      } catch (err) {
        accVerifiedResident = null;
        if (resultEl)
          resultEl.innerHTML = `<div class="alert alert-warning"><span class="alert-icon"><i data-icon=triangle-alert></i></span> ${err.message}</div>`;
        if (btn) btn.disabled = false;
        return; // stay on step 1 until identity verifies
      }
      if (btn) btn.disabled = false;
    }
    document.getElementById("acc-step-1").style.display = "none";
    document.getElementById("acc-step-2").style.display = "";
    document.getElementById("acc-step-1").classList.add("is-hidden");
    document.getElementById("acc-step-2").classList.remove("is-hidden");
    document.getElementById("step-1-dot").style.background = "#22c55e";
    document.getElementById("step-1-dot").innerHTML = "<i data-icon=check></i>";
    document.getElementById("step-2-dot").style.background = "var(--navy)";
    document.getElementById("step-2-dot").style.color = "#fff";
    document.getElementById("step-line-1").style.background = "#22c55e";
    document.getElementById("acc-next-btn").innerHTML = "Create Account <i data-icon=arrow-right></i>";
    accStep = 2;
  } else if (accStep === 2) {
    if (
      !requireFields(
        ["acc-email", "acc-pass", "acc-pass2"],
        "Please enter your email address and choose a password."
      )
    )
      return;
    const email = document.getElementById("acc-email").value.trim();
    const pass = document.getElementById("acc-pass").value;
    const pass2 = document.getElementById("acc-pass2").value;
    // Not-empty-but-wrong: the field is marked in red rather than amber, and
    // the one that has to change is the one that gets the caret — the
    // confirmation for a mismatch, the password itself for a short one.
    if (pass.length < 8)
      return rejectField("acc-pass", "Use at least 8 characters.", "Password must be at least 8 characters.");
    if (pass !== pass2)
      return rejectField("acc-pass2", "This does not match the password above.", "Passwords do not match.");
    // Claim the account for real: creates the account row (email +
    // hashed password) linked to the resident verified in step 1. The row's
    // existence is what makes the resident "Active". Blocks the flow if the
    // record vanished / was claimed meanwhile / email already in use.
    if (typeof apiPost === "function") {
      const btn = document.getElementById("acc-next-btn");
      if (btn) btn.disabled = true;
      const who = accVerifiedResident
        ? { resident_id: accVerifiedResident.id }
        : {
            first_name: document.getElementById("acc-fname").value.trim(),
            last_name: document.getElementById("acc-lname").value.trim(),
            birthdate: document.getElementById("acc-dob")?.value || null,
          };
      try {
        await apiPost("/api/residents/claim", {
          ...who,
          email: email,
          mobile_no: document.getElementById("acc-mobile")?.value.trim() || null,
          password: pass,
        });
      } catch (err) {
        // Almost every way this fails is about the email — already claimed,
        // already in use — so the message goes on that field rather than in a
        // dialog the user has to dismiss before they can act on it.
        rejectField("acc-email", err.message, "Could not claim account: " + err.message);
        if (btn) btn.disabled = false;
        return;
      }
      if (btn) btn.disabled = false;
    }
    document.getElementById("acc-step-2").classList.add("is-hidden");
    document.getElementById("acc-step-3").classList.remove("is-hidden");
    document.getElementById("step-2-dot").style.background = "#22c55e";
    document.getElementById("step-2-dot").innerHTML = "<i data-icon=check></i>";
    document.getElementById("step-3-dot").style.background = "var(--navy)";
    document.getElementById("step-3-dot").style.color = "#fff";
    document.getElementById("step-line-2").style.background = "#22c55e";
    document.getElementById("acc-footer").innerHTML =
      '<button class="btn btn-gold" onclick="closeServiceModal(\'accounts\')">Done <i data-icon=check></i></button>';
    accStep = 3;
    // Claiming is now instant (the DB flag just flipped) — make the success
    // step say so instead of the old "review within 12 working days" copy,
    // and use a real reference derived from the resident id.
    const ref = accVerifiedResident
      ? "ACC-" + String(accVerifiedResident.id).padStart(4, "0")
      : "ACC-" + Date.now().toString().slice(-6);
    const refEl = document.getElementById("acc-ref-num");
    if (refEl) refEl.textContent = ref;
    const titleEl = document.querySelector("#acc-step-3 .acc-success-title");
    if (titleEl) titleEl.textContent = "Account Claimed!";
    const copyEl = document.querySelector("#acc-step-3 .acc-success-copy");
    if (copyEl)
      copyEl.textContent = accVerifiedResident
        ? `The resident record for ${accVerifiedResident.name} is now linked to your account and marked Active.`
        : "Your account has been claimed and is now marked Active.";
    if (typeof logAudit === "function") {
      const fname = document.getElementById("acc-fname").value.trim();
      const lname = document.getElementById("acc-lname").value.trim();
      logAudit("ACC_CLAIM_SUBMIT", `Account claimed by ${fname} ${lname} <${email}> (Ref: ${ref})`, "info", "auth");
    }
    showToast("Account claimed! Ref: " + ref, "<i data-icon=key></i>");
  }
}

// ════════════════════ PAGINATION (shared) ════════════════════
// Every record list in the MIS pages through this helper rather than dumping
// its whole result set into one table. One implementation means one look and
// one set of keyboard/ARIA behaviours everywhere; the markup reuses the
// .feedback-pagination / .fb-page-btn classes the Feedback page already had.
//
// Usage from a page module:
//   const p = paginate("residency", filteredList, filterResidentsPage);
//   renderRows(p.items);
//   document.getElementById("resident-pagination").innerHTML = p.html;
// `render` is stored so the page buttons can repaint without each module
// wiring its own click handler. Call resetPage(key) whenever a filter changes,
// so narrowing the list doesn't strand the user on a page that no longer
// exists.
const PAGE_SIZE = 15;

// key → { page, render }
const pagerState = {};

function paginate(key, list, render, perPage) {
  const size = perPage || PAGE_SIZE;
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const st = (pagerState[key] = pagerState[key] || { page: 1 });
  if (typeof render === "function") st.render = render;
  st.page = Math.min(Math.max(1, st.page), pages);
  const start = (st.page - 1) * size;
  const items = list.slice(start, start + size);
  return {
    items,
    page: st.page,
    pages,
    total,
    start,
    html: pagerHtml(key, st.page, pages, total, start, items.length),
  };
}

// Page numbers are windowed: first, last, and the three around the current one,
// with "…" for the gaps. An audit trail with 400 pages must not render 400
// buttons.
function pagerNumbers(page, pages) {
  const shown = new Set([1, pages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => shown.add(n));
  if (page >= pages - 2) [pages - 3, pages - 2, pages - 1].forEach((n) => shown.add(n));
  return [...shown].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
}

function pagerHtml(key, page, pages, total, start, count) {
  if (!total) return "";
  const k = String(key).replace(/'/g, "\\'");
  const info = `Showing ${start + 1}–${start + count} of ${total.toLocaleString()}`;
  // A single page still gets the count line — it answers "is this everything?"
  // without making the user look for controls that aren't there.
  if (pages <= 1)
    return `<div class="feedback-pagination"><div class="feedback-page-info">${info}</div></div>`;

  let numbers = "";
  let prev = 0;
  pagerNumbers(page, pages).forEach((n) => {
    if (n - prev > 1) numbers += `<span class="fb-page-gap">…</span>`;
    numbers += `<button type="button" class="fb-page-btn${n === page ? " active" : ""}"
      ${n === page ? 'aria-current="page"' : ""}
      onclick="gotoPage('${k}', ${n})">${n}</button>`;
    prev = n;
  });

  return `
    <div class="feedback-pagination">
      <div class="feedback-page-info">${info}</div>
      <div class="feedback-page-controls" role="navigation" aria-label="Pagination">
        <button type="button" class="fb-page-btn fb-page-nav" aria-label="Previous page"
          ${page === 1 ? "disabled" : ""} onclick="gotoPage('${k}', ${page - 1})"><i data-icon=arrow-left></i></button>
        ${numbers}
        <button type="button" class="fb-page-btn fb-page-nav" aria-label="Next page"
          ${page === pages ? "disabled" : ""} onclick="gotoPage('${k}', ${page + 1})"><i data-icon=arrow-right></i></button>
      </div>
    </div>`;
}

function gotoPage(key, p) {
  const st = pagerState[key];
  if (!st) return;
  st.page = Math.max(1, p);
  if (typeof st.render === "function") st.render();
}

// Back to page 1 — call this from every filter/search handler.
function resetPage(key) {
  if (pagerState[key]) pagerState[key].page = 1;
}

// ════════════════════ SIDEBAR COUNT BADGES ════════════════════
// The red pills on the sidebar's Certificate Processing / Blotter / Account
// Claiming / Feedback entries. They were hardcoded ("7", "3", "12") in
// app-shell.js; these are the live equivalents, read in one round trip from
// GET /api/stats/dashboard. A zero count empties the pill, which CSS
// (.nav-badge:empty) hides — a badge that always shows a number stops meaning
// "there is something waiting for you".
const NAV_BADGE_SOURCES = {
  "cert-badge": (s) => s.certificates_pending,
  "inc-badge": (s) => s.incidents_open,
  // Account Claiming's queue is the residents who still have no account.
  "acc-badge": (s) => s.residents_unclaimed,
  "fb-badge": (s) => s.feedback_new,
};

function setNavBadge(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) {
    el.textContent = "";
    el.removeAttribute("title");
    return;
  }
  el.textContent = n > 99 ? "99+" : String(n);
  el.title = `${n.toLocaleString()} waiting`;
}

async function refreshNavBadges() {
  if (typeof apiGet !== "function") return;
  // The public landing page loads this file but has no MIS sidebar — don't
  // poll the stats endpoint for pills that aren't on the page.
  if (!Object.keys(NAV_BADGE_SOURCES).some((id) => document.getElementById(id)))
    return;
  // Residents never see the MIS sidebar, and the stats endpoint is staff data.
  const session = getSession();
  if (!session || session.role === "Resident") return;
  try {
    const stats = await apiGet("/api/stats/dashboard");
    Object.entries(NAV_BADGE_SOURCES).forEach(([id, pick]) =>
      setNavBadge(id, pick(stats))
    );
  } catch (e) {
    // Offline: leave whatever the badges last showed rather than blanking the
    // sidebar on a flaky connection.
  }
}

// ════════════════════ NOTIFICATIONS ════════════════════
// The topbar bell, backed by GET /api/notifications — the same per-account
// feed the mobile app's bell reads. It used to be a button that popped a toast
// reading "3 new notifications", which was true of no account at any time.
//
// What actually arrives here for staff is the AI urgent alerts
// (ai-alert-service.js fans one row out to every Admin and Officer the moment
// a comment is flagged), alongside the certificate status messages the
// certificates route already wrote for residents. The dashboard board is where
// an official ACTS on an alert; this is how they find out about one while they
// are on some other page — or on some other day.
let NOTIFS = [];
let NOTIF_OPEN = false;

function notifWhen(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return "";
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function unreadNotifCount() {
  return NOTIFS.filter((n) => !n.is_read).length;
}

// The dot is the whole point of the bell: it has to be absent when there is
// nothing, or it stops meaning anything. (It was previously always painted.)
//
// The count is remembered between paints so the bell can ring when it goes UP.
// The poll runs every 60 seconds against a bell the officer is not looking at,
// and a dot that was already on says nothing about the alert that arrived
// while they were reading a table.
let LAST_UNREAD_COUNT = null;

function renderNotifDot() {
  const dot = document.getElementById("notif-dot");
  if (!dot) return;
  const n = unreadNotifCount();
  const wasOn = dot.classList.contains("is-on");
  dot.classList.toggle("is-on", n > 0);
  const trigger = document.getElementById("notif-trigger");
  if (trigger)
    trigger.setAttribute(
      "aria-label",
      n ? `Notifications, ${n} unread` : "Notifications"
    );

  // Not on the first paint: arriving at a page with three unread alerts is not
  // three alerts arriving.
  if (LAST_UNREAD_COUNT !== null && n > LAST_UNREAD_COUNT && window.Motion) {
    Motion.ring(document.getElementById("notif-trigger"));
    if (!wasOn) Motion.pop(dot);
  }
  LAST_UNREAD_COUNT = n;
}

function renderNotifPanel() {
  const list = document.getElementById("notif-panel-list");
  if (!list) return;
  if (!NOTIFS.length) {
    list.innerHTML = `<div class="notif-empty">Nothing yet. Urgent feedback flagged by AI and updates on requests you handle will appear here.</div>`;
    return;
  }
  list.innerHTML = NOTIFS.map((n) => {
    // An AI alert is not the same kind of thing as "your clearance is ready",
    // and the list has to say so without being read word by word.
    const urgent = n.kind === "ai_alert";
    // ref is "feedback:23" — the row it came from, so the bell can put the
    // officer in front of it instead of merely telling them it exists.
    const ref = String(n.ref || "");
    const target = ref.startsWith("feedback:") ? "feedback" : null;
    return `
      <div class="notif-item${n.is_read ? "" : " is-unread"}${urgent ? " is-urgent" : ""}"
           ${target ? `onclick="openNotifTarget('${target}')" role="button" tabindex="0"` : ""}>
        <div class="notif-item-icon"><i data-icon=${urgent ? "triangle-alert" : "bell"}></i></div>
        <div class="notif-item-body">
          <div class="notif-item-title">${aiEscape(n.title || "")}</div>
          ${n.body ? `<div class="notif-item-text">${aiEscape(n.body)}</div>` : ""}
          <div class="notif-item-when">${aiEscape(notifWhen(n.created_at))}</div>
        </div>
      </div>`;
  }).join("");
  if (typeof hydrateIcons === "function") hydrateIcons(list);
}

function openNotifTarget(module) {
  closeNotifPanel();
  // Already there — the alert board and the Needs Attention queue are both on
  // screen, so a navigation would only flicker.
  if (window.CURRENT_PAGE === module) return;
  nav(null, module);
}

async function loadNotifications() {
  const id = actingAccountId();
  if (!id || typeof apiGet !== "function") return;
  try {
    NOTIFS = (await apiGet(`/api/notifications?account_id=${encodeURIComponent(id)}&limit=25`)) || [];
  } catch (e) {
    return; // offline — keep whatever the bell last showed
  }
  renderNotifDot();
  if (NOTIF_OPEN) renderNotifPanel();
}

function closeNotifPanel() {
  NOTIF_OPEN = false;
  const panel = document.getElementById("notif-panel");
  if (panel) panel.classList.remove("open");
  const trigger = document.getElementById("notif-trigger");
  if (trigger) trigger.setAttribute("aria-expanded", "false");
  document.removeEventListener("click", notifOutsideClick, true);
}

function notifOutsideClick(e) {
  const menu = document.getElementById("notif-menu");
  if (menu && !menu.contains(e.target)) closeNotifPanel();
}

function toggleNotif() {
  const panel = document.getElementById("notif-panel");
  if (!panel) return;
  if (NOTIF_OPEN) return closeNotifPanel();

  NOTIF_OPEN = true;
  panel.classList.add("open");
  const trigger = document.getElementById("notif-trigger");
  if (trigger) trigger.setAttribute("aria-expanded", "true");
  renderNotifPanel();
  // Refresh on open as well as on the timer: the officer pressing the bell is
  // asking "is there anything new right now?", and the answer should not be up
  // to 60 seconds old.
  loadNotifications();
  // Registered on the next tick so the click that opened the panel does not
  // immediately close it again.
  setTimeout(() => document.addEventListener("click", notifOutsideClick, true), 0);
}

// Deliberately does NOT fire on open. Marking everything read the moment the
// panel is glanced at loses the unread state for anything the officer scrolled
// past — the dot is the only signal they have, and it should end when they say
// so, not when the panel happens to be shown.
async function markAllNotificationsRead() {
  const id = actingAccountId();
  if (!id) return;
  try {
    await apiPost("/api/notifications/read-all", { account_id: id });
  } catch (err) {
    showToast(err.message || "Could not mark as read", "<i data-icon=triangle-alert></i>");
    return;
  }
  NOTIFS = NOTIFS.map((n) => Object.assign({}, n, { is_read: true }));
  renderNotifDot();
  renderNotifPanel();
}

// ════════════════════ MISC ════════════════════

// ════════════════════ BOOTSTRAP ════════════════════
document.addEventListener("DOMContentLoaded", () => {
  const session = getSession();
  if (session) {
    applySessionToApp(session);
    // Officers: pull the module-access overrides and hide anything revoked.
    // Loads for everyone (harmless) so a role change mid-session is honored.
    loadModuleAccess();
    // Same for the "Delete Records" permission — it decides whether the record
    // pages render their per-row Delete buttons at all.
    loadDeletePermissions();
    // Live counts for the sidebar pills, refreshed while the tab is open so a
    // request approved on another device stops showing here as outstanding.
    refreshNavBadges();
    setInterval(refreshNavBadges, 60000);
    // The bell, on the same cadence and for the same reason: an urgent alert
    // raised while somebody is sitting on the Residency page should reach them
    // there, not wait until they next open the dashboard.
    loadNotifications();
    setInterval(loadNotifications, 60000);
    if (typeof renderPage === "function") {
      renderPage();
    }
  } else {
    const loginScreen = document.getElementById("login-screen");
    const app = document.getElementById("app");
    if (loginScreen) {
      loginScreen.style.display = "flex";
      loginScreen.classList.remove("hidden");
    }
    if (app) app.style.display = "none";
  }
});
