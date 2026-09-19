// js/certificate-types.js
// The certificates the barangay issues, loaded from /api/certificate-types
// (the certificate_type table). Staff edit them in Certificate Processing →
// Certificate Forms; nothing about a certificate is written in code any more.
// Shared by:
//   • the "New Request" type dropdown (js/portal-account.js)
//   • the Certificate Processing queue (js/pages/certificates.js)
//   • the printable forms (js/certificate-templates.js)
//   • the requirement uploads (js/certificate-attachments.js)
//
// Each type: { slug, label, short, active, requirements, form, has_original },
// in alphabetical order of label. Requirements are { key, label, required,
// sensitivity, note }:
//   key          stable id, stored on the attachment row
//   required     false = helpful but the request is still accepted without it
//   sensitivity  "health" for medical/death documents — sensitive personal
//                information under RA 10173 §3(l), and purged sooner (30 days
//                rather than 90). See the server's retention-service.js.
//
// The lists below are filled IN PLACE when the response arrives, so a script
// that kept a reference to them at load time still sees the data. Anything that
// draws from them on page load should wait for window.certTypesReady, or listen
// for the "cert-types-loaded" event (fired again after every reload).

// Offered on the request form: the types not hidden.
window.CERT_TYPE_OPTIONS = [];
// Every type, hidden ones included — requests filed under a type that has since
// been hidden still need its name and its form.
window.CERT_TYPE_ALL = [];
// slug → full label.
window.CERT_TYPE_LABELS = {};

// Alphabetical by name, the same order on every list — the request form, the
// queue filter and the forms editor.
function certTypesApply(rows) {
  const all = (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { sensitivity: "base", numeric: true }));
  window.CERT_TYPE_ALL.length = 0;
  window.CERT_TYPE_OPTIONS.length = 0;
  Object.keys(window.CERT_TYPE_LABELS).forEach((k) => delete window.CERT_TYPE_LABELS[k]);
  all.forEach((t) => {
    t.requirements = Array.isArray(t.requirements) ? t.requirements : [];
    window.CERT_TYPE_ALL.push(t);
    if (t.active !== false) window.CERT_TYPE_OPTIONS.push(t);
    window.CERT_TYPE_LABELS[t.slug] = t.label;
  });
  document.dispatchEvent(new CustomEvent("cert-types-loaded"));
}

// Resolves once the list is in (empty if the server could not be reached — the
// request form then says so rather than offering nothing silently).
window.certTypesLoadError = null;
window.certTypesReload = function () {
  const get =
    typeof apiGet === "function"
      ? apiGet("/api/certificate-types")
      : Promise.reject(new Error("API helper not loaded on this page."));
  return get
    .then((rows) => {
      window.certTypesLoadError = null;
      certTypesApply(rows);
    })
    .catch((err) => {
      window.certTypesLoadError = err;
      certTypesApply([]);
    });
};
window.certTypesReady = window.certTypesReload();

// Falls back to the raw slug so an unknown type shows *something* rather than
// "undefined".
window.certTypeLabel = function (slug) {
  return window.CERT_TYPE_LABELS[slug] || slug || "Certificate";
};

window.certTypeShort = function (slug) {
  const t = window.CERT_TYPE_ALL.find((x) => x.slug === slug);
  return (t && (t.short || t.label)) || slug || "Certificate";
};

// The documents a type asks for, or [] for an unknown slug.
window.certRequirements = function (slug) {
  const t = window.CERT_TYPE_ALL.find((x) => x.slug === slug);
  return (t && t.requirements) || [];
};
