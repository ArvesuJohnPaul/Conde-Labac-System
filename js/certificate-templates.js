// js/certificate-templates.js
// One entry per certificate type the barangay issues, transcribed from the
// printed forms. CERT_TEMPLATES is consumed by js/certificate-export.js — this
// file is only the wording and layout, none of the machinery.
//
// Each entry:
//   title        text of the heading
//   spacedTitle  true for the forms whose heading is set "C E R T I F I C A T I O N"
//   subtitle     the small italic line under the heading (RA 11261 only)
//   salutation   "To Whom It May Concern:" etc., or omitted where the form has none
//   seals        "city-left" | "brgy-left" — which seal is printed on which side
//   signatures   "side-by-side" | "stacked" | "punong-right" | "punong-left"
//   footer       pieces printed below (purpose line, release box, caption lines…)
//   footerFirst  true where the applicant's signature lines come before the
//                Punong Barangay's block
//   fields       the form on the left of the export modal, in order
//   defaults     seeds those fields from the request + resident record
//   render       the body paragraphs
//
// Wording is the single source of truth for what gets printed — corrections go
// here. Blanks the database can't fill are left empty on purpose.
//
// Loaded *after* js/certificate-export.js on pages/certificates.html: the field
// descriptors below read CERT_MONTHS at evaluation time, and certBlank() and
// friends come from there too.

// ── Shared field descriptors ───────────────────────────────────────────────
// f("age") gives the standard Age field; f("age", { label: "Age of child" })
// gives it a form-specific label.
const CERT_FIELD_CATALOG = {
  name: { label: "Name of applicant", group: "Applicant", width: "250px", placeholder: "JUAN P. DELA CRUZ" },
  // The blank form pre-prints all three and the clerk rings one; picking from a
  // list is the same act. The combined form stays first so it is still possible
  // to print the sheet exactly as the barangay's own blank does.
  honorific: {
    label: "Mr. / Mrs. / Ms.",
    group: "Applicant",
    type: "select",
    options: ["Mr./Mrs./Ms.", "Mr.", "Mrs.", "Ms."],
  },
  age: { label: "Age", group: "Applicant", width: "55px", placeholder: "32" },
  civil_status: { label: "Civil status", group: "Applicant", width: "150px", placeholder: "single/married/widow" },
  purok: { label: "Purok no.", group: "Applicant", width: "55px", placeholder: "3" },
  birthdate: { label: "Date of birth", group: "Applicant", width: "150px" },
  birthplace: { label: "Place of birth", group: "Applicant", width: "180px" },
  occupation: { label: "Occupation", group: "Applicant", width: "150px" },
  pronoun: { label: "Refer to applicant as", group: "Applicant", type: "select", options: ["He", "She", "He/ She"] },
  since: { label: "Resident since", group: "Applicant", width: "130px" },
  requested_by: { label: "Issued upon the request of", group: "Issuance", width: "210px" },
  day: { label: "Issued this…", group: "Issuance", width: "80px", placeholder: "30th" },
  month: { label: "Month", group: "Issuance", type: "select", options: CERT_MONTHS },
  year: { label: "Year", group: "Issuance", width: "65px" },
  // Fills the "Purpose: ______" line the forms print at the foot of the page.
  // Only meaningful on the templates whose footer includes "purpose".
  purpose: {
    label: "Purpose",
    group: "Issuance",
    width: "300px",
    placeholder: "e.g. Employment requirement",
  },
};

function f(key, overrides) {
  const base = CERT_FIELD_CATALOG[key];
  if (!base) throw new Error("unknown certificate field: " + key);
  return Object.assign({ key: key }, base, overrides || {});
}

// ── Shared defaults ────────────────────────────────────────────────────────
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

