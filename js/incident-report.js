// js/incident-report.js — the unified "File an Incident / Concern" modal.
//
// Concern reporting and blotter reporting were merged into one flow. This
// module builds the modal body dynamically (the static #modal-incidents markup
// duplicated across pages is overwritten on open), so there is a single source
// of truth. A filed report persists via gisAddCommunityReport (js/gis-map.js),
// which is the same store that drives the map pins, the GIS "Recent Community
// Reports" feed, and the Blotter page.
//
// Key behaviours (per the combined spec):
//   • No severity field.
//   • Date/time of the incident is always "now" — shown read-only, not asked.
//   • Location is picked by dropping a pin on an embedded map (no address text).
//   • Complainant name (and contact, when on file) auto-fill from resident data.
//   • Respondent/Subject and Witness Names appear only for interpersonal types.

let incidentMapInstance = null;
let incidentPickPoint = null;

function incEscape(str) {
  const div = document.createElement("div");
  div.textContent = String(str == null ? "" : str);
  return div.innerHTML;
}

// Resolves who is filing from the active session, best-effort matching their
// surname against the resident directory for purok/contact. Returns null when
// nobody is signed in (public visitor) — the modal then shows editable fields.
function incidentCurrentReporter() {
  let session = null;
  try {
    session =
      typeof getSession === "function"
        ? getSession()
        : JSON.parse(localStorage.getItem("ibmdss.session"));
  } catch (e) {
    session = null;
  }
  if (!session) return null;
  const name = session.displayName || session.user || "Resident";
  const initials =
    session.initials ||
    name
      .split(" ")
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();
  let purok = null;
  let contact = "";
  const surname = String(name).trim().split(" ").pop();
  if (surname && typeof RESIDENTS_DATA !== "undefined") {
    const match = RESIDENTS_DATA.find(
      (r) => r.name.split(",")[0].trim().toLowerCase() === surname.toLowerCase(),
    );
    if (match) {
      purok = match.purok || null;
      contact = match.contact || "";
    }
  }
  return { name, initials, role: session.role || "Resident", purok, contact };
}

// Options for the Incident Type select, straight from the unified metadata so
// the interpersonal flags (which drive the conditional fields) stay in sync.
function incidentTypeOptions() {
  return Object.entries(GIS_REPORT_TYPE_META)
    .map(([key, meta]) => `<option value="${key}">${incEscape(meta.label)}</option>`)
    .join("");
}

// Builds the modal shell once (header, emergency notice, incident-type row,
// embedded map, a stable #inc-fields container, and the footer). Kept stable
// across opens so the cached map instance in #incident-map is never detached;
// only #inc-fields and the map's picked pin are reset each time.
function ensureIncidentModalShell() {
  const modal = document.getElementById("modal-incidents");
  if (!modal) return null;
  const box = modal.querySelector(".modal-box");
  if (!box) return null;
  if (box.getAttribute("data-incident-built") === "1") return modal;

  box.classList.add("modal-xl");
  box.innerHTML = `
    <div class="modal-header">
      <div class="modal-title">
        <div class="modal-title-icon"><i data-icon="siren"></i></div>
        File an Incident / Concern
      </div>
      <button class="modal-close" onclick="closeServiceModal('incidents')"><i data-icon="x"></i></button>
    </div>
    <div class="modal-body">
      <div class="alert alert-warning">
        <span class="alert-icon"><i data-icon="triangle-alert"></i></span>
        For life-threatening emergencies, call <strong>911</strong> or the local
        police at <strong>(043) 702-4011</strong> immediately.
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Incident Type</label>
          <select class="form-control" id="inc-type">${incidentTypeOptions()}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Date &amp; Time of Incident</label>
          <input class="form-control" id="inc-datetime" readonly />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Location of Incident</label>
        <div class="gis-modal-map" id="incident-map" style="height:340px"></div>
        <div class="inc-pick-status" id="inc-pick-status">Click on the map to drop a pin where it happened.</div>
      </div>
      <div id="inc-fields"></div>
      <div class="alert alert-info">
        <span class="alert-icon"><i data-icon="info"></i></span>
        Your report will be assigned a case number and reviewed by a barangay official.
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeServiceModal('incidents')">Cancel</button>
      <button class="btn btn-danger btn-danger-strong" onclick="submitIncidentReport()">
        <i data-icon="check"></i> Submit Report
      </button>
    </div>`;
  box.setAttribute("data-incident-built", "1");

  // Type change toggles the interpersonal-only fields. Wired once; it looks the
  // fields up by id each time so it survives #inc-fields being rebuilt.
  box.querySelector("#inc-type").addEventListener("change", updateIncidentConditionalFields);
  return modal;
}

