// ════════════════════════ HOTLINE DIRECTORY ════════════════════════
// The numbers residents are told to call, read from /api/hotlines (managed in
// MIS → Site Content → Hotlines). Loaded on the landing page and on every MIS
// page, after js/api.js.
//
// WHY THIS FILE EXISTS
// The hotline used to be typed into the markup in sixteen places — the hero,
// the contact list, the emergency card, the footer, the incident modal on the
// landing page, and the same notice on eleven MIS pages. That is how a made-up
// number ("(043) 702-4011") stayed on the public site for months, and how the
// real one could still have been half-replaced: on 19 September 2026 the page
// showed 043-702-8875 while four tap-to-call links still dialled the old one.
//
// So the markup keeps the real number as its written-in fallback — a visitor
// with no connection, or a browser that runs no JavaScript, still sees a number
// that works — and this file rewrites those places from the directory as soon
// as it has it. A change is then made once, in Site Content.
//
// MARKUP CONTRACT
//   data-hotline="primary"         an <a>: href becomes tel:<dial>, and its
//                                 text (or a [data-hotline-number] inside it)
//                                 becomes the displayed number
//   data-hotline="primary-number"  text only — inside a sentence
//   data-hotline-list="emergency"  replaced with every emergency entry, in
//                                 display order (911 first)
//   data-hotline-list="other"      the entries NOT marked as emergencies — a
//                                 water or power office, say. Left empty, and
//                                 so invisible, while there are none
(function () {
  "use strict";

  var CACHE_KEY = "cares.hotlines";

  // Mirrors the seed in db/migration-sms-hotline.sql, so a browser that has
  // never reached the API still has the two numbers that matter. Anything
  // beyond these two is entered by staff from official sources, never guessed
  // (SMS-HOTLINE-PLAN.md §4.1) — which is why there are only two here.
  var DEFAULTS = [
    {
      id: null,
      label: "National Emergency Hotline",
      number: "911",
      dial: "911",
      category: "national",
      is_emergency: true,
      is_primary: false,
      notes: "",
    },
    {
      id: null,
      label: "Barangay Hotline",
      number: "043-702-8875",
      dial: "+63437028875",
      category: "barangay",
      is_emergency: true,
      is_primary: true,
      notes: "",
    },
  ];

  var list = null; // the directory in hand this page load

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function readCache() {
    try {
      var saved = JSON.parse(localStorage.getItem(CACHE_KEY));
      return saved && saved.length ? saved : null;
    } catch (e) {
      return null;
    }
  }

  function writeCache(rows) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(rows));
    } catch (e) {
      /* quota — the cache is best-effort */
    }
  }

  // Whatever is known right now, without waiting: the live list, then the last
  // one this browser saw, then the seed. Never empty, because every caller is
  // about to print a number a resident may need in an emergency.
  function current() {
    return list || readCache() || DEFAULTS;
  }

  function primary() {
    var all = current();
    for (var i = 0; i < all.length; i++) if (all[i].is_primary) return all[i];
    // No primary line in the directory — the API refuses to leave it that way,
    // but a hand-edited database could. Fall back to the seeded landline
    // rather than printing nothing where a number belongs.
    return DEFAULTS[1];
  }

  var primaryNumber = function () {
    return primary().number;
  };
  var primaryDial = function () {
    return primary().dial;
  };

  // ── Painting the page ──────────────────────────────────────────────────
  function paint(root) {
    var scope = root || document;
    var p = primary();

    Array.prototype.forEach.call(
      scope.querySelectorAll('[data-hotline="primary"]'),
      function (el) {
        if (el.tagName === "A") el.setAttribute("href", "tel:" + p.dial);
        var slot = el.querySelector("[data-hotline-number]") || el;
        slot.textContent = p.number;
      }
    );

    Array.prototype.forEach.call(
      scope.querySelectorAll('[data-hotline="primary-number"]'),
      function (el) {
        el.textContent = p.number;
      }
    );

    Array.prototype.forEach.call(
      scope.querySelectorAll("[data-hotline-list]"),
      function (box) {
        var want = box.getAttribute("data-hotline-list");
        var rows = current().filter(function (h) {
          if (want === "emergency") return !!h.is_emergency;
          if (want === "other") return !h.is_emergency;
          return true;
        });
        if (!rows.length) {
          // An "other" list with nothing in it is emptied — it is a section
          // heading over no numbers. Any other list keeps whatever the page
          // was written with, which is a number that works.
          if (want === "other") box.innerHTML = "";
          return;
        }
        box.innerHTML =
          (want === "other"
            ? '<p class="visit-emergency-more">Other numbers</p>'
            : "") +
          rows
            .map(function (h) {
              return (
                '<a class="visit-emergency-num" href="tel:' + esc(h.dial) + '">' +
                "<strong>" + esc(h.number) + "</strong>" +
                "<span>" + esc(h.label) +
                // The hours are the difference between a number and a number
                // somebody answers: a landline at the hall rings in an empty
                // room after hours unless someone is on night duty.
                (h.notes
                  ? ' · <em class="hotline-when">' + esc(h.notes) + "</em>"
                  : "") +
                "</span></a>"
              );
            })
            .join("");
      }
    );
  }

  // ── Fetching ───────────────────────────────────────────────────────────
  // One request per page load. A failure is not reported anywhere: the page
  // already shows the cached (or written-in) numbers, and a toast about the
  // hotline directory on a page that is not about hotlines would be noise.
  var inFlight = null;
  function fetchList() {
    if (inFlight) return inFlight;
    if (typeof apiGet !== "function")
      return Promise.resolve(current()); // js/api.js not on this page
    inFlight = apiGet("/api/hotlines")
      .then(function (rows) {
        if (Array.isArray(rows) && rows.length) {
          list = rows;
          writeCache(rows);
        }
        return current();
      })
      .catch(function () {
        return current();
      });
    return inFlight;
  }

  // Ask again, after Site Content changed the directory: this browser's cached
  // copy is what the other pages in it will paint from.
  function refresh() {
    inFlight = null;
    return fetchList().then(function (rows) {
      paint(document);
      return rows;
    });
  }

  function start() {
    paint(document); // cache or seed, immediately
    fetchList().then(function () {
      paint(document); // the live directory, a moment later
    });
  }

  window.Hotlines = {
    CACHE_KEY: CACHE_KEY,
    DEFAULTS: DEFAULTS,
    all: current,
    primary: primary,
    primaryNumber: primaryNumber,
    primaryDial: primaryDial,
    fetch: fetchList,
    refresh: refresh,
    // Call this after injecting markup that carries the attributes above —
    // the incident modal builds its notice at open time, not at page load.
    paint: paint,
  };

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else start();
})();
