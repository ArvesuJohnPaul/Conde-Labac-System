// js/certificate-types.js
// The one list of certificates the barangay issues. Shared by:
//   • the "New Request" type dropdown (js/portal-account.js)
//   • the Certificate Processing queue labels (js/pages/certificates.js)
//   • the printable forms (js/certificate-templates.js keys off these slugs)
//   • the requirement uploads (js/certificate-attachments.js)
//
// Slugs must match the server's routes/certificates.js TYPE_LABELS and the DB
// CHECK constraint (db/migration-certificate-types.sql). `short` is for tight
// spots; `label` is the full name used everywhere else.
//
// ── requirements ───────────────────────────────────────────────────────────
// A photo/scan the requester attaches so staff can check a claim the barangay
// cannot verify from its own records. The rule of thumb for listing one: does
// the certificate repeat a fact about an *outside* document? A Tax Declaration
// number, a hospital bill, a birth certificate — those need to be seen.
//
// The barangay's own instruction (July 2026) is that its everyday certificates
// ask for a Valid ID and nothing more: Barangay Clearance, Indigency, Residency,
// Relationship, First Time Jobseeker — plus Good Moral and Livelihood
// Assistance, which never asked for anything else. Do not add documents back to
// those without the barangay saying so; over-asking turns residents away at the
// form for paper the counter does not actually require.
//
//   key          stable id, stored on the attachment row
//   label        what the requester is asked for
//   required     false = helpful but the request is still accepted without it
//   sensitivity  "health" for medical/death documents — sensitive personal
//                information under RA 10173 §3(l), and purged sooner (30 days
//                rather than 90). See the server's retention-service.js.
//   note         one line of guidance shown under the field
//
// Loaded before js/portal-account.js on every page that carries the service
// modal — it reads this list while it evaluates.
window.CERT_TYPE_OPTIONS = [
  {
    slug: "barangay-clearance",
    label: "Certificate of Barangay Clearance",
    short: "Barangay Clearance",
    // Valid ID only, per the barangay. The cedula number is still a blank on the
    // printed form — it is read off the cedula at the counter, not uploaded.
    requirements: [{ key: "valid-id", label: "Valid ID", required: true }],
  },
  {
    slug: "residency",
    label: "Certificate of Barangay Residency",
    short: "Barangay Residency",
    // Valid ID only, per the barangay.
    requirements: [{ key: "valid-id", label: "Valid ID", required: true }],
  },
  {
    slug: "indigency",
    label: "Certificate of Indigency",
    short: "Indigency",
    // Valid ID only, per the barangay.
    requirements: [{ key: "valid-id", label: "Valid ID", required: true }],
  },
  {
    slug: "good-moral",
    label: "Certificate of Good Moral",
    short: "Good Moral",
    // Nothing to attach: this one is the barangay speaking about its own records.
    requirements: [{ key: "valid-id", label: "Valid ID", required: true }],
  },
  {
    slug: "solo-parent",
    label: "Barangay Certification for Solo Parent",
    short: "Solo Parent",
    requirements: [
      { key: "valid-id", label: "Valid ID", required: true },
      {
        key: "child-birth",
        label: "Birth certificate of the child / children",
        required: true,
      },
      {
        key: "solo-parent-proof",
        label: "Proof of solo parent status",
        required: true,
        note: "Death certificate of the spouse, or an affidavit of separation / abandonment.",
      },
    ],
  },
  {
    slug: "relationship",
    label: "Certificate of Relationship",
    short: "Relationship",
    // Valid ID only, per the barangay.
    requirements: [{ key: "valid-id", label: "Valid ID", required: true }],
  },
  {
    slug: "business-clearance",
    label: "Business Clearance",
    short: "Business Clearance",
    requirements: [
      { key: "valid-id", label: "Valid ID", required: true },
      {
        key: "tax-declaration",
        label: "Tax Declaration",
        required: true,
        note: "For the place the business operates from.",
      },
    ],
  },
  {
    slug: "first-time-jobseeker",
    label: "Barangay Certification — First Time Jobseeker (RA 11261)",
    short: "First Time Jobseeker",
    // Valid ID only, per the barangay. RA 11261 still requires the Oath of
    // Undertaking, but it is signed before a barangay official at the hall —
    // there is nothing for the requester to upload ahead of time.
    requirements: [{ key: "valid-id", label: "Valid ID", required: true }],
  },
  {
    slug: "delayed-birth-registration",
    label: "Barangay Certification — Delayed Birth Registration",
    short: "Delayed Birth Reg.",
    requirements: [
      { key: "valid-id", label: "Valid ID of the requester", required: true },
      {
        key: "baptismal",
        label: "Baptismal certificate",
        required: false,
        note: "Any early record of the birth helps — the PSA will not act without supporting documents.",
      },
      { key: "school-records", label: "School records", required: false },
      {
        key: "affidavit",
        label: "Affidavit of two disinterested persons",
        required: true,
      },
    ],
  },
  {
    slug: "assistance-certification",
    label: "Certification — City Government Assistance",
    short: "City Assistance",
    requirements: [
      { key: "valid-id", label: "Valid ID", required: true },
      {
        key: "medical-document",
        label: "Medical abstract, hospital bill or prescription",
        required: false,
        sensitivity: "health",
        note: "For medical assistance. Kept 30 days after the request closes, then deleted.",
      },
      {
        key: "death-certificate",
        label: "Death certificate",
        required: false,
        sensitivity: "health",
        note: "For burial assistance. Kept 30 days after the request closes, then deleted.",
      },
    ],
  },
  {
    slug: "livelihood-assistance",
    label: "Certification — Sustainable Livelihood Assistance",
    short: "Livelihood Assistance",
    requirements: [{ key: "valid-id", label: "Valid ID", required: true }],
  },
  {
    slug: "electrical-connection",
    label: "Certification — Electrical Connection (MERALCO)",
    short: "Electrical Connection",
    requirements: [
      { key: "valid-id", label: "Valid ID", required: true },
      {
        key: "tax-declaration",
        label: "Tax Declaration",
        required: true,
        note: "Its number is printed on the certification, which also states there is no land title.",
      },
    ],
  },
  {
    slug: "property-clearance",
    label: "Certification — Property Clearance",
    short: "Property Clearance",
    requirements: [
      { key: "valid-id", label: "Valid ID", required: true },
      {
        key: "tax-declaration",
        label: "Tax Declaration",
        required: true,
        note: "Both the Tax Declaration and Property Identification numbers are printed on it.",
      },
    ],
  },
  {
    slug: "lot-boundary",
    label: "Certification — House on Another's Lot",
    short: "House on Lot",
    requirements: [
      { key: "valid-id", label: "Valid ID", required: true },
      {
        key: "tax-declaration",
        label: "Tax Declaration of the lot",
        required: true,
        note: "The certification names the lot owner and repeats the declaration number.",
      },
    ],
  },
  {
    slug: "livestock",
    label: "Certification — Livestock for Slaughter",
    short: "Livestock",
    requirements: [
      { key: "valid-id", label: "Valid ID", required: true },
      {
        key: "ownership-proof",
        label: "Proof of ownership of the livestock",
        required: false,
      },
    ],
  },
];

// slug → full label.
window.CERT_TYPE_LABELS = {};
window.CERT_TYPE_OPTIONS.forEach(function (t) {
  window.CERT_TYPE_LABELS[t.slug] = t.label;
});

// Falls back to the raw slug so an unknown type shows *something* rather than
// "undefined" — e.g. a row filed before a type was renamed.
window.certTypeLabel = function (slug) {
  return window.CERT_TYPE_LABELS[slug] || slug || "Certificate";
};

// The documents a type asks for, or [] for an unknown slug.
window.certRequirements = function (slug) {
  const t = window.CERT_TYPE_OPTIONS.find(function (x) {
    return x.slug === slug;
  });
  return (t && t.requirements) || [];
};
