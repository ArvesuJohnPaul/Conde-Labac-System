// ════════════════════ STATE ════════════════════
let currentRole = "Admin";
let currentModule = "dashboard";
let charts = {};
let accStep = 1;
let selectedCert = "Barangay Clearance";
let feedbackRating = 4;
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
    // Resident: no sidebar, no topbar
    if (sidebar) sidebar.classList.add("hidden");
    if (topbar) topbar.style.display = "none";
    if (main) main.classList.remove("with-sidebar");
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

function doLogout() {
  const session = getSession();
  // Log before the session is cleared so the entry still knows who left.
  if (typeof logAudit === "function")
    logAudit("LOGOUT", `${session?.displayName || "User"} signed out`, "info", "auth");
  clearSession();
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
  users: ["Admin"],
  audit: ["Admin"],
  archive: ["Admin"],
};

function nav(el, module) {
  const dest = PAGE_MAP[module];
  const session = getSession();
  const role = session ? session.role : null;

  // Enforce client-side RBAC for navigation
  const allowed = modulePermissions[module];
  if (allowed && (!role || allowed.indexOf(role) === -1)) {
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

// Simulated AI summary generator (UI hook)
function generateAiSummary(scope = "dashboard") {
  showToast("Generating AI summary...", "<i data-icon=sparkles></i>");
  console.log("[generateAiSummary] scope=", scope);

  // Simulate async AI call
  setTimeout(() => {
    const summary =
      "AI Summary: Recent incidents show clustering in Purok 3; recommend resource allocation and a targeted community outreach.";
    showToast("AI Summary generated", "<i data-icon=pencil></i>");
    // If there's a dashboard placeholder, inject the text
    const el = document.getElementById("ai-summary-text");
    if (el) el.textContent = summary;
    console.log("[generateAiSummary] result=", summary);
  }, 1200);
}

// ════════════════════ SERVICE POPUP HELPERS ════════════════════
function openServicePopup(service) {
  // The blotter/incident service is the unified "File an Incident / Concern"
  // modal (js/incident-report.js) — it builds its own body and embedded map.
  if (service === "incidents" && typeof openIncidentModal === "function") {
    openIncidentModal();
    return;
  }
  document.getElementById("modal-" + service).classList.add("open");
  if (service === "residency") loadSearchResidents();
  if (service === "accounts") resetAccountClaiming();
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
          <div class="service-card sc-gold" onclick="openMyRequests()">
            <div class="service-icon-wrap"><i data-icon=file-text></i></div>
            <div>
              <div class="service-title">My Requests</div>
              <div class="service-desc">Track the status of the certificates and clearances you requested.</div>
            </div>
            <div class="service-arrow">Track requests <i data-icon=arrow-right></i></div>
          </div>
          <div class="service-card sc-red" onclick="openActivityHistory()">
            <div class="service-icon-wrap"><i data-icon=clock></i></div>
            <div>
              <div class="service-title">Activity History</div>
              <div class="service-desc">See the incident reports you filed and the feedback you have given.</div>
            </div>
            <div class="service-arrow">View history <i data-icon=arrow-right></i></div>
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

        <div class="services-grid">
          <div class="service-card sc-blue" onclick="openServicePopup('residency')">
            <div class="service-icon-wrap"><i data-icon=houses></i></div>
            <div>
              <div class="service-title">Barangay Residency</div>
              <div class="service-desc">Search and view resident records and purok listings within Barangay Conde Labac.</div>
            </div>
            <div class="service-arrow">Search residents <i data-icon=arrow-right></i></div>
          </div>

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
// The resident-search popup is now backed by the live API (same /api/residents
// the residency page uses), replacing the old hardcoded RESIDENTS_DATA.
let SEARCH_RESIDENTS = [];
const SEARCH_CAT_LABELS = {
  senior: "Senior Citizen",
  pwd: "PWD",
  "solo-parent": "Solo Parent",
  indigent: "Indigent Family",
};

function escResident(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

// Fetch residents when the search popup opens, then render.
async function loadSearchResidents() {
  const container = document.getElementById("resident-results");
  if (typeof apiGet !== "function") {
    if (container)
      container.innerHTML =
        '<div class="resident-empty">Search is unavailable (API not loaded on this page).</div>';
    return;
  }
  if (container)
    container.innerHTML =
      '<div class="resident-summary">Loading residents…</div>';
  try {
    SEARCH_RESIDENTS = await apiGet("/api/residents");
    filterResidents();
  } catch (err) {
    if (container)
      container.innerHTML =
        '<div class="resident-empty">Could not reach the server (' +
        escResident(err && err.message ? err.message : "error") +
        ").</div>";
  }
}

function filterResidents() {
  const nameQ =
    document.getElementById("res-search-name")?.value.toLowerCase() || "";
  const purokQ = document.getElementById("res-search-purok")?.value || "";
  const catQ = document.getElementById("res-search-cat")?.value || "";
  const statusQ = document.getElementById("res-search-status")?.value || "";
  const filtered = SEARCH_RESIDENTS.filter((r) => {
    const catLabels = (r.cats || []).map((c) => SEARCH_CAT_LABELS[c] || c);
    // "Active" = account claimed (only); anything else = unclaimed.
    const statusLabel = r.claimed === true ? "Active" : "Unclaimed";
    return (
      (!nameQ || (r.name || "").toLowerCase().includes(nameQ)) &&
      // purok option is e.g. "Purok 1 Sitio Maliwanag"; API purok is "Purok 1".
      (!purokQ || (r.purok && purokQ.indexOf(r.purok) === 0)) &&
      (!catQ || catLabels.indexOf(catQ) !== -1) &&
      (!statusQ || statusLabel === statusQ)
    );
  });
  renderResidentResults(filtered);
}

function renderResidentResults(filtered) {
  const list = Array.isArray(filtered) ? filtered : SEARCH_RESIDENTS;
  const container = document.getElementById("resident-results");
  if (!container) return;
  if (list.length === 0) {
    container.innerHTML =
      '<div class="resident-empty">No residents found matching your search criteria.</div>';
    return;
  }
  container.innerHTML =
    `<div class="resident-summary">Showing ${list.length} result${list.length !== 1 ? "s" : ""}</div>` +
    list
      .map((r) => {
        const claimed = r.claimed === true;
        const catLabel = (r.cats || [])
          .map((c) => SEARCH_CAT_LABELS[c] || c)
          .join(", ");
        const parts = (r.name || "").split(",");
        const initials =
          ((parts[1] ? parts[1].trim()[0] : "") +
            (parts[0] ? parts[0][0] : "")) ||
          "?";
        return `
      <div class="resident-card">
        <div class="resident-avatar-sm">${escResident(initials)}</div>
        <div class="resident-info">
          <h4>${escResident(r.name)}</h4>
          <p>${r.age == null ? "—" : r.age + " yrs"} · ${escResident(r.purok || "—")}${catLabel ? " · " + escResident(catLabel) : ""}</p>
        </div>
        <span class="badge ${claimed ? "badge-success" : "badge-gray"} badge-align-right">${claimed ? "Active" : "Unclaimed"}</span>
      </div>`;
      })
      .join("");
}

function exportResidents() {
  showToast("Exporting results as CSV...", "<i data-icon=download></i>");
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

function submitCertificate() {
  const fname = document.getElementById("cert-fname").value.trim();
  const lname = document.getElementById("cert-lname").value.trim();
  if (!fname || !lname) {
    alert("Please enter your first and last name.");
    return;
  }
  closeServiceModal("certificates");
  if (typeof logAudit === "function")
    logAudit("CERT_REQUEST", `${selectedCert} requested by ${fname} ${lname} (Ref: CERT-2025-088)`, "info", "certificate");
  showToast(`${selectedCert} request submitted! Ref: CERT-2025-088`, "<i data-icon=file-text></i>");
}

// ════════════════════ BLOTTER MODAL LOGIC ════════════════════
function submitBlotter() {
  const narration = document.getElementById("inc-narration").value.trim();
  if (!narration) {
    alert("Please provide a narration of the incident.");
    return;
  }
  closeServiceModal("incidents");
  if (typeof logAudit === "function")
    logAudit("BLOTTER_SUBMIT", `Blotter/incident report filed (Case No: INC-2025-042)`, "info", "concern");
  showToast("Blotter report submitted! Case No: INC-2025-042", "<i data-icon=siren></i>");
}

// ════════════════════ FEEDBACK MODAL LOGIC ════════════════════
const ratingLabels = ["", "Very Poor", "Poor", "Average", "Good", "Excellent"];
function setRating(n) {
  feedbackRating = n;
  document.querySelectorAll(".star").forEach((s, i) => {
    s.classList.toggle("active", i < n);
  });
  document.getElementById("rating-label").textContent =
    `${n} out of 5 — ${ratingLabels[n]}`;
}

function submitFeedback() {
  const comment = document.getElementById("fb-comment").value.trim();
  if (!comment) {
    alert("Please enter a comment or suggestion.");
    return;
  }
  const category = document.getElementById("fb-category")?.value || "Other";
  const name = document.getElementById("fb-name")?.value.trim() || "";
  const contact = document.getElementById("fb-contact")?.value.trim() || "";
  // Persist so the submission shows up in the Feedback page's Recent list.
  if (window.FeedbackStore)
    FeedbackStore.add({ rating: feedbackRating, category, comment, name, contact });
  closeServiceModal("feedback");
  if (typeof logAudit === "function")
    logAudit("FEEDBACK_SUBMIT", `Feedback submitted — rated ${feedbackRating}/5 (${ratingLabels[feedbackRating]})`, "info", "feedback");
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
    const fname = document.getElementById("acc-fname").value.trim();
    const lname = document.getElementById("acc-lname").value.trim();
    const dob = document.getElementById("acc-dob")?.value || "";
    if (!fname || !lname) {
      alert("Please fill in your name to continue.");
      return;
    }
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
          resultEl.innerHTML = `<div class="alert alert-success"><span class="alert-icon"><i data-icon=check></i></span> <strong>Record found:</strong> ${accVerifiedResident.name}${accVerifiedResident.purok ? " · " + accVerifiedResident.purok : ""}${accVerifiedResident.household_no ? " · Household " + accVerifiedResident.household_no : ""}</div>`;
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
    const email = document.getElementById("acc-email").value.trim();
    const pass = document.getElementById("acc-pass").value;
    const pass2 = document.getElementById("acc-pass2").value;
    if (!email) {
      alert("Please enter your email address.");
      return;
    }
    if (pass !== pass2) {
      alert("Passwords do not match.");
      return;
    }
    if (pass.length < 8) {
      alert("Password must be at least 8 characters.");
      return;
    }
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
        alert("Could not claim account: " + err.message);
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

// ════════════════════ MISC ════════════════════
function toggleNotif() {
  showToast("3 new notifications", "<i data-icon=bell></i>");
}

// ════════════════════ BOOTSTRAP ════════════════════
document.addEventListener("DOMContentLoaded", () => {
  const session = getSession();
  if (session) {
    applySessionToApp(session);
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
