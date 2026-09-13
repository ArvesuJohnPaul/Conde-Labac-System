// ════════════════════ CHANGE PASSWORD ════════════════════
// Settings → Security → Change Password. The web counterpart of
// cares_app/lib/screens/profile/change_password_screen.dart — same strength
// scoring, same validation order, same endpoint.
//
// The current password is re-entered here and re-verified server-side by
// POST /api/auth/change-password — being signed in is deliberately not
// enough to rotate the credential (see routes/auth.js).
//
// Depends on: js/api.js (apiPost), js/icons.js. Optional: js/i18n.js,
// js/audit-log.js, and shell.js's showToast().
(function () {
  "use strict";

  var SESSION_KEY = "ibmdss.session";
  var MODAL_ID = "modal-change-password";

  function session() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY));
    } catch (e) {
      return null;
    }
  }

  function t(key) {
    return window.L ? L.t(key) : key;
  }

  function toast(msg, icon) {
    if (typeof showToast === "function") showToast(msg, icon);
    else alert(msg);
  }

  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value : "";
  }

  // 0–3. Length is the floor; variety lifts it from there.
  // Kept identical to the app's _strength getter.
  function strength(p) {
    if (p.length < 8) return 0;
    var score = 1;
    if (p.length >= 12) score++;
    var hasLetter = /[A-Za-z]/.test(p);
    var hasDigit = /\d/.test(p);
    var hasSymbol = /[^A-Za-z0-9]/.test(p);
    if (hasLetter && hasDigit && hasSymbol) score++;
    return Math.min(Math.max(score, 0), 3);
  }

  // Live strength meter + match line, redrawn on every keystroke.
  function refreshFeedback() {
    var next = val("cp-new");
    var confirm = val("cp-confirm");

    var meter = document.getElementById("cp-strength");
    if (meter) {
      if (!next) {
        meter.innerHTML = "";
      } else {
        var s = strength(next);
        var tone = s >= 3 ? "strong" : s === 2 ? "fair" : "weak";
        var label = s >= 3 ? t("pwStrong") : s === 2 ? t("pwFair") : t("pwWeak");
        var bars = "";
        for (var i = 0; i < 3; i++) {
          bars +=
            '<span class="cp-strength-seg' +
            (i < s ? " is-on" : "") +
            '"></span>';
        }
        meter.innerHTML =
          '<div class="cp-strength cp-' +
          tone +
          '">' +
          bars +
          '<span class="cp-strength-label">' +
          label +
          "</span></div>";
      }
    }

    var match = document.getElementById("cp-match");
    if (match) {
      if (!confirm) {
        match.innerHTML = "";
      } else {
        var ok = next === confirm;
        match.innerHTML =
          '<div class="cp-match' +
          (ok ? " is-ok" : " is-bad") +
          '"><i data-icon=' +
          (ok ? "check-circle" : "triangle-alert") +
          "></i>" +
          (ok ? t("pwMatches") : t("pwNoMatch")) +
          "</div>";
      }
    }
  }

  function toggleVisibility(which) {
    // "new" flips both new + confirm together, as the app does.
    var ids = which === "current" ? ["cp-current"] : ["cp-new", "cp-confirm"];
    var showing = false;
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      showing = el.type === "password";
      el.type = showing ? "text" : "password";
    });
    var btn = document.querySelector(
      '[data-cp-action="toggle"][data-cp-value="' + which + '"]',
    );
    if (btn) {
      btn.setAttribute("aria-pressed", showing ? "true" : "false");
      btn.setAttribute("aria-label", showing ? "Hide password" : "Show password");
      btn.innerHTML = "<i data-icon=" + (showing ? "eye-off" : "eye") + "></i>";
    }
  }

  // Refuses one field: shakes it, says why underneath, and repeats the reason
  // in a toast for anyone whose eyes are on the button rather than the form.
  // Without js/motion.js it is exactly the toast it always was.
  function bad(id, message) {
    if (window.Motion) Motion.reject(id, message);
    toast(message, "<i data-icon=triangle-alert></i>");
  }

  async function submit() {
    var btn = document.getElementById("cp-submit");
    if (btn && btn.disabled) return;

    var current = val("cp-current");
    var next = val("cp-new");
    var confirm = val("cp-confirm");

    // Same order as the app, so both halves reject in the same sequence.
    //
    // The toast stays — it is what the mobile app shows too — but the reason
    // now also lands on the field it is about. A toast in the bottom corner of
    // a three-field dialog does not say WHICH of the three is wrong, and with
    // the characters masked the user cannot see it for themselves.
    if (!current) return bad("cp-current", t("pwEnterCurrent"));
    if (next.length < 8) return bad("cp-new", t("pwTooShort"));
    if (next !== confirm) return bad("cp-confirm", t("pwNoMatch"));
    if (next === current) return bad("cp-new", t("pwSameAsOld"));

    var s = session();
    if (!s || !s.account_id)
      return toast("You need to sign in again first.", "<i data-icon=lock></i>");

    if (typeof apiPost !== "function")
      return toast("Password change is unavailable (API not loaded).", "<i data-icon=lock></i>");

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = t("pwSaving");
    }
    try {
      await apiPost("/api/auth/change-password", {
        account_id: s.account_id,
        current_password: current,
        new_password: next,
        actor_name: s.displayName || null,
      });
      if (typeof logAudit === "function")
        logAudit(
          "PASSWORD_CHANGE",
          "Password changed from the web system",
          "warning",
          "auth",
        );
      close();
      toast(t("pwChanged"), "<i data-icon=check-circle></i>");
    } catch (err) {
      // The server distinguishes "wrong current password" from the rest —
      // surface its wording rather than a generic failure. The dialog shakes
      // as a whole because which field is at fault is the server's call, not
      // something this side can infer from the message text.
      toast(
        err && err.message ? err.message : "Could not change the password.",
        "<i data-icon=triangle-alert></i>",
      );
      if (window.Motion) {
        var box = document.getElementById(MODAL_ID);
        Motion.shakeBox(box && box.querySelector(".modal-box"));
      }
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i data-icon=lock></i> ' + t("pwSubmit");
      }
    }
  }

  function bodyHtml() {
    return (
      '<div class="alert alert-info">' +
      '<span class="alert-icon"><i data-icon=info></i></span>' +
      t("pwIntro") +
      "</div>" +
      '<div class="form-group">' +
      '<label class="form-label" for="cp-current">' +
      t("pwCurrent") +
      "</label>" +
      '<div class="cp-field">' +
      '<input class="form-control" type="password" id="cp-current" required autocomplete="current-password" placeholder="' +
      t("pwCurrentHint") +
      '" />' +
      '<button type="button" class="cp-eye" data-cp-action="toggle" data-cp-value="current" aria-pressed="false" aria-label="Show password"><i data-icon=eye></i></button>' +
      "</div>" +
      "</div>" +
      '<hr class="cp-divider" />' +
      '<div class="form-group">' +
      '<label class="form-label" for="cp-new">' +
      t("pwNew") +
      "</label>" +
      '<div class="cp-field">' +
      '<input class="form-control" type="password" id="cp-new" required minlength="8" autocomplete="new-password" placeholder="' +
      t("pwNewHint") +
      '" />' +
      '<button type="button" class="cp-eye" data-cp-action="toggle" data-cp-value="new" aria-pressed="false" aria-label="Show password"><i data-icon=eye></i></button>' +
      "</div>" +
      '<div id="cp-strength"></div>' +
      "</div>" +
      '<div class="form-group">' +
      '<label class="form-label" for="cp-confirm">' +
      t("pwConfirm") +
      "</label>" +
      '<input class="form-control" type="password" id="cp-confirm" required autocomplete="new-password" placeholder="' +
      t("pwConfirmHint") +
      '" />' +
      '<div id="cp-match"></div>' +
      "</div>"
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
      '<div class="modal-title-icon"><i data-icon=lock></i></div>' +
      '<span id="cp-title"></span>' +
      "</div>" +
      '<button class="modal-close" type="button" data-cp-action="close"><i data-icon=x></i></button>' +
      "</div>" +
      '<div class="modal-body" id="cp-body"></div>' +
      '<div class="modal-footer">' +
      '<button class="btn btn-outline" type="button" data-cp-action="close">Cancel</button>' +
      '<button class="btn btn-primary" type="button" id="cp-submit" data-cp-action="submit"></button>' +
      "</div>" +
      "</div>";
    document.body.appendChild(el);

    el.addEventListener("click", function (e) {
      if (e.target === el) return close();
      var target = e.target.closest("[data-cp-action]");
      if (!target) return;
      var action = target.getAttribute("data-cp-action");
      if (action === "close") close();
      else if (action === "submit") submit();
      else if (action === "toggle")
        toggleVisibility(target.getAttribute("data-cp-value"));
    });

    el.addEventListener("input", function (e) {
      if (e.target.id === "cp-new" || e.target.id === "cp-confirm")
        refreshFeedback();
    });

    // Enter submits from any field.
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target.tagName === "INPUT") {
        e.preventDefault();
        submit();
      }
    });

    return el;
  }

  function open() {
    var s = session();
    if (!s || !s.account_id) {
      toast("Sign in first to change your password.", "<i data-icon=lock></i>");
      return;
    }

    var el = ensureModal();
    document.getElementById("cp-title").textContent = t("changePassword");
    document.getElementById("cp-body").innerHTML = bodyHtml();
    var btn = document.getElementById("cp-submit");
    btn.disabled = false;
    btn.innerHTML = '<i data-icon=lock></i> ' + t("pwSubmit");
    el.classList.add("open");
    document.addEventListener("keydown", onKeydown);
    setTimeout(function () {
      var first = document.getElementById("cp-current");
      if (first) first.focus();
    }, 60);
  }

  function close() {
    var el = document.getElementById(MODAL_ID);
    if (!el) return;
    el.classList.remove("open");
    // Never leave typed credentials sitting in the DOM.
    var body = document.getElementById("cp-body");
    if (body) body.innerHTML = "";
    document.removeEventListener("keydown", onKeydown);
  }

  function onKeydown(e) {
    if (e.key === "Escape") close();
  }

  window.openChangePassword = open;
  window.closeChangePassword = close;
})();
