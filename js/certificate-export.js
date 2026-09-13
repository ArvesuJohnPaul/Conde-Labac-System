// js/certificate-export.js
// Renders the barangay's printed certificate forms, fills in their blanks and
// prints them. Three entry points:
//
//   certOpenSheet(request)     the Certificate Request modal — the request's
//                              details, a form with one input per blank on the
//                              printed form, and a live A4 preview of the sheet
//                              that updates as you type. This is what "View"
//                              opens on the queue, and what the requester sees
//                              after filing so they can fill it in themselves.
//   certPrintRequest(request)  straight to the browser's print dialog with
//                              whatever is on file — what "Export" does.
//   certPrintCurrent()         prints the sheet currently open in the modal.
//
// Blanks are seeded from the request + the linked resident record, so usually
// only what the database can't know needs typing. Values are saved to
// certificate.form_fields on the server (PUT /api/certificates/:id/fields), so
// what the requester types is what staff print; localStorage is kept as an
// offline fallback only.
//
// The forms themselves live in js/certificate-templates.js — a type with no
// template can still be requested, it just can't be printed yet.
//
// Load order: this file, then js/certificate-templates.js.

// Certificate artwork, resolved from this script's own URL so the paths work
// from the site root (index.html) and from /pages alike — and so they are
// absolute, which the print window needs since it has no base URL of its own.
const CERT_IMG_BASE = (function () {
  const src = document.currentScript && document.currentScript.src;
  return src ? new URL("../img/", src).href : "../img/";
})();

// ── The barangay's letterhead ──────────────────────────────────────────────
const CERT_LETTERHEAD = {
  lines: [
    "Republic of the Philippines",
    "Province of Batangas",
    "Barangay Conde Labak, Batangas City",
  ],
  office: "OFFICE OF THE PUNONG BARANGAY",
  // Which side each seal goes on varies by form — see each template's `seals`.
  // A missing file hides itself instead of showing a broken image.
  sealBrgy: CERT_IMG_BASE + "seal-256.png",
  sealCity: CERT_IMG_BASE + "batangas-city-seal.png",
  watermark: CERT_IMG_BASE + "seal-256.png",
};

// Names printed on the blank form — used when /api/officials has no match.
const CERT_FALLBACK_SIGNATORIES = {
  secretary: { name: "LOPE A. LOPEZ", title: "Barangay Secretary" },
  punong: { name: "HON. VILMA F. ASI", title: "Punong Barangay" },
};

const CERT_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function certEsc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function certOrdinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// A fill-in blank on the sheet, wired to a form field by `key` so typing can
// update it in place. `w` is the printed underline width when it's empty.
function certBlank(key, value, w) {
  return (
    `<span class="cert-fill" data-field="${certEsc(key)}" style="min-width:${w}">` +
    certEsc(String(value == null ? "" : value).trim()) +
    `</span>`
  );
}

// A blank with trailing punctuation glued to it, so the two can't be split
// across lines.
function certBlankThen(key, value, w, tail) {
  return `<span class="cert-nobreak">${certBlank(key, value, w)}${certEsc(tail)}</span>`;
}

// Inline text that is part of the sentence rather than a blank (the He/She
// pronoun, the pre-printed year) — no underline, but still form-driven.
function certText(key, value) {
  return `<span data-text="${certEsc(key)}">${certEsc(value)}</span>`;
}

// The templates themselves — one entry per certificate type — live in
// js/certificate-templates.js, which is loaded straight after this file.

// "Dela Cruz, Juan P." (list shape) and the resident record both end up as
// "Juan P. Dela Cruz" — the form prints given name first.
function certFullName(res) {
  if (!res || !res.first_name) return "";
  const mi = res.middle_name ? " " + res.middle_name.charAt(0) + "." : "";
  return [res.first_name + mi, res.last_name, res.suffix]
    .filter(Boolean)
    .join(" ")
    .trim();
}

// ── Signatories ────────────────────────────────────────────────────────────
let CERT_SIGNATORIES = null;

async function certLoadSignatories() {
  if (CERT_SIGNATORIES) return CERT_SIGNATORIES;
  const pick = (rows, re) => rows.find((o) => re.test(o.role || ""));
  let secretary = CERT_FALLBACK_SIGNATORIES.secretary;
  let punong = CERT_FALLBACK_SIGNATORIES.punong;
  try {
    const rows = await apiGet("/api/officials");
    const sec = pick(rows, /secretary/i);
    const pb = pick(rows, /punong\s*barangay|captain/i);
    if (sec) secretary = { name: sec.name.toUpperCase(), title: sec.role };
    if (pb)
      punong = {
        name: ((pb.honorific ? pb.honorific + " " : "") + pb.name).toUpperCase(),
        title: pb.role,
      };
  } catch (_) {
    /* the printed names are a fine fallback */
  }
  CERT_SIGNATORIES = { secretary, punong };
  return CERT_SIGNATORIES;
}

// ── Saved blank values ─────────────────────────────────────────────────────
// certificate.form_fields on the server is the record of what belongs on the
// sheet — it has to be, since the requester and the staff who print are on
// different machines. localStorage is only a cushion for a failed save.
const CERT_FIELDS_KEY = "cares.certFields";

function certCachedFields(requestNo) {
  try {
    return JSON.parse(localStorage.getItem(CERT_FIELDS_KEY) || "{}")[requestNo] || {};
  } catch (_) {
    return {};
  }
}

