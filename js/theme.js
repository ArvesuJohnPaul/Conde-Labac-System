// ════════════════════ THEME ════════════════════
// Appearance preference (light / dark / follow system), persisted across
// visits. The web counterpart of the mobile app's ThemeController
// (cares_app/lib/data/theme_controller.dart) — same three modes, same
// localStorage key name, so the two halves of the system describe the
// preference identically even though they can't share storage.
//
// Load this in <head>, BEFORE any stylesheet, on every page. It applies the
// saved theme synchronously so the first paint is already correct — deferring
// it flashes a white page before dark mode kicks in.
//
// The dark palette itself lives in css/shared.css under [data-theme="dark"].
(function () {
  "use strict";

  var KEY = "cares.theme_mode";
  var MODES = ["light", "dark", "system"];

  var listeners = [];
  var mode = read();

  function read() {
    try {
      var saved = localStorage.getItem(KEY);
      return MODES.indexOf(saved) !== -1 ? saved : "system";
    } catch (e) {
      // Private browsing / storage disabled — fall back to the OS setting.
      return "system";
    }
  }

  function systemPrefersDark() {
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  }

  function isDark() {
    return mode === "dark" || (mode === "system" && systemPrefersDark());
  }

  // The only place that touches the DOM attribute the CSS keys off.
  function apply() {
    var root = document.documentElement;
    if (isDark()) root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
  }

  function setMode(next) {
    if (MODES.indexOf(next) === -1 || next === mode) return;
    mode = next;
    apply();
    try {
      localStorage.setItem(KEY, next);
    } catch (e) {
      // A failed write only costs the preference on the next visit.
    }
    listeners.forEach(function (fn) {
      try {
        fn(mode, isDark());
      } catch (e) {
        console.error("[theme] listener failed", e);
      }
    });
  }

  // Human-readable label for the current choice — matches the wording the
  // app uses on its Profile → Appearance tile.
  function label() {
    return mode === "light"
      ? "Light"
      : mode === "dark"
        ? "Dark"
        : "Follow system";
  }

  // Follow the OS toggle live while on "Follow system".
  if (typeof window.matchMedia === "function") {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var onChange = function () {
      if (mode !== "system") return;
      apply();
      listeners.forEach(function (fn) {
        try {
          fn(mode, isDark());
        } catch (e) {
          console.error("[theme] listener failed", e);
        }
      });
    };
    // addEventListener on MediaQueryList is unsupported on older Safari.
    if (typeof mq.addEventListener === "function")
      mq.addEventListener("change", onChange);
    else if (typeof mq.addListener === "function") mq.addListener(onChange);
  }

  // Another tab changed the preference — mirror it here.
  window.addEventListener("storage", function (e) {
    if (e.key !== KEY) return;
    mode = read();
    apply();
    listeners.forEach(function (fn) {
      try {
        fn(mode, isDark());
      } catch (err) {
        console.error("[theme] listener failed", err);
      }
    });
  });

  window.Theme = {
    get mode() {
      return mode;
    },
    get isDark() {
      return isDark();
    },
    get label() {
      return label();
    },
    setMode: setMode,
    // Register a callback fired whenever the effective theme changes.
    // Returns an unsubscribe function.
    subscribe: function (fn) {
      if (typeof fn !== "function") return function () {};
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i !== -1) listeners.splice(i, 1);
      };
    },
  };

  apply();
})();
