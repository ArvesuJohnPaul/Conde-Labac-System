// js/ui-modals.js
// Two things every page with a modal needs: Escape closes the modal on top, and
// uiConfirm() / uiPrompt() (below) for asking before doing something.
//
// Every modal in the app is a .modal-backdrop that gets an `open` class, and
// each one already has a close button wired to whatever it needs to do on the
// way out — flush a pending save, clear a target, reset a form. So Escape
// clicks that button rather than stripping the class itself: one behaviour for
// both routes out, and no modal can be closed by a shortcut in a way its own
// close path wouldn't have done.
//
// Two things deliberately handle Escape before this does:
//   • uiDialog() (below) listens in the capture phase and stops the event,
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

// ════════════════ DIALOGS (confirm / prompt) ════════════════
// The MIS's destructive actions used to go through window.confirm() and
// window.prompt(). Those are OS chrome: unstyled, unthemeable, differently
// worded in every browser, and — worst of all — they give a "Delete this
// resident?" the exact same weight as a cookie notice. A staff member about
// to remove a record should see WHAT they are removing and WHAT happens next.
//
// uiConfirm() / uiPrompt() render the same modal shell every other dialog in
// the system uses, and return a promise, so call sites read almost identically
// to the confirm() they replace:
//
//   if (!(await uiConfirm({ ... }))) return;
//   const name = await uiPrompt({ ... });   // null when cancelled
//
// They live here rather than in js/shell.js because the landing page asks
// things too, and it loads this file but not the MIS shell.

let uiDialogEl = null;

function uiDialogEscape(str) {
  const div = document.createElement("div");
  div.textContent = String(str == null ? "" : str);
  return div.innerHTML;
}

// Shared engine. `field` present ⇒ prompt (resolves to the trimmed string, or
// null when cancelled); absent ⇒ confirm (resolves true/false).
function uiDialog(opts) {
  const o = opts || {};
  const isPrompt = !!o.field;
  const esc = uiDialogEscape;
  const accent = o.tone === "accent";

  return new Promise((resolve) => {
    // One dialog at a time — a second call supersedes the first rather than
    // stacking two backdrops.
    if (uiDialogEl) uiDialogEl.remove();
    const lastFocus = document.activeElement;

    const el = document.createElement("div");
    uiDialogEl = el;
    el.className = "modal-backdrop confirm-backdrop open";
    el.innerHTML = `
      <div class="modal-box confirm-box${accent ? " confirm-box-accent" : ""}" role="alertdialog" aria-modal="true" aria-labelledby="ui-dialog-title">
        <div class="confirm-head">
          <div class="confirm-icon ${accent ? "confirm-icon-accent" : "confirm-icon-danger"}">
            <i data-icon="${esc(o.icon || "triangle-alert")}"></i>
          </div>
          <div class="confirm-heading">
            <h3 class="confirm-title" id="ui-dialog-title">${esc(o.title || "Are you sure?")}</h3>
            ${o.message ? `<p class="confirm-message">${esc(o.message)}</p>` : ""}
          </div>
        </div>
        ${
          o.target
            ? `<div class="confirm-target">
                 <i data-icon="${esc(o.target.icon || "file-text")}"></i>
                 <span class="confirm-target-label">${esc(o.target.label)}</span>
               </div>`
            : ""
        }
        ${
          isPrompt
            ? `<div class="confirm-field">
                 <label class="form-label" for="ui-dialog-input">${esc(o.field.label || "Value")}</label>
                 <input class="form-control" id="ui-dialog-input" autocomplete="off"
                        placeholder="${esc(o.field.placeholder || "")}"
                        value="${esc(o.field.value || "")}" />
                 ${o.field.hint ? `<p class="confirm-hint">${esc(o.field.hint)}</p>` : ""}
               </div>`
            : ""
        }
        ${
          (o.notes || []).length
            ? `<ul class="confirm-notes">${o.notes
                .map(
                  (n) =>
                    `<li><i data-icon="${esc(n.icon || "info")}"></i><span>${esc(n.text)}</span></li>`
                )
                .join("")}</ul>`
            : ""
        }
        <p class="confirm-error" data-dlg-error hidden></p>
        <div class="confirm-actions">
          <button type="button" class="btn btn-outline" data-dlg-cancel>${esc(o.cancelLabel || "Cancel")}</button>
          <button type="button" class="btn ${accent ? "btn-gold" : "btn-danger-strong"}" data-dlg-confirm>
            ${o.confirmIcon ? `<i data-icon="${esc(o.confirmIcon)}"></i> ` : ""}${esc(o.confirmLabel || "Confirm")}
          </button>
        </div>
      </div>`;
    document.body.appendChild(el);
    if (typeof hydrateIcons === "function") hydrateIcons(el);

    const input = el.querySelector("#ui-dialog-input");
    const errEl = el.querySelector("[data-dlg-error]");

    const finish = (value) => {
      document.removeEventListener("keydown", onKey, true);
      el.remove();
      if (uiDialogEl === el) uiDialogEl = null;
      // Put the caret back where the user left it (the row's button).
      if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
      resolve(value);
    };
    const cancel = () => finish(isPrompt ? null : false);
    const submit = () => {
      if (!isPrompt) return finish(true);
      const value = (input.value || "").trim();
      const problem = o.validate
        ? o.validate(value)
        : value
          ? null
          : "This field cannot be empty.";
      if (problem) {
        errEl.textContent = problem;
        errEl.hidden = false;
        // Typing a second wrong value only changes the sentence, which is easy
        // to miss when the user is looking at the field rather than the line
        // under it. Shaking the box says "still no" whether or not the wording
        // changed. (No-op when js/motion.js is not loaded.)
        if (window.Motion) {
          Motion.shakeBox(el.querySelector(".modal-box"));
          Motion.invalid(input);
        }
        input.focus();
        input.select();
        return;
      }
      finish(value);
    };

    // Escape always cancels. Capture phase so an open dialog wins over any
    // page-level Escape handler underneath it.
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cancel();
      }
    };
    document.addEventListener("keydown", onKey, true);

    el.addEventListener("click", (e) => {
      if (e.target === el || e.target.closest("[data-dlg-cancel]")) cancel();
      else if (e.target.closest("[data-dlg-confirm]")) submit();
    });
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      });
      input.addEventListener("input", () => {
        errEl.hidden = true;
      });
      input.focus();
      input.select();
    } else {
      // Focus Cancel, not the destructive button: a stray Enter should not be
      // able to delete a record.
      el.querySelector("[data-dlg-cancel]").focus();
    }
  });
}

const uiConfirm = (opts) => uiDialog(opts);
const uiPrompt = (opts) =>
  uiDialog(Object.assign({ tone: "accent" }, opts, { field: opts.field || {} }));
