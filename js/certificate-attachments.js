// js/certificate-attachments.js
// Photos/scans of the documents a certificate asks for. Two sides:
//
//   the requester   the "New Request" modal lists the documents for the chosen
//                   type and takes a file for each; they upload after the
//                   request is filed, since an attachment needs a request to
//                   belong to (certAttachPending).
//   staff           the Certificate Request modal shows what came in, with a
//                   thumbnail to check against what is typed on the form, and a
//                   retention hold for a contested request.
//
// Which documents each type wants is declared in js/certificate-types.js. How
// long they are kept is the server's business — see retention-service.js; this
// file only reports it.
//
// Loaded after js/certificate-types.js.

// Matches the server's own limits (routes/certificates.js) so a file that will
// be refused is caught here instead, with a clearer message.
const CERT_FILE_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const CERT_FILE_MAX_BYTES = 3 * 1024 * 1024;

function certFileSize(bytes) {
  return bytes >= 1048576
    ? (bytes / 1048576).toFixed(1) + " MB"
    : Math.max(1, Math.round(bytes / 1024)) + " KB";
}

// ── The requester's side ───────────────────────────────────────────────────
// Files chosen before the request exists, keyed by requirement: { key: {...} }.
let CERT_PENDING_FILES = {};

// Renders the document list for a type into #cert-requirements. Called whenever
// the type dropdown changes, so the list always matches the chosen certificate.
function certRenderRequirements(slug) {
  const wrap = document.getElementById("cert-requirements");
  if (!wrap) return;
  CERT_PENDING_FILES = {};
  const reqs = certRequirements(slug);
  if (!reqs.length) {
    wrap.innerHTML = "";
    return;
  }
  const health = reqs.some((r) => r.sensitivity === "health");
  wrap.innerHTML =
    '<label class="form-label">Requirements</label>' +
    '<p class="modal-help-text" style="margin:0 0 12px">' +
    "Photos of these are checked against your request before the certificate is " +
    "printed. Clear phone photos are fine. They are deleted " +
    (health ? "30–90 days" : "90 days") +
    " after your request is finished." +
    "</p>" +
    '<div class="cert-req-list">' +
    reqs
      .map(function (r) {
        return (
          '<div class="cert-req" data-key="' + certAttEsc(r.key) + '">' +
          '<div class="cert-req-head">' +
          '<span class="cert-req-label">' + certAttEsc(r.label) + "</span>" +
          (r.required
            ? '<span class="badge badge-warning">Required</span>'
            : '<span class="badge badge-gray">Optional</span>') +
          (r.sensitivity === "health"
            ? '<span class="badge badge-info">Kept 30 days</span>'
            : "") +
          "</div>" +
          (r.note ? '<div class="cert-req-note">' + certAttEsc(r.note) + "</div>" : "") +
          '<input class="form-control cert-req-input" type="file"' +
          ' accept="image/jpeg,image/png,image/webp,application/pdf"' +
          " onchange=\"certPickFile(this, '" + certAttEsc(r.key) + "')\" />" +
          '<div class="cert-req-chosen" data-chosen-for="' + certAttEsc(r.key) + '"></div>' +
          '<div class="cert-req-status" data-status-for="' + certAttEsc(r.key) + '"></div>' +
          "</div>"
        );
      })
      .join("") +
    "</div>";
}

function certAttEsc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

// Reads the chosen file now rather than at submit time, so a file that is too
// big or the wrong type is rejected while the requester is still looking at it.
function certPickFile(input, key) {
  const status = document.querySelector(`[data-status-for="${key}"]`);
  const chosen = document.querySelector(`[data-chosen-for="${key}"]`);
  const say = (msg, bad) => {
    if (status) {
      status.textContent = msg;
      status.className = "cert-req-status" + (bad ? " cert-req-bad" : " cert-req-ok");
    }
  };
  // A phone camera roll is a wall of near-identical photos of documents, and a
  // file name like IMG_20260731_114233.jpg proves nothing about which one was
  // picked. So the chosen file gets a thumbnail and a View, letting the
  // requester check it is the right page and readable BEFORE they submit —
  // which is the same check staff will do, and the reason a request gets
  // rejected when it fails.
  const showChosen = (html) => {
    if (chosen) chosen.innerHTML = html || "";
  };
  showChosen("");
  delete CERT_PENDING_FILES[key];
  const file = input.files && input.files[0];
  if (!file) return say("", false);
  if (!CERT_FILE_MIME.includes(file.type)) {
    input.value = "";
    return say("That has to be a JPEG, PNG or WebP photo, or a PDF.", true);
  }
  if (file.size > CERT_FILE_MAX_BYTES) {
    input.value = "";
    return say(
      `That file is ${certFileSize(file.size)} — the limit is ${CERT_FILE_MAX_BYTES / 1048576} MB.`,
      true
    );
  }
  const reader = new FileReader();
  reader.onload = function () {
    CERT_PENDING_FILES[key] = {
      key: key,
      label: certRequirementLabel(key),
      sensitivity: certRequirementSensitivity(key),
      file_name: file.name,
      mime_type: file.type,
      data_url: reader.result,
    };
    say(`${file.name} · ${certFileSize(file.size)} ready to upload`, false);
    const isPdf = file.type === "application/pdf";
    showChosen(
      '<div class="cert-req-preview">' +
        (isPdf
          ? '<span class="cert-req-thumb cert-req-thumb-pdf">PDF</span>'
          : '<img class="cert-req-thumb" alt="" src="' +
            certAttEsc(reader.result) + '" />') +
        '<button type="button" class="btn btn-sm btn-outline cert-req-view"' +
        " onclick=\"certViewPendingFile('" + certAttEsc(key) + "')\">" +
        '<i data-icon=eye></i> View</button>' +
        "</div>"
    );
  };
  reader.onerror = function () {
    input.value = "";
    showChosen("");
    say("That file could not be read — try again.", true);
  };
  reader.readAsDataURL(file);
}