// Every template starts from these; each one only shows the fields it declares.
function certBaseDefaults(ctx) {
  const r = ctx.request;
  const res = ctx.resident || {};
  const d = ctx.issuedOn;
  const name = certFullName(res) || r.applicant_name || "";
  return {
    name: name.toUpperCase(),
    // The forms pre-print these as choices; leaving the printed text in place
    // is the faithful default when the record doesn't say.
    honorific: "Mr./Mrs./Ms.",
    age: res.age != null ? String(res.age) : "",
    civil_status: res.civil_status || "single/married/widow",
    purok: certPurokNo(res.purok),
    birthdate: certFmtLongDate(res.birthdate),
    birthplace: "",
    occupation: res.occupation || "",
    pronoun: res.sex === "Female" ? "She" : res.sex === "Male" ? "He" : "He/ She",
    since: res.date_registered ? certFmtLongDate(res.date_registered) : "",
    requested_by: name,
    // The request's purpose column also carries the contact and pickup details
    // the portal appends after " · " — only the first part belongs on the sheet.
    purpose: String(r.purpose || "").split(" · ")[0].trim(),
    day: certOrdinal(d.getDate()),
    month: CERT_MONTHS[d.getMonth()],
    year: String(d.getFullYear()),
  };
}

// A label-and-blank list, as on the delayed-registration and assistance forms.
// rows: [[printed label, field key, underline width?], …]
function certLabelRows(v, rows) {
  return `<div class="cert-labels">${rows
    .map(
      ([label, key, w]) =>
        `<div class="cert-label-row"><span>${certEsc(label)}</span>${certBlank(
          key,
          v[key],
          w || "260px"
        )}</div>`
    )
    .join("")}</div>`;
}

// The closing line, which differs only in its opening words and tail across
// the forms. A tail that starts with punctuation is glued to the year.
function certIssuedLine(v, lead, tail) {
  const t = tail == null ? "at Barangay Conde Labak, Batangas City." : tail;
  const sep = /^[.,;]/.test(t) ? "" : " ";
  return `<p class="cert-para">
    ${certEsc(lead)} ${certBlank("day", v.day, "80px")} day of
    ${certBlankThen("month", v.month, "150px", ",")} ${certText("year", v.year)}${sep}${certEsc(t)}
  </p>`;
}

// The paragraph that appears verbatim on most of the forms.
const CERT_ON_REQUEST_ABOVE_NAMED = `
  <p class="cert-para">
    This certification is being issued upon the request of the above-named
    person for whatever legal purpose it may serve.
  </p>`;

