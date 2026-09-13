// ════════════════════ EDIT MY ACCOUNT (request-based) ════════════════════
// Opened from Settings → My Account → "Edit my details".
//
// WHY THIS IS A REQUEST AND NOT AN EDIT
// The resident row is the barangay's own record of who lives here. It backs
// certificates, classifications (senior / PWD / solo parent) and the account
// claiming flow, so a resident cannot be allowed to rewrite their own name or
// birthdate directly — a surname or a birth year is exactly the field someone
// would change to qualify for a benefit. What this screen submits is a
// PROPOSAL: POST /api/edit-requests stores the before/after and the resident's
// stated reason, leaves the resident row untouched, and the change is only
// applied when staff approve it in MIS → Barangay Residency → Edit Requests.
//
// The reason is required (10 characters minimum, enforced here and again by
// the API). Staff approving a name change need to know it followed a marriage
// rather than a typo, and it is what the audit trail is later asked for.
//
// Loaded on every page that loads js/preferences.js — the Settings modal is
// reachable from the landing page, the resident portal and every MIS page, so
// this has to be too. Degrades to a disabled row when the account has no
// linked resident record (staff-only logins) or when js/api.js is absent.
(function () {
  "use strict";

  var SESSION_KEY = "ibmdss.session";
  var MODAL_ID = "modal-account-edit";

  // Only these reach the API — the same allow-list the server enforces in
  // routes/edit-requests.js (EDITABLE). Purok, classifications and status are
  // deliberately absent: those are staff determinations, not self-declared
  // facts, and changing them is a Residency-page action. Household IS
  // self-declared — a resident knows which house is theirs — but it is not a
  // text input, so it lives below with the photo rather than in this table.
  var FIELDS = [
    { key: "last_name", label: "Last Name", type: "text", required: true },
    { key: "first_name", label: "First Name", type: "text", required: true },
    { key: "middle_name", label: "Middle Name", type: "text" },
    { key: "suffix", label: "Suffix", type: "text", placeholder: "e.g. Jr., III" },
    { key: "birthdate", label: "Birthdate", type: "date" },
    {
      key: "sex",
      label: "Sex",
      type: "select",
      options: [["", "—"], ["M", "Male"], ["F", "Female"]],
    },
    {
      key: "civil_status",
      label: "Civil Status",
      type: "select",
      options: [["", "—"], ["Single", "Single"], ["Married", "Married"], ["Widowed", "Widowed"], ["Separated", "Separated"]],
    },
    { key: "contact_no", label: "Contact No.", type: "text", placeholder: "e.g. 0917 123 4567" },
    { key: "occupation", label: "Occupation", type: "text", placeholder: "e.g. Farmer" },
    {
      key: "voter_status",
      label: "Voter Status",
      type: "select",
      options: [["", "—"], ["Registered", "Registered"], ["Not Registered", "Not Registered"]],
    },
  ];

  var REASON_MIN = 10;

  // The record as the API last returned it, so submit() can diff against it
  // and send only what actually changed.
  var ORIGINAL = null;
  // This resident's own request history (newest first).
  var MY_REQUESTS = [];

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

  // Blank and null are the same absence as far as a diff is concerned —
  // without this, clearing an already-empty field would submit `"" ≠ null`
  // as a change.
  function norm(v) {
    return v == null || v === "" ? "" : String(v).trim();
  }

  function toast(msg, icon) {
    if (typeof showToast === "function") showToast(msg, icon || "<i data-icon=info></i>");
  }

  function fmtDate(v) {
    if (!v) return "";
    var d = new Date(v);
    return isNaN(d)
      ? String(v)
      : d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
  }

  function fieldByKey(key) {
    return FIELDS.filter(function (f) {
      return f.key === key;
    })[0];
  }

  // Photo and household are not in FIELDS (neither is a plain input), so a
  // request touching one would otherwise be listed to the resident by its
  // column name — "building_id" rather than "Household".
  var EXTRA_LABELS = { photo: "Profile Photo", building_id: "Household" };
  function labelFor(key) {
    var f = fieldByKey(key);
    return f ? f.label : EXTRA_LABELS[key] || key;
  }

  // ── Markup ──────────────────────────────────────────────────────────
  function inputHtml(f, value) {
    var v = norm(value);
    if (f.type === "select") {
      return (
        '<select class="form-control" id="acct-edit-' + f.key + '">' +
        f.options
          .map(function (o) {
            return (
              '<option value="' + esc(o[0]) + '"' +
              (o[0] === v ? " selected" : "") +
              ">" + esc(o[1]) + "</option>"
            );
          })
          .join("") +
        "</select>"
      );
    }
    return (
      '<input class="form-control" id="acct-edit-' + f.key + '"' +
      ' type="' + f.type + '" value="' + esc(v) + '"' +
      (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : "") +
      " />"
    );
  }

  // ── Profile photo ───────────────────────────────────────────────────
  // Held apart from FIELDS because it is not a text input and not diffed the
  // same way: PHOTO_NEXT is null until the resident actually picks a file, and
  // only then does `photo` enter the change set. The image is stored inline as
  // a data URI on resident.photo (same shape the mobile app writes), so it
  // needs a hard size cap — a modern phone photo is several megabytes, and
  // that lands in a JSONB column, in every /api/edit-requests response, and in
  // the staff review list.
  var PHOTO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB of original file
  var PHOTO_MAX_PX = 512; // downscaled square, plenty for an avatar
  // undefined = untouched, string = new photo picked, null = removed.
  var PHOTO_NEXT;

  function photoHtml(current) {
    var shown = PHOTO_NEXT !== undefined ? PHOTO_NEXT : current;
    return (
      '<div class="form-group form-group-flat">' +
      '<label class="form-label">Profile Photo</label>' +
      '<div class="acct-edit-photo-row">' +
      (shown
        ? '<img class="acct-edit-photo" src="' + esc(shown) + '" alt="Profile photo" />'
        : '<div class="acct-edit-photo acct-edit-photo-empty"><i data-icon=user></i></div>') +
      '<div class="acct-edit-photo-actions">' +
      '<input type="file" id="acct-edit-photo-file" accept="image/*" hidden />' +
      '<button type="button" class="btn btn-sm btn-outline" data-acct-edit="pick-photo">' +
      (shown ? "Change photo" : "Upload photo") +
      "</button>" +
      (shown
        ? '<button type="button" class="btn btn-sm btn-outline" data-acct-edit="clear-photo">Remove</button>'
        : "") +
      '<p class="acct-edit-photo-note">' +
      '<i data-icon=info></i> Only proper pictures are allowed — a clear, ' +
      "recent photo of your face, taken against a plain background. Anything " +
      "else will be declined." +
      "</p>" +
      "</div></div></div>"
    );
  }

  // Draw the picked file onto a canvas capped at PHOTO_MAX_PX and re-encode as
  // JPEG. Doing this in the browser rather than sending the original keeps the
  // stored data URI to a few tens of KB, which is what makes it safe to inline
  // in the record at all.
  function readPhoto(file) {
    return new Promise(function (resolve, reject) {
      if (!file.type || file.type.indexOf("image/") !== 0)
        return reject(new Error("That file is not an image."));
      if (file.size > PHOTO_MAX_BYTES)
        return reject(new Error("That image is too large — pick one under 2 MB."));
      var reader = new FileReader();
      reader.onerror = function () {
        reject(new Error("Could not read that file."));
      };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () {
          reject(new Error("That file could not be opened as an image."));
        };
        img.onload = function () {
          // Square centre crop, so the circular avatar never letterboxes.
          var side = Math.min(img.width, img.height);
          var size = Math.min(side, PHOTO_MAX_PX);
          var canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          canvas
            .getContext("2d")
            .drawImage(
              img,
              (img.width - side) / 2,
              (img.height - side) / 2,
              side,
              side,
              0,
              0,
              size,
              size
            );
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function repaintPhoto() {
    var host = document.getElementById("acct-edit-photo-host");
    if (!host) return;
    host.innerHTML = photoHtml(ORIGINAL && ORIGINAL.photo);
    if (window.hydrateIcons) hydrateIcons(host);
  }

  async function onPhotoPicked(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    showError("");
    try {
      PHOTO_NEXT = await readPhoto(file);
    } catch (err) {
      showError(err.message);
      return;
    }
    repaintPhoto();
  }

  // ── Household ───────────────────────────────────────────────────────
  // The one field a resident genuinely knows better than the clerk typing it
  // in: which house is theirs. It is still a request like every other field,
  // because household membership decides the household's classification, its
  // member count and what prints on a certificate.
  //
  // A SEARCH, not the staff dropdown. That list carries member counts and the
  // household's classification — who in the barangay is a senior, a PWD, a solo
  // parent — which is the last thing to hand a resident about their neighbours.
  // GET /api/households/lookup returns names only, two characters minimum, ten
  // at a time: enough to confirm the name of your own house, not a directory to
  // browse. Household names are unique, so one name is one household.
  //
  // undefined = untouched, { id, name } = a different household picked,
  // null = "I no longer live in the household on record".
  var HOUSEHOLD_NEXT;
  var HOUSEHOLD_RESULTS = [];
  var HOUSEHOLD_TIMER = null;
  var HOUSEHOLD_MIN = 2;

  function householdCurrent(r) {
    return {
      id: r && r.building_id != null ? r.building_id : null,
      name: (r && r.household_name) || "",
    };
  }
  // What the form is currently proposing — the record's own household until
  // something is picked or cleared.
  function householdPicked(r) {
    if (HOUSEHOLD_NEXT === undefined) return householdCurrent(r);
    return HOUSEHOLD_NEXT || { id: null, name: "" };
  }

  function householdHtml(r) {
    var picked = householdPicked(r);
    var current = householdCurrent(r);
    var changed = (picked.id || null) !== (current.id || null);
    return (
      '<div class="form-group form-group-flat">' +
      '<label class="form-label" for="acct-edit-household-q">Household</label>' +
      '<div class="acct-edit-household' + (changed ? " is-changed" : "") + '">' +
      '<div class="acct-edit-household-now">' +
      '<i data-icon=home></i>' +
      "<span>" +
      (picked.id
        ? esc(picked.name || "Building #" + picked.id)
        : '<span class="acct-edit-household-none">No household on record</span>') +
      "</span>" +
      (picked.id
        ? '<button type="button" class="btn btn-sm btn-outline" data-acct-edit="clear-household">Clear</button>'
        : "") +
      (changed
        ? '<button type="button" class="btn btn-sm btn-outline" data-acct-edit="reset-household">Undo</button>'
        : "") +
      "</div>" +
      '<input class="form-control" id="acct-edit-household-q" type="search" autocomplete="off" ' +
      'placeholder="Search your household by name, e.g. Bahay ni Shane" />' +
      '<div class="acct-edit-household-results" id="acct-edit-household-results"></div>' +
      '<p class="acct-edit-household-note"><i data-icon=info></i> ' +
      "If your house is not listed, ask the barangay office to tag it on the map first." +
      "</p>" +
      "</div></div>"
    );
  }

  function householdResultsHtml() {
    if (!HOUSEHOLD_RESULTS.length) return "";
    return HOUSEHOLD_RESULTS.map(function (h) {
      return (
        '<button type="button" class="acct-edit-household-hit" ' +
        'data-acct-edit="pick-household" data-hh-id="' + esc(h.building_id) + '" ' +
        'data-hh-name="' + esc(h.name || "") + '">' +
        esc(h.name || "Building #" + h.building_id) +
        "</button>"
      );
    }).join("");
  }

  function repaintHousehold() {
    var host = document.getElementById("acct-edit-household-host");
    if (!host) return;
    host.innerHTML = householdHtml(ORIGINAL);
    if (window.hydrateIcons) hydrateIcons(host);
  }

  // Debounced: a search per keystroke would be one request per letter for a
  // list that only becomes useful at two characters anyway.
  function onHouseholdSearch(input) {
    var q = String(input.value || "").trim();
    if (HOUSEHOLD_TIMER) clearTimeout(HOUSEHOLD_TIMER);
    var results = document.getElementById("acct-edit-household-results");
    if (q.length < HOUSEHOLD_MIN) {
      HOUSEHOLD_RESULTS = [];
      if (results) results.innerHTML = "";
      return;
    }
    HOUSEHOLD_TIMER = setTimeout(async function () {
      try {
        HOUSEHOLD_RESULTS = await apiGet("/api/households/lookup?q=" + encodeURIComponent(q));
      } catch (e) {
        HOUSEHOLD_RESULTS = [];
      }
      var host = document.getElementById("acct-edit-household-results");
      if (!host) return;
      host.innerHTML =
        householdResultsHtml() ||
        '<div class="acct-edit-household-empty">No household by that name.</div>';
    }, 250);
  }

  function formHtml(r) {
    var rows = '<div id="acct-edit-photo-host">' + photoHtml(r.photo) + "</div>";
    for (var i = 0; i < FIELDS.length; i += 2) {
      var pair = FIELDS.slice(i, i + 2);
      rows +=
        '<div class="form-row form-row-tight">' +
        pair
          .map(function (f) {
            return (
              '<div class="form-group form-group-flat">' +
              '<label class="form-label" for="acct-edit-' + f.key + '">' +
              esc(f.label) + (f.required ? " *" : "") +
              "</label>" +
              inputHtml(f, r[f.key]) +
              "</div>"
            );
          })
          .join("") +
        "</div>";
    }
    return rows + '<div id="acct-edit-household-host">' + householdHtml(r) + "</div>";
  }

  // The resident's own request history — so filing twice, or wondering
  // whether anyone looked at it, doesn't need a phone call to the hall.
  function historyHtml() {
    if (!MY_REQUESTS.length) return "";
    var badge = { pending: "badge-warning", approved: "badge-success", rejected: "badge-danger" };
    return (
      '<div class="acct-edit-history">' +
      '<div class="acct-edit-history-title">Your previous requests</div>' +
      MY_REQUESTS.slice(0, 5)
        .map(function (q) {
          var fields = Object.keys(q.changes || {})
            .map(function (k) {
              return labelFor(k);
            })
            .join(", ");
          return (
            '<div class="acct-edit-history-item">' +
            '<span class="badge ' + (badge[q.status] || "badge-gray") + '">' +
            esc(q.status) + "</span>" +
            '<span class="acct-edit-history-fields">' + esc(fields || "—") + "</span>" +
            '<span class="acct-edit-history-date">' + esc(fmtDate(q.created_at)) + "</span>" +
            (q.status === "rejected" && q.remarks
              ? '<div class="acct-edit-history-remarks">Remarks: ' + esc(q.remarks) + "</div>"
              : "") +
            "</div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function bodyHtml(r) {
    // A pending request blocks a second one — the API refuses it (409), so
    // say that here rather than letting the user retype a whole form first.
    var pending = MY_REQUESTS.filter(function (q) {
      return q.status === "pending";
    })[0];
    if (pending) {
      var fields = Object.keys(pending.changes || {})
        .map(function (k) {
          return labelFor(k);
        })
        .join(", ");
      return (
        '<div class="acct-edit-pending">' +
        '<div class="acct-edit-pending-icon"><i data-icon=clock></i></div>' +
        "<div>" +
        "<strong>You already have a change awaiting review.</strong>" +
        "<p>" + esc(fields || "—") + " · filed " + esc(fmtDate(pending.created_at)) +
        ". You can file another once this one is processed.</p>" +
        "</div></div>" +
        historyHtml()
      );
    }

    return (
      // No help text: the footer button already reads "Submit for approval",
      // which says the same thing at the point it matters.
      formHtml(r) +
      '<div class="form-group form-group-flat">' +
      '<label class="form-label" for="acct-edit-reason">Reason for the change *</label>' +
      '<textarea class="form-control" id="acct-edit-reason" rows="3" ' +
      'placeholder="e.g. I got married in March 2026, so my surname is now Reyes."></textarea>' +
      "</div>" +
      '<div id="acct-edit-error" class="acct-edit-error"></div>' +
      historyHtml()
    );
  }

  function ensureModal() {
    var existing = document.getElementById(MODAL_ID);
    if (existing) return existing;
    var el = document.createElement("div");
    el.className = "modal-backdrop";
    el.id = MODAL_ID;
    el.innerHTML =
      '<div class="modal-box modal-lg">' +
      '<div class="modal-header">' +
      '<div class="modal-title">' +
      '<div class="modal-title-icon"><i data-icon=user></i></div>' +
      "<span>Edit My Details</span>" +
      "</div>" +
      '<button class="modal-close" type="button" data-acct-edit="close"><i data-icon=x></i></button>' +
      "</div>" +
      '<div class="modal-body" id="acct-edit-body"></div>' +
      '<div class="modal-footer" id="acct-edit-footer"></div>' +
      "</div>";
    document.body.appendChild(el);
    el.addEventListener("click", function (e) {
      if (e.target === el) return close();
      var btn = e.target.closest("[data-acct-edit]");
      if (!btn) return;
      var action = btn.getAttribute("data-acct-edit");
      if (action === "close") close();
      else if (action === "submit") submit();
      else if (action === "pick-photo")
        document.getElementById("acct-edit-photo-file").click();
      else if (action === "clear-photo") {
        PHOTO_NEXT = null;
        showError("");
        repaintPhoto();
      } else if (action === "pick-household") {
        HOUSEHOLD_NEXT = {
          id: Number(btn.getAttribute("data-hh-id")),
          name: btn.getAttribute("data-hh-name") || "",
        };
        HOUSEHOLD_RESULTS = [];
        showError("");
        repaintHousehold();
      } else if (action === "clear-household") {
        HOUSEHOLD_NEXT = null;
        HOUSEHOLD_RESULTS = [];
        showError("");
        repaintHousehold();
      } else if (action === "reset-household") {
        HOUSEHOLD_NEXT = undefined;
        HOUSEHOLD_RESULTS = [];
        showError("");
        repaintHousehold();
      }
    });
    // The file input is replaced every time the photo row repaints, so the
    // listener is delegated from the modal rather than bound to the element.
    el.addEventListener("change", function (e) {
      if (e.target && e.target.id === "acct-edit-photo-file") onPhotoPicked(e.target);
    });
    // Likewise the household search box, which the row rewrites on every pick.
    el.addEventListener("input", function (e) {
      if (e.target && e.target.id === "acct-edit-household-q") onHouseholdSearch(e.target);
    });
    return el;
  }

  function footerHtml(canSubmit) {
    return (
      '<button class="btn btn-outline" type="button" data-acct-edit="close">' +
      (canSubmit ? "Cancel" : "Close") +
      "</button>" +
      (canSubmit
        ? '<button class="btn btn-primary" type="button" id="acct-edit-submit" data-acct-edit="submit">' +
          "<i data-icon=inbox></i> Submit for approval</button>"
        : "")
    );
  }

  // ── Open ────────────────────────────────────────────────────────────
  async function open() {
    var s = session();
    if (!s || !s.resident_id) {
      toast(
        "This account is not linked to a resident record, so there are no barangay details to change.",
        "<i data-icon=info></i>"
      );
      return;
    }
    if (typeof apiGet !== "function") {
      toast("Account editing is unavailable on this page.", "<i data-icon=info></i>");
      return;
    }

    var el = ensureModal();
    // Reopening starts from the stored record, not from whatever was picked
    // and then abandoned last time.
    PHOTO_NEXT = undefined;
    HOUSEHOLD_NEXT = undefined;
    HOUSEHOLD_RESULTS = [];
    var body = document.getElementById("acct-edit-body");
    var footer = document.getElementById("acct-edit-footer");
    body.innerHTML = '<p class="acct-edit-loading">Loading your details…</p>';
    footer.innerHTML = footerHtml(false);
    el.classList.add("open");
    document.addEventListener("keydown", onKeydown);
    if (window.hydrateIcons) hydrateIcons(el);

    try {
      // The history is not required for the form to work — a failure there
      // must not cost the resident the ability to file at all.
      var results = await Promise.all([
        apiGet("/api/residents/" + s.resident_id),
        apiGet("/api/edit-requests?resident_id=" + s.resident_id).catch(function () {
          return [];
        }),
      ]);
      ORIGINAL = results[0];
      MY_REQUESTS = Array.isArray(results[1]) ? results[1] : [];
    } catch (err) {
      body.innerHTML =
        '<p class="acct-edit-error">Could not load your details (' +
        esc(err && err.message ? err.message : "error") +
        ").</p>";
      return;
    }

    var blocked = MY_REQUESTS.some(function (q) {
      return q.status === "pending";
    });
    body.innerHTML = bodyHtml(ORIGINAL);
    footer.innerHTML = footerHtml(!blocked);
    if (window.hydrateIcons) hydrateIcons(el);
  }

  function close() {
    var el = document.getElementById(MODAL_ID);
    if (el) el.classList.remove("open");
    document.removeEventListener("keydown", onKeydown);
  }

  function onKeydown(e) {
    if (e.key === "Escape") close();
  }

  // `field` is the id of the control the message is about, when there is one.
  // Naming it turns a sentence at the bottom of a long form into a pointer:
  // the control shakes and takes focus, so the user does not have to read the
  // message and then hunt for what it refers to.
  function showError(msg, field) {
    var el = document.getElementById("acct-edit-error");
    if (el) el.textContent = msg;
    if (!msg || !window.Motion) return;

    // The line itself only animates on the way in, and a second failure often
    // shows the same sentence — replaying it is what makes the repeat visible.
    if (el) Motion.shake(el);
    var control = field && document.getElementById(field);
    if (control) {
      Motion.invalid(control, !String(control.value || "").trim());
      control.scrollIntoView({ block: "nearest" });
      control.focus({ preventScroll: true });
    }
  }

  // ── Submit ──────────────────────────────────────────────────────────
  async function submit() {
    if (!ORIGINAL) return;
    var s = session();
    var btn = document.getElementById("acct-edit-submit");

    // Only the fields that actually differ are sent. Posting the whole form
    // would file a "request" to set every field to what it already is, and
    // staff would have to read ten unchanged rows to find the one edit.
    var changes = {};
    var missingRequired = null;
    var missingKey = null;
    FIELDS.forEach(function (f) {
      var el = document.getElementById("acct-edit-" + f.key);
      if (!el) return;
      var next = norm(el.value);
      if (f.required && !next) {
        missingRequired = missingRequired || f.label;
        missingKey = missingKey || f.key;
      }
      if (next !== norm(ORIGINAL[f.key])) changes[f.key] = next === "" ? null : next;
    });

    // The photo carries its own state — untouched (undefined) contributes
    // nothing, and "Remove" on a resident who never had one is not a change.
    if (PHOTO_NEXT !== undefined && norm(PHOTO_NEXT) !== norm(ORIGINAL.photo))
      changes.photo = PHOTO_NEXT;

    // Same for the household: only an actually different one is a change, so
    // clearing a resident who never had one submits nothing.
    if (HOUSEHOLD_NEXT !== undefined) {
      var nextHousehold = HOUSEHOLD_NEXT ? HOUSEHOLD_NEXT.id : null;
      if ((nextHousehold || null) !== (ORIGINAL.building_id || null))
        changes.building_id = nextHousehold;
    }

    if (missingRequired) {
      showError(
        missingRequired + " cannot be left empty.",
        "acct-edit-" + missingKey
      );
      return;
    }
    if (!Object.keys(changes).length) {
      showError("Nothing has been changed yet — edit a field before submitting.");
      return;
    }

    var reason = (document.getElementById("acct-edit-reason") || {}).value || "";
    reason = reason.trim();
    if (reason.length < REASON_MIN) {
      showError(
        "Please give a reason for the change (at least " + REASON_MIN + " characters).",
        "acct-edit-reason"
      );
      return;
    }

    showError("");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Submitting…";
    }
    try {
      await apiPost("/api/edit-requests", {
        resident_id: s.resident_id,
        account_id: s.account_id || null,
        reason: reason,
        changes: changes,
      });
    } catch (err) {
      showError(err && err.message ? err.message : "Could not submit the request.");
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i data-icon=inbox></i> Submit for approval';
        if (window.hydrateIcons) hydrateIcons(btn);
      }
      return;
    }

    var fieldNames = Object.keys(changes)
      .map(function (k) {
        return labelFor(k);
      })
      .join(", ");
    if (typeof logAudit === "function")
      logAudit(
        "PROFILE_EDIT_REQUEST",
        "Requested changes to own resident record (" + fieldNames + "): " + reason,
        "info",
        "resident"
      );
    close();
    toast("Sent to the barangay office for approval", "<i data-icon=check></i>");
    // A staff member sitting on the Residency page should see it arrive.
    if (typeof refreshNavBadges === "function") refreshNavBadges();
  }

  // ── Session avatar ──────────────────────────────────────────────────
  // Paints the signed-in resident's profile photo into every avatar slot in
  // the chrome — the sidebar user pill, the topbar trigger and the dropdown
  // header — instead of leaving all three on initials.
  //
  // It lives in this file rather than shell.js because the landing page shows
  // the same avatar and does not load shell.js, while both pages already load
  // this one. It is also the file that lets a resident change the photo, so
  // the code that displays it and the code that sets it stay together.
  //
  // The photo is on the resident record, not the session, so it has to be
  // fetched — and this runs on every page load. It is cached in localStorage
  // against the account id, so the common case is a synchronous read; the
  // fetch then confirms or corrects it. Initials render first and are only
  // replaced once a photo is in hand, so a slow or failed fetch costs nothing.
  var AVATAR_CACHE_KEY = "ibmdss.avatar";
  var AVATAR_SLOTS = ["sidebar-avatar", "nav-avatar", "nav-avatar-lg"];

  function readAvatarCache(accountId) {
    try {
      var c = JSON.parse(localStorage.getItem(AVATAR_CACHE_KEY));
      return c && c.account_id === accountId ? c.photo || null : null;
    } catch (e) {
      return null;
    }
  }

  function writeAvatarCache(accountId, photo) {
    try {
      localStorage.setItem(
        AVATAR_CACHE_KEY,
        JSON.stringify({ account_id: accountId, photo: photo || null })
      );
    } catch (e) {
      // Storage full or disabled — it just re-fetches next page load.
    }
  }

  // The slots are <span>s carrying initials. The photo goes on as a background
  // image with .has-photo hiding the text underneath, rather than replacing
  // the element — several places query these ids and they have to survive.
  function paintSessionAvatar(photo) {
    AVATAR_SLOTS.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (photo) {
        el.style.backgroundImage = 'url("' + photo + '")';
        el.classList.add("has-photo");
      } else {
        el.style.backgroundImage = "";
        el.classList.remove("has-photo");
      }
    });
  }

  async function loadSessionAvatar(s) {
    s = s || session();
    if (!s || !s.resident_id) return;
    var cached = readAvatarCache(s.account_id);
    if (cached) paintSessionAvatar(cached);
    if (typeof apiGet !== "function") return;
    try {
      var r = await apiGet("/api/residents/" + s.resident_id);
      var photo = r.photo || null;
      // Repaint even when it comes back null — a photo that was removed has
      // to fall back to initials, not sit cached forever.
      if (photo !== cached) {
        paintSessionAvatar(photo);
        writeAvatarCache(s.account_id, photo);
      }
    } catch (e) {
      // Offline — whatever was cached stays on screen.
    }
  }

  function clearSessionAvatarCache() {
    try {
      localStorage.removeItem(AVATAR_CACHE_KEY);
    } catch (e) {
      /* best-effort */
    }
    paintSessionAvatar(null);
  }

  window.loadSessionAvatar = loadSessionAvatar;
  window.clearSessionAvatarCache = clearSessionAvatarCache;

  window.openAccountEdit = open;
  window.closeAccountEdit = close;
  // Settings uses this to decide between an active row and a disabled one.
  window.accountEditAvailable = function () {
    var s = session();
    return !!(s && s.resident_id && typeof apiGet === "function");
  };
})();