// Opens the file the requester has chosen but not yet uploaded. Same window as
// the staff-side viewer, reading the data URL already in memory — nothing is
// sent anywhere to look at your own file.
function certViewPendingFile(key) {
  const f = CERT_PENDING_FILES[key];
  if (!f) return;
  certOpenDocument(f);
}

// Looked up across all types: the requirement list on screen belongs to the
// selected one, and keys like "valid-id" are shared.
function certRequirementLabel(key) {
  for (const t of window.CERT_TYPE_OPTIONS || [])
    for (const r of t.requirements || []) if (r.key === key) return r.label;
  return key;
}

function certRequirementSensitivity(key) {
  for (const t of window.CERT_TYPE_OPTIONS || [])
    for (const r of t.requirements || [])
      if (r.key === key && r.sensitivity) return r.sensitivity;
  return "normal";
}

// Required documents with nothing chosen — the submit path warns about these
// but does not block on them, since a walk-in can still bring paper.
function certMissingRequirements(slug) {
  return certRequirements(slug)
    .filter((r) => r.required && !CERT_PENDING_FILES[r.key])
    .map((r) => r.label);
}

// Upload everything chosen, once the request exists to attach it to. Returns
// what failed rather than throwing: a request that is already filed should not
// look like it failed because one photo didn't upload.
async function certAttachPending(certificateId, accountId) {
  const failed = [];
  for (const key of Object.keys(CERT_PENDING_FILES)) {
    const f = CERT_PENDING_FILES[key];
    try {
      await apiPost(`/api/certificates/${certificateId}/attachments`, {
        requirement_key: f.key,
        label: f.label,
        file_name: f.file_name,
        sensitivity: f.sensitivity,
        data_url: f.data_url,
        account_id: accountId || null,
      });
    } catch (err) {
      failed.push(f.label + " (" + err.message + ")");
    }
  }
  CERT_PENDING_FILES = {};
  return failed;
}

function certClearPendingFiles() {
  CERT_PENDING_FILES = {};
  document.querySelectorAll(".cert-req-input").forEach((el) => (el.value = ""));
  document.querySelectorAll(".cert-req-status").forEach((el) => (el.textContent = ""));
  document.querySelectorAll(".cert-req-chosen").forEach((el) => (el.innerHTML = ""));
}