// ── The templates ──────────────────────────────────────────────────────────
const CERT_TEMPLATES = {
  // ─────────────────────────── Certificate of Good Moral
  "good-moral": {
    title: "C E R T I F I C A T I O N",
    spacedTitle: true,
    salutation: "TO WHOM IT MAY CONCERN:",
    seals: "brgy-left",
    signatures: "side-by-side",
    fields: [
      f("name"),
      { key: "status", label: "…said to be a", group: "Applicant", width: "120px", placeholder: "e.g. resident" },
      { key: "functionary", label: "…of a barangay functionary named", group: "Applicant", width: "160px", placeholder: "Full name" },
      f("occupation", { label: "Working as" }),
      f("since", { label: "Since", width: "85px" }),
      f("pronoun"),
      f("requested_by"),
      f("day"),
      f("month"),
      f("year"),
    ],
    defaults(ctx) {
      const res = ctx.resident || {};
      return Object.assign(certBaseDefaults(ctx), {
        status: "",
        functionary: "",
        since: res.date_registered
          ? String(new Date(res.date_registered).getFullYear())
          : "",
      });
    },
    render(v) {
      return `
        <p class="cert-para">
          This is to certify that ${certBlank("name", v.name, "250px")},
          <b>of legal age</b>, is a resident of this Barangay Conde Labak, and
          therefore said to be a ${certBlank("status", v.status, "120px")} of a
          barangay functionary named
          ${certBlank("functionary", v.functionary, "160px")} working as
          ${certBlank("occupation", v.occupation, "150px")} since
          ${certBlankThen("since", v.since, "85px", ".")}
        </p>
        <p class="cert-para">
          ${certText("pronoun", v.pronoun)} has a <b>Good Moral Character</b> and
          has <b>NO DEROGATORY RECORD</b> in this community.
        </p>
        <p class="cert-para">
          This certification is issued upon the request of
          ${certBlank("requested_by", v.requested_by, "210px")} for whatever
          legal purpose it may serve.
        </p>
        ${certIssuedLine(v, "Issued this")}
      `;
    },
  },

  // ─────────────────────────── Certificate of Barangay Residency
  residency: {
    title: "CERTIFICATE OF BARANGAY RESIDENCY",
    salutation: "To Whom It May Concern:",
    seals: "city-left",
    signatures: "stacked",
    footer: ["purpose"],
    fields: [
      f("name"),
      f("age"),
      f("birthdate", { label: "Born on" }),
      f("birthplace", { label: "Born at" }),
      { key: "child_of", label: "Daughter / son of", group: "Applicant", width: "100px" },
      { key: "father", label: "Father's name", group: "Applicant", width: "190px" },
      { key: "mother", label: "Mother's name", group: "Applicant", width: "190px" },
      f("purok"),
      f("since", { label: "Resident since" }),
      f("day"),
      f("month"),
      f("year"),
      f("purpose"),
    ],
    defaults(ctx) {
      return Object.assign(certBaseDefaults(ctx), {
        child_of: "daughter/son",
        father: "",
        mother: "",
      });
    },
    render(v) {
      return `
        <p class="cert-para">
          This is to certify that ${certBlank("name", v.name, "250px")},
          ${certBlank("age", v.age, "55px")} years old, Filipino Citizen, born on
          ${certBlank("birthdate", v.birthdate, "150px")} at
          ${certBlank("birthplace", v.birthplace, "180px")} and
          ${certText("child_of", v.child_of)} of
          ${certBlank("father", v.father, "190px")} and
          ${certBlank("mother", v.mother, "190px")} is a <b>RESIDENT</b> of Purok
          ${certBlank("purok", v.purok, "55px")} of Barangay Conde Labak Batangas
          City since ${certBlank("since", v.since, "130px")} up to present.
        </p>
        ${CERT_ON_REQUEST_ABOVE_NAMED}
        ${certIssuedLine(v, "SIGNED and ISSUED this")}
      `;
    },
  },

  // ─────────────────────────── Certificate of Barangay Clearance
  "barangay-clearance": {
    title: "CERTIFICATE OF BARANGAY CLEARANCE",
    salutation: "To Whom It May Concern:",
    seals: "city-left",
    signatures: "stacked",
    footer: ["purpose"],
    fields: [
      f("honorific"),
      f("name"),
      f("age"),
      f("civil_status"),
      f("purok"),
      f("pronoun"),
      f("day"),
      f("month"),
      f("year"),
      f("purpose"),
    ],
    defaults: certBaseDefaults,
    render(v) {
      return `
        <p class="cert-para">
          This is to certify that ${certText("honorific", v.honorific)}
          ${certBlank("name", v.name, "250px")},
          ${certBlank("age", v.age, "55px")} years old,
          ${certText("civil_status", v.civil_status)}, Filipino Citizen, is a
          bonafide resident of Purok ${certBlank("purok", v.purok, "55px")} of
          Barangay Conde Labak Batangas City. ${certText("pronoun", v.pronoun)}
          is known to be a person of Good Moral Character and good standing in
          this community. This certifies further that
          ${certText("pronoun", v.pronoun)} has No Derogatory Record in the
          &ldquo;Katarungang Pambarangay&rdquo; as per record kept filed in this
          office.
        </p>
        ${CERT_ON_REQUEST_ABOVE_NAMED}
        ${certIssuedLine(v, "SIGNED and ISSUED this")}
      `;
    },
  },

  // ─────────────────────────── Certificate of Indigency
  indigency: {
    title: "CERTIFICATE OF INDIGENCY",
    salutation: "To Whom It May Concern:",
    seals: "city-left",
    signatures: "stacked",
    footer: ["purpose", "applicant-box"],
    fields: [
      f("honorific"),
      f("name"),
      f("age"),
      f("civil_status"),
      f("purok"),
      f("day"),
      f("month"),
      f("year"),
      f("purpose"),
    ],
    defaults: certBaseDefaults,
    render(v) {
      return `
        <p class="cert-para">
          This is to certify that ${certText("honorific", v.honorific)}
          ${certBlank("name", v.name, "250px")},
          ${certBlank("age", v.age, "55px")} years old,
          ${certText("civil_status", v.civil_status)}, Filipino Citizen, is a
          bonafide residents of Purok ${certBlank("purok", v.purok, "55px")} of
          Barangay Conde Labak Batangas City.
        </p>
        <p class="cert-para">
          This is to certify further that the above-mentioned person and his/her
          family is classified as <b>&ldquo;INDIGENT&rdquo;</b> in this barangay.
        </p>
        ${CERT_ON_REQUEST_ABOVE_NAMED}
        ${certIssuedLine(v, "SIGNED and ISSUED this")}
      `;
    },
  },

  // ─────────────────────────── Barangay Certification for Solo Parent
  "solo-parent": {
    title: "BARANGAY CERTIFICATION FOR SOLO PARENT",
    salutation: "To Whom It May Concern:",
    seals: "city-left",
    signatures: "stacked",
    footer: ["purpose"],
    fields: [
      f("honorific"),
      f("name"),
      f("purok"),
      f("pronoun"),
      { key: "children", label: "No. of child / children", group: "Applicant", width: "55px" },
      { key: "solo_since", label: "Solo parent since", group: "Applicant", width: "150px" },
      f("day"),
      f("month"),
      f("year"),
      f("purpose"),
    ],
    defaults(ctx) {
      return Object.assign(certBaseDefaults(ctx), { children: "", solo_since: "" });
    },
    render(v) {
      return `
        <p class="cert-para">
          This is to certify that ${certText("honorific", v.honorific)}
          ${certBlank("name", v.name, "250px")} of legal age, natural born
          Filipino is a bonafide resident of Purok
          ${certBlank("purok", v.purok, "55px")} of Barangay Conde Labak Batangas
          City. This further certifies that ${certText("pronoun", v.pronoun)} is a
          <b>SOLO PARENT</b> to ${certBlank("children", v.children, "55px")}
          child/children since
          ${certBlankThen("solo_since", v.solo_since, "150px", ".")}
        </p>
        <p class="cert-para">
          This certification is issued upon the request of the abovementioned
          person for whatever legal purpose it may serve.
        </p>
        ${certIssuedLine(v, "SIGNED and ISSUED this")}
      `;
    },
  },

  // ─────────────────────────── Certificate of Relationship
  relationship: {
    title: "CERTIFICATE OF RELATIONSHIP",
    salutation: "To Whom It May Concern:",
    seals: "city-left",
    signatures: "stacked",
    footer: ["purpose", "applicant-box"],
    fields: [
      f("honorific"),
      f("name"),
      { key: "relation", label: "Is the…", group: "Applicant", width: "170px", placeholder: "e.g. mother" },
      { key: "relative", label: "…of", group: "Applicant", width: "210px", placeholder: "Full name" },
      f("purok"),
      f("day"),
      f("month"),
      f("year"),
      f("purpose"),
    ],
    defaults(ctx) {
      return Object.assign(certBaseDefaults(ctx), { relation: "", relative: "" });
    },
    render(v) {
      return `
        <p class="cert-para">
          This is to certify that ${certText("honorific", v.honorific)}
          ${certBlank("name", v.name, "250px")} is the
          ${certBlank("relation", v.relation, "170px")} of
          ${certBlank("relative", v.relative, "210px")} and both bonafide
          residents of Purok ${certBlank("purok", v.purok, "55px")} Barangay
          Conde Labak Batangas City.
        </p>
        ${CERT_ON_REQUEST_ABOVE_NAMED}
        ${certIssuedLine(v, "SIGNED and ISSUED this")}
      `;
    },
  },

  // ─────────────────────────── Business Clearance
  // The only one of the forms that names a *business* rather than only a
  // person, so the trade name is its own blank. The printed sheet carries no
  // salutation and no purpose line — the second paragraph says what it is for.
  "business-clearance": {
    title: "C E R T I F I C A T I O N",
    spacedTitle: true,
    seals: "brgy-left",
    signatures: "punong-right",
    fields: [
      f("name"),
      f("purok"),
      {
        key: "business_name",
        label: "Business named",
        group: "Business",
        width: "300px",
        placeholder: "e.g. DELA CRUZ SARI-SARI STORE",
      },
      f("requested_by"),
      f("day"),
      f("month"),
      f("year"),
    ],
    defaults(ctx) {
      return Object.assign(certBaseDefaults(ctx), { business_name: "" });
    },
    render(v) {
      return `
        <p class="cert-para">
          This is to certify that ${certBlank("name", v.name, "250px")} of legal
          age, a resident of Purok ${certBlank("purok", v.purok, "55px")},
          Barangay Conde Labak, Batangas City is given a Barangay Clearance to
          operate a business named
          ${certBlankThen("business_name", v.business_name, "300px", ".")}
        </p>
        <p class="cert-para">
          This certification is being issued upon the request of
          ${certBlank("requested_by", v.requested_by, "210px")} to operate their
          business around Batangas City.
        </p>
        ${certIssuedLine(v, "Given this")}
      `;
    },
  },

  // ─────────────────────────── Certification — house erected on another's lot
  "lot-boundary": {
    title: "C E R T I F I C A T I O N",
    spacedTitle: true,
    seals: "brgy-left",
    signatures: "punong-right",
    fields: [
      f("name"),
      { key: "lot_owner", label: "Lot owned by", group: "Property", width: "210px" },
      { key: "boundary", label: "Located at the boundary of", group: "Property", width: "210px" },
      { key: "tax_dec", label: "Tax Declaration No.", group: "Property", width: "180px" },
      f("day"),
      f("month"),
      f("year"),
    ],
    defaults(ctx) {
      return Object.assign(certBaseDefaults(ctx), {
        lot_owner: "",
        boundary: "",
        tax_dec: "",
      });
    },
    render(v) {
      return `
        <p class="cert-para">
          This is to certify that ${certBlank("name", v.name, "250px")} is a
          bonafide residents of this barangay.
        </p>
        <p class="cert-para">
          This is also certify that his house is erected at the lot owned by
          ${certBlank("lot_owner", v.lot_owner, "210px")} which is located at the
          boundary of ${certBlank("boundary", v.boundary, "210px")} and under Tax
          Declaration No. ${certBlank("tax_dec", v.tax_dec, "180px")} but it is
          actually under territorial jurisdiction of Barangay Conde Labak.
        </p>
        ${certIssuedLine(v, "ISSUED this")}
      `;
    },
  },

  // ─────────────────────────── Certification — property free of claims
  "property-clearance": {
    title: "C E R T I F I C A T I O N",
    spacedTitle: true,
    seals: "brgy-left",
    signatures: "punong-right",
    fields: [
      { key: "tax_dec", label: "Tax Declaration No.", group: "Property", width: "190px" },
      { key: "property_id", label: "Property Identification No.", group: "Property", width: "190px" },
      f("honorific", { label: "Owner — Mr. / Mrs. / Ms.", group: "Property" }),
      f("name", { label: "Owned by", group: "Property" }),
      f("honorific", { key: "req_honorific", label: "Requested by — Mr. / Mrs. / Ms.", group: "Issuance" }),
      f("requested_by"),
      { key: "requirement", label: "For… (requirements)", group: "Issuance", width: "190px" },
      f("day"),
      f("month"),
      f("year"),
    ],
    defaults(ctx) {
      return Object.assign(certBaseDefaults(ctx), {
        tax_dec: "",
        property_id: "",
        req_honorific: "Mr./Mrs./Ms.",
        requirement: "",
      });
    },
    render(v) {
      return `
        <p class="cert-para">
          This is to certify that the Tax Declaration No.
          ${certBlank("tax_dec", v.tax_dec, "190px")} with Property
          Identification No. ${certBlank("property_id", v.property_id, "190px")},
          located at Barangay Conde Labak, Batangas City is owned by
          ${certText("honorific", v.honorific)}
          ${certBlankThen("name", v.name, "250px", ".")}
        </p>
        <p class="cert-para">
          This also further certifies that the mentioned property has free of
          claims and conflicts in the office of Sangguniang Barangay of Conde
          Labak.
        </p>
        <p class="cert-para">
          This certification is issued upon the request of
          ${certText("req_honorific", v.req_honorific)}
          ${certBlank("requested_by", v.requested_by, "210px")} for
          ${certBlank("requirement", v.requirement, "190px")} requirements.
        </p>
        ${certIssuedLine(v, "Given this")}
      `;
    },
  },

  // ─────────────────────────── Certification — livestock for slaughter
  livestock: {
    title: "C E R T I F I C A T I O N",
    spacedTitle: true,
    salutation: "To Whom It May Concern:",
    seals: "city-left",
    signatures: "stacked",
    fields: [
      f("name"),
      { key: "heads", label: "No. of heads", group: "Livestock", width: "55px" },
      { key: "animal", label: "Hogs / cattle", group: "Livestock", width: "120px" },
      { key: "slaughterhouse", label: "Delivered to (slaughterhouse)", group: "Livestock", width: "200px" },
      { key: "hauler", label: "Hauled by", group: "Livestock", width: "200px" },
      f("day"),
      f("month"),
      f("year"),
    ],
    defaults(ctx) {
      return Object.assign(certBaseDefaults(ctx), {
        heads: "",
        animal: "hogs/cattle",
        slaughterhouse: "",
        hauler: "",
      });
    },
    render(v) {
      return `
        <p class="cert-para">
          This is to certify that ${certBlank("name", v.name, "250px")}, a
          resident of Barangay Conde Labak, Batangas City is the owner of
          ${certBlank("heads", v.heads, "55px")} heads of
          ${certText("animal", v.animal)} to be delivered to
          ${certBlank("slaughterhouse", v.slaughterhouse, "200px")}
          slaughterhouse hauled by
          ${certBlankThen("hauler", v.hauler, "200px", ".")}
        </p>
        <p class="cert-para">
          This certification is issued upon the request of the interested party
          in connection with the permit required by the Office of the City
          Veterinary and Agricultural Services.
        </p>
        ${certIssuedLine(v, "Issued this")}
      `;
    },
  },

  // ─────────────────────────── Barangay Certification — delayed birth registration
  "delayed-birth-registration": {
    title: "BARANGAY CERTIFICATION",
    seals: "city-left",
    signatures: "punong-right",
    footer: ["dry-seal"],
    fields: [
      f("name", { label: "Name of applicant (resident)" }),
      f("age"),
      { key: "child_name", label: "Name of child", group: "Child", width: "260px" },
      { key: "child_birthdate", label: "Date of birth", group: "Child", width: "260px" },
      { key: "child_birthplace", label: "Place of birth", group: "Child", width: "260px" },
      { key: "father", label: "Name of father", group: "Child", width: "260px" },
      { key: "mother", label: "Name of mother", group: "Child", width: "260px" },
      f("day"),
      f("month"),
      f("year"),
    ],
    defaults(ctx) {
      return Object.assign(certBaseDefaults(ctx), {
        child_name: "",
        child_birthdate: "",
        child_birthplace: "",
        father: "",
        mother: "",
      });
    },
    render(v) {
      return `
        <p class="cert-para">
          This is to certify that ${certBlank("name", v.name, "250px")}
          ${certBlank("age", v.age, "55px")} years old a bonafide resident of
          Barangay Conde Labak, Batangas City.
        </p>
        ${certLabelRows(v, [
          ["NAME OF CHILD:", "child_name"],
          ["DATE OF BIRTH:", "child_birthdate"],
          ["PLACE OF BIRTH:", "child_birthplace"],
          ["NAME OF FATHER:", "father"],
          ["NAME OF MOTHER:", "mother"],
        ])}
        <p class="cert-para">
          This certification is issued upon the request of the interested party
          in connection with the subject application for <b>DELAYED
          REGISTRATION</b> of Birth Certificate.
        </p>
        ${certIssuedLine(v, "Issued this", ".")}
      `;
    },
  },

  // ─────────────────────────── Barangay Certification — RA 11261 first-time jobseeker
  "first-time-jobseeker": {
    title: "BARANGAY CERTIFICATION",
    subtitle: "(First Time Jobseekers Assistance Act – Ra 11261)",
    seals: "city-left",
    signatures: "punong-left",
    footer: ["date-line", "witness"],
    fields: [
      f("honorific", { label: "Mr. / Ms.", options: ["Mr./Ms.", "Mr.", "Ms."] }),
      f("name"),
      { key: "residency_length", label: "Resident for (years/months)", group: "Applicant", width: "120px" },
      { key: "validity", label: "Valid only until", group: "Issuance", width: "200px" },
      f("day", { label: "Signed this…" }),
      f("month"),
      f("year"),
    ],
    defaults(ctx) {
      return Object.assign(certBaseDefaults(ctx), {
        honorific: "Mr./Ms.",
        residency_length: "",
        validity: "",
      });
    },
    render(v) {
      return `
        <p class="cert-para">
          This is to certify that ${certText("honorific", v.honorific)}
          ${certBlank("name", v.name, "250px")}, a resident of Barangay Conde
          Labak ${certBlank("residency_length", v.residency_length, "120px")}
          years/months, is qualified availee of RA 11261 or the First Time
          Jobseekers Act of 2019.
        </p>
        <p class="cert-para">
          I further certify that the holder/bearer was informed of his/her
          rights, including the duties and responsibilities accorded by RA11261
          through the Oath of Undertaking he/she has signed and executed in the
          presence of our Barangay Official.
        </p>
        ${certIssuedLine(v, "Signed this", "in the City/Municipality of Batangas.")}
        <p class="cert-para">
          This certification is valid only
          ${certBlank("validity", v.validity, "200px")} (one (1) year from the
          issuance).
        </p>
      `;
    },
  },

  // ─────────────────────────── Certification — sustainable livelihood assistance
  "livelihood-assistance": {
    title: "C E R T I F I C A T I O N",
    spacedTitle: true,
    seals: "city-left",
    signatures: "punong-right",
    footer: ["applicant-signature"],
    fields: [
      f("name"),
      f("purok"),
      f("birthdate", { label: "Born on" }),
      f("age"),
      f("day"),
      f("month"),
      f("year"),
    ],
    defaults: certBaseDefaults,
    render(v) {
      return `
        <p class="cert-para">
          This is to certify that ${certBlank("name", v.name, "250px")} is a
          bonafide resident of Purok ${certBlank("purok", v.purok, "55px")}
          Barangay Conde Labak, Batangas City, born on
          ${certBlank("birthdate", v.birthdate, "150px")} age
          ${certBlank("age", v.age, "55px")} years old.
        </p>
        <p class="cert-para">
          He/she requesting Barangay Certification relative to his/her
          application for Sustainable Livelihood Assistance in the Office of
          City Social Welfare and Development. This certifies further that
          he/she of good moral character and has no derogatory record in the
          community. Per assessment and record of this Barangay he/she is
          eligible for the said assistance.
        </p>
        ${certIssuedLine(v, "Given this")}
      `;
    },
  },

  // ─────────────────────────── Certification — City Government assistance
  "assistance-certification": {
    title: "C E R T I F I C A T I O N",
    spacedTitle: true,
    salutation: "To Whom It May Concern:",
    seals: "city-left",
    signatures: "punong-right",
    footer: ["applicant-signature", "patient-signature"],
    footerFirst: true,
    fields: [
      { key: "assistance", label: "Applying for … Assistance", group: "Assistance", width: "230px", placeholder: "e.g. Medical" },
      f("name", { label: "Name", group: "Identifying information" }),
      f("age", { group: "Identifying information" }),
      f("birthdate", { label: "Birthdate", group: "Identifying information" }),
      f("birthplace", { label: "Birthplace", group: "Identifying information" }),
      f("civil_status", { group: "Identifying information" }),
      f("purok", { label: "Purok", group: "Identifying information" }),
      f("day"),
      f("month"),
      f("year"),
    ],
    defaults(ctx) {
      return Object.assign(certBaseDefaults(ctx), {
        assistance: "",
        // This form prints the civil status on its own labelled line, so the
        // "single/married/widow" placeholder text would read oddly there.
        civil_status: (ctx.resident || {}).civil_status || "",
      });
    },
    render(v) {
      return `
        <p class="cert-para">
          This is to certify that the person whose identifying information
          appears below is a bonafide resident of this barangay. He/She appeared
          to my office requesting barangay certification relative to his/her
          application for ${certBlank("assistance", v.assistance, "230px")}
          Assistance in Batangas City Government.
        </p>
        <p class="cert-para">
          This certifies further that he/she is of good moral character and has
          no Derogatory Record in the community. Per assessment and record of
          this barangay he/she and his/her family is eligible for the said
          assistance.
        </p>
        ${certLabelRows(v, [
          ["NAME:", "name"],
          ["AGE:", "age"],
          ["BIRTHDATE:", "birthdate"],
          ["BIRTHPLACE:", "birthplace"],
          ["CIVIL STATUS:", "civil_status"],
          ["PUROK:", "purok"],
        ])}
        ${certIssuedLine(v, "Given this this", "at Barangay Conde Labak, Batangas City")}
      `;
    },
  },

  // ─────────────────────────── Certification — MERALCO electrical connection
  "electrical-connection": {
    title: "C E R T I F I C A T I O N",
    spacedTitle: true,
    salutation: "To whom it may concern,",
    seals: "city-left",
    signatures: "side-by-side",
    fields: [
      f("honorific", { label: "Mr. / Ms. / Mrs.", options: ["Mr./Ms./Mrs.", "Mr.", "Ms.", "Mrs."] }),
      f("name"),
      f("since", { label: "Occupant since" }),
      { key: "tax_dec", label: "Tax Declaration No.", group: "Property", width: "190px" },
      f("requested_by"),
      f("day"),
      f("month"),
      f("year"),
    ],
    defaults(ctx) {
      return Object.assign(certBaseDefaults(ctx), { tax_dec: "" });
    },
    render(v) {
      return `
        <p class="cert-para">
          This is to certify that ${certText("honorific", v.honorific)}
          ${certBlank("name", v.name, "250px")} of legal age, a resident of
          Barangay Conde Labak, Batangas City is a bonafide resident of this
          Barangay.
        </p>
        <p class="cert-para">
          This certifies further that said ${certText("honorific", v.honorific)}
          ${certBlank("name", v.name, "250px")} is the actual occupant of the
          parcel of land situated at Conde Labak, Batangas City since
          ${certBlank("since", v.since, "130px")} up to the present as evidenced
          by <b>TAX DECLARATION NO.</b>
          ${certBlank("tax_dec", v.tax_dec, "190px")} and absence of land title.
        </p>
        <p class="cert-para">
          This certification is being issued upon the request of
          ${certText("honorific", v.honorific)}
          ${certBlank("requested_by", v.requested_by, "210px")} in connection
          with his/her application for <b>Electrical Connection at MERALCO
          Office</b>, Batangas Branch.
        </p>
        ${certIssuedLine(v, "Given this")}
      `;
    },
  },
};
