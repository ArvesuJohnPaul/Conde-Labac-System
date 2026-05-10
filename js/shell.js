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
  const user =
    document.getElementById("login-user").value.trim() || "User";
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

  // Update navbar user pill
  const navPill = document.getElementById("nav-user-pill");
  if (navPill) navPill.style.display = "flex";
  const navName = document.getElementById("nav-user-name");
  if (navName) navName.textContent = shortName;
  const navAvatar = document.getElementById("nav-avatar");
  if (navAvatar) navAvatar.textContent = init;

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
  clearSession();
  window.location.href = "../index.html";
}

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
    sub: "Household registration & verification",
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
  dashboard:    "dashboard.html",
  residency:    "residency.html",
  certificates: "certificates.html",
  incidents:    "incidents.html",
  feedback:     "feedback.html",
  gis:          "gis.html",
  accounts:     "accounts.html",
  analytics:    "analytics.html",
  users:        "users.html",
  audit:        "audit.html",
  archive:      "archive.html",
};

function nav(el, module) {
  const dest = PAGE_MAP[module];
  if (dest) {
    window.location.href = dest; // relative within pages/
  }
}

function setContent(html) {
  document.getElementById("page-content").innerHTML = html;
}

// ════════════════════ TOAST ════════════════════
function showToast(msg, icon = "✓") {
  const t = document.getElementById("toast");
  document.getElementById("toast-msg").textContent = msg;
  document.getElementById("toast-icon").textContent = icon;
  t.style.transform = "translateY(0)";
  t.style.opacity = "1";
  setTimeout(() => {
    t.style.transform = "translateY(100px)";
    t.style.opacity = "0";
  }, 3500);
}

// ════════════════════ GIS MAP ════════════════════
const gisMaps = {};
const gisHouseholds = [
  { lat: 13.8784, lng: 121.0832, name: "Household #001", zone: "A" },
  { lat: 13.8794, lng: 121.0842, name: "Household #002", zone: "B" },
  { lat: 13.8774, lng: 121.0822, name: "Household #003", zone: "C" },
];

function initGisMap(targetId) {
  const el = document.getElementById(targetId);
  if (!el || typeof L === "undefined") return;

  if (!gisMaps[targetId]) {
    const map = L.map(targetId).setView([13.8784, 121.0832], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    gisHouseholds.forEach((h) => {
      L.marker([h.lat, h.lng])
        .bindPopup(`<strong>${h.name}</strong><br>Zone ${h.zone}`)
        .addTo(map);
    });

    // FIX: .addTo(map) must come before .openPopup() so the popup shows on load
    L.marker([13.8784, 121.0832])
      .bindPopup("Conde Labac, Batangas City - Barangay Center")
      .addTo(map)
      .openPopup();

    gisMaps[targetId] = map;
  }

  setTimeout(() => {
    gisMaps[targetId]?.invalidateSize();
  }, 50);
}

// ════════════════════ SERVICE POPUP HELPERS ════════════════════
function openServicePopup(service) {
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
            <div class="service-icon-wrap">🏘️</div>
            <div>
              <div class="service-title">Barangay Residency</div>
              <div class="service-desc">Search and view resident records, household information, and purok listings within Barangay Conde Labac.</div>
            </div>
            <div class="service-arrow">Search residents →</div>
          </div>

          <div class="service-card sc-gold" onclick="openServicePopup('certificates')">
            <div class="service-icon-wrap">📄</div>
            <div>
              <div class="service-title">Certificate Issuance</div>
              <div class="service-desc">Request Barangay Clearances, Certificates of Indigency, Residency, Good Moral, Business Clearance, and more.</div>
            </div>
            <div class="service-arrow">Request certificate →</div>
          </div>

          <div class="service-card sc-red" onclick="openServicePopup('incidents')">
            <div class="service-icon-wrap">🚨</div>
            <div>
              <div class="service-title">Blotter Reporting</div>
              <div class="service-desc">File an incident report for complaints, disputes, altercations, vandalism, or other concerns happening in the barangay.</div>
            </div>
            <div class="service-arrow">File a report →</div>
          </div>

          <div class="service-card sc-green" onclick="openServicePopup('feedback')">
            <div class="service-icon-wrap">💬</div>
            <div>
              <div class="service-title">Feedback</div>
              <div class="service-desc">Share your comments, suggestions, or concerns about barangay services. Your voice helps improve governance.</div>
            </div>
            <div class="service-arrow">Give feedback →</div>
          </div>

          <div class="service-card sc-purple" onclick="openServicePopup('gis')">
            <div class="service-icon-wrap">🗺️</div>
            <div>
              <div class="service-title">GIS Map</div>
              <div class="service-desc">View the interactive map of Barangay Conde Labac — showing puroks, hazard zones, health centers, and key landmarks.</div>
            </div>
            <div class="service-arrow">View map →</div>
          </div>

          <div class="service-card sc-teal" onclick="openServicePopup('accounts')">
            <div class="service-icon-wrap">🔑</div>
            <div>
              <div class="service-title">Account Claiming</div>
              <div class="service-desc">Already registered in the barangay system? Claim your account to access personalized services and track your requests.</div>
            </div>
            <div class="service-arrow">Claim account →</div>
          </div>
        </div>
      </div>

      <!-- Notices -->
      <div class="notice-card">
        <div class="notice-title">📢 Barangay Notices</div>
        <div class="alert alert-warning"><span class="alert-icon">⚑</span> <strong>Flood Advisory:</strong> Purok 3 residents — please monitor weather conditions. Pre-positioned relief goods at Brgy Hall.</div>
        <div class="alert alert-info"><span class="alert-icon">ℹ</span> <strong>Certificate Processing:</strong> Regular processing hours are Mon–Fri, 8:00 AM – 5:00 PM.</div>
        <div class="alert alert-success"><span class="alert-icon">✓</span> <strong>Free Medical Mission:</strong> May 15, 2025 at the Barangay Health Center. Walk-ins welcome.</div>
      </div>
    </div>
  `);
}

// ════════════════════ RESIDENCY MODAL LOGIC ════════════════════
const RESIDENTS_DATA = [
  { name: "Santos, Pedro J.",    age: 34, purok: "Purok 1", household: "HH-0042", cat: "",               status: "Active"   },
  { name: "dela Cruz, Maria L.", age: 67, purok: "Purok 2", household: "HH-0081", cat: "Senior Citizen",  status: "Active"   },
  { name: "Reyes, Jose B.",      age: 45, purok: "Purok 3", household: "HH-0156", cat: "4Ps Beneficiary", status: "Active"   },
  { name: "Aquino, Ana M.",      age: 29, purok: "Purok 1", household: "HH-0033", cat: "Solo Parent",     status: "Active"   },
  { name: "Bautista, Carlos F.", age: 52, purok: "Purok 4", household: "HH-0204", cat: "PWD",             status: "Active"   },
  { name: "Villanueva, Rosa T.", age: 78, purok: "Purok 5", household: "HH-0312", cat: "Senior Citizen",  status: "Active"   },
  { name: "Garcia, Luis N.",     age: 38, purok: "Purok 2", household: "HH-0098", cat: "",               status: "Active"   },
  { name: "Mendoza, Elena P.",   age: 44, purok: "Purok 3", household: "HH-0177", cat: "4Ps Beneficiary", status: "Inactive" },
  { name: "Santos, Juan R.",     age: 22, purok: "Purok 1", household: "HH-0044", cat: "",               status: "Active"   },
  { name: "Cruz, Nora T.",       age: 61, purok: "Purok 5", household: "HH-0298", cat: "Senior Citizen",  status: "Active"   },
];

function filterResidents() {
  const nameQ   = document.getElementById("res-search-name")?.value.toLowerCase() || "";
  const purokQ  = document.getElementById("res-search-purok")?.value || "";
  const catQ    = document.getElementById("res-search-cat")?.value || "";
  const statusQ = document.getElementById("res-search-status")?.value || "";
  const filtered = RESIDENTS_DATA.filter((r) => {
    return (
      (!nameQ   || r.name.toLowerCase().includes(nameQ)) &&
      (!purokQ  || r.purok === purokQ.split(" — ")[0] || purokQ === "") &&
      (!catQ    || r.cat === catQ) &&
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
          <p>${r.age} yrs · ${r.purok} · ${r.household}${r.cat ? " · " + r.cat : ""}</p>
        </div>
        <span class="badge ${r.status === "Active" ? "badge-success" : "badge-gray"} badge-align-right">${r.status}</span>
      </div>`
      )
      .join("");
}

