// ════════════════════ PREFERENCES ════════════════════
// The web counterpart of the app's Settings screen
// (cares_app/lib/screens/profile/settings_screen.dart) — same five groups in
// the same order: Appearance, Language, Security, Notifications, About.
//
// Built as a modal rather than a page so it is reachable from everywhere
// (landing page, resident portal, and every MIS page) without each page
// having to carry the markup. Call openPreferences().
//
// Depends on: js/theme.js, js/i18n.js, js/icons.js. Optional: js/api.js and
// js/change-password.js (the Security row degrades gracefully without them).
(function () {
  "use strict";

  var SESSION_KEY = "ibmdss.session";
  var NOTIF_KEY = "cares.notif_prefs";
  var APP_VERSION = "1.0.0";
  var MODAL_ID = "modal-preferences";

  // Read the session directly rather than via shell.js's getSession(), so
  // this works on pages that don't load the MIS shell (e.g. index.html).
  function session() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY));
    } catch (e) {
      return null;
    }
  }

  // Notification toggles. Local-only for now, exactly as in the app — wire
  // to /api/notifications preferences when that grows a per-account row.
  function notifPrefs() {
    var d = { advisories: true, requests: true };
    try {
      var saved = JSON.parse(localStorage.getItem(NOTIF_KEY));
      if (saved && typeof saved === "object") {
        if (typeof saved.advisories === "boolean") d.advisories = saved.advisories;
        if (typeof saved.requests === "boolean") d.requests = saved.requests;
      }
    } catch (e) {
      /* defaults */
    }
    return d;
  }

  function setNotifPref(key, value) {
    var p = notifPrefs();
    p[key] = value;
    try {
      localStorage.setItem(NOTIF_KEY, JSON.stringify(p));
    } catch (e) {
      /* preference is best-effort */
    }
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(
      /[&<>"']/g,
      function (c) {
        return {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[c];
      },
    );
  }

  function t(key) {
    return window.L ? L.t(key) : key;
  }

  // ── Row builders ────────────────────────────────────────────────────
  // A selectable option (theme / language) — icon, title, subtitle, and a
  // check on the right. Mirrors the app's _ThemeOption / _LanguageOption.
  function optionRow(opts) {
    return (
      '<button type="button" class="pref-row pref-row-btn' +
      (opts.selected ? " is-selected" : "") +
      '" data-pref-action="' +
      opts.action +
      '" data-pref-value="' +
      opts.value +
      '">' +
      '<span class="pref-row-icon"><i data-icon=' +
      opts.icon +
      "></i></span>" +
      '<span class="pref-row-text">' +
      '<span class="pref-row-title">' +
      esc(opts.title) +
      "</span>" +
      '<span class="pref-row-sub">' +
      esc(opts.subtitle) +
      "</span>" +
      "</span>" +
      '<span class="pref-row-check"><i data-icon=' +
      (opts.selected ? "check-circle" : "circle") +
      "></i></span>" +
      "</button>"
    );
  }

  // A row that opens something else (the app's _NavRow).
  function navRow(opts) {
    return (
      '<button type="button" class="pref-row pref-row-btn"' +
      (opts.enabled ? "" : " disabled") +
      ' data-pref-action="' +
      opts.action +
      '">' +
      '<span class="pref-row-icon"><i data-icon=' +
      opts.icon +
      "></i></span>" +
      '<span class="pref-row-text">' +
      '<span class="pref-row-title">' +
      esc(opts.title) +
      "</span>" +
      '<span class="pref-row-sub">' +
      esc(opts.subtitle) +
      "</span>" +
      "</span>" +
      '<span class="pref-row-check"><i data-icon=arrow-right></i></span>' +
      "</button>"
    );
  }

  // A toggle row (the app's _SwitchRow).
  function switchRow(opts) {
    return (
      '<label class="pref-row pref-row-switch">' +
      '<span class="pref-row-icon"><i data-icon=' +
      opts.icon +
      "></i></span>" +
      '<span class="pref-row-text">' +
      '<span class="pref-row-title">' +
      esc(opts.title) +
      "</span>" +
      '<span class="pref-row-sub">' +
      esc(opts.subtitle) +
      "</span>" +
      "</span>" +
      '<span class="pref-switch">' +
      '<input type="checkbox" data-pref-action="notif" data-pref-value="' +
      opts.key +
      '"' +
      (opts.value ? " checked" : "") +
      " />" +
      '<span class="pref-switch-track"><span class="pref-switch-thumb"></span></span>' +
      "</span>" +
      "</label>"
    );
  }

  // A read-only label/value row (the app's _InfoRow).
  function infoRow(opts) {
    return (
      '<div class="pref-row">' +
      '<span class="pref-row-icon"><i data-icon=' +
      opts.icon +
      "></i></span>" +
      '<span class="pref-row-text">' +
      '<span class="pref-row-title">' +
      esc(opts.title) +
      "</span>" +
      "</span>" +
      '<span class="pref-row-value">' +
      esc(opts.value) +
      "</span>" +
      "</div>"
    );
  }

  function group(title, rowsHtml, caption) {
    return (
      '<section class="pref-group">' +
      '<h3 class="pref-group-title">' +
      esc(title) +
      "</h3>" +
      '<div class="pref-group-body">' +
      rowsHtml +
      "</div>" +
      (caption
        ? '<p class="pref-group-caption">' + esc(caption) + "</p>"
        : "") +
      "</section>"
    );
  }

  // ── Body ────────────────────────────────────────────────────────────
  function bodyHtml() {
    var s = session();
    var signedIn = !!s;
    var mode = window.Theme ? Theme.mode : "system";
    var lang = window.L ? L.language : "english";
    var np = notifPrefs();

    var appearance =
      optionRow({
        action: "theme",
        value: "system",
        icon: "monitor",
        title: t("themeSystem"),
        subtitle: t("themeSystemSub"),
        selected: mode === "system",
      }) +
      optionRow({
        action: "theme",
        value: "light",
        icon: "sun",
        title: t("themeLight"),
        subtitle: t("themeLightSub"),
        selected: mode === "light",
      }) +
      optionRow({
        action: "theme",
        value: "dark",
        icon: "moon",
        title: t("themeDark"),
        subtitle: t("themeDarkSub"),
        selected: mode === "dark",
      });

    // Each language is labelled in its own language, so it stays
    // recognisable to someone who can't read the active one.
    var language =
      optionRow({
        action: "lang",
        value: "english",
        icon: "languages",
        title: "English",
        subtitle: t("languageEnglishSub"),
        selected: lang === "english",
      }) +
      optionRow({
        action: "lang",
        value: "filipino",
        icon: "languages",
        title: "Filipino",
        subtitle: t("languageFilipinoSub"),
        selected: lang === "filipino",
      });

    // "My Account" — the resident's own barangay record. Editing it is a
    // request, not a direct write (js/account-edit.js explains why), so the
    // subtitle says so up front rather than surprising them at submit.
    // Disabled for logins with no linked resident record (staff-only
    // accounts), which have no barangay details to change.
    var canEditAccount =
      typeof accountEditAvailable === "function" && accountEditAvailable();
    var account = navRow({
      action: "edit-account",
      icon: "user",
      title: "Edit my details",
      subtitle: !signedIn
        ? t("signIn")
        : canEditAccount
          ? "Name, birthdate, contact — sent to the barangay for approval"
          : "This account is not linked to a resident record",
      enabled: canEditAccount,
    });

    var security = navRow({
      action: "change-password",
      icon: "lock",
      title: t("changePassword"),
      // Signed-out visitors have no password to rotate yet.
      subtitle: signedIn ? t("changePasswordSub") : t("signIn"),
      enabled: signedIn,
    });

    var notifications =
      switchRow({
        key: "advisories",
        icon: "megaphone",
        title: t("notifAdvisories"),
        subtitle: t("notifAdvisoriesSub"),
        value: np.advisories,
      }) +
      switchRow({
        key: "requests",
        icon: "file-text",
        title: t("notifRequests"),
        subtitle: t("notifRequestsSub"),
        value: np.requests,
      });

    var about =
      infoRow({ icon: "info", title: t("version"), value: APP_VERSION }) +
      infoRow({
        icon: "user",
        title: t("signedInAs"),
        value: signedIn ? s.displayName || "User" : t("guest"),
      });

    return (
      group("My Account", account) +
      group(t("appearance"), appearance, t("appearanceCaption")) +
      group(t("languageSection"), language, t("languageCaption")) +
      group(t("security"), security) +
      group(t("notificationsGroup"), notifications) +
      group(t("about"), about)
    );
  }

  function ensureModal() {
    var existing = document.getElementById(MODAL_ID);
    if (existing) return existing;

    var el = document.createElement("div");
    el.className = "modal-backdrop";
    el.id = MODAL_ID;
    el.innerHTML =
      '<div class="modal-box">' +
      '<div class="modal-header">' +
      '<div class="modal-title">' +
      '<div class="modal-title-icon"><i data-icon=settings></i></div>' +
      '<span id="pref-title">' +
      esc(t("settings")) +
      "</span>" +
      "</div>" +
      '<button class="modal-close" type="button" data-pref-action="close">' +
      "<i data-icon=x></i>" +
      "</button>" +
      "</div>" +
      '<div class="modal-body" id="pref-body"></div>' +
      "</div>";
    document.body.appendChild(el);

    // Backdrop click closes; clicks inside the box must not.
    el.addEventListener("click", function (e) {
      if (e.target === el) close();
    });

    el.addEventListener("click", onAction);
    el.addEventListener("change", onAction);
    return el;
  }

  function onAction(e) {
    var target = e.target.closest("[data-pref-action]");
    if (!target) return;
    var action = target.getAttribute("data-pref-action");
    var value = target.getAttribute("data-pref-value");

    if (action === "close") {
      close();
    } else if (action === "theme" && e.type === "click") {
      if (window.Theme) Theme.setMode(value);
      render();
    } else if (action === "lang" && e.type === "click") {
      if (!window.L) return;
      L.setLanguage(value);
      render();
      if (typeof showToast === "function")
        showToast(L.t("languageChanged"), "<i data-icon=languages></i>");
    } else if (action === "notif" && e.type === "change") {
      var on = target.checked;
      setNotifPref(value, on);
      if (typeof showToast === "function") {
        var label =
          value === "advisories" ? t("notifAdvisories") : t("notifRequests");
        showToast(
          window.L ? (on ? L.turnedOn(label) : L.turnedOff(label)) : label,
          on ? "<i data-icon=bell></i>" : "<i data-icon=bell></i>",
        );
      }
    } else if (action === "edit-account" && e.type === "click") {
      if (typeof openAccountEdit === "function") {
        close();
        openAccountEdit();
      } else if (typeof showToast === "function") {
        showToast("Account editing is unavailable on this page.", "<i data-icon=user></i>");
      }
    } else if (action === "change-password" && e.type === "click") {
      if (typeof openChangePassword === "function") {
        close();
        openChangePassword();
      } else if (typeof showToast === "function") {
        showToast("Password change is unavailable on this page.", "<i data-icon=lock></i>");
      }
    }
  }

  function render() {
    var box = document.getElementById("pref-body");
    if (!box) return;
    box.innerHTML = bodyHtml();
    var title = document.getElementById("pref-title");
    if (title) title.textContent = t("settings");
  }

  function open() {
    var el = ensureModal();
    render();
    el.classList.add("open");
    document.addEventListener("keydown", onKeydown);
  }

  function close() {
    var el = document.getElementById(MODAL_ID);
    if (el) el.classList.remove("open");
    document.removeEventListener("keydown", onKeydown);
  }

  function onKeydown(e) {
    if (e.key === "Escape") close();
  }

  window.openPreferences = open;
  window.closePreferences = close;
})();
