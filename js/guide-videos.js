// js/guide-videos.js — the how-to videos, played inside the site.
//
// Two ways in:
//   • Landing page (index.html). Each Citizen Services card ends in a button
//     named for its video ("How to request a certificate · 0:25"), and
//     openGuideVideo('certificates' | 'incidents' | 'feedback') plays that
//     service's chapter of the resident guide.
//   • MIS. "Guide Videos" at the foot of the sidebar (js/app-shell.js) loads
//     this file on first use and calls GuideVideos.library(): all ten staff
//     videos, one per module, each with its steps to jump to. It opens on the
//     video for the page you are on.
//
// The files are made in motion/ and put here by motion/publish.js, which
// writes media/guides/ — the clips, their posters, and mis/guides.json (the
// MIS videos' titles, lengths and step times). Nothing below is hand-timed.
//
// Both players are ordinary .modal-backdrop modals, so they look like every
// other dialog in either theme, Escape closes them (js/ui-modals.js), and
// js/motion.js plays their exit.
(function () {
  "use strict";
  if (window.GuideVideos) return;

  // Paths are resolved from this file's own address, so the same code works
  // from index.html and from pages/*.html one folder down.
  var self = document.currentScript;
  var ROOT = new URL("../", (self && self.src) || location.href).href;
  var MEDIA = ROOT + "media/guides/";

  // A resident service → its clip, and the title's i18n key with its English
  // fallback (the MIS loads this file too, and i18n.js is optional there).
  var SERVICES = {
    certificates: { key: "guideCertificates", en: "How to request a certificate" },
    incidents: { key: "guideIncidents", en: "How to report an incident" },
    feedback: { key: "guideFeedback", en: "How to send feedback" },
  };

  // The MIS page you are on → the video that covers it. Administration's four
  // pages share one video; every other module's video has the module's id.
  var PAGE_VIDEO = { users: "admin", audit: "admin", sms: "admin", archive: "admin" };

  function tr(key, english) {
    return window.L && typeof L.t === "function" ? L.t(key) : english;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Rounded down, as the browser's own player shows a length — a 64.9 s
  // video reads 1:04 there, and the list should not say 1:05 beside it.
  function mmss(sec) {
    var s = Math.max(0, Math.floor(sec || 0));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  // index.html links the stylesheet itself (the card thumbnails need it at
  // first paint); an MIS page only needs it once a player opens.
  function ensureStyles() {
    if (document.querySelector('link[href*="guide-videos.css"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = ROOT + "css/guide-videos.css";
    document.head.appendChild(link);
  }

  // ── The modal both players use ─────────────────────────────────────────
  var current = null; // { el, lastFocus }

  function openModal(boxClass, title, body, closeLabel) {
    closeModal(true);
    ensureStyles();
    var el = document.createElement("div");
    el.className = "modal-backdrop guide-video-modal";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", "guide-video-title");
    el.innerHTML =
      '<div class="modal-box ' + boxClass + '">' +
      '<div class="modal-header">' +
      '<div class="modal-title">' +
      '<div class="modal-title-icon"><i data-icon="circle-play"></i></div>' +
      '<span id="guide-video-title">' + esc(title) + "</span>" +
      "</div>" +
      '<div class="guide-video-actions">' +
      // Shown once there is a video to mute (wireMute).
      '<button type="button" class="guide-mute" hidden></button>' +
      '<button type="button" class="modal-close" aria-label="' + esc(closeLabel) + '">' +
      '<i data-icon="x"></i></button>' +
      "</div>" +
      "</div>" +
      body +
      "</div>";
    document.body.appendChild(el);
    if (window.hydrateIcons) hydrateIcons(el);
    el.querySelector(".modal-close").addEventListener("click", function () {
      closeModal();
    });
    el.addEventListener("click", function (e) {
      if (e.target === el) closeModal();
    });
    current = { el: el, lastFocus: document.activeElement };
    el.classList.add("open");
    return el;
  }

  function closeModal(instant) {
    if (!current) return;
    var c = current;
    current = null;
    // Stop the sound now, not when the exit animation ends.
    c.el.querySelectorAll("video").forEach(function (v) {
      v.pause();
    });
    if (!instant && window.Motion && typeof Motion.closeOverlay === "function") {
      Motion.closeOverlay(c.el, function () {
        c.el.remove();
      });
    } else {
      c.el.remove();
    }
    if (c.lastFocus && typeof c.lastFocus.focus === "function") c.lastFocus.focus();
  }

  // js/ui-modals.js already turns Escape into a click on .modal-close; this
  // covers a page that does not load it.
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && current) closeModal();
  });

  function play(video) {
    var p = video.play();
    if (p && typeof p.catch === "function") p.catch(function () {});
  }

  // ── Sound ──────────────────────────────────────────────────────────────
  // The files are already mixed quieter than the originals (GAIN in
  // motion/publish.js). This is the off switch, in plain sight in the header
  // rather than inside the player's own controls. The choice carries over to
  // the next video, in this browser only.
  var MUTE_KEY = "cares.guide_videos_muted";

  function readMuted() {
    try {
      return localStorage.getItem(MUTE_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function saveMuted(on) {
    try {
      localStorage.setItem(MUTE_KEY, on ? "1" : "0");
    } catch (e) {
      // Storage off: the choice just lasts for this video.
    }
  }

  // `labels` = { mute, unmute } in the page's language.
  function wireMute(el, video, labels) {
    var btn = el.querySelector(".guide-mute");
    if (!btn) return;
    function paint() {
      var muted = video.muted;
      var label = muted ? labels.unmute : labels.mute;
      btn.innerHTML =
        '<i data-icon="' + (muted ? "volume-x" : "volume") + '"></i>' +
        "<span>" + esc(label) + "</span>";
      // The word can be hidden on a phone (css/guide-videos.css); the name
      // stays.
      btn.setAttribute("aria-label", label);
      btn.classList.toggle("is-muted", muted);
      if (window.hydrateIcons) hydrateIcons(btn);
    }
    video.muted = readMuted();
    btn.hidden = false;
    btn.addEventListener("click", function () {
      video.muted = !video.muted;
    });
    // Also follows the mute control inside the player itself.
    video.addEventListener("volumechange", function () {
      saveMuted(video.muted);
      paint();
    });
    paint();
  }

  // ── Landing page: one service's clip ──────────────────────────────────
  function service(id) {
    var s = SERVICES[id];
    if (!s) return;
    var file = MEDIA + "resident-" + id;
    var el = openModal(
      "guide-video-box",
      tr(s.key, s.en),
      '<div class="guide-video-stage">' +
        '<video controls playsinline preload="auto" poster="' + esc(file + ".jpg") + '">' +
        '<source src="' + esc(file + ".mp4") + '" type="video/mp4" />' +
        "</video>" +
        "</div>",
      tr("closeVideo", "Close video")
    );
    var video = el.querySelector("video");
    wireMute(el, video, {
      mute: tr("muteVideo", "Mute"),
      unmute: tr("unmuteVideo", "Unmute"),
    });
    video.focus();
    play(video); // the click that opened this is the gesture that allows sound
  }

  // ── MIS: the library of all ten ───────────────────────────────────────
  var catalogue = null;

  function loadCatalogue() {
    if (catalogue) return Promise.resolve(catalogue);
    return fetch(MEDIA + "mis/guides.json", { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (j) {
        catalogue = (j && j.videos) || [];
        return catalogue;
      });
  }

  function library() {
    var el = openModal(
      "guide-library-box",
      "MIS Guide Videos",
      '<div class="guide-library"><p class="guide-library-note">Loading the videos…</p></div>',
      "Close guide videos"
    );
    loadCatalogue()
      .then(function (videos) {
        if (!current || current.el !== el) return; // closed while loading
        if (!videos.length) throw new Error("empty");
        var page = document.body.getAttribute("data-module") || "";
        var want = PAGE_VIDEO[page] || page;
        var start = 0;
        videos.forEach(function (v, i) {
          if (v.id === want) start = i;
        });
        renderLibrary(el, videos, start);
      })
      .catch(function () {
        var box = el.querySelector(".guide-library");
        if (box)
          box.innerHTML =
            '<p class="guide-library-note">The video list could not be loaded. ' +
            "Check the connection and open Guide Videos again.</p>";
      });
  }

  function renderLibrary(el, videos, start) {
    var root = el.querySelector(".guide-library");
    root.innerHTML =
      '<div class="guide-library-main">' +
      '<div class="guide-video-stage"><video controls playsinline preload="metadata"></video></div>' +
      '<div class="guide-library-info">' +
      '<p class="guide-library-kicker"></p>' +
      '<h3 class="guide-library-title"></h3>' +
      '<p class="guide-library-sub"></p>' +
      '<p class="guide-steps-label">Steps <span>· pick one to jump to it</span></p>' +
      '<ol class="guide-steps"></ol>' +
      "</div>" +
      "</div>" +
      '<nav class="guide-library-list" aria-label="All guide videos"><ol>' +
      videos
        .map(function (v, i) {
          return (
            '<li><button type="button" class="guide-pick" data-i="' + i + '">' +
            '<span class="guide-pick-thumb">' +
            '<img src="' + esc(MEDIA + v.poster) + '" alt="" loading="lazy" decoding="async" width="160" height="90" />' +
            '<span class="guide-pick-time">' + mmss(v.duration) + "</span>" +
            "</span>" +
            '<span class="guide-pick-text">' +
            '<span class="guide-pick-num">' + (i + 1) + "</span>" +
            '<span class="guide-pick-title">' + esc(v.title) + "</span>" +
            "</span>" +
            "</button></li>"
          );
        })
        .join("") +
      "</ol></nav>";

    var video = root.querySelector("video");
    var stepsEl = root.querySelector(".guide-steps");
    var shown = -1;
    // English: the MIS is English-only (see the note at the top of i18n.js).
    wireMute(el, video, { mute: "Mute", unmute: "Unmute" });

    function select(i, autoplay) {
      var v = videos[i];
      shown = i;
      video.pause();
      video.setAttribute("poster", MEDIA + v.poster);
      video.src = MEDIA + v.file;
      video.load();
      root.querySelector(".guide-library-kicker").textContent =
        "Video " + (i + 1) + " of " + videos.length + " · " + mmss(v.duration);
      root.querySelector(".guide-library-title").textContent = v.title;
      root.querySelector(".guide-library-sub").textContent = v.subtitle || "";
      stepsEl.innerHTML = (v.steps || [])
        .map(function (s, n) {
          return (
            '<li><button type="button" class="guide-step" data-t="' + s.t + '">' +
            '<span class="guide-step-num">' + (n + 1) + "</span>" +
            '<span class="guide-step-label">' + esc(s.label) + "</span>" +
            '<span class="guide-step-time">' + mmss(s.t) + "</span>" +
            "</button></li>"
          );
        })
        .join("");
      root.querySelectorAll(".guide-pick").forEach(function (b) {
        var on = Number(b.getAttribute("data-i")) === i;
        b.classList.toggle("is-current", on);
        if (on) b.setAttribute("aria-current", "true");
        else b.removeAttribute("aria-current");
      });
      root.querySelector(".guide-library-main").scrollTop = 0;
      markStep();
      if (autoplay) play(video);
    }

    // Light the step the video is in.
    function markStep() {
      var t = video.currentTime || 0;
      var buttons = stepsEl.querySelectorAll(".guide-step");
      var at = -1;
      buttons.forEach(function (b, n) {
        if (Number(b.getAttribute("data-t")) <= t + 0.05) at = n;
      });
      buttons.forEach(function (b, n) {
        b.classList.toggle("is-current", n === at);
        b.classList.toggle("is-done", n < at);
      });
    }
    video.addEventListener("timeupdate", markStep);
    video.addEventListener("seeked", markStep);

    stepsEl.addEventListener("click", function (e) {
      var b = e.target.closest(".guide-step");
      if (!b) return;
      video.currentTime = Number(b.getAttribute("data-t")) || 0;
      play(video);
    });

    root.querySelector(".guide-library-list").addEventListener("click", function (e) {
      var b = e.target.closest(".guide-pick");
      if (!b) return;
      var i = Number(b.getAttribute("data-i"));
      if (i === shown) return play(video);
      select(i, true);
      // On a narrow screen the list sits under the player: bring it back up.
      if (window.matchMedia("(max-width: 900px)").matches) {
        root.querySelector(".guide-video-stage").scrollIntoView({ block: "start", behavior: "smooth" });
      }
    });

    // Opening the library does not start the sound by itself; picking a video
    // (or pressing play) does.
    select(start, false);
    // Bring the chosen video into the list's view — the list's own scroll
    // only. scrollIntoView would also scroll the dialog, and on a narrow
    // screen, where the list sits under the player, open it part-way down.
    var list = root.querySelector(".guide-library-list");
    var pick = root.querySelector('.guide-pick[data-i="' + start + '"]');
    if (pick && list.scrollHeight > list.clientHeight + 1) {
      list.scrollTop = Math.max(0, pick.offsetTop - (list.clientHeight - pick.offsetHeight) / 2);
    }
    if (window.hydrateIcons) hydrateIcons(root);
  }

  window.GuideVideos = { service: service, library: library, close: closeModal };
  window.openGuideVideo = service;
})();