function certCacheFields(requestNo, values) {
  try {
    const all = JSON.parse(localStorage.getItem(CERT_FIELDS_KEY) || "{}");
    all[requestNo] = values;
    localStorage.setItem(CERT_FIELDS_KEY, JSON.stringify(all));
  } catch (_) {
    /* a full or disabled localStorage just means no offline copy */
  }
}

// What's already on file for a request: the server's copy wins, with anything
// typed offline on this machine layered on top.
function certSavedFields(request) {
  return Object.assign(
    {},
    request.form_fields || {},
    certCachedFields(request.request_no)
  );
}

// Typing shouldn't fire a request per keystroke, so saves are coalesced. The
// cache is written immediately; only the network call waits.
let CERT_SAVE_TIMER = null;

function certSaveFields(request, values) {
  certCacheFields(request.request_no, values);
  if (!request.id) return; // not filed yet — nothing to attach it to
  clearTimeout(CERT_SAVE_TIMER);
  CERT_SAVE_TIMER = setTimeout(function () {
    certFlushFields(request, values);
  }, 700);
}

async function certFlushFields(request, values) {
  try {
    await apiPut(`/api/certificates/${request.id}/fields`, {
      form_fields: values,
      account_id: typeof actingAccountId === "function" ? actingAccountId() : null,
    });
    // Keep the in-memory row current so reopening it doesn't show stale values.
    request.form_fields = Object.assign({}, values);
    const all = JSON.parse(localStorage.getItem(CERT_FIELDS_KEY) || "{}");
    delete all[request.request_no];
    localStorage.setItem(CERT_FIELDS_KEY, JSON.stringify(all));
  } catch (err) {
    // The localStorage copy is still there; say so rather than lose it quietly.
    if (typeof showToast === "function")
      showToast(
        "Could not save the certificate details to the server — kept on this device for now.",
        "<i data-icon=triangle-alert></i>"
      );
  }
}

// Called before printing and on close so a pending save isn't lost.
function certFlushPending() {
  if (!CERT_SAVE_TIMER || !CERT_EXPORT_STATE) return;
  clearTimeout(CERT_SAVE_TIMER);
  CERT_SAVE_TIMER = null;
  certFlushFields(CERT_EXPORT_STATE.ctx.request, CERT_EXPORT_STATE.values);
}

// ── The document ───────────────────────────────────────────────────────────
// The barangay's forms share a letterhead but differ in title, salutation,
// where the two signatures sit and what is printed under them, so each of
// those is a template option rather than fixed markup.

// Which seal is printed on which side — it is not consistent across the forms.
function certSeals(which) {
  const hd = CERT_LETTERHEAD;
  return which === "brgy-left"
    ? [hd.sealBrgy, hd.sealCity]
    : [hd.sealCity, hd.sealBrgy];
}

// A signature block. `sig` is one of ctx.signatories' entries.
function certSignBlock(sig, opts) {
  const o = opts || {};
  return `
    <div class="cert-sign${o.cls ? " " + o.cls : ""}">
      ${o.rule ? '<div class="cert-sign-rule"></div>' : ""}
      <div class="cert-sign-name">${certEsc(sig.name)}</div>
      <div class="cert-sign-title">${certEsc(sig.title)}</div>
    </div>`;
}

// The four arrangements used across the forms.
function certSignaturesHtml(layout, s) {
  switch (layout) {
    // Secretary at the left margin, Punong Barangay below and indented — the
    // most common one (residency, clearance, indigency, solo parent, …).
    case "stacked":
      return `<div class="cert-signatures cert-signatures-stacked">
                ${certSignBlock(s.secretary)}
                ${certSignBlock(s.punong, { cls: "cert-sign-indent" })}
              </div>`;
    // Punong Barangay alone, over on the right.
    case "punong-right":
      return `<div class="cert-signatures cert-signatures-right">
                ${certSignBlock(s.punong)}
              </div>`;
    // Punong Barangay alone, left of centre (the RA 11261 form).
    case "punong-left":
      return `<div class="cert-signatures cert-signatures-left">
                ${certSignBlock(s.punong)}
              </div>`;
    // Secretary left, Punong Barangay right, on one line.
    default:
      return `<div class="cert-signatures">
                ${certSignBlock(s.secretary)}
                ${certSignBlock(s.punong)}
              </div>`;
  }
}

// Everything printed below the signatures. Templates list the pieces they use.
// `values` is passed so the Purpose line can be a real fill-in blank rather than
// an empty rule — it is the one footer line that gets typed rather than signed.
function certFooterHtml(parts, values) {
  const v = values || {};
  const line = (label, w) =>
    `<div class="cert-footer-line">
       <span>${certEsc(label)}</span><span class="cert-rule" style="min-width:${w}"></span>
     </div>`;
  return (parts || [])
    .map((part) => {
      switch (part) {
        case "purpose":
          return `<div class="cert-purpose">
                    <div class="cert-footer-line">
                      <span>Purpose:</span>${certBlank("purpose", v.purpose, "300px")}
                    </div>
                  </div>`;
        // The bordered box of release details.
        case "applicant-box":
          return `<div class="cert-box">
                    ${line("Signature of Applicant:", "240px")}
                    ${line("Community Tax Certificate No:", "240px")}
                    ${line("Issued On:", "240px")}
                    ${line("Issued At:", "240px")}
                  </div>`;
        case "applicant-signature":
          return `<div class="cert-caption-line">
                    <div class="cert-rule cert-rule-block"></div>
                    <div>Name and Signature of Applicant</div>
                  </div>`;
        case "patient-signature":
          return `<div class="cert-caption-line">
                    <div class="cert-rule cert-rule-block"></div>
                    <div>Name and Signature of Patient/Deceased</div>
                  </div>`;
        case "date-line":
          return `<div class="cert-caption-line cert-caption-indent">
                    <div class="cert-rule cert-rule-block"></div>
                    <div>Date</div>
                  </div>`;
        case "witness":
          return `<div class="cert-witness">
                    <div>Witnessed by:</div>
                    <div class="cert-caption-line cert-caption-right">
                      <div class="cert-rule cert-rule-block"></div>
                      <div>Barangay Official/Designation/Position</div>
                    </div>
                  </div>`;
        case "dry-seal":
          return `<div class="cert-dry-seal">*Not Valid Without Dry Seal</div>`;
        default:
          return "";
      }
    })
    .join("");
}