// Fills #inc-fields for the current filer. Complainant name is read-only when
// it comes from the signed-in resident; a public visitor gets editable inputs.
function renderIncidentFields(reporter) {
  const fieldsEl = document.getElementById("inc-fields");
  if (!fieldsEl) return;
  const known = !!reporter;
  const nameVal = known ? incEscape(reporter.name) : "";
  const purokLine = reporter && reporter.purok ? ` &middot; ${incEscape(reporter.purok)}` : "";
  const contactVal = reporter && reporter.contact ? incEscape(reporter.contact) : "";
  // A signed-in resident's name is fixed; only a visitor may type one.
  const nameField = known
    ? `<input class="form-control" id="inc-complainant" value="${nameVal}" readonly />
       <div class="inc-field-hint">Auto-filled from your resident record${purokLine}</div>`
    : `<input class="form-control" id="inc-complainant" placeholder="Your full name" />`;
  // Contact pre-fills when a number is on file; otherwise it stays editable so
  // one can be provided (the resident directory carries no phone numbers yet).
  const contactField = `<input class="form-control" type="tel" id="inc-contact" placeholder="09XXXXXXXXX" value="${contactVal}" ${contactVal ? "readonly" : ""} />`;

  fieldsEl.innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Complainant Full Name</label>
        ${nameField}
      </div>
      <div class="form-group">
        <label class="form-label">Contact Number</label>
        ${contactField}
      </div>
    </div>
    <div class="form-group inc-interpersonal" id="inc-respondent-group" hidden>
      <label class="form-label">Respondent / Subject (if known)</label>
      <input class="form-control" id="inc-respondent" placeholder="Name or description of the other party (optional)" />
    </div>
    <div class="form-group">
      <label class="form-label">Detailed Narration of Incident</label>
      <textarea class="form-control textarea-tall" id="inc-narration"
        placeholder="Describe what happened — sequence of events, persons involved, and any details..."></textarea>
    </div>
    <div class="form-group inc-interpersonal" id="inc-witness-group" hidden>
      <label class="form-label">Witness Names (optional)</label>
      <input class="form-control" id="inc-witnesses" placeholder="e.g. Maria Cruz, Jose Reyes" />
    </div>`;
}

// Shows/hides Respondent + Witness based on whether the selected incident type
// involves another party (GIS_REPORT_TYPE_META[type].interpersonal).
function updateIncidentConditionalFields() {
  const typeEl = document.getElementById("inc-type");
  if (!typeEl) return;
  const interpersonal = !!(GIS_REPORT_TYPE_META[typeEl.value] || {}).interpersonal;
  const respondent = document.getElementById("inc-respondent-group");
  const witness = document.getElementById("inc-witness-group");
  if (respondent) respondent.hidden = !interpersonal;
  if (witness) witness.hidden = !interpersonal;
}

// Entry point — replaces the old openServicePopup('incidents') behaviour.
function openIncidentModal() {
  const modal = ensureIncidentModalShell();
  if (!modal) return;

  const reporter = incidentCurrentReporter();
  renderIncidentFields(reporter);

  // Incident time is "now" — shown read-only.
  const dt = document.getElementById("inc-datetime");
  if (dt)
    dt.value = new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  const typeEl = document.getElementById("inc-type");
  if (typeEl) typeEl.selectedIndex = 0;
  updateIncidentConditionalFields();

  incidentPickPoint = null;
  const status = document.getElementById("inc-pick-status");
  if (status) {
    status.textContent = "Click on the map to drop a pin where it happened.";
    status.classList.remove("picked");
  }

  modal.classList.add("open");

  // Init the embedded map after the modal is visible (it needs layout to size),
  // then arm the location picker. Re-opening reuses the cached instance.
  setTimeout(async () => {
    if (typeof initGisMap !== "function") return;
    const inst = await initGisMap("incident-map", { anonymous: true, minimal: true });
    incidentMapInstance = inst || null;
    if (inst && typeof inst.beginLocationPick === "function") {
      inst.beginLocationPick((pt) => {
        incidentPickPoint = pt;
        const s = document.getElementById("inc-pick-status");
        if (s) {
          s.textContent = "Location pinned. Click elsewhere on the map to move it.";
          s.classList.add("picked");
        }
      });
    }
  }, 160);
}

function submitIncidentReport() {
  const typeEl = document.getElementById("inc-type");
  const type = typeEl ? typeEl.value : "other";
  const meta = GIS_REPORT_TYPE_META[type] || {};
  const narration = (document.getElementById("inc-narration")?.value || "").trim();
  const complainant = (document.getElementById("inc-complainant")?.value || "").trim();
  const contact = (document.getElementById("inc-contact")?.value || "").trim();
  const respondent = meta.interpersonal
    ? (document.getElementById("inc-respondent")?.value || "").trim()
    : "";
  const witnesses = meta.interpersonal
    ? (document.getElementById("inc-witnesses")?.value || "").trim()
    : "";

  if (!complainant) {
    alert("Please enter the complainant's full name.");
    document.getElementById("inc-complainant")?.focus();
    return;
  }
  if (!incidentPickPoint) {
    alert("Please drop a pin on the map to mark where the incident happened.");
    return;
  }
  if (!narration) {
    alert("Please describe what happened.");
    document.getElementById("inc-narration")?.focus();
    return;
  }

  const reporter = incidentCurrentReporter() || {
    name: complainant,
    initials: complainant.charAt(0).toUpperCase() || "?",
    role: "Resident",
    purok: null,
  };

  const record = gisAddCommunityReport(incidentPickPoint, {
    reportType: type,
    // The incident type doubles as the pin/feed headline; the narration is the
    // detail body. (The combined form has no separate title field.)
    title: meta.label || "Incident",
    comment: narration,
    reporter,
    complainant,
    contact,
    respondent,
    witnesses,
  });

  if (incidentMapInstance && typeof incidentMapInstance.endLocationPick === "function")
    incidentMapInstance.endLocationPick();
  incidentPickPoint = null;

  if (typeof closeServiceModal === "function") closeServiceModal("incidents");
  if (typeof showToast === "function")
    showToast(`Report filed — Case No. ${record.caseNo}`, "<i data-icon=siren></i>");

  // Refresh any on-screen views that read the same store.
  if (typeof renderReportFeed === "function") renderReportFeed();
  if (window.CURRENT_PAGE === "incidents" && typeof renderPage === "function") renderPage();
  if (incidentMapInstance && typeof incidentMapInstance.refreshAll === "function")
    incidentMapInstance.refreshAll();
}
