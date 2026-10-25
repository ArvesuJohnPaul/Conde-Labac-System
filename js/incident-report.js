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

// Resolves who is filing from the active session. Returns null when nobody is
// signed in — the modal then shows editable fields. Since 2026-10-24 a visitor
// is asked to sign in before the form opens, so that is now only the case for
// a session that ended while the page was open.
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
  // Purok and contact used to be guessed by matching the signed-in user's
  // surname against the landing page's demo RESIDENTS_DATA list. That list is
  // gone (it backed the public resident search, removed on data-privacy
  // grounds), and the guess was wrong for every barangay with two families
  // sharing a surname anyway. Left blank — the modal asks for the contact
  // number, and the pin the reporter drops is the location that matters.
  return {
    name,
    initials,
    role: session.role || "Resident",
    purok: null,
    contact: "",
  };
}

// Options for the Incident Type select, straight from the unified metadata so
// the interpersonal flags (which drive the conditional fields) stay in sync.
// It opens on "Select the type of incident": a first type picked by default
// is a report filed under a heading the reporter never chose.
function incidentTypeOptions() {
  return (
    '<option value="">Select the type of incident</option>' +
    Object.entries(GIS_REPORT_TYPE_META)
      .map(([key, meta]) => `<option value="${key}">${incEscape(meta.label)}</option>`)
      .join("")
  );
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
        For life-threatening emergencies, call <strong>911</strong> or the barangay
        hotline at <strong data-hotline="primary-number">043-702-8875</strong> immediately.
      </div>
      <div class="alert alert-info is-hidden" id="inc-log-banner">
        <span class="alert-icon"><i data-icon="phone"></i></span>
        <span id="inc-log-banner-text"></span>
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
        <!-- Logged calls only. A caller on the phone often cannot say exactly
             where they are, and a pin dropped on their behalf is a guess that
             looks like a fact on the map. Filed without one, the officials'
             text says "NO PIN DROPPED" and gives the caller's number. -->
        <label class="inc-nopin is-hidden" id="inc-nopin-wrap">
          <input type="checkbox" id="inc-nopin" />
          <span>The caller could not say exactly where — file without a pin</span>
        </label>
      </div>
      <div id="inc-fields"></div>
      <div class="alert alert-info">
        <span class="alert-icon"><i data-icon="info"></i></span>
        Your report will be reviewed by a barangay official. You will receive a phone notification with any updates.
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeServiceModal('incidents')">Cancel</button>
      <button class="btn btn-danger btn-danger-strong" onclick="submitIncidentReport()">
        <i data-icon="check"></i> Submit Report
      </button>
    </div>`;
  box.setAttribute("data-incident-built", "1");
  // The notice above carries the hotline as written-in fallback text; the
  // directory is what should actually be printed there. This markup is built
  // at open time, long after js/hotlines.js painted the page.
  if (window.Hotlines) Hotlines.paint(box);

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
  // A signed-in reporter's name is fixed; with no session, one is typed.
  const nameField = known
    ? `<input class="form-control" id="inc-complainant" value="${nameVal}" readonly />
       <div class="inc-field-hint">Auto-filled from your resident record${purokLine}</div>`
    : `<input class="form-control" id="inc-complainant" data-rule="names" maxlength="120" placeholder="Your full name" />`;
  // Contact pre-fills when a number is on file; otherwise it stays editable so
  // one can be provided (the resident directory carries no phone numbers yet).
  const contactField = `<input class="form-control" type="tel" id="inc-contact" data-rule="phone" maxlength="11" placeholder="09XXXXXXXXX" value="${contactVal}" ${contactVal ? "readonly" : ""} />`;

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
      <input class="form-control" id="inc-respondent" maxlength="200" placeholder="Name or description of the other party (optional)" />
    </div>
    <div class="form-group">
      <label class="form-label">Detailed Narration of Incident</label>
      <textarea class="form-control textarea-tall" id="inc-narration" maxlength="4000"
        placeholder="Describe what happened — sequence of events, persons involved, and any details..."></textarea>
    </div>
    <div class="form-group inc-interpersonal" id="inc-witness-group" hidden>
      <label class="form-label">Witness Names (optional)</label>
      <input class="form-control" id="inc-witnesses" data-rule="names" maxlength="400" placeholder="e.g. Maria Cruz, Jose Reyes" />
    </div>`;
}