function certDocHtml(ctx, values) {
  const tpl = CERT_TEMPLATES[ctx.request.type];
  const hd = CERT_LETTERHEAD;
  const [sealLeft, sealRight] = certSeals(tpl.seals);
  const hide = 'onerror="this.style.visibility=\'hidden\'"';
  return `
    <div class="cert-page" id="cert-page">
      <img class="cert-watermark" src="${hd.watermark}" alt="" ${hide} />
      <div class="cert-content">
        <div class="cert-head">
          <img class="cert-seal" src="${sealLeft}" alt="" ${hide} />
          <div class="cert-head-text">
            ${hd.lines.map((l) => `<div>${certEsc(l)}</div>`).join("")}
            <div class="cert-office">${certEsc(hd.office)}</div>
          </div>
          <img class="cert-seal" src="${sealRight}" alt="" ${hide} />
        </div>
        <div class="cert-head-rule"></div>

        <h1 class="cert-title${tpl.spacedTitle ? " cert-title-spaced" : ""}">${certEsc(tpl.title)}</h1>
        ${tpl.subtitle ? `<div class="cert-subtitle">${certEsc(tpl.subtitle)}</div>` : ""}

        <div class="cert-body">
          ${tpl.salutation ? `<p class="cert-salutation">${certEsc(tpl.salutation)}</p>` : ""}
          ${tpl.render(values)}
        </div>

        <!-- A couple of forms print the applicant's signature lines above the
             Punong Barangay's block rather than below it. -->
        ${
          tpl.footerFirst
            ? certFooterHtml(tpl.footer, values) + certSignaturesHtml(tpl.signatures, ctx.signatories)
            : certSignaturesHtml(tpl.signatures, ctx.signatories) + certFooterHtml(tpl.footer, values)
        }

        <div class="cert-footnote">${certEsc(ctx.request.request_no)}</div>
      </div>
    </div>`;
}

