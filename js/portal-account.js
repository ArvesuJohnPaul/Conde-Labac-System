// js/portal-account.js — signed-in account features, shared by the landing
// page (index.html) and the MIS pages. Loaded LAST on purpose: it upgrades
// the older demo handlers (fake submitCertificate/submitFeedback/toggleNotif)
// to real API-backed versions, and injects the account panels:
//   • My Information — the resident's full record (GET /api/residents/:id)
//   • My Activity    — everything this account has sent the barangay:
//                      certificate requests, profile change requests, incident
//                      reports and feedback, in one list, newest first
//   • Notifications  — /api/notifications feed with unread badge + polling
//
// Everything reads the session from localStorage (ibmdss.session) and calls
// the same API the mobile app uses. All functions are defensive: signed-out
// users get a friendly "sign in first" message instead of errors.
(function () {
  "use strict";

  // ── helpers ────────────────────────────────────────────────────────────
  function session() {
    try {
      return JSON.parse(localStorage.getItem("ibmdss.session"));
    } catch (e) {
      return null;
    }
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
  }

  function fmtDate(d) {
    if (!d) return "—";
    const dt = new Date(typeof d === "string" && d.length === 10 ? d + "T00:00:00" : d);
    return isNaN(dt)
      ? String(d)
      : dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
  }

  function toast(msg, icon) {
    if (typeof showToast === "function") showToast(msg, icon || "<i data-icon=check></i>");
  }

  // Validation feedback goes on the field: it shakes, turns amber and says
  // what is missing under its own label (Motion.require, js/motion.js). These
  // two shims keep working — as the old window.alert() — on a page where
  // motion.js is not loaded, so validation can never disappear entirely.
  function requireFields(fields, fallbackMessage) {
    if (window.Motion) return Motion.require(fields);
    const empty = fields.some((f) => {
      const el = document.getElementById(typeof f === "string" ? f : f.id);
      return el && !String(el.value || "").trim();
    });
    if (empty) alert(fallbackMessage);
    return !empty;
  }

  // For a field that is filled in but rejected — usually by the server.
  function rejectField(id, message) {
    if (window.Motion) Motion.reject(id, message);
    else alert(message);
  }

  function hydrate(el) {
    if (typeof hydrateIcons === "function") hydrateIcons(el);
    else if (typeof window.renderIcons === "function") window.renderIcons(el);
  }

  function api(method, path, body) {
    if (typeof apiRequest === "function") return apiRequest(method, path, body);
    // api.js not loaded on this page — degrade gracefully.
    return Promise.reject(new Error("API helper not loaded on this page."));
  }
  const get = (p) => api("GET", p);
  const post = (p, b) => api("POST", p, b);

  const CAT_LABELS = {
    senior: "Senior Citizen",
    pwd: "PWD",
    "solo-parent": "Solo Parent",
    indigent: "Indigent Family",
  };

  // The certificate list is loaded by js/certificate-types.js (before this
  // file) from the barangay's own definitions. These are the same array and
  // object it fills in place, so they are current whenever they are read.
  const CERT_TYPE_OPTIONS = window.CERT_TYPE_OPTIONS || [];
  const CERT_LABELS = window.CERT_TYPE_LABELS || {};

  // label -> slug, including the short labels the older hardcoded type cards
  // used, so a stale page still resolves to the right type.
  function certSlugForName(name) {
    if (name === "Certificate of Residency") return "residency";
    const t = CERT_TYPE_OPTIONS.find((x) => x.label === name || x.short === name);
    return t ? t.slug : "";
  }

  // Fill in the picker wherever the service modal exists. Called on load, so
  // the pages themselves only need the empty <div id="cert-type-grid">.
  //
  // A dropdown rather than a card per type: fifteen cards is a wall to read
  // through, and the list only grows as the barangay adds forms.
  //
  // Runs again whenever the list (re)loads. The choice already made is kept if
  // that certificate is still offered, so a reload never swaps the type out
  // from under someone mid-request.
  function renderCertTypeGrid() {
    const grid = document.getElementById("cert-type-grid");
    if (!grid) return;
    const previous = document.getElementById("cert-type-select")?.value || "";
    // The container is a CSS grid meant for cards; one full-width control.
    grid.style.display = "block";
    grid.innerHTML = CERT_TYPE_OPTIONS.length
      ? '<select class="form-control" id="cert-type-select"' +
        ' onchange="certTypeChanged(this)">' +
        CERT_TYPE_OPTIONS.map(function (t) {
          return `<option value="${esc(t.slug)}">${esc(t.label)}</option>`;
        }).join("") +
        "</select>"
      : '<select class="form-control" id="cert-type-select" disabled><option value="">' +
        (window.certTypesLoadError
          ? "Could not load the list of certificates — check your connection and reopen this form."
          : "Loading certificates…") +
        "</option></select>";
    const sel = document.getElementById("cert-type-select");
    if (previous && CERT_TYPE_OPTIONS.some((t) => t.slug === previous)) sel.value = previous;
    // The "Selected: …" badge only existed because the cards were hard to read
    // at a glance; the dropdown states the choice itself. Reuse its slot for the
    // requirement list, which does change with the selection.
    const badge = document.getElementById("cert-selected-badge");
    if (badge) {
      badge.style.display = "none";
      if (!document.getElementById("cert-requirements")) {
        const reqs = document.createElement("div");
        reqs.id = "cert-requirements";
        reqs.style.marginBottom = "8px";
        badge.parentNode.insertBefore(reqs, badge.nextSibling);
      }
    }
    // Redrawing the requirement list drops any files already chosen, so while
    // the form is open it is only redrawn if the selection itself changed.
    const open = document.getElementById("modal-certificates")?.classList.contains("open");
    if (!open || sel.value !== previous) certTypeChanged(sel);
  }

  // Keeps the legacy `selectedCert` global in step with the dropdown. The real
  // submit path reads the slug straight off the <select>.
  window.certTypeChanged = function (sel) {
    if (!sel) return;
    const label = CERT_LABELS[sel.value] || sel.value;
    // shell.js / index.html declare `selectedCert` with a top-level let, which
    // is not a window property — and this file runs strict, so a missing
    // binding throws rather than quietly creating a global.
    try {
      selectedCert = label;
    } catch (_) {
      /* page without the demo global */
    }
    // Each certificate asks for different documents.
    if (typeof certRenderRequirements === "function")
      certRenderRequirements(sel.value);
  };

  const CERT_BADGES = {
    pending: "badge-warning",
    approved: "badge-info",
    issued: "badge-success",
    rejected: "badge-danger",
  };

  // ── real certificate submission (replaces the demo handler) ───────────
  // Reads the modal's DOM directly (the selected type card, the fields), so
  // it works with both index.html's and shell.js's copies of the modal.
  function selectedCertName() {
    const el = document.querySelector(".cert-type-card.selected .cert-name");
    return (el && el.textContent.trim()) || (CERT_TYPE_OPTIONS[0] || {}).short || "";
  }

  // The dropdown's value *is* the slug. The card lookups behind it are there
  // for any page still showing the old hardcoded type cards.
  function selectedCertSlug() {
    const sel = document.getElementById("cert-type-select");
    if (sel && sel.value) return sel.value;
    const card = document.querySelector(".cert-type-card.selected");
    return (
      (card && card.dataset.slug) ||
      certSlugForName(selectedCertName()) ||
      (CERT_TYPE_OPTIONS[0] || {}).slug ||
      ""
    );
  }

  window.submitCertificate = async function () {
    const val = (id) => (document.getElementById(id)?.value || "").trim();
    if (
      !requireFields(
        ["cert-fname", "cert-lname"],
        "Please enter your first and last name."
      )
    )
      return;
    const fname = val("cert-fname");
    const lname = val("cert-lname");
    const type = selectedCertSlug();
    if (!type) {
      toast(
        "The list of certificates has not loaded — check your connection and try again.",
        "<i data-icon=triangle-alert></i>"
      );
      return;
    }
    const certName = CERT_LABELS[type] || selectedCertName();
    // Extra details ride along in `purpose` — the certificate table keeps a
    // single free-text purpose column (same convention as the mobile app).
    const extras = [
      val("cert-purpose"),
      val("cert-contact") && "Contact: " + val("cert-contact"),
      val("cert-pickup") && "Preferred pickup: " + fmtDate(val("cert-pickup")),
      val("cert-purok") && "Address: " + val("cert-purok"),
    ]
      .filter(Boolean)
      .join(" · ");

    // Missing requirements are a warning, not a wall: a walk-in can still bring
    // the paper to the hall, and the barangay would rather have the request in
    // the queue than turned away at the form.
    //
    // Asked through uiConfirm() rather than window.confirm() — the last raw
    // browser dialog in this submit path, and the same reason the rest of the
    // system stopped using them: it cannot carry the barangay's styling, it
    // cannot show the list as a list, and it names the page's origin in the
    // title bar as though the request were coming from somewhere else.
    //
    // uiConfirm() lives in js/ui-modals.js. It used to be in js/shell.js, which
    // the landing page does not load, so this question was silently skipped
    // there — and a resident filing from the front page was never asked. The
    // plain confirm() fallback is there so that can't happen quietly again.
    if (typeof certMissingRequirements === "function") {
      const missing = certMissingRequirements(type);
      if (missing.length) {
        const go =
          typeof uiConfirm === "function"
            ? await uiConfirm({
                icon: "triangle-alert",
                tone: "accent",
                title: "Submit without these documents?",
                message:
                  "You can still file the request now and bring the missing documents " +
                  "to the barangay hall — processing is just faster with them attached.",
                notes: missing.map((m) => ({ icon: "file-text", text: m })),
                confirmLabel: "Submit anyway",
                confirmIcon: "check",
                cancelLabel: "Attach them first",
              })
            : window.confirm(
                "These required documents are not attached:\n\n• " +
                  missing.join("\n• ") +
                  "\n\nSubmit the request anyway?"
              );
        if (!go) return;
      }
    }

    const s = session();
    let res;
    try {
      res = await post("/api/certificates", {
        type: type,
        applicant_name: lname + ", " + fname,
        purpose: extras || null,
        resident_id: s?.resident_id || null,
        account_id: s?.account_id || null,
      });
    } catch (err) {
      // The form stays open with everything the user typed still in it, and
      // the submit button shakes to say the press did not take.
      toast("Could not submit the request: " + err.message, "<i data-icon=triangle-alert></i>");
      if (window.Motion) Motion.shakeBox(document.getElementById("modal-certificates"));
      return;
    }

    // Documents can only be attached once the request exists to hold them. A
    // failed upload is reported but never undoes the filing.
    if (typeof certAttachPending === "function") {
      const failed = await certAttachPending(res.id, s?.account_id);
      // The filing itself succeeded, so this is a notice rather than a
      // failure — and it must not be a modal one, because there is nothing
      // for the user to decide.
      if (failed.length)
        toast(
          "Filed as " +
            res.request_no +
            ", but " +
            failed.length +
            (failed.length === 1 ? " document" : " documents") +
            " did not upload — bring them to the barangay hall instead.",
          "<i data-icon=triangle-alert></i>"
        );
    }

    // Filed — so the form goes back to blank. Otherwise the next time it is
    // opened it still holds this request, and pressing Submit again would file
    // it a second time.
    resetCertificateForm();
    if (typeof closeServiceModal === "function") closeServiceModal("certificates");
    if (typeof logAudit === "function")
      logAudit(
        "CERT_REQUEST",
        `${certName} requested by ${fname} ${lname} (Ref: ${res.request_no})`,
        "info",
        "certificate"
      );
    toast(`${certName} request submitted! Ref: ${res.request_no}`, "<i data-icon=file-text></i>");

    // Show the requester the actual form so they can fill in the blanks only
    // they know (relation, employer, purpose wording). What they type saves to
    // certificate.form_fields, so the barangay prints their words rather than
    // guessing. Skipped when the export machinery isn't on the page, or when
    // this certificate type has no printable form yet.
    //
    // Either way the requester ends on a note saying where the request lives
    // from here on — after they close the sheet, or straight away when there
    // is no sheet to show.
    const pointToActivity = () => showSubmittedNotice(certName, res.request_no);
    if (
      typeof certOpenSheet === "function" &&
      typeof certHasTemplate === "function" &&
      certHasTemplate(type)
    ) {
      // POST returns the row, but not the joined columns the details panel
      // shows — and an older server returns fewer columns still. Everything the
      // sheet needs is already known here, so seed it all and let the response
      // override only what it actually carries.
      certOpenSheet(
        Object.assign(
          {
            type: type,
            applicant_name: lname + ", " + fname,
            purpose: extras || null,
            status: "pending",
            created_at: new Date().toISOString(),
            resident_id: s?.resident_id || null,
            processed_by_name: null,
            processed_at: null,
            remarks: null,
            form_fields: null,
          },
          res
        ),
        { mode: "requester", onClose: pointToActivity }
      );
    } else {
      pointToActivity();
    }
  };

  // Back to a blank form: every field emptied, the type back to the first in
  // the list (which redraws its requirement list and drops any chosen files),
  // and last time's validation marks cleared. The resident's own details come
  // back on the next open — openServicePopup() refills them from their record.
  function resetCertificateForm() {
    const modal = document.getElementById("modal-certificates");
    if (!modal) return;
    modal.querySelectorAll("input, textarea").forEach((el) => (el.value = ""));
    modal.querySelectorAll("select").forEach((el) => (el.selectedIndex = 0));
    window.certTypeChanged(document.getElementById("cert-type-select"));
    if (window.Motion) Motion.clearErrors(modal);
  }

  // The last word after filing: the request is in, and My Activity is where to
  // find it again. Offers to go straight there.
  function showSubmittedNotice(certName, requestNo) {
    if (typeof uiConfirm !== "function") return;
    uiConfirm({
      tone: "accent",
      icon: "inbox",
      title: "Your request has been submitted",
      message:
        "To view the certificate request you submitted — its status, details and " +
        "documents — go to My Activity in your account menu.",
      target: { icon: "file-text", label: certName + " · " + requestNo },
      confirmLabel: "Open My Activity",
      confirmIcon: "inbox",
      cancelLabel: "Close",
    }).then((go) => {
      if (go) window.openMyActivity();
    });
  }

  // Auto-fill the request form from the signed-in resident's record.
  async function prefillCertificateForm() {
    const s = session();
    if (!s || !s.resident_id) return;
    let r;
    try {
      r = await get("/api/residents/" + s.resident_id);
    } catch (e) {
      return; // best-effort — the blank form still works
    }
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el && !el.value && v) el.value = v;
    };
    set("cert-fname", r.first_name);
    set("cert-lname", r.last_name);
    set("cert-dob", r.birthdate);
    set("cert-contact", r.contact_no);
    const purokSel = document.getElementById("cert-purok");
    if (purokSel && r.purok) {
      for (const opt of purokSel.options) {
        if (opt.value.indexOf(r.purok) === 0) {
          purokSel.value = opt.value;
          break;
        }
      }
    }
  }

  // Wrap openServicePopup so opening the certificate modal auto-fills it.
  if (typeof window.openServicePopup === "function") {
    const _open = window.openServicePopup;
    window.openServicePopup = function (service) {
      _open(service);
      if (service === "certificates") prefillCertificateForm();
    };
  }

  // ── real feedback submission (replaces the demo handler) ──────────────
  window.submitFeedback = async function () {
    // How many stars are lit IS the rating — there is no default. This used to
    // read `.length || 4`, so a resident who never touched the control had
    // their submission filed as four stars: an opinion they never gave,
    // counted into the barangay's average rating and into the sentiment split
    // beside it. Now an untouched row is 0, and 0 is refused below.
    const rating = document.querySelectorAll(".star.active").length;
    // The star row is a <div>, so the validation helpers can only see it
    // through a `.value` (setRating writes one). Set it from what is lit right
    // here as well, so the check below can never disagree with the number that
    // would be submitted — whichever copy of setRating the page happens to be
    // running.
    const starBox = document.getElementById("star-rating");
    if (starBox) starBox.value = rating ? String(rating) : "";
    if (
      !requireFields(
        [
          { id: "star-rating", message: "Choose a star rating — one to five." },
          { id: "fb-comment", message: "Tell us what you would like to say." },
        ],
        "Please choose a star rating and enter a comment."
      )
    )
      return;
    const comment = (document.getElementById("fb-comment")?.value || "").trim();
    const category = document.getElementById("fb-category")?.value || "Other";
    const name = (document.getElementById("fb-name")?.value || "").trim();
    const contact = (document.getElementById("fb-contact")?.value || "").trim();
    const s = session();
    try {
      await post("/api/feedback", {
        rating: rating,
        category: category,
        comment: comment,
        name: name,
        contact: contact || null,
        account_id: s?.account_id || null,
      });
    } catch (err) {
      toast("Could not submit feedback: " + err.message, "<i data-icon=triangle-alert></i>");
      if (window.Motion) Motion.shakeBox(document.getElementById("modal-feedback"));
      return;
    }
    // Keep the local store in sync so the staff Feedback page's "Recent" list
    // (still localStorage-backed) shows it immediately too.
    if (window.FeedbackStore)
      FeedbackStore.add({ rating, category, comment, name, contact });
    if (typeof closeServiceModal === "function") closeServiceModal("feedback");
    // Back to no stars, so the next person at a shared terminal is not handed
    // the last one's rating. This handler replaces the shell's, so the reset
    // it does has to happen here too.
    if (typeof resetRating === "function") resetRating();
    if (typeof logAudit === "function")
      logAudit("FEEDBACK_SUBMIT", `Feedback submitted — rated ${rating}/5`, "info", "feedback");
    if (typeof refreshRecentFeedback === "function") refreshRecentFeedback();
    toast("Feedback submitted! Thank you for your input.", "<i data-icon=message-square></i>");
  };

  // The live resident-search override for index.html used to sit here. The
  // search it backed — a public lookup over every resident record — was
  // removed on data-privacy grounds, along with its modal and both entry
  // points, so there is nothing left to override.

  // ── account panels (injected modals) ───────────────────────────────────
  function ensurePanels() {
    if (document.getElementById("modal-acct-info")) return;
    const wrap = document.createElement("div");
    // acct-detail comes last so it stacks above My Activity, which opens it.
    wrap.innerHTML = ["acct-info", "acct-activity", "acct-notifs", "acct-detail"]
      .map(
        (key) => `
      <div class="modal-backdrop" id="modal-${key}" onclick="closeServiceModal('${key}', event)">
        <div class="modal-box">
          <div class="modal-header">
            <div class="modal-title"><div class="modal-title-icon" id="${key}-icon"><i data-icon="${
              {
                "acct-info": "user",
                "acct-activity": "inbox",
                "acct-notifs": "bell",
                "acct-detail": "file-text",
              }[key]
            }"></i></div> <span id="${key}-title"></span></div>
            <button class="modal-close" onclick="closeServiceModal('${key}')"><i data-icon=x></i></button>
          </div>
          <div class="modal-body" id="${key}-body"></div>
          <div class="modal-footer">
            <button class="btn btn-outline" onclick="closeServiceModal('${key}')">Close</button>
          </div>
        </div>
      </div>`
      )
      .join("");
    document.body.appendChild(wrap);
    hydrate(wrap);
  }

  function openPanel(key, title, render) {
    ensurePanels();
    document.getElementById(key + "-title").textContent = title;
    const body = document.getElementById(key + "-body");
    const s = session();
    if (!s) {
      body.innerHTML =
        '<div class="alert alert-info"><span class="alert-icon"><i data-icon=info></i></span> Please sign in first to view this.</div>';
    } else {
      body.innerHTML =
        '<p class="table-muted" style="text-align:center;padding:24px">Loading…</p>';
      render(body, s);
    }
    document.getElementById("modal-" + key).classList.add("open");
    hydrate(body);
  }

  const row = (label, value) => `
    <div style="display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid rgba(0,0,0,.06)">
      <span class="table-muted" style="flex-shrink:0">${label}</span>
      <span style="text-align:right;font-weight:500">${value}</span>
    </div>`;
  const dash = '<span class="table-muted">—</span>';
  const v = (x) => (x == null || x === "" ? dash : esc(x));

  // My Information — account details + (for residents) the full record.
  window.openMyInfo = function () {
    openPanel("acct-info", "My Information", async (body, s) => {
      const accountBlock =
        `<div style="font-weight:700;font-size:13px;letter-spacing:.4px;color:var(--navy,#0b1d3a);margin-bottom:4px">ACCOUNT</div>` +
        row("Name", v(s.displayName)) +
        row("Email", v(s.user)) +
        row("Role", v(s.role));
      if (!s.resident_id) {
        body.innerHTML =
          accountBlock +
          `<p class="modal-help-text" style="margin-top:12px">This account is not linked to a resident record — staff accounts only carry the details above.</p>`;
        return;
      }
      let r;
      try {
        r = await get("/api/residents/" + s.resident_id);
      } catch (err) {
        body.innerHTML =
          accountBlock +
          `<div class="alert alert-warning" style="margin-top:12px"><span class="alert-icon"><i data-icon=triangle-alert></i></span> Could not load your barangay record (${esc(err.message)}).</div>`;
        hydrate(body);
        return;
      }
      const fullName =
        `${r.last_name}, ${r.first_name}` +
        (r.middle_name ? " " + r.middle_name[0] + "." : "") +
        (r.suffix ? " " + r.suffix : "");
      const cats = (r.classifications || [])
        .map((c) => `<span class="badge badge-gold">${esc(CAT_LABELS[c] || c)}</span>`)
        .join(" ");
      body.innerHTML =
        accountBlock +
        `<div style="font-weight:700;font-size:13px;letter-spacing:.4px;color:var(--navy,#0b1d3a);margin:16px 0 4px">BARANGAY RECORD</div>` +
        row("Full Name", esc(fullName)) +
        row("Age", r.age == null ? dash : r.age + " yrs") +
        row("Birthdate", v(fmtDate(r.birthdate))) +
        row("Sex", r.sex === "M" ? "Male" : r.sex === "F" ? "Female" : dash) +
        row("Civil Status", v(r.civil_status)) +
        row("Contact No.", v(r.contact_no)) +
        row("Occupation", v(r.occupation)) +
        row("Voter Status", v(r.voter_status)) +
        row("Purok", v(r.purok)) +
        row("Address", v(r.address_text)) +
        // Named, not numbered: a household is a building tagged on the GIS
        // map ("Bahay ni Shane"), so it has no household number.
        row("Household", v(r.household_name)) +
        row("Classifications", cats || dash) +
        row("Date Registered", v(fmtDate(r.date_registered)));
    });
  };

  // ── My Activity ─────────────────────────────────────────────────────────
  // One panel, four sources. "My Requests" and "Activity History" used to be
  // separate menu entries, which meant a resident chasing "what did I send the
  // barangay, and what happened to it?" had to check two places and hold the
  // dates in their head to interleave them. It is one question, so it is one
  // list — everything this account has sent in, newest first:
  //
  //   • certificate requests   GET /api/certificates?resident_id=
  //   • profile edit requests  GET /api/edit-requests?resident_id=
  //   • incident reports       GET /api/incidents?complainant_id=
  //   • feedback given         GET /api/feedback (filtered to this account)
  //
  // Each source is fetched independently and a failure in one is shown as a
  // note rather than replacing the whole panel — a feedback endpoint being
  // down must not hide the certificate you are trying to track.
  const EDIT_REQ_FIELD_LABELS = {
    last_name: "Last Name",
    first_name: "First Name",
    middle_name: "Middle Name",
    suffix: "Suffix",
    birthdate: "Birthdate",
    sex: "Sex",
    civil_status: "Civil Status",
    contact_no: "Contact No.",
    occupation: "Occupation",
    voter_status: "Voter Status",
    photo: "Profile Photo",
  };

  const EDIT_REQ_BADGES = {
    pending: "badge-warning",
    approved: "badge-success",
    rejected: "badge-danger",
  };

  async function collectMyActivity(s) {
    const items = [];
    const failed = [];

    async function pull(label, fn) {
      try {
        await fn();
      } catch (e) {
        failed.push(label);
      }
    }

    await Promise.all([
      s.resident_id &&
        pull("certificate requests", async () => {
          const rows = await get("/api/certificates?resident_id=" + s.resident_id);
          rows.forEach((r) => {
            items.push({
              ts: new Date(r.created_at).getTime(),
              icon: "file-text",
              title: CERT_LABELS[r.type] || r.type,
              ref: r.request_no,
              sub: [r.purpose, r.remarks ? "Remarks: " + r.remarks : ""]
                .filter(Boolean)
                .join(" · "),
              badge: r.status.charAt(0).toUpperCase() + r.status.slice(1),
              badgeClass: CERT_BADGES[r.status] || "badge-gray",
              view: () => viewCertificateRequest(r),
            });
          });
        }),
      s.resident_id &&
        pull("profile change requests", async () => {
          const rows = await get("/api/edit-requests?resident_id=" + s.resident_id);
          rows.forEach((r) => {
            const fields = Object.keys(r.changes || {})
              .map((k) => EDIT_REQ_FIELD_LABELS[k] || k)
              .join(", ");
            items.push({
              ts: new Date(r.created_at).getTime(),
              icon: "user",
              title: "Profile change: " + (fields || "—"),
              // The reason the resident gave is the useful line here — it is
              // what staff are deciding on. A rejection's remarks replace it,
              // because that is the part that says what to do next.
              sub:
                r.status === "rejected" && r.remarks
                  ? "Remarks: " + r.remarks
                  : r.reason || "",
              badge: r.status.charAt(0).toUpperCase() + r.status.slice(1),
              badgeClass: EDIT_REQ_BADGES[r.status] || "badge-gray",
            });
          });
        }),
      s.resident_id &&
        pull("incident reports", async () => {
          const rows = await get("/api/incidents?complainant_id=" + s.resident_id);
          rows.forEach((i) => {
            const st = incidentStatus(i.status);
            items.push({
              ts: new Date(i.created_at).getTime(),
              icon: "siren",
              title: "Reported: " + (i.title || i.report_type),
              ref: i.case_no,
              sub: i.narration || "",
              badge: st.label,
              badgeClass: st.badge,
              view: () => viewIncidentReport(i),
            });
          });
        }),
      s.account_id &&
        pull("feedback", async () => {
          const rows = await get("/api/feedback");
          rows
            .filter((f) => f.account_id === s.account_id)
            .forEach((f) => {
              items.push({
                ts: new Date(f.created_at).getTime(),
                icon: "message-square",
                title: "Feedback: " + (f.category || "Other"),
                sub: f.comment || "(no comment)",
                badge: (f.rating || 0) + "★",
                badgeClass: "badge-gold",
                view: () => viewFeedback(f),
              });
            });
        }),
    ].filter(Boolean));

    items.sort((a, b) => b.ts - a.ts);
    return { items, failed };
  }

  // ── My Activity: View ───────────────────────────────────────────────────
  // What the resident actually sent, in full — the list only has room for one
  // line of it.
  const INCIDENT_STATUSES = {
    open: { label: "Open", badge: "badge-warning" },
    "under-review": { label: "Under review", badge: "badge-info" },
    resolved: { label: "Resolved", badge: "badge-success" },
    dismissed: { label: "Dismissed", badge: "badge-gray" },
  };

  function incidentStatus(status) {
    return INCIDENT_STATUSES[status] || { label: status || "Open", badge: "badge-gray" };
  }

  // Only the resident-facing states. The AI triage columns on a feedback row
  // (sentiment, urgency, alerts) are staff working notes, not part of what the
  // resident submitted, so they are never shown here.
  const FEEDBACK_STATUSES = {
    new: { label: "Received", badge: "badge-info" },
    reviewed: { label: "Reviewed", badge: "badge-success" },
    archived: { label: "Archived", badge: "badge-gray" },
  };

  // row() right-aligns its value, which suits a date and not a paragraph.
  const detailHeading = (text) =>
    `<div style="margin:16px 0 6px;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted,#6b7280)">${esc(text)}</div>`;
  const detailText = (text) =>
    `<p style="margin:0;white-space:pre-wrap;line-height:1.6">${text ? esc(text) : dash}</p>`;
  const badgeHtml = (st) => `<span class="badge ${st.badge}">${esc(st.label)}</span>`;

  function openActivityDetail(title, icon, html) {
    ensurePanels();
    document.getElementById("acct-detail-title").textContent = title;
    document.getElementById("acct-detail-icon").innerHTML = `<i data-icon="${icon}"></i>`;
    document.getElementById("acct-detail-body").innerHTML = html;
    const modal = document.getElementById("modal-acct-detail");
    modal.classList.add("open");
    hydrate(modal);
  }

  // A certificate request opens the same Certificate Request window the
  // resident saw after filing — details (unfolded, since they are why it was
  // opened), the documents they attached, and the form as it will print.
  function viewCertificateRequest(r) {
    if (typeof certOpenSheet === "function") {
      certOpenSheet(r, { mode: "requester", openDetails: true });
      return;
    }
    const st = { label: r.status, badge: CERT_BADGES[r.status] || "badge-gray" };
    openActivityDetail(
      CERT_LABELS[r.type] || r.type,
      "file-text",
      row("Request No.", `<span class="table-mono">${esc(r.request_no)}</span>`) +
        row("Status", badgeHtml(st)) +
        row("Applicant", v(r.applicant_name)) +
        row("Filed", v(fmtDate(r.created_at))) +
        row("Remarks", v(r.remarks)) +
        detailHeading("Purpose / Details") +
        detailText(r.purpose)
    );
  }

  function viewIncidentReport(i) {
    const hasPin = i.lat != null && i.lng != null;
    openActivityDetail(
      i.title || "Incident Report",
      "siren",
      row("Case No.", i.case_no ? `<span class="table-mono">${esc(i.case_no)}</span>` : dash) +
        row("Status", badgeHtml(incidentStatus(i.status))) +
        row("Filed", v(fmtDate(i.created_at))) +
        (i.resolved_at ? row("Closed", v(fmtDate(i.resolved_at))) : "") +
        row("Complainant", v(i.complainant_name)) +
        row("Contact No.", v(i.contact)) +
        row("Respondent", v(i.respondent)) +
        row("Witnesses", v(i.witnesses)) +
        row(
          "Location pinned",
          hasPin
            ? `<span class="table-mono">${Number(i.lat).toFixed(5)}, ${Number(i.lng).toFixed(5)}</span>`
            : dash
        ) +
        detailHeading("What happened") +
        detailText(i.narration)
    );
  }

  function viewFeedback(f) {
    const rating = Math.max(0, Math.min(5, Number(f.rating) || 0));
    openActivityDetail(
      "Feedback: " + (f.category || "Other"),
      "message-square",
      row(
        "Rating",
        `<span style="color:var(--gold-500,#d4a017);letter-spacing:1px">${"★".repeat(rating)}${"☆".repeat(5 - rating)}</span> ${rating}/5`
      ) +
        row("Category", v(f.category)) +
        row("Status", badgeHtml(FEEDBACK_STATUSES[f.status] || { label: f.status || "Received", badge: "badge-gray" })) +
        row("Submitted", v(fmtDate(f.created_at))) +
        row("Name", v(f.name || "Anonymous")) +
        row("Contact", v(f.contact)) +
        detailHeading("Comment") +
        detailText(f.comment)
    );
  }

  // The rows of the panel currently on screen, so a View button can find the
  // record behind it by index.
  let ACTIVITY_ITEMS = [];
  window.acctViewActivity = function (index) {
    const a = ACTIVITY_ITEMS[index];
    if (a && a.view) a.view();
  };

  window.openMyActivity = function () {
    openPanel("acct-activity", "My Activity", async (body, s) => {
      if (!s.account_id && !s.resident_id) {
        body.innerHTML =
          '<div class="alert alert-info"><span class="alert-icon"><i data-icon=info></i></span> Your session is missing its account link — please sign out and sign back in.</div>';
        hydrate(body);
        return;
      }
      const { items, failed } = await collectMyActivity(s);
      ACTIVITY_ITEMS = items;
      const note = failed.length
        ? `<div class="alert alert-warning"><span class="alert-icon"><i data-icon=triangle-alert></i></span> Could not load your ${esc(failed.join(" or "))}.</div>`
        : "";
      if (!items.length) {
        body.innerHTML =
          note ||
          '<p class="table-muted" style="text-align:center;padding:24px">Nothing yet. Certificates you request, changes you propose to your details, incidents you report, and feedback you send all appear here.</p>';
        hydrate(body);
        return;
      }
      body.innerHTML =
        note +
        items
          .map(
            (a, idx) => `
        <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid rgba(0,0,0,.06)">
          <div style="flex-shrink:0;width:32px;height:32px;border-radius:8px;background:rgba(11,29,58,.08);display:flex;align-items:center;justify-content:center"><i data-icon=${a.icon}></i></div>
          <div style="min-width:0;flex:1">
            <div style="font-weight:700">${esc(a.title)}</div>
            ${a.ref ? `<div class="table-mono" style="font-size:11px;color:#6b7280">${esc(a.ref)}</div>` : ""}
            ${a.sub ? `<div class="table-muted" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.sub)}</div>` : ""}
            <div style="margin-top:4px;display:flex;gap:8px;align-items:center">
              <span class="badge ${a.badgeClass}">${esc(a.badge)}</span>
              <span class="table-muted" style="font-size:11px">${fmtDate(a.ts)}</span>
            </div>
          </div>
          ${
            a.view
              ? `<button type="button" class="btn btn-sm btn-outline" style="align-self:center;flex-shrink:0" onclick="acctViewActivity(${idx})"><i data-icon=eye></i> View</button>`
              : ""
          }
        </div>`
          )
          .join("");
      hydrate(body);
    });
  };

  // The two menu entries this replaced. Kept as aliases so any page, cached
  // markup or translation file still pointing at the old names opens the
  // merged panel rather than throwing.
  window.openMyRequests = window.openMyActivity;
  window.openActivityHistory = window.openMyActivity;

  // ── notifications ───────────────────────────────────────────────────────
  const NOTIF_ICONS = { certificate: "file-text", message: "mail", system: "info" };
  let unreadCount = 0;

  function paintUnread() {
    // MIS topbar dot
    const dot = document.getElementById("notif-dot");
    if (dot) dot.style.display = unreadCount > 0 ? "" : "none";
    // index.html dropdown badge
    const badge = document.getElementById("nav-notif-badge");
    if (badge) {
      badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
      badge.style.display = unreadCount > 0 ? "inline-flex" : "none";
    }
  }

  async function refreshUnread() {
    const s = session();
    if (!s || !s.account_id) {
      unreadCount = 0;
      paintUnread();
      return;
    }
    try {
      const rows = await get("/api/notifications?account_id=" + s.account_id + "&limit=100");
      unreadCount = rows.filter((n) => !n.is_read).length;
    } catch (e) {
      /* offline — keep the last known count */
    }
    paintUnread();
  }

  window.openNotifications = function () {
    openPanel("acct-notifs", "Notifications", async (body, s) => {
      if (!s.account_id) {
        body.innerHTML =
          '<div class="alert alert-info"><span class="alert-icon"><i data-icon=info></i></span> Your session is missing its account link — please sign out and sign back in to enable notifications.</div>';
        return;
      }
      let rows;
      try {
        rows = await get("/api/notifications?account_id=" + s.account_id + "&limit=100");
      } catch (err) {
        body.innerHTML = `<div class="alert alert-warning"><span class="alert-icon"><i data-icon=triangle-alert></i></span> Could not load notifications (${esc(err.message)}).</div>`;
        hydrate(body);
        return;
      }
      if (!rows.length) {
        body.innerHTML =
          '<p class="table-muted" style="text-align:center;padding:24px">Nothing here yet. Updates on your requests and messages from the barangay office will appear here.</p>';
      } else {
        body.innerHTML = rows
          .map(
            (n) => `
          <div style="display:flex;gap:10px;padding:10px;margin-bottom:6px;border-radius:10px;border:1px solid ${n.is_read ? "rgba(0,0,0,.08)" : "var(--yellow,#eab308)"};background:${n.is_read ? "transparent" : "rgba(234,179,8,.08)"}">
            <div style="flex-shrink:0;width:32px;height:32px;border-radius:8px;background:rgba(11,29,58,.08);display:flex;align-items:center;justify-content:center"><i data-icon=${NOTIF_ICONS[n.kind] || "info"}></i></div>
            <div style="min-width:0;flex:1">
              <div style="font-weight:700">${esc(n.title)}</div>
              ${n.body ? `<div class="table-muted" style="font-size:12px;line-height:1.5">${esc(n.body)}</div>` : ""}
              <div class="table-muted" style="font-size:11px;margin-top:3px">${[n.ref, fmtDate(n.created_at)].filter(Boolean).map(esc).join(" · ")}</div>
            </div>
          </div>`
          )
          .join("");
        hydrate(body);
      }
      // Opening the feed clears the unread badge (same as the mobile app).
      if (rows.some((n) => !n.is_read)) {
        post("/api/notifications/read-all", { account_id: s.account_id }).catch(() => {});
      }
      unreadCount = 0;
      paintUnread();
    });
  };

  // The topbar bell used to just toast "3 new notifications" — open the feed.
  window.toggleNotif = function () {
    window.openNotifications();
  };

  // ── boot: unread polling ────────────────────────────────────────────────
  function boot() {
    ensurePanels();
    renderCertTypeGrid();
    document.addEventListener("cert-types-loaded", renderCertTypeGrid);
    refreshUnread();
    setInterval(refreshUnread, 60000);
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
