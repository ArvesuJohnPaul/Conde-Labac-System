// js/mobile.js — the one piece of behaviour the phone layout needs.
//
// WHY THIS EXISTS
// Every list in the MIS is a <table class="data-table"> with six to eight
// columns. On a desktop that is the right shape. On a 390px phone it is not:
// the table is 757–1047px wide inside a 356px scroller, so the only columns on
// screen are the first two or three. Status, the date, and — the part that
// matters — the row's View / Edit / Approve / Reject buttons sit 400 to 700
// pixels off the right edge, behind a sideways scroll that nothing announces.
// The SMS log was the worst of it: because the Message column is tall and
// off-screen, each row stood 287px high and showed a date, a number and an
// acre of white space.
//
// Below 640px css/mobile.css stops those tables being tables and stacks each
// row as a card, one "Label  value" line per cell. For that the cell has to
// know its own column heading, and the markup has none — the heading lives in
// the <thead>, which the stacked layout hides.
//
// So: copy it. For every .data-table on the page, read the header row once and
// write each heading onto the cells of that column as data-label, which
// css/mobile.css prints with a ::before. The label therefore always comes from
// the table's own header — a page that renames a column or reorders its cells
// gets the right labels with no change here, and no page script had to be
// touched to gain the layout.
//
// The tables are drawn by their page scripts and redrawn on every search,
// filter, page change and refresh, so this runs again whenever a tbody
// changes. It is cheap (a few dozen setAttribute calls) and idempotent.
//
// The labels are written at every width, not only on a phone: the attribute is
// inert until the media query in css/mobile.css asks for it, and writing them
// unconditionally means a window resized across 640px is already correct
// instead of waiting for the next redraw.
//
// Not included: .perm-table on User Management. That one is a real matrix —
// roles across, permissions down — and stacking it would destroy the
// comparison it exists to make. It stays a scroller, with its first column
// pinned (css/mobile.css).
(function () {
  "use strict";

  // The text of each <th> in the header row, in column order. Uses the
  // LAST row of <thead> so a table with a grouped header still lines up.
  function headings(table) {
    var head = table.tHead;
    if (!head || !head.rows.length) return null;
    var cells = head.rows[head.rows.length - 1].cells;
    var out = [];
    for (var i = 0; i < cells.length; i++) {
      var th = cells[i];
      // "Photo" on Residency is an .sr-only label for a column of avatars;
      // printing it beside the picture would be noise.
      var srOnly = th.querySelector(".sr-only");
      var text = srOnly ? "" : (th.textContent || "").replace(/\s+/g, " ").trim();
      var span = th.colSpan || 1;
      for (var s = 0; s < span; s++) out.push(s === 0 ? text : "");
    }
    return out;
  }

  // Which of a row's buttons are a bare glyph. In the stacked card the
  // labelled buttons share the width between them, and a button with no label
  // keeps a 44px square instead — a trash can stretched across half the card
  // reads as the row's main action rather than its most destructive one.
  //
  // This is decided here and not in CSS because CSS cannot see text. The
  // obvious selector, .btn:has(> i:only-child), is wrong: :only-child counts
  // ELEMENT children, so <button><i…/> Suspend</button> matches it — the
  // Suspend button on User Management was squeezed to 44px with its label
  // spilling out over the delete button beside it.
  function markIconOnly(cell) {
    var btns = cell.querySelectorAll(".btn");
    for (var i = 0; i < btns.length; i++) {
      var bare = !(btns[i].textContent || "").trim();
      if (bare) btns[i].setAttribute("data-icon-only", "");
      else btns[i].removeAttribute("data-icon-only");
    }
  }

  function labelRow(row, heads) {
    var cells = row.cells;
    // A one-cell row spanning the table is a state, not a record — "Loading
    // residents…", "No results", an error with a Retry button. It gets no
    // label and css/mobile.css leaves it as a plain centred line.
    if (cells.length === 1 && cells[0].colSpan > 1) {
      cells[0].setAttribute("data-cell", "state");
      cells[0].removeAttribute("data-label");
      return;
    }
    var col = 0;
    for (var i = 0; i < cells.length; i++) {
      var td = cells[i];
      var text = heads[col] == null ? "" : heads[col];
      col += td.colSpan || 1;
      // The row's buttons become a full-width bar at the foot of the card,
      // with no "Actions" label above them — the buttons say what they do.
      if (td.querySelector(".btn-group, .btn")) {
        td.setAttribute("data-cell", "actions");
        markIconOnly(td);
      }
      // A picture column (the resident avatar) sits beside the first value
      // rather than on a labelled line of its own.
      else if (td.classList.contains("res-photo-col")) td.setAttribute("data-cell", "media");
      else td.removeAttribute("data-cell");
      if (text) td.setAttribute("data-label", text);
      else td.removeAttribute("data-label");
    }
  }

  function label(table) {
    var heads = headings(table);
    if (!heads) return;
    var bodies = table.tBodies;
    for (var b = 0; b < bodies.length; b++) {
      var rows = bodies[b].rows;
      for (var r = 0; r < rows.length; r++) labelRow(rows[r], heads);
    }
  }

  function labelAll(root) {
    var tables = (root || document).querySelectorAll("table.data-table");
    for (var i = 0; i < tables.length; i++) label(tables[i]);
  }

  // Page scripts replace a tbody's innerHTML on every search, filter and
  // refresh, so one pass at load time is not enough. One observer over the
  // whole document covers the module pages, the modals the shell opens and
  // anything a page adds later.
  //
  // Writing data-label is itself a DOM change, so the observer would hear its
  // own work and run forever. The guard below closes that loop: labelling sets
  // `busy`, and a callback that fires while it is set does nothing. The
  // microtask-deferred clear means the attribute mutations queued during the
  // pass are still swallowed when they arrive.
  var busy = false;
  var queued = false;
  function pass(root) {
    if (busy) return;
    busy = true;
    try {
      labelAll(root);
    } finally {
      Promise.resolve().then(function () {
        busy = false;
      });
    }
  }

  function watch() {
    pass(document);
    if (typeof MutationObserver !== "function") return;
    new MutationObserver(function (records) {
      if (busy || queued) return;
      // Only childList changes matter — a page script writing innerHTML into a
      // tbody, or the shell swapping the whole page. Attribute changes (this
      // file's own writes, a row's .is-open, a sort indicator) are ignored.
      var touched = false;
      for (var i = 0; i < records.length; i++) {
        if (records[i].type === "childList" && (records[i].addedNodes.length || records[i].removedNodes.length)) {
          touched = true;
          break;
        }
      }
      if (!touched) return;
      // Coalesce: a redraw is many mutations, and the labels only need to be
      // right once the browser is done with them.
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        pass(document);
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch);
  else watch();

  // Exposed for the UI tests, which assert that a stacked row carries the
  // headings its table declares.
  window.labelDataTables = labelAll;
})();
