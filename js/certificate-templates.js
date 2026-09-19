// js/certificate-templates.js
// Turns a certificate's document (edited like a Word page in Certificate
// Processing → Certificate Forms, stored in certificate_type.form) into the
// template js/certificate-export.js fills in and prints.
//
// A form is:
//   { version: 2,
//     body:   the page below the heading, as HTML — paragraphs, tables and
//             inline formatting, with a <span data-field="key" data-width="66"
//             data-underline="1"></span> wherever a fill-in field sits
//     fields: [{ key, label, source, value, options, manual }] }
//
// The heading (seals, "Republic of the Philippines" …) and the request number
// at the foot are the same on every certificate and are not part of the body.
//
// A field's settings live in two places on purpose:
//   on the span   data-width (mm, 0 = as wide as its text) and data-underline —
//                 the same field can appear twice, drawn differently each time
//   in `fields`   what it is called, what it starts filled with (`source`, then
//                 `value`), its choices, and `manual` for a blank left to be
//                 written by hand (a signature) and never typed in
//
// SAFETY
// The body is HTML that came over the network, and it is shown on the MIS and
// the public landing page. So it is never inserted as stored: every render goes
// through certSanitizeBody(), which parses it inertly (DOMParser runs no
// scripts and loads nothing) and rebuilds it from a short list of tags, the
// field attributes and a short list of CSS properties with checked values.
// Anything else — scripts, event handlers, links, images, URLs — is dropped.
//
// Loaded after js/certificate-export.js (certEsc, CERT_MONTHS) and
// js/certificate-types.js (the definitions).

// slug → template, rebuilt whenever the definitions load or change.
const CERT_TEMPLATES = {};

// ── Where a field's starting value comes from ──────────────────────────────
function certApplicantName(ctx) {
  return certFullName(ctx.resident) || ctx.request.applicant_name || "";
}

// "Purok 3" / "Purok Uno" → "3" / "Uno", since the forms print "Purok ___".
function certPurokNo(purok) {
  return String(purok || "").replace(/^\s*purok\s*/i, "").trim();
}

function certFmtLongDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d)
    ? ""
    : `${CERT_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const CERT_FIELD_SOURCES = [
  { key: "name_upper", label: "Applicant's name, in capitals", get: (c) => certApplicantName(c).toUpperCase() },
  { key: "name", label: "Applicant's name, as written", get: (c) => certApplicantName(c) },
  { key: "age", label: "Age", get: (c) => (c.resident && c.resident.age != null ? String(c.resident.age) : "") },
  { key: "civil_status", label: "Civil status", get: (c) => (c.resident || {}).civil_status || "" },
  { key: "purok", label: "Purok number", get: (c) => certPurokNo((c.resident || {}).purok) },
  { key: "birthdate", label: "Date of birth", get: (c) => certFmtLongDate((c.resident || {}).birthdate) },
  { key: "occupation", label: "Occupation", get: (c) => (c.resident || {}).occupation || "" },
  {
    key: "pronoun",
    label: "He / She, from the resident's sex",
    // The record stores "M"/"F"; "Male"/"Female" is accepted as well.
    get: (c) => {
      const sex = String((c.resident || {}).sex || "").toUpperCase();
      return sex.startsWith("F") ? "She" : sex.startsWith("M") ? "He" : "";
    },
  },
  { key: "since", label: "Resident since (full date)", get: (c) => certFmtLongDate((c.resident || {}).date_registered) },
  {
    key: "since_year",
    label: "Resident since (year only)",
    get: (c) => {
      const d = (c.resident || {}).date_registered;
      return d ? String(new Date(d).getFullYear()) : "";
    },
  },
  {
    key: "purpose",
    label: "Purpose written on the request",
    // The portal appends contact and pickup details after " · " — only the
    // first part belongs on the sheet.
    get: (c) => String(c.request.purpose || "").split(" · ")[0].trim(),
  },
  { key: "day", label: "Day of issue (e.g. 16th)", get: (c) => certOrdinal(c.issuedOn.getDate()) },
  { key: "month", label: "Month of issue", get: (c) => CERT_MONTHS[c.issuedOn.getMonth()] },
  { key: "year", label: "Year of issue", get: (c) => String(c.issuedOn.getFullYear()) },
  { key: "request_no", label: "Request number", get: (c) => c.request.request_no || "" },
  // The people who sign — from Barangay Officials (Site Content), so a new
  // Punong Barangay entered there reaches every certificate. Their titles are
  // ordinary text on the form.
  { key: "punong_name", label: "Punong Barangay's name", get: (c) => ((c.signatories || {}).punong || {}).name || "" },
  { key: "secretary_name", label: "Barangay Secretary's name", get: (c) => ((c.signatories || {}).secretary || {}).name || "" },
];

const CERT_FIELD_SOURCE_MAP = {};
CERT_FIELD_SOURCES.forEach((s) => (CERT_FIELD_SOURCE_MAP[s.key] = s));

// ── Sanitising a body ──────────────────────────────────────────────────────
// Tag → what it becomes. Anything not listed is unwrapped (its text kept).
const CERT_TAGS = {
  P: "p", DIV: "p", H1: "p", H2: "p", H3: "p", H4: "p", LI: "p",
  BR: "br",
  B: "b", STRONG: "b",
  I: "i", EM: "i",
  U: "u",
  SPAN: "span", FONT: "span",
  TABLE: "table", TBODY: "tbody", THEAD: "tbody", TFOOT: "tbody",
  TR: "tr", TD: "td", TH: "td",
};
// Removed with everything inside them.
const CERT_DROP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "IFRAME", "OBJECT", "EMBED", "NOSCRIPT", "SVG", "MATH", "HEAD", "TITLE", "META", "LINK", "IMG", "VIDEO", "AUDIO", "CANVAS", "INPUT", "TEXTAREA", "SELECT", "BUTTON"]);

const CERT_LEN = /^-?\d{1,4}(\.\d{1,3})?(mm|cm|pt|px|in|em|%)$/;
const CERT_LEN_POS = /^\d{1,4}(\.\d{1,3})?(mm|cm|pt|px|in|em|%)$/;
const CERT_STYLES = {
  "text-align": /^(left|center|right|justify|start|end)$/,
  "text-indent": CERT_LEN,
  "margin-left": CERT_LEN,
  "margin-right": CERT_LEN,
  "margin-top": CERT_LEN,
  "margin-bottom": CERT_LEN,
  "padding-left": CERT_LEN_POS,
  "padding-right": CERT_LEN_POS,
  "padding-top": CERT_LEN_POS,
  "padding-bottom": CERT_LEN_POS,
  "line-height": /^(normal|\d{1,2}(\.\d{1,3})?|\d{1,3}(\.\d{1,3})?(mm|pt|px|em|%))$/,
  "font-family": /^[\w\s"',.-]{1,120}$/,
  "font-size": /^\d{1,3}(\.\d{1,3})?(pt|px|mm|em|%)$/,
  "font-weight": /^(normal|bold|bolder|lighter|[1-9]00)$/,
  "font-style": /^(normal|italic|oblique)$/,
  "text-decoration-line": /^(none|underline|line-through|underline line-through)$/,
  "letter-spacing": /^(normal|-?\d{1,2}(\.\d{1,3})?(pt|px|mm|em))$/,
  color: /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\))$/i,
  width: CERT_LEN_POS,
  "vertical-align": /^(top|middle|bottom|baseline)$/,
  "white-space": /^(normal|nowrap)$/,
  "border-top": /^(none|0|0px|\d(\.\d)?px solid (#[0-9a-f]{3,6}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|black))$/i,
  "border-right": null, // same rule as border-top, filled in below
  "border-bottom": null,
  "border-left": null,
};
["border-right", "border-bottom", "border-left"].forEach((p) => (CERT_STYLES[p] = CERT_STYLES["border-top"]));

const CERT_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

// Reads the browser's own parse of the style attribute, so shorthand and
// odd spacing are normalised before anything is checked.
function certCleanStyle(src, dst) {
  const s = src.style;
  if (!s) return;
  const out = [];
  Object.keys(CERT_STYLES).forEach((prop) => {
    const v = String(s.getPropertyValue(prop) || "").trim();
    if (v && CERT_STYLES[prop].test(v)) out.push(`${prop}: ${v}`);
  });
  // <font face="…" color="…"> from execCommand, as styles.
  if (src.tagName === "FONT") {
    const face = src.getAttribute("face");
    if (face && CERT_STYLES["font-family"].test(face)) out.push(`font-family: ${face}`);
    const color = src.getAttribute("color");
    if (color && CERT_STYLES.color.test(color)) out.push(`color: ${color}`);
  }
  if (out.length) dst.setAttribute("style", out.join("; "));
}

function certCleanNode(src, doc, into) {
  src.childNodes.forEach((n) => {
    if (n.nodeType === 3) {
      into.appendChild(doc.createTextNode(n.nodeValue));
      return;
    }
    if (n.nodeType !== 1 || CERT_DROP.has(n.tagName)) return;
    // A fill-in field: its attributes only, never its contents.
    const key = n.getAttribute("data-field");
    if (key != null) {
      if (!CERT_KEY_RE.test(key)) return;
      const f = doc.createElement("span");
      f.setAttribute("data-field", key);
      const w = Math.min(190, Math.max(0, Math.round(Number(n.getAttribute("data-width")) * 10) / 10 || 0));
      f.setAttribute("data-width", String(w));
      f.setAttribute("data-underline", n.getAttribute("data-underline") === "0" ? "0" : "1");
      into.appendChild(f);
      return;
    }
    const tag = CERT_TAGS[n.tagName];
    if (!tag) {
      certCleanNode(n, doc, into); // unwrap
      return;
    }
    // A div (or heading) holding blocks is only a wrapper.
    if (tag === "p" && n.querySelector("p,div,table,h1,h2,h3,h4,li")) {
      certCleanNode(n, doc, into);
      return;
    }
    const el = doc.createElement(tag);
    if (tag !== "br") certCleanStyle(n, el);
    into.appendChild(el);
    certCleanNode(n, doc, el);
    // Inline wrappers left with nothing to format are dropped.
    if ((tag === "span" || tag === "b" || tag === "i" || tag === "u") && !el.childNodes.length) el.remove();
    else if (tag === "span" && !el.attributes.length) {
      while (el.firstChild) into.insertBefore(el.firstChild, el);
      el.remove();
    }
  });
}

// Top-level text or inline elements are gathered into paragraphs, so the body
// is always a run of <p> and <table>.
function certWrapLoose(root, doc) {
  let run = null;
  Array.from(root.childNodes).forEach((n) => {
    const block = n.nodeType === 1 && (n.tagName === "P" || n.tagName === "TABLE");
    if (block) {
      run = null;
      return;
    }
    if (n.nodeType === 3 && !n.nodeValue.trim() && !run) {
      n.remove();
      return;
    }
    if (!run) {
      run = doc.createElement("p");
      root.insertBefore(run, n);
    }
    run.appendChild(n);
  });
}

// HTML in → safe, canonical HTML out.
function certSanitizeBody(html) {
  const parsed = new DOMParser().parseFromString(
    `<!doctype html><body>${String(html == null ? "" : html)}</body>`,
    "text/html"
  );
  const doc = document.implementation.createHTMLDocument("");
  const root = doc.createElement("div");
  certCleanNode(parsed.body, doc, root);
  certWrapLoose(root, doc);
  // A table needs its rows inside a tbody for the editor's row tools.
  root.querySelectorAll("table").forEach((t) => {
    Array.from(t.childNodes).forEach((c) => {
      if (c.nodeType === 1 && c.tagName === "TR") {
        let tb = t.querySelector(":scope > tbody");
        if (!tb) tb = t.appendChild(doc.createElement("tbody"));
        tb.appendChild(c);
      } else if (!(c.nodeType === 1 && c.tagName === "TBODY")) c.remove();
    });
  });
  return root.innerHTML;
}

// The field keys a body uses, first appearance first.
function certBodyFieldKeys(html) {
  const keys = [];
  String(html || "").replace(/data-field="([a-z][a-z0-9_]*)"/g, (_, k) => {
    if (!keys.includes(k)) keys.push(k);
    return _;
  });
  return keys;
}

// ── Rendering a body with its values ───────────────────────────────────────
const CERT_PUNCT_RE = /^[.,;:!?)\]]+/;

function certRenderBody(bodyHtml, byKey, values) {
  const doc = document.implementation.createHTMLDocument("");
  const root = doc.createElement("div");
  root.innerHTML = certSanitizeBody(bodyHtml);
  root.querySelectorAll("span[data-field]").forEach((span) => {
    const key = span.getAttribute("data-field");
    const f = byKey[key] || { key, manual: false };
    const width = Number(span.getAttribute("data-width")) || 0;
    const underline = span.getAttribute("data-underline") !== "0";
    const out = doc.createElement("span");
    out.className =
      "cert-fill" + (underline ? "" : width ? " cert-fill-plain" : " cert-fill-fit");
    out.setAttribute("data-field", key);
    if (width) out.setAttribute("style", `min-width: ${width}mm`);
    const v = f.manual ? "" : values[key];
    out.textContent = String(v == null ? "" : v).trim();
    span.replaceWith(out);
    certKeepPunctuation(out, doc);
  });
  return root.innerHTML;
}

// A blank is an inline-block, so a line may break between it and the "." or
// "," typed straight after it — leaving the punctuation alone on the next
// line. The blank (with any bold/italic wrapped round it) and that punctuation
// are put in one unbreakable span.
function certKeepPunctuation(fill, doc) {
  let node = fill;
  while (
    node.parentNode &&
    !node.nextSibling &&
    /^(B|I|U|SPAN)$/.test(node.parentNode.tagName) &&
    !node.parentNode.classList.contains("cert-nobreak")
  )
    node = node.parentNode;
  const next = node.nextSibling;
  if (!next || next.nodeType !== 3) return;
  const m = CERT_PUNCT_RE.exec(next.nodeValue);
  if (!m) return;
  const rest = next.nodeValue.slice(m[0].length);
  const wrap = doc.createElement("span");
  wrap.className = "cert-nobreak";
  node.parentNode.insertBefore(wrap, node);
  wrap.appendChild(node);
  wrap.appendChild(doc.createTextNode(m[0]));
  if (rest) next.nodeValue = rest;
  else next.remove();
}

// ── Building templates ─────────────────────────────────────────────────────
// One definition → the template certificate-export.js works with, or null
// for a form in a shape this version does not read.
function certBuildTemplate(type) {
  const form = type && type.form;
  if (!form || form.version !== 2) return null;
  const byKey = {};
  (form.fields || []).forEach((f) => (byKey[f.key] = f));
  // The fill-in panel lists fields in the order they appear on the page.
  const fields = certBodyFieldKeys(form.body).map(
    (k) => byKey[k] || { key: k, label: k, source: "", value: "", options: [], manual: false }
  );
  return {
    slug: type.slug,
    fields,
    // Each field starts from its source, or its default text when the source
    // has nothing — a walk-in with no resident record, say.
    defaults(ctx) {
      const values = {};
      fields.forEach((f) => {
        if (f.manual) return;
        const src = CERT_FIELD_SOURCE_MAP[f.source];
        let v = "";
        try {
          v = src ? src.get(ctx) : "";
        } catch (_) {
          v = "";
        }
        values[f.key] = v || f.value || "";
      });
      return values;
    },
    render(values) {
      return certRenderBody(form.body, byKey, values || {});
    },
  };
}

function certRebuildTemplates() {
  Object.keys(CERT_TEMPLATES).forEach((k) => delete CERT_TEMPLATES[k]);
  (window.CERT_TYPE_ALL || []).forEach((t) => {
    const tpl = certBuildTemplate(t);
    if (tpl) CERT_TEMPLATES[t.slug] = tpl;
  });
}

// The definitions may already be here (a fast response) or still on their way.
certRebuildTemplates();
document.addEventListener("cert-types-loaded", certRebuildTemplates);
