// ════════════════════ SITE CONFIG ════════════════════
// Editable, customizable content for the public landing page. Stored in
// localStorage so barangay staff can change it from the Settings page without
// touching the HTML. Loaded on both index.html and settings.html.
(function () {
  "use strict";

  var SITE_CONFIG_KEY = "cares.siteConfig";

  // Defaults mirror the original hardcoded officials on the landing page, so
  // the site looks identical until someone customizes it.
  var DEFAULT_OFFICIALS = [
    {
      honorific: "Hon.",
      name: "Juan Dela Cruz",
      role: "Punong Barangay",
      desc: "Leads the barangay administration and community programs.",
      photo: "",
    },
    {
      honorific: "Hon.",
      name: "Maria Santos",
      role: "Kagawad — Public Safety",
      desc: "Oversees public safety, peace and order, and disaster response.",
      photo: "",
    },
    {
      honorific: "Hon.",
      name: "Pedro Reyes",
      role: "Kagawad — Health & Sanitation",
      desc: "Manages health programs, sanitation, and community welfare.",
      photo: "",
    },
  ];

  function cloneOfficial(o) {
    return {
      honorific: o.honorific || "",
      name: o.name || "",
      role: o.role || "",
      desc: o.desc || "",
      photo: o.photo || "",
    };
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Auto-derive avatar initials from a name (skips the "Hon." honorific).
  function deriveInitials(name) {
    var parts = String(name || "")
      .replace(/hon\.?/i, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "?";
    var first = parts[0][0] || "";
    var last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase();
  }

  // Full display name = honorific + name (e.g. "Hon. Juan Dela Cruz").
  function displayName(o) {
    return ((o.honorific ? o.honorific + " " : "") + (o.name || "")).trim();
  }

  // Inner markup for an official's avatar: the uploaded photo if present,
  // otherwise the auto-derived initials.
  function avatarInner(o) {
    if (o.photo) {
      return (
        '<img src="' +
        escapeHtml(o.photo) +
        '" alt="' +
        escapeHtml(displayName(o) || "Official") +
        '" />'
      );
    }
    return escapeHtml(deriveInitials(o.name));
  }

  // Read an image File, downscale it to fit `maxSize` px on its longest edge,
  // and return a compact JPEG data URL — keeps localStorage well under quota.
  function readImage(file, maxSize, cb) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        var cw = Math.round(img.width * scale);
        var ch = Math.round(img.height * scale);
        var canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        canvas.getContext("2d").drawImage(img, 0, 0, cw, ch);
        cb(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = function () {
        cb(e.target.result);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function getSiteConfig() {
    try {
      var raw = JSON.parse(localStorage.getItem(SITE_CONFIG_KEY));
      if (raw && Array.isArray(raw.officials)) return raw;
    } catch (e) {
      /* fall through to defaults */
    }
    return { officials: DEFAULT_OFFICIALS.map(cloneOfficial) };
  }

  function saveSiteConfig(cfg) {
    localStorage.setItem(SITE_CONFIG_KEY, JSON.stringify(cfg));
  }

  // Render the officials cards into a container (the landing "#team" grid).
  function renderOfficials(containerId) {
    var grid = document.getElementById(containerId);
    if (!grid) return;
    var cfg = getSiteConfig();
    grid.innerHTML = cfg.officials
      .map(function (o) {
        return (
          '<article class="official-card">' +
          '<div class="official-avatar' + (o.photo ? " has-photo" : "") + '">' +
          avatarInner(o) +
          "</div>" +
          '<div class="official-name">' + escapeHtml(displayName(o)) + "</div>" +
          '<div class="official-role">' + escapeHtml(o.role) + "</div>" +
          '<p class="official-desc">' + escapeHtml(o.desc) + "</p>" +
          "</article>"
        );
      })
      .join("");
  }

  // Expose on window for use by pages.
  window.SiteConfig = {
    KEY: SITE_CONFIG_KEY,
    DEFAULT_OFFICIALS: DEFAULT_OFFICIALS,
    get: getSiteConfig,
    save: saveSiteConfig,
    renderOfficials: renderOfficials,
    deriveInitials: deriveInitials,
    displayName: displayName,
    avatarInner: avatarInner,
    readImage: readImage,
    cloneOfficial: cloneOfficial,
    escapeHtml: escapeHtml,
  };
})();
