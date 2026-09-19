// js/certificate-forms.js
// Certificate Processing → Certificate Forms: each certificate is edited as a
// page, the way it would be in a word processor. Type the wording straight
// onto the A4 sheet; change its font, size, bold/italic/underline, alignment,
// indents and spacing from the toolbar; lay things out in tables; and drop in
// fill-in fields where a blank belongs.
//
// What is on the page is what prints: the page uses the printed sheet's own
// styles (CERT_DOC_CSS) and the same fixed heading and request number. The
// heading is not editable — it is the barangay's letterhead, the same on every
// certificate.
//
// FILL-IN FIELDS
// "Fill-in field" asks how much space the blank takes, whether it is
// underlined, what it starts filled with (the resident's record, the date, the
// Punong Barangay's name…), its default text and optional choices — or that it
// is left blank to be written by hand. Clicking a field on the page reopens it.
// The same field can be placed more than once (the applicant's name twice, say):
// its name, automatic value, default and choices are shared, while the space
// and underline are set per place.
//
// SAVING
// Editing changes a draft; Save sends the whole certificate in one request
// (PUT /api/certificate-types/:slug). Switching to another certificate keeps
// the draft. Leaving the MIS page with unsaved drafts — the sidebar, a link,
// signing out — asks first in the MIS's own dialog. (Closing the tab or
// reloading still gets the browser's own warning: a page is not allowed to
// replace that one.) The editor keeps its own undo history (Ctrl+Z / Ctrl+Y),
// since the toolbar changes the page in ways the browser's undo does not track.
//
// Certificates are listed alphabetically everywhere, so there is no order to
// set.
//
// Only an Administrator can change a form; anyone else sees it read-only.
//
// Loaded on pages/certificates.html after certificate-export.js,
// certificate-templates.js and certificate-types.js.
const CertForms = (function () {
  "use strict";

  const S = {
    container: null,
    selected: null,
    drafts: {}, // slug → working copy
    history: {}, // slug → { stack: [{ html, sel }], index }
    historyTimer: null,
    syncTimer: null,
    range: null, // the last selection inside the page
    side: "fields",
    preview: false,
    zoom: "fit",
    busy: false,
    dialog: null, // { chip | null, range }
  };

  // ── Small helpers ──────────────────────────────────────────────────────
  const esc = (s) =>
    String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const $ = (sel) => (S.container ? S.container.querySelector(sel) : null);
  const toast = (msg, icon) => {
    if (typeof showToast === "function") showToast(msg, icon);
  };
  const fail = (msg) => toast(msg, "<i data-icon=triangle-alert></i>");
  const audit = (action, details, level) => {
    if (typeof logAudit === "function") logAudit(action, details, level || "info", "certificate");
  };
  const accountId = () => (typeof actingAccountId === "function" ? actingAccountId() || null : null);
  const hydrate = (el) => {
    if (typeof hydrateIcons === "function") hydrateIcons(el);
  };

  function canEdit() {
    const s = typeof getSession === "function" ? getSession() : null;
    return !!(s && s.role === "Admin");
  }

  const types = () => window.CERT_TYPE_ALL || [];
  const savedType = (slug) => types().find((t) => t.slug === slug) || null;
  const body = () => $("#cfw-body");

  // ── Toolbar vocabulary ─────────────────────────────────────────────────
  const FONTS = [
    ["Times New Roman", '"Times New Roman", Times, serif'],
    ["Georgia", "Georgia, serif"],
    ["Book Antiqua", '"Book Antiqua", Palatino, serif'],
    ["Garamond", "Garamond, serif"],
    ["Cambria", "Cambria, serif"],
    ["Arial", "Arial, Helvetica, sans-serif"],
    ["Calibri", "Calibri, Arial, sans-serif"],
    ["Tahoma", "Tahoma, Verdana, sans-serif"],
    ["Verdana", "Verdana, sans-serif"],
    ["Century Gothic", '"Century Gothic", Arial, sans-serif'],
    ["Courier New", '"Courier New", monospace'],
  ];
  const SIZES = [8, 9, 10, 10.5, 11, 11.5, 12, 12.5, 13, 14, 14.5, 15, 16, 18, 20, 24, 28, 36];
  const LINE_SPACING = [
    ["1", "1.0"], ["1.15", "1.15"], ["1.3", "1.3"], ["1.5", "1.5"],
    ["1.75", "1.75"], ["1.95", "1.95 (form)"], ["2", "2.0"], ["2.15", "2.15"], ["2.5", "2.5"],
  ];
  const SPACING_MM = [0, 2, 4, 6, 7, 8, 9, 12, 14, 18, 24];
  const LETTER_SPACING = [["normal", "Normal"], ["1px", "Expanded 1"], ["2px", "Expanded 2"], ["3px", "Expanded 3"], ["5px", "Expanded 5"]];
  const FIRST_LINE_INDENT = "14mm";
  const INDENT_STEP_MM = 10;

  // Paragraph styles, as in a word processor's Styles box.
  const STYLES = {
    normal: { label: "Normal", css: { "text-align": "", "text-indent": "", "margin-top": "", "margin-bottom": "", "font-size": "", "font-weight": "", "font-style": "", "line-height": "" } },
    body: { label: "Body paragraph", css: { "text-align": "justify", "text-indent": FIRST_LINE_INDENT, "margin-top": "", "margin-bottom": "7mm", "font-size": "", "font-weight": "", "font-style": "", "line-height": "" } },
    title: { label: "Title", css: { "text-align": "center", "text-indent": "0mm", "margin-top": "9mm", "margin-bottom": "8mm", "font-size": "14.5pt", "font-weight": "bold", "font-style": "", "line-height": "" } },
    subtitle: { label: "Subtitle", css: { "text-align": "center", "text-indent": "0mm", "margin-top": "", "margin-bottom": "8mm", "font-size": "10.5pt", "font-weight": "", "font-style": "italic", "line-height": "" } },
    signature: { label: "Signature", css: { "text-align": "", "text-indent": "0mm", "margin-top": "18mm", "margin-bottom": "", "font-size": "", "font-weight": "", "font-style": "", "line-height": "1.3" } },
    note: { label: "Small note", css: { "text-align": "right", "text-indent": "0mm", "margin-top": "8mm", "margin-bottom": "", "font-size": "8pt", "font-weight": "", "font-style": "italic", "line-height": "" } },
  };

  // Small line icons for the toolbar, drawn like the rest of the MIS's icons.
  const ICONS = {
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h4"/>',
    left: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
    center: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
    right: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
    justify: '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
    firstline: '<path d="M10 6h10M4 10h16M4 14h16M4 18h16"/><path d="m4 4 3 2-3 2"/>',
    outdent: '<path d="M11 6h9M11 10h9M11 14h9M4 18h16"/><path d="M7 8 4 11l3 3"/>',
    indent: '<path d="M11 6h9M11 10h9M11 14h9M4 18h16"/><path d="m4 8 3 3-3 3"/>',
    field: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 14h10"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18M3 15h18M10 4v16"/>',
    rowAbove: '<rect x="3" y="11" width="18" height="9" rx="1"/><path d="M12 3v6M9 6h6"/>',
    rowBelow: '<rect x="3" y="4" width="18" height="9" rx="1"/><path d="M12 15v6M9 18h6"/>',
    colLeft: '<rect x="11" y="3" width="10" height="18" rx="1"/><path d="M3 12h6M6 9v6"/>',
    colRight: '<rect x="3" y="3" width="10" height="18" rx="1"/><path d="M15 12h6M18 9v6"/>',
    delRow: '<rect x="3" y="8" width="18" height="8" rx="1"/><path d="m10 10 4 4M14 10l-4 4"/>',
    delCol: '<rect x="8" y="3" width="8" height="18" rx="1"/><path d="m10 10 4 4M14 10l-4 4"/>',
    borders: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 12h18M12 3v18" stroke-dasharray="2 2"/>',
    delTable: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="m9 9 6 6M15 9l-6 6"/>',
    clear: '<path d="M4 7V5h14v2M11 5l-3 14M7 19h6"/><path d="m16 14 5 5M21 14l-5 5"/>',
  };
  const icon = (name) =>
    `<svg class="cfw-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  // ── Definitions ────────────────────────────────────────────────────────
  // A form's fields, cleaned and in the order they appear on the page; ones no
  // longer on the page are dropped.
  // The editor puts a <br> in empty table cells and a paragraph after a table
  // at the very end, so the cursor has somewhere to go. Neither prints
  // anything, so they come out again before a form is compared or saved —
  // otherwise merely opening a form would count as changing it.
  function withoutEditorPadding(html) {
    const root = document.implementation.createHTMLDocument("").createElement("div");
    root.innerHTML = html;
    root.querySelectorAll("td").forEach((td) => {
      if (td.childNodes.length === 1 && td.firstChild.nodeName === "BR") td.firstChild.remove();
    });
    let last = root.lastChild;
    while (last && last.nodeName === "P" && !last.textContent.trim() && !last.querySelector("[data-field]")) {
      last.remove();
      last = root.lastChild;
    }
    return root.innerHTML;
  }

  function normalForm(form) {
    if (!form || form.version !== 2) return form || null;
    const bodyHtml = withoutEditorPadding(certSanitizeBody(form.body));
    const byKey = {};
    (form.fields || []).forEach((f) => (byKey[f.key] = f));
    const fields = certBodyFieldKeys(bodyHtml).map((k) => {
      const f = byKey[k] || {};
      return {
        key: k,
        label: String(f.label || k),
        source: f.source || "",
        value: f.value || "",
        options: (f.options || []).filter(Boolean),
        manual: !!f.manual,
      };
    });
    return { version: 2, body: bodyHtml, fields };
  }

  function definitionOf(t) {
    return {
      label: t.label,
      short: t.short,
      active: t.active !== false,
      requirements: (t.requirements || []).map((r) => ({
        key: r.key || "",
        label: r.label || "",
        required: !!r.required,
        sensitivity: r.sensitivity === "health" ? "health" : "normal",
        note: r.note || "",
      })),
      form: normalForm(t.form),
    };
  }

  // Saved definitions normalised once each, so opening a form never reads as a
  // change just because the browser writes the same HTML slightly differently.
  const savedDefCache = new Map();
  function savedDefinition(slug) {
    const t = savedType(slug);
    if (!t) return null;
    const key = slug + "|" + t.updated_at;
    if (!savedDefCache.has(key)) savedDefCache.set(key, JSON.stringify(definitionOf(t)));
    return savedDefCache.get(key);
  }

  function current() {
    if (!S.selected) return null;
    if (!S.drafts[S.selected]) {
      const t = savedType(S.selected);
      if (!t) return null;
      const d = clone(t);
      if (d.form && d.form.version === 2) d.form = normalForm(d.form);
      S.drafts[S.selected] = d;
    }
    return S.drafts[S.selected];
  }

  function isDirty(slug) {
    const d = S.drafts[slug];
    return !!d && JSON.stringify(definitionOf(d)) !== savedDefinition(slug);
  }

  const anyDirty = () => Object.keys(S.drafts).some(isDirty);

  function keyFromLabel(label, taken) {
    let base = String(label || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 36);
    if (!/^[a-z]/.test(base)) base = "field_" + base;
    base = base.replace(/_+$/g, "") || "field";
    let key = base;
    for (let n = 2; taken.includes(key); n++) key = `${base}_${n}`;
    return key;
  }

  // ── Starting points ────────────────────────────────────────────────────
  function fieldSpan(key, width, underline) {
    return `<span data-field="${key}" data-width="${width}" data-underline="${underline ? 1 : 0}"></span>`;
  }

  function starterForm(title) {
    const para = 'style="text-align: justify; text-indent: 14mm; margin-bottom: 7mm"';
    return {
      version: 2,
      body:
        `<p style="text-align: center; font-size: 14.5pt; margin-top: 9mm; margin-bottom: 8mm"><b>${esc(String(title || "Certification").toUpperCase())}</b></p>` +
        `<p style="margin-bottom: 6mm"><b>To Whom It May Concern:</b></p>` +
        `<p ${para}>This is to certify that <b>${fieldSpan("name", 66.1, true)}</b>, of legal age, is a bonafide resident of Purok <b>${fieldSpan("purok", 14.6, true)}</b>, Barangay Conde Labak, Batangas City.</p>` +
        `<p ${para}>This certification is being issued upon the request of the above-named person for whatever legal purpose it may serve.</p>` +
        `<p ${para}>SIGNED and ISSUED this <b>${fieldSpan("day", 21.2, true)}</b> day of <b>${fieldSpan("month", 39.7, true)}</b>, ${fieldSpan("year", 0, false)} at Barangay Conde Labak, Batangas City.</p>` +
        `<p style="margin-top: 18mm; line-height: 1.3"><b>${fieldSpan("secretary_name", 0, false)}</b><br><span style="font-size: 11pt">Barangay Secretary</span></p>` +
        `<p style="margin-top: 12mm; line-height: 1.3"><b>${fieldSpan("punong_name", 0, false)}</b><br><span style="font-size: 11pt">Punong Barangay</span></p>` +
        `<p style="margin-top: 14mm; font-size: 11.5pt; line-height: 2.1">Purpose: <b>${fieldSpan("purpose", 79.4, true)}</b></p>`,
      fields: [
        { key: "name", label: "Name of applicant", source: "name_upper", value: "", options: [], manual: false },
        { key: "purok", label: "Purok no.", source: "purok", value: "", options: [], manual: false },
        { key: "day", label: "Issued this…", source: "day", value: "", options: [], manual: false },
        { key: "month", label: "Month", source: "month", value: "", options: CERT_MONTHS.slice(), manual: false },
        { key: "year", label: "Year", source: "year", value: "", options: [], manual: false },
        { key: "secretary_name", label: "Barangay Secretary's name", source: "secretary_name", value: "", options: [], manual: false },
        { key: "punong_name", label: "Punong Barangay's name", source: "punong_name", value: "", options: [], manual: false },
        { key: "purpose", label: "Purpose", source: "purpose", value: "", options: [], manual: false },
      ],
    };
  }

  // ── Mounting ───────────────────────────────────────────────────────────
  async function mount(container) {
    S.container = container;
    if (!container.dataset.cfwBound) {
      container.dataset.cfwBound = "1";
      container.addEventListener("mousedown", onMouseDown);
      container.addEventListener("click", onClick);
      container.addEventListener("change", onChange);
      container.addEventListener("input", onInput);
      container.addEventListener("keydown", onKeyDown);
      container.addEventListener("paste", onPaste);
      container.addEventListener("drop", (e) => {
        if (e.target.closest && e.target.closest("#cfw-body")) e.preventDefault();
      });
      container.addEventListener("beforeinput", onBeforeInput);
    }
    if (typeof certEnsureDocStyles === "function") certEnsureDocStyles();
    try {
      S.zoom = localStorage.getItem("cares.cfw.zoom") || "fit";
    } catch (_) {
      /* a per-viewer convenience only */
    }
    if (!types().length) {
      container.innerHTML = '<div class="card"><p class="table-muted" style="padding:24px;text-align:center">Loading certificate forms…</p></div>';
      await window.certTypesReady;
    }
    if (!S.selected || !savedType(S.selected)) S.selected = (types()[0] || {}).slug || null;
    render();
  }

  const visible = () => !!(S.container && S.container.isConnected && !S.container.hidden);

  // ── Rendering ──────────────────────────────────────────────────────────
  function render() {
    if (!S.container) return;
    const edit = canEdit();
    S.container.innerHTML = `
      ${edit ? "" : `<div class="alert alert-info cfw-readonly"><span class="alert-icon"><i data-icon=lock></i></span> Only an Administrator can change certificate forms. You can look through how each one is set up.</div>`}
      <div class="cfw">
        <div class="cfw-bar card" id="cfw-bar"></div>
        <div class="cfw-ribbon card" id="cfw-ribbon" role="toolbar" aria-label="Formatting"></div>
        <div class="cfw-main">
          <div class="cfw-canvas" id="cfw-canvas">
            <div class="cfw-zoom" id="cfw-zoom">
              <div class="cert-page cfw-page" id="cfw-page">
                <img class="cert-watermark" src="${CERT_HEADING.watermark}" alt="" onerror="this.style.visibility='hidden'" />
                <div class="cert-content" id="cfw-content">
                  <div class="cfw-heading" contenteditable="false" title="The heading is the same on every certificate and can't be edited.">${certHeadingHtml()}</div>
                  <div class="cert-body cfw-body" id="cfw-body" contenteditable="${edit ? "true" : "false"}" spellcheck="true" aria-label="Certificate wording"></div>
                  <div class="cert-body cfw-preview-body" id="cfw-preview" hidden></div>
                </div>
                <div class="cert-footnote">CERT-0000-000</div>
                <div class="cfw-page-end" id="cfw-page-end"><span>End of page</span></div>
              </div>
            </div>
          </div>
          <aside class="cfw-side card" id="cfw-side"></aside>
        </div>
      </div>`;
    hydrate(S.container);
    renderBar();
    renderRibbon();
    loadDocument();
    renderSide();
    applyZoom();
  }

  function renderBar() {
    const bar = $("#cfw-bar");
    if (!bar) return;
    const edit = canEdit();
    const t = current();
    const dirty = t ? isDirty(t.slug) : false;
    bar.innerHTML = `
      <div class="cfw-bar-group">
        <label class="cfw-bar-label" for="cfw-select">Certificate</label>
        <select class="form-control cfw-select" id="cfw-select">
          ${types()
            .map(
              (x) =>
                `<option value="${esc(x.slug)}"${x.slug === S.selected ? " selected" : ""}>${esc((S.drafts[x.slug] || x).label)}${x.active === false ? " (hidden)" : ""}${isDirty(x.slug) ? " •" : ""}</option>`
            )
            .join("")}
        </select>
        ${edit ? `<button type="button" class="btn btn-sm btn-outline" data-act="new"><i data-icon=plus></i> New certificate</button>` : ""}
      </div>
      <div class="cfw-bar-group">
        <span class="cfw-overflow" id="cfw-overflow" hidden><i data-icon=triangle-alert></i> Longer than one page — it will be shrunk to fit when printed</span>
        <span class="cfw-state" id="cfw-state" data-state="${dirty ? "dirty" : "clean"}">${dirty ? "Unsaved changes" : "All changes saved"}</span>
        <button type="button" class="btn btn-sm btn-outline${S.preview ? " is-on" : ""}" data-act="preview" aria-pressed="${S.preview}"><i data-icon=eye></i> ${S.preview ? "Back to editing" : "Preview with sample details"}</button>
        ${
          edit
            ? `<button type="button" class="btn btn-sm btn-outline" data-act="discard" id="cfw-discard" ${dirty ? "" : "disabled"}>Discard</button>
               <button type="button" class="btn btn-sm btn-gold" data-act="save" id="cfw-save" ${dirty ? "" : "disabled"}><i data-icon=check></i> Save</button>`
            : ""
        }
      </div>`;
    hydrate(bar);
  }

  function ribbonSelect(id, title, options, extraClass) {
    return `<select class="cfw-rsel${extraClass ? " " + extraClass : ""}" id="${id}" title="${title}" aria-label="${title}">${options
      .map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`)
      .join("")}</select>`;
  }
  const rbtn = (act, title, inner, extra) =>
    `<button type="button" class="cfw-rbtn" data-cmd="${act}" title="${title}" aria-label="${title}" ${extra || ""}>${inner}</button>`;

  function renderRibbon() {
    const r = $("#cfw-ribbon");
    if (!r) return;
    r.innerHTML = `
      <fieldset class="cfw-ribbon-set" ${canEdit() && !S.preview ? "" : "disabled"}>
        <div class="cfw-group">
          ${rbtn("undo", "Undo (Ctrl+Z)", icon("undo"))}
          ${rbtn("redo", "Redo (Ctrl+Y)", icon("redo"))}
        </div>
        <div class="cfw-group">
          ${ribbonSelect("cfw-style", "Paragraph style", [["", "Style…"]].concat(Object.entries(STYLES).map(([k, s]) => [k, s.label])), "cfw-rsel-style")}
        </div>
        <div class="cfw-group">
          ${ribbonSelect("cfw-font", "Font", [["", "Font"]].concat(FONTS.map(([l, v]) => [v, l])), "cfw-rsel-font")}
          ${ribbonSelect("cfw-size", "Font size (pt)", [["", "Size"]].concat(SIZES.map((n) => [n + "pt", String(n)])), "cfw-rsel-size")}
          ${rbtn("bold", "Bold (Ctrl+B)", "<b>B</b>", 'aria-pressed="false"')}
          ${rbtn("italic", "Italic (Ctrl+I)", "<i>I</i>", 'aria-pressed="false"')}
          ${rbtn("underline", "Underline (Ctrl+U)", "<u>U</u>", 'aria-pressed="false"')}
          ${ribbonSelect("cfw-letter", "Character spacing", [["", "Spacing"]].concat(LETTER_SPACING), "cfw-rsel-letter")}
        </div>
        <div class="cfw-group">
          ${rbtn("align-left", "Align left", icon("left"), 'aria-pressed="false"')}
          ${rbtn("align-center", "Centre", icon("center"), 'aria-pressed="false"')}
          ${rbtn("align-right", "Align right", icon("right"), 'aria-pressed="false"')}
          ${rbtn("align-justify", "Justify", icon("justify"), 'aria-pressed="false"')}
        </div>
        <div class="cfw-group">
          ${rbtn("firstline", "First-line indent", icon("firstline"), 'aria-pressed="false"')}
          ${rbtn("outdent", "Decrease indent", icon("outdent"))}
          ${rbtn("indent", "Increase indent", icon("indent"))}
          ${ribbonSelect("cfw-line", "Line spacing", [["", "Line"]].concat(LINE_SPACING), "cfw-rsel-num")}
          ${ribbonSelect("cfw-before", "Space before paragraph", [["", "Before"]].concat(SPACING_MM.map((n) => [n + "mm", n + " mm"])), "cfw-rsel-num")}
          ${ribbonSelect("cfw-after", "Space after paragraph", [["", "After"]].concat(SPACING_MM.map((n) => [n + "mm", n + " mm"])), "cfw-rsel-num")}
        </div>
        <div class="cfw-group">
          <button type="button" class="cfw-rbtn cfw-rbtn-field" data-cmd="field" title="Insert a fill-in field where the cursor is">${icon("field")}<span>Fill-in field</span></button>
          ${rbtn("table", "Insert a table", icon("table") + "<span>Table</span>")}
        </div>
        <div class="cfw-group cfw-table-tools" id="cfw-table-tools" hidden>
          ${rbtn("row-above", "Insert row above", icon("rowAbove"))}
          ${rbtn("row-below", "Insert row below", icon("rowBelow"))}
          ${rbtn("col-left", "Insert column left", icon("colLeft"))}
          ${rbtn("col-right", "Insert column right", icon("colRight"))}
          ${rbtn("del-row", "Delete row", icon("delRow"))}
          ${rbtn("del-col", "Delete column", icon("delCol"))}
          ${rbtn("borders", "Borders on / off", icon("borders"), 'aria-pressed="false"')}
          <label class="cfw-colw" title="Width of this column">Column <input type="number" id="cfw-colw" min="0" max="170" step="1" placeholder="auto" /> mm</label>
          ${rbtn("del-table", "Delete table", icon("delTable"))}
        </div>
        <div class="cfw-group">
          ${rbtn("clear", "Clear formatting", icon("clear"))}
        </div>
      </fieldset>
      <div class="cfw-group cfw-zoom-group">
        ${ribbonSelect("cfw-zoomsel", "Zoom", [["fit", "Fit"], ["0.6", "60%"], ["0.75", "75%"], ["0.9", "90%"], ["1", "100%"], ["1.25", "125%"]], "cfw-rsel-zoom")}
      </div>`;
    const z = $("#cfw-zoomsel");
    if (z) z.value = S.zoom;
  }

  // ── The document on the page ───────────────────────────────────────────
  function loadDocument() {
    const b = body();
    const preview = $("#cfw-preview");
    if (!b) return;
    const t = current();
    if (!t) {
      b.innerHTML = "";
      return;
    }
    if (!t.form) {
      b.innerHTML = "";
      b.hidden = true;
      preview.hidden = false;
      preview.innerHTML = `<p style="text-align:center;margin-top:30mm;color:#555"><i>This certificate has no printable form. Tick “Has a printable form” under Details to start one.</i></p>`;
      checkOverflow();
      return;
    }
    if (t.form.version !== 2) {
      b.innerHTML = '<p style="color:#b91c1c">This form is stored in an old format. Run db/migration-certificate-form-documents.js on the server to convert it.</p>';
      b.contentEditable = "false";
      return;
    }
    b.contentEditable = canEdit() && !S.preview ? "true" : "false";
    b.innerHTML = certSanitizeBody(t.form.body) || "<p><br></p>";
    decorateFields(b);
    ensureEditable(b);
    if (!S.history[t.slug]) S.history[t.slug] = { stack: [{ html: b.innerHTML, sel: null }], index: 0 };
    b.hidden = S.preview;
    preview.hidden = !S.preview;
    if (S.preview) renderPreview();
    S.range = null;
    checkOverflow();
  }

  // Fields on the page are shown as chips labelled with what they hold.
  function decorateFields(root) {
    const t = current();
    const byKey = {};
    ((t && t.form && t.form.fields) || []).forEach((f) => (byKey[f.key] = f));
    root.querySelectorAll("span[data-field]").forEach((chip) => {
      const f = byKey[chip.getAttribute("data-field")] || { label: chip.getAttribute("data-field") };
      const width = Number(chip.getAttribute("data-width")) || 0;
      const underline = chip.getAttribute("data-underline") !== "0";
      chip.className = "cfw-field" + (underline ? " cfw-field-line" : "") + (width ? "" : " cfw-field-fit");
      chip.contentEditable = "false";
      chip.style.minWidth = width ? width + "mm" : "";
      chip.title = `${f.label}${f.manual ? " — written by hand" : ""}. Click to change.`;
      chip.innerHTML = `<span class="cfw-field-label">${esc(f.manual ? "✎ " + f.label : f.label)}</span>`;
    });
  }

  // Empty table cells get a line break so the cursor can be put in them, and
  // there is always a paragraph to type into after a table at the very end.
  function ensureEditable(root) {
    if (!root.firstChild) root.innerHTML = "<p><br></p>";
    root.querySelectorAll("td").forEach((td) => {
      if (!td.firstChild) td.appendChild(document.createElement("br"));
    });
    const last = root.lastElementChild;
    if (last && last.tagName === "TABLE") {
      const p = document.createElement("p");
      p.appendChild(document.createElement("br"));
      root.appendChild(p);
    }
  }

  const SAMPLE_RESIDENT = {
    first_name: "Juan", middle_name: "Pedro", last_name: "Dela Cruz", age: 34, sex: "M",
    civil_status: "Married", purok: "Purok 3", birthdate: "1992-03-14T00:00:00",
    occupation: "Farmer", date_registered: "2015-06-01T00:00:00",
  };

  function renderPreview() {
    const t = current();
    const preview = $("#cfw-preview");
    if (!t || !preview || !t.form) return;
    const tpl = certBuildTemplate({ slug: t.slug, form: normalForm(t.form) });
    certLoadSignatories().then((signatories) => {
      const ctx = {
        request: { type: t.slug, request_no: "CERT-0000-000", applicant_name: "Dela Cruz, Juan P.", purpose: "Employment requirement" },
        resident: SAMPLE_RESIDENT,
        signatories,
        issuedOn: new Date(),
      };
      preview.innerHTML = tpl ? tpl.render(tpl.defaults(ctx)) : "";
      checkOverflow();
    });
  }

  // Draft ← page. Debounced while typing; immediate before anything that reads
  // the draft.
  function syncDraft() {
    clearTimeout(S.syncTimer);
    S.syncTimer = null;
    const t = current();
    const b = body();
    if (!t || !t.form || !b || b.hidden || t.form.version !== 2) return;
    t.form.body = certSanitizeBody(b.innerHTML);
    refreshState();
    checkOverflow();
  }

  function scheduleSync() {
    clearTimeout(S.syncTimer);
    S.syncTimer = setTimeout(syncDraft, 250);
  }

  function refreshState() {
    const t = current();
    const dirty = t ? isDirty(t.slug) : false;
    const st = $("#cfw-state");
    if (st) {
      st.dataset.state = dirty ? "dirty" : "clean";
      st.textContent = dirty ? "Unsaved changes" : "All changes saved";
    }
    ["#cfw-save", "#cfw-discard"].forEach((id) => {
      const b = $(id);
      if (b) b.disabled = !dirty;
    });
    const sel = $("#cfw-select");
    if (sel)
      Array.from(sel.options).forEach((o) => {
        const x = savedType(o.value);
        if (x) o.textContent = `${(S.drafts[x.slug] || x).label}${x.active === false ? " (hidden)" : ""}${isDirty(x.slug) ? " •" : ""}`;
      });
  }

  function checkOverflow() {
    const content = $("#cfw-content");
    const end = $("#cfw-page-end");
    const warn = $("#cfw-overflow");
    if (!content || !end) return;
    // Both measured inside the zoomed page, so the zoom doesn't matter.
    const over = content.offsetTop + content.offsetHeight > end.offsetTop + 1;
    end.classList.toggle("is-over", over);
    if (warn) warn.hidden = !over;
  }

  // ── Selection ──────────────────────────────────────────────────────────
  document.addEventListener("selectionchange", () => {
    if (!visible()) return;
    const b = body();
    const sel = window.getSelection();
    if (!b || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (!b.contains(r.commonAncestorContainer)) return;
    S.range = r.cloneRange();
    updateRibbonState();
  });

  function restoreRange() {
    const b = body();
    if (!b) return null;
    b.focus({ preventScroll: true });
    const sel = window.getSelection();
    if (S.range && b.contains(S.range.commonAncestorContainer)) {
      sel.removeAllRanges();
      sel.addRange(S.range);
    } else {
      const r = document.createRange();
      r.selectNodeContents(b.lastElementChild || b);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
      S.range = r.cloneRange();
    }
    return sel.getRangeAt(0);
  }

  const elementAt = (node) => node && (node.nodeType === 1 ? node : node.parentElement);

  function selectedBlocks() {
    const b = body();
    const r = S.range;
    if (!b || !r) return [];
    const blocks = Array.from(b.querySelectorAll("p")).filter((p) => r.intersectsNode(p));
    if (!blocks.length) {
      const el = elementAt(r.startContainer);
      const cell = el && el.closest("td");
      if (cell && b.contains(cell)) blocks.push(cell);
    }
    return blocks;
  }

  function currentCell() {
    const b = body();
    const el = S.range && elementAt(S.range.startContainer);
    const td = el && el.closest("td");
    return td && b && b.contains(td) ? td : null;
  }

  function updateRibbonState() {
    const r = $("#cfw-ribbon");
    if (!r || !S.range) return;
    const press = (cmd, on) => {
      const btn = r.querySelector(`[data-cmd="${cmd}"]`);
      if (btn) btn.setAttribute("aria-pressed", on ? "true" : "false");
    };
    try {
      press("bold", document.queryCommandState("bold"));
      press("italic", document.queryCommandState("italic"));
      press("underline", document.queryCommandState("underline"));
    } catch (_) {
      /* not every browser answers for a contenteditable selection */
    }
    const el = elementAt(S.range.startContainer);
    if (!el) return;
    const cs = getComputedStyle(el);
    const block = el.closest("p, td") || el;
    const bs = getComputedStyle(block);
    const align = bs.textAlign === "start" ? "left" : bs.textAlign === "end" ? "right" : bs.textAlign;
    ["left", "center", "right", "justify"].forEach((a) => press("align-" + a, align === a));
    press("firstline", parseFloat(bs.textIndent) > 0);
    // Font and size shown as the selection's; blank when not in the lists.
    const fontSel = $("#cfw-font");
    if (fontSel && document.activeElement !== fontSel) {
      const first = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim().toLowerCase();
      const match = FONTS.find(([l]) => l.toLowerCase() === first);
      fontSel.value = match ? match[1] : "";
    }
    const sizeSel = $("#cfw-size");
    if (sizeSel && document.activeElement !== sizeSel) {
      const pt = Math.round(((parseFloat(cs.fontSize) * 72) / 96) * 2) / 2;
      sizeSel.value = SIZES.includes(pt) ? pt + "pt" : "";
    }
    const cell = currentCell();
    const tools = $("#cfw-table-tools");
    if (tools) tools.hidden = !cell;
    if (cell) {
      press("borders", tableHasBorders(cell.closest("table")));
      const input = $("#cfw-colw");
      if (input && document.activeElement !== input) input.value = /mm$/.test(cell.style.width) ? parseFloat(cell.style.width) : "";
    }
  }

  // ── History ────────────────────────────────────────────────────────────
  function pathOf(node, root) {
    const path = [];
    while (node && node !== root) {
      if (!node.parentNode) return null;
      path.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes, node));
      node = node.parentNode;
    }
    return node === root ? path : null;
  }

  function nodeAt(path, root) {
    let n = root;
    for (const i of path || []) {
      n = n && n.childNodes[i];
      if (!n) return null;
    }
    return n;
  }

  function pushHistory() {
    clearTimeout(S.historyTimer);
    S.historyTimer = null;
    const t = current();
    const b = body();
    if (!t || !b || b.hidden) return;
    const h = S.history[t.slug] || (S.history[t.slug] = { stack: [], index: -1 });
    const html = b.innerHTML;
    if (h.stack[h.index] && h.stack[h.index].html === html) return;
    const r = S.range;
    h.stack = h.stack.slice(0, h.index + 1);
    h.stack.push({
      html,
      sel:
        r && b.contains(r.commonAncestorContainer)
          ? { s: pathOf(r.startContainer, b), so: r.startOffset, e: pathOf(r.endContainer, b), eo: r.endOffset }
          : null,
    });
    if (h.stack.length > 200) h.stack.shift();
    h.index = h.stack.length - 1;
  }

  function scheduleHistory() {
    clearTimeout(S.historyTimer);
    S.historyTimer = setTimeout(pushHistory, 500);
  }

  function travel(dir) {
    const t = current();
    const b = body();
    if (!t || !b || b.hidden) return;
    if (S.historyTimer) pushHistory();
    const h = S.history[t.slug];
    if (!h) return;
    const next = h.index + dir;
    if (next < 0 || next >= h.stack.length) return;
    h.index = next;
    const snap = h.stack[next];
    b.innerHTML = snap.html;
    b.focus({ preventScroll: true });
    const sel = window.getSelection();
    const r = document.createRange();
    const sn = snap.sel && nodeAt(snap.sel.s, b);
    const en = snap.sel && nodeAt(snap.sel.e, b);
    try {
      if (!sn || !en) throw new Error("no selection to restore");
      r.setStart(sn, Math.min(snap.sel.so, sn.nodeType === 3 ? sn.length : sn.childNodes.length));
      r.setEnd(en, Math.min(snap.sel.eo, en.nodeType === 3 ? en.length : en.childNodes.length));
    } catch (_) {
      r.selectNodeContents(b);
      r.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(r);
    S.range = r.cloneRange();
    syncDraft();
    renderSide();
  }

  // Around every toolbar change: the state before it is one undo step, and the
  // state after it another.
  function change(fn) {
    if (!canEdit() || S.preview) return;
    pushHistory();
    fn();
    const b = body();
    if (b) {
      normalise(b);
      decorateFields(b);
    }
    pushHistory();
    syncDraft();
    updateRibbonState();
  }

  const MARKER = "__cfw_marker__";

  // execCommand leaves <font>/<div> behind in places; tidy them as they appear.
  function normalise(b) {
    b.querySelectorAll("font").forEach((font) => {
      const span = document.createElement("span");
      const face = font.getAttribute("face");
      if (face && face !== MARKER) span.style.fontFamily = face;
      while (font.firstChild) span.appendChild(font.firstChild);
      font.replaceWith(span);
    });
    Array.from(b.children).forEach((c) => {
      if (c.tagName === "DIV") {
        const p = document.createElement("p");
        if (c.getAttribute("style")) p.setAttribute("style", c.getAttribute("style"));
        while (c.firstChild) p.appendChild(c.firstChild);
        c.replaceWith(p);
      }
    });
    ensureEditable(b);
  }

  // ── Formatting commands ────────────────────────────────────────────────
  // Inline styles the browser has no command for (a size in points, character
  // spacing): mark the selection with a throwaway font name, then turn each
  // mark into a span carrying the style. A cursor with nothing selected styles
  // its whole paragraph, which is nearly always what is meant.
  function inlineStyle(prop, value) {
    change(() => {
      const r = restoreRange();
      if (!r) return;
      if (r.collapsed) {
        selectedBlocks().forEach((blk) => {
          blk.style.setProperty(prop, value);
          blk.querySelectorAll("[style]").forEach((d) => {
            if (!d.hasAttribute("data-field")) d.style.removeProperty(prop);
          });
        });
        return;
      }
      document.execCommand("styleWithCSS", false, false);
      document.execCommand("fontName", false, MARKER);
      const b = body();
      const made = [];
      b.querySelectorAll(`font[face="${MARKER}"]`).forEach((font) => {
        const span = document.createElement("span");
        span.style.setProperty(prop, value);
        while (font.firstChild) span.appendChild(font.firstChild);
        span.querySelectorAll("[style]").forEach((d) => {
          if (!d.hasAttribute("data-field")) d.style.removeProperty(prop);
        });
        font.replaceWith(span);
        made.push(span);
      });
      // Chrome sometimes marks with a style rather than a <font>.
      b.querySelectorAll("span").forEach((s) => {
        if (s.style.fontFamily && s.style.fontFamily.includes(MARKER)) {
          s.style.removeProperty("font-family");
          s.style.setProperty(prop, value);
          made.push(s);
        }
      });
      if (made.length) {
        const nr = document.createRange();
        nr.setStartBefore(made[0]);
        nr.setEndAfter(made[made.length - 1]);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(nr);
        S.range = nr.cloneRange();
      }
    });
  }

  function blockStyle(prop, value) {
    change(() => {
      restoreRange();
      selectedBlocks().forEach((blk) => {
        if (value === "" || value == null) blk.style.removeProperty(prop);
        else blk.style.setProperty(prop, value);
      });
    });
  }

  function mmOf(value) {
    const v = String(value || "");
    if (/mm$/.test(v)) return parseFloat(v);
    if (/px$/.test(v)) return (parseFloat(v) * 25.4) / 96;
    if (/pt$/.test(v)) return (parseFloat(v) * 25.4) / 72;
    if (/cm$/.test(v)) return parseFloat(v) * 10;
    return 0;
  }

  function runCommand(cmd) {
    if (!canEdit() || S.preview) return;
    switch (cmd) {
      case "undo":
        return travel(-1);
      case "redo":
        return travel(1);
      case "bold":
      case "italic":
      case "underline":
        return change(() => {
          restoreRange();
          document.execCommand("styleWithCSS", false, false);
          document.execCommand(cmd);
        });
      case "align-left":
      case "align-center":
      case "align-right":
      case "align-justify":
        return blockStyle("text-align", cmd.slice(6));
      case "firstline":
        return change(() => {
          restoreRange();
          const blocks = selectedBlocks();
          const on = blocks.length && blocks.every((b) => parseFloat(getComputedStyle(b).textIndent) > 0);
          blocks.forEach((b) => (on ? b.style.removeProperty("text-indent") : b.style.setProperty("text-indent", FIRST_LINE_INDENT)));
        });
      case "indent":
      case "outdent":
        return change(() => {
          restoreRange();
          selectedBlocks().forEach((b) => {
            const next = Math.max(0, Math.round(mmOf(b.style.marginLeft) + (cmd === "indent" ? INDENT_STEP_MM : -INDENT_STEP_MM)));
            if (next) b.style.setProperty("margin-left", next + "mm");
            else b.style.removeProperty("margin-left");
          });
        });
      case "clear":
        return change(() => {
          restoreRange();
          document.execCommand("removeFormat");
          selectedBlocks().forEach((b) => b.removeAttribute("style"));
        });
      case "field":
        syncDraft();
        restoreRange();
        return openFieldDialog(null);
      case "table":
        return openTableDialog();
      case "row-above":
      case "row-below":
        return change(() => addRow(cmd === "row-below"));
      case "col-left":
      case "col-right":
        return change(() => addColumn(cmd === "col-right"));
      case "del-row":
        return change(deleteRow);
      case "del-col":
        return change(deleteColumn);
      case "borders":
        return change(toggleBorders);
      case "del-table":
        return change(() => {
          const cell = currentCell();
          if (cell) cell.closest("table").remove();
          S.range = null;
        });
    }
  }

  // ── Tables ─────────────────────────────────────────────────────────────
  const CELL_BORDER = "1px solid #000";

  function tableHasBorders(table) {
    return !!(
      table &&
      Array.from(table.querySelectorAll("td")).some(
        (td) => td.style.borderTopStyle === "solid" || td.style.borderBottomStyle === "solid"
      )
    );
  }

  function newCellLike(td) {
    const c = document.createElement("td");
    ["width", "border-top", "border-right", "border-bottom", "border-left", "padding-top", "padding-right", "padding-bottom", "padding-left", "vertical-align", "text-align", "line-height"].forEach((p) => {
      const v = td && td.style.getPropertyValue(p);
      if (v) c.style.setProperty(p, v);
    });
    c.appendChild(document.createElement("br"));
    return c;
  }

  function insertTable(rows, cols, bordered) {
    change(() => {
      restoreRange();
      const b = body();
      const table = document.createElement("table");
      table.style.width = "100%";
      const tbody = table.appendChild(document.createElement("tbody"));
      for (let i = 0; i < rows; i++) {
        const tr = tbody.appendChild(document.createElement("tr"));
        for (let j = 0; j < cols; j++) {
          const td = tr.appendChild(document.createElement("td"));
          td.style.width = Math.round((100 / cols) * 100) / 100 + "%";
          if (bordered) {
            td.style.border = CELL_BORDER;
            td.style.padding = "1mm 2mm";
          }
          td.appendChild(document.createElement("br"));
        }
      }
      // After the paragraph (or table) the cursor is in; an empty paragraph is
      // replaced by the table.
      let block = elementAt(S.range && S.range.startContainer);
      while (block && block.parentNode !== b) block = block.parentNode;
      if (!block) b.appendChild(table);
      else if (block.tagName === "P" && !block.textContent.trim() && !block.querySelector("span[data-field]")) block.replaceWith(table);
      else block.after(table);
      if (!table.nextElementSibling) {
        const p = document.createElement("p");
        p.appendChild(document.createElement("br"));
        table.after(p);
      }
      const r = document.createRange();
      r.setStart(table.querySelector("td"), 0);
      r.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      S.range = r.cloneRange();
    });
  }

  function addRow(below) {
    const cell = currentCell();
    if (!cell) return;
    const tr = cell.parentNode;
    const row = document.createElement("tr");
    Array.from(tr.cells).forEach((td) => row.appendChild(newCellLike(td)));
    if (below) tr.after(row);
    else tr.before(row);
  }

  function addColumn(right) {
    const cell = currentCell();
    if (!cell) return;
    const table = cell.closest("table");
    const idx = cell.cellIndex;
    const rows = Array.from(table.rows);
    rows.forEach((tr) => {
      const ref = tr.cells[Math.min(idx, tr.cells.length - 1)];
      const c = newCellLike(ref);
      if (!ref) tr.appendChild(c);
      else if (right) ref.after(c);
      else ref.before(c);
    });
    // A percentage split is shared out evenly again.
    const cols = Math.max(...rows.map((tr) => tr.cells.length));
    rows.forEach((tr) =>
      Array.from(tr.cells).forEach((td) => {
        if (!td.style.width || /%$/.test(td.style.width)) td.style.width = Math.round((100 / cols) * 100) / 100 + "%";
      })
    );
  }

  function deleteRow() {
    const cell = currentCell();
    if (!cell) return;
    const table = cell.closest("table");
    cell.parentNode.remove();
    if (!table.rows.length) table.remove();
    S.range = null;
  }

  function deleteColumn() {
    const cell = currentCell();
    if (!cell) return;
    const table = cell.closest("table");
    const idx = cell.cellIndex;
    Array.from(table.rows).forEach((tr) => {
      if (tr.cells[idx]) tr.cells[idx].remove();
      if (!tr.cells.length) tr.remove();
    });
    if (!table.rows.length) table.remove();
    S.range = null;
  }

  function toggleBorders() {
    const cell = currentCell();
    if (!cell) return;
    const table = cell.closest("table");
    const on = !tableHasBorders(table);
    table.querySelectorAll("td").forEach((td) => {
      if (td.closest("table") !== table) return;
      if (on) {
        td.style.border = CELL_BORDER;
        if (!td.style.paddingTop) td.style.padding = "1mm 2mm";
      } else {
        ["border-top", "border-right", "border-bottom", "border-left"].forEach((p) => td.style.removeProperty(p));
      }
    });
  }

  function setColumnWidth(mm) {
    change(() => {
      const cell = currentCell();
      if (!cell) return;
      const table = cell.closest("table");
      const idx = cell.cellIndex;
      Array.from(table.rows).forEach((tr) => {
        const td = tr.cells[idx];
        if (!td) return;
        if (mm > 0) td.style.width = mm + "mm";
        else td.style.removeProperty("width");
      });
    });
  }

  function openTableDialog() {
    restoreRange();
    const saved = S.range && S.range.cloneRange();
    if (typeof uiPrompt !== "function") return insertTable(2, 2, false);
    uiPrompt({
      icon: "plus",
      title: "Insert a table",
      message: "Rows × columns. A table without borders is how side-by-side signatures and label lists (NAME: ______) are lined up.",
      field: { label: "Size", value: "2 x 2", placeholder: "e.g. 3 x 2", hint: 'Add "border" for lines round the cells — "1 x 1 border" makes a box.' },
      validate: (v) => (/^\s*\d{1,2}\s*[x×*]\s*\d{1,2}(\s+borders?)?\s*$/i.test(v) ? null : 'Type rows × columns, like "2 x 3".'),
      confirmLabel: "Insert",
      confirmIcon: "plus",
    }).then((v) => {
      if (!v) return;
      const m = /(\d+)\s*[x×*]\s*(\d+)/i.exec(v);
      S.range = saved;
      insertTable(Math.max(1, Math.min(30, +m[1])), Math.max(1, Math.min(8, +m[2])), /border/i.test(v));
    });
  }

  // ── Fill-in field dialog ───────────────────────────────────────────────
  const fieldsOf = (t) => (t && t.form && t.form.fields) || [];

  function usesOf(key) {
    const b = body();
    return b ? b.querySelectorAll(`span[data-field="${key}"]`).length : 0;
  }

  function ensureDialog() {
    let el = document.getElementById("cfw-field-dialog");
    if (el) return el;
    el = document.createElement("div");
    el.className = "modal-backdrop";
    el.id = "cfw-field-dialog";
    el.innerHTML = `
      <div class="modal-box cfw-dialog" role="dialog" aria-modal="true" aria-labelledby="cfw-fd-title">
        <div class="modal-header">
          <div class="modal-title"><div class="modal-title-icon">${icon("field")}</div> <span id="cfw-fd-title">Fill-in field</span></div>
          <button type="button" class="modal-close" data-fd="cancel" aria-label="Close"><i data-icon=x></i></button>
        </div>
        <div class="modal-body cfw-fd-body">
          <div class="form-group">
            <label class="form-label" for="cfw-fd-which">Field</label>
            <select class="form-control" id="cfw-fd-which"></select>
          </div>
          <div class="form-group">
            <label class="form-label" for="cfw-fd-label">Name</label>
            <input class="form-control" id="cfw-fd-label" maxlength="120" placeholder="e.g. Name of applicant" />
            <p class="cfw-hint">What the box is called when a request is being prepared.</p>
          </div>

          <div class="cfw-fd-section">
            <div class="form-label">Space it takes up</div>
            <div class="cfw-fd-width">
              <input class="form-control" type="number" id="cfw-fd-width" min="0" max="170" step="0.5" />
              <span>mm</span>
              <div class="cfw-fd-presets">
                <button type="button" class="cfw-chip" data-width="0" aria-pressed="false">Fit to text</button>
                <button type="button" class="cfw-chip" data-width="15" aria-pressed="false">15 mm</button>
                <button type="button" class="cfw-chip" data-width="25" aria-pressed="false">25 mm</button>
                <button type="button" class="cfw-chip" data-width="40" aria-pressed="false">40 mm</button>
                <button type="button" class="cfw-chip" data-width="66" aria-pressed="false">66 mm</button>
                <button type="button" class="cfw-chip" data-width="90" aria-pressed="false">90 mm</button>
                <button type="button" class="cfw-chip" data-width="170" aria-pressed="false">Whole line</button>
              </div>
            </div>
            <div class="cfw-fd-ruler" aria-hidden="true"><div class="cfw-fd-bar" id="cfw-fd-bar"></div></div>
            <p class="cfw-hint">A full line of text on the certificate is 170 mm.</p>
            <label class="cfw-check"><input type="checkbox" id="cfw-fd-underline" /> <span>Underline it</span></label>
          </div>

          <div class="cfw-fd-section">
            <label class="cfw-check"><input type="checkbox" id="cfw-fd-manual" /> <span>Leave it blank — written by hand after printing (a signature, a CTC number)</span></label>
          </div>

          <div class="cfw-fd-section" id="cfw-fd-fill">
            <div class="form-group">
              <label class="form-label" for="cfw-fd-source">Fill it in automatically with</label>
              <select class="form-control" id="cfw-fd-source"></select>
            </div>
            <div class="form-group">
              <label class="form-label" for="cfw-fd-value">Default text</label>
              <input class="form-control" id="cfw-fd-value" maxlength="300" />
              <p class="cfw-hint" id="cfw-fd-value-hint"></p>
            </div>
            <div class="form-group">
              <label class="form-label" for="cfw-fd-options">Choices (optional)</label>
              <textarea class="form-control" id="cfw-fd-options" rows="3" placeholder="One per line — e.g.&#10;He&#10;She"></textarea>
              <p class="cfw-hint">With choices, the person preparing the request picks one instead of typing.</p>
            </div>
          </div>
          <p class="cfw-hint cfw-fd-shared" id="cfw-fd-shared" hidden></p>
          <p class="cfw-fd-error" id="cfw-fd-error" hidden></p>
        </div>
        <div class="modal-footer cfw-fd-footer">
          <button type="button" class="btn btn-outline btn-danger-outline" data-fd="remove" id="cfw-fd-remove"><i data-icon=trash></i> Remove from the page</button>
          <span class="cfw-fd-spacer"></span>
          <button type="button" class="btn btn-outline" data-fd="cancel">Cancel</button>
          <button type="button" class="btn btn-gold" data-fd="ok" id="cfw-fd-ok"><i data-icon=check></i> Insert</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    hydrate(el);
    el.addEventListener("click", (e) => {
      if (e.target === el) return closeFieldDialog();
      const act = e.target.closest("[data-fd]");
      if (act) {
        if (act.dataset.fd === "cancel") return closeFieldDialog();
        if (act.dataset.fd === "ok") return confirmFieldDialog();
        if (act.dataset.fd === "remove") return removeFieldFromDialog();
      }
      const preset = e.target.closest("[data-width]");
      if (preset && el.contains(preset)) {
        el.querySelector("#cfw-fd-width").value = preset.dataset.width;
        dialogWidthChanged();
      }
    });
    el.addEventListener("input", (e) => {
      if (e.target.id === "cfw-fd-width") dialogWidthChanged();
      if (e.target.id === "cfw-fd-manual") dialogManualChanged();
      if (e.target.id === "cfw-fd-source") dialogSourceChanged();
    });
    el.addEventListener("change", (e) => {
      if (e.target.id === "cfw-fd-which") dialogWhichChanged();
      if (e.target.id === "cfw-fd-manual") dialogManualChanged();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type !== "checkbox") {
        e.preventDefault();
        confirmFieldDialog();
      }
    });
    return el;
  }

  function dialogWidthChanged() {
    const el = document.getElementById("cfw-field-dialog");
    const w = Math.max(0, Math.min(170, Number(el.querySelector("#cfw-fd-width").value) || 0));
    const bar = el.querySelector("#cfw-fd-bar");
    bar.style.width = w ? (w / 170) * 100 + "%" : "";
    bar.classList.toggle("is-fit", !w);
    // The preset matching the width is shown as chosen — "Fit to text" when it
    // is 0 — so what the field is set to reads at a glance.
    el.querySelectorAll(".cfw-fd-presets [data-width]").forEach((chip) => {
      const on = Number(chip.dataset.width) === w;
      chip.classList.toggle("is-active", on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function dialogManualChanged() {
    const el = document.getElementById("cfw-field-dialog");
    const manual = el.querySelector("#cfw-fd-manual").checked;
    el.querySelector("#cfw-fd-fill").classList.toggle("is-off", manual);
    el.querySelectorAll("#cfw-fd-fill input, #cfw-fd-fill select, #cfw-fd-fill textarea").forEach((c) => (c.disabled = manual));
  }

  function dialogSourceChanged() {
    const el = document.getElementById("cfw-field-dialog");
    el.querySelector("#cfw-fd-value-hint").textContent = el.querySelector("#cfw-fd-source").value
      ? "Used when the automatic value is empty — a walk-in with no resident record, say."
      : "What it starts as when a request is prepared. Can be left empty.";
  }

  // Fill the shared (per-field) inputs from a field, or clear them for a new one.
  function dialogLoadField(f) {
    const el = document.getElementById("cfw-field-dialog");
    el.querySelector("#cfw-fd-label").value = f ? f.label : "";
    el.querySelector("#cfw-fd-source").value = f ? f.source || "" : "";
    el.querySelector("#cfw-fd-value").value = f ? f.value || "" : "";
    el.querySelector("#cfw-fd-options").value = f ? (f.options || []).join("\n") : "";
    el.querySelector("#cfw-fd-manual").checked = !!(f && f.manual);
    dialogManualChanged();
    dialogSourceChanged();
    const chip = S.dialog && S.dialog.chip;
    const others = f ? usesOf(f.key) - (chip && chip.getAttribute("data-field") === f.key ? 1 : 0) : 0;
    const shared = el.querySelector("#cfw-fd-shared");
    shared.hidden = !others;
    shared.textContent = others
      ? `“${f.label}” also appears ${others === 1 ? "once more" : others + " more times"} on this page. Its name, automatic value, default text and choices change everywhere it appears; the space and underline are set for this spot only.`
      : "";
  }

  function dialogWhichChanged() {
    const el = document.getElementById("cfw-field-dialog");
    const key = el.querySelector("#cfw-fd-which").value;
    dialogLoadField(fieldsOf(current()).find((f) => f.key === key) || null);
    el.querySelector("#cfw-fd-label").focus();
  }

  function openFieldDialog(chip) {
    if (!canEdit() || S.preview) return;
    const t = current();
    if (!t || !t.form) return;
    const el = ensureDialog();
    S.dialog = { chip, range: S.range ? S.range.cloneRange() : null };
    const onPage = fieldsOf(t).filter((f) => usesOf(f.key) > 0);
    const key = chip ? chip.getAttribute("data-field") : "";
    el.querySelector("#cfw-fd-title").textContent = chip ? "Fill-in field" : "Insert a fill-in field";
    el.querySelector("#cfw-fd-ok").innerHTML = `<i data-icon=check></i> ${chip ? "Save" : "Insert"}`;
    el.querySelector("#cfw-fd-remove").hidden = !chip;
    el.querySelector("#cfw-fd-which").innerHTML =
      `<option value="">A new field</option>` +
      onPage.map((f) => `<option value="${esc(f.key)}">The same as: ${esc(f.label)}</option>`).join("");
    el.querySelector("#cfw-fd-which").value = key;
    el.querySelector("#cfw-fd-source").innerHTML =
      `<option value="">Nothing — typed in when the request is prepared</option>` +
      CERT_FIELD_SOURCES.map((s) => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join("");
    dialogLoadField(key ? fieldsOf(t).find((x) => x.key === key) || null : null);
    el.querySelector("#cfw-fd-width").value = chip ? Number(chip.getAttribute("data-width")) || 0 : 40;
    el.querySelector("#cfw-fd-underline").checked = chip ? chip.getAttribute("data-underline") !== "0" : true;
    dialogWidthChanged();
    el.querySelector("#cfw-fd-error").hidden = true;
    hydrate(el);
    el.classList.add("open");
    setTimeout(() => el.querySelector(chip ? "#cfw-fd-width" : "#cfw-fd-label").focus(), 30);
  }

  function closeFieldDialog() {
    const el = document.getElementById("cfw-field-dialog");
    if (el) el.classList.remove("open");
    S.dialog = null;
  }

  function confirmFieldDialog() {
    const el = document.getElementById("cfw-field-dialog");
    const t = current();
    if (!el || !t || !S.dialog) return;
    const err = el.querySelector("#cfw-fd-error");
    const label = el.querySelector("#cfw-fd-label").value.trim();
    if (!label) {
      err.textContent = "Give the field a name — it is how the box is labelled when a request is prepared.";
      err.hidden = false;
      el.querySelector("#cfw-fd-label").focus();
      return;
    }
    const manual = el.querySelector("#cfw-fd-manual").checked;
    const settings = {
      label,
      source: manual ? "" : el.querySelector("#cfw-fd-source").value,
      value: manual ? "" : el.querySelector("#cfw-fd-value").value,
      options: manual
        ? []
        : el.querySelector("#cfw-fd-options").value.split("\n").map((o) => o.trim()).filter(Boolean),
      manual,
    };
    const width = Math.max(0, Math.min(170, Math.round((Number(el.querySelector("#cfw-fd-width").value) || 0) * 10) / 10));
    const underline = el.querySelector("#cfw-fd-underline").checked;
    let key = el.querySelector("#cfw-fd-which").value;
    const { chip, range } = S.dialog;
    closeFieldDialog();

    change(() => {
      const fields = t.form.fields || (t.form.fields = []);
      const existing = key && fields.find((f) => f.key === key);
      if (existing) Object.assign(existing, settings);
      else {
        key = keyFromLabel(label, fields.map((f) => f.key));
        fields.push(Object.assign({ key }, settings));
      }
      const target = chip || document.createElement("span");
      target.setAttribute("data-field", key);
      target.setAttribute("data-width", String(width));
      target.setAttribute("data-underline", underline ? "1" : "0");
      if (!chip) {
        const b = body();
        let r = range && b.contains(range.commonAncestorContainer) ? range : null;
        if (!r) {
          r = document.createRange();
          r.selectNodeContents(b.lastElementChild || b);
          r.collapse(false);
        }
        r.deleteContents();
        r.insertNode(target);
        const after = document.createRange();
        after.setStartAfter(target);
        after.collapse(true);
        S.range = after;
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(after);
      }
    });
    renderSide();
  }

  function removeFieldFromDialog() {
    const chip = S.dialog && S.dialog.chip;
    closeFieldDialog();
    if (!chip) return;
    change(() => chip.remove());
    renderSide();
  }

  // ── Side panel ─────────────────────────────────────────────────────────
  function renderSide() {
    const side = $("#cfw-side");
    if (!side) return;
    const t = current();
    const edit = canEdit();
    side.innerHTML = `
      <div class="sc-tabs cfw-side-tabs" role="tablist">
        <button type="button" class="sc-tab${S.side === "fields" ? " is-active" : ""}" data-act="side" data-side="fields">Fill-in fields</button>
        <button type="button" class="sc-tab${S.side === "details" ? " is-active" : ""}" data-act="side" data-side="details">Details</button>
      </div>
      <div class="cfw-side-body">${!t ? "" : S.side === "fields" ? sideFieldsHtml(t, edit) : sideDetailsHtml(t, edit)}</div>`;
    hydrate(side);
  }

  function sideFieldsHtml(t, edit) {
    if (!t.form) return '<p class="cfw-hint">This certificate has no printable form, so it has no fields. Tick “Has a printable form” under Details to start one.</p>';
    const b = body();
    const keys = b && !b.hidden ? certBodyFieldKeys(certSanitizeBody(b.innerHTML)) : certBodyFieldKeys(t.form.body);
    const byKey = {};
    fieldsOf(t).forEach((f) => (byKey[f.key] = f));
    const sourceLabel = (k) => (CERT_FIELD_SOURCE_MAP[k] || {}).label || "";
    return `
      ${edit ? `<button type="button" class="btn btn-sm btn-gold cfw-side-insert" data-cmd="field">${icon("field")} Insert fill-in field</button>` : ""}
      <p class="cfw-hint">Click on the page where the blank should go, then insert it. Click a field on the page to change or remove it.</p>
      <div class="cfw-field-list">
        ${
          keys.length
            ? keys
                .map((k) => {
                  const f = byKey[k] || { label: k };
                  const n = usesOf(k);
                  const meta = f.manual
                    ? "Written by hand"
                    : [
                        f.source ? "Auto: " + sourceLabel(f.source) : "",
                        f.value ? `Default: “${f.value}”` : "",
                        (f.options || []).length ? `${f.options.length} choices` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Typed in when preparing";
                  return `<button type="button" class="cfw-field-item" data-act="find-field" data-key="${esc(k)}">
                            <span class="cfw-field-item-label">${esc(f.label)}</span>
                            <span class="cfw-field-item-meta">${esc(meta)}${n > 1 ? ` · on the page ${n}×` : ""}</span>
                          </button>`;
                })
                .join("")
            : '<p class="cfw-hint">No fields on this page yet.</p>'
        }
      </div>`;
  }

  function sideDetailsHtml(t, edit) {
    const dis = edit ? "" : "disabled";
    const reqs = t.requirements || [];
    return `
      <div class="form-group">
        <label class="form-label">Full name</label>
        <input class="form-control" data-detail="label" value="${esc(t.label)}" maxlength="160" ${dis} />
      </div>
      <div class="form-group">
        <label class="form-label">Short name</label>
        <input class="form-control" data-detail="short" value="${esc(t.short)}" maxlength="60" ${dis} />
        <p class="cfw-hint">For tight spots — the queue filter, charts.</p>
      </div>
      <label class="cfw-check"><input type="checkbox" data-detail="active" ${t.active !== false ? "checked" : ""} ${dis} /> <span>Offer it on the request form</span></label>
      <label class="cfw-check"><input type="checkbox" data-detail="hasForm" ${t.form ? "checked" : ""} ${dis} /> <span>Has a printable form</span></label>

      <div class="cfw-side-section">
        <div class="form-label">Documents to attach</div>
        <p class="cfw-hint">A requester is asked for a photo of each. They can still file without a required one — they are warned.</p>
        ${reqs
          .map(
            (r, n) => `
          <div class="cfw-req">
            <div class="cfw-req-head">
              <input class="form-control" data-req="${n}" data-prop="label" value="${esc(r.label)}" placeholder="e.g. Valid ID" maxlength="160" ${dis} />
              ${edit ? `<button type="button" class="cfw-icon-btn" data-act="req-remove" data-req="${n}" title="Remove" aria-label="Remove ${esc(r.label || "document")}"><i data-icon=trash></i></button>` : ""}
            </div>
            <input class="form-control" data-req="${n}" data-prop="note" value="${esc(r.note)}" placeholder="Guidance shown under it (optional)" maxlength="300" ${dis} />
            <div class="cfw-req-checks">
              <label class="cfw-check"><input type="checkbox" data-req="${n}" data-prop="required" ${r.required ? "checked" : ""} ${dis} /> <span>Required</span></label>
              <label class="cfw-check"><input type="checkbox" data-req="${n}" data-prop="health" ${r.sensitivity === "health" ? "checked" : ""} ${dis} /> <span>Health record</span></label>
            </div>
          </div>`
          )
          .join("")}
        ${edit ? `<button type="button" class="btn btn-sm btn-outline" data-act="req-add"><i data-icon=plus></i> Add document</button>` : ""}
      </div>

      ${
        edit
          ? `<div class="cfw-side-section cfw-more">
               <button type="button" class="btn btn-sm btn-outline" data-act="duplicate"><i data-icon=file-text></i> Duplicate as a new certificate</button>
               ${t.has_original ? `<button type="button" class="btn btn-sm btn-outline" data-act="reset"><i data-icon=refresh></i> Reset to the original wording</button>` : ""}
               <button type="button" class="btn btn-sm btn-outline btn-danger-outline" data-act="delete"><i data-icon=trash></i> Delete certificate</button>
             </div>`
          : ""
      }
      <p class="cfw-hint cfw-slug">Reference: <code>${esc(t.slug)}</code></p>`;
  }

  // ── Events ─────────────────────────────────────────────────────────────
  // Toolbar buttons must not take the focus away from the page, or the
  // selection they act on is gone by the time they run.
  function onMouseDown(e) {
    if (e.target.closest(".cfw-rbtn, .cfw-side-insert")) e.preventDefault();
    const chip = e.target.closest(".cfw-field");
    const b = body();
    if (chip && b && b.contains(chip)) e.preventDefault();
  }

  function onClick(e) {
    const b = body();
    const chip = e.target.closest(".cfw-field");
    if (chip && b && b.contains(chip)) {
      const r = document.createRange();
      r.selectNode(chip);
      S.range = r;
      return openFieldDialog(chip);
    }
    const cmd = e.target.closest("[data-cmd]");
    if (cmd && S.container.contains(cmd) && !cmd.disabled) return runCommand(cmd.dataset.cmd);
    const act = e.target.closest("[data-act]");
    if (!act || !S.container.contains(act) || act.disabled) return;
    const t = current();
    switch (act.dataset.act) {
      case "side":
        syncDraft();
        S.side = act.dataset.side;
        return renderSide();
      case "preview":
        syncDraft();
        S.preview = !S.preview;
        renderBar();
        renderRibbon();
        return loadDocument();
      case "save":
        return save();
      case "discard":
        return discard();
      case "new":
        return createCertificate();
      case "find-field":
        return findField(act.dataset.key);
      case "req-add":
        t.requirements = t.requirements || [];
        t.requirements.push({ key: "", label: "", required: true, sensitivity: "normal", note: "" });
        refreshState();
        return renderSide();
      case "req-remove":
        t.requirements.splice(+act.dataset.req, 1);
        refreshState();
        return renderSide();
      case "duplicate":
        return duplicateCertificate();
      case "reset":
        return resetCertificate();
      case "delete":
        return deleteCertificate();
    }
  }

  function onChange(e) {
    const el = e.target;
    const id = el.id;
    if (id === "cfw-select") return selectCertificate(el.value);
    if (id === "cfw-zoomsel") {
      S.zoom = el.value;
      try {
        localStorage.setItem("cares.cfw.zoom", S.zoom);
      } catch (_) {
        /* per-viewer convenience */
      }
      return applyZoom();
    }
    const takeValue = () => {
      const v = el.value;
      el.value = "";
      return v;
    };
    if (id === "cfw-style" && el.value) {
      const style = STYLES[takeValue()];
      return change(() => {
        restoreRange();
        selectedBlocks().forEach((blk) =>
          Object.entries(style.css).forEach(([p, v]) => (v ? blk.style.setProperty(p, v) : blk.style.removeProperty(p)))
        );
      });
    }
    if (id === "cfw-font" && el.value) return inlineStyle("font-family", el.value);
    if (id === "cfw-size" && el.value) return inlineStyle("font-size", el.value);
    if (id === "cfw-letter" && el.value) return inlineStyle("letter-spacing", takeValue());
    if (id === "cfw-line" && el.value) return blockStyle("line-height", takeValue());
    if ((id === "cfw-before" || id === "cfw-after") && el.value) {
      const v = takeValue();
      return blockStyle(id === "cfw-before" ? "margin-top" : "margin-bottom", v === "0mm" ? "" : v);
    }
    if (id === "cfw-colw") return setColumnWidth(Number(el.value) || 0);
    if (el.dataset.detail) return detailChanged(el);
    if (el.dataset.req != null && el.type === "checkbox") return reqChanged(el);
  }

  function onInput(e) {
    const el = e.target;
    const b = body();
    if (b && (el === b || b.contains(el))) {
      scheduleSync();
      scheduleHistory();
      return;
    }
    if (el.dataset.detail && el.type !== "checkbox") return detailChanged(el);
    if (el.dataset.req != null && el.type !== "checkbox") return reqChanged(el);
  }

  function onBeforeInput(e) {
    const b = body();
    if (!b || !b.contains(e.target)) return;
    if (e.inputType === "historyUndo" || e.inputType === "historyRedo") {
      e.preventDefault();
      travel(e.inputType === "historyUndo" ? -1 : 1);
    }
  }

  function onKeyDown(e) {
    const b = body();
    if (!b || !b.contains(e.target) || !canEdit() || S.preview) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === "z") {
      e.preventDefault();
      return travel(e.shiftKey ? 1 : -1);
    }
    if (mod && k === "y") {
      e.preventDefault();
      return travel(1);
    }
    if (mod && (k === "b" || k === "i" || k === "u")) {
      e.preventDefault();
      return runCommand(k === "b" ? "bold" : k === "i" ? "italic" : "underline");
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const cell = currentCell();
      if (cell) {
        const cells = Array.from(cell.closest("table").querySelectorAll("td"));
        const next = cells[cells.indexOf(cell) + (e.shiftKey ? -1 : 1)];
        if (next) {
          const r = document.createRange();
          r.selectNodeContents(next);
          r.collapse(true);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        }
        return;
      }
      // At the start of a paragraph Tab indents its first line, as in a word
      // processor; anywhere else it inserts a wide space.
      const r = S.range;
      const blk = r && elementAt(r.startContainer) && elementAt(r.startContainer).closest("p");
      if (blk && r.collapsed) {
        const before = document.createRange();
        before.selectNodeContents(blk);
        before.setEnd(r.startContainer, r.startOffset);
        if (!before.toString().trim()) return runCommand("firstline");
      }
      document.execCommand("insertText", false, " ");
    }
  }

  // Pasted text arrives as plain text and takes the formatting of wherever it
  // is put — formatting from other programs would bring fonts and styles the
  // certificate can't use.
  function onPaste(e) {
    const b = body();
    if (!b || !b.contains(e.target)) return;
    e.preventDefault();
    if (!canEdit() || S.preview) return;
    const text = (e.clipboardData || window.clipboardData).getData("text/plain");
    if (text) document.execCommand("insertText", false, text);
  }

  function applyZoom() {
    const z = $("#cfw-zoom");
    const canvas = $("#cfw-canvas");
    const page = $("#cfw-page");
    if (!z || !canvas || !page) return;
    let factor = Number(S.zoom);
    if (S.zoom === "fit" || !factor) {
      z.style.zoom = "1";
      factor = Math.max(0.4, Math.min(1, (canvas.clientWidth - 32) / page.offsetWidth));
    }
    z.style.zoom = String(factor);
    checkOverflow();
  }

  function findField(key) {
    const b = body();
    const chip = b && !b.hidden && b.querySelector(`span[data-field="${key}"]`);
    if (!chip) return;
    chip.scrollIntoView({ block: "center", behavior: "smooth" });
    chip.classList.add("cfw-field-flash");
    setTimeout(() => chip.classList.remove("cfw-field-flash"), 1200);
    if (canEdit() && !S.preview) {
      const r = document.createRange();
      r.selectNode(chip);
      S.range = r;
      openFieldDialog(chip);
    }
  }

  function detailChanged(el) {
    const t = current();
    if (!t) return;
    const prop = el.dataset.detail;
    if (prop === "active") t.active = el.checked;
    else if (prop === "hasForm") {
      syncDraft();
      if (el.checked) t.form = t._formBackup || starterForm(t.label);
      else {
        t._formBackup = t.form;
        t.form = null;
      }
      delete S.history[t.slug];
      loadDocument();
      renderSide();
    } else t[prop] = el.value;
    refreshState();
  }

  function reqChanged(el) {
    const t = current();
    const r = t && t.requirements[+el.dataset.req];
    if (!r) return;
    const p = el.dataset.prop;
    if (p === "required") r.required = el.checked;
    else if (p === "health") r.sensitivity = el.checked ? "health" : "normal";
    else r[p] = el.value;
    refreshState();
  }

  // ── Switching, saving, the list ────────────────────────────────────────
  function selectCertificate(slug) {
    syncDraft();
    S.selected = slug;
    S.range = null;
    render();
  }

  function discard() {
    const t = current();
    if (!t) return;
    delete S.drafts[t.slug];
    delete S.history[t.slug];
    render();
  }

  async function save() {
    const t = current();
    if (!t || S.busy) return;
    syncDraft();
    if (!String(t.label || "").trim()) return fail("Give the certificate a name (under Details).");
    if ((t.requirements || []).some((r) => !String(r.label || "").trim()))
      return fail("One of the documents to attach has no name (under Details).");
    S.busy = true;
    const btn = $("#cfw-save");
    if (btn) btn.disabled = true;
    try {
      const saved = await apiPut(
        `/api/certificate-types/${encodeURIComponent(t.slug)}`,
        Object.assign(definitionOf(t), { account_id: accountId() })
      );
      await window.certTypesReload();
      delete S.drafts[t.slug];
      audit("CERT_FORM_UPDATE", `Certificate form "${saved.label}" (${saved.slug}) updated`);
      toast(`${saved.label} saved`);
      renderBar();
      refreshState();
      renderSide();
    } catch (err) {
      fail("Could not save: " + err.message);
      if (btn) btn.disabled = false;
    } finally {
      S.busy = false;
    }
  }

  async function create(def) {
    S.busy = true;
    try {
      const row = await apiPost("/api/certificate-types", Object.assign(def, { account_id: accountId() }));
      await window.certTypesReload();
      audit("CERT_FORM_CREATE", `Certificate "${row.label}" (${row.slug}) added`);
      toast(`${row.label} added — hidden from the request form until you offer it`);
      S.busy = false;
      selectCertificate(row.slug);
    } catch (err) {
      fail("Could not add the certificate: " + err.message);
    } finally {
      S.busy = false;
    }
  }

  async function createCertificate() {
    if (S.busy) return;
    syncDraft();
    const label = await uiPrompt({
      icon: "plus",
      title: "New certificate",
      message: "It starts as a basic certificate you can rewrite, and stays hidden from the request form until you offer it (under Details).",
      field: { label: "Full name", placeholder: "e.g. Certificate of Low Income", hint: "You can change it later." },
      validate: (v) => (v ? null : "Give the certificate a name."),
      confirmLabel: "Create",
      confirmIcon: "plus",
    });
    if (!label) return;
    await create({
      label,
      short: label.replace(/^(barangay\s+)?(certificate|certification)\s+(of|for|—|-)\s+/i, "") || label,
      active: false,
      requirements: [{ key: "valid-id", label: "Valid ID", required: true, sensitivity: "normal", note: "" }],
      form: starterForm(label),
    });
  }

  async function duplicateCertificate() {
    const t = current();
    if (!t) return;
    syncDraft();
    const def = definitionOf(t);
    await create(Object.assign(def, { label: `Copy of ${def.label}`, short: `Copy of ${def.short}`, active: false }));
  }

  async function resetCertificate() {
    const t = current();
    if (!t) return;
    const ok = await uiConfirm({
      tone: "accent",
      icon: "refresh",
      title: "Reset to the original wording?",
      message: "The name, documents and page go back to how this certificate shipped. Anything changed since is replaced.",
      target: { icon: "file-text", label: t.label },
      notes: [
        { icon: "info", text: "Whether it is offered on the request form stays as it is." },
        { icon: "clipboard", text: "The change is recorded in the Audit Log under your name." },
      ],
      confirmLabel: "Reset",
      confirmIcon: "refresh",
    });
    if (!ok) return;
    try {
      await apiPost(`/api/certificate-types/${encodeURIComponent(t.slug)}/reset`, { account_id: accountId() });
      await window.certTypesReload();
      delete S.drafts[t.slug];
      delete S.history[t.slug];
      audit("CERT_FORM_RESET", `Certificate form "${t.label}" (${t.slug}) reset to its original wording`, "warning");
      toast("Reset to the original wording", "<i data-icon=refresh></i>");
      render();
    } catch (err) {
      fail("Could not reset: " + err.message);
    }
  }

  async function deleteCertificate() {
    const t = current();
    if (!t) return;
    const ok = await uiConfirm({
      tone: "danger",
      icon: "trash",
      title: "Delete this certificate?",
      message: "It is removed for good. This only works for a certificate nobody has requested.",
      target: { icon: "file-text", label: t.label },
      confirmLabel: "Delete",
      confirmIcon: "trash",
    });
    if (!ok) return;
    try {
      await apiDelete(`/api/certificate-types/${encodeURIComponent(t.slug)}?account_id=${accountId() || ""}`);
    } catch (err) {
      if (/can't be deleted/i.test(err.message)) {
        const hide = await uiConfirm({
          tone: "accent",
          icon: "eye-off",
          title: "Hide it instead?",
          message: err.message,
          target: { icon: "file-text", label: t.label },
          confirmLabel: "Hide it",
          confirmIcon: "eye-off",
        });
        if (hide) {
          t.active = false;
          await save();
        }
        return;
      }
      return fail("Could not delete: " + err.message);
    }
    await window.certTypesReload();
    delete S.drafts[t.slug];
    delete S.history[t.slug];
    audit("CERT_FORM_DELETE", `Certificate "${t.label}" (${t.slug}) deleted`, "warning");
    toast(`${t.label} deleted`, "<i data-icon=trash></i>");
    S.selected = (types()[0] || {}).slug || null;
    render();
  }

  // ── Page-level wiring ──────────────────────────────────────────────────
  document.addEventListener("cert-types-loaded", () => {
    if (!visible()) return;
    if (!savedType(S.selected)) {
      S.selected = (types()[0] || {}).slug || null;
      return render();
    }
    renderBar();
  });

  window.addEventListener("resize", () => {
    if (visible() && S.zoom === "fit") applyZoom();
  });

  // ── Leaving with unsaved changes ──
  // Every way out of the page from inside the MIS asks in the MIS's own
  // dialog: the sidebar (nav), signing out (doLogout), an AI alert's link
  // (viewAiAlert), and plain links such as the brand logo. Once someone has
  // chosen to leave, the browser's own warning is not shown on top of it.
  let leaving = false;

  function unsavedLabels() {
    syncDraft();
    return Object.keys(S.drafts)
      .filter(isDirty)
      .map((slug) => S.drafts[slug].label || slug);
  }

  async function confirmLeave() {
    const names = unsavedLabels();
    if (!names.length || typeof uiConfirm !== "function") return true;
    const ok = await uiConfirm({
      tone: "danger",
      icon: "triangle-alert",
      title: "Leave without saving?",
      message:
        names.length === 1
          ? "This certificate has changes that haven't been saved. If you leave now, they are lost."
          : "These certificates have changes that haven't been saved. If you leave now, they are lost.",
      notes: names.map((n) => ({ icon: "file-text", text: n })),
      cancelLabel: "Keep editing",
      confirmLabel: "Leave without saving",
      confirmIcon: "log-out",
    });
    if (ok) leaving = true;
    return ok;
  }

  ["nav", "doLogout", "viewAiAlert"].forEach((name) => {
    const original = window[name];
    if (typeof original !== "function") return;
    window[name] = function (...args) {
      if (leaving || !unsavedLabels().length) return original.apply(this, args);
      confirmLeave().then((ok) => {
        if (ok) original.apply(this, args);
      });
    };
  });

  document.addEventListener(
    "click",
    (e) => {
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a || leaving || e.defaultPrevented) return;
      if (a.target === "_blank" || a.hasAttribute("download") || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      if (!unsavedLabels().length) return;
      e.preventDefault();
      e.stopPropagation();
      confirmLeave().then((ok) => {
        if (ok) window.location.href = a.href;
      });
    },
    true
  );

  // Closing the tab, reloading or typing an address: only the browser's own
  // warning is allowed here.
  window.addEventListener("beforeunload", (e) => {
    if (leaving) return;
    syncDraft();
    if (!anyDirty()) return;
    e.preventDefault();
    e.returnValue = "";
  });

  return {
    mount,
    hasUnsavedChanges: () => {
      syncDraft();
      return anyDirty();
    },
  };
})();