// ── The staff side ─────────────────────────────────────────────────────────
// A block for the Certificate Request modal: every declared document, whether it
// arrived, and what has become of it.
async function certAttachmentsPanelHtml(request) {
  const reqs = certRequirements(request.type);
  let rows = [];
  try {
    rows = await apiGet(`/api/certificates/${request.id}/attachments`);
  } catch (_) {
    return (
      '<details class="cert-details"><summary class="cert-field-group-title">Requirements</summary>' +
      '<div class="cert-req-note">Could not load the attached documents.</div></details>'
    );
  }
  const byKey = {};
  rows.forEach((r) => (byKey[r.requirement_key] = r));
  // Two different counts, and conflating them misleads either way: how many
  // documents came in (the history) versus how many are still there to look at
  // (what a purge has left). The summary reports both.
  const got = reqs.filter((r) => byKey[r.key]).length;
  const disposed = rows.filter((r) => !r.available).length;
  // Anything uploaded against a requirement the type no longer lists still shows.
  const extra = rows.filter((r) => !reqs.some((q) => q.key === r.requirement_key));

  const item = (label, required, sensitivity, a) => {
    let state;
    if (!a)
      state = required
        ? '<span class="badge badge-warning">Not submitted</span>'
        : '<span class="badge badge-gray">Not submitted</span>';
    else if (!a.available)
      state = '<span class="badge badge-gray">Disposed of</span>';
    else state = '<span class="badge badge-success">Submitted</span>';
    let meta = "";
    if (a && a.available)
      meta =
        `<div class="cert-req-note">${certAttEsc(a.file_name || a.mime_type)} · ` +
        `${certFileSize(a.byte_size)} · uploaded ${certAttDate(a.uploaded_at)}` +
        // The date is only meaningful when the purge is actually going to run —
        // when it's held, the button already says so.
        (a.purge_after && !a.retention_hold
          ? ` · deleted ${certAttDate(a.purge_after)}`
          : "") +
        "</div>";
    else if (a && !a.available)
      meta = `<div class="cert-req-note">Deleted ${certAttDate(a.purged_at)} under the retention rule. The record that it was submitted remains.</div>`;
    const actions =
      a && a.available
        ? `<div class="btn-group" style="margin-top:8px">
             <button type="button" class="btn btn-sm btn-outline" onclick="certViewAttachment(${request.id}, ${a.id})">
               <i data-icon=eye></i> View
             </button>
             <!-- A pressed toggle rather than a button whose label flips: the
                  hold is a state of the document, so the control shows whether
                  it is on instead of naming the next action. -->
             <button type="button" class="btn btn-sm cert-hold-btn"
                     aria-pressed="${a.retention_hold ? "true" : "false"}"
                     title="${a.retention_hold
                       ? "This document is exempt from the retention schedule. Click to let it be deleted on time."
                       : "Keep this document past its deletion date — for a contested request."}"
                     onclick="certToggleHold(${request.id}, ${a.id}, ${!a.retention_hold})">
               <i data-icon=lock></i> ${a.retention_hold ? "Held from deletion" : "Hold from deletion"}
             </button>
           </div>`
        : "";
    return (
      '<div class="cert-req">' +
      '<div class="cert-req-head"><span class="cert-req-label">' +
      certAttEsc(label) +
      "</span>" +
      state +
      (sensitivity === "health" ? '<span class="badge badge-info">Health record</span>' : "") +
      "</div>" +
      meta +
      actions +
      "</div>"
    );
  };

  return (
    '<details class="cert-details" id="cert-attachments-block">' +
    '<summary class="cert-field-group-title">Requirements — ' +
    got +
    " of " +
    reqs.length +
    " submitted" +
    (disposed ? " · " + disposed + " disposed of" : "") +
    "</summary>" +
    '<div class="cert-req-list">' +
    reqs.map((r) => item(r.label, r.required, r.sensitivity, byKey[r.key])).join("") +
    extra.map((a) => item(a.label, false, a.sensitivity, a)).join("") +
    "</div></details>"
  );
}

function certAttDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt)
    ? String(d)
    : dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

// Opens one document in its own window. Shared by both sides — staff looking at
// what came in, and a requester checking the photo they just chose — so the two
// show the same thing the same way.
function certOpenDocument(a) {
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) {
    showToast("Allow pop-ups for this site to view the document.", "<i data-icon=triangle-alert></i>");
    return;
  }
  const body =
    a.mime_type === "application/pdf"
      ? `<embed src="${a.data_url}" type="application/pdf" style="width:100%;height:100%" />`
      : `<img src="${a.data_url}" alt="" />`;
  win.document.write(
    `<!doctype html><html><head><meta charset="utf-8" /><title>${certAttEsc(
      a.label || a.file_name || "Document"
    )}</title>` +
      `<style>html,body{margin:0;height:100%;background:#222;display:flex;align-items:center;` +
      `justify-content:center}img{max-width:100%;max-height:100%;object-fit:contain}</style>` +
      `</head><body>${body}</body></html>`
  );
  win.document.close();
}

// Staff side. Fetched on demand — the list deliberately carries no file bytes,
// so looking at someone's ID is an explicit act.
async function certViewAttachment(certificateId, attachmentId) {
  let a;
  try {
    a = await apiGet(`/api/certificates/${certificateId}/attachments/${attachmentId}`);
  } catch (err) {
    showToast("Could not open that document: " + err.message, "<i data-icon=triangle-alert></i>");
    return;
  }
  certOpenDocument(a);
}

