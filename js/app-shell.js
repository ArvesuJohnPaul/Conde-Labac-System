// ════════════════════ APP SHELL ════════════════════
// Renders the MIS chrome — sidebar, topbar, module launcher, mobile drawer —
// into the empty #app element on every page under pages/.
//
// WHY THIS EXISTS
// Each of the eleven module pages used to carry its own ~200-line copy of the
// navbar + sidebar + topbar. Eleven copies meant eleven places to edit and
// eleven chances to drift; they had already drifted (stale topbar titles that
// shell.js overwrote at runtime, an "Account Claiming" subtitle that said
// "Household registration" on one page and "Resident registration" on
// another). The markup now lives here once.
//
// CONTRACT WITH shell.js
// shell.js is unchanged in how it finds things: it queries #sidebar, #topbar,
// #main, #page-content, #topbar-title/#topbar-sub, #sidebar-user/#sidebar-role/
// #sidebar-avatar, the #nav-user-* cluster, and every .nav-item /
// .topbar-module-item by their onclick="nav(this|null, 'module')" attribute
// (applyOfficerModuleVisibility parses that string). All of it is reproduced
// verbatim below — this file changes the shell's looks and structure, not the
// selectors anything else depends on.
//
// ORDERING
// Loaded as a plain <script> before shell.js, so it renders during parse and
// every element exists well before shell.js's DOMContentLoaded handler runs.
(function () {
  "use strict";

  var COLLAPSE_KEY = "cares.sidebar_collapsed";

  // Module registry. Order here is the order in the sidebar and the launcher.
  // `id` must match shell.js's PAGE_MAP / moduleConfig / modulePermissions.
  var SECTIONS = [
    {
      label: "Core Services",
      items: [
        { id: "dashboard", icon: "home", label: "Dashboard" },
        { id: "residency", icon: "houses", label: "Barangay Residency" },
        // `badge` names the element id shell.js's refreshNavBadges() fills from
        // GET /api/stats/dashboard. They render empty on purpose — CSS hides an
        // empty .nav-badge, so nothing flashes a placeholder count before the
        // real one lands, and a module with nothing outstanding shows no pill.
        {
          id: "certificates",
          icon: "file-text",
          label: "Certificate Processing",
          badge: "cert-badge",
        },
        {
          id: "incidents",
          icon: "siren",
          label: "Blotter / Incidents",
          badge: "inc-badge",
        },
        {
          id: "feedback",
          icon: "message-square",
          label: "Feedback",
          badge: "fb-badge",
        },
        { id: "gis", icon: "map", label: "GIS Mapping" },
        {
          id: "accounts",
          icon: "key",
          label: "Account Claiming",
          badge: "acc-badge",
        },
        { id: "analytics", icon: "chart", label: "Analytics" },
        { id: "content", icon: "pencil", label: "Site Content" },
      ],
    },
    {
      label: "Administration",
      items: [
        { id: "users", icon: "users", label: "User Management" },
        { id: "audit", icon: "clipboard", label: "Audit Logs" },
        { id: "archive", icon: "archive", label: "Archive" },
      ],
    },
  ];

  // Titles shown before shell.js re-applies them from its own moduleConfig.
  // Duplicated deliberately: rendering the right title during parse avoids a
  // one-frame flash of the wrong page name on every navigation.
  var TITLES = {
    dashboard: ["Dashboard", "Overview & KPIs"],
    residency: ["Barangay Residency", "Resident records & search"],
    certificates: ["Certificate Processing", "Request management"],
    incidents: ["Blotter / Incidents", "Emergency logging & tracking"],
    feedback: ["Feedback", "Resident sentiment & trends"],
    gis: ["GIS Mapping", "Interactive zone & hazard view"],
    accounts: ["Account Claiming", "Resident registration & verification"],
    analytics: ["Analytics", "Predictive insights & trend charts"],
    content: ["Site Content", "Announcements & barangay officials"],
    users: ["User Management", "Roles & access control"],
    audit: ["Audit Logs", "System activity & compliance"],
    archive: ["Archive", "Records retention & backup"],
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }

  function ico(name) {
    return '<i data-icon="' + name + '"></i>';
  }

  // ── Sidebar ────────────────────────────────────────────────────────────
  // .nav-item keeps its onclick="nav(this, 'id')" string because
  // applyOfficerModuleVisibility() regex-matches it to hide revoked modules,
  // and applySessionToApp() matches it to set .active.
  function sidebarNav(active) {
    return SECTIONS.map(function (sec) {
      var items = sec.items
        .map(function (m) {
          var badge = m.badge
            ? '<span class="nav-badge" id="' +
              m.badge +
              '">' +
              esc(m.badgeText || "") +
              "</span>"
            : "";
          return (
            '<button type="button" class="nav-item' +
            (m.id === active ? " active" : "") +
            '" onclick="nav(this, \'' +
            m.id +
            "')\" data-module=\"" +
            m.id +
            '"' +
            (m.id === active ? ' aria-current="page"' : "") +
            ">" +
            '<span class="nav-icon">' +
            ico(m.icon) +
            "</span>" +
            '<span class="nav-label">' +
            esc(m.label) +
            "</span>" +
            badge +
            // Duplicates the label for the collapsed rail's hover tooltip.
            // aria-hidden, or the button's accessible name reads the module
            // name twice ("Dashboard Dashboard").
            '<span class="nav-tip" aria-hidden="true">' +
            esc(m.label) +
            "</span>" +
            "</button>"
          );
        })
        .join("");
      return (
        '<div class="sidebar-section">' +
        '<div class="sidebar-section-label">' +
        esc(sec.label) +
        "</div>" +
        items +
        "</div>"
      );
    }).join("");
  }

  function sidebarMarkup(active) {
    return (
      '<aside id="sidebar" class="hidden" aria-label="Modules">' +
      '<div class="sidebar-head">' +
      '<a class="sidebar-brand" href="../index.html" title="Back to the public portal">' +
      '<span class="brand-seal">' +
      '<img src="../img/conde%20labac%20logo.png" alt="" />' +
      "</span>" +
      '<span class="brand-name">C.A.R.E.S.' +
      "<span>Conde Labac MIS</span>" +
      "</span>" +
      "</a>" +
      "</div>" +
      '<nav class="sidebar-nav">' +
      sidebarNav(active) +
      "</nav>" +
      '<div class="sidebar-footer">' +
      '<div class="user-pill">' +
      '<span class="user-avatar" id="sidebar-avatar">··</span>' +
      '<span class="user-meta">' +
      '<span class="user-name" id="sidebar-user">Signed in</span>' +
      '<span class="user-role" id="sidebar-role">—</span>' +
      "</span>" +
      '<button type="button" class="logout-btn" onclick="doLogout()" title="Sign out" aria-label="Sign out">' +
      ico("log-out") +
      "</button>" +
      "</div>" +
      "</div>" +
      "</aside>"
    );
  }

  // ── Module launcher ────────────────────────────────────────────────────
  // Same #topbarModulesTrigger / #topbarModulesDropdown / .topbar-module-item
  // contract shell.js's initializeTopbarModulesMenu() wires up. The filter
  // field and ⌘K binding are added here, on top of that untouched contract.
  function launcherMarkup(active) {
    var groups = SECTIONS.map(function (sec) {
      var items = sec.items
        .map(function (m) {
          return (
            '<button type="button" class="topbar-module-item' +
            (m.id === active ? " is-current" : "") +
            '" onclick="nav(null, \'' +
            m.id +
            "')\" data-label=\"" +
            esc(m.label.toLowerCase()) +
            '">' +
            '<span class="topbar-module-icon">' +
            ico(m.icon) +
            "</span>" +
            "<span>" +
            esc(m.label) +
            "</span>" +
            "</button>"
          );
        })
        .join("");
      return (
        '<div class="topbar-modules-group">' +
        '<div class="topbar-modules-section">' +
        esc(sec.label) +
        "</div>" +
        items +
        "</div>"
      );
    }).join("");

    return (
      '<div class="topbar-modules-menu">' +
      '<button type="button" class="topbar-icon-btn" id="topbarModulesTrigger" ' +
      'aria-haspopup="menu" aria-expanded="false" title="Jump to module (Ctrl+K)">' +
      ico("search") +
      '<span class="topbar-kbd">Ctrl K</span>' +
      "</button>" +
      '<div class="topbar-modules-dropdown" id="topbarModulesDropdown" role="menu">' +
      '<div class="topbar-modules-search">' +
      ico("search") +
      '<input type="text" id="moduleFilter" placeholder="Jump to module…" ' +
      'autocomplete="off" spellcheck="false" aria-label="Filter modules" />' +
      "</div>" +
      '<div class="topbar-modules-list">' +
      groups +
      '<p class="topbar-modules-empty" hidden>No module matches that.</p>' +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  // ── Topbar ─────────────────────────────────────────────────────────────
  // One 60px bar replaces the old stacked navbar (64px) + topbar (60px). The
  // public-site navbar was pure duplication inside the MIS — the sidebar
  // already carries the brand and the module list.
  function topbarMarkup(active) {
    var t = TITLES[active] || ["", ""];
    // No initial is-hidden class: #app is display:none until shell.js validates
    // the session, so nothing inside it can paint early anyway. shell.js then
    // sets an inline display on this element for both staff and residents.
    return (
      '<header id="topbar">' +
      '<button type="button" class="topbar-icon-btn" id="sidebarToggle" ' +
      'aria-label="Toggle navigation" aria-controls="sidebar" aria-expanded="true">' +
      '<span class="sidebar-toggle-bars"><span></span><span></span><span></span></span>' +
      "</button>" +
      '<div class="topbar-heading">' +
      '<h1 class="topbar-title" id="topbar-title">' +
      esc(t[0]) +
      "</h1>" +
      '<p class="topbar-subtitle" id="topbar-sub">' +
      esc(t[1]) +
      "</p>" +
      "</div>" +
      '<div class="topbar-right">' +
      launcherMarkup(active) +
      '<span class="topbar-date" id="topbar-date"></span>' +
      '<button type="button" class="topbar-icon-btn" id="themeToggle" aria-label="Change appearance"></button>' +
      // Notifications. Wrapped in a positioned container (the same shape as
      // .nav-user-menu beside it) so the panel can hang off the bell rather
      // than off the topbar — the bell is not the last item in the bar, so a
      // panel positioned against the bar would not line up under it.
      '<div class="notif-menu" id="notif-menu">' +
      '<button type="button" class="topbar-icon-btn" onclick="toggleNotif()" ' +
      'id="notif-trigger" aria-label="Notifications" aria-haspopup="true" ' +
      'aria-expanded="false" aria-controls="notif-panel">' +
      ico("bell") +
      '<span id="notif-dot" class="topbar-notif-dot"></span>' +
      "</button>" +
      '<div class="notif-panel" id="notif-panel" role="region" aria-label="Notifications">' +
      '<div class="notif-panel-head">' +
      '<span class="notif-panel-title">Notifications</span>' +
      '<button type="button" class="card-action" id="notif-mark-read" ' +
      'onclick="markAllNotificationsRead()">Mark all read</button>' +
      "</div>" +
      '<div class="notif-panel-list" id="notif-panel-list"></div>' +
      "</div>" +
      "</div>" +
      '<div class="nav-user-menu is-hidden" id="nav-user-menu">' +
      '<button type="button" class="nav-user-menu-trigger" id="nav-user-trigger" ' +
      'aria-haspopup="menu" aria-expanded="false">' +
      '<span class="nav-user-avatar" id="nav-avatar">··</span>' +
      '<span class="nav-user-name" id="nav-user-name"></span>' +
      '<span class="nav-user-caret">' +
      ico("chevron-down") +
      "</span>" +
      "</button>" +
      '<div class="nav-user-menu-dropdown" id="nav-user-dropdown" role="menu">' +
      '<div class="nav-user-menu-header">' +
      '<span class="nav-user-avatar-lg" id="nav-avatar-lg">··</span>' +
      '<span class="nav-user-menu-info">' +
      '<span class="nav-user-name-full" id="nav-user-name-full">User</span>' +
      '<span class="nav-user-role" id="nav-user-role">—</span>' +
      "</span>" +
      "</div>" +
      // Same merged panel the landing page's burger menu opens (openMyActivity
      // in js/portal-account.js): certificate requests, profile change
      // requests, incident reports and feedback this account filed. Staff have
      // barangay records and file things too, and previously had no way to see
      // their own from inside the MIS.
      '<button type="button" class="nav-user-menu-item" onclick="openMyActivity()">' +
      ico("inbox") +
      " My Activity</button>" +
      '<button type="button" class="nav-user-menu-item" onclick="openPreferences()">' +
      ico("settings") +
      " Settings</button>" +
      '<a class="nav-user-menu-item" href="../index.html">' +
      ico("landmark") +
      " Public portal</a>" +
      '<button type="button" class="nav-user-menu-item nav-user-menu-item-danger" onclick="doLogout()">' +
      ico("log-out") +
      " Sign out</button>" +
      "</div>" +
      "</div>" +
      "</div>" +
      "</header>"
    );
  }

  function shellMarkup(active) {
    return (
      sidebarMarkup(active) +
      '<div class="sidebar-scrim" id="sidebarScrim" hidden></div>' +
      '<div id="main">' +
      topbarMarkup(active) +
      '<main id="page-content" tabindex="-1"></main>' +
      "</div>"
    );
  }

  // ── Behaviour ──────────────────────────────────────────────────────────

  var mqCompact = window.matchMedia("(max-width: 1024px)");

  function isCompact() {
    return mqCompact.matches;
  }

  function readCollapsed() {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  // The class goes on <html> rather than #app so the collapsed width is in
  // effect at first paint — #app is display:none until shell.js applies the
  // session, and a late class swap would show the sidebar snapping shut.
  function applyCollapsed(on) {
    document.documentElement.classList.toggle("sidebar-collapsed", !!on);
    var btn = document.getElementById("sidebarToggle");
    if (btn) btn.setAttribute("aria-expanded", on ? "false" : "true");
  }

  function setCollapsed(on) {
    applyCollapsed(on);
    try {
      localStorage.setItem(COLLAPSE_KEY, on ? "1" : "0");
    } catch (e) {
      // Storage disabled — the preference just doesn't survive the visit.
    }
  }

  function openDrawer(on) {
    var sidebar = document.getElementById("sidebar");
    var scrim = document.getElementById("sidebarScrim");
    if (!sidebar) return;
    sidebar.classList.toggle("mobile-open", !!on);
    document.body.classList.toggle("drawer-open", !!on);
    var btn = document.getElementById("sidebarToggle");
    if (btn) btn.setAttribute("aria-expanded", on ? "true" : "false");
    if (!scrim) return;

    // The sidebar slides out on a transform, so the scrim has to fade out over
    // the same beat — unhiding it is already animated (css/system.css), but
    // `hidden = true` is instant, and the page used to un-dim a frame before
    // the drawer had finished leaving.
    if (on) {
      scrim.classList.remove("is-closing");
      scrim.hidden = false;
      return;
    }
    if (scrim.hidden) return;
    if (!window.Motion || window.Motion.reduced()) {
      scrim.hidden = true;
      return;
    }
    scrim.classList.add("is-closing");
    window.setTimeout(function () {
      // Guard against the drawer having been reopened in the meantime.
      if (!scrim.classList.contains("is-closing")) return;
      scrim.classList.remove("is-closing");
      scrim.hidden = true;
    }, 220);
  }

  function initSidebarToggle() {
    var btn = document.getElementById("sidebarToggle");
    var scrim = document.getElementById("sidebarScrim");
    if (!btn) return;

    btn.addEventListener("click", function () {
      // Same control, two jobs: on a narrow screen the sidebar is an overlay
      // drawer, on a wide one it collapses to an icon rail.
      if (isCompact()) {
        openDrawer(
          !document.getElementById("sidebar").classList.contains("mobile-open")
        );
      } else {
        setCollapsed(!document.documentElement.classList.contains("sidebar-collapsed"));
      }
    });

    if (scrim) scrim.addEventListener("click", function () { openDrawer(false); });

    // Navigating away on mobile should not leave the drawer open behind the
    // next page's paint.
    document.querySelectorAll(".nav-item").forEach(function (item) {
      item.addEventListener("click", function () {
        if (isCompact()) openDrawer(false);
      });
    });

    // Crossing the breakpoint with a drawer open would strand the scrim.
    var onChange = function () {
      if (!isCompact()) openDrawer(false);
    };
    if (typeof mqCompact.addEventListener === "function")
      mqCompact.addEventListener("change", onChange);
    else if (typeof mqCompact.addListener === "function")
      mqCompact.addListener(onChange);
  }

  // ── Module launcher: filtering + keyboard ──────────────────────────────
  function initLauncher() {
    var trigger = document.getElementById("topbarModulesTrigger");
    var dropdown = document.getElementById("topbarModulesDropdown");
    var input = document.getElementById("moduleFilter");
    if (!trigger || !dropdown || !input) return;

    var empty = dropdown.querySelector(".topbar-modules-empty");

    function filter() {
      var q = input.value.trim().toLowerCase();
      var hits = 0;
      dropdown.querySelectorAll(".topbar-module-item").forEach(function (el) {
        // A module the role has no access to is display:none'd by
        // applyOfficerModuleVisibility() in js/shell.js. It can never be a
        // match, or typing its name would count it as a hit and leave its
        // group heading standing over nothing.
        var blocked = el.style.display === "none";
        var match =
          !blocked &&
          (!q || (el.getAttribute("data-label") || "").indexOf(q) !== -1);
        el.hidden = !match;
        if (match) hits++;
      });
      // Hide a group whose every item filtered out, label included.
      dropdown.querySelectorAll(".topbar-modules-group").forEach(function (g) {
        var any = g.querySelector(".topbar-module-item:not([hidden])");
        g.hidden = !any;
      });
      if (empty) empty.hidden = hits > 0;
    }

    input.addEventListener("input", filter);

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var first = dropdown.querySelector(".topbar-module-item:not([hidden])");
        if (first) first.click();
      } else if (e.key === "Escape") {
        close();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        var el = dropdown.querySelector(".topbar-module-item:not([hidden])");
        if (el) el.focus();
      }
    });

    // Roving focus through the visible results.
    dropdown.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      var items = [].slice.call(
        dropdown.querySelectorAll(".topbar-module-item:not([hidden])")
      );
      var i = items.indexOf(document.activeElement);
      if (i === -1) return;
      e.preventDefault();
      var next = e.key === "ArrowDown" ? i + 1 : i - 1;
      if (next < 0) return input.focus();
      if (items[next]) items[next].focus();
    });

    function open() {
      dropdown.classList.add("open");
      trigger.setAttribute("aria-expanded", "true");
      input.value = "";
      filter();
      input.focus();
    }
    function close() {
      dropdown.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
      trigger.focus();
    }

    // shell.js owns the click-to-toggle; this only mirrors the result onto
    // aria and focuses the field, so the launcher works from the keyboard too.
    //
    // The deferral matters: app-shell.js is loaded before shell.js, so its
    // DOMContentLoaded handler — and therefore this listener — runs first.
    // Reading .open synchronously here would see the state from *before*
    // shell.js toggled it, and the field would focus on close instead of open.
    trigger.addEventListener("click", function () {
      setTimeout(function () {
        var isOpen = dropdown.classList.contains("open");
        trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
        if (isOpen) {
          input.value = "";
          filter();
          input.focus();
        }
      }, 0);
    });

    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        if (dropdown.classList.contains("open")) close();
        else open();
      } else if (e.key === "Escape" && dropdown.classList.contains("open")) {
        close();
      }
    });
  }

  // ── Appearance toggle ──────────────────────────────────────────────────
  // Surfaces the light/dark/system choice that was buried three clicks deep
  // in the Settings modal. Writes through window.Theme, so the modal, this
  // button and the mobile app all read the same stored preference.
  function initThemeToggle() {
    var btn = document.getElementById("themeToggle");
    if (!btn || !window.Theme) {
      if (btn) btn.remove();
      return;
    }
    var ICONS = { light: "sun", dark: "moon", system: "monitor" };
    var NEXT = { light: "dark", dark: "system", system: "light" };

    function paint() {
      btn.innerHTML = '<i data-icon="' + (ICONS[Theme.mode] || "monitor") + '"></i>';
      btn.title = "Appearance: " + Theme.label + " — click to change";
      btn.setAttribute("aria-label", btn.title);
      if (window.hydrateIcons) hydrateIcons(btn);
    }
    btn.addEventListener("click", function () {
      Theme.setMode(NEXT[Theme.mode] || "light");
    });
    Theme.subscribe(paint);
    paint();
  }

  // ── Boot ───────────────────────────────────────────────────────────────
  var app = document.getElementById("app");
  if (app) {
    var active = document.body.getAttribute("data-module") || "";
    applyCollapsed(readCollapsed());
    app.innerHTML = shellMarkup(active);
    // Icons hydrate via the MutationObserver in icons.js when it starts; if it
    // already started (script order can vary), hydrate this subtree directly.
    if (window.hydrateIcons) hydrateIcons(app);

    document.addEventListener("DOMContentLoaded", function () {
      initSidebarToggle();
      initLauncher();
      initThemeToggle();
    });
  }
})();
