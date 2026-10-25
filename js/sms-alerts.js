// ════════════════════ MY SMS ALERTS ════════════════════
// An official's own number and switch for incident report texts (A5).
// Opened from the account menu → "My SMS alerts" (js/preferences.js).
//
// WHY THIS PANEL EXISTS AT ALL
// Before it there was nowhere for an official to put their number: the staff
// form never asked for one and no route could change it. Reports are texted to
// `account.mobile_no`, which is the official's private number — it is never
// published, never the number residents call (that is the barangay landline),
// and never shown to a resident.
//
// FOUR THINGS DECIDE WHETHER A REPORT REACHES YOU, and the panel shows all
// four as a checklist, because "why am I not getting reports?" is a question
// the screen should answer by itself:
//
//     account active · role has "Receive incident reports" ·
//     switched on · number verified
//
// The number is PROVED before the switch will turn on. A typo in an official's
// number fails silently at the worst possible moment: nothing bounces, and the
// fire report simply goes to a stranger. So entering a number texts a six-digit
// code that has to come back, and changing the number clears the proof.
//
// The server decides all of it — the matrix row, the verification and the
// last-recipient guard (conde-labak-server/routes/accounts.js). This file only
// shows what it answers.
// (SMS-HOTLINE-PLAN.md §4.3.)
(function () {
  "use strict";

  var SESSION_KEY = "ibmdss.session";
  var MODAL_ID = "modal-sms-alerts";
  var state = null; // the server's last answer
  var step = "idle"; // "idle" | "code" — whether a code is waiting to be typed
  var busy = false;

  function session() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY));
    } catch (e) {
      return null;
    }
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function api(method, path, body) {
    if (typeof apiRequest !== "function")
      return Promise.reject(new Error("API helper not loaded on this page."));
    return apiRequest(method, path, body);
  }

  function toast(msg, icon) {
    if (typeof showToast === "function")
      showToast(msg, "<i data-icon=" + (icon || "phone") + "></i>");
  }

  // ── The checklist ──────────────────────────────────────────────────────
  function checkItem(on, text, why) {
    return (
      '<li class="sms-check' + (on ? " is-on" : "") + '">' +
      '<i data-icon="' + (on ? "check-circle" : "x") + '"></i>' +
      "<span>" + esc(text) + (why && !on ? ' <span class="sms-check-why">' + esc(why) + "</span>" : "") + "</span>" +
      "</li>"
    );
  }

  function checklist(d) {
    return (
      '<ul class="sms-checklist">' +
      checkItem(d.active, "Your account is active") +
      checkItem(
        d.may_receive,
        'Your role receives incident reports',
        "— an Administrator grants this in User Management"
      ) +
      checkItem(d.verified, "Your mobile number is verified") +
      checkItem(d.alerts_on, "Report texts are switched on") +
      "</ul>"
    );
  }

  function numberBlock(d) {
    if (step === "code")
      return (
        '<div class="alert alert-info alert-mb"><span class="alert-icon"><i data-icon=phone></i></span>' +
        "<span>We texted a six-digit code to <strong style=\"white-space:nowrap\">" +
        esc(d.mobile_no || "") +
        "</strong>. It is good for ten minutes.</span></div>" +
        '<div class="form-group">' +
        '<label class="form-label" for="sms-alert-code">Code from the text</label>' +
        '<input class="form-control" id="sms-alert-code" data-rule="digits" inputmode="numeric" autocomplete="one-time-code" ' +
        'maxlength="6" placeholder="123456" />' +
        "</div>" +
        '<div class="sms-inline-actions">' +
        '<button class="btn btn-sm btn-gold" type="button" data-alert-act="verify"><i data-icon=check></i> Verify</button>' +
        '<button class="btn btn-sm btn-outline" type="button" data-alert-act="resend">Send a new code</button>' +
        '<button class="btn btn-sm btn-ghost" type="button" data-alert-act="cancel-code">Use a different number</button>' +
        "</div>"
      );

    if (d.verified)
      return (
        '<div class="alert alert-success alert-mb"><span class="alert-icon"><i data-icon=check-circle></i></span>' +
        '<span>Reports are texted to <strong style="white-space:nowrap">' +
        esc(d.mobile_no) +
        "</strong> — verified." +
        '<br><a href="#" data-alert-act="change">Use a different number</a></span></div>'
      );

    return (
      '<div class="form-group">' +
      '<label class="form-label" for="sms-alert-number">Your mobile number</label>' +
      '<input class="form-control" id="sms-alert-number" data-rule="mobile" maxlength="11" inputmode="tel" autocomplete="tel" ' +
      'placeholder="09XXXXXXXXX" value="' + esc(d.mobile_no || "") + '" />' +
      '<span class="pref-group-caption" style="display:block;margin-left:0">Private to the barangay system. It is never shown to residents ' +
      "and never published — the number residents call is the barangay landline.</span>" +
      "</div>" +
      '<div class="sms-inline-actions">' +
      '<button class="btn btn-sm btn-gold" type="button" data-alert-act="send-code">' +
      '<i data-icon=phone></i> Text me a code</button>' +
      "</div>"
    );
  }

  function switchRow(d) {
    var blocked = !d.may_receive || !d.verified;
    return (
      '<label class="pref-row pref-row-switch' + (blocked ? " is-disabled" : "") + '">' +
      '<span class="pref-row-icon"><i data-icon=siren></i></span>' +
      '<span class="pref-row-text"><span class="pref-row-title">Text me new incident reports</span>' +
      '<span class="pref-row-sub">' +
      esc(
        blocked
          ? !d.may_receive
            ? "Your role does not receive reports"
            : "Verify your number first"
          : "Emergencies at once, any hour; everything else in the morning"
      ) +
      "</span></span>" +
      '<span class="pref-switch"><input type="checkbox" data-alert-switch' +
      (d.alerts_on ? " checked" : "") +
      (blocked ? " disabled" : "") +
      ' /><span class="pref-switch-track"><span class="pref-switch-thumb"></span></span></span>' +
      "</label>"
    );
  }

  function tiersNote(d) {
    var types = (d.emergency_types || []).join(", ");
    return (
      '<p class="pref-group-caption">' +
      esc(
        "Emergency types (" + types + ") are texted the moment they are filed, " +
          "day or night, and are not sent at all if they cannot go out within half an hour. " +
          "Every other report waits out the quiet hours and arrives in the morning."
      ) +
      "</p>"
    );
  }

  function recipientsNote(d) {
    if (d.recipients === 0)
      return (
        '<div class="alert alert-warning"><span class="alert-icon"><i data-icon=triangle-alert></i></span>' +
        "<span>No official is receiving incident reports right now. Until someone switches it on, " +
        "reports are texted to the Administrators instead.</span></div>"
      );
    return (
      '<p class="pref-group-caption">' +
      esc(
        "Incident reports currently go to " +
          d.recipients +
          (d.recipients === 1 ? " official." : " officials.") +
          (d.is_last_recipient
            ? " You are the only one — switching yours off is refused until another official turns theirs on."
            : "")
      ) +
      "</p>"
    );
  }

  // ── The modal ──────────────────────────────────────────────────────────
  function ensureModal() {
    var el = document.getElementById(MODAL_ID);
    if (el) return el;
    el = document.createElement("div");
    el.className = "modal-backdrop";
    el.id = MODAL_ID;
    el.innerHTML =
      '<div class="modal-box">' +
      '<div class="modal-header"><div class="modal-title">' +
      '<div class="modal-title-icon"><i data-icon=siren></i></div> My SMS alerts</div>' +
      '<button class="modal-close" type="button" data-alert-act="close"><i data-icon=x></i></button></div>' +
      '<div class="modal-body" data-alert-body></div>' +
      '<div class="modal-footer" data-alert-footer></div>' +
      "</div>";
    document.body.appendChild(el);

    el.addEventListener("click", function (e) {
      if (e.target === el) return close();
      var hit = e.target.closest("[data-alert-act]");
      if (!hit) return;
      e.preventDefault();
      var act = hit.getAttribute("data-alert-act");
      if (act === "close") close();
      else if (act === "send-code" || act === "resend") sendCode();
      else if (act === "verify") verify();
      else if (act === "cancel-code") {
        step = "idle";
        render();
      } else if (act === "change") {
        // The number stays in the field so a one-digit correction is a one-key
        // edit, not a retype.
        state.verified = false;
        step = "idle";
        render();
      } else if (act === "test") sendTest();
    });

    el.addEventListener("change", function (e) {
      if (e.target.hasAttribute("data-alert-switch")) setSwitch(e.target.checked);
    });
    el.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      if (e.target.id === "sms-alert-code") verify();
      else if (e.target.id === "sms-alert-number") sendCode();
    });
    return el;
  }

  function render() {
    var el = ensureModal();
    var d = state || {};
    el.querySelector("[data-alert-body]").innerHTML =
      '<p class="modal-help-text" style="margin-top:0">' +
      "Reports filed by residents — and calls logged at the hall — are texted to the " +
      "officials who switch this on. Four things decide whether one reaches you:" +
      "</p>" +
      checklist(d) +
      numberBlock(d) +
      '<div class="pref-group-body">' +
      switchRow(d) +
      "</div>" +
      tiersNote(d) +
      recipientsNote(d);
    el.querySelector("[data-alert-footer]").innerHTML =
      (d.verified
        ? '<button class="btn btn-outline" type="button" data-alert-act="test">' +
          '<i data-icon=phone></i> Send me a test</button>'
        : "") +
      '<button class="btn btn-gold" type="button" data-alert-act="close">Done</button>';
    if (typeof hydrateIcons === "function") hydrateIcons(el);
    el.classList.add("open");
    var focus = el.querySelector("#sms-alert-code") || el.querySelector("#sms-alert-number");
    if (focus) focus.focus();
  }

  function close() {
    var el = document.getElementById(MODAL_ID);
    if (el) el.classList.remove("open");
    step = "idle";
  }

  // ── Server calls ───────────────────────────────────────────────────────
  function guard(fn) {
    if (busy) return;
    busy = true;
    return fn().finally(function () {
      busy = false;
    });
  }

  function sendCode() {
    var el = document.getElementById(MODAL_ID);
    var field = el && el.querySelector("#sms-alert-number");
    var number = field ? field.value : state.mobile_no;
    return guard(function () {
      return api("POST", "/api/accounts/me/mobile", { mobile_no: number })
        .then(function (r) {
          state.mobile_no = r.mobile_no;
          state.verified = false;
          state.alerts_on = false;
          step = "code";
          render();
          // In dry-run nothing actually leaves the building, and an official
          // staring at a phone that never buzzes should be told why rather
          // than left to wonder.
          if (r.skip_reason)
            toast(
              "Texting is in " + r.skip_reason + " mode — the code was logged, not sent. " +
                "The SMS Log has it.",
              "triangle-alert"
            );
        })
        .catch(function (err) {
          toast(err.message, "triangle-alert");
        });
    });
  }

  function verify() {
    var el = document.getElementById(MODAL_ID);
    var field = el && el.querySelector("#sms-alert-code");
    var code = field ? field.value.trim() : "";
    if (!/^\d{6}$/.test(code)) return toast("Type the six digits from the text.", "triangle-alert");
    return guard(function () {
      return api("POST", "/api/accounts/me/mobile/verify", { code: code })
        .then(function (d) {
          state = d;
          step = "idle";
          render();
          toast("Number verified.", "check-circle");
        })
        .catch(function (err) {
          toast(err.message, "triangle-alert");
        });
    });
  }

  function setSwitch(on) {
    return guard(function () {
      return api("PUT", "/api/accounts/me/sms-alerts", { on: on })
        .then(function (d) {
          state = d;
          render();
          toast(
            on ? "You will be texted new incident reports." : "Report texts switched off.",
            on ? "check-circle" : "phone"
          );
        })
        .catch(function (err) {
          // The server refused — the last-recipient guard, most likely. Put
          // the switch back where the server says it is.
          render();
          toast(err.message, "triangle-alert");
        });
    });
  }

  function sendTest() {
    return guard(function () {
      return api("POST", "/api/accounts/me/sms-test", {})
        .then(function (r) {
          toast(
            r.skip_reason
              ? "Logged, not sent — texting is in " + r.skip_reason + " mode."
              : "Test text on its way.",
            r.skip_reason ? "triangle-alert" : "check-circle"
          );
        })
        .catch(function (err) {
          toast(err.message, "triangle-alert");
        });
    });
  }

  function open() {
    api("GET", "/api/accounts/me/sms-alerts")
      .then(function (d) {
        state = d;
        step = "idle";
        render();
      })
      .catch(function (err) {
        toast(err.message, "triangle-alert");
      });
  }

  window.openSmsAlerts = open;
  // Staff only: `account.mobile_no` is the officials' alert number, and a
  // resident account is refused every one of these routes by the server.
  window.smsAlertsAvailable = function () {
    var s = session();
    return !!(s && s.account_id && s.role && s.role !== "Resident");
  };
})();