// Styles for the sheet itself — shared verbatim by the preview and the print
// window, so what staff see is what comes out of the printer.
const CERT_DOC_CSS = `
  .cert-page {
    position: relative;
    width: 210mm;
    min-height: 297mm;
    padding: 16mm 20mm 18mm;
    box-sizing: border-box;
    background: #fff;
    color: #000;
    font-family: "Times New Roman", Times, serif;
    font-size: 12.5pt;
    line-height: 1.95;
  }
  .cert-watermark {
    position: absolute;
    top: 50%; left: 50%;
    width: 110mm;
    transform: translate(-50%, -50%);
    opacity: .085;
    pointer-events: none;
  }
  .cert-content { position: relative; }
  .cert-head {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12mm;
  }
  .cert-seal { width: 24mm; height: 24mm; object-fit: contain; }
  .cert-head-text { text-align: center; line-height: 1.35; font-size: 12pt; }
  .cert-office { font-weight: bold; letter-spacing: .3px; margin-top: 2px; }
  .cert-head-rule { border-bottom: 1.5px solid #000; margin-top: 3mm; }
  .cert-title {
    text-align: center;
    font-size: 14.5pt;
    font-weight: bold;
    margin: 9mm 0 8mm;
  }
  /* The forms whose title is set as "C E R T I F I C A T I O N". */
  .cert-title-spaced { letter-spacing: 3px; font-size: 15pt; }
  .cert-subtitle {
    text-align: center;
    font-size: 10.5pt;
    font-style: italic;
    margin: -6mm 0 8mm;
  }
  .cert-salutation { margin: 0 0 6mm; font-weight: bold; }
  .cert-para { margin: 0 0 7mm; text-align: justify; text-indent: 14mm; }
  .cert-fill {
    display: inline-block;
    border-bottom: 1px solid #000;
    padding: 0 4px;
    text-align: center;
    /* An inline-block is a block container, so it inherits .cert-para's
       text-indent and shunts its own text ~53px right of centre. */
    text-indent: 0;
    font-weight: bold;
    line-height: 1.2;
  }
  /* An empty inline-block would collapse to no height and drag its underline
     onto the baseline — a space keeps unfilled blanks the right size. */
  .cert-fill:empty::after { content: "\\00a0"; }
  /* A blank is an inline-block, so the line can break between it and the
     punctuation that follows — leaving a lone "." on the next line. */
  .cert-nobreak { white-space: nowrap; }
  /* ── Signature blocks ── */
  .cert-signatures {
    display: flex;
    justify-content: space-between;
    gap: 10mm;
    margin-top: 18mm;
    padding: 0 4mm;
    line-height: 1.3;
  }
  .cert-signatures-stacked {
    display: block;
    padding: 0;
  }
  .cert-signatures-stacked .cert-sign { text-align: left; }
  /* The Punong Barangay sits below the Secretary, both starting at the same
     left edge — an indent on only one of them reads as a mistake. */
  .cert-signatures-stacked .cert-sign-indent { margin: 12mm 0 0 0; }
  .cert-signatures-right { justify-content: flex-end; padding-right: 12mm; }
  .cert-signatures-left { justify-content: flex-start; padding-left: 24mm; }
  .cert-sign { text-align: center; }
  .cert-sign-name { font-weight: bold; }
  .cert-sign-title { font-size: 11pt; }

  /* ── Footers ── */
  .cert-rule {
    display: inline-block;
    border-bottom: 1px solid #000;
    min-width: 200px;
  }
  .cert-rule-block { display: block; width: 68mm; }
  .cert-footer-line {
    display: flex;
    align-items: baseline;
    gap: 6px;
    line-height: 2.1;
  }
  .cert-purpose { margin-top: 14mm; font-size: 11.5pt; }
  /* The label-and-blank lists ("NAME OF CHILD: ______"). */
  .cert-labels { margin: 5mm 0 6mm 14mm; }
  .cert-label-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    line-height: 2.15;
  }
  .cert-label-row > span:first-child { min-width: 42mm; }
  .cert-box {
    margin-top: 6mm;
    margin-left: 12mm;
    border: 1px solid #000;
    padding: 3mm 5mm;
    font-size: 11pt;
    width: fit-content;
  }
  .cert-caption-line { margin-top: 12mm; font-size: 10.5pt; }
  .cert-caption-indent { margin-left: 24mm; }
  .cert-caption-right { margin-left: auto; }
  .cert-witness { margin-top: 14mm; font-size: 11pt; }
  .cert-dry-seal {
    margin-top: 8mm;
    text-align: right;
    font-size: 8pt;
    font-style: italic;
  }
  .cert-footnote {
    margin-top: 10mm;
    font-size: 8.5pt;
    color: #555;
    font-family: "Courier New", monospace;
  }
  /* ── Fitting a sheet onto one page ──
     A certificate that runs a few millimetres long spills onto a second sheet
     with three lines on it, which is not a document the barangay would hand
     over. certFitToPage() tries these in order — tighten the setting, tighten
     it further, and only then scale — so the usual small overflow is absorbed
     by a slightly closer setting rather than by shrinking the whole page. */
  .cert-fit-1 { line-height: 1.75; }
  .cert-fit-1 .cert-para { margin-bottom: 5mm; }
  .cert-fit-1 .cert-title { margin: 7mm 0 6mm; }
  .cert-fit-1 .cert-signatures { margin-top: 12mm; }
  .cert-fit-1 .cert-signatures-stacked .cert-sign-indent { margin-top: 9mm; }
  .cert-fit-1 .cert-purpose { margin-top: 9mm; }
  .cert-fit-1 .cert-caption-line, .cert-fit-1 .cert-witness { margin-top: 9mm; }
  .cert-fit-1 .cert-footnote { margin-top: 6mm; }
  .cert-fit-1 .cert-labels { margin-top: 3mm; margin-bottom: 4mm; }
  .cert-fit-1 .cert-label-row { line-height: 1.95; }

  .cert-fit-2 { line-height: 1.55; font-size: 11.5pt; padding-top: 12mm; }
  .cert-fit-2 .cert-para { margin-bottom: 3.5mm; }
  .cert-fit-2 .cert-title { margin: 5mm 0 4mm; font-size: 13.5pt; }
  .cert-fit-2 .cert-signatures { margin-top: 8mm; }
  .cert-fit-2 .cert-signatures-stacked .cert-sign-indent { margin-top: 6mm; }
  .cert-fit-2 .cert-purpose { margin-top: 6mm; }
  .cert-fit-2 .cert-caption-line, .cert-fit-2 .cert-witness { margin-top: 7mm; }
  .cert-fit-2 .cert-footnote { margin-top: 4mm; }
  .cert-fit-2 .cert-seal { width: 20mm; height: 20mm; }
  .cert-fit-2 .cert-labels { margin-top: 2mm; margin-bottom: 3mm; }
  .cert-fit-2 .cert-label-row { line-height: 1.7; }

  @media print {
    @page { size: A4; margin: 0; }
    /* A fixed height, not min-height: an element even a fraction of a
       millimetre over the page produces a second, blank sheet. */
    .cert-page {
      width: auto;
      height: 297mm;
      min-height: 0;
      overflow: hidden;
      box-shadow: none;
      margin: 0;
    }
  }
`;

// The margin left around the scaled sheet, and the height of the box holding
// it. Shared by the CSS below and certFitPreview()'s arithmetic — they have to
// agree or the sheet won't sit evenly.
const CERT_STAGE_PAD = 18;
const CERT_STAGE_H = "min(74vh, 820px)";

