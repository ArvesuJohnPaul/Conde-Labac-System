// js/input-guard.js — what each field accepts, enforced as it is typed.
//
// A field says what it holds with data-rule="…" (or by being type="email" /
// type="tel"), and from then on:
//
//   • a character it cannot hold never lands. Type a letter into a mobile
//     number and the letter is refused: the field shakes, turns red, and says
//     underneath what belongs there ("Numbers only — …"). The message goes
//     away with the next good keystroke. A paste keeps what fits and drops the
//     rest, with the same message.
//   • a field that is too long refuses the extra character the same way.
//   • a date field gets min/max from today, so the calendar greys out the days
//     it cannot take (no birthday tomorrow, no pickup yesterday), and a date
//     typed past them is flagged the moment it is complete.
//   • leaving a field that is filled in but not finished (nine digits of an
//     eleven-digit number) says so straight away rather than at Submit.
//
// InputGuard.check(container) runs the whole-value checks over every ruled
// field inside a form and returns false, marking each one, if any fails. Every
// submit handler calls it after its required-field check:
//
//   if (!Motion.require([...])) return;
//   if (window.InputGuard && !InputGuard.check(modal)) return;
//
// The look — red border, shake, message under the field — is js/motion.js's
// Motion.invalid(), the same one a refused submit uses, so a refused keystroke
// and a refused form read as the same thing. The server checks all of it again
// (conde-labak-server/validate.js); this file is for the person typing, the
// server's copy is the one that counts.
//
// Load it on every page, beside js/motion.js. It only listens at the document,
// so a form rendered long after load is covered without registering anything.
(function () {
  "use strict";

  // ── The rules ────────────────────────────────────────────────────────────
  //   char   one character the field may hold
  //   says   what to tell someone who typed something else
  //   max    longest value, when the markup gives no maxlength
  //   whole  the finished value: a RegExp, or fn(value) → true when fine
  //   wholeSays  what to tell someone whose finished value fails it
  //   paste  fn(text) → text, tidying a pasted value before it is checked
  var NAME_CHAR = /[\p{L}\p{M} .'’-]/u;
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // "+63 917 123 4567", "0917-123-4567" → "09171234567". The only shape a
  // mobile is stored in, so a pasted number goes in that way.
  function tidyMobile(text) {
    var d = String(text).replace(/[^\d+]/g, "");
    var m = /^(?:\+?63)(9\d{9})$/.exec(d);
    return m ? "0" + m[1] : d.replace(/\+/g, "");
  }

  var RULES = {
    name: {
      char: NAME_CHAR,
      says: "Letters only — no numbers or symbols.",
      max: 80,
      whole: /^\p{L}[\p{L}\p{M} .'’-]*$/u,
      wholeSays: "Start with a letter — like Juan or Dela Cruz.",
    },
    // Several names, or one written "Last, First".
    names: {
      char: /[\p{L}\p{M} .,'’-]/u,
      says: "Letters only — separate names with a comma.",
      max: 200,
      whole: /^\p{L}[\p{L}\p{M} .,'’-]*$/u,
      wholeSays: "Names only — like Maria Cruz, Jose Reyes.",
    },
    // An occupation: words, and the punctuation they carry.
    words: {
      char: /[\p{L}\p{M} .,'’&/()-]/u,
      says: "Letters only — no numbers.",
      max: 80,
      whole: /^\p{L}/u,
      wholeSays: "Start with a letter — like Farmer or Teacher.",
    },
    mobile: {
      char: /\d/,
      says: "Numbers only — 11 digits, like 09171234567.",
      max: 11,
      maxSays: "A mobile number has 11 digits.",
      whole: /^09\d{9}$/,
      wholeSays: "Enter all 11 digits of the mobile number, starting with 09.",
      paste: tidyMobile,
    },
    // A number someone can be called back on: a mobile, or a landline with
    // its area code.
    phone: {
      char: /\d/,
      says: "Numbers only — like 09171234567, or 0437028875 for a landline.",
      max: 11,
      maxSays: "A phone number has at most 11 digits.",
      whole: /^(?:09\d{9}|0\d{9}|\d{7,8})$/,
      wholeSays: "Enter a mobile number like 09171234567, or a landline with its area code like 0437028875.",
      paste: tidyMobile,
    },
    digits: {
      char: /\d/,
      says: "Numbers only (0–9).",
      whole: /^\d+$/,
      wholeSays: "Numbers only (0–9).",
    },
    email: {
      char: /\S/,
      says: "An email address has no spaces.",
      max: 254,
      whole: EMAIL,
      wholeSays: "Enter an email address like juan@gmail.com.",
    },
    "email-or-mobile": {
      char: /\S/,
      says: "No spaces — an email like juan@gmail.com or a number like 09171234567.",
      max: 120,
      whole: function (v) {
        return EMAIL.test(v) || /^09\d{9}$/.test(tidyMobile(v));
      },
      wholeSays: "Enter an email address like juan@gmail.com or a mobile number like 09171234567.",
    },
    address: {
      char: /[\p{L}\p{M}\d .,#'’/()-]/u,
      says: "Letters, numbers and . , # - / only.",
      max: 200,
    },
    // A hotline number the way the public site prints it: 043-702-8875.
    "phone-written": {
      char: /[\d +()-]/,
      says: "Digits, spaces, dashes and brackets only — like 043-702-8875.",
      max: 40,
      whole: /\d{3}/,
      wholeSays: "Enter the number — like 043-702-8875.",
    },
    // What a phone dials: digits, maybe a leading +.
    dial: {
      char: /[\d+]/,
      says: "Digits only, starting with + for a country code — like +63437028875.",
      max: 16,
      whole: /^\+?\d{3,15}$/,
      wholeSays: "Digits only, with + only at the start — like +63437028875.",
    },
  };

  // Date rules — a field holding a date, with today as the edge.
  var DATE_RULES = { "past-date": true, "future-date": true };
  var EARLIEST = "1900-01-01";

  // ── Helpers ──────────────────────────────────────────────────────────────
  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  // Today on the device, as the date input writes it. The person filling the
  // form is in the Philippines; their own calendar is the one they mean.
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function ruleName(el) {
    if (!el || el.nodeType !== 1 || !el.matches || !el.matches("input, textarea")) return null;
    var r = el.getAttribute("data-rule");
    if (r) return r;
    if (el.type === "email") return "email";
    if (el.type === "tel") return "phone";
    return null;
  }

  function textRule(el) {
    var name = ruleName(el);
    return name && RULES[name] ? RULES[name] : null;
  }

  function maxOf(el, rule) {
    return el.maxLength > 0 ? el.maxLength : rule.max || 0;
  }

  // The field's own label, for "Date of birth can't be in the future."
  function labelOf(el) {
    var text = "";
    var box = el.closest && el.closest(".form-group");
    var lab = box && box.querySelector(".form-label");
    if (!lab && el.id) lab = document.querySelector('label[for="' + el.id + '"]');
    var wrap = !lab && el.closest && el.closest("label");
    if (lab) text = lab.textContent;
    else if (wrap) {
      // <label>Name <input></label> — the words before the field.
      for (var n = wrap.firstChild; n && n !== el; n = n.nextSibling)
        if (n.nodeType === 3) text += n.nodeValue;
    } else text = el.getAttribute("aria-label") || "";
    return (
      String(text)
        .replace(/\(.*?\)/g, "")
        .replace(/[\s*:]+$/, "")
        .replace(/\s+/g, " ")
        .trim() || "This date"
    );
  }

  function wholeOk(rule, v) {
    if (!rule.whole) return true;
    return typeof rule.whole === "function" ? rule.whole(v) : rule.whole.test(v);
  }

  // Shown the way a refused submit is — Motion.invalid(): red, a shake, and
  // the reason under the field. An earlier amber "this is required" mark is
  // taken off first, or its colour would win over the red.
  function flag(el, message) {
    if (window.Motion) {
      Motion.clearField(el);
      Motion.invalid(el, false, message);
    } else {
      el.setAttribute("aria-invalid", "true");
      el.title = message;
    }
  }

  // ── Dates ────────────────────────────────────────────────────────────────
  // min/max are set from today each time the field is reached, not once at
  // load: a page left open overnight would otherwise still allow yesterday.
  function armDate(el) {
    var r = ruleName(el);
    if (!DATE_RULES[r]) return;
    if (r === "past-date") {
      el.max = today();
      if (!el.min) el.min = EARLIEST;
    } else {
      el.min = today();
    }
    var after = afterField(el);
    if (after && after.value && r === "past-date") el.min = after.value;
  }

  // data-after="other-id": this date cannot come before that one (a residency
  // cannot start before the person was born).
  function afterField(el) {
    var id = el.getAttribute("data-after");
    return id ? document.getElementById(id) : null;
  }

  // null when the date is fine, else the sentence to show.
  function dateProblem(el) {
    var v = el.value;
    if (!v) {
      // A date input whose text is half typed reports an empty value but bad
      // input — "13/45/2026" is not a date.
      return el.validity && el.validity.badInput ? labelOf(el) + " is not a complete date." : null;
    }
    var r = ruleName(el);
    var label = labelOf(el);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return label + " is not a valid date.";
    if (r === "past-date") {
      if (v > today()) return label + " can't be in the future.";
      if (v < EARLIEST) return label + " can't be before 1900.";
      var after = afterField(el);
      if (after && after.value && v < after.value)
        return label + " can't be before the " + labelOf(after).toLowerCase() + ".";
    }
    if (r === "future-date" && v < today()) return label + " can't be in the past — pick today or a later date.";
    return null;
  }

  // ── Checking a finished value ────────────────────────────────────────────
  // null when the field is fine (or empty — whether it may be empty is the
  // submit handler's question), else the sentence to show.
  function problemOf(el) {
    var r = ruleName(el);
    if (!r) return null;
    if (DATE_RULES[r]) return dateProblem(el);
    var rule = RULES[r];
    var v = String(el.value || "").trim();
    if (!rule || !v) return null;
    for (var i = 0; i < v.length; ) {
      var ch = String.fromCodePoint(v.codePointAt(i));
      if (!rule.char.test(ch)) return rule.says;
      i += ch.length;
    }
    var max = maxOf(el, rule);
    if (max && v.length > max) return rule.maxSays || "This can be at most " + max + " characters.";
    if (!wholeOk(rule, v)) return rule.wholeSays || rule.says;
    return null;
  }

  function hiddenField(el) {
    return el.disabled || el.readOnly || el.type === "hidden" || !!(el.closest && el.closest("[hidden]")) ||
      (el.offsetParent === null && getComputedStyle(el).position !== "fixed");
  }

  /**
   * Every ruled field inside `root` (an element or an id), checked as it
   * stands. Marks each one that fails, puts the caret in the first, and
   * returns false; true when all are fine.
   */
  function check(root) {
    var box = typeof root === "string" ? document.getElementById(root) : root || document;
    if (!box) return true;
    var fields = box.querySelectorAll("input, textarea");
    var first = null;
    for (var i = 0; i < fields.length; i++) {
      var el = fields[i];
      if (!ruleName(el) || hiddenField(el)) continue;
      var problem = problemOf(el);
      if (!problem) continue;
      flag(el, problem);
      if (!first) first = el;
    }
    if (!first) return true;
    first.scrollIntoView({ block: "center", behavior: window.Motion && Motion.reduced() ? "auto" : "smooth" });
    try {
      first.focus({ preventScroll: true });
    } catch (e) {
      first.focus();
    }
    return false;
  }

  // ── As it is typed ───────────────────────────────────────────────────────
  // The usual path: the character is stopped before it lands, so it never
  // flickers into the field.
  function onBeforeInput(e) {
    var el = e.target;
    var rule = textRule(el);
    if (!rule || el.readOnly || el.disabled) return;
    var type = e.inputType || "";
    if (type.indexOf("insert") !== 0 || type === "insertLineBreak" || type === "insertParagraph") return;
    // A composition (an on-screen keyboard's suggestion strip, an IME) cannot
    // be cancelled here; the input handler below tidies it after it lands.
    if (type === "insertCompositionText" || !e.cancelable) return;
    var text = e.data;
    if (text == null && e.dataTransfer) text = e.dataTransfer.getData("text/plain");
    if (text == null) return;

    var pasted = type === "insertFromPaste" || type === "insertFromDrop";
    var given = pasted && rule.paste ? rule.paste(text) : text;
    var kept = "";
    var refused = false;
    for (var i = 0; i < given.length; ) {
      var ch = String.fromCodePoint(given.codePointAt(i));
      if (rule.char.test(ch)) kept += ch;
      else refused = true;
      i += ch.length;
    }

    var start = el.selectionStart;
    var end = el.selectionEnd;
    var canSplice = typeof start === "number" && typeof end === "number";
    // An email field has no caret to splice at. A lone wrong character is
    // still stopped; a paste with some good in it lands, and tidy() below
    // takes out what does not belong.
    if (!canSplice) {
      if (refused && !kept) {
        e.preventDefault();
        flag(el, rule.says);
      }
      return;
    }
    var max = maxOf(el, rule);
    var room = max ? max - (el.value.length - (end - start)) : Infinity;
    var tooLong = kept.length > room;
    if (!refused && !tooLong && given === text) return; // nothing to stop

    e.preventDefault();
    if (tooLong) kept = kept.slice(0, Math.max(0, room));
    if (kept) {
      el.setRangeText(kept, start, end, "end");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (refused) flag(el, rule.says);
    else if (tooLong) flag(el, rule.maxSays || "This can be at most " + max + " characters.");
  }

  // The fallback: whatever got past beforeinput (a composition, autofill, a
  // browser that does not fire it) is tidied once it has landed.
  function tidy(el) {
    var rule = textRule(el);
    if (!rule || el.readOnly || el.disabled) return;
    var v = el.value;
    var kept = "";
    var refused = false;
    for (var i = 0; i < v.length; ) {
      var ch = String.fromCodePoint(v.codePointAt(i));
      if (rule.char.test(ch)) kept += ch;
      else refused = true;
      i += ch.length;
    }
    var max = maxOf(el, rule);
    var tooLong = max && kept.length > max;
    if (tooLong) kept = kept.slice(0, max);
    if (!refused && !tooLong) return;
    var caret = typeof el.selectionStart === "number" ? el.selectionStart - (v.length - kept.length) : null;
    el.value = kept;
    if (caret != null) {
      try {
        el.setSelectionRange(Math.max(0, caret), Math.max(0, caret));
      } catch (e) {
        /* not every input type has a selection */
      }
    }
    // After this event has finished dispatching: Motion.invalid() listens for
    // the field's next `input` to clear the mark, and this very event would
    // otherwise be that next input.
    var message = refused ? rule.says : rule.maxSays || "This can be at most " + max + " characters.";
    window.setTimeout(function () {
      flag(el, message);
    }, 0);
  }

  function onInput(e) {
    if (e.isComposing) return;
    tidy(e.target);
  }

  // Leaving a field — or finishing a date — is when its whole value can be
  // judged. An empty field is left alone: being required is the submit's call.
  function judge(el) {
    if (!ruleName(el) || hiddenField(el)) return;
    var problem = problemOf(el);
    if (problem) flag(el, problem);
  }

  function onChange(e) {
    var el = e.target;
    if (!DATE_RULES[ruleName(el)]) return;
    // Deferred for the same reason as tidy(): the mark Motion put on this
    // field last time clears itself on this very `change`, after this runs.
    window.setTimeout(function () {
      judge(el);
      // A birthdate moved later can put the residency start below it.
      if (!el.id) return;
      var dependents = document.querySelectorAll('[data-after="' + el.id + '"]');
      for (var i = 0; i < dependents.length; i++) if (dependents[i].value) judge(dependents[i]);
    }, 0);
  }

  function onFocusOut(e) {
    var el = e.target;
    var r = ruleName(el);
    if (!r) return;
    // A date is judged on change — on blur too, for a half-typed one.
    if (DATE_RULES[r] && !(el.validity && el.validity.badInput)) return;
    judge(el);
  }

  function onFocusIn(e) {
    armDate(e.target);
  }

  // On a phone, the right keyboard for the field: a number pad for a number.
  function hintKeyboards(root) {
    var els = (root || document).querySelectorAll("[data-rule]");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var r = el.getAttribute("data-rule");
      if (!el.hasAttribute("inputmode")) {
        if (r === "mobile" || r === "phone") el.setAttribute("inputmode", "tel");
        else if (r === "digits") el.setAttribute("inputmode", "numeric");
        else if (r === "email") el.setAttribute("inputmode", "email");
      }
      if (DATE_RULES[r]) armDate(el);
    }
  }

  document.addEventListener("beforeinput", onBeforeInput, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("compositionend", function (e) {
    tidy(e.target);
  }, true);
  document.addEventListener("change", onChange, true);
  document.addEventListener("focusout", onFocusOut, true);
  document.addEventListener("focusin", onFocusIn, true);
  // The calendar button on a date field can open before focus lands.
  document.addEventListener("pointerdown", onFocusIn, true);

  function onReady() {
    hintKeyboards(document);
    if (window.MutationObserver)
      new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++)
          for (var j = 0; j < records[i].addedNodes.length; j++) {
            var n = records[i].addedNodes[j];
            if (n.nodeType === 1) {
              if (n.hasAttribute && n.hasAttribute("data-rule")) hintKeyboards(n.parentNode || document);
              else if (n.querySelector && n.querySelector("[data-rule]")) hintKeyboards(n);
            }
          }
      }).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onReady);
  else onReady();

  window.InputGuard = {
    check: check,
    problemOf: problemOf,
    today: today,
    tidyMobile: tidyMobile,
  };
})();