// Suspends or resumes the retention purge for one document.
async function certToggleHold(certificateId, attachmentId, hold) {
  try {
    await apiPatch(`/api/certificates/${certificateId}/attachments/${attachmentId}`, {
      retention_hold: hold,
      account_id: typeof actingAccountId === "function" ? actingAccountId() : null,
    });
  } catch (err) {
    showToast("Could not change the hold: " + err.message, "<i data-icon=triangle-alert></i>");
    return;
  }
  showToast(
    hold
      ? "Held — this document will not be deleted on schedule."
      : "Hold released — the retention schedule applies again."
  );
  if (typeof logAudit === "function")
    logAudit(
      hold ? "CERT_ATTACHMENT_HOLD" : "CERT_ATTACHMENT_UNHOLD",
      `Retention hold ${hold ? "placed on" : "released for"} attachment #${attachmentId}`,
      "info",
      "certificate"
    );
  // Redraw the panel so the new state and dates show.
  if (typeof certRefreshAttachments === "function") certRefreshAttachments();
}

// Styles for both sides. Injected once, on demand.
const CERT_ATT_CSS = `
  .cert-req-list { display: flex; flex-direction: column; gap: 12px; }
  .cert-req {
    padding: 10px 12px;
    border: 1px solid var(--border, rgba(0,0,0,.12));
    border-radius: 8px;
  }
  .cert-req-head {
    display: flex; align-items: center; gap: 8px;
    flex-wrap: wrap; margin-bottom: 4px;
  }
  .cert-req-label { font-weight: 600; font-size: 13px; }
  .cert-req-note { font-size: 12px; opacity: .75; margin: 2px 0 8px; }
  .cert-req-status { font-size: 12px; margin-top: 6px; min-height: 15px; }
  .cert-req-ok { color: #15803d; }
  .cert-req-bad { color: #b91c1c; }

  /* The file picker.
     Left to the browser, the "Choose File" button is grey text on a grey
     chip, sitting on this form's own grey field — it reads as disabled, and
     against the dark theme's navy surface it all but disappears. The control
     the whole upload depends on cannot be the least visible thing on the row,
     so it is drawn here instead, as the gold chip this project already uses
     for "do the thing" (.btn-gold).

     Gold rather than navy on purpose: navy IS the dark theme's surface, so a
     navy button there would be the same invisibility in a different colour.
     Gold on navy text carries both themes with one rule.

     ::file-selector-button is the standard; ::-webkit-file-upload-button is
     repeated for older WebKit, which does not recognise the standard name and
     would otherwise fall back to the OS button. The two cannot be combined in
     one selector list — a browser that fails to parse either name drops the
     whole rule. */
  .cert-req-input {
    padding: 6px;
    cursor: pointer;
  }
  .cert-req-input::file-selector-button {
    margin-right: 10px;
    padding: 7px 14px;
    border: 0;
    border-radius: 6px;
    background: var(--gold-400, #f5c518);
    color: var(--navy-800, #0d1b3e);
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: background 120ms ease;
  }
  .cert-req-input::-webkit-file-upload-button {
    margin-right: 10px;
    padding: 7px 14px;
    border: 0;
    border-radius: 6px;
    background: var(--gold-400, #f5c518);
    color: var(--navy-800, #0d1b3e);
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
  }
  .cert-req-input:hover::file-selector-button { background: var(--gold-500, #d4a017); }
  .cert-req-input:hover::-webkit-file-upload-button { background: var(--gold-500, #d4a017); }

  /* What was chosen, before it is uploaded: a thumbnail to confirm it is the
     right document and the right way up, and a View to read it full size. */
  .cert-req-preview {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 8px;
  }
  .cert-req-thumb {
    width: 44px;
    height: 44px;
    flex: none;
    object-fit: cover;
    border: 1px solid var(--border, rgba(0,0,0,.14));
    border-radius: 6px;
    background: var(--surface-sunken, #f1f1f1);
  }
  .cert-req-thumb-pdf {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .04em;
    color: var(--text-secondary, #555);
  }

  /* The retention hold: a two-state button, so whether a document is exempt
     from the purge is readable at a glance. Styled here rather than borrowing
     the GIS toggle pill, because this panel also renders on the landing page,
     which does not load css/gis.css. */
  .cert-hold-btn {
    border: 1px solid var(--border, rgba(0, 0, 0, .14));
    background: var(--surface-raised, #fff);
    color: var(--text-secondary, #555);
  }
  .cert-hold-btn:hover {
    border-color: var(--navy, #1b2a4a);
    color: var(--navy, #1b2a4a);
  }
  .cert-hold-btn[aria-pressed="true"] {
    background: var(--navy, #1b2a4a);
    border-color: var(--navy, #1b2a4a);
    color: #fff;
  }
  .cert-hold-btn[aria-pressed="true"]:hover { opacity: .9; color: #fff; }
`;

(function certInjectAttCss() {
  if (document.getElementById("cert-att-style")) return;
  const style = document.createElement("style");
  style.id = "cert-att-style";
  style.textContent = CERT_ATT_CSS;
  document.head.appendChild(style);
})();