function exportResidents() {
  showToast("Exporting results as CSV...", "⬇");
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
  showToast(`${selectedCert} request submitted! Ref: CERT-2025-088`, "📄");
}

// ════════════════════ BLOTTER MODAL LOGIC ════════════════════
function submitBlotter() {
  const narration = document.getElementById("inc-narration").value.trim();
  if (!narration) {
    alert("Please provide a narration of the incident.");
    return;
  }
  closeServiceModal("incidents");
  showToast("Blotter report submitted! Case No: INC-2025-042", "🚨");
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
  closeServiceModal("feedback");
  showToast("Feedback submitted! Thank you for your input.", "💬");
}

// ════════════════════ GIS LAYER TOGGLE ════════════════════
function setGisLayer(el, layer) {
  document
    .querySelectorAll(".gis-filter-btn")
    .forEach((b) => b.classList.remove("active"));
  el.classList.add("active");
  const labels = {
    all:        "All layers shown",
    households: "Household markers shown",
    hazard:     "Hazard zones highlighted",
    seniors:    "Senior citizen locations shown",
    pwd:        "PWD household markers shown",
    "4ps":      "4Ps beneficiary households shown",
  };
  showToast(labels[layer] || "Layer updated", "🗺️");
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
    document.getElementById("step-1-dot").textContent = "✓";
    document.getElementById("step-2-dot").style.background = "var(--navy)";
    document.getElementById("step-2-dot").style.color = "#fff";
    document.getElementById("step-line-1").style.background = "#22c55e";
    document.getElementById("acc-next-btn").textContent = "Create Account →";
    accStep = 2;
  } else if (accStep === 2) {
    const email = document.getElementById("acc-email").value.trim();
    const pass  = document.getElementById("acc-pass").value;
    const pass2 = document.getElementById("acc-pass2").value;
    if (!email) { alert("Please enter your email address."); return; }
    if (pass !== pass2) { alert("Passwords do not match."); return; }
    if (pass.length < 8) { alert("Password must be at least 8 characters."); return; }
    document.getElementById("acc-step-2").classList.add("is-hidden");
    document.getElementById("acc-step-3").classList.remove("is-hidden");
    document.getElementById("step-2-dot").style.background = "#22c55e";
    document.getElementById("step-2-dot").textContent = "✓";
    document.getElementById("step-3-dot").style.background = "var(--navy)";
    document.getElementById("step-3-dot").style.color = "#fff";
    document.getElementById("step-line-2").style.background = "#22c55e";
    document.getElementById("acc-footer").innerHTML =
      '<button class="btn btn-gold" onclick="closeServiceModal(\'accounts\')">Done ✓</button>';
    accStep = 3;
    showToast("Account request submitted! Ref: ACC-2025-0048", "🔑");
  }
}

// ════════════════════ MISC ════════════════════
function toggleNotif() {
  showToast("3 new notifications", "🔔");
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
