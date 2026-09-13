// ════════════════════ SITE CONFIG ════════════════════
// Editable content for the public landing page — the "Latest Announcements"
// bulletin and the "Barangay Officials" cards. Both live in the shared DB
// (/api/announcements + /api/officials, managed from the MIS → Site Content
// page — pages/content.html on the web, and the mobile app's equivalent).
// localStorage keeps a best-effort cache so the landing page still renders
// something when the API is unreachable.
// Loaded on index.html and pages/content.html (after js/api.js).
(function () {
  "use strict";

  var SITE_CONFIG_KEY = "cares.siteConfig";

  // Fallbacks that mirror the DB seed (db/migration-site-content.sql), so a
  // fresh browser with no connectivity still shows a sensible section.
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

  // Announcement tag → chip modifier class (colors in landing.css; keep in
  // sync with the TAGS list in the server's routes/announcements.js).
  var ANNOUNCEMENT_TAGS = ["Advisory", "Health", "Community", "Event", "Emergency"];

  function cloneOfficial(o) {
    return {
      id: o.id || null,
      honorific: o.honorific || "",
      name: o.name || "",
      role: o.role || "",
      desc: o.desc || "",
      photo: o.photo || "",
    };
  }

  // API row ({description, sort_order, …}) → the internal shape the render
  // helpers and Settings editor use ({desc, …}).
  function officialFromApi(row) {
    return {
      id: row.id,
      honorific: row.honorific || "",
      name: row.name || "",
      role: row.role || "",
      desc: row.description || "",
      photo: row.photo || "",
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
  // and return a compact JPEG data URL — keeps the JSON payload small.
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

  // ── Offline cache ──────────────────────────────────────────
  function readCache() {
    try {
      return JSON.parse(localStorage.getItem(SITE_CONFIG_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function writeCache(patch) {
    var cache = readCache();
    for (var k in patch) cache[k] = patch[k];
    try {
      localStorage.setItem(SITE_CONFIG_KEY, JSON.stringify(cache));
    } catch (e) {
      /* quota — cache is best-effort */
    }
  }

  // ── Fetchers (API first, cache/defaults offline) ───────────
  function fetchOfficials() {
    return apiGet("/api/officials")
      .then(function (rows) {
        var list = rows.map(officialFromApi);
        writeCache({ officials: list });
        return list;
      })
      .catch(function () {
        var cached = readCache().officials;
        return cached && cached.length
          ? cached.map(cloneOfficial)
          : DEFAULT_OFFICIALS.map(cloneOfficial);
      });
  }

  // includeExpired is for the Site Content editor only. The public bulletin
  // must not see posts past their take-down date, and neither must the cache
  // it falls back to when the API is unreachable — so an editor fetch is
  // deliberately not written to the cache.
  function fetchAnnouncements(includeExpired) {
    if (includeExpired)
      return apiGet("/api/announcements?include_expired=1").catch(function () {
        return readCache().announcements || [];
      });
    return apiGet("/api/announcements")
      .then(function (rows) {
        writeCache({ announcements: rows });
        return rows;
      })
      .catch(function () {
        return readCache().announcements || [];
      });
  }

  // ── Landing page renderers ─────────────────────────────────
  function renderOfficials(containerId) {
    var grid = document.getElementById(containerId);
    if (!grid) return;
    fetchOfficials().then(function (officials) {
      grid.innerHTML = officials
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
    });
  }

  function formatAnnouncementDate(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime())
      ? ""
      : d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
  }

  function tagClass(tag) {
    return (
      "announcement-tag ann-tag-" +
      (ANNOUNCEMENT_TAGS.indexOf(tag) >= 0 ? tag : "Advisory").toLowerCase()
    );
  }

  // Render the community bulletin into the landing "#bulletin" grid.
  function renderAnnouncements(containerId, limit) {
    var grid = document.getElementById(containerId);
    if (!grid) return;
    fetchAnnouncements().then(function (list) {
      if (limit) list = list.slice(0, limit);
      if (!list.length) {
        grid.innerHTML =
          '<div class="announcements-empty">No announcements posted yet — ' +
          "check back soon.</div>";
        return;
      }
      grid.innerHTML = list
        .map(function (a) {
          return (
            '<article class="announcement-card">' +
            '<div class="announcement-meta">' +
            '<span class="' + tagClass(a.tag) + '">' +
            escapeHtml(a.tag || "Advisory") +
            "</span>" +
            '<span class="announcement-date">' +
            escapeHtml(formatAnnouncementDate(a.created_at)) +
            "</span>" +
            "</div>" +
            '<h3 class="announcement-title">' + escapeHtml(a.title) + "</h3>" +
            (a.body
              ? '<p class="announcement-body">' + escapeHtml(a.body) + "</p>"
              : "") +
            "</article>"
          );
        })
        .join("");
    });
  }

  // Expose on window for use by pages.
  window.SiteConfig = {
    KEY: SITE_CONFIG_KEY,
    DEFAULT_OFFICIALS: DEFAULT_OFFICIALS,
    ANNOUNCEMENT_TAGS: ANNOUNCEMENT_TAGS,
    fetchOfficials: fetchOfficials,
    fetchAnnouncements: fetchAnnouncements,
    renderOfficials: renderOfficials,
    renderAnnouncements: renderAnnouncements,
    formatAnnouncementDate: formatAnnouncementDate,
    tagClass: tagClass,
    officialFromApi: officialFromApi,
    deriveInitials: deriveInitials,
    displayName: displayName,
    avatarInner: avatarInner,
    readImage: readImage,
    cloneOfficial: cloneOfficial,
    escapeHtml: escapeHtml,
  };
})();
