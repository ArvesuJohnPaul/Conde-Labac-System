// js/motion.js — the motion runtime
//
// css/motion.css holds every animation the system uses. This file holds the
// three things CSS cannot do on its own:
//
//   1. Animate to an unknown height. A collapsible whose body is added and
//      removed from the DOM (Site Content rows), or whose open height comes
//      from a flex container rather than its content (the GIS side panels),
//      has no height for CSS to transition to. It is measured here.
//   2. Re-fire an animation. A CSS animation only plays when its selector
//      STARTS matching, so a field that is already invalid does not shake
//      again on a second failed submit. Motion.shake() cancels and restarts
//      it — see replay() for why cycling the class is not enough.
//   3. Animate something on the way OUT. `display: none` and `element.remove()`
//      are instant; the exit has to be played first and the removal deferred.
//
// It also auto-wires the parts of the system that already speak the design
// system's vocabulary, so no module has to call into it to benefit:
//
//   • Any control that gains aria-invalid="true" or .error shakes.
//   • Any form that fails native validation shakes its first bad field and
//     scrolls to it.
//   • Any .modal-backdrop that loses its `open` class plays an exit first.
//   • Any list that repaints into a known container staggers its rows in.
//
// Load it on every page, after the page's own scripts (it only reads the DOM
// on DOMContentLoaded and via observers, so order barely matters, but loading
// last keeps it out of the way of anything that inspects document.scripts).
//
// Everything degrades to an instant, correct end state under
// prefers-reduced-motion — see reduced() below and section 8 of motion.css.
(function () {
  "use strict";

  var M = {};

  // ── Preferences ──────────────────────────────────────────────────────────
  // Read live rather than cached: the OS setting can change mid-session, and a
  // user who turns motion off should not have to reload the dashboard.
  var reduceQuery =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");

  function reduced() {
    return !!(reduceQuery && reduceQuery.matches);
  }

  M.reduced = reduced;

  // Durations, mirrored from tokens.css. Read once from the computed styles so
  // the two files cannot drift, with the token values as the fallback for the
  // case where motion.css has not loaded (a page that forgot the <link>).
  var DUR = { fast: 120, base: 180, slow: 280 };

  function readDurations() {
    try {
      var cs = getComputedStyle(document.documentElement);
      ["fast", "base", "slow"].forEach(function (k) {
        var v = parseFloat(cs.getPropertyValue("--duration-" + k));
        if (v > 0) DUR[k] = v;
      });
    } catch (e) {
      /* keep the defaults */
    }
  }

  // ── Element helpers ──────────────────────────────────────────────────────

  function isEl(el) {
    return !!el && el.nodeType === 1;
  }

  // Restarts a CSS animation.
  //
  // Cycling the class alone is not enough here. A field that is already
  // invalid matches `.form-control[aria-invalid="true"]`, which declares the
  // same shake at a HIGHER specificity than `.m-shake` — so removing and
  // re-adding the class leaves the computed `animation` value unchanged, and
  // an animation whose value did not change does not restart. Setting
  // `animation: none` inline, forcing a style recalculation by reading
  // offsetWidth, then clearing it, cancels whatever was there whichever rule
  // it came from. That read is load-bearing: without it the two writes
  // coalesce into no change at all.
  function replay(el, cls, ms) {
    if (!isEl(el)) return;
    el.classList.remove(cls);
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
    el.classList.add(cls);
    window.setTimeout(function () {
      el.classList.remove(cls);
    }, ms);
  }

  // Runs `done` when the element's animation or transition ends, or after a
  // deadline if it never fires — a hidden element, a zeroed duration under
  // reduced motion, or a tab that was backgrounded mid-animation all produce
  // no event, and a collapsible stuck at height:0 is worse than an unanimated
  // one.
  function onEnd(el, event, deadline, done) {
    var fired = false;

    function finish(arg) {
      if (fired) return;
      fired = true;
      el.removeEventListener(event, handler);
      window.clearTimeout(timer);
      done(arg);
    }

    function handler(e) {
      // Ignore an animation bubbling up from a child.
      if (e.target !== el) return;
      finish();
    }

    el.addEventListener(event, handler);
    var timer = window.setTimeout(finish, deadline);
    return finish;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 1 · COLLAPSE
  //
  // Animates an element between nothing and its natural height, then puts its
  // inline style back exactly as it found it. That last step is the one that
  // is usually missed, and there are three ways to get it wrong, all of which
  // this file got wrong first:
  //
  //   • Leaving a MEASURED pixel height behind. The panel then stops
  //     responding to its content changing or the window being resized.
  //   • Animating `height` alone. Under box-sizing: border-box the used height
  //     is clamped to padding + border, so a "closed" panel stops at a band.
  //   • Forgetting that a flex item is not sized by `height` at all.
  // ═════════════════════════════════════════════════════════════════════════

  // Height alone cannot close a box that has vertical padding or a border.
  // Under `box-sizing: border-box` — which this system sets globally — the
  // used height is clamped to padding + border, so a panel animated to
  // height:0 stops at a visible band instead of disappearing. Every vertical
  // that contributes to the box has to collapse with it.
  var VERTICALS = [
    "paddingTop",
    "paddingBottom",
    "marginTop",
    "marginBottom",
    "borderTopWidth",
    "borderBottomWidth",
  ];

  function squeeze(el) {
    for (var i = 0; i < VERTICALS.length; i++) el.style[VERTICALS[i]] = "0px";
  }

  // A flex item's used height comes from the flex algorithm, not from its
  // `height` property — set height:0 on something with `flex: 1` and the
  // container stretches it straight back. The GIS report feed and AI body are
  // both `flex: 1` inside their panel, so the item is taken out of the
  // distribution for the length of the fold and left out of it while closed.
  // Sized from `height` again the moment it reopens.
  function pinFlex(el) {
    el.style.flexGrow = "0";
    el.style.flexShrink = "0";
    el.style.flexBasis = "auto";
  }

  // ── Restoring what was there ─────────────────────────────────────────────
  // Between them the two helpers above write ten inline properties, and the
  // element may already have had some of them set by the page. Blanking those
  // on the way back out is a silent way to lose an author's layout — and worse
  // than it sounds, because writing one longhand (borderTopWidth) explodes an
  // inline `border:` shorthand into longhands that no longer come back when
  // the one is cleared.
  //
  // So the whole inline style is snapshotted before the first write of a cycle
  // and put back verbatim when the panel finishes opening. Nothing else in the
  // system touches these elements' inline styles mid-fold, so a wholesale
  // restore is safe and is the only thing that restores exactly.
  function remember(el) {
    if (typeof el._mInline !== "string") el._mInline = el.style.cssText;
  }

  function restore(el) {
    if (typeof el._mInline === "string") el.style.cssText = el._mInline;
  }

  // Puts back only the verticals, leaving height / overflow / flex pinned — the
  // end of an opening fold, where the box has to grow into its own padding but
  // must still be sized by `height` until the transition finishes.
  //
  // The snapshot is a cssText string, so an off-document element is used to
  // read individual longhands out of it. That is also what makes an inline
  // `padding: 20px` or `border: 1px solid` come back correctly: the scratch
  // element resolves the shorthand for us.
  var scratch = null;

  function restoreVerticals(el) {
    if (!scratch) scratch = document.createElement("div");
    scratch.style.cssText = el._mInline || "";
    for (var i = 0; i < VERTICALS.length; i++)
      el.style[VERTICALS[i]] = scratch.style[VERTICALS[i]];
  }

  // The end state of a closed panel, kept as inline style rather than
  // `hidden`: most of the panels this is used on are laid out with
  // display:flex or display:grid, and those beat `[hidden]`'s UA display:none.
  // Height 0 collapses it visually; visibility:hidden is what takes its
  // contents out of the tab order and away from a screen reader. The snapshot
  // is deliberately kept — it is what reopening restores.
  function settleClosed(el) {
    el.style.height = "0px";
    el.style.overflow = "hidden";
    el.style.visibility = "hidden";
    squeeze(el);
    pinFlex(el);
  }

  function settleOpen(el) {
    restore(el);
    el._mInline = null; // the cycle is over
  }

  /**
   * @param {Element}  el    the element whose height is animated
   * @param {boolean}  open  the state to end in
   * @param {Function} [done] called once, after the animation settles
   */
  M.collapse = function (el, open, done) {
    if (!isEl(el)) return;

    // Cancel an animation already in flight and start the new one from
    // wherever it had got to — clicking a disclosure twice quickly should turn
    // it round, not queue a second run behind the first.
    var current = el.getBoundingClientRect().height;
    if (el._mCollapseCancel) el._mCollapseCancel(true);
    remember(el);

    if (reduced()) {
      el.classList.remove("is-collapsing");
      el.removeAttribute("data-collapsing");
      if (open) settleOpen(el);
      else settleClosed(el);
      if (done) done();
      return;
    }

    el.classList.add("is-collapsing");
    el.setAttribute("data-collapsing", open ? "in" : "out");

    // Measure where it is going, by putting the element's own styling back and
    // reading what the layout gives it. Restoring rather than setting
    // `height: auto` matters: several of these panels are flex items whose
    // open height comes from their container's distribution, not from their
    // content, and `auto` would measure the content and then snap to the flex
    // height at the end. The read is thrown away two lines later, before the
    // browser has had a chance to paint it.
    var target = 0;
    if (open) {
      restore(el);
      target = el.getBoundingClientRect().height;
    }

    // Pinned out of the flex distribution in both directions, so `height` is
    // what actually governs the box while it moves. Opening starts squeezed
    // and grows into the element's own box; closing does the reverse.
    pinFlex(el);
    el.style.overflow = "hidden";
    el.style.visibility = "";
    el.style.height = current + "px";
    if (open) squeeze(el);
    else restoreVerticals(el);
    void el.offsetWidth; // commit the start box before changing it
    el.style.height = target + "px";
    if (open) restoreVerticals(el);
    else squeeze(el);

    var settle = onEnd(el, "transitionend", DUR.base + 140, function (skipped) {
      el.classList.remove("is-collapsing");
      el.removeAttribute("data-collapsing");
      el._mCollapseCancel = null;
      // A cancelled run leaves the box alone: the call that cancelled it is
      // about to set its own start height from where this one stopped.
      if (skipped !== true) {
        if (open) settleOpen(el);
        else settleClosed(el);
      }
      if (done) done();
    });

    el._mCollapseCancel = function (skipped) {
      el._mCollapseCancel = null;
      settle(skipped);
    };
  };

  /**
   * The same end states, applied instantly. For restoring a remembered
   * collapse on page load: the panel has to arrive already folded, and
   * animating it there would play a fold the user never asked for.
   */
  M.set = function (el, open) {
    if (!isEl(el)) return;
    if (el._mCollapseCancel) el._mCollapseCancel(true);
    remember(el);
    el.classList.remove("is-collapsing");
    el.removeAttribute("data-collapsing");
    if (open) settleOpen(el);
    else settleClosed(el);
  };

  /**
   * Grows an element that has just been inserted into the DOM. Use when the
   * markup is rendered fresh (innerHTML) rather than toggled — there is no
   * "closed" state to animate from, so one is synthesised.
   */
  M.enter = function (el, done) {
    if (!isEl(el)) return;
    if (reduced()) {
      if (done) done();
      return;
    }
    var target = el.getBoundingClientRect().height;
    remember(el);
    el.classList.add("is-collapsing");
    el.setAttribute("data-collapsing", "in");
    pinFlex(el);
    el.style.overflow = "hidden";
    el.style.height = "0px";
    squeeze(el);
    void el.offsetWidth;
    el.style.height = target + "px";
    restoreVerticals(el);
    onEnd(el, "transitionend", DUR.base + 140, function () {
      el.classList.remove("is-collapsing");
      el.removeAttribute("data-collapsing");
      settleOpen(el);
      if (done) done();
    });
  };

  /**
   * Plays the leave animation and then removes the element. Use for a row the
   * user has just deleted, so the list closes over it instead of the rows
   * below jumping up into the gap.
   */
  M.leave = function (el, done) {
    if (!isEl(el)) return;
    var finish = function () {
      if (el.parentNode) el.parentNode.removeChild(el);
      if (done) done();
    };
    if (reduced()) return finish();
    el.classList.add("m-leaving");
    onEnd(el, "animationend", DUR.base + 160, finish);
  };

  // ═════════════════════════════════════════════════════════════════════════
  // 2 · VALIDATION FEEDBACK
  // ═════════════════════════════════════════════════════════════════════════

  /** Shakes an element, re-firing even if it is already in an error state. */
  M.shake = function (el) {
    if (!isEl(el) || reduced()) return;
    replay(el, "m-shake", 500);
  };

  /** Shakes a whole box — a dialog, a card, a form section. */
  M.shakeBox = function (el) {
    if (!isEl(el) || reduced()) return;
    replay(el, "m-shake-box", 500);
  };

  /**
   * Marks a control invalid, animates it, and clears the mark as soon as the
   * user starts fixing it. This is the same lifecycle js/incident-report.js
   * wrote by hand; modules can call this instead.
   *
   * @param {Element} el
   * @param {boolean} [empty]    true for "you have not filled this in" (amber),
   *                             false for "what is in here is wrong" (red)
   * @param {string}  [message]  shown under the field, in the system's own
   *                             .form-error style
   */
  M.invalid = function (el, empty, message) {
    if (!isEl(el)) return;
    el.setAttribute("aria-invalid", "true");
    if (empty) el.classList.add("m-empty");
    if (message) showFieldMessage(el, message);
    M.shake(el);

    if (el._mClearBound) return;
    el._mClearBound = true;
    var clear = function () {
      el.removeAttribute("aria-invalid");
      el.classList.remove("m-empty");
      clearFieldMessage(el);
      el.removeEventListener("input", clear);
      el.removeEventListener("change", clear);
      el._mClearBound = false;
    };
    el.addEventListener("input", clear);
    el.addEventListener("change", clear);
  };

  /** The box a message belongs in — the field's form-group, or its parent. */
  function fieldBox(el) {
    return (el.closest && el.closest(".form-group")) || el.parentNode || el;
  }

  function showFieldMessage(el, message) {
    var box = fieldBox(el);
    var msg = box.querySelector ? box.querySelector("[data-m-error]") : null;
    if (!msg) {
      msg = document.createElement("div");
      msg.className = "form-error";
      msg.setAttribute("data-m-error", "");
      // role=alert so a screen reader hears the reason, not just the shake.
      msg.setAttribute("role", "alert");
      box.appendChild(msg);
    }
    msg.textContent = message;
  }

  function clearFieldMessage(el) {
    var box = fieldBox(el);
    var msg = box.querySelector ? box.querySelector("[data-m-error]") : null;
    if (msg && msg.parentNode) msg.parentNode.removeChild(msg);
  }

  /**
   * The words to put in front of the user when a field is empty. Taken from
   * the field's own label so the message names the thing they are looking at —
   * "Last Name is required", not "This field is required". Falls back through
   * the label's `for`, the aria-label, and the placeholder.
   */
  function labelOf(el) {
    var box = el.closest && el.closest(".form-group");
    var lab = box && box.querySelector(".form-label");
    if (!lab && el.id)
      lab = document.querySelector('label[for="' + el.id + '"]');
    var text = lab ? lab.textContent : el.getAttribute("aria-label") || "";
    text = String(text).replace(/[\s*:]+$/, "").trim();
    return text || el.getAttribute("placeholder") || "";
  }

  // Accepts an id, an element, or {id|el, message}.
  function resolveField(spec) {
    if (!spec) return null;
    if (typeof spec === "string") return { el: document.getElementById(spec) };
    if (isEl(spec)) return { el: spec };
    return {
      el: spec.el || (spec.id ? document.getElementById(spec.id) : null),
      message: spec.message,
    };
  }

  function focusFirst(el) {
    el.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
    // Focus after the scroll has been asked for, so the browser does not jump
    // to the field and then smooth-scroll to where it already is.
    window.setTimeout(
      function () {
        try {
          el.focus({ preventScroll: true });
        } catch (e) {
          el.focus();
        }
      },
      reduced() ? 0 : 220
    );
  }

  /**
   * The workhorse for this system's modals, which are not <form>s and so get
   * nothing from native validation: given the fields that must not be empty,
   * shake and label every one that is, put the caret in the first, and return
   * false. Returns true only when they are all filled.
   *
   *   if (!Motion.require(["cert-fname", "cert-lname"])) return;
   *
   * Every offending field is marked, not just the first — a browser alert
   * could only ever name one, which is what made "Please enter your first and
   * last name" a guessing game when only one of the two was blank.
   *
   * @param  {Array}  fields  ids, elements, or {id|el, message} objects
   * @return {boolean}
   */
  M.require = function (fields) {
    var bad = [];

    for (var i = 0; i < fields.length; i++) {
      var spec = resolveField(fields[i]);
      if (!spec || !spec.el) continue;
      if (String(spec.el.value || "").trim()) {
        M.clearField(spec.el);
        continue;
      }
      bad.push(spec);
    }

    if (!bad.length) return true;

    bad.forEach(function (spec) {
      var label = labelOf(spec.el);
      M.invalid(
        spec.el,
        true,
        spec.message || (label ? label + " is required." : "This is required.")
      );
    });
    focusFirst(bad[0].el);
    return false;
  };

  /**
   * Rejects one field for a reason other than being empty — a password that
   * does not match, an email that is already in use. Returns false so it can
   * be the whole of an early return.
   */
  M.reject = function (field, message) {
    var spec = resolveField(field);
    if (!spec || !spec.el) return false;
    M.invalid(spec.el, false, message);
    focusFirst(spec.el);
    return false;
  };

  /** Takes the error state off one field. */
  M.clearField = function (el) {
    if (!isEl(el)) return;
    el.removeAttribute("aria-invalid");
    el.classList.remove("m-empty");
    clearFieldMessage(el);
  };

  /**
   * Clears every field error inside a container. Call it when a modal opens,
   * so last time's refusal is not the first thing this time's user sees.
   */
  M.clearErrors = function (root) {
    if (!isEl(root)) return;
    var marked = root.querySelectorAll('[aria-invalid="true"], .m-empty');
    for (var i = 0; i < marked.length; i++) M.clearField(marked[i]);
    var msgs = root.querySelectorAll("[data-m-error]");
    for (var j = 0; j < msgs.length; j++)
      if (msgs[j].parentNode) msgs[j].parentNode.removeChild(msgs[j]);
  };

  /**
   * Checks a form's required and pattern-constrained fields, animates every
   * one that fails, and scrolls to the first. Returns true when the form is
   * good.
   */
  M.validate = function (root) {
    if (!isEl(root)) return true;
    var fields = root.querySelectorAll("input, select, textarea");
    var first = null;

    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (f.disabled || f.type === "hidden" || f.hasAttribute("data-no-validate"))
        continue;
      // checkValidity() covers required, type=email, pattern, min/max and
      // minlength in one call — the browser already knows all of this, and
      // re-implementing it is how the two halves of a form end up disagreeing.
      if (typeof f.checkValidity !== "function" || f.checkValidity()) {
        M.clearField(f);
        continue;
      }
      var isEmpty = !String(f.value || "").trim();
      var label = labelOf(f);
      M.invalid(
        f,
        isEmpty,
        isEmpty
          ? (label ? label + " is required." : "This is required.")
          : // The browser's own wording for a bad email, a too-short password
            // and so on — already localised, already accurate.
            f.validationMessage || "Check this value."
      );
      if (!first) first = f;
    }

    if (!first) return true;
    focusFirst(first);
    return false;
  };

  // ═════════════════════════════════════════════════════════════════════════
  // 3 · FEEDBACK
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * A ring and a colour wash over something that just changed.
   * @param {"ok"|"danger"|""} [tone]
   */
  M.flash = function (el, tone) {
    if (!isEl(el) || reduced()) return;
    var toneCls = tone === "ok" ? "m-flash-ok" : tone === "danger" ? "m-flash-danger" : "";
    if (toneCls) el.classList.add(toneCls);
    replay(el, "m-flash", 1000);
    if (toneCls)
      window.setTimeout(function () {
        el.classList.remove(toneCls);
      }, 1000);
  };

  M.pop = function (el) {
    if (!isEl(el) || reduced()) return;
    replay(el, "m-pop", 400);
  };

  /** Rings the notification bell — one shake of the icon, no sound. */
  M.ring = function (el) {
    if (!isEl(el) || reduced()) return;
    replay(el, "m-ring", 700);
  };

  /**
   * Puts a button into an in-place busy state: the label is hidden under a
   * spinner but still occupies its width, so the toolbar does not reflow while
   * a request is in flight.
   */
  M.busy = function (btn, on) {
    if (!isEl(btn)) return;
    btn.classList.toggle("is-busy", on !== false);
    if (on === false) btn.removeAttribute("aria-busy");
    else btn.setAttribute("aria-busy", "true");
  };

  // ═════════════════════════════════════════════════════════════════════════
  // 4 · STAGGER
  //
  // Sets the --m-i custom property motion.css multiplies into each child's
  // animation-delay. Capped, because the delay on row 400 of an audit trail
  // would be six seconds — the cascade is a signal that the list changed, not
  // a progress bar.
  // ═════════════════════════════════════════════════════════════════════════

  var STAGGER_CAP = 14;

  M.stagger = function (container, cap) {
    if (!isEl(container) || reduced()) return;
    M.index(container, cap);
    replay(container, "m-stagger", DUR.base + (cap || STAGGER_CAP) * 60 + 200);
  };

  /**
   * Numbers a container's children without adding .m-stagger. For the places
   * that already have their own entrance animation in motion.css and only need
   * the ordering — the fields inside a Site Content row, the links in the
   * mobile nav drawer.
   */
  M.index = function (container, cap) {
    if (!isEl(container) || reduced()) return;
    var limit = cap || STAGGER_CAP;
    var kids = container.children;
    for (var i = 0; i < kids.length; i++) {
      kids[i].style.setProperty("--m-i", String(Math.min(i, limit)));
    }
  };

  // ═════════════════════════════════════════════════════════════════════════
  // 4b · REORDERING  (FLIP)
  //
  // Moving an official up or down changed the array and repainted the list, so
  // the two rows simply swapped between one frame and the next — which reads
  // as the page glitching, not as a row moving. The only clue that anything
  // happened was the rank number.
  //
  // FLIP is the standard answer: measure where everything is (First), apply
  // the change (Last), transform each row back to where it came from
  // (Invert), then transition that transform away (Play). The browser
  // animates from the old position to the new one even though neither the row
  // nor the layout was ever actually animated.
  //
  // Rows are matched across the change by a key attribute rather than by
  // object identity, because the containers in this system repaint through
  // innerHTML — the elements measured in First no longer exist by Play.
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * @param {Element}  container  the list whose order is changing
   * @param {Function} mutate     applies the change (may re-render entirely)
   * @param {string}   [key]      attribute identifying a row across the change
   */
  M.flip = function (container, mutate, key) {
    if (!isEl(container)) return mutate && mutate();
    key = key || "data-uid";

    if (reduced()) return mutate();

    // FIRST — where every row is now.
    var before = {};
    var rows = container.querySelectorAll("[" + key + "]");
    for (var i = 0; i < rows.length; i++) {
      before[rows[i].getAttribute(key)] = rows[i].getBoundingClientRect().top;
    }

    // LAST.
    //
    // A reorder normally repaints the whole container, which the stagger
    // observer would otherwise read as "this list is showing different
    // content" and cascade the rows in. Two problems with that: it is the
    // wrong statement — the content did not change, only its order — and
    // m-rise-in animates `transform`, the one property FLIP needs to own.
    // A CSS animation beats an inline style, so the cascade would simply
    // erase the slide. The flag is cleared a frame after the observer's
    // batch has run.
    container._mNoStagger = true;
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        container._mNoStagger = false;
      });
    });

    mutate();

    // INVERT — put each moved row back where it was, with no transition, so
    // the browser has never painted it anywhere else.
    var moved = [];
    rows = container.querySelectorAll("[" + key + "]");
    for (var j = 0; j < rows.length; j++) {
      var el = rows[j];
      var was = before[el.getAttribute(key)];
      if (was === undefined) continue; // a row that was not there before
      var delta = was - el.getBoundingClientRect().top;
      if (!delta) continue;
      el.style.transition = "none";
      el.style.transform = "translateY(" + delta + "px)";
      moved.push(el);
    }
    if (!moved.length) return;

    void container.offsetWidth; // commit the inverted positions

    // PLAY
    moved.forEach(function (el) {
      el.style.transition =
        "transform " + DUR.slow + "ms var(--ease-spring, ease-out)";
      el.style.transform = "";
      onEnd(el, "transitionend", DUR.slow + 160, function () {
        el.style.transition = "";
        el.style.transform = "";
      });
    });
  };

  // ═════════════════════════════════════════════════════════════════════════
  // 5 · COUNT-UP
  //
  // The dashboard's headline figures land as finished text. Counting them up
  // is the one piece of decorative motion in the system that earns its place:
  // it tells the reader at a glance which numbers changed since the last time
  // they looked, because only those animate.
  //
  // Strictly guarded. The text has to be a plain number with an optional short
  // prefix and suffix (₱, %, "days"), and the value has to be worth counting.
  // Anything else — a date, a ratio, a name, an em dash for "no data" — is
  // left exactly as it was written.
  // ═════════════════════════════════════════════════════════════════════════

  var NUMERIC = /^(\D{0,3}?)([\d,]+(?:\.\d+)?)(\D{0,6}?)$/;
  var COUNT_MIN = 5; // below this the count is over before it is seen
  var COUNT_MS = 620;

  M.countUp = function (el) {
    if (!isEl(el) || reduced()) return;
    if (el.getAttribute("data-m-counting") === "1") return;

    // Text only. The Feedback module's average-rating tile is
    // `4.5<i data-icon=star>` — writing textContent over that would take the
    // star with it. Anything holding an element is left alone.
    if (el.children.length) return;

    var raw = (el.textContent || "").trim();
    // Already counted to this exact figure. The final write lands after the
    // guard attribute is gone, and without this the observer would read it as
    // a fresh value and count the same number up again, forever.
    if (el._mCounted === raw) return;

    var m = NUMERIC.exec(raw);
    if (!m) return;

    var prefix = m[1];
    var suffix = m[3];
    var grouped = m[2].indexOf(",") !== -1;
    var decimals = (m[2].split(".")[1] || "").length;
    var to = parseFloat(m[2].replace(/,/g, ""));
    if (!isFinite(to) || Math.abs(to) < COUNT_MIN) return;

    var from = 0;
    var start = null;
    el._mCounted = raw;
    el.setAttribute("data-m-counting", "1");

    function format(n) {
      var s = decimals ? n.toFixed(decimals) : String(Math.round(n));
      if (grouped) {
        var parts = s.split(".");
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        s = parts.join(".");
      }
      return prefix + s + suffix;
    }

    function step(ts) {
      if (start === null) start = ts;
      var t = Math.min(1, (ts - start) / COUNT_MS);
      // Same curve as --ease-out: fast first, settling at the end.
      var eased = 1 - Math.pow(1 - t, 3);
      el.textContent = format(from + (to - from) * eased);
      if (t < 1) {
        window.requestAnimationFrame(step);
      } else {
        el.textContent = raw; // land on exactly what was rendered
        el.removeAttribute("data-m-counting");
      }
    }

    el.textContent = format(from);
    window.requestAnimationFrame(step);
  };

  // ═════════════════════════════════════════════════════════════════════════
  // 6 · OVERLAYS
  //
  // Every overlay in the system is shown by adding an `open` class and hidden
  // by removing it. Removing it is instant, so the exit is played by adding
  // `is-closing` — which css/motion.css gives the same display the `open`
  // class did — and taking both classes off when the animation ends.
  //
  // Deliberately NOT done by putting `open` back for the duration: several
  // modules read that class to decide what a trigger should do next
  // (toggleUserMenu, toggleNotifPanel), and a class that lies for 180ms would
  // make a fast double-click reopen a panel that is on its way out.
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Plays an overlay's exit and then removes `open`. Safe to call on an
   * overlay that is already closed or already closing.
   *
   * To CANCEL an exit in flight — the user pressed the trigger again before
   * the panel had finished leaving — just take `is-closing` off. The pending
   * finish checks for it and, if it is gone, leaves `open` where it is. No
   * separate call is needed, and a caller that re-opens the overlay the
   * obvious way has already done it.
   */
  M.closeOverlay = function (el, done) {
    if (!isEl(el)) return;
    if (el.getAttribute("data-m-closing") === "1") return;

    var finish = function () {
      el.removeAttribute("data-m-closing");
      if (!el.classList.contains("is-closing")) {
        // Cancelled: something re-opened it mid-exit.
        if (done) done();
        return;
      }
      selfWrite(el);
      el.classList.remove("open", "is-closing");
      if (done) done();
    };

    if (reduced()) {
      el.classList.remove("open", "is-closing");
      if (done) done();
      return;
    }

    el.setAttribute("data-m-closing", "1");
    selfWrite(el);
    el.classList.add("is-closing");
    onEnd(el, "animationend", DUR.base + 160, finish);
  };

  // Marks the next class mutation on this element as ours, so the observer
  // below does not read our own exit animation as another close — and, more
  // importantly, so the final removal does not start a second exit.
  function selfWrite(el) {
    el._mSelf = (el._mSelf || 0) + 1;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 7 · AUTO-WIRING
  //
  // The point of this section is that no module has to be edited to get the
  // motion. It hangs off the conventions the system already follows.
  // ═════════════════════════════════════════════════════════════════════════

  // Containers whose repaints are worth staggering. Anything not on this list
  // repaints without a cascade, which is the right default — most of the DOM
  // churn in this app is a single cell being rewritten.
  var STAGGER_TARGETS = [
    ".data-table tbody",
    ".kpi-grid",
    ".notif-panel-list",
    ".timeline",
    ".gis-report-feed",
    ".sc-list",
    "[data-m-stagger]",
  ].join(",");

  // Controls whose validity state is worth animating.
  var CONTROL = "input, select, textarea, .form-control";

  // Surfaces that are shown with an `open` class and so can have their exit
  // played on the way out. All four are display:none → display:flex swaps.
  var OVERLAY = [
    ".modal-backdrop",
    ".notif-panel",
    ".nav-user-menu-dropdown",
    ".topbar-modules-dropdown",
  ].join(",");

  function matches(el, sel) {
    return isEl(el) && el.matches && el.matches(sel);
  }

  function wireObservers() {
    if (!window.MutationObserver) return;

    // ── Attribute changes: validity and overlay state ────────────────────
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        var el = r.target;
        if (!isEl(el)) continue;

        if (r.attributeName === "aria-invalid") {
          if (el.getAttribute("aria-invalid") === "true" && matches(el, CONTROL))
            M.shake(el);
          continue;
        }

        if (r.attributeName !== "class") continue;

        // A control that just gained .error.
        if (
          matches(el, CONTROL) &&
          el.classList.contains("error") &&
          (r.oldValue || "").indexOf("error") === -1
        ) {
          M.shake(el);
          continue;
        }

        if (matches(el, OVERLAY)) {
          // Our own writes inside closeOverlay come back through here; each
          // one is announced in advance by selfWrite().
          if (el._mSelf) {
            el._mSelf--;
            continue;
          }
          var wasOpen = /(^|\s)open(\s|$)/.test(r.oldValue || "");
          var isOpen = el.classList.contains("open");

          // An overlay that just lost `open` — play the exit first.
          if (wasOpen && !isOpen) M.closeOverlay(el);
          // An overlay that just gained it — last time's refusal must not be
          // the first thing this time's user sees. These modals are reused,
          // not rebuilt, so the red fields and their messages survive a close.
          else if (!wasOpen && isOpen) M.clearErrors(el);
        }
      }
    }).observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ["aria-invalid", "class"],
    });

    // ── Child lists: staggered repaints and count-ups ────────────────────
    // Batched into one frame: a page render fires dozens of these, and
    // staggering the same tbody four times would restart its cascade four
    // times.
    var pending = null;

    function queue(el) {
      if (!isEl(el)) return;
      if (!pending) pending = [];
      if (pending.indexOf(el) === -1) pending.push(el);
    }

    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        var target = records[i].target;
        if (!added.length || !isEl(target)) continue;

        // A figure being written into a tile that was rendered earlier holding
        // a placeholder — most of the dashboard works this way, painting the
        // card first and filling it when the API answers.
        if (matches(target, COUNTABLE)) {
          queue(target);
          continue;
        }

        // The common case: a list repainting its own children.
        if (matches(target, STAGGER_TARGETS)) {
          queue(target);
          continue;
        }

        // The other case: a whole page or card rendered in one innerHTML, with
        // the lists somewhere inside it. Bounded — a container that took
        // dozens of top-level nodes at once is a row dump, not a page render,
        // and searching each of them is not worth the frame.
        if (added.length > 24) continue;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (!isEl(node)) continue;
          if (matches(node, STAGGER_TARGETS)) queue(node);
          var inner = node.querySelectorAll(STAGGER_TARGETS);
          for (var k = 0; k < inner.length; k++) queue(inner[k]);
        }
      }

      if (!pending || pending._scheduled) return;
      pending._scheduled = true;
      window.requestAnimationFrame(function () {
        var batch = pending || [];
        pending = null;
        batch.forEach(function (el) {
          if (!el.isConnected) return;
          if (matches(el, COUNTABLE)) return M.countUp(el);
          // A list in the middle of a Motion.flip() reorder animates itself.
          if (el._mNoStagger) return;
          M.stagger(el);
          countUpWithin(el);
        });
      });
    }).observe(document.documentElement, {
      subtree: true,
      childList: true,
    });
  }

  var COUNTABLE = ".kpi-value, .health-value, [data-m-count]";

  function countUpWithin(root) {
    var nodes = root.querySelectorAll(COUNTABLE);
    for (var i = 0; i < nodes.length; i++) M.countUp(nodes[i]);
  }

  // ── Native form validation ─────────────────────────────────────────────
  // Fires on every failing control when a form is submitted or
  // reportValidity() is called. Listening in the capture phase because the
  // event does not bubble.
  document.addEventListener(
    "invalid",
    function (e) {
      var el = e.target;
      if (!matches(el, CONTROL)) return;
      M.invalid(el, !String(el.value || "").trim());
    },
    true
  );

  // ── Forms opting in with data-m-validate ───────────────────────────────
  // Everything else keeps whatever validation it already has; this is for
  // forms that want the animated pass without writing the loop.
  document.addEventListener(
    "submit",
    function (e) {
      var form = e.target;
      if (!matches(form, "form[data-m-validate]")) return;
      if (!M.validate(form)) e.preventDefault();
    },
    true
  );

  // ── First paint ────────────────────────────────────────────────────────
  // The marker on <html> lets a stylesheet know the runtime is here. It is
  // set immediately rather than on DOMContentLoaded so the first paint is
  // already correct — css/motion.css uses it to stand down gis.css's
  // display:none on a collapsed panel, and a frame of the wrong rule would
  // flash the panel's contents.
  document.documentElement.classList.add("has-motion");

  function onReady() {
    readDurations();
    wireObservers();
    // Whatever is already on the page when it loads — the dashboard's KPI
    // tiles are rendered before this runs on a fast connection.
    countUpWithin(document);
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", onReady);
  else onReady();

  window.Motion = M;
})();