// ── Validation feedback ─────────────────────────────────────────────────────
// These replace three raw window.alert() calls. A browser alert is modal, ugly,
// unstyleable, and — worst here — it does not tell the user WHICH field is
// wrong once it is dismissed. The design system already carries the states for
// this (.form-error and .form-control[aria-invalid="true"] in css/shared.css),
// so the message lives under the offending field and stays there until fixed.
// This also matches the call the project already made when window.confirm()
// and window.prompt() were replaced with designed dialogs.
function incidentClearErrors() {
  const body = document.querySelector("#modal-incidents .modal-body") || document;
  body.querySelectorAll("[data-inc-error]").forEach((el) => el.remove());
  body.querySelectorAll('[aria-invalid="true"]').forEach((el) => {
    el.removeAttribute("aria-invalid");
  });
  const pin = document.getElementById("inc-pick-status");
  if (pin) pin.classList.remove("inc-pick-status-error");
}

function incidentFieldError(fieldId, message) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  field.setAttribute("aria-invalid", "true");

  const msg = document.createElement("div");
  msg.className = "form-error";
  msg.setAttribute("data-inc-error", "");
  msg.setAttribute("role", "alert");
  msg.textContent = message;
  (field.closest(".form-group") || field.parentNode).appendChild(msg);

  // Clear as soon as they start fixing it — an error that lingers while the
  // user is plainly addressing it reads as broken.
  const clear = () => {
    field.removeAttribute("aria-invalid");
    msg.remove();
    field.removeEventListener("input", clear);
  };
  field.addEventListener("input", clear);

  field.scrollIntoView({ behavior: "smooth", block: "center" });
  field.focus({ preventScroll: true });
}

