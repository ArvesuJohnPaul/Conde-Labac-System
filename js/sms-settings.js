// ════════════════════ TEXT MESSAGE SETTINGS ════════════════════
// A resident's two SMS settings — certificate updates and barangay
// announcements — asked once, the first time they sign in, and changeable
// afterwards from Settings → My Account → Text messages.
//
// Why two switches, not one: turning off announcements must not also stop
// "your certificate is ready", which the resident asked for by filing.
// Why they start ON: the barangay texts residents as part of its public
// function (RA 10173 §12(e)); this is the resident's right to object, recorded
// with its date — not a consent form. Emergency announcements and security
// codes ignore both switches, and the dialog says so.
// (SMS-HOTLINE-PLAN.md §3.4.)
//
// Server: GET / PUT /api/residents/me/sms-settings. "Save" stamps the choice,
// so the first-sign-in prompt never returns; "Ask me later" leaves it unset and
// the prompt comes back next sign-in (sessionStorage stops it re-appearing on
// every page until then).
//
// Loaded on every page that loads js/account-edit.js; the "Wrong number?" link
// uses that file's change request, because a resident's number is part of the
// barangay record and is changed by request.
(function () {
  "use strict";

  var SESSION_KEY = "ibmdss.session";
  var MODAL_ID = "modal-sms-settings";

  // English / Filipino, chosen by the site's language (js/i18n.js).
  var TEXT = {
    title: ["Text messages from the barangay", "Mga text mula sa barangay"],
    intro: [
      "The barangay can text you about your requests and its announcements. Choose what you want to receive.",
      "Maaaring mag-text sa inyo ang barangay tungkol sa inyong mga hiling at mga anunsyo. Piliin kung alin ang nais ninyong matanggap.",
    ],
    goesTo: ["Texts go to", "Ipinapadala ang text sa"],
    noNumber: [
      "There is no mobile number on your barangay record, so texts cannot reach you yet.",
      "Walang mobile number sa inyong record sa barangay, kaya hindi pa kayo maaabot ng text.",
    ],
    wrongNumber: ["Wrong number? Request a change", "Maling numero? Humiling ng pagbabago"],
    addNumber: ["Add a mobile number", "Magdagdag ng mobile number"],
    updates: ["Certificate updates", "Mga update sa sertipiko"],
    updatesSub: [
      "When your request is ready for pickup, or not approved",
      "Kapag handa nang kunin o hindi naaprubahan ang inyong hiling",
    ],
    advisories: ["Barangay announcements", "Mga anunsyo ng barangay"],
    advisoriesSub: ["Advisories, events and reminders", "Mga abiso, kaganapan at paalala"],
    always: [
      "Emergency announcements and security codes are always sent.",
      "Palaging ipinapadala ang mga emergency na anunsyo at mga security code.",
    ],
    save: ["Save", "I-save"],
    later: ["Ask me later", "Mamaya na lang"],
    close: ["Cancel", "Kanselahin"],
    saved: ["Text message settings saved", "Na-save ang mga setting sa text"],
    failed: ["Could not save: ", "Hindi ma-save: "],
    loading: ["Loading…", "Naglo-load…"],
  };
  function tx(key) {
    var pair = TEXT[key];
    return pair[window.L && L.isFilipino ? 1 : 0];
  }

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

  function snoozeKey(s) {
    return "cares.smsPromptLater." + s.account_id;
  }

  function switchRow(key, title, sub, on) {
    return (
      '<label class="pref-row pref-row-switch">' +
      '<span class="pref-row-icon"><i data-icon=' +
      (key === "sms_updates" ? "file-text" : "megaphone") +
      "></i></span>" +
      '<span class="pref-row-text"><span class="pref-row-title">' +
      esc(title) +
      '</span><span class="pref-row-sub">' +
      esc(sub) +
      "</span></span>" +
      '<span class="pref-switch"><input type="checkbox" data-sms="' +
      key +
      '"' +
      (on ? " checked" : "") +
      ' /><span class="pref-switch-track"><span class="pref-switch-thumb"></span></span></span>' +
      "</label>"
    );
  }

  function ensureModal() {
    var el = document.getElementById(MODAL_ID);
    if (el) return el;
    el = document.createElement("div");
    el.className = "modal-backdrop";
    el.id = MODAL_ID;
    el.innerHTML =
      '<div class="modal-box">' +
      '<div class="modal-header"><div class="modal-title">' +
      '<div class="modal-title-icon"><i data-icon=phone></i></div> <span data-sms-title></span></div>' +
      '<button class="modal-close" type="button" data-sms-act="dismiss"><i data-icon=x></i></button></div>' +
      '<div class="modal-body" data-sms-body></div>' +
      '<div class="modal-footer" data-sms-footer></div>' +
      "</div>";
    document.body.appendChild(el);
    el.addEventListener("click", function (e) {
      if (e.target === el) return dismiss();
      var act = e.target.closest("[data-sms-act]");
      if (!act) return;
      var a = act.getAttribute("data-sms-act");
      if (a === "dismiss") dismiss();
      else if (a === "save") save();
      else if (a === "change-number") {
        close();
        if (typeof openAccountEdit === "function") openAccountEdit();
      }
    });
    return el;
  }

  var mode = "settings"; // "prompt" (first sign-in) | "settings"

  function render(data) {
    var el = ensureModal();
    el.querySelector("[data-sms-title]").textContent = tx("title");
    // The number never breaks across lines; the link gets a line of its own.
    var number = data.has_mobile
      ? '<div class="alert alert-info alert-mb"><span class="alert-icon"><i data-icon=phone></i></span> <span>' +
        esc(tx("goesTo")) +
        ' <strong style="white-space:nowrap">' +
        esc(data.number_masked) +
        '</strong><br><a href="#" data-sms-act="change-number">' +
        esc(tx("wrongNumber")) +
        "</a></span></div>"
      : '<div class="alert alert-warning alert-mb"><span class="alert-icon"><i data-icon=triangle-alert></i></span> ' +
        esc(tx("noNumber")) +
        ' <a href="#" data-sms-act="change-number">' +
        esc(tx("addNumber")) +
        "</a></div>";
    el.querySelector("[data-sms-body]").innerHTML =
      '<p class="modal-help-text" style="margin-top:0">' +
      esc(tx("intro")) +
      "</p>" +
      number +
      '<div class="pref-group-body">' +
      switchRow("sms_updates", tx("updates"), tx("updatesSub"), data.sms_updates !== false) +
      switchRow("sms_advisories", tx("advisories"), tx("advisoriesSub"), data.sms_advisories !== false) +
      "</div>" +
      '<p class="pref-group-caption">' +
      esc(tx("always")) +
      "</p>";
    el.querySelector("[data-sms-footer]").innerHTML =
      '<button class="btn btn-outline" type="button" data-sms-act="dismiss">' +
      esc(mode === "prompt" ? tx("later") : tx("close")) +
      '</button><button class="btn btn-gold" type="button" data-sms-act="save"><i data-icon=check></i> ' +
      esc(tx("save")) +
      "</button>";
    if (typeof hydrateIcons === "function") hydrateIcons(el);
    el.classList.add("open");
  }

  function close() {
    var el = document.getElementById(MODAL_ID);
    if (el) el.classList.remove("open");
  }

  // "Ask me later" in the prompt: not stamped, so it asks again next sign-in;
  // quiet for the rest of this browser session.
  function dismiss() {
    var s = session();
    if (mode === "prompt" && s) {
      try {
        sessionStorage.setItem(snoozeKey(s), "1");
      } catch (e) {
        /* best-effort */
      }
    }
    close();
  }

  function save() {
    var s = session();
    var el = document.getElementById(MODAL_ID);
    if (!s || !el) return;
    var body = { account_id: s.account_id };
    el.querySelectorAll("[data-sms]").forEach(function (c) {
      body[c.getAttribute("data-sms")] = c.checked;
    });
    var btn = el.querySelector('[data-sms-act="save"]');
    if (btn) btn.disabled = true;
    api("PUT", "/api/residents/me/sms-settings", body)
      .then(function () {
        close();
        if (typeof showToast === "function") showToast(tx("saved"), "<i data-icon=phone></i>");
      })
      .catch(function (err) {
        if (btn) btn.disabled = false;
        if (typeof showToast === "function")
          showToast(tx("failed") + err.message, "<i data-icon=triangle-alert></i>");
      });
  }

  function load() {
    var s = session();
    if (!s || !s.account_id) return Promise.reject(new Error("Sign in first."));
    return api("GET", "/api/residents/me/sms-settings?account_id=" + encodeURIComponent(s.account_id));
  }

  // Settings → My Account → Text messages.
  function open() {
    mode = "settings";
    load()
      .then(render)
      .catch(function (err) {
        if (typeof showToast === "function") showToast(err.message, "<i data-icon=triangle-alert></i>");
      });
  }

  // The first sign-in prompt: residents only, once, until they choose.
  function promptIfNeeded() {
    var s = session();
    if (!s || s.role !== "Resident" || !s.account_id || !s.resident_id) return;
    try {
      if (sessionStorage.getItem(snoozeKey(s))) return;
    } catch (e) {
      /* no storage → ask */
    }
    load()
      .then(function (data) {
        if (data.sms_pref_set_at) return;
        mode = "prompt";
        render(data);
      })
      .catch(function () {
        /* no record / offline — try again next page */
      });
  }

  window.openSmsSettings = open;
  window.smsSettingsAvailable = function () {
    var s = session();
    return !!(s && s.account_id && s.resident_id);
  };

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(promptIfNeeded, 600);
    });
  else setTimeout(promptIfNeeded, 600);
})();