// Layout of the fill-in workspace. Side by side on a wide screen; on a narrow
// one the two panels take turns and the Form / Certificate toggle appears.
const CERT_UI_CSS = `
  /* minmax(0,1fr), not 1fr: a plain 1fr refuses to go below the 210mm sheet's
     min-content width, so the preview would overflow instead of being scaled. */
  .cert-export-grid {
    display: grid;
    grid-template-columns: 330px minmax(0, 1fr);
    gap: 18px;
  }
  .cert-export-form { display: flex; flex-direction: column; gap: 14px; }
  .cert-field-group-title {
    font-size: 11px; font-weight: 800; letter-spacing: 1px;
    text-transform: uppercase; color: var(--accent, #b38600);
    margin: 10px 0 6px; padding-bottom: 5px;
    border-bottom: 1px solid var(--border, rgba(0,0,0,.1));
  }
  .cert-field-group-title:first-child { margin-top: 0; }
  /* The request's own details, folded away above the fill-in blanks. */
  .cert-details > summary {
    cursor: pointer;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 6px;
    user-select: none;
  }
  .cert-details > summary::-webkit-details-marker { display: none; }
  /* A chevron that turns, in place of the default disclosure triangle. */
  .cert-details > summary::before {
    content: "";
    width: 0; height: 0;
    border: 4px solid transparent;
    border-left-color: currentColor;
    transition: transform .15s ease;
  }
  .cert-details[open] > summary::before { transform: rotate(90deg); }
  .cert-detail-row {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    padding: 6px 0;
    font-size: 13px;
    border-bottom: 1px solid var(--border, rgba(0, 0, 0, .07));
  }
  .cert-detail-value { text-align: right; font-weight: 500; }
  /* A fixed box that centers the whole sheet inside it. certFitPreview() picks
     a scale that fits both dimensions, so nothing here ever needs to scroll —
     the even margin around the sheet is this padding. */
  .cert-export-stage {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: #8a8a8a;
    padding: ${CERT_STAGE_PAD}px;
    border-radius: 8px;
    height: ${CERT_STAGE_H};
    margin: 0 auto;
  }
  /* top left, not top center: certFitPreview() also sets the scaler's box to
     the scaled size, and the two only line up from the same corner. */
  .cert-export-scaler { transform-origin: top left; flex: none; }
  .cert-export-scaler .cert-page { box-shadow: 0 6px 24px rgba(0,0,0,.35); }
  /* The field list scrolls on its own — otherwise reaching the last field
     scrolls the sheet out of sight, which defeats a live preview. */
  @media (min-width: 1001px) {
    #cert-export-fields { overflow-y: auto; flex: 1; padding-right: 4px; }
    .cert-export-form { max-height: ${CERT_STAGE_H}; }
    .cert-export-stage { position: sticky; top: 0; }
  }
  .cert-pane-toggle { display: none; }
  @media (max-width: 1000px) {
    .cert-export-grid { grid-template-columns: 1fr; }
    .cert-export-grid[data-pane="form"] .cert-export-preview { display: none; }
    .cert-export-grid[data-pane="preview"] .cert-export-form { display: none; }
    .cert-pane-toggle { display: inline-flex; }
  }
`;

// ── Building a sheet ───────────────────────────────────────────────────────
// The request currently open in the modal: { ctx, values }.
let CERT_EXPORT_STATE = null;

function certHasTemplate(type) {
  return !!(typeof CERT_TEMPLATES !== "undefined" && CERT_TEMPLATES[type]);
}

// Everything a sheet needs: the request, the resident behind it, who signs, and
// the date it carries.
async function certBuildContext(request) {
  // The resident record fills occupation / pronoun / resident-since; a walk-in
  // request with no linked resident just leaves those blanks empty.
  let resident = null;
  if (request.resident_id) {
    try {
      resident = await apiGet(`/api/residents/${request.resident_id}`);
    } catch (_) {
      /* fall back to the request's own fields */
    }
  }
  return {
    request,
    resident,
    signatories: await certLoadSignatories(),
    issuedOn: request.processed_at ? new Date(request.processed_at) : new Date(),
  };
}

// Seeded from the record, then whatever has actually been filled in on top.
function certValuesFor(ctx) {
  const tpl = CERT_TEMPLATES[ctx.request.type];
  return Object.assign(tpl.defaults(ctx), certSavedFields(ctx.request));
}

function certNoTemplateToast(type) {
  if (typeof showToast === "function")
    showToast(
      `No printable form for ${certTypeLabel(type)} yet.`,
      "<i data-icon=triangle-alert></i>"
    );
}

// ── Keeping a sheet to one page ────────────────────────────────────────────
// 297mm in CSS pixels. Measured rather than assumed: read back from a probe so
// it is whatever this browser actually makes of a millimetre.
let CERT_PAGE_PX = null;

function certPageHeightPx() {
  if (CERT_PAGE_PX) return CERT_PAGE_PX;
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;height:297mm";
  document.body.appendChild(probe);
  CERT_PAGE_PX = probe.getBoundingClientRect().height;
  probe.remove();
  return CERT_PAGE_PX;
}

// Tighten, tighten harder, then scale. Returns the step it settled on, mostly
// so tests and callers can see whether anything had to give.
function certFitToPage(pageEl) {
  if (!pageEl) return "none";
  const content = pageEl.querySelector(".cert-content");
  pageEl.classList.remove("cert-fit-1", "cert-fit-2");
  if (content) {
    content.style.transform = "";
    content.style.transformOrigin = "";
  }
  // 1px of slack: a sub-pixel rounding difference is not an overflow worth
  // reformatting a document over.
  const limit = certPageHeightPx() + 1;
  if (pageEl.scrollHeight <= limit) return "none";

  pageEl.classList.add("cert-fit-1");
  if (pageEl.scrollHeight <= limit) return "fit-1";

  pageEl.classList.remove("cert-fit-1");
  pageEl.classList.add("cert-fit-2");
  if (pageEl.scrollHeight <= limit) return "fit-2";

  // Still long — something unusually verbose was typed into the blanks. Scale
  // the content as a last resort so it is one page whatever happens.
  if (content) {
    const cs = getComputedStyle(pageEl);
    const avail =
      certPageHeightPx() - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const f = Math.max(0.5, avail / content.scrollHeight);
    content.style.transformOrigin = "top left";
    content.style.transform = `scale(${f})`;
  }
  return "scaled";
}

