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
// the shared API. All functions are defensive: signed-out
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
  //
  // It opens on "Select a certificate", not on the first type in the list: a
  // preselected first choice is how a resident who never looked at the
  // dropdown files for a Barangay Clearance they did not want.
  //
  // What the resident sees is a box to type in, not the bare <select>: typing
  // narrows the list as they go ("clear" → Barangay Clearance, Business
  // Clearance) with the best match highlighted for Enter, and clicking the box
  // still shows the whole list for anyone who would rather scroll. The hidden
  // <select id="cert-type-select"> is where the choice is kept: the submit
  // path, the reset and the tests read it, and the box only ever writes a slug
  // from the list into it, so what is filed is always a certificate the
  // barangay offers, never free text.
  function renderCertTypeGrid() {
    const grid = document.getElementById("cert-type-grid");
    if (!grid) return;
    const previous = document.getElementById("cert-type-select")?.value || "";
    // The container is a CSS grid meant for cards; one full-width control.
    grid.style.display = "block";
    const loading = window.certTypesLoadError
      ? "Could not load the list of certificates — check your connection and reopen this form."
      : "Loading certificates…";
    grid.innerHTML =
      '<div class="cert-combo">' +
      '<input class="form-control cert-combo-input" id="cert-type-search" type="text"' +
      ' role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="cert-type-list"' +
      ' aria-label="Certificate type" autocomplete="off" spellcheck="false" maxlength="120"' +
      (CERT_TYPE_OPTIONS.length
        ? ' placeholder="Type to search, or click to see the list" />'
        : ` placeholder="${esc(loading)}" disabled />`) +
      '<ul class="cert-combo-list" id="cert-type-list" role="listbox" aria-label="Certificates" hidden></ul>' +
      '<select id="cert-type-select" hidden tabindex="-1" aria-hidden="true" onchange="certTypeChanged(this)"' +
      (CERT_TYPE_OPTIONS.length ? "" : " disabled") +
      ">" +
      '<option value="">Select a certificate</option>' +
      CERT_TYPE_OPTIONS.map(function (t) {
        return `<option value="${esc(t.slug)}">${esc(t.label)}</option>`;
      }).join("") +
      "</select></div>";
    const sel = document.getElementById("cert-type-select");
    if (previous && CERT_TYPE_OPTIONS.some((t) => t.slug === previous)) sel.value = previous;
    bindCertCombo(document.getElementById("cert-type-search"), document.getElementById("cert-type-list"), sel);
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

  // ── Type to find a certificate ─────────────────────────────────────────
  // Every word typed has to appear in the name, in any order, so "clearance
  // business" still finds Business Clearance. Names that begin with what was
  // typed come first, then names with a word that begins with it, then the
  // rest, each group in the list's own order.
  function certMatches(text) {
    const q = String(text || "").toLowerCase().trim();
    const words = q.split(/\s+/).filter(Boolean);
    if (!words.length) return CERT_TYPE_OPTIONS.slice();
    const rank = (label) => {
      const l = label.toLowerCase();
      if (l.startsWith(q)) return 0;
      return l.split(/[\s(/-]+/).some((w) => w.startsWith(words[0])) ? 1 : 2;
    };
    return CERT_TYPE_OPTIONS.map((t, i) => ({ t, i, hay: (t.label + " " + (t.short || "")).toLowerCase() }))
      .filter((x) => words.every((w) => x.hay.includes(w)))
      .map((x) => ({ t: x.t, i: x.i, r: rank(x.t.label) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.t);
  }

  // The name with each typed word marked, escaped piece by piece.
  function markMatches(label, text) {
    const words = String(text || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!words.length) return esc(label);
    return label
      .split(new RegExp("(" + words.join("|") + ")", "gi"))
      .map((part, i) => (i % 2 ? "<mark>" + esc(part) + "</mark>" : esc(part)))
      .join("");
  }

  function bindCertCombo(input, list, sel) {
    if (!input || !list || !sel) return;
    const labelOf = (slug) => (slug && CERT_LABELS[slug]) || "";
    input.value = labelOf(sel.value);
    let shown = [];
    let active = -1;

    // Nothing to filter by while the box still shows the current choice, so
    // reopening it on a chosen certificate shows the whole list again.
    const query = () => (sel.value && input.value === labelOf(sel.value) ? "" : input.value);

    function paint() {
      const q = query();
      shown = certMatches(q);
      if (active >= shown.length) active = shown.length - 1;
      list.innerHTML = shown.length
        ? shown
            .map(
              (t, i) =>
                `<li class="cert-combo-option${i === active ? " active" : ""}" id="cert-type-opt-${i}"` +
                ` role="option" data-slug="${esc(t.slug)}" aria-selected="${t.slug === sel.value}">` +
                markMatches(t.label, q) +
                "</li>"
            )
            .join("")
        : `<li class="cert-combo-empty" role="presentation">No certificate matches “${esc(q.trim())}”.</li>`;
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      if (active >= 0) {
        input.setAttribute("aria-activedescendant", "cert-type-opt-" + active);
        list.children[active]?.scrollIntoView({ block: "nearest" });
      } else input.removeAttribute("aria-activedescendant");
    }

    function close() {
      list.hidden = true;
      active = -1;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }

    function pick(slug) {
      const changed = sel.value !== slug;
      sel.value = slug;
      input.value = labelOf(slug);
      close();
      if (window.Motion) Motion.clearField(input);
      if (changed) window.certTypeChanged(sel);
    }

    // Leaving the box settles it: a name typed out in full is taken as the
    // choice, an emptied box clears it, and anything else goes back to the
    // choice already made — so the box never shows a name that is not what
    // will be filed, and an empty box always means nothing is chosen.
    function settle() {
      const text = input.value.trim().toLowerCase();
      if (!text) {
        if (sel.value) pick("");
        else close();
        return;
      }
      const exact = CERT_TYPE_OPTIONS.find(
        (t) => t.label.toLowerCase() === text || (t.short || "").toLowerCase() === text
      );
      if (exact) return pick(exact.slug);
      input.value = labelOf(sel.value);
      close();
    }

    input.addEventListener("focus", () => {
      input.select();
      paint();
    });
    input.addEventListener("click", () => {
      if (list.hidden) paint();
    });
    // The best match is highlighted as soon as anything is typed, so Enter
    // takes the top suggestion.
    input.addEventListener("input", () => {
      active = input.value.trim() ? 0 : -1;
      paint();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (list.hidden) paint();
        if (!shown.length) return;
        const step = e.key === "ArrowDown" ? 1 : -1;
        active = active < 0 ? (step > 0 ? 0 : shown.length - 1) : (active + step + shown.length) % shown.length;
        paint();
      } else if (e.key === "Enter") {
        if (!list.hidden && active >= 0 && shown[active]) {
          e.preventDefault();
          pick(shown[active].slug);
        }
      } else if (e.key === "Escape") {
        // Closes the list, not the whole form.
        if (!list.hidden) {
          e.preventDefault();
          e.stopPropagation();
          input.value = labelOf(sel.value);
          close();
        }
      } else if (e.key === "Tab") {
        // Tab takes the highlighted suggestion too — but only once something
        // has been typed, so tabbing past the box leaves the choice alone.
        if (!list.hidden && active >= 0 && shown[active] && query().trim()) pick(shown[active].slug);
      }
    });
    input.addEventListener("blur", settle);
    // Pressing on a suggestion would otherwise blur the box before the click
    // lands, and settle() would undo what was typed.
    list.addEventListener("mousedown", (e) => e.preventDefault());
    list.addEventListener("click", (e) => {
      const li = e.target.closest("[data-slug]");
      if (li) pick(li.dataset.slug);
    });
  }

  // Keeps the legacy `selectedCert` global in step with the dropdown. The real
  // submit path reads the slug straight off the <select>.
  window.certTypeChanged = function (sel) {
    if (!sel) return;
    const label = CERT_LABELS[sel.value] || sel.value;
    // The box the resident types in shows the choice by name — including one
    // made some other way, or cleared by the form's reset.
    const box = document.getElementById("cert-type-search");
    if (box) box.value = sel.value ? label : "";
    // shell.js / index.html declare `selectedCert` with a top-level let, which
    // is not a window property — and this file runs strict, so a missing
    // binding throws rather than quietly creating a global.
    try {
      selectedCert = label;
    } catch (_) {
      /* page without the demo global */
    }
    // Each certificate asks for different documents, has different blanks,
    // and only some have a residency requirement.
    if (typeof certRenderRequirements === "function")
      certRenderRequirements(sel.value);
    renderCertBlanks(sel.value);
    paintResidencyNotice(sel.value);
  };

  // ── The certificate's own blanks, filled in before filing ──────────────
  // Most of a certificate fills itself from the resident's record (name, age,
  // purok, birthdate). What is left is what only the requester knows: their
  // parents' names on a Certificate of Residency, the business on a Business
  // Clearance, how many children on a Solo Parent certification.
  //
  // These are asked for HERE, on the request form, and go in with the filing
  // (form_fields on POST /api/certificates). They used to be asked for after
  // filing, on the printed form itself, which the requester could then keep
  // changing from My Activity until staff acted on it. A filed request is now
  // the barangay's to change — routes/certificates.js only lets staff edit it.
  //
  // Which blanks: a field the form does not fill from the record (no source)
  // and is not left for a signature by hand. Read from the same templates the
  // printed sheet uses (js/certificate-templates.js), so a blank added in
  // Certificate Forms appears here without touching this file.
  function certBlankFields(slug) {
    if (!slug || typeof CERT_TEMPLATES === "undefined" || !CERT_TEMPLATES[slug]) return [];
    const sources = typeof CERT_FIELD_SOURCE_MAP !== "undefined" ? CERT_FIELD_SOURCE_MAP : {};
    return CERT_TEMPLATES[slug].fields.filter((f) => !f.manual && !sources[f.source]);
  }

  // What each blank holds, from its key — so a parent's name takes letters and
  // a head count takes digits (js/input-guard.js does the refusing).
  const BLANK_KINDS = [
    [/birthdate$/, "date"],
    [/^(heads|children)$/, "digits"],
    [/(^|_)(father|mother|relative|child_name|lot_owner|functionary|hauler)$/, "name"],
  ];
  function blankKind(key) {
    for (const [re, kind] of BLANK_KINDS) if (re.test(key)) return kind;
    return "text";
  }

  function blanksWrap() {
    let wrap = document.getElementById("cert-blanks");
    if (wrap) return wrap;
    // Just above Purpose: after the person's own details, before the why.
    const group = document.getElementById("cert-purpose")?.closest(".form-group");
    if (!group) return null;
    wrap = document.createElement("div");
    wrap.id = "cert-blanks";
    group.parentNode.insertBefore(wrap, group);
    return wrap;
  }

  function renderCertBlanks(slug) {
    const wrap = blanksWrap();
    if (!wrap) return;
    const fields = certBlankFields(slug);
    if (!fields.length) {
      wrap.innerHTML = "";
      return;
    }
    wrap.innerHTML =
      '<label class="form-label">Details printed on the certificate</label>' +
      '<p class="modal-help-text" style="margin:0 0 10px">Fill in what applies to you. ' +
      "Check them before you submit — once the request is filed, only barangay staff can change them.</p>" +
      '<div class="form-row">' +
      fields
        .map((f) => {
          const id = "cert-blank-" + f.key;
          const label = esc(f.label || f.key);
          const hint = f.value ? ` placeholder="e.g. ${esc(f.value)}"` : "";
          let control;
          if ((f.options || []).length) {
            control =
              `<select class="form-control" id="${id}" data-blank="${esc(f.key)}">` +
              '<option value="">Select one</option>' +
              f.options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("") +
              "</select>";
          } else {
            const kind = blankKind(f.key);
            control =
              kind === "date"
                ? `<input class="form-control" type="date" id="${id}" data-blank="${esc(f.key)}" data-rule="past-date" />`
                : `<input class="form-control" id="${id}" data-blank="${esc(f.key)}" maxlength="${kind === "digits" ? 3 : 120}"` +
                  (kind === "text" ? "" : ` data-rule="${kind}"`) +
                  hint +
                  " />";
          }
          return `<div class="form-group"><label class="form-label" for="${id}">${label}</label>${control}</div>`;
        })
        .join("") +
      "</div>";
  }

  // The values typed into the blanks, as the printed form wants them — a date
  // the way a certificate writes one ("March 14, 1992"), not "1992-03-14".
  function collectCertBlanks() {
    const out = {};
    document.querySelectorAll("#cert-blanks [data-blank]").forEach((el) => {
      let v = String(el.value || "").trim();
      if (!v) return;
      if (el.type === "date") {
        const d = new Date(v + "T00:00:00");
        if (!isNaN(d))
          v = d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      }
      out[el.dataset.blank] = v;
    });
    return out;
  }

  // ── Residency: six months before a residency certificate ───────────────
  // The barangay issues a Certificate of Barangay Residency only to someone
  // who has lived here at least six months (routes/certificates.js refuses
  // the filing otherwise). The resident's record says from when they may —
  // residency_cert_from, worked out by the server from the start of residency
  // the barangay recorded — so the form can say so as soon as the certificate
  // is picked, instead of after the resident has filled everything in.
  const RESIDENCY_TYPES = ["residency"];
  // The signed-in resident's record, once prefillCertificateForm() has it.
  let CERT_RESIDENT = null;

  function todayIso() {
    if (window.InputGuard) return InputGuard.today();
    const d = new Date();
    return [d.getFullYear(), d.getMonth() + 1, d.getDate()]
      .map((n, i) => (i ? String(n).padStart(2, "0") : n))
      .join("-");
  }

  function longDate(iso) {
    const d = new Date(iso + "T00:00:00");
    return isNaN(d)
      ? iso
      : d.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
  }

  // null when this resident may file for this certificate; otherwise the
  // dates that explain why not.
  function residencyBlock(slug) {
    if (!RESIDENCY_TYPES.includes(slug) || !CERT_RESIDENT) return null;
    const from = CERT_RESIDENT.residency_cert_from;
    if (!from || from <= todayIso()) return null;
    return { since: CERT_RESIDENT.residency_start || CERT_RESIDENT.date_registered, from };
  }

  function paintResidencyNotice(slug) {
    const grid = document.getElementById("cert-type-grid");
    if (!grid) return;
    let note = document.getElementById("cert-eligibility");
    if (!note) {
      note = document.createElement("div");
      note.id = "cert-eligibility";
      note.setAttribute("role", "alert");
      grid.parentNode.insertBefore(note, grid.nextSibling);
    }
    const block = residencyBlock(slug);
    const submitBtn = document.querySelector('#modal-certificates [onclick="submitCertificate()"]');
    if (submitBtn) {
      submitBtn.disabled = !!block;
      submitBtn.title = block ? "You can't apply for this certificate yet — see the note above." : "";
    }
    if (!block) {
      note.innerHTML = "";
      note.className = "";
      return;
    }
    note.className = "alert alert-warning";
    note.style.marginTop = "10px";
    note.innerHTML =
      '<span class="alert-icon"><i data-icon=triangle-alert></i></span>' +
      "<div><strong>You can't apply for a Certificate of Barangay Residency yet.</strong> " +
      "It is issued only to residents who have lived in Barangay Conde Labak for at least " +
      "6 months. Your residency on record started on <strong>" +
      esc(longDate(block.since)) +
      "</strong>, so you can apply from <strong>" +
      esc(longDate(block.from)) +
      "</strong>. If that start date is wrong, please visit the barangay hall to have it corrected.</div>";
    hydrate(note);
  }

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
    return (el && el.textContent.trim()) || "";
  }

  // The dropdown's value *is* the slug — "" until one is picked; there is no
  // falling back to the first type in the list. The card lookups are there for
  // any page still showing the old hardcoded type cards.
  function selectedCertSlug() {
    const sel = document.getElementById("cert-type-select");
    if (sel) return sel.value;
    const card = document.querySelector(".cert-type-card.selected");
    return (card && card.dataset.slug) || certSlugForName(selectedCertName()) || "";
  }

  window.submitCertificate = async function () {
    const modal = document.getElementById("modal-certificates");
    const val = (id) => (document.getElementById(id)?.value || "").trim();
    if (
      !requireFields(
        [
          // Marked on the box the resident types in, which is empty exactly
          // when nothing is chosen (settle() sees to that on the way out).
          {
            id: document.getElementById("cert-type-search") ? "cert-type-search" : "cert-type-select",
            message: "Choose the certificate you need.",
          },
          "cert-fname",
          "cert-lname",
          { id: "cert-purok", message: "Choose your purok." },
          { id: "cert-purpose", message: "Say what the certificate is for — for example, employment." },
        ],
        "Please choose a certificate and fill in your name, purok and purpose."
      )
    )
      return;
    // What is filled in has to be right too: a name in letters, an 11-digit
    // number, a birthday that has happened and a pickup day that has not.
    if (window.InputGuard && !InputGuard.check(modal)) return;
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
    // Normally the Submit button is already off; this is for the record that
    // arrived after the certificate was picked.
    if (residencyBlock(type)) {
      paintResidencyNotice(type);
      if (window.Motion) Motion.shakeBox(document.getElementById("cert-eligibility"));
      return;
    }
    const certName = CERT_LABELS[type] || selectedCertName();
    // Extra details ride along in `purpose` — the certificate table keeps a
    // single free-text purpose column.
    const extras = [
      val("cert-purpose"),
      val("cert-contact") && "Contact: " + val("cert-contact"),
      val("cert-pickup") && "Preferred pickup: " + fmtDate(val("cert-pickup")),
      val("cert-purok"),
    ]
      .filter(Boolean)
      .join(" · ");
    const blanks = collectCertBlanks();

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
        form_fields: Object.keys(blanks).length ? blanks : null,
        resident_id: s?.resident_id || null,
        account_id: s?.account_id || null,
      });
    } catch (err) {
      // The form stays open with everything the user typed still in it, and
      // the submit button shakes to say the press did not take.
      toast("Could not submit the request: " + err.message, "<i data-icon=triangle-alert></i>");
      if (window.Motion) Motion.shakeBox(modal);
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

    // The requester used to be shown the printed form here, editable, to fill
    // in the blanks only they know. Those are asked on the request form now,
    // before filing (renderCertBlanks), and a filed request is the barangay's
    // to change — so this ends on where to find the request again, and View in
    // My Activity shows the form read-only.
    showSubmittedNotice(certName, res.request_no);
  };

  // Back to a blank form: every field emptied, every dropdown back to its
  // "Select …" line (which clears the requirement list, the blanks and any
  // chosen files), and last time's validation marks cleared. The resident's
  // own details come back on the next open — openServicePopup() refills them
  // from their record.
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
    CERT_RESIDENT = r;
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el && !el.value && v) el.value = v;
    };
    set("cert-fname", r.first_name);
    set("cert-lname", r.last_name);
    set("cert-dob", r.birthdate);
    set("cert-contact", r.contact_no);
    // The record's purok is "Purok 3" and so is the option — matched exactly.
    const purokSel = document.getElementById("cert-purok");
    if (purokSel && r.purok && !purokSel.value) {
      const opt = Array.from(purokSel.options).find((o) => o.value === r.purok);
      if (opt) purokSel.value = opt.value;
    }
    // The record may arrive after the certificate was already picked.
    paintResidencyNotice(selectedCertSlug());
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
    // counted into the barangay's average rating. Now an untouched row is 0,
    // and 0 is refused below.
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
          { id: "fb-category", message: "Choose what your feedback is about." },
          { id: "star-rating", message: "Choose a star rating — one to five." },
          { id: "fb-comment", message: "Tell us what you would like to say." },
        ],
        "Please choose a category and a star rating, and enter a comment."
      )
    )
      return;
    if (window.InputGuard && !InputGuard.check(document.getElementById("modal-feedback"))) return;
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
    // …and the rest of the form with it, the category back to "Select a
    // category" rather than holding the last person's choice.
    ["fb-category", "fb-comment", "fb-name", "fb-contact"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
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
        row("Resident Since", r.residency_start ? v(fmtDate(r.residency_start)) : '<span class="table-muted">Not recorded</span>') +
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
          // ?mine=1: the server sends back only what this account sent. The
          // full list is staff data now; the filter below is kept as a second
          // check, not as the thing doing the hiding.
          const rows = await get("/api/feedback?mine=1");
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
  // (topics, urgency, alerts) are staff working notes, not part of what the
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
      // Opening the feed clears the unread badge.
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
