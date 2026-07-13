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

// ════════════════════ ROLE SELECTION ════════════════════
function selectRole(el, role) {
  document
    .querySelectorAll(".role-chip")
    .forEach((c) => c.classList.remove("active"));
  el.classList.add("active");
  currentRole = role;
}

// ════════════════════ LOGIN ════════════════════
function doLogin() {
  const user = document.getElementById("login-user").value.trim() || "User";
  const names = {
    Admin: "Juan D. Administrator",
    Officer: "Maria R. Officer",
    Resident: "Pedro S. Santos",
  };
  const initials = { Admin: "JD", Officer: "MR", Resident: "PS" };
  const displayName = names[currentRole];
  const init = initials[currentRole];
  const shortName = displayName.split(" ").slice(0, 2).join(" ");

  setSession({
    role: currentRole,
    displayName,
    shortName,
    initials: init,
    user,
  });

  if (typeof logAudit === "function")
    logAudit("LOGIN", `${displayName} signed in as ${currentRole} (${user})`, "info", "auth");

  if (currentRole === "Resident") {
    window.location.href = "../index.html";
  } else {
    window.location.href = "pages/dashboard.html";
  }
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
  if (service === "residency") renderResidentResults("");
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
  setContent(`
    <div class="resident-portal">
      <div class="portal-welcome">
        <div class="portal-welcome-content">
          <h2>Mabuhay, <span class="gold">Pedro S. Santos</span>!</h2>
          <p>Welcome to the Barangay Conde Labac Resident Portal. Access your barangay services below — request certificates, file reports, and stay connected with your community.</p>
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
const RESIDENTS_DATA = [
  {
    name: "Santos, Pedro J.",
    age: 34,
    purok: "Purok 1",
    cat: "",
    status: "Active",
  },
  {
    name: "dela Cruz, Maria L.",
    age: 67,
    purok: "Purok 2",
    cat: "Senior Citizen",
    status: "Active",
  },
  {
    name: "Reyes, Jose B.",
    age: 45,
    purok: "Purok 3",
    cat: "Indigent Family",
    status: "Active",
  },
  {
    name: "Aquino, Ana M.",
    age: 29,
    purok: "Purok 1",
    cat: "Solo Parent",
    status: "Active",
  },
  {
    name: "Bautista, Carlos F.",
    age: 52,
    purok: "Purok 4",
    cat: "PWD",
    status: "Active",
  },
  {
    name: "Villanueva, Rosa T.",
    age: 78,
    purok: "Purok 5",
    cat: "Senior Citizen",
    status: "Active",
  },
  {
    name: "Garcia, Luis N.",
    age: 38,
    purok: "Purok 2",
    cat: "",
    status: "Active",
  },
  {
    name: "Mendoza, Elena P.",
    age: 44,
    purok: "Purok 3",
    cat: "Indigent Family",
    status: "Inactive",
  },
  {
    name: "Santos, Juan R.",
    age: 22,
    purok: "Purok 1",
    cat: "",
    status: "Active",
  },
  {
    name: "Cruz, Nora T.",
    age: 61,
    purok: "Purok 5",
    cat: "Senior Citizen",
    status: "Active",
  },
];

function filterResidents() {
  const nameQ =
    document.getElementById("res-search-name")?.value.toLowerCase() || "";
  const purokQ = document.getElementById("res-search-purok")?.value || "";
  const catQ = document.getElementById("res-search-cat")?.value || "";
  const statusQ = document.getElementById("res-search-status")?.value || "";
  const filtered = RESIDENTS_DATA.filter((r) => {
    return (
      (!nameQ || r.name.toLowerCase().includes(nameQ)) &&
      (!purokQ || r.purok === purokQ.split(" — ")[0] || purokQ === "") &&
      (!catQ || r.cat === catQ) &&
      (!statusQ || r.status === statusQ)
    );
  });
  renderResidentResults(filtered);
}

function renderResidentResults(filtered) {
  const list = Array.isArray(filtered) ? filtered : RESIDENTS_DATA;
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
      .map(
        (r) => `
      <div class="resident-card">
        <div class="resident-avatar-sm">${r.name.split(",")[1]?.trim()[0] || "?"}${r.name.split(",")[0][0]}</div>
        <div class="resident-info">
          <h4>${r.name}</h4>
          <p>${r.age} yrs · ${r.purok}${r.cat ? " · " + r.cat : ""}</p>
        </div>
        <span class="badge ${r.status === "Active" ? "badge-success" : "badge-gray"} badge-align-right">${r.status}</span>
      </div>`,
      )
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
function accNextStep() {
  if (accStep === 1) {
    const fname = document.getElementById("acc-fname").value.trim();
    const lname = document.getElementById("acc-lname").value.trim();
    if (!fname || !lname) {
      alert("Please fill in your name to continue.");
      return;
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
    if (typeof logAudit === "function") {
      const fname = document.getElementById("acc-fname").value.trim();
      const lname = document.getElementById("acc-lname").value.trim();
      logAudit("ACC_CLAIM_SUBMIT", `Account claim submitted by ${fname} ${lname} <${email}> (Ref: ACC-2025-0048)`, "info", "auth");
    }
    showToast("Account request submitted! Ref: ACC-2025-0048", "<i data-icon=key></i>");
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