// A sheet rendered, fitted to one page, and handed back as HTML ready to print.
// Fitting needs real layout, so it happens in a throwaway element parked off
// screen — the same path whether or not a preview is open, so what prints is
// never a different code path from what was checked.
function certFitHtml(ctx, values) {
  const holder = document.createElement("div");
  holder.style.cssText =
    "position:absolute;left:-99999px;top:0;width:210mm;pointer-events:none";
  holder.innerHTML = certDocHtml(ctx, values);
  document.body.appendChild(holder);
  const page = holder.querySelector(".cert-page");
  const step = certFitToPage(page);
  const html = page ? page.outerHTML : holder.innerHTML;
  holder.remove();
  return { html, step };
}

// ── Export: straight to the print dialog ───────────────────────────────────
// No modal — prints whatever is on file for the request. Anything still blank
// prints as an empty underline, which is what the barangay's own blank forms
// look like, so a half-filled request is still usable on paper.
async function certPrintRequest(request) {
  if (!certHasTemplate(request.type)) return certNoTemplateToast(request.type);
  const ctx = await certBuildContext(request);
  const values = certValuesFor(ctx);
  certPrintDoc(
    certFitHtml(ctx, values).html,
    `${certTypeLabel(request.type)} · ${request.request_no}`
  );
  if (typeof logAudit === "function")
    logAudit(
      "CERT_EXPORT",
      `${certTypeLabel(request.type)} (${request.request_no}) printed for ${request.applicant_name}`,
      "info",
      "certificate"
    );
}

