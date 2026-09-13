// js/ui-modals.js
// Escape closes the modal on top.
//
// Every modal in the app is a .modal-backdrop that gets an `open` class, and
// each one already has a close button wired to whatever it needs to do on the
// way out — flush a pending save, clear a target, reset a form. So Escape
// clicks that button rather than stripping the class itself: one behaviour for
// both routes out, and no modal can be closed by a shortcut in a way its own
// close path wouldn't have done.
//
// Two things deliberately handle Escape before this does:
//   • uiDialog() (js/shell.js) listens in the capture phase and stops the event,
//     because a confirm/prompt has to resolve its promise on the way out — a
//     dialog that merely hid itself would leave its caller waiting forever.
//   • the GIS map cancels its active tool (js/gis-map.js) while one is armed.
//
// Loaded on every page that carries a modal.
(function () {
  "use strict";

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    // Later in the document means stacked on top: a modal opened from inside
    // another is appended after it.
    const open = document.querySelectorAll(".modal-backdrop.open");
    if (!open.length) return;
    const top = open[open.length - 1];

    // Don't fight a text field mid-edit — Escape there means "revert what I
    // just typed", which the browser handles, and a second press closes the
    // modal. Only text fields: a <select> has no such behaviour to protect, so
    // Escape on one should close the modal like anywhere else.
    const focused = document.activeElement;
    if (
      focused &&
      top.contains(focused) &&
      /^(INPUT|TEXTAREA)$/.test(focused.tagName) &&
      focused.value
    ) {
      focused.blur();
      return;
    }

    e.stopPropagation();
    const closer = top.querySelector(".modal-close");
    if (closer) closer.click();
    else top.classList.remove("open");
  });
})();
