// js/pages/content.js — "Site Content" MIS module.
// Manages the four editable public-landing sections (Latest Announcements,
// the barangay's History, Barangay Officials and the Hotlines) from inside
// the MIS shell. Everything writes straight to the shared DB
// (/api/announcements + /api/history + /api/officials + /api/hotlines), so
// the homepage updates immediately.
//
// WHY THIS IS SHAPED THE WAY IT IS
// The first version stacked every announcement and every official as a fully
// expanded form, one after the other, with a "Save Changes" button at the
// bottom of each section. That does not survive real use: twelve posts meant
// twelve open forms and a save button several screens down, so the commonest
// action on the page was also the hardest one to reach. It also spent a 250px
// column per official on a preview card that duplicates the homepage.
//
// So:
//   • The sections are TABS, not stacked cards — you are only ever
//     scrolling one list.
//   • A row is a one-line summary that expands to edit. Twelve posts are
//     twelve lines, and the fields inside an open row sit in a 12-column grid
//     instead of a single narrow column with dead space beside it.
//   • Search + status/tag filters, because "find the flood advisory" was
//     previously a scroll.
//
// SAVING IS PER ROW
// It used to be one page-wide Save that wrote every changed row, every queued
// deletion and the officials order in a single pass. That works on a laptop
// talking to localhost, where a request cannot really fail. It stops working
// the moment the server is somewhere else: one dropped request half way down
// the list left the page partly saved, and the operator had no way to see
// which half — the count in the bar went down by an amount they had to trust.
//
// Now each row owns its own write. A row's Save button appears when that row
// is dirty and sends only that row, so every write is one request that either
// lands or does not, and a failure names the row it belongs to and leaves that
// row's Save sitting there to press again. Deletions apply immediately rather
// than queueing behind a save nobody has pressed yet, and the officials order
// is written the moment it changes.
//
// SENDING AN ANNOUNCEMENT AS A TEXT (A6)
// An open announcement row carries a "Also send this as a text message" panel
// for roles the matrix allows (Admin by default). It is the only thing in the
// system that spends real money on everybody at once — at 43 textable
// residents a two-part advisory is about PHP 52 a press — so it is deliberately
// not one button: pick who it goes to, check the cost, then confirm figures
// that the server re-checks before it sends anything
// (SMS-HOTLINE-PLAN.md §3.1 A6, §9).
//
// HOTLINES
// The third tab is the hotline directory: the numbers printed on the landing
// page and in every report form. It was hard-coded in sixteen places until
// 2026-10-02 (SMS-HOTLINE-PLAN.md §4.1), which is how a made-up number stayed
// on the public site for months. Two rules it enforces here because the server
// enforces them too: exactly one PRIMARY barangay line — the number every text
// message quotes back to the resident — and that line can neither be demoted
// nor deleted, only handed to another line.
//
// HISTORY
// The second tab is not a list: it is one document — a title and the story —
// so it is one form with one Save, and nothing to add, remove or reorder. Emptying the story takes the section off the homepage,
// which is the one save here that asks first.
//
// The bar keeps the change COUNT — it is still worth knowing that four rows
// are unsaved before navigating away — but it is a status now, not a button.
// Ctrl+S saves the row you are editing.
window.CURRENT_PAGE = "content";