// The modal is built on demand so certificates.html only has to load this
// script — no extra markup to keep in sync.
function certEnsureExportModal() {
  let modal = document.getElementById("modal-cert-export");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.id = "modal-cert-export";
  modal.setAttribute("onclick", "closeCertExport(event)");
  modal.innerHTML = `
    <!-- .modal-box is a fixed 560px, so the width has to be overridden here —
         the form and a legible A4 sheet need the room. -->
    <div class="modal-box" style="width:min(1180px,96vw);max-width:96vw">
      <div class="modal-header">
        <div class="modal-title">
          <div class="modal-title-icon"><i data-icon=file-text></i></div>
          <span id="cert-export-title">Certificate</span>
        </div>
        <button class="modal-close" onclick="closeCertExport()"><i data-icon=x></i></button>
      </div>
      <div class="modal-body">
        <div class="cert-export-grid" id="cert-export-grid" data-pane="form">
          <div class="cert-export-form">
            <!-- The request's own details and the documents attached to it,
                 both folded away above the blanks that go on paper. -->
            <div id="cert-export-details"></div>
            <div id="cert-export-attachments"></div>
            <div class="cert-field-group-title" id="cert-fields-heading">The certificate</div>
            <p class="modal-help-text" id="cert-export-help" style="margin:0 0 10px">
              Fill in the blanks on the barangay's form. The preview updates as
              you type and is saved with this request.
            </p>
            <div id="cert-export-fields"></div>
            <div class="btn-group">
              <button class="btn btn-sm btn-outline" onclick="certResetFields()"><i data-icon=refresh></i> Reset to record</button>
            </div>
          </div>
          <div class="cert-export-preview">
            <div class="cert-export-stage" id="cert-export-stage">
              <div class="cert-export-scaler" id="cert-export-scaler"></div>
            </div>
            <p class="modal-help-text" id="cert-export-no-template" style="display:none">
              There is no printable form for this certificate type yet, so there
              is nothing to preview. The request itself is filed normally.
            </p>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeCertExport()">Close</button>
        <!-- Only rendered on a narrow screen, where the panels take turns. -->
        <button class="btn btn-outline cert-pane-toggle" id="cert-pane-toggle" onclick="certTogglePane()"></button>
        <button class="btn btn-gold" id="cert-print-btn" onclick="certPrintCurrent()"><i data-icon=download></i> Print / Save as PDF</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const style = document.createElement("style");
  style.id = "cert-doc-style";
  style.textContent = CERT_DOC_CSS + CERT_UI_CSS;
  document.head.appendChild(style);
  return modal;
}

// The Certificate Request modal: details, blanks and preview in one place.
// opts.mode "staff" (from the queue) or "requester" (just after filing).
async function certOpenSheet(request, opts) {
  const o = opts || {};
  const modal = certEnsureExportModal();
  const printable = certHasTemplate(request.type);

  const ctx = await certBuildContext(request);
  CERT_EXPORT_STATE = {
    ctx,
    values: printable ? certValuesFor(ctx) : {},
    mode: o.mode || "staff",
  };

  const set = (id, fn) => {
    const el = document.getElementById(id);
    if (el) fn(el);
  };
  set("cert-export-title", (el) => {
    el.textContent = `${certTypeLabel(request.type)} · ${request.request_no}`;
  });
  set("cert-export-details", (el) => {
    el.innerHTML = certDetailsHtml(request);
  });
  set("cert-export-help", (el) => {
    el.textContent =
      CERT_EXPORT_STATE.mode === "requester"
        ? "This is the form the barangay will print. Fill in anything you want on it — what you enter is saved with your request."
        : "Fill in the blanks on the barangay's form. The preview updates as you type and is saved with this request.";
  });
  // A type with no printable form still shows its details; the sheet half of
  // the modal just says so instead of showing an empty frame.
  set("cert-fields-heading", (el) => (el.style.display = printable ? "" : "none"));
  set("cert-export-help", (el) => (el.style.display = printable ? "" : "none"));
  set("cert-export-fields", (el) => (el.style.display = printable ? "" : "none"));
  set("cert-export-stage", (el) => (el.style.display = printable ? "" : "none"));
  set("cert-export-no-template", (el) => (el.style.display = printable ? "none" : ""));
  // Same rule as the queue's Export button: nothing gets printed before the
  // request has been approved, whoever is looking at it. The blanks are still
  // editable while it waits — that's the point of showing this to the requester.
  const released = request.status === "approved" || request.status === "issued";
  set("cert-print-btn", (el) => (el.style.display = printable && released ? "" : "none"));
  const resetBtn = document.querySelector("#cert-export-grid .btn-group .btn");
  if (resetBtn) resetBtn.style.display = printable ? "" : "none";

  if (printable) {
    certRenderFields();
    certRenderPreview();
  }
  certShowPane("form");
  modal.classList.add("open");
  if (printable) certFitPreview();
  if (typeof hydrateIcons === "function") hydrateIcons(modal);
  // The attachment list is a second round trip, so it fills in behind the modal
  // rather than holding it closed.
  certRefreshAttachments();
}

// Draws (or redraws) the attached-documents block for whatever is open.
async function certRefreshAttachments() {
  const wrap = document.getElementById("cert-export-attachments");
  const st = CERT_EXPORT_STATE;
  if (!wrap || !st) return;
  const r = st.ctx.request;
  // Nothing to show until the request exists to hang documents off.
  if (!r.id || typeof certAttachmentsPanelHtml !== "function") {
    wrap.innerHTML = "";
    return;
  }
  wrap.innerHTML = await certAttachmentsPanelHtml(r);
  if (typeof hydrateIcons === "function") hydrateIcons(wrap);
}

// The request's own record — what the old separate "View" modal showed. Folded
// away by default: filling in the certificate is the job here, and the details
// are reference material you occasionally want to check.
function certDetailsHtml(r) {
  const dash = '<span class="table-muted">—</span>';
  const row = (label, value) => `
    <div class="cert-detail-row">
      <span class="table-muted">${certEsc(label)}</span>
      <span class="cert-detail-value">${value}</span>
    </div>`;
  const badges = {
    pending: "badge-warning",
    approved: "badge-info",
    issued: "badge-success",
    rejected: "badge-danger",
  };
  const date = (d) => {
    if (!d) return dash;
    const dt = new Date(d);
    return isNaN(dt)
      ? certEsc(d)
      : dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
  };
  return (
    // <details> rather than a hand-rolled toggle: it opens and closes on its
    // own, and keyboard/screen-reader behaviour comes for free.
    '<details class="cert-details">' +
    '<summary class="cert-field-group-title">Request details</summary>' +
    row("Request No.", `<span class="table-mono">${certEsc(r.request_no)}</span>`) +
    row("Applicant", certEsc(r.applicant_name)) +
    row("Type", certEsc(certTypeLabel(r.type))) +
    row(
      "Status",
      `<span class="badge ${badges[r.status] || "badge-gray"}">${certEsc(r.status || "pending")}</span>`
    ) +
    row("Filed", date(r.created_at)) +
    row("Purpose / Details", r.purpose ? certEsc(r.purpose) : dash) +
    row("Remarks", r.remarks ? certEsc(r.remarks) : dash) +
    row("Processed By", r.processed_by_name ? certEsc(r.processed_by_name) : dash) +
    row("Processed At", date(r.processed_at)) +
    row("Linked Resident", r.resident_id ? "#" + r.resident_id : dash) +
    "</details>"
  );
}

function certRenderFields() {
  const wrap = document.getElementById("cert-export-fields");
  const st = CERT_EXPORT_STATE;
  if (!wrap || !st) return;
  const fields = CERT_TEMPLATES[st.ctx.request.type].fields;
  let lastGroup = null;
  wrap.innerHTML = fields
    .map((f) => {
      const v = st.values[f.key] == null ? "" : st.values[f.key];
      let html = "";
      if (f.group && f.group !== lastGroup) {
        lastGroup = f.group;
        html += `<div class="cert-field-group-title">${certEsc(f.group)}</div>`;
      }
      const input =
        f.type === "select"
          ? `<select class="form-control" oninput="certFieldInput('${f.key}', this.value)">
               ${f.options
                 .map(
                   (o) =>
                     `<option value="${certEsc(o)}"${o === v ? " selected" : ""}>${certEsc(o)}</option>`
                 )
                 .join("")}
             </select>`
          : `<input class="form-control" value="${certEsc(v)}"
                    placeholder="${certEsc(f.placeholder || "")}"
                    oninput="certFieldInput('${f.key}', this.value)" />`;
      return (
        html +
        `<div class="form-group">
           <label class="form-label">${certEsc(f.label)}</label>
           ${input}
         </div>`
      );
    })
    .join("");
}

// Typing patches the matching spots on the sheet in place — re-rendering the
// whole page on every keystroke would fight the caret and flicker.
function certFieldInput(key, value) {
  const st = CERT_EXPORT_STATE;
  if (!st) return;
  st.values[key] = value;
  certSaveFields(st.ctx.request, st.values);
  document
    .querySelectorAll(`#cert-export-scaler .cert-fill[data-field="${key}"]`)
    .forEach((el) => {
      el.textContent = value.trim();
    });
  document
    .querySelectorAll(`#cert-export-scaler [data-text="${key}"]`)
    .forEach((el) => {
      el.textContent = value;
    });
  // A longer value can rewrap a paragraph — which changes the sheet's height,
  // so re-check the one-page fit, then re-fit the preview to the stage.
  certFitToPage(document.querySelector("#cert-export-scaler .cert-page"));
  certFitPreview();
}

