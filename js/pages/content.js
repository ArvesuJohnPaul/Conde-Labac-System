// js/pages/content.js — "Site Content" MIS module.
// Manages the two editable public-landing sections (Latest Announcements and
// Barangay Officials) from inside the MIS shell, mirroring the mobile app's
// MIS → Site Content page. Everything writes straight to the shared DB
// (/api/announcements + /api/officials), so the homepage and the mobile app
// update immediately.
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
//   • The two sections are TABS, not stacked cards — you are only ever
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
  var openRows = {}; // uid → true, survives list re-renders
  var tab = "announcements";
  var filters = { annText: "", annStatus: "", annTag: "", offText: "" };
  var baseOrder = ""; // officials id order the server last confirmed
  var uidSeq = 0;
  // uid → true while that row's request is in flight. Per row, not per page:
  // two rows can be saving at once and each disables only its own button.
  var savingRows = {};
  var orderSaving = false;

  var newUid = function () {
    return "u" + ++uidSeq;
  };
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

  var annDirty = function (a) {
    return !annBlank(a) && (!a.id || a._clean !== annSig(a));
  };
  var offDirty = function (o) {
    return !offBlank(o) && (!o.id || o._clean !== offSig(o));
  };
  // Only saved rows count toward the order: a new official has no id yet, and
  // its arrival is already counted as its own change.
  var savedOrder = function () {
    return offs
      .filter(function (o) {
        return o.id;
      })
      .map(function (o) {
        return o.id;
      })
      .join(",");
  };
  // The order is written the moment it changes, so this is normally false. It
  // stays true in the two cases where the write could not happen yet: the POST
  // failed (offline, server down), or a brand-new official is sitting in the
  // list without an id, which the order endpoint cannot accept. Either way the
  // officials toolbar grows a "Save order" button until it clears.
  var orderDirty = function () {
    return savedOrder() !== baseOrder;
  };

  var annChanges = function () {
    return anns.filter(annDirty).length;
  };
  var offChanges = function () {
    return offs.filter(offDirty).length + (orderDirty() ? 1 : 0);
  };
  var totalChanges = function () {
    return annChanges() + offChanges();
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
        '<section class="sc-panel" id="sc-panel-officials" role="tabpanel" aria-labelledby="sc-tab-officials" hidden>' +
          offToolbarHtml() +
          '<div class="sc-list" id="sc-list-off">' + skeletonHtml(3) + "</div>" +
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
  // Tabs on the left, state and Preview on the right.
  //
  // No Save here any more — saving belongs to the row being saved (see the
  // header). What is left is the count, which still earns its place: it is the
  // only thing that can tell you four rows are unsaved when three of them are
  // scrolled off the screen, and it is what the leave-the-page warning is
  // counting. It reads as a status, not an invitation to press it.
  function barHtml() {
    return (
      '<div class="sc-bar" id="sc-bar">' +
        '<div class="sc-tabs" role="tablist" aria-label="Site content sections">' +
          tabHtml("announcements", "megaphone", "Announcements") +
          tabHtml("officials", "users", "Officials") +
        "</div>" +
        '<div class="sc-bar-actions">' +
          '<span class="sc-dirty" id="sc-dirty" data-state="clean" role="status">' +
            '<i data-icon="check-circle"></i><span>All changes saved</span>' +
          "</span>" +
          '<a class="btn btn-sm btn-outline" id="sc-preview" href="../index.html#bulletin" ' +
            'target="_blank" rel="noopener"><i data-icon="eye"></i> Preview</a>' +
        "</div>" +
      "</div>"
    );
  }

  function tabHtml(id, icon, label) {
    return (
      '<button type="button" class="sc-tab" id="sc-tab-' + id + '" role="tab" ' +
      'aria-selected="false" aria-controls="sc-panel-' + id + '" ' +
      "onclick=\"SiteContentUI.setTab('" + id + "')\">" +
      '<i data-icon="' + icon + '"></i>' +
      "<span>" + esc(label) + "</span>" +
      '<span class="sc-tab-count" id="sc-count-' + id + '">0</span>' +
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
          'onclick="SiteContentUI.saveOrder()">' +
          '<i data-icon="arrow-up"></i> Save order</button>' +
        '<button type="button" class="btn btn-sm btn-ghost is-hidden" id="sc-off-collapse" ' +
          "onclick=\"SiteContentUI.collapseAll('off')\">Collapse all</button>" +
        '<button type="button" class="btn btn-sm btn-gold" onclick="SiteContentUI.addOff()">' +
          '<i data-icon="plus"></i> Add official</button>' +
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
      baseOrder = savedOrder();
    } catch (e) {
      fail("Could not load site content: " + e.message);
    }
    renderList("ann");
    renderList("off");
    paintBar();
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

  var annFiltered = function () {
    return !!(filters.annText || filters.annStatus || filters.annTag);
  };

  // ═══════════ Row markup ═══════════
  function flagsHtml(item, kind) {
    var out = "";
    if (kind === "ann" && isExpired(item))
      out += '<span class="sc-chip sc-chip-expired">Expired</span>';
    if (!item.id) out += '<span class="sc-chip sc-chip-new">New</span>';
    else if (kind === "ann" ? annDirty(item) : offDirty(item))
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
    return kind === "ann" ? annDirty(item) : offDirty(item);
  };

  function rowSaveBtnHtml(item, kind) {
    if (!isDirty(item, kind)) return "";
    var busy = !!savingRows[item._uid];
    return (
      '<button type="button" class="sc-icon-btn sc-icon-save" id="sc-rowsave-' +
      item._uid + '"' + (busy ? " disabled" : "") +
      ' title="' + (busy ? "Saving…" : "Save this " + (kind === "ann" ? "announcement" : "official")) + '"' +
      ' aria-label="Save this ' + (kind === "ann" ? "announcement" : "official") + '" ' +
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
        '<div class="sc-item-foot">' +
          '<div class="sc-expiry">' +
            '<label class="sc-inline-label" for="sc-exp-' + u + '">Take down after</label>' +
            '<input class="form-control sc-date" type="date" id="sc-exp-' + u + '" ' +
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
        // public card the old editor carried — the homepage is one click away
        // behind "Preview", and the initials fallback is the only part of the
        // card that could not be seen from the collapsed row.
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
              '<input class="form-control" id="sc-hon-' + u + '" value="' + esc(o.honorific) +
                '" placeholder="Hon." oninput="' + set("honorific") + '" />' +
            "</div>" +
            '<div class="form-group sc-col-5">' +
              '<label class="form-label" for="sc-name-' + u + '">Full name</label>' +
              '<input class="form-control" id="sc-name-' + u + '" value="' + esc(o.name) +
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
    var box = document.getElementById(kind === "ann" ? "sc-list-ann" : "sc-list-off");
    if (!box) return;
    var html;
    if (kind === "ann") {
      var list = visibleAnns();
      html = !anns.length
        ? emptyHtml(
            "megaphone",
            "No announcements yet",
            "Nothing is on the public bulletin. Post the first notice and it appears on the homepage and in the mobile app straight away.",
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
      if (i === -1) return;
      html = offRowHtml(offs[i], i + 1, offs.length);
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
    paintToolbar("ann");
    paintToolbar("off");
  }

  function setCount(id, total, changes) {
    var c = document.getElementById("sc-count-" + id);
    if (c) c.textContent = total;
    var dot = document.getElementById("sc-dot-" + id);
    if (dot) dot.classList.toggle("is-hidden", !changes);
  }

  function paintToolbar(kind) {
    var isAnn = kind === "ann";
    var list = isAnn ? anns : offs;
    var shown = isAnn ? visibleAnns().length : visibleOffs().length;
    var count = document.getElementById(isAnn ? "sc-ann-count" : "sc-off-count");
    if (count) {
      count.textContent = !list.length
        ? ""
        : shown === list.length
          ? shown + (isAnn ? " post" : " official") + (shown === 1 ? "" : "s")
          : "Showing " + shown + " of " + list.length;
    }
    var collapse = document.getElementById(isAnn ? "sc-ann-collapse" : "sc-off-collapse");
    if (collapse) {
      var anyOpen = list.some(function (x) {
        return openRows[x._uid];
      });
      collapse.classList.toggle("is-hidden", !anyOpen);
    }
    if (!isAnn) {
      var order = document.getElementById("sc-off-order");
      if (order) {
        order.classList.toggle("is-hidden", !orderDirty() || orderSaving);
        order.disabled = orderSaving;
      }
    }
  }

  function applyTab() {
    ["announcements", "officials"].forEach(function (id) {
      var on = id === tab;
      var btn = document.getElementById("sc-tab-" + id);
      var panel = document.getElementById("sc-panel-" + id);
      if (btn) {
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
      }
      if (panel) panel.hidden = !on;
    });
    var prev = document.getElementById("sc-preview");
    if (prev)
      prev.href = tab === "officials" ? "../index.html#team" : "../index.html#bulletin";
  }

  // ═══════════ Handlers ═══════════
  UI.setTab = function (id) {
    if (tab === id) return;
    tab = id;
    applyTab();
  };

  UI.filter = function (key, value) {
    filters[key] = value;
    renderList(key === "offText" ? "off" : "ann");
  };

  UI.clearFilters = function () {
    filters = { annText: "", annStatus: "", annTag: "", offText: "" };
    ["sc-ann-search", "sc-ann-status", "sc-ann-tag", "sc-off-search"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = "";
    });
    renderList("ann");
    renderList("off");
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
    var list = kind === "ann" ? anns : offs;
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
      paintExpiry(a, row);
    }
    if (field !== "expires_at" && field !== "expires_time")
      setText(row, ".sc-item-sub", annSubText(a));
    paintFlags(a, "ann", row);
    paintBar();
  };

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
          "It comes off the homepage and the mobile app straight away.",
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
    var i = indexOfUid(offs, uid);
    var to = i + delta;
    if (i === -1 || to < 0 || to >= offs.length) return;

    var list = document.getElementById("sc-list-off");
    var apply = function () {
      offs.splice(to, 0, offs.splice(i, 1)[0]);
      renderList("off");
      paintBar();
      // Written straight away. A reorder is finished the moment the arrow is
      // pressed — there is nothing further to type into it, so there is nothing
      // for a Save button to wait for.
      pushOrder();
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

  UI.removeOff = async function (uid) {
    var i = indexOfUid(offs, uid);
    if (i === -1) return;
    var o = offs[i];
    var name = SiteConfig.displayName(o).trim() || "Unnamed";
    if (o.id) {
      var ok = await uiConfirm({
        icon: "trash",
        title: "Remove this official?",
        message: "Their card comes off the homepage and the mobile app straight away.",
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
    if (offs.length) pushOrder();
    else baseOrder = savedOrder();
  };

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

  // Saves exactly one row: PUT if it has an id, POST if it does not.
  //
  // Nothing is queued and nothing else is touched, so the failure case is the
  // simple one — the row stays dirty, its Save stays there, and the toast names
  // the row rather than a count.
  UI.saveRow = async function (uid) {
    if (savingRows[uid]) return;
    var a = byUid(anns, uid);
    var o = a ? null : byUid(offs, uid);
    if (!a && !o) return;
    var kind = a ? "ann" : "off";
    var item = a || o;
    // An already-saved row with nothing changed has nothing to send. A row with
    // no id always goes through, even blank, so the validation below can say
    // what is missing rather than the button doing nothing (see
    // footSaveBtnHtml).
    if (item.id && !isDirty(item, kind)) return;

    var problem = a ? annProblem(a) : offProblem(o);
    if (problem)
      return reject(
        a ? "announcements" : "officials",
        uid,
        problem.field,
        problem.msg
      );

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
      } else {
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
      }
    } catch (e) {
      setRowSaving(uid, false);
      fail(
        "Could not save " +
          (a ? '"' + (a.title || "Untitled") + '"' : SiteConfig.displayName(o).trim() || "this official") +
          ": " + e.message
      );
      return;
    }

    setRowSaving(uid, false);
    audit(
      a ? "ANNOUNCEMENT_SAVE" : "OFFICIAL_SAVE",
      a
        ? 'Announcement "' + a.title.trim() + '" ' + (wasNew ? "published" : "updated")
        : "Barangay official " + SiteConfig.displayName(o).trim() +
          (o.role ? " (" + o.role.trim() + ")" : "") +
          " " + (wasNew ? "added" : "updated"),
      "info"
    );

    // A newly created official is appended by the API, wherever the editor
    // shows them — so the order has to be rewritten before it is right.
    if (o && wasNew) await pushOrder();
    else if (o) baseOrder = savedOrder();

    renderRow(uid);
    paintBar();
    showToast(
      (a
        ? '"' + (a.title.trim() || "Untitled") + '"'
        : SiteConfig.displayName(o).trim()) +
        " " + (wasNew ? "is now live." : "updated — now live."),
      "<i data-icon=check-circle></i>"
    );
  };

  // ── Officials order ────────────────────────────────────────────────────
  // Written the moment it changes rather than waiting for a save, because a
  // reorder is finished the instant the arrow is pressed — there is no further
  // editing to do to it.
  //
  // Returns true when the server now holds this order. A list still containing
  // an unsaved official cannot be sent at all: /api/officials/order takes ids,
  // and that row has none yet. It stays dirty and the toolbar's "Save order"
  // button appears, which is also where a failed write ends up.
  async function pushOrder() {
    var ids = offs
      .filter(function (x) {
        return x.id;
      })
      .map(function (x) {
        return x.id;
      });
    // Nothing to order, or an unsaved row would silently drop out of the list
    // being sent — in both cases leave it for later.
    if (!ids.length || ids.length !== offs.length) return false;
    if (orderSaving) return false;
    orderSaving = true;
    try {
      await apiPost("/api/officials/order", { ids: ids, account_id: accountId() });
      baseOrder = ids.join(",");
      return true;
    } catch (e) {
      fail("Could not save the display order: " + e.message);
      return false;
    } finally {
      orderSaving = false;
      paintToolbar("off");
      paintBar();
    }
  }

  UI.saveOrder = async function () {
    var unsaved = offs.filter(function (o) {
      return !o.id && !offBlank(o);
    });
    if (unsaved.length) {
      fail(
        "Save " +
          (unsaved.length === 1
            ? "the new official"
            : "the " + unsaved.length + " new officials") +
          " first — the display order is stored by id."
      );
      return;
    }
    if (await pushOrder()) {
      audit("SETTINGS_UPDATE", "Barangay Officials display order updated", "info");
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
    var item = a || byUid(offs, uid);
    var row = rowEl(uid);
    if (item && row) paintFlags(item, a ? "ann" : "off", row);
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
      var uid = focusedUid();
      if (!uid) {
        var dirty = anns
          .filter(annDirty)
          .concat(offs.filter(offDirty))
          .map(function (x) {
            return x._uid;
          });
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