(function () {
  "use strict";

  // Handlers referenced from the generated markup. Everything else stays
  // private to this closure — these scripts share one global scope with the
  // rest of the page's bundle, so a bare `const esc` here would collide.
  var UI = (window.SiteContentUI = {});

  var esc = function (s) {
    return SiteConfig.escapeHtml(s);
  };
  var accountId = function () {
    return (getSession() || {}).account_id || null;
  };
  var fail = function (msg) {
    showToast(msg, "<i data-icon=triangle-alert></i>");
  };

  // ═══════════ State ═══════════
  // Working copies. Each row carries a client-side `_uid` (stable across
  // re-orders and inserts, unlike an array index) and `_clean` — the signature
  // of the row as the server last confirmed it, which is what "Edited" and the
  // unsaved-change count are measured against.
  var anns = [];
  var offs = [];
  var hots = [];
  // The history is one document, not a list: null until it loads (or when it
  // could not be loaded), then { title, body, updated_at, _clean,
  // _liveEmpty } — _liveEmpty says whether the SAVED story is empty, which is
  // what decides whether the homepage shows the section right now.
  var hist = null;
  var histSaving = false;
  var openRows = {}; // uid → true, survives list re-renders
  var tab = "announcements";
  var filters = {
    annText: "",
    annStatus: "",
    annTag: "",
    offText: "",
    hotText: "",
  };
  // Per kind: the id order the server last confirmed. Officials and hotlines
  // are both hand-ordered lists, and each writes its own order.
  var baseOrder = { off: "", hot: "" };
  var uidSeq = 0;
  // uid → true while that row's request is in flight. Per row, not per page:
  // two rows can be saving at once and each disables only its own button.
  var savingRows = {};
  var orderSaving = { off: false, hot: false };
  // Set from GET /api/sms/status: whether this account may text an
  // announcement at all, what the puroks are called, and the price of a
  // credit. The server decides the permission either way — this only keeps
  // the panel off screens that would be refused.
  var sms = { can: false, mode: "", peso: 0.56 };
  var puroks = [];
  // uid → { on, purok_ids, classifications, emergency, preview, busy }. Kept
  // outside the announcement itself so it never counts as an unsaved change:
  // who a text goes to is not part of the post.
  var smsDraft = {};

  var newUid = function () {
    return "u" + ++uidSeq;
  };
  // The three lists, by the kind key used throughout this file. A function,
  // not a map: load() replaces the arrays wholesale, and a map would still be
  // holding the ones from before the fetch.
  var listOf = function (kind) {
    return kind === "ann" ? anns : kind === "off" ? offs : hots;
  };
  // What a row of each kind is called, for buttons, toasts and aria labels.
  var NOUN = { ann: "announcement", off: "official", hot: "hotline" };
  // The tab a kind lives on, and the order endpoint it writes to.
  var TAB_OF = { ann: "announcements", off: "officials", hot: "hotlines" };
  var ORDER_PATH = { off: "/api/officials/order", hot: "/api/hotlines/order" };

  var byUid = function (list, uid) {
    for (var i = 0; i < list.length; i++) if (list[i]._uid === uid) return list[i];
    return null;
  };
  var indexOfUid = function (list, uid) {
    for (var i = 0; i < list.length; i++) if (list[i]._uid === uid) return i;
    return -1;
  };

  // ── Change tracking ────────────────────────────────────────────────────
  var annSig = function (a) {
    return JSON.stringify([
      a.title || "",
      a.body || "",
      a.tag || "",
      a.expires_at || "",
      a.expires_time || "",
    ]);
  };
  var offSig = function (o) {
    return JSON.stringify([
      o.honorific || "",
      o.name || "",
      o.role || "",
      o.desc || "",
      o.photo || "",
    ]);
  };
  var hotSig = function (h) {
    return JSON.stringify([
      h.label || "",
      h.number || "",
      h.dial || "",
      h.category || "",
      !!h.is_emergency,
      !!h.is_primary,
      h.notes || "",
    ]);
  };

  // A row with no id and nothing typed into it is an abandoned "New" row, not
  // an edit: it is dropped on save rather than counted, refused or published.
  var annBlank = function (a) {
    return !a.id && !(a.title || "").trim() && !(a.body || "").trim();
  };
  var offBlank = function (o) {
    return (
      !o.id &&
      !(o.name || "").trim() &&
      !(o.role || "").trim() &&
      !(o.desc || "").trim() &&
      !o.photo
    );
  };
  var hotBlank = function (h) {
    return (
      !h.id &&
      !(h.label || "").trim() &&
      !(h.number || "").trim() &&
      !(h.dial || "").trim()
    );
  };

  var annDirty = function (a) {
    return !annBlank(a) && (!a.id || a._clean !== annSig(a));
  };
  var offDirty = function (o) {
    return !offBlank(o) && (!o.id || o._clean !== offSig(o));
  };
  var hotDirty = function (h) {
    return !hotBlank(h) && (!h.id || h._clean !== hotSig(h));
  };
  var DIRTY = { ann: annDirty, off: offDirty, hot: hotDirty };
  var BLANK = { ann: annBlank, off: offBlank, hot: hotBlank };
  var SIG = { ann: annSig, off: offSig, hot: hotSig };
  // Only saved rows count toward the order: a new official has no id yet, and
  // its arrival is already counted as its own change.
  var savedOrder = function (kind) {
    return listOf(kind)
      .filter(function (x) {
        return x.id;
      })
      .map(function (x) {
        return x.id;
      })
      .join(",");
  };
  // The order is written the moment it changes, so this is normally false. It
  // stays true in the two cases where the write could not happen yet: the POST
  // failed (offline, server down), or a brand-new official is sitting in the
  // list without an id, which the order endpoint cannot accept. Either way the
  // officials toolbar grows a "Save order" button until it clears.
  var orderDirty = function (kind) {
    return savedOrder(kind) !== baseOrder[kind];
  };

  var annChanges = function () {
    return anns.filter(annDirty).length;
  };
  var offChanges = function () {
    return offs.filter(offDirty).length + (orderDirty("off") ? 1 : 0);
  };
  var hotChanges = function () {
    return hots.filter(hotDirty).length + (orderDirty("hot") ? 1 : 0);
  };
  var histSig = function (h) {
    return JSON.stringify([h.title || "", h.body || ""]);
  };
  var histDirty = function () {
    return !!hist && hist._clean !== histSig(hist);
  };
  var histChanges = function () {
    return histDirty() ? 1 : 0;
  };
  var totalChanges = function () {
    return annChanges() + offChanges() + hotChanges() + histChanges();
  };

  // ── Announcement status ────────────────────────────────────────────────
  // Computed here rather than trusted from the API's `expired` flag, because
  // the date in the field may have been changed since the row was fetched.
  // The moment the post comes down. The time of day is optional: without one
  // the post is live until the END of its date — a notice for "the assembly on
  // the 14th" should still be up on the 14th — and with one it comes down at
  // exactly that time. Mirrors the server's rule in routes/announcements.js.
  var expiryEnd = function (a) {
    if (!a.expires_at) return null;
    var end = a.expires_time
      ? new Date(a.expires_at + "T" + a.expires_time + ":00")
      : new Date(a.expires_at + "T23:59:59");
    return isNaN(end) ? null : end.getTime();
  };
  // Whole calendar days between today and the take-down day: 0 = today,
  // 1 = tomorrow. Counted date-to-date rather than as elapsed hours, because
  // "comes down in 8 hours" at 9 AM means today, not tomorrow — which is what
  // rounding the hours would have said once a time of day became possible.
  var daysLeft = function (a) {
    var end = expiryEnd(a);
    if (end === null) return null;
    var e = new Date(end);
    e.setHours(0, 0, 0, 0);
    var n = new Date();
    n.setHours(0, 0, 0, 0);
    return Math.round((e - n) / 86400000);
  };
  var isExpired = function (a) {
    var end = expiryEnd(a);
    return end !== null && end < Date.now();
  };

  // 14:30 → "2:30 PM". The field is 24-hour (that is what <input type=time>
  // gives back regardless of what it shows), but nobody in the barangay reads
  // a notice board in 24-hour time.
  function expiryClock(t) {
    var m = /^(\d{2}):(\d{2})$/.exec(t || "");
    if (!m) return "";
    var h = +m[1];
    var suffix = h < 12 ? "AM" : "PM";
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ":" + m[2] + " " + suffix;
  }

  // The plain-language version of what the date field means right now. A raw
  // date does not tell a reader whether the post is currently visible.
  function expiryNote(a) {
    var end = expiryEnd(a);
    if (end === null) return "Stays up until removed";
    if (end < Date.now()) return "Expired — off the public bulletin";
    var d = daysLeft(a);
    var at = a.expires_time ? " at " + expiryClock(a.expires_time) : "";
    if (d <= 0) return "Comes down" + (at || " at the end of today");
    if (d === 1) return "Comes down tomorrow" + at;
    return "Comes down in " + d + " days" + at;
  }

  // A take-down date only has to be today or later when it is being SET. An
  // expired post keeps its past date for as long as nobody touches the field,
  // so a typo in its title can be fixed without re-dating it — which used to
  // be refused, because the date it already had is in the past. Changing the
  // date brings the rule back (UI.setAnn toggles it).
  function expiryDateChanged(a) {
    var saved = a._clean ? JSON.parse(a._clean)[3] : "";
    return (a.expires_at || "") !== saved;
  }

  function annStatus(a) {
    if (!a.id) return "new";
    if (isExpired(a)) return "expired";
    var d = daysLeft(a);
    if (d !== null && d <= 3) return "soon";
    return "live";
  }

  function annSubText(a) {
    var posted = a.id
      ? "Posted " + SiteConfig.formatAnnouncementDate(a.created_at)
      : "Not yet published";
    return posted + " · " + expiryNote(a);
  }

  // ── Hotline helpers ───────────────────────────────────────
  // Mirrors the CHECK constraint on hotline.category.
  var HOT_CATEGORIES = [
    "barangay",
    "police",
    "fire",
    "medical",
    "disaster",
    "national",
    "utility",
    "other",
  ];

  // What a phone actually dials. Mirrors routes/hotlines.js, which refuses the
  // same strings: brackets, spaces and dashes are stripped, then it must be
  // digits with an optional leading +. A tap-to-call link built from a
  // mistyped number fails silently on the caller's phone, which is the worst
  // way for this to go wrong.
  var hotDial = function (h) {
    return (h.dial || "").replace(/[\s()-]/g, "");
  };
  var hotDialOk = function (h) {
    return /^\+?\d{3,15}$/.test(hotDial(h));
  };

  // 043-702-8875 → +63437028875. Offered as a suggestion beside the dial field
  // rather than written in silently: the dial string is what a phone rings,
  // and guessing it for the operator is how a wrong number reaches the public
  // site without anyone deciding to publish it.
  function hotSuggestDial(h) {
    var digits = (h.number || "").replace(/\D/g, "");
    if (!digits || digits.length < 3) return "";
    // A short code (911, 117) is dialled exactly as written.
    if (digits.length <= 5) return digits;
    // Local form: the leading 0 is the national trunk prefix and is dropped
    // behind +63, which is what makes the link work from a mobile.
    if (digits.charAt(0) === "0") return "+63" + digits.slice(1);
    if (digits.slice(0, 2) === "63") return "+" + digits;
    return "+63" + digits;
  }

  function hotSubText(h) {
    var bits = [(h.number || "").trim() || "No number"];
    if ((h.notes || "").trim()) bits.push(h.notes.trim());
    if (h.is_primary) bits.push("quoted in every text message");
    else if (!h.is_emergency) bits.push("not on the emergency card");
    return bits.join(" · ");
  }

  // Today, so the date picker can refuse a take-down date in the past.
  function todayIso() {
    var t = new Date();
    return new Date(t.getTime() - t.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
  }

  // ═══════════ Page scaffold ═══════════
  function renderPage() {
    // Site Content editing is staff-only (Admin / Officer). The shell calls
    // renderPage() for every signed-in role, so guard here as well as in nav().
    var role = (getSession() || {}).role;
    if (role !== "Admin" && role !== "Officer") {
      window.location.href = role ? "../index.html" : "../system.html";
      return;
    }
    // shell.js calls renderPage() a second time when the delete-permission
    // fetch lands and flips the answer. Rebuilding then would throw away
    // whatever has been typed since, so a page already up simply stays up.
    if (document.getElementById("sc-page")) return;

    // No .page-header here on purpose: the topbar already reads
    // "Site Content / Announcements & barangay officials", and repeating it
    // costs ~90px of the fold on a page whose whole job is a long list.
    setContent(
      '<div id="sc-page">' +
        barHtml() +
        '<section class="sc-panel" id="sc-panel-announcements" role="tabpanel" aria-labelledby="sc-tab-announcements">' +
          annToolbarHtml() +
          '<div class="sc-list" id="sc-list-ann">' + skeletonHtml(3) + "</div>" +
        "</section>" +
        // A single card rather than a list — see HISTORY in the header.
        '<section class="sc-panel" id="sc-panel-history" role="tabpanel" aria-labelledby="sc-tab-history" hidden>' +
          '<div class="sc-list sc-doc" id="sc-history">' + skeletonHtml(3) + "</div>" +
        "</section>" +
        '<section class="sc-panel" id="sc-panel-officials" role="tabpanel" aria-labelledby="sc-tab-officials" hidden>' +
          offToolbarHtml() +
          '<div class="sc-list" id="sc-list-off">' + skeletonHtml(3) + "</div>" +
        "</section>" +
        '<section class="sc-panel" id="sc-panel-hotlines" role="tabpanel" aria-labelledby="sc-tab-hotlines" hidden>' +
          hotToolbarHtml() +
          '<div class="sc-list" id="sc-list-hot">' + skeletonHtml(2) + "</div>" +
        "</section>" +
      "</div>"
    );
    hydrate(document.getElementById("page-content"));
    applyTab();
    load();
  }
  window.renderPage = renderPage;

  function hydrate(el) {
    if (el && typeof hydrateIcons === "function") hydrateIcons(el);
  }

  function skeletonHtml(n) {
    var out = "";
    for (var i = 0; i < n; i++) out += '<div class="skeleton skeleton-row"></div>';
    return out;
  }

  // ── The sticky command bar ─────────────────────────────────────────────
  // Tabs on the left, the unsaved-row count on the right. There is no Preview
  // button: the homepage is the preview, and a save puts the change there
  // straight away.
  //
  // No Save here any more — saving belongs to the row being saved (see the
  // header). What is left is the count, which still earns its place: it is the
  // only thing that can tell you four rows are unsaved when three of them are
  // scrolled off the screen, and it is what the leave-the-page warning is
  // counting. It reads as a status, not an invitation to press it.
  function barHtml() {
    return (
      '<div class="sc-bar" id="sc-bar">' +
        // In the order the sections appear on the homepage.
        '<div class="sc-tabs" role="tablist" aria-label="Site content sections">' +
          tabHtml("announcements", "megaphone", "Announcements") +
          tabHtml("history", "file-text", "History", true) +
          tabHtml("officials", "users", "Officials") +
          tabHtml("hotlines", "phone", "Hotlines") +
        "</div>" +
        '<div class="sc-bar-actions">' +
          '<span class="sc-dirty" id="sc-dirty" data-state="clean" role="status">' +
            '<i data-icon="check-circle"></i><span>All changes saved</span>' +
          "</span>" +
        "</div>" +
      "</div>"
    );
  }

  // noCount: the History tab holds one document, and a badge reading "1"
  // forever would be a number that never says anything.
  function tabHtml(id, icon, label, noCount) {
    return (
      '<button type="button" class="sc-tab" id="sc-tab-' + id + '" role="tab" ' +
      'aria-selected="false" aria-controls="sc-panel-' + id + '" ' +
      "onclick=\"SiteContentUI.setTab('" + id + "')\">" +
      '<i data-icon="' + icon + '"></i>' +
      "<span>" + esc(label) + "</span>" +
      (noCount ? "" : '<span class="sc-tab-count" id="sc-count-' + id + '">0</span>') +
      '<span class="sc-tab-dot is-hidden" id="sc-dot-' + id + '" ' +
      'title="This section has unsaved changes"></span>' +
      "</button>"
    );
  }

  // ── Toolbars ───────────────────────────────────────────────────────────
  // The same pill row the GIS map, Residency and Certificates use, so the
  // whole MIS reads as one system.
  function annToolbarHtml() {
    return (
      '<div class="gis-filter-row sc-toolbar">' +
        '<div class="gis-search-wrap">' +
          '<i data-icon="search" class="sc-search-icon"></i>' +
          '<input type="text" class="gis-search-input" id="sc-ann-search" autocomplete="off" ' +
            'placeholder="Search announcements…" ' +
            "oninput=\"SiteContentUI.filter('annText', this.value)\" />" +
        "</div>" +
        '<select class="gis-filter-select" id="sc-ann-status" ' +
          "onchange=\"SiteContentUI.filter('annStatus', this.value)\">" +
          '<option value="">All statuses</option>' +
          '<option value="live">Live</option>' +
          '<option value="soon">Coming down soon</option>' +
          '<option value="expired">Expired</option>' +
          '<option value="new">Not yet published</option>' +
        "</select>" +
        '<select class="gis-filter-select" id="sc-ann-tag" ' +
          "onchange=\"SiteContentUI.filter('annTag', this.value)\">" +
          '<option value="">All tags</option>' +
          SiteConfig.ANNOUNCEMENT_TAGS.map(function (t) {
            return '<option value="' + esc(t) + '">' + esc(t) + "</option>";
          }).join("") +
        "</select>" +
        '<span class="sc-toolbar-count" id="sc-ann-count"></span>' +
        '<span class="sc-toolbar-spacer"></span>' +
        '<button type="button" class="btn btn-sm btn-ghost is-hidden" id="sc-ann-collapse" ' +
          "onclick=\"SiteContentUI.collapseAll('ann')\">Collapse all</button>" +
        '<button type="button" class="btn btn-sm btn-gold" onclick="SiteContentUI.addAnn()">' +
          '<i data-icon="plus"></i> New announcement</button>' +
      "</div>"
    );
  }

  function offToolbarHtml() {
    return (
      '<div class="gis-filter-row sc-toolbar">' +
        '<div class="gis-search-wrap">' +
          '<i data-icon="search" class="sc-search-icon"></i>' +
          '<input type="text" class="gis-search-input" id="sc-off-search" autocomplete="off" ' +
            'placeholder="Search officials…" ' +
            "oninput=\"SiteContentUI.filter('offText', this.value)\" />" +
        "</div>" +
        '<span class="sc-toolbar-count" id="sc-off-count"></span>' +
        '<span class="sc-toolbar-spacer"></span>' +
        // Only ever visible when the order could not be written at the moment
        // it changed — the request failed, or a new official has no id yet.
        // The rest of the time reordering saves itself and this is not here.
        '<button type="button" class="btn btn-sm btn-gold is-hidden" id="sc-off-order" ' +
          'title="The display order has not reached the server yet" ' +
          "onclick=\"SiteContentUI.saveOrder('off')\">" +
          '<i data-icon="arrow-up"></i> Save order</button>' +
        '<button type="button" class="btn btn-sm btn-ghost is-hidden" id="sc-off-collapse" ' +
          "onclick=\"SiteContentUI.collapseAll('off')\">Collapse all</button>" +
        '<button type="button" class="btn btn-sm btn-gold" onclick="SiteContentUI.addOff()">' +
          '<i data-icon="plus"></i> Add official</button>' +
      "</div>"
    );
  }

  function hotToolbarHtml() {
    return (
      '<div class="gis-filter-row sc-toolbar">' +
        '<div class="gis-search-wrap">' +
          '<i data-icon="search" class="sc-search-icon"></i>' +
          '<input type="text" class="gis-search-input" id="sc-hot-search" autocomplete="off" ' +
            'placeholder="Search hotlines…" ' +
            "oninput=\"SiteContentUI.filter('hotText', this.value)\" />" +
        "</div>" +
        '<span class="sc-toolbar-count" id="sc-hot-count"></span>' +
        '<span class="sc-toolbar-spacer"></span>' +
        '<button type="button" class="btn btn-sm btn-gold is-hidden" id="sc-hot-order" ' +
          'title="The display order has not reached the server yet" ' +
          "onclick=\"SiteContentUI.saveOrder('hot')\">" +
          '<i data-icon="arrow-up"></i> Save order</button>' +
        '<button type="button" class="btn btn-sm btn-ghost is-hidden" id="sc-hot-collapse" ' +
          "onclick=\"SiteContentUI.collapseAll('hot')\">Collapse all</button>" +
        '<button type="button" class="btn btn-sm btn-gold" onclick="SiteContentUI.addHot()">' +
          '<i data-icon="plus"></i> Add hotline</button>' +
      "</div>"
    );
  }

  // ═══════════ Load ═══════════
  async function load() {
    try {
      var res = await Promise.all([
        apiGet("/api/officials"),
        // include_expired: the editor lists posts that have already come down,
        // marked as such, so they can be re-dated or removed. Without it a post
        // would appear to have vanished the day it expired.
        apiGet("/api/announcements?include_expired=1"),
        apiGet("/api/hotlines"),
        // Both are allowed to fail: the editor works without the SMS panel,
        // and a purok list that did not load only costs the audience picker.
        apiGet("/api/sms/status").catch(function () {
          return null;
        }),
        apiGet("/api/puroks").catch(function () {
          return [];
        }),
        // Allowed to fail on its own too: a history that did not load leaves
        // its tab saying so, not the whole editor empty.
        apiGet("/api/history").catch(function () {
          return null;
        }),
      ]);
      offs = res[0].map(function (row) {
        var o = SiteConfig.officialFromApi(row);
        o._uid = newUid();
        o._clean = offSig(o);
        return o;
      });
      anns = res[1].map(function (row) {
        var a = {
          id: row.id,
          title: row.title || "",
          body: row.body || "",
          tag: row.tag || "Advisory",
          created_at: row.created_at,
          expires_at: row.expires_at || "",
          expires_time: row.expires_time || "",
          _uid: newUid(),
        };
        a._clean = annSig(a);
        return a;
      });
      hots = res[2].map(function (row) {
        var h = {
          id: row.id,
          label: row.label || "",
          number: row.number || "",
          dial: row.dial || "",
          category: row.category || "barangay",
          is_emergency: !!row.is_emergency,
          is_primary: !!row.is_primary,
          notes: row.notes || "",
          _uid: newUid(),
        };
        h._clean = hotSig(h);
        return h;
      });
      if (res[3])
        sms = {
          can: res[3].can_broadcast === true,
          mode: res[3].mode || "",
          peso: res[3].peso_per_credit || 0.56,
        };
      puroks = Array.isArray(res[4]) ? res[4] : [];
      if (res[5]) histLoaded(res[5]);
      baseOrder.off = savedOrder("off");
      baseOrder.hot = savedOrder("hot");
    } catch (e) {
      fail("Could not load site content: " + e.message);
    }
    renderList("ann");
    renderList("off");
    renderList("hot");
    renderHistory();
    paintBar();
  }

  // The server's copy becomes the working copy and the clean signature.
  function histLoaded(row) {
    hist = {
      title: row.title || "",
      body: row.body || "",
      updated_at: row.updated_at || null,
    };
    hist._clean = histSig(hist);
    hist._liveEmpty = !hist.body.trim();
  }

  // ═══════════ Filtering ═══════════
  function visibleAnns() {
    var q = filters.annText.trim().toLowerCase();
    return anns.filter(function (a) {
      if (filters.annTag && (a.tag || "Advisory") !== filters.annTag) return false;
      if (filters.annStatus && annStatus(a) !== filters.annStatus) return false;
      if (!q) return true;
      return (
        (a.title || "").toLowerCase().indexOf(q) !== -1 ||
        (a.body || "").toLowerCase().indexOf(q) !== -1
      );
    });
  }

  function visibleOffs() {
    var q = filters.offText.trim().toLowerCase();
    if (!q) return offs.slice();
    return offs.filter(function (o) {
      return (
        SiteConfig.displayName(o).toLowerCase().indexOf(q) !== -1 ||
        (o.role || "").toLowerCase().indexOf(q) !== -1 ||
        (o.desc || "").toLowerCase().indexOf(q) !== -1
      );
    });
  }

  function visibleHots() {
    var q = filters.hotText.trim().toLowerCase();
    if (!q) return hots.slice();
    return hots.filter(function (h) {
      return (
        (h.label || "").toLowerCase().indexOf(q) !== -1 ||
        (h.number || "").toLowerCase().indexOf(q) !== -1 ||
        (h.category || "").toLowerCase().indexOf(q) !== -1 ||
        (h.notes || "").toLowerCase().indexOf(q) !== -1
      );
    });
  }

  var annFiltered = function () {
    return !!(filters.annText || filters.annStatus || filters.annTag);
  };

  // ═══════════ Row markup ═══════════
  function flagsHtml(item, kind) {
    var out = "";
    if (kind === "ann" && isExpired(item))
      out += '<span class="sc-chip sc-chip-expired">Expired</span>';
    // The primary line is the one the system itself uses, so it is worth
    // seeing from the collapsed row: it is the number every text message
    // quotes, and the one entry that cannot be deleted.
    if (kind === "hot" && item.is_primary)
      out += '<span class="sc-chip sc-chip-primary">Primary</span>';
    if (!item.id) out += '<span class="sc-chip sc-chip-new">New</span>';
    else if (DIRTY[kind](item))
      out += '<span class="sc-chip sc-chip-edited">Edited</span>';
    return out;
  }

  // ── Per-row Save ───────────────────────────────────────────────────────
  // Two of them, and they are not redundant.
  //
  // The one in the bar is a 30px icon and rides on the collapsed row, because
  // a row does not have to be open to be dirty: type into a post, collapse it,
  // scroll on, and the only thing left saying so is the "Edited" chip. Without
  // a save beside that chip the row would have to be re-opened to write it.
  //
  // The one in the footer is a full button sitting where your eyes already
  // are, next to Remove, at the end of the fields you just filled in.
  //
  // Both are hidden entirely on a clean row rather than shown disabled: a
  // disabled Save on every one of twelve rows is twelve pieces of chrome
  // saying nothing.
  var isDirty = function (item, kind) {
    return DIRTY[kind](item);
  };

  function rowSaveBtnHtml(item, kind) {
    if (!isDirty(item, kind)) return "";
    var busy = !!savingRows[item._uid];
    return (
      '<button type="button" class="sc-icon-btn sc-icon-save" id="sc-rowsave-' +
      item._uid + '"' + (busy ? " disabled" : "") +
      ' title="' + (busy ? "Saving…" : "Save this " + NOUN[kind]) + '"' +
      ' aria-label="Save this ' + NOUN[kind] + '" ' +
      "onclick=\"event.stopPropagation();SiteContentUI.saveRow('" + item._uid + "')\">" +
      '<i data-icon="check"></i></button>'
    );
  }

  function footSaveBtnHtml(item, kind) {
    var busy = !!savingRows[item._uid];
    var dirty = isDirty(item, kind);
    // A row that has never been saved is always actionable, even while it is
    // still completely empty. isDirty() is false for a blank new row — by
    // design, so an abandoned "New" row is not counted as an unsaved change —
    // but a DISABLED "Saved" button on the row you just created reads as if the
    // page had already published a blank post. Pressing it while it is empty is
    // meant to land you in the title field with the reason, which is what
    // saveRow's validation does.
    var actionable = !item.id || dirty;
    return (
      '<button type="button" class="btn btn-sm btn-gold sc-foot-save" id="sc-footsave-' +
      item._uid + '"' + (busy || !actionable ? " disabled" : "") + " " +
      "onclick=\"SiteContentUI.saveRow('" + item._uid + "')\">" +
      '<i data-icon="check"></i> <span>' +
      (busy ? "Saving…" : !item.id ? "Publish" : dirty ? "Save" : "Saved") +
      "</span></button>"
    );
  }

  function headHtml(uid, open, lead, title, untitled, sub, flags) {
    return (
      '<button type="button" class="sc-item-head" aria-expanded="' +
        (open ? "true" : "false") + '" ' +
        // Only while open: the body it names does not exist in the DOM until
        // then, and an aria-controls pointing at nothing is worse than none.
        (open ? 'aria-controls="sc-body-' + uid + '" ' : "") +
        "onclick=\"SiteContentUI.toggle('" + uid + "')\">" +
        '<span class="sc-item-caret"><i data-icon="chevron-right"></i></span>' +
        lead +
        '<span class="sc-item-main">' +
          '<span class="sc-item-title' + (untitled ? " is-untitled" : "") + '">' +
            esc(title) + "</span>" +
          '<span class="sc-item-sub">' + esc(sub) + "</span>" +
        "</span>" +
        '<span class="sc-flags">' + flags + "</span>" +
      "</button>"
    );
  }

  // ── Announcement row ───────────────────────────────────────────────────
  function annRowHtml(a) {
    var open = !!openRows[a._uid];
    var st = annStatus(a);
    return (
      '<article class="sc-item' + (open ? " is-open" : "") +
        (isExpired(a) ? " is-expired" : "") + '" id="sc-row-' + a._uid +
        '" data-uid="' + a._uid + '" data-status="' + st + '">' +
        '<div class="sc-item-bar">' +
          headHtml(
            a._uid,
            open,
            '<span class="' + SiteConfig.tagClass(a.tag) + ' sc-tag">' +
              esc(a.tag || "Advisory") + "</span>",
            (a.title || "").trim() || "Untitled announcement",
            !(a.title || "").trim(),
            annSubText(a),
            flagsHtml(a, "ann")
          ) +
          '<span class="sc-item-tools">' + rowSaveBtnHtml(a, "ann") + "</span>" +
        "</div>" +
        (open ? annBodyHtml(a) : "") +
      "</article>"
    );
  }

  function annBodyHtml(a) {
    var u = a._uid;
    var set = function (field) {
      return "SiteContentUI.setAnn('" + u + "','" + field + "',this.value)";
    };
    return (
      '<div class="sc-item-body" id="sc-body-' + u + '">' +
        '<div class="sc-fields">' +
          '<div class="form-group sc-col-3">' +
            '<label class="form-label" for="sc-tag-' + u + '">Tag</label>' +
            '<select class="form-control" id="sc-tag-' + u + '" onchange="' + set("tag") + '">' +
              SiteConfig.ANNOUNCEMENT_TAGS.map(function (t) {
                return (
                  '<option value="' + esc(t) + '"' + (t === a.tag ? " selected" : "") +
                  ">" + esc(t) + "</option>"
                );
              }).join("") +
            "</select>" +
          "</div>" +
          '<div class="form-group sc-col-9">' +
            '<label class="form-label" for="sc-title-' + u + '">Title</label>' +
            '<input class="form-control" id="sc-title-' + u + '" value="' + esc(a.title) +
              '" placeholder="e.g. Barangay Assembly — 3rd Quarter" oninput="' +
              set("title") + '" />' +
          "</div>" +
          '<div class="form-group sc-col-12">' +
            '<label class="form-label" for="sc-body-text-' + u + '">Details</label>' +
            '<textarea class="form-control sc-textarea" id="sc-body-text-' + u +
              '" placeholder="What residents need to know — schedule, venue, requirements…" ' +
              'oninput="' + set("body") + '">' + esc(a.body) + "</textarea>" +
          "</div>" +
        "</div>" +
        // Take-down date lives in the footer rather than the field grid: it is
        // one short control, and a whole grid row for it would leave two thirds
        // of the line empty.
        //
        // The time beside it is optional and only appears once a date is set —
        // there is nothing for it to be a time OF otherwise, and an empty time
        // box next to an empty date box invites filling in the wrong one.
        // Leaving it blank means the end of that day, which is what most
        // notices mean; a time is for the ones that stop being true partway
        // through a day (a brown-out until 5 PM, a deadline at noon).
        smsPanelHtml(a) +
        '<div class="sc-item-foot">' +
          '<div class="sc-expiry">' +
            '<label class="sc-inline-label" for="sc-exp-' + u + '">Take down after</label>' +
            '<input class="form-control sc-date" type="date" id="sc-exp-' + u + '" ' +
              (expiryDateChanged(a) ? 'data-rule="future-date" ' : "") +
              'value="' + esc(a.expires_at || "") + '" min="' + todayIso() + '" ' +
              'onchange="' + set("expires_at") + '" />' +
            '<span class="sc-expiry-time' + (a.expires_at ? "" : " is-hidden") +
              '" id="sc-time-wrap-' + u + '">' +
              '<label class="sc-inline-label sc-inline-label-sub" for="sc-time-' + u +
                '">at</label>' +
              '<input class="form-control sc-time" type="time" id="sc-time-' + u + '" ' +
                'value="' + esc(a.expires_time || "") + '" ' +
                'title="Optional — leave blank to come down at the end of the day" ' +
                'onchange="' + set("expires_time") + '" />' +
            "</span>" +
            '<button type="button" class="btn btn-sm btn-ghost' +
              (a.expires_at ? "" : " is-hidden") + '" id="sc-clear-' + u + '" ' +
              "onclick=\"SiteContentUI.clearExpiry('" + u + "')\">Clear</button>" +
            '<span class="sc-expiry-note" id="sc-note-' + u + '">' +
              esc(expiryNote(a)) + "</span>" +
          "</div>" +
          '<div class="sc-foot-actions">' +
            '<button type="button" class="btn btn-sm btn-danger-outline" ' +
              "onclick=\"SiteContentUI.removeAnn('" + u + "')\">" +
              '<i data-icon="trash"></i> Remove</button>' +
            footSaveBtnHtml(a, "ann") +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  // ── "Also send as a text message" ─────────────────────────────
  var CLASSES = [
    ["senior", "Senior citizens"],
    ["pwd", "PWD"],
    ["solo-parent", "Solo parents"],
    ["indigent", "Indigent families"],
  ];

  var smsOf = function (uid) {
    if (!smsDraft[uid])
      smsDraft[uid] = {
        on: false,
        purok_ids: [],
        classifications: [],
        emergency: false,
        preview: null,
        busy: false,
      };
    return smsDraft[uid];
  };

  // One line in plain words, rather than a table of figures: how many people,
  // how many are missed and why, and what it costs in pesos.
  function costLine(p) {
    var bits = [
      p.residents + (p.residents === 1 ? " resident" : " residents"),
      p.officials + (p.officials === 1 ? " official" : " officials"),
    ];
    var missed = [];
    if (p.unreachable)
      missed.push(p.unreachable + " with no mobile number on file");
    if (p.skipped_by_setting)
      missed.push(p.skipped_by_setting + " who turned announcements off");
    return (
      bits.join(" + ") +
      " · " +
      p.segments +
      (p.segments === 1 ? " part" : " parts") +
      " · " +
      p.credits +
      " credits · PHP " +
      p.cost_php.toFixed(2) +
      (missed.length ? " — not texted: " + missed.join(", ") : "")
    );
  }

  function chip(uid, kind, value, label, on) {
    return (
      '<label class="sc-chip-pick' + (on ? " is-on" : "") + '">' +
      '<input type="checkbox"' + (on ? " checked" : "") + " " +
      "onchange=\"SiteContentUI.smsPick('" + uid + "','" + kind + "','" +
      String(value).replace(/'/g, "") + "',this.checked)\" />" +
      esc(label) + "</label>"
    );
  }

  function smsPanelHtml(a) {
    if (!sms.can) return "";
    var u = a._uid;
    var d = smsOf(u);
    var p = d.preview;
    return (
      '<div class="sc-sms' + (d.on ? " is-open" : "") + '">' +
        '<label class="sc-sms-toggle">' +
          '<input type="checkbox"' + (d.on ? " checked" : "") +
            " onchange=\"SiteContentUI.smsToggle('" + u + "',this.checked)\" />" +
          "<span><strong>Also send this as a text message</strong>" +
          '<span class="sc-hint">Costs credits. The bulletin post above is free and stays up; ' +
          "a text goes out once, to phones.</span></span>" +
        "</label>" +
        (d.on
          ? '<div class="sc-sms-body">' +
              '<div class="sc-sms-row"><span class="sc-sms-label">Who</span><div class="sc-chips">' +
                (puroks.length
                  ? puroks
                      .map(function (pk) {
                        return chip(
                          u,
                          "purok",
                          pk.purok_id,
                          pk.name,
                          d.purok_ids.indexOf(pk.purok_id) !== -1
                        );
                      })
                      .join("")
                  : '<span class="sc-hint">Purok list unavailable — this will go to everyone.</span>') +
              "</div></div>" +
              '<div class="sc-sms-row"><span class="sc-sms-label">Groups</span><div class="sc-chips">' +
                CLASSES.map(function (c) {
                  return chip(u, "class", c[0], c[1], d.classifications.indexOf(c[0]) !== -1);
                }).join("") +
              "</div></div>" +
              '<p class="sc-hint sc-sms-scope">' +
                esc(
                  !d.purok_ids.length && !d.classifications.length
                    ? "Nothing picked: every resident with a mobile number on file."
                    : "Residents who match the puroks AND the groups picked."
                ) +
              "</p>" +
              '<label class="sc-sms-emergency">' +
                '<input type="checkbox"' + (d.emergency ? " checked" : "") +
                  " onchange=\"SiteContentUI.smsEmergency('" + u + "',this.checked)\" />" +
                "<span>Mark as <strong>Emergency</strong> — the text starts with [EMERGENCY] " +
                "and reaches residents who turned announcements off. For a real emergency only.</span>" +
              "</label>" +
              (p
                ? '<div class="sc-sms-preview">' +
                    '<div class="sc-sms-body-text">' + esc(p.body) + "</div>" +
                    '<div class="sc-sms-cost' + (p.over_cap ? " is-warning" : "") + '">' +
                      esc(costLine(p)) +
                      (p.over_cap
                        ? " — over today's cap of " + p.daily_cap +
                          " credits; the rest goes out tomorrow"
                        : "") +
                    "</div>" +
                  "</div>"
                : "") +
              '<div class="sc-sms-actions">' +
                '<button type="button" class="btn btn-sm btn-outline"' +
                  (d.busy ? " disabled" : "") +
                  " onclick=\"SiteContentUI.smsPreview('" + u + "')\">" +
                  '<i data-icon="search"></i> ' + (p ? "Check again" : "Check who and what it costs") +
                "</button>" +
                (p && p.recipients
                  ? '<button type="button" class="btn btn-sm btn-gold"' +
                    (d.busy ? " disabled" : "") +
                    " onclick=\"SiteContentUI.smsSend('" + u + "')\">" +
                    '<i data-icon="phone"></i> Send to ' + p.recipients + " people</button>"
                  : "") +
                (sms.mode !== "live"
                  ? '<span class="sc-hint">Texting is in ' + esc(sms.mode) +
                    " mode: the message is written to the SMS Log and not sent.</span>"
                  : "") +
              "</div>" +
            "</div>"
          : "") +
      "</div>"
    );
  }

  // ── Official row ───────────────────────────────────────────────────────
  function offRowHtml(o, rank, total) {
    var open = !!openRows[o._uid];
    var locked = !!filters.offText.trim();
    var name = SiteConfig.displayName(o).trim();
    return (
      '<article class="sc-item' + (open ? " is-open" : "") + '" id="sc-row-' + o._uid +
        '" data-uid="' + o._uid + '"' +
        // Same gold rail a not-yet-published announcement gets.
        (o.id ? "" : ' data-status="new"') + ">" +
        '<div class="sc-item-bar">' +
          '<span class="sc-rank" title="Display order on the homepage">' + rank + "</span>" +
          headHtml(
            o._uid,
            open,
            '<span class="sc-avatar" id="sc-av-' + o._uid + '">' +
              SiteConfig.avatarInner(o) + "</span>",
            name || "Unnamed official",
            !name,
            (o.role || "").trim() || "No position set",
            flagsHtml(o, "off")
          ) +
          '<span class="sc-item-tools">' +
            rowSaveBtnHtml(o, "off") +
            orderBtn(o._uid, -1, "arrow-up", "Move up", rank === 1 || locked, locked) +
            orderBtn(o._uid, 1, "arrow-down", "Move down", rank === total || locked, locked) +
          "</span>" +
        "</div>" +
        (open ? offBodyHtml(o) : "") +
      "</article>"
    );
  }

  // ── Hotline row ────────────────────────────────────────────
  // Ordered like the officials, because the order is what the public card
  // prints and 911 belongs at the top of it.
  function hotRowHtml(h, rank, total) {
    var open = !!openRows[h._uid];
    var locked = !!filters.hotText.trim();
    var label = (h.label || "").trim();
    return (
      '<article class="sc-item' + (open ? " is-open" : "") + '" id="sc-row-' + h._uid +
        '" data-uid="' + h._uid + '"' +
        (h.id ? "" : ' data-status="new"') + ">" +
        '<div class="sc-item-bar">' +
          '<span class="sc-rank" title="Order on the public emergency card">' + rank + "</span>" +
          headHtml(
            h._uid,
            open,
            '<span class="announcement-tag sc-tag hot-cat' +
              (h.is_emergency ? " is-emergency" : "") + '">' +
              esc(h.category || "other") + "</span>",
            label || "Unnamed hotline",
            !label,
            hotSubText(h),
            flagsHtml(h, "hot")
          ) +
          '<span class="sc-item-tools">' +
            rowSaveBtnHtml(h, "hot") +
            orderBtn(h._uid, -1, "arrow-up", "Move up", rank === 1 || locked, locked) +
            orderBtn(h._uid, 1, "arrow-down", "Move down", rank === total || locked, locked) +
          "</span>" +
        "</div>" +
        (open ? hotBodyHtml(h) : "") +
      "</article>"
    );
  }

  function hotBodyHtml(h) {
    var u = h._uid;
    var set = function (field) {
      return "SiteContentUI.setHot('" + u + "','" + field + "',this.value)";
    };
    var suggestion = hotSuggestDial(h);
    var showSuggest = !!suggestion && suggestion !== hotDial(h);
    return (
      '<div class="sc-item-body" id="sc-body-' + u + '">' +
        '<div class="sc-fields">' +
          '<div class="form-group sc-col-4">' +
            '<label class="form-label" for="sc-hlabel-' + u + '">Label</label>' +
            '<input class="form-control" id="sc-hlabel-' + u + '" value="' + esc(h.label) +
              '" placeholder="Barangay Hotline" oninput="' + set("label") + '" />' +
          "</div>" +
          '<div class="form-group sc-col-4">' +
            '<label class="form-label" for="sc-hnum-' + u + '">Number, as written</label>' +
            '<input class="form-control" id="sc-hnum-' + u + '" data-rule="phone-written" value="' + esc(h.number) +
              '" placeholder="043-702-8875" oninput="' + set("number") + '" />' +
            '<span class="sc-hint">What the public site prints.</span>' +
          "</div>" +
          '<div class="form-group sc-col-4">' +
            '<label class="form-label" for="sc-hcat-' + u + '">Category</label>' +
            '<select class="form-control" id="sc-hcat-' + u + '" onchange="' + set("category") + '">' +
              HOT_CATEGORIES.map(function (c) {
                return '<option value="' + esc(c) + '"' +
                  ((h.category || "barangay") === c ? " selected" : "") + ">" +
                  esc(c.charAt(0).toUpperCase() + c.slice(1)) + "</option>";
              }).join("") +
            "</select>" +
          "</div>" +
          '<div class="form-group sc-col-4">' +
            '<label class="form-label" for="sc-hdial-' + u + '">What a phone dials</label>' +
            '<input class="form-control" id="sc-hdial-' + u + '" data-rule="dial" value="' + esc(h.dial) +
              '" placeholder="+63437028875" oninput="' + set("dial") + '" />' +
            '<span class="sc-hint">' +
              // The 0 of 043 is the national trunk prefix: it only works from
              // a landline in the same area, and the public site is read on
              // phones. +63 works from both.
              (showSuggest
                ? 'Suggested: <button type="button" class="sc-link-btn" ' +
                  "onclick=\"SiteContentUI.useDial('" + u + "')\">" +
                  esc(suggestion) + "</button>"
                : "Digits, starting +63 for a mobile network.") +
            "</span>" +
          "</div>" +
          '<div class="form-group sc-col-4">' +
            '<label class="form-label" for="sc-hnotes-' + u + '">When it is answered</label>' +
            '<input class="form-control" id="sc-hnotes-' + u + '" value="' + esc(h.notes) +
              '" placeholder="24/7" maxlength="120" oninput="' + set("notes") + '" />' +
            '<span class="sc-hint">Shown beside the number. "24/7", "office hours only".</span>' +
          "</div>" +
          '<div class="form-group sc-col-4">' +
            '<label class="form-label">Where it appears</label>' +
            '<div class="checkbox-row">' +
              "<label><input type=\"checkbox\"" + (h.is_emergency ? " checked" : "") +
                " onchange=\"SiteContentUI.setHotFlag('" + u + "','is_emergency',this.checked)\" /> " +
                "On the emergency card</label>" +
              "<label" + (h.is_primary ? ' title="Make another barangay line primary to move this"' : "") +
                "><input type=\"checkbox\"" + (h.is_primary ? " checked" : "") +
                // Mirrors the server: the primary flag is MOVED to another
                // line, never switched off, because every text message quotes
                // this number (routes/hotlines.js).
                (h.is_primary ? " disabled" : "") +
                " onchange=\"SiteContentUI.setHotFlag('" + u + "','is_primary',this.checked)\" /> " +
                "Primary barangay line</label>" +
            "</div>" +
          "</div>" +
        "</div>" +
        '<div class="sc-item-foot">' +
          '<span class="sc-hint">' +
            (h.is_primary
              ? "This is the number the system quotes in its text messages. " +
                "To retire it, add the new line and make that one primary."
              : "Emergency entries appear on the homepage card, 911 first. " +
                "Enter numbers from official sources only — never from memory.") +
          "</span>" +
          '<div class="sc-foot-actions">' +
            (h.is_primary
              ? ""
              : '<button type="button" class="btn btn-sm btn-danger-outline" ' +
                "onclick=\"SiteContentUI.removeHot('" + u + "')\">" +
                '<i data-icon="trash"></i> Remove hotline</button>') +
            footSaveBtnHtml(h, "hot") +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  function orderBtn(uid, delta, icon, label, disabled, locked) {
    return (
      '<button type="button" class="sc-icon-btn"' + (disabled ? " disabled" : "") +
      ' title="' + (locked ? "Clear the search to reorder" : label) + '" ' +
      'aria-label="' + label + '" ' +
      "onclick=\"SiteContentUI.move('" + uid + "'," + delta + ')">' +
      '<i data-icon="' + icon + '"></i></button>'
    );
  }

  function offBodyHtml(o) {
    var u = o._uid;
    var set = function (field) {
      return "SiteContentUI.setOff('" + u + "','" + field + "',this.value)";
    };
    return (
      '<div class="sc-item-body sc-official-body" id="sc-body-' + u + '">' +
        // A 96px avatar and its two controls, not the 250px replica of the
        // public card the old editor carried — the homepage itself shows the
        // card, and the initials fallback is the only part of it that could
        // not be seen from the collapsed row.
        '<div class="sc-photo">' +
          '<span class="sc-avatar sc-avatar-lg" id="sc-av-lg-' + u + '">' +
            SiteConfig.avatarInner(o) + "</span>" +
          '<label class="btn btn-sm btn-outline sc-photo-btn">' +
            '<i data-icon="camera"></i> <span id="sc-uplabel-' + u + '">' +
              (o.photo ? "Replace" : "Upload") + "</span>" +
            '<input type="file" accept="image/*" class="sc-photo-input" ' +
              "onchange=\"SiteContentUI.uploadPhoto('" + u + "', this)\" />" +
          "</label>" +
          '<button type="button" class="btn btn-sm btn-ghost sc-photo-remove' +
            (o.photo ? "" : " is-hidden") + '" id="sc-rmphoto-' + u + '" ' +
            "onclick=\"SiteContentUI.removePhoto('" + u + "')\">Remove photo</button>" +
        "</div>" +
        '<div class="sc-official-fields">' +
          '<div class="sc-fields">' +
            '<div class="form-group sc-col-2">' +
              '<label class="form-label" for="sc-hon-' + u + '">Honorific</label>' +
              '<input class="form-control" id="sc-hon-' + u + '" data-rule="name" maxlength="20" value="' + esc(o.honorific) +
                '" placeholder="Hon." oninput="' + set("honorific") + '" />' +
            "</div>" +
            '<div class="form-group sc-col-5">' +
              '<label class="form-label" for="sc-name-' + u + '">Full name</label>' +
              '<input class="form-control" id="sc-name-' + u + '" data-rule="name" maxlength="80" value="' + esc(o.name) +
                '" placeholder="Juan Dela Cruz" oninput="' + set("name") + '" />' +
            "</div>" +
            '<div class="form-group sc-col-5">' +
              '<label class="form-label" for="sc-role-' + u + '">Position / role</label>' +
              '<input class="form-control" id="sc-role-' + u + '" value="' + esc(o.role) +
                '" placeholder="Punong Barangay" oninput="' + set("role") + '" />' +
            "</div>" +
            '<div class="form-group sc-col-12">' +
              '<label class="form-label" for="sc-desc-' + u + '">Description</label>' +
              '<textarea class="form-control sc-textarea" id="sc-desc-' + u +
                '" placeholder="Short description of this official\'s responsibilities" ' +
                'oninput="' + set("desc") + '">' + esc(o.desc) + "</textarea>" +
            "</div>" +
          "</div>" +
          '<div class="sc-item-foot">' +
            '<span class="sc-hint">Square photos work best — large files are resized automatically.</span>' +
            '<div class="sc-foot-actions">' +
              '<button type="button" class="btn btn-sm btn-danger-outline" ' +
                "onclick=\"SiteContentUI.removeOff('" + u + "')\">" +
                '<i data-icon="trash"></i> Remove official</button>' +
              footSaveBtnHtml(o, "off") +
            "</div>" +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  // ── Empty states ───────────────────────────────────────────────────────
  function emptyHtml(icon, title, desc, action) {
    return (
      '<div class="empty-state">' +
        '<div class="empty-state-icon"><i data-icon="' + icon + '"></i></div>' +
        '<div class="empty-state-title">' + esc(title) + "</div>" +
        '<p class="empty-state-desc">' + esc(desc) + "</p>" +
        (action || "") +
      "</div>"
    );
  }

  // ═══════════ List rendering ═══════════
  function renderList(kind) {
    var box = document.getElementById("sc-list-" + kind);
    if (!box) return;
    var html;
    if (kind === "hot") {
      var hotVis = visibleHots();
      html = !hots.length
        ? emptyHtml(
            "phone",
            "No hotlines listed",
            "The homepage falls back to the two numbers written into the page. " +
              "Add them here and every page reads from this list instead.",
            '<button type="button" class="btn btn-sm btn-gold" onclick="SiteContentUI.addHot()">' +
              '<i data-icon="plus"></i> Add hotline</button>'
          )
        : !hotVis.length
          ? emptyHtml(
              "search-x",
              "No hotline matches that search",
              "Try a different label, number or category.",
              '<button type="button" class="btn btn-sm btn-outline" onclick="SiteContentUI.clearFilters()">Clear search</button>'
            )
          : hotVis
              .map(function (h) {
                return hotRowHtml(h, hots.indexOf(h) + 1, hots.length);
              })
              .join("");
    } else if (kind === "ann") {
      var list = visibleAnns();
      html = !anns.length
        ? emptyHtml(
            "megaphone",
            "No announcements yet",
            "Nothing is on the public bulletin. Post the first notice and it appears on the homepage straight away.",
            '<button type="button" class="btn btn-sm btn-gold" onclick="SiteContentUI.addAnn()">' +
              '<i data-icon="plus"></i> New announcement</button>'
          )
        : !list.length
          ? emptyHtml(
              "search-x",
              "Nothing matches those filters",
              "No announcement matches the current search, status or tag.",
              '<button type="button" class="btn btn-sm btn-outline" onclick="SiteContentUI.clearFilters()">Clear filters</button>'
            )
          : list.map(annRowHtml).join("");
    } else {
      var vis = visibleOffs();
      html = !offs.length
        ? emptyHtml(
            "users",
            "No officials listed",
            "The “Barangay Officials” section of the homepage is empty. Add the first official to fill it.",
            '<button type="button" class="btn btn-sm btn-gold" onclick="SiteContentUI.addOff()">' +
              '<i data-icon="plus"></i> Add official</button>'
          )
        : !vis.length
          ? emptyHtml(
              "search-x",
              "No official matches that search",
              "Try a different name or position.",
              '<button type="button" class="btn btn-sm btn-outline" onclick="SiteContentUI.clearFilters()">Clear search</button>'
            )
          : vis
              .map(function (o) {
                // Rank is the position in the FULL list, not the filtered one:
                // it is the display order on the homepage, and it must not
                // change just because a search is open.
                return offRowHtml(o, offs.indexOf(o) + 1, offs.length);
              })
              .join("");
    }
    box.innerHTML = html;
    hydrate(box);
    paintToolbar(kind);
  }

  // Replace one row in place — used when a row opens, closes or moves, so the
  // rest of the list (and anything focused in it) is left alone.
  function renderRow(uid) {
    var el = document.getElementById("sc-row-" + uid);
    if (!el) return;
    var a = byUid(anns, uid);
    var html;
    if (a) html = annRowHtml(a);
    else {
      var i = indexOfUid(offs, uid);
      if (i !== -1) html = offRowHtml(offs[i], i + 1, offs.length);
      else {
        var j = indexOfUid(hots, uid);
        if (j === -1) return;
        html = hotRowHtml(hots[j], j + 1, hots.length);
      }
    }
    el.outerHTML = html;
    hydrate(document.getElementById("sc-row-" + uid));
  }

  function rowEl(uid) {
    return document.getElementById("sc-row-" + uid);
  }

  function setText(row, sel, text) {
    var el = row && row.querySelector(sel);
    if (el) el.textContent = text;
  }

  // ═══════════ History ═══════════
  // One form inside the same card the lists use. Painted in two passes like
  // the rows: renderHistory() builds it, paintHistory() rewrites only the
  // chips, the count and the buttons on each keystroke, so the caret stays
  // where it is.
  function histCountText(h) {
    // The homepage's own rule for what a paragraph is, so the count here is
    // the number of paragraphs a visitor will see.
    var paras = SiteConfig.historyParagraphs(h.body);
    if (!paras.length)
      return "Empty — saved like this, the section comes off the homepage.";
    var words = paras.join(" ").split(" ").length;
    return (
      paras.length + (paras.length === 1 ? " paragraph" : " paragraphs") +
      " · " + words + (words === 1 ? " word" : " words") +
      " · leave a blank line between paragraphs"
    );
  }

  // About the SAVED copy: whether the homepage shows the section right now.
  function histFlagsHtml() {
    var out = hist._liveEmpty
      ? '<span class="sc-chip sc-chip-expired">Hidden</span>'
      : '<span class="sc-chip sc-chip-live">On the homepage</span>';
    if (histDirty()) out += '<span class="sc-chip sc-chip-edited">Edited</span>';
    return out;
  }

  function histSubText() {
    var when = hist.updated_at ? new Date(hist.updated_at) : null;
    var saved =
      when && !isNaN(when.getTime())
        ? "Last saved " + SiteConfig.formatAnnouncementDate(hist.updated_at) +
          ", " + when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : "Not saved yet";
    return (
      (hist._liveEmpty
        ? "Not on the homepage — the story is empty"
        : "On the homepage between the bulletin and the officials") +
      " · " + saved
    );
  }

  function histSaveBtnHtml() {
    var dirty = histDirty();
    return (
      '<button type="button" class="btn btn-sm btn-gold sc-foot-save" id="sc-footsave-history"' +
      (histSaving || !dirty ? " disabled" : "") +
      ' onclick="SiteContentUI.saveHistory()">' +
      '<i data-icon="check"></i> <span>' +
      (histSaving ? "Saving…" : dirty ? "Save" : "Saved") +
      "</span></button>"
    );
  }

  function renderHistory() {
    var box = document.getElementById("sc-history");
    if (!box) return;
    if (!hist) {
      box.innerHTML = emptyHtml(
        "file-text",
        "The history could not be loaded",
        "Nothing has been changed. Reload the page to try again.",
        '<button type="button" class="btn btn-sm btn-outline" onclick="location.reload()">Reload</button>'
      );
      hydrate(box);
      return;
    }
    var set = function (field) {
      return "SiteContentUI.setHistory('" + field + "',this.value)";
    };
    box.innerHTML =
      '<div class="sc-doc-head">' +
        '<span class="sc-item-main">' +
          '<span class="sc-item-title">Barangay history</span>' +
          '<span class="sc-item-sub" id="sc-hist-sub">' + esc(histSubText()) + "</span>" +
        "</span>" +
        '<span class="sc-flags" id="sc-hist-flags">' + histFlagsHtml() + "</span>" +
      "</div>" +
      '<div class="sc-item-body sc-doc-body" id="sc-body-history">' +
        '<div class="sc-fields">' +
          '<div class="form-group sc-col-12">' +
            '<label class="form-label" for="sc-hist-title">Title</label>' +
            '<input class="form-control" id="sc-hist-title" maxlength="120" value="' +
              esc(hist.title) + '" placeholder="The History of Conde Labak" ' +
              'oninput="' + set("title") + '" />' +
          "</div>" +
          '<div class="form-group sc-col-12">' +
            '<label class="form-label" for="sc-hist-body">The story</label>' +
            '<textarea class="form-control sc-textarea sc-doc-text" id="sc-hist-body" maxlength="20000" ' +
              'placeholder="How the barangay got its name, its first families, what life was like…" ' +
              'oninput="' + set("body") + '">' + esc(hist.body) + "</textarea>" +
            '<span class="sc-hint" id="sc-hist-count">' + esc(histCountText(hist)) + "</span>" +
          "</div>" +
        "</div>" +
        '<div class="sc-item-foot">' +
          '<span class="sc-hint">Saving publishes it to the homepage straight away.</span>' +
          '<div class="sc-foot-actions">' +
            '<button type="button" class="btn btn-sm btn-ghost' +
              (histDirty() ? "" : " is-hidden") + '" id="sc-hist-discard" ' +
              'onclick="SiteContentUI.discardHistory()">Discard changes</button>' +
            histSaveBtnHtml() +
          "</div>" +
        "</div>" +
      "</div>";
    hydrate(box);
  }

  function paintHistory() {
    if (!hist) return;
    var flags = document.getElementById("sc-hist-flags");
    if (flags) flags.innerHTML = histFlagsHtml();
    var sub = document.getElementById("sc-hist-sub");
    if (sub) sub.textContent = histSubText();
    var count = document.getElementById("sc-hist-count");
    if (count) count.textContent = histCountText(hist);
    var discard = document.getElementById("sc-hist-discard");
    if (discard) discard.classList.toggle("is-hidden", !histDirty() || histSaving);
    var save = document.getElementById("sc-footsave-history");
    if (save) {
      save.outerHTML = histSaveBtnHtml();
      hydrate(document.querySelector("#sc-history .sc-foot-actions"));
    }
    paintBar();
  }

  // ═══════════ Chrome painting ═══════════
  var lastCount = -1;

  function paintBar() {
    var n = totalChanges();
    var pill = document.getElementById("sc-dirty");
    // Rebuilt only when the number actually moves. paintBar() runs on every
    // keystroke, and the pill is a live region — re-writing it each time would
    // both churn the DOM and read the same sentence out on every letter typed.
    if (pill && n !== lastCount) {
      pill.setAttribute("data-state", n ? "dirty" : "clean");
      pill.innerHTML =
        '<i data-icon="' + (n ? "pencil" : "check-circle") + '"></i>' +
        "<span>" +
        // "unsaved row" rather than "unsaved change": the number now counts
        // rows each of which has its own Save, so it says where to go, not how
        // much one button is about to do.
        (n
          ? n + " unsaved " + (n === 1 ? "row" : "rows")
          : "All changes saved") +
        "</span>";
      hydrate(pill);
      lastCount = n;
    }

    setCount("announcements", anns.length, annChanges());
    setCount("officials", offs.length, offChanges());
    setCount("hotlines", hots.length, hotChanges());
    setCount("history", 0, histChanges()); // the dot only — the tab has no count
    paintToolbar("ann");
    paintToolbar("off");
    paintToolbar("hot");
  }

  function setCount(id, total, changes) {
    var c = document.getElementById("sc-count-" + id);
    if (c) c.textContent = total;
    var dot = document.getElementById("sc-dot-" + id);
    if (dot) dot.classList.toggle("is-hidden", !changes);
  }

  function paintToolbar(kind) {
    var list = listOf(kind);
    var shown =
      kind === "ann"
        ? visibleAnns().length
        : kind === "off"
          ? visibleOffs().length
          : visibleHots().length;
    var noun = kind === "ann" ? "post" : NOUN[kind];
    var count = document.getElementById("sc-" + kind + "-count");
    if (count) {
      count.textContent = !list.length
        ? ""
        : shown === list.length
          ? shown + " " + noun + (shown === 1 ? "" : "s")
          : "Showing " + shown + " of " + list.length;
    }
    var collapse = document.getElementById("sc-" + kind + "-collapse");
    if (collapse) {
      var anyOpen = list.some(function (x) {
        return openRows[x._uid];
      });
      collapse.classList.toggle("is-hidden", !anyOpen);
    }
    // Only the two hand-ordered lists have an order to write.
    if (kind !== "ann") {
      var order = document.getElementById("sc-" + kind + "-order");
      if (order) {
        order.classList.toggle(
          "is-hidden",
          !orderDirty(kind) || orderSaving[kind]
        );
        order.disabled = orderSaving[kind];
      }
    }
  }

  function applyTab() {
    ["announcements", "history", "officials", "hotlines"].forEach(function (id) {
      var on = id === tab;
      var btn = document.getElementById("sc-tab-" + id);
      var panel = document.getElementById("sc-panel-" + id);
      if (btn) {
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
      }
      if (panel) panel.hidden = !on;
    });
  }

  // ═══════════ Handlers ═══════════
  UI.setTab = function (id) {
    if (tab === id) return;
    tab = id;
    applyTab();
  };

  UI.filter = function (key, value) {
    filters[key] = value;
    renderList(key === "offText" ? "off" : key === "hotText" ? "hot" : "ann");
  };

  UI.clearFilters = function () {
    filters = {
      annText: "",
      annStatus: "",
      annTag: "",
      offText: "",
      hotText: "",
    };
    [
      "sc-ann-search",
      "sc-ann-status",
      "sc-ann-tag",
      "sc-off-search",
      "sc-hot-search",
    ].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = "";
    });
    renderList("ann");
    renderList("off");
    renderList("hot");
  };

  // ── Disclosure motion ──────────────────────────────────────────────────
  // A row's body only exists in the DOM while the row is open, so the two
  // directions are not symmetrical:
  //
  //   opening — renderRow() puts the body in at full height, and
  //             Motion.enter() folds it back to nothing and grows it.
  //   closing — the body has to be folded away BEFORE renderRow() drops it,
  //             or there is nothing left to animate.
  //
  // Both are best-effort: if js/motion.js is not on the page the row still
  // opens and closes, just instantly, which is what it did before.
  function motion() {
    return window.Motion && !window.Motion.reduced() ? window.Motion : null;
  }

  function bodyEl(uid) {
    var row = rowEl(uid);
    return row ? row.querySelector(".sc-item-body") : null;
  }

  // The caret and the open background belong to the click, not to the end of
  // the fold — a disclosure that waits 180ms to acknowledge the press feels
  // stuck. Only the body's height is animated.
  function markClosing(uid) {
    var row = rowEl(uid);
    if (!row) return;
    row.classList.remove("is-open");
    var head = row.querySelector(".sc-item-head");
    if (head) head.setAttribute("aria-expanded", "false");
  }

  UI.collapseAll = function (kind) {
    var list = listOf(kind);
    var m = motion();
    var open = m
      ? list.filter(function (x) {
          return openRows[x._uid] && bodyEl(x._uid);
        })
      : [];

    var done = function () {
      list.forEach(function (x) {
        delete openRows[x._uid];
      });
      renderList(kind);
    };

    if (!open.length) return done();

    // Every row folds at once and the list is repainted after the last one —
    // waiting on a counter rather than a fixed delay, so a run that finishes
    // early (or never fires a transitionend at all) still repaints.
    var left = open.length;
    open.forEach(function (x) {
      markClosing(x._uid);
      m.collapse(bodyEl(x._uid), false, function () {
        if (--left === 0) done();
      });
    });
  };

  UI.toggle = function (uid) {
    var m = motion();

    if (openRows[uid]) {
      var body = m && bodyEl(uid);
      if (!body) {
        delete openRows[uid];
        renderRow(uid);
        paintBar();
        return;
      }
      markClosing(uid);
      m.collapse(body, false, function () {
        delete openRows[uid];
        renderRow(uid);
        paintBar();
      });
      return;
    }

    openRows[uid] = true;
    renderRow(uid);
    var row = rowEl(uid);
    var fresh = bodyEl(uid);
    if (m && fresh) {
      // Numbers the fields so they arrive left-to-right, top-to-bottom rather
      // than all at once — the grid is a 12-column layout and reading it in
      // order is the point of the delay.
      var fields = fresh.querySelector(".sc-fields");
      if (fields) m.index(fields);
      m.enter(fresh);
    }
    // Opening a row deliberately does NOT move focus into it — the commonest
    // reason to open one is to read it. scroll-margin-top on .sc-item keeps
    // the row clear of the sticky bar when it does need scrolling to.
    if (row) row.scrollIntoView({ block: "nearest" });
    paintBar();
  };

  // ── Announcements ──────────────────────────────────────────────────────
  UI.setAnn = function (uid, field, value) {
    var a = byUid(anns, uid);
    if (!a) return;
    a[field] = value;
    var row = rowEl(uid);
    if (!row) return;
    // Repaint only what the edit changed. A full row re-render would drop the
    // caret to the end of the field being typed into.
    if (field === "title") {
      var t = (value || "").trim();
      setText(row, ".sc-item-title", t || "Untitled announcement");
      var titleEl = row.querySelector(".sc-item-title");
      if (titleEl) titleEl.classList.toggle("is-untitled", !t);
    } else if (field === "tag") {
      var chip = row.querySelector(".sc-tag");
      if (chip) {
        chip.className = SiteConfig.tagClass(value) + " sc-tag";
        chip.textContent = value;
      }
    } else if (field === "expires_at" || field === "expires_time") {
      // Clearing the date takes the time with it: a time on its own has
      // nothing to be a time of, and the server drops it anyway.
      if (field === "expires_at" && !value) a.expires_time = "";
      if (field === "expires_at") paintDateRule(a);
      paintExpiry(a, row);
    }
    if (field !== "expires_at" && field !== "expires_time")
      setText(row, ".sc-item-sub", annSubText(a));
    paintFlags(a, "ann", row);
    paintBar();
  };

  // See expiryDateChanged(). Put back to the saved date, the field stops being
  // checked — and loses the mark a past date it held a moment ago put on it.
  function paintDateRule(a) {
    var input = document.getElementById("sc-exp-" + a._uid);
    if (!input) return;
    if (expiryDateChanged(a)) {
      input.setAttribute("data-rule", "future-date");
      return;
    }
    input.removeAttribute("data-rule");
    if (window.Motion && Motion.clearField) Motion.clearField(input);
  }

  function paintExpiry(a, row) {
    setText(row, ".sc-item-sub", annSubText(a));
    var note = document.getElementById("sc-note-" + a._uid);
    if (note) note.textContent = expiryNote(a);
    var clear = document.getElementById("sc-clear-" + a._uid);
    if (clear) clear.classList.toggle("is-hidden", !a.expires_at);
    // The time only makes sense once there is a date to hang it on.
    var timeWrap = document.getElementById("sc-time-wrap-" + a._uid);
    if (timeWrap) timeWrap.classList.toggle("is-hidden", !a.expires_at);
    var timeInput = document.getElementById("sc-time-" + a._uid);
    if (timeInput && timeInput.value !== (a.expires_time || ""))
      timeInput.value = a.expires_time || "";
    var expired = isExpired(a);
    row.classList.toggle("is-expired", expired);
    row.setAttribute("data-status", annStatus(a));
  }

  // Runs on every keystroke, so it rewrites only the two small things that can
  // change from one: the chips, and whether this row can be saved. A full
  // renderRow() here would drop the caret out of the field being typed into.
  function paintFlags(item, kind, row) {
    var box = row.querySelector(".sc-flags");
    if (box) box.innerHTML = flagsHtml(item, kind);

    var tools = row.querySelector(".sc-item-tools");
    if (tools) {
      var want = rowSaveBtnHtml(item, kind);
      var have = document.getElementById("sc-rowsave-" + item._uid);
      // The officials row keeps its reorder arrows in the same container, so
      // the save button is inserted and removed rather than the container
      // being rewritten — rewriting it would rebuild the arrows on every
      // keystroke and lose focus if one of them had it.
      if (want && !have) {
        tools.insertAdjacentHTML("afterbegin", want);
        hydrate(tools);
      } else if (!want && have) {
        have.remove();
      } else if (want && have) {
        have.outerHTML = want;
        hydrate(tools);
      }
    }

    var foot = document.getElementById("sc-footsave-" + item._uid);
    if (foot) {
      foot.outerHTML = footSaveBtnHtml(item, kind);
      hydrate(row.querySelector(".sc-foot-actions"));
    }
  }

  UI.clearExpiry = function (uid) {
    var a = byUid(anns, uid);
    if (!a) return;
    a.expires_at = "";
    a.expires_time = "";
    var input = document.getElementById("sc-exp-" + uid);
    if (input) input.value = "";
    paintDateRule(a);
    // Set from here, the field fires no change event, so a "can't be in the
    // past" mark from the date it held would otherwise stay on an empty box.
    if (input && window.Motion && Motion.clearField) Motion.clearField(input);
    var row = rowEl(uid);
    if (row) {
      paintExpiry(a, row);
      paintFlags(a, "ann", row);
    }
    paintBar();
  };

  UI.addAnn = function () {
    // Newest first, matching the API's ordering and the public bulletin.
    var a = {
      id: null,
      title: "",
      body: "",
      tag: "Advisory",
      created_at: null,
      expires_at: "",
      expires_time: "",
      _uid: newUid(),
      _clean: null,
    };
    anns.unshift(a);
    openRows[a._uid] = true;
    // A new row that a filter would hide is a row that appears not to have
    // been created at all.
    if (annFiltered()) UI.clearFilters();
    else renderList("ann");
    UI.setTab("announcements");
    paintBar();
    var input = document.getElementById("sc-title-" + a._uid);
    if (input) input.focus();
  };

  UI.removeAnn = async function (uid) {
    var i = indexOfUid(anns, uid);
    if (i === -1) return;
    var a = anns[i];
    // A post that was never saved has no id and nothing to confirm — dropping
    // an empty editor row is not a deletion.
    if (a.id) {
      var ok = await uiConfirm({
        icon: "trash",
        title: "Remove this announcement?",
        message:
          "It comes off the homepage straight away.",
        target: { icon: "megaphone", label: a.title || "Untitled" },
        notes: [
          {
            icon: "archive",
            text: "It is moved to the Archive, where an Administrator can restore it.",
          },
          {
            icon: "clipboard",
            text: "The deletion is recorded in the Audit Log under your name.",
          },
        ],
        confirmLabel: "Remove",
        confirmIcon: "trash",
      });
      if (!ok) return;
      // Sent now, not queued. The confirm dialog above is the only gate this
      // ever had — waiting for a separate Save meant the row was gone from the
      // editor while still live on the homepage, and the two disagreed for as
      // long as nobody pressed it.
      var title = a.title || "Untitled";
      setRowSaving(uid, true);
      try {
        // The endpoint snapshots the post into the shared Archive before
        // removing it, so an Admin can restore it from the Archive page.
        await apiDelete(
          "/api/announcements/" + a.id + "?account_id=" + (accountId() || "")
        );
      } catch (e) {
        setRowSaving(uid, false);
        fail('Could not remove "' + title + '": ' + e.message);
        return;
      }
      setRowSaving(uid, false);
      audit(
        "ANNOUNCEMENT_DELETE",
        'Announcement "' + title + '" deleted and moved to the Archive',
        "warning"
      );
      showToast('"' + title + '" removed — it is in the Archive.', "<i data-icon=archive></i>");
    }
    delete openRows[uid];
    anns.splice(indexOfUid(anns, uid), 1);
    renderList("ann");
    paintBar();
  };

  // ── Officials ──────────────────────────────────────────────────────────
  UI.setOff = function (uid, field, value) {
    var o = byUid(offs, uid);
    if (!o) return;
    o[field] = value;
    var row = rowEl(uid);
    if (!row) return;
    if (field === "honorific" || field === "name") {
      var name = SiteConfig.displayName(o).trim();
      setText(row, ".sc-item-title", name || "Unnamed official");
      var titleEl = row.querySelector(".sc-item-title");
      if (titleEl) titleEl.classList.toggle("is-untitled", !name);
      if (!o.photo) paintPhoto(o); // auto-initials follow the name
    } else if (field === "role") {
      setText(row, ".sc-item-sub", (value || "").trim() || "No position set");
    }
    paintFlags(o, "off", row);
    paintBar();
  };

  // Both copies of the avatar — the one in the collapsed row and the large one
  // in the open editor — plus the two controls whose wording depends on
  // whether there is a photo at all.
  function paintPhoto(o) {
    var inner = SiteConfig.avatarInner(o);
    ["sc-av-", "sc-av-lg-"].forEach(function (prefix) {
      var el = document.getElementById(prefix + o._uid);
      if (el) el.innerHTML = inner;
    });
    var label = document.getElementById("sc-uplabel-" + o._uid);
    if (label) label.textContent = o.photo ? "Replace" : "Upload";
    var rm = document.getElementById("sc-rmphoto-" + o._uid);
    if (rm) rm.classList.toggle("is-hidden", !o.photo);
  }

  function afterPhotoChange(o) {
    paintPhoto(o);
    var row = rowEl(o._uid);
    if (row) paintFlags(o, "off", row);
    paintBar();
  }

  UI.uploadPhoto = function (uid, input) {
    var o = byUid(offs, uid);
    var file = input.files && input.files[0];
    if (!o || !file) return;
    SiteConfig.readImage(file, 320, function (dataUrl) {
      o.photo = dataUrl;
      afterPhotoChange(o);
    });
    input.value = ""; // allow re-selecting the same file later
  };

  UI.removePhoto = function (uid) {
    var o = byUid(offs, uid);
    if (!o) return;
    o.photo = "";
    afterPhotoChange(o);
  };

  UI.addOff = function () {
    var o = {
      id: null,
      honorific: "Hon.",
      name: "",
      role: "",
      desc: "",
      photo: "",
      _uid: newUid(),
      _clean: null,
    };
    offs.push(o);
    openRows[o._uid] = true;
    if (filters.offText) UI.clearFilters();
    else renderList("off");
    UI.setTab("officials");
    paintBar();
    var input = document.getElementById("sc-name-" + o._uid);
    if (input) input.focus();
  };

  // Reordering repaints the whole list, so before this the two rows simply
  // swapped between one frame and the next — the only evidence that anything
  // had happened was the rank number changing. Motion.flip measures the rows
  // before the repaint and slides them from where they were to where they now
  // are, so the move is something you watch rather than something you infer.
  //
  // The moved row is lifted while it travels (see .m-moving in css/motion.css)
  // because both rows move and, without it, which one the user pressed is
  // ambiguous.
  UI.move = function (uid, delta) {
    // The arrows are on two lists now, and the row knows which one it is on —
    // so the caller does not have to say.
    var kind = indexOfUid(offs, uid) !== -1 ? "off" : "hot";
    var rows = listOf(kind);
    var i = indexOfUid(rows, uid);
    var to = i + delta;
    if (i === -1 || to < 0 || to >= rows.length) return;

    var list = document.getElementById("sc-list-" + kind);
    var apply = function () {
      rows.splice(to, 0, rows.splice(i, 1)[0]);
      renderList(kind);
      paintBar();
      // Written straight away. A reorder is finished the moment the arrow is
      // pressed — there is nothing further to type into it, so there is nothing
      // for a Save button to wait for.
      pushOrder(kind);
    };

    if (!list || !window.Motion) {
      apply();
      var plain = rowEl(uid);
      if (plain) plain.scrollIntoView({ block: "nearest" });
      return;
    }

    Motion.flip(list, apply);

    var row = rowEl(uid);
    if (!row) return;
    row.scrollIntoView({ block: "nearest" });
    if (!Motion.reduced()) {
      row.classList.add("m-moving");
      window.setTimeout(function () {
        row.classList.remove("m-moving");
      }, 380);
      // The rank badge is the number that just changed; popping it points at
      // what the move actually did.
      Motion.pop(row.querySelector(".sc-rank"));
    }
  };

  // ── Announcements by SMS ─────────────────────────────────
  UI.smsToggle = function (uid, on) {
    smsOf(uid).on = !!on;
    renderRow(uid);
  };

  UI.smsPick = function (uid, kind, value, on) {
    var d = smsOf(uid);
    var list = kind === "purok" ? d.purok_ids : d.classifications;
    var v = kind === "purok" ? Number(value) : value;
    var i = list.indexOf(v);
    if (on && i === -1) list.push(v);
    if (!on && i !== -1) list.splice(i, 1);
    // Who it goes to has changed, so the figures on screen are about a
    // different send. They go, rather than sitting there looking approved.
    d.preview = null;
    renderRow(uid);
  };

  UI.smsEmergency = function (uid, on) {
    var d = smsOf(uid);
    d.emergency = !!on;
    d.preview = null;
    renderRow(uid);
  };

  // The announcement has to be saved first: the text is built from the title
  // and body the SERVER holds, and a post that is still being typed is not
  // what anybody agreed to send.
  function smsReady(uid) {
    var a = byUid(anns, uid);
    if (!a) return null;
    if (!a.id || annDirty(a)) {
      fail("Save the announcement first — the text is sent from what is published.");
      return null;
    }
    return a;
  }

  UI.smsPreview = async function (uid) {
    var a = smsReady(uid);
    if (!a) return;
    var d = smsOf(uid);
    if (d.busy) return;
    d.busy = true;
    renderRow(uid);
    try {
      d.preview = await apiPost("/api/sms/broadcast/preview", {
        title: a.title,
        body: a.body,
        emergency: d.emergency,
        audience: { purok_ids: d.purok_ids, classifications: d.classifications },
      });
    } catch (e) {
      fail("Could not work out who that reaches: " + e.message);
    }
    d.busy = false;
    renderRow(uid);
  };

  UI.smsSend = async function (uid) {
    var a = smsReady(uid);
    if (!a) return;
    var d = smsOf(uid);
    var p = d.preview;
    if (!p || !p.recipients || d.busy) return;

    var ok = await uiConfirm({
      icon: "phone",
      tone: d.emergency ? "danger" : "accent",
      title: "Send this to " + p.recipients + " phones?",
      message:
        "This spends " + p.credits + " credits, about PHP " + p.cost_php.toFixed(2) +
        ". A text cannot be taken back once it is sent.",
      target: { icon: "megaphone", label: a.title },
      notes: [
        { icon: "users", text: costLine(p) },
        d.emergency
          ? {
              icon: "triangle-alert",
              text: "Marked Emergency: it also reaches residents who turned announcements off.",
            }
          : {
              icon: "info",
              text: "Residents who turned announcements off are not texted.",
            },
        { icon: "clipboard", text: "The send is recorded in the Audit Log under your name." },
      ],
      confirmLabel: "Send " + p.recipients + " texts",
      confirmIcon: "phone",
    });
    if (!ok) return;

    d.busy = true;
    renderRow(uid);
    try {
      var r = await apiPost("/api/sms/broadcast", {
        title: a.title,
        body: a.body,
        emergency: d.emergency,
        audience: { purok_ids: d.purok_ids, classifications: d.classifications },
        announcement_id: a.id,
        confirm_count: p.recipients,
      });
      showToast(
        r.queued
          ? r.queued + " texts on their way."
          : r.written + " texts written to the SMS Log (nothing is sent in " + sms.mode + " mode).",
        "<i data-icon=phone></i>"
      );
      audit(
        "SMS_BROADCAST",
        'Announcement "' + a.title + '" texted to ' + p.recipients + " people (" +
          p.credits + " credits)",
        "warning"
      );
      d.preview = null;
      d.on = false;
    } catch (e) {
      // The audience moved between the preview and the press — the server
      // refuses and hands back the new figures, which are what should be on
      // screen now.
      fail(e.message);
      await UI.smsPreview(uid);
      return;
    }
    d.busy = false;
    renderRow(uid);
  };

  // ── Hotlines ──────────────────────────────────────────────
  UI.setHot = function (uid, field, value) {
    var h = byUid(hots, uid);
    if (!h) return;
    // The primary entry is the barangay's own line by definition, and the
    // server refuses anything else — so the select snaps back rather than
    // letting the row sit in a state that cannot be saved.
    if (field === "category" && h.is_primary && value !== "barangay") {
      var sel = document.getElementById("sc-hcat-" + uid);
      if (sel) sel.value = "barangay";
      return fail(
        "The primary line is the barangay's own number. Make another line " +
          "primary first if this one is not."
      );
    }
    h[field] = value;
    var row = rowEl(uid);
    if (!row) return;
    if (field === "label") {
      var label = (value || "").trim();
      setText(row, ".sc-item-title", label || "Unnamed hotline");
      var titleEl = row.querySelector(".sc-item-title");
      if (titleEl) titleEl.classList.toggle("is-untitled", !label);
    } else if (field === "number" || field === "notes") {
      setText(row, ".sc-item-sub", hotSubText(h));
      // The suggested dial string is derived from the number, so it follows
      // what is being typed into it.
      if (field === "number") paintDialHint(h);
    } else if (field === "category") {
      var chip = row.querySelector(".sc-tag");
      if (chip) chip.textContent = value;
    } else if (field === "dial") {
      paintDialHint(h);
    }
    paintFlags(h, "hot", row);
    paintBar();
  };

  // The hint under the dial field is either the offer to fill it in or the
  // rule it has to follow, and which one depends on both fields.
  function paintDialHint(h) {
    var row = rowEl(h._uid);
    var field = row && document.getElementById("sc-hdial-" + h._uid);
    var hint = field && field.parentNode.querySelector(".sc-hint");
    if (!hint) return;
    var suggestion = hotSuggestDial(h);
    hint.innerHTML =
      suggestion && suggestion !== hotDial(h)
        ? 'Suggested: <button type="button" class="sc-link-btn" ' +
          "onclick=\"SiteContentUI.useDial('" + h._uid + "')\">" +
          esc(suggestion) + "</button>"
        : "Digits, starting +63 for a mobile network.";
  }

  UI.useDial = function (uid) {
    var h = byUid(hots, uid);
    if (!h) return;
    h.dial = hotSuggestDial(h);
    var field = document.getElementById("sc-hdial-" + uid);
    if (field) field.value = h.dial;
    paintDialHint(h);
    var row = rowEl(uid);
    if (row) paintFlags(h, "hot", row);
    paintBar();
  };

  // The two switches. is_primary is exclusive — the server moves the flag in
  // one statement and the DB has a unique index behind it, so the list here
  // has to agree or the row would come back looking wrong.
  UI.setHotFlag = function (uid, field, on) {
    var h = byUid(hots, uid);
    if (!h) return;
    h[field] = !!on;
    if (field === "is_primary" && on) {
      hots.forEach(function (other) {
        if (other !== h) other.is_primary = false;
      });
      // The primary line is the barangay's own, and the server refuses
      // anything else.
      h.category = "barangay";
      // Every row's chips and footer changed, not just this one.
      renderList("hot");
      paintBar();
      return;
    }
    var row = rowEl(uid);
    if (row) {
      setText(row, ".sc-item-sub", hotSubText(h));
      paintFlags(h, "hot", row);
    }
    paintBar();
  };

  UI.addHot = function () {
    var h = {
      id: null,
      label: "",
      number: "",
      dial: "",
      category: "barangay",
      is_emergency: true,
      is_primary: false,
      notes: "",
      _uid: newUid(),
      _clean: null,
    };
    hots.push(h);
    openRows[h._uid] = true;
    if (filters.hotText) UI.clearFilters();
    else renderList("hot");
    UI.setTab("hotlines");
    paintBar();
    var input = document.getElementById("sc-hlabel-" + h._uid);
    if (input) input.focus();
  };

  UI.removeHot = async function (uid) {
    var i = indexOfUid(hots, uid);
    if (i === -1) return;
    var h = hots[i];
    var name = (h.label || "").trim() || "this hotline";
    if (h.is_primary)
      return fail(
        "This is the primary barangay line. Make another barangay line " +
          "primary first — the system quotes this number in its text messages."
      );
    if (h.id) {
      var ok = await uiConfirm({
        icon: "trash",
        title: "Remove this hotline?",
        message: "It comes off the homepage and the report forms straight away.",
        target: { icon: "phone", label: name + " — " + (h.number || "") },
        notes: [
          {
            icon: "archive",
            text: "It is moved to the Archive, where an Administrator can restore it.",
          },
          {
            icon: "clipboard",
            text: "The deletion is recorded in the Audit Log under your name.",
          },
        ],
        confirmLabel: "Remove",
        confirmIcon: "trash",
      });
      if (!ok) return;
      setRowSaving(uid, true);
      try {
        await apiDelete("/api/hotlines/" + h.id);
      } catch (e) {
        setRowSaving(uid, false);
        fail("Could not remove " + name + ": " + e.message);
        return;
      }
      setRowSaving(uid, false);
      audit(
        "HOTLINE_DELETE",
        "Hotline " + name + " (" + (h.number || "no number") +
          ") deleted and moved to the Archive",
        "warning"
      );
      showToast(name + " removed — in the Archive.", "<i data-icon=archive></i>");
      refreshCachedDirectory();
    }
    delete openRows[uid];
    hots.splice(indexOfUid(hots, uid), 1);
    renderList("hot");
    paintBar();
    if (hots.length) pushOrder("hot");
    else baseOrder.hot = savedOrder("hot");
  };

  // The public pages paint from a cached copy of the directory in this
  // browser (js/hotlines.js), so a change made here should reach the rest of
  // this session's tabs without waiting for their next load.
  function refreshCachedDirectory() {
    if (window.Hotlines && Hotlines.refresh) Hotlines.refresh();
  }

  UI.removeOff = async function (uid) {
    var i = indexOfUid(offs, uid);
    if (i === -1) return;
    var o = offs[i];
    var name = SiteConfig.displayName(o).trim() || "Unnamed";
    if (o.id) {
      var ok = await uiConfirm({
        icon: "trash",
        title: "Remove this official?",
        message: "Their card comes off the homepage straight away.",
        target: { icon: "user", label: o.role ? name + " — " + o.role : name },
        notes: [
          {
            icon: "archive",
            text: "They are moved to the Archive, where an Administrator can restore them.",
          },
          {
            icon: "clipboard",
            text: "The deletion is recorded in the Audit Log under your name.",
          },
        ],
        confirmLabel: "Remove",
        confirmIcon: "trash",
      });
      if (!ok) return;
      setRowSaving(uid, true);
      try {
        await apiDelete("/api/officials/" + o.id + "?account_id=" + (accountId() || ""));
      } catch (e) {
        setRowSaving(uid, false);
        fail("Could not remove " + name + ": " + e.message);
        return;
      }
      setRowSaving(uid, false);
      audit(
        "OFFICIAL_DELETE",
        "Barangay official " + name + (o.role ? " (" + o.role + ")" : "") +
          " deleted and moved to the Archive",
        "warning"
      );
      showToast(name + " removed — in the Archive.", "<i data-icon=archive></i>");
    }
    delete openRows[uid];
    offs.splice(indexOfUid(offs, uid), 1);
    renderList("off");
    paintBar();
    // The remaining officials have closed up the gap, so the stored order no
    // longer matches the list. baseOrder still holds the departed id, which is
    // what makes orderDirty() true until this lands.
    if (offs.length) pushOrder("off");
    else baseOrder.off = savedOrder("off");
  };

  // ── History ────────────────────────────────────────────────────────────
  UI.setHistory = function (field, value) {
    if (!hist) return;
    hist[field] = value;
    paintHistory();
  };

  // Back to what the server last confirmed. Offered because the history has
  // no Remove to fall back on — a story mangled by a bad paste would
  // otherwise have to be retyped, or the page reloaded and the prompt
  // dismissed.
  UI.discardHistory = function () {
    if (!hist || histSaving) return;
    var clean = JSON.parse(hist._clean);
    hist.title = clean[0];
    hist.body = clean[1];
    renderHistory();
    paintBar();
  };

  UI.saveHistory = async function () {
    if (!hist || histSaving || !histDirty()) return;
    var title = (hist.title || "").trim();
    var body = (hist.body || "").replace(/\r\n?/g, "\n").trim();
    if (!title)
      return histReject(
        "sc-hist-title",
        "The history needs a title — it is the heading on the homepage."
      );
    // The one save here that changes what the homepage is made of, so it is
    // the one that asks.
    if (!body && !hist._liveEmpty) {
      var ok = await uiConfirm({
        icon: "eye-off",
        title: "Take the history off the homepage?",
        message:
          "The story is empty, so the History section and the links to it " +
          "disappear from the homepage when this is saved.",
        target: { icon: "file-text", label: title },
        notes: [
          { icon: "info", text: "Write the story here again and save to bring it back." },
          { icon: "clipboard", text: "The change is recorded in the Audit Log under your name." },
        ],
        confirmLabel: "Take it off",
        confirmIcon: "eye-off",
      });
      if (!ok) return;
    }

    var sent = histSig(hist);
    histSaving = true;
    paintHistory();
    var saved;
    try {
      saved = await apiPut("/api/history", { title: title, body: body });
    } catch (e) {
      histSaving = false;
      paintHistory();
      fail("Could not save the history: " + e.message);
      return;
    }
    histSaving = false;
    // Anything typed while the request was out stays in the form, still
    // unsaved, rather than being replaced by the copy that just landed.
    var typed = histSig(hist) !== sent
      ? { title: hist.title, body: hist.body }
      : null;
    histLoaded(saved);
    if (typed) {
      hist.title = typed.title;
      hist.body = typed.body;
      paintHistory();
    } else {
      renderHistory();
    }
    paintBar();
    audit(
      "HISTORY_SAVE",
      saved.body
        ? 'Barangay history "' + saved.title + '" updated'
        : "Barangay history taken off the homepage",
      "info"
    );
    showToast(
      saved.body ? "History updated — now live." : "History taken off the homepage.",
      "<i data-icon=check-circle></i>"
    );
  };

  function histReject(id, msg) {
    UI.setTab("history");
    var field = document.getElementById(id);
    if (field) {
      field.classList.add("error");
      field.focus();
      field.addEventListener(
        "input",
        function () {
          field.classList.remove("error");
        },
        { once: true }
      );
    }
    fail(msg);
  }

  // ═══════════ Save ═══════════
  // One row, one request. See the header for why this is no longer a single
  // page-wide pass.

  // What is wrong with this row, or null. Returned rather than reported so the
  // caller decides whether to point at the field (a save) or stay quiet.
  function annProblem(a) {
    if (!(a.title || "").trim())
      return { field: "sc-title-", msg: "An announcement needs a title." };
    return null;
  }
  function offProblem(o) {
    if (!(o.name || "").trim())
      return { field: "sc-name-", msg: "An official needs a full name." };
    if (!(o.role || "").trim())
      return { field: "sc-role-", msg: "An official needs a position." };
    return null;
  }
  // The same three rules routes/hotlines.js applies, so a number is refused
  // here with the field highlighted rather than coming back as a 400.
  function hotProblem(h) {
    if (!(h.label || "").trim())
      return { field: "sc-hlabel-", msg: "A hotline needs a label." };
    if (!(h.number || "").trim())
      return {
        field: "sc-hnum-",
        msg: "A hotline needs a number to display.",
      };
    if (!hotDialOk(h))
      return {
        field: "sc-hdial-",
        msg:
          "What a phone dials must be digits, optionally starting with + — " +
          "911 or +63437028875, not 043-702-8875x.",
      };
    return null;
  }

  // Saves exactly one row: PUT if it has an id, POST if it does not.
  //
  // Nothing is queued and nothing else is touched, so the failure case is the
  // simple one — the row stays dirty, its Save stays there, and the toast names
  // the row rather than a count.
  UI.saveRow = async function (uid) {
    if (savingRows[uid]) return;
    var a = byUid(anns, uid);
    var o = a ? null : byUid(offs, uid);
    var h = a || o ? null : byUid(hots, uid);
    if (!a && !o && !h) return;
    var kind = a ? "ann" : o ? "off" : "hot";
    var item = a || o || h;
    // An already-saved row with nothing changed has nothing to send. A row with
    // no id always goes through, even blank, so the validation below can say
    // what is missing rather than the button doing nothing (see
    // footSaveBtnHtml).
    if (item.id && !isDirty(item, kind)) return;

    var problem = a ? annProblem(a) : o ? offProblem(o) : hotProblem(h);
    if (problem) return reject(TAB_OF[kind], uid, problem.field, problem.msg);
    // A name in letters, a number in digits, a take-down date not already
    // past — marked on the field itself by js/input-guard.js.
    if (window.InputGuard && !InputGuard.check(document.getElementById("sc-body-" + uid))) return;

    setRowSaving(uid, true);
    var wasNew = !item.id;
    try {
      if (a) {
        var saved = await (a.id
          ? apiPut("/api/announcements/" + a.id, {
              title: a.title.trim(),
              body: (a.body || "").trim(),
              tag: a.tag,
              // "" means no expiry; the API stores NULL for it. An empty time
              // is not "no take-down" but "the end of that day", which is the
              // shape the API stores when the time is left out.
              expires_at: a.expires_at || null,
              expires_time: a.expires_time || null,
              account_id: accountId(),
            })
          : apiPost("/api/announcements", {
              title: a.title.trim(),
              body: (a.body || "").trim(),
              tag: a.tag,
              expires_at: a.expires_at || null,
              expires_time: a.expires_time || null,
              account_id: accountId(),
            }));
        a.id = saved.id;
        a.created_at = saved.created_at;
        a.expires_at = saved.expires_at || "";
        a.expires_time = saved.expires_time || "";
        a._clean = annSig(a);
      } else if (o) {
        var ob = {
          honorific: (o.honorific || "").trim(),
          name: o.name.trim(),
          role: o.role.trim(),
          description: (o.desc || "").trim(),
          photo: o.photo || null,
          account_id: accountId(),
        };
        if (o.id) await apiPut("/api/officials/" + o.id, ob);
        else o.id = (await apiPost("/api/officials", ob)).id;
        o._clean = offSig(o);
      } else {
        var hb = {
          label: h.label.trim(),
          number: h.number.trim(),
          // Sent in the form the server stores: brackets, spaces and dashes
          // out, so the tel: link the landing page builds is exactly this.
          dial: hotDial(h),
          category: h.category || "barangay",
          is_emergency: !!h.is_emergency,
          is_primary: !!h.is_primary,
          notes: (h.notes || "").trim(),
        };
        var savedHot = h.id
          ? await apiPut("/api/hotlines/" + h.id, hb)
          : await apiPost("/api/hotlines", hb);
        h.id = savedHot.id;
        h.dial = savedHot.dial;
        // The server stood the old primary down in the same statement; this
        // list has to follow, or two rows would wear the chip.
        if (h.is_primary)
          hots.forEach(function (other) {
            if (other !== h && other.is_primary) {
              other.is_primary = false;
              other._clean = hotSig(other);
            }
          });
        h._clean = hotSig(h);
        refreshCachedDirectory();
      }
    } catch (e) {
      setRowSaving(uid, false);
      fail(
        "Could not save " +
          (a
            ? '"' + (a.title || "Untitled") + '"'
            : o
              ? SiteConfig.displayName(o).trim() || "this official"
              : (h.label || "").trim() || "this hotline") +
          ": " + e.message
      );
      return;
    }

    setRowSaving(uid, false);
    audit(
      a ? "ANNOUNCEMENT_SAVE" : o ? "OFFICIAL_SAVE" : "HOTLINE_SAVE",
      a
        ? 'Announcement "' + a.title.trim() + '" ' + (wasNew ? "published" : "updated")
        : o
          ? "Barangay official " + SiteConfig.displayName(o).trim() +
            (o.role ? " (" + o.role.trim() + ")" : "") +
            " " + (wasNew ? "added" : "updated")
          : "Hotline " + h.label.trim() + " (" + h.number.trim() + ")" +
            (h.is_primary ? ", the primary barangay line," : "") +
            " " + (wasNew ? "added" : "updated"),
      "info"
    );

    // A newly created row is appended by the API, wherever the editor shows
    // it — so the order has to be rewritten before it is right.
    if (kind !== "ann") {
      if (wasNew) await pushOrder(kind);
      else baseOrder[kind] = savedOrder(kind);
    }

    // A primary line that moved changed another row as well.
    if (h && h.is_primary) renderList("hot");
    else renderRow(uid);
    paintBar();
    showToast(
      (a
        ? '"' + (a.title.trim() || "Untitled") + '"'
        : o
          ? SiteConfig.displayName(o).trim()
          : h.label.trim()) +
        " " + (wasNew ? "is now live." : "updated — now live."),
      "<i data-icon=check-circle></i>"
    );
  };

  // ── Display order (officials, hotlines) ─────────────────────────────────────
  // Written the moment it changes rather than waiting for a save, because a
  // reorder is finished the instant the arrow is pressed — there is no further
  // editing to do to it.
  //
  // Returns true when the server now holds this order. A list still containing
  // an unsaved official cannot be sent at all: /api/officials/order takes ids,
  // and that row has none yet. It stays dirty and the toolbar's "Save order"
  // button appears, which is also where a failed write ends up.
  async function pushOrder(kind) {
    var rows = listOf(kind);
    var ids = rows
      .filter(function (x) {
        return x.id;
      })
      .map(function (x) {
        return x.id;
      });
    // Nothing to order, or an unsaved row would silently drop out of the list
    // being sent — in both cases leave it for later.
    if (!ids.length || ids.length !== rows.length) return false;
    if (orderSaving[kind]) return false;
    orderSaving[kind] = true;
    try {
      await apiPost(ORDER_PATH[kind], { ids: ids, account_id: accountId() });
      baseOrder[kind] = ids.join(",");
      if (kind === "hot") refreshCachedDirectory();
      return true;
    } catch (e) {
      fail("Could not save the display order: " + e.message);
      return false;
    } finally {
      orderSaving[kind] = false;
      paintToolbar(kind);
      paintBar();
    }
  }

  UI.saveOrder = async function (kind) {
    var unsaved = listOf(kind).filter(function (x) {
      return !x.id && !BLANK[kind](x);
    });
    if (unsaved.length) {
      fail(
        "Save " +
          (unsaved.length === 1
            ? "the new " + NOUN[kind]
            : "the " + unsaved.length + " new " + NOUN[kind] + "s") +
          " first — the display order is stored by id."
      );
      return;
    }
    if (await pushOrder(kind)) {
      audit(
        "SETTINGS_UPDATE",
        (kind === "off" ? "Barangay Officials" : "Hotline") +
          " display order updated",
        "info"
      );
      showToast("Display order saved.", "<i data-icon=check-circle></i>");
    }
  };

  function reject(toTab, uid, fieldPrefix, msg) {
    UI.setTab(toTab);
    openRows[uid] = true;
    // The offending row may be hidden behind a filter, and an error that
    // points at something invisible is not a fix.
    if (rowEl(uid)) renderRow(uid);
    else UI.clearFilters();
    var row = rowEl(uid);
    if (row) row.scrollIntoView({ block: "nearest" });
    var field = document.getElementById(fieldPrefix + uid);
    if (field) {
      field.classList.add("error");
      field.focus();
      field.addEventListener(
        "input",
        function () {
          field.classList.remove("error");
        },
        { once: true }
      );
    }
    paintBar();
    fail(msg);
  }

  function setRowSaving(uid, on) {
    if (on) savingRows[uid] = true;
    else delete savingRows[uid];
    var a = byUid(anns, uid);
    var o = a ? null : byUid(offs, uid);
    var item = a || o || byUid(hots, uid);
    var row = rowEl(uid);
    if (item && row) paintFlags(item, a ? "ann" : o ? "off" : "hot", row);
  }

  function audit(action, detail, level) {
    if (typeof logAudit === "function") logAudit(action, detail, level, "settings");
  }

  // ═══════════ Page-level bindings ═══════════
  // Ctrl/⌘+S saves THE ROW YOU ARE IN — the one holding focus, or the only
  // dirty one if focus is elsewhere and there is no ambiguity. There is no
  // page-wide save for it to mean any more, and guessing between four dirty
  // rows would be worse than doing nothing.
  //
  // The launcher already owns Ctrl+K; Ctrl+S is free, and the browser's "save
  // page" dialog is never what anyone wants on this screen.
  function focusedUid() {
    var el = document.activeElement;
    var row = el && el.closest ? el.closest(".sc-item") : null;
    return row ? row.getAttribute("data-uid") : null;
  }

  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      if (!document.getElementById("sc-page")) return;
      e.preventDefault();
      // The history form is not a row, but it is "the one you are in" the
      // same way.
      var active = document.activeElement;
      if (active && active.closest && active.closest("#sc-history"))
        return UI.saveHistory();
      var uid = focusedUid();
      if (!uid) {
        var dirty = anns
          .filter(annDirty)
          .concat(offs.filter(offDirty))
          .concat(hots.filter(hotDirty))
          .map(function (x) {
            return x._uid;
          })
          .concat(histDirty() ? ["history"] : []);
        if (dirty.length === 1 && dirty[0] === "history") return UI.saveHistory();
        if (dirty.length === 1) uid = dirty[0];
        else if (dirty.length)
          return fail(
            "Ctrl+S saves the row you are editing — click into one, or use its Save button."
          );
        else return;
      }
      UI.saveRow(uid);
    }
  });

  // Navigation inside the MIS is a full page load, so this covers leaving via
  // the sidebar as well as closing the tab. It matters MORE now than it did:
  // with one page-wide Save an unsaved page was obvious, and with per-row saves
  // it is entirely possible to save three rows, miss the fourth, and leave.
  window.addEventListener("beforeunload", function (e) {
    if (!totalChanges()) return;
    e.preventDefault();
    e.returnValue = "";
  });
})();