function certRenderPreview() {
  const scaler = document.getElementById("cert-export-scaler");
  const st = CERT_EXPORT_STATE;
  if (!scaler || !st) return;
  scaler.innerHTML = certDocHtml(st.ctx, st.values);
  // The preview is fitted the same way the printed sheet is, so the tighter
  // setting is visible on screen rather than a surprise at the printer.
  certFitToPage(scaler.querySelector(".cert-page"));
}

function certResetFields() {
  const st = CERT_EXPORT_STATE;
  if (!st) return;
  st.values = CERT_TEMPLATES[st.ctx.request.type].defaults(st.ctx);
  certSaveFields(st.ctx.request, st.values);
  certRenderFields();
  certRenderPreview();
  certFitPreview();
  showToast("Blanks reset to the resident's record", "<i data-icon=refresh></i>");
}

// On a narrow screen the panels take turns; on a wide one both are visible and
// this only sets an attribute the CSS ignores.
function certShowPane(pane) {
  const grid = document.getElementById("cert-export-grid");
  if (!grid) return;
  grid.dataset.pane = pane;
  const toggle = document.getElementById("cert-pane-toggle");
  if (toggle)
    toggle.textContent =
      pane === "form" ? "View certificate →" : "← Back to the form";
  if (pane === "preview") certFitPreview();
}

function certTogglePane() {
  const grid = document.getElementById("cert-export-grid");
  certShowPane(grid?.dataset.pane === "preview" ? "form" : "preview");
}

// The sheet is a fixed 210mm × 297mm. Scale it down until it fits the stage in
// *both* directions so the whole page is on screen at once, then give the
// scaler the scaled size — that is what lets the stage's flex centering put an
// even margin on all four sides. Never scaled above 100%.
function certFitPreview() {
  const stage = document.getElementById("cert-export-stage");
  const scaler = document.getElementById("cert-export-scaler");
  const page = scaler?.querySelector(".cert-page");
  if (!stage || !page) return;
  // Width comes from the panel, not the stage: the stage's own width is set
  // from the result below, and measuring it would feed back on itself and
  // never let the sheet grow again after the window widens.
  const availW = stage.parentElement.clientWidth - CERT_STAGE_PAD * 2;
  const availH = stage.clientHeight - CERT_STAGE_PAD * 2;
  const w = page.offsetWidth;
  const h = page.offsetHeight;
  if (!w || !h || availW <= 0 || availH <= 0) return;
  const scale = Math.min(availW / w, availH / h, 1);
  scaler.style.transform = `scale(${scale})`;
  scaler.style.width = w * scale + "px";
  scaler.style.height = h * scale + "px";
  // A4 is taller than the stage is wide, so the fit is usually height-bound.
  // Shrink the stage onto the sheet rather than leaving dead grey either side.
  stage.style.width = w * scale + CERT_STAGE_PAD * 2 + "px";
}

function closeCertExport(e) {
  if (e && e.target !== document.getElementById("modal-cert-export")) return;
  certFlushPending(); // don't lose a save that was still being coalesced
  document.getElementById("modal-cert-export")?.classList.remove("open");
}

// Print the sheet currently open in the modal, rebuilt from the values rather
// than scraped out of the preview — the values are the record, the preview is
// just a view of them.
function certPrintCurrent() {
  const st = CERT_EXPORT_STATE;
  if (!st || !certHasTemplate(st.ctx.request.type)) return;
  certFlushPending();
  certPrintDoc(
    certFitHtml(st.ctx, st.values).html,
    `${certTypeLabel(st.ctx.request.type)} · ${st.ctx.request.request_no}`
  );
}

// Print from a separate window so the app's own stylesheets can't leak into the
// sheet. Image URLs are already absolute (CERT_IMG_BASE), which matters here
// because the new window has no base URL to resolve against; the dialog waits
// on the written document's own load event so the seals are in place first.
function certPrintDoc(docHtml, title) {
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) {
    if (typeof showToast === "function")
      showToast(
        "Allow pop-ups for this site to print the certificate.",
        "<i data-icon=triangle-alert></i>"
      );
    return;
  }
  win.document.write(
    `<!doctype html><html><head><meta charset="utf-8" />` +
      `<title>${certEsc(title || "Certificate")}</title>` +
      `<style>html,body{margin:0;padding:0;background:#fff}${CERT_DOC_CSS}</style>` +
      `</head><body onload="window.focus();window.print()">${docHtml}</body></html>`
  );
  win.document.close();
}

window.addEventListener("resize", () => {
  if (document.getElementById("modal-cert-export")?.classList.contains("open"))
    certFitPreview();
});