// The pin is not a form field, so its error goes on the map's own status line
// rather than inventing a field that does not exist.
function incidentPinError(message) {
  const status = document.getElementById("inc-pick-status");
  if (!status) return;
  status.textContent = message;
  status.classList.add("inc-pick-status-error");
  status.setAttribute("role", "alert");
  status.scrollIntoView({ behavior: "smooth", block: "center" });
  // The status line is not a form control, so it does not pick up the shake
  // that css/motion.css gives an [aria-invalid] field — but it is refusing the
  // submit for exactly the same reason, and should say so the same way.
  if (window.Motion) Motion.shake(status);
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

// Where this report came from, when a member of staff is logging one that
// arrived some other way — 'hotline' for a call to the barangay landline,
// 'walk-in' for someone at the counter. null for the ordinary form, where the
// server decides ('web').
//
// WHY IT MATTERS: phone calls are probably most of what a barangay receives,
// and until now none of them entered the system at all — the blotter, the map
// pins, the heatmap and the AI briefing only ever saw what was typed into the
// portal. Logging a call makes the analytics describe the real caseload
// (SMS-HOTLINE-PLAN.md §4.2).
let incidentSource = null;

// Entry point — replaces the old openServicePopup('incidents') behaviour.
// opts.source: 'hotline' | 'walk-in' puts the form in logged-call mode.
function openIncidentModal(opts) {
  incidentSource = (opts && opts.source) || null;
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

  // Logged-call mode: say which channel is being logged, and offer the
  // "no pin" option that only makes sense for a call.
  const banner = document.getElementById("inc-log-banner");
  const bannerText = document.getElementById("inc-log-banner-text");
  const noPinWrap = document.getElementById("inc-nopin-wrap");
  const noPin = document.getElementById("inc-nopin");
  if (banner) banner.classList.toggle("is-hidden", !incidentSource);
  if (noPinWrap) noPinWrap.classList.toggle("is-hidden", !incidentSource);
  if (noPin) noPin.checked = false;
  if (bannerText && incidentSource)
    bannerText.textContent =
      incidentSource === "hotline"
        ? "Logging a call to the barangay hotline. Enter the caller's name and number — the officials' text carries that number so they can ring back."
        : "Logging a report made in person at the barangay hall.";

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

async function submitIncidentReport() {
  const typeEl = document.getElementById("inc-type");
  const type = typeEl ? typeEl.value : "";
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

  incidentClearErrors();
  if (!type) {
    return incidentFieldError("inc-type", "Choose the type of incident you are reporting.");
  }
  if (!complainant) {
    return incidentFieldError(
      "inc-complainant",
      "Enter the complainant's full name so the report can be followed up."
    );
  }
  const noPinEl = document.getElementById("inc-nopin");
  const filedWithoutPin = !!(incidentSource && noPinEl && noPinEl.checked);
  if (!incidentPickPoint && !filedWithoutPin) {
    return incidentPinError(
      "Drop a pin on the map to mark where the incident happened."
    );
  }
  if (!narration) {
    return incidentFieldError(
      "inc-narration",
      "Describe what happened — the sequence of events, who was involved, and any details. Without this an officer has nothing to act on."
    );
  }

  // A name in letters, a number someone can call back on — each marked on
  // its own field (js/input-guard.js).
  if (window.InputGuard && !InputGuard.check(document.querySelector("#modal-incidents .modal-body"))) return;

  const reporter = incidentCurrentReporter() || {
    name: complainant,
    initials: complainant.charAt(0).toUpperCase() || "?",
    role: "Resident",
    purok: null,
  };

  // Filing takes an account (routes/incidents.js, since 2026-10-24). The form
  // only opens for a signed-in account, but the session can end while it is
  // open — signed out in another tab. The server would refuse the report, and
  // the local-copy fallback below would then show a case number the barangay
  // never received. Say so instead, and keep what was typed.
  let s = null;
  try {
    s = JSON.parse(localStorage.getItem("ibmdss.session"));
  } catch (e) {
    /* signed out */
  }
  if (!s) {
    if (typeof showToast === "function")
      showToast(
        "You are signed out. Sign in again to file this report — what you typed is still here.",
        "<i data-icon=lock></i>"
      );
    return;
  }

  // File to the shared database first (POST /api/incidents),
  // so the report reaches the MIS and the incident table — the pin point is
  // [lng, lat]. Falls back to local-only if the server can't be reached.
  let serverCaseNo = null;
  let serverId = null;
  if (typeof apiPost === "function") {
    try {
      const res = await apiPost("/api/incidents", {
        report_type: type,
        title: meta.label || "Incident",
        narration: narration,
        complainant_name: complainant,
        contact: contact || null,
        respondent: respondent || null,
        witnesses: witnesses || null,
        // Omitted entirely when there is no pin, so the server stores its
        // own default and the officials' text says so, rather than this form
        // inventing a location.
        lng: incidentPickPoint ? incidentPickPoint[0] : undefined,
        lat: incidentPickPoint ? incidentPickPoint[1] : undefined,
        source: incidentSource || undefined,
        complainant_id: s?.resident_id || null,
        account_id: s?.account_id || null,
      });
      serverCaseNo = res.case_no;
      serverId = res.id;
    } catch (err) {
      console.warn("[incident] API filing failed, keeping local copy:", err.message);
    }
  }

  // A report filed without a pin still needs a point for the local map store;
  // the server stores the same barangay centroid for one (routes/incidents.js),
  // so the pin a member of staff sees is the pin the database holds. The
  // officials' text is the one place it matters, and that says "NO PIN
  // DROPPED" rather than sending anyone here.
  const BARANGAY_CENTROID = [121.110793, 13.736541];
  const record = gisAddCommunityReport(incidentPickPoint || BARANGAY_CENTROID, {
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
    source: incidentSource || null,
    caseNo: serverCaseNo,
    serverId,
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
