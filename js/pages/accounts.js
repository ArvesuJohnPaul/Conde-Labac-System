// js/pages/accounts.js
// Account Claiming — the review queue for account applications.
//
// A resident applies with their details, a valid ID and a selfie holding it
// (js/account-application.js); nothing is an account until someone here
// approves it. The reviewer sees what the applicant never does: the barangay
// records the application could belong to. Three decisions:
//
//   Connect to record    — link the new account to an existing resident record
//   Add resident record  — the applicant is not on file: create the record
//                          (needs Barangay Residency too), then link it
//   Deny                 — a reason is required; the applicant is told it
//
// Server: routes/account-applications.js, which checks the Role Access Matrix
// row "Approve account applications" itself — this page only mirrors it.
window.CURRENT_PAGE = "accounts";

let APPS = [];
let APP_STATS = null;
let APP_TAB = "pending"; // pending | decided
let REVIEW = null; // { application, files, candidates }

const accEsc = (s) =>
  String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

function accDate(iso, withTime) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

// "3 days", "5 hours" — how long the oldest applicant has been waiting.
function accAge(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return "under an hour";
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

const FILE_LABELS = { id_front: "ID — front", id_back: "ID — back", selfie: "Selfie holding the ID" };

function renderPage() {
  renderAccountsPage();
}

function renderAccountsPage() {
  setContent(`
    <div class="page-header">
      <h2 class="page-title">Account Claiming</h2>
      <p class="page-desc">Review account applications — check the ID, then connect the applicant to their barangay record</p>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card warning"><div class="kpi-label">Pending Review</div><div class="kpi-value" id="kpi-app-pending">—</div><div class="kpi-trend" id="kpi-app-oldest">&nbsp;</div></div>
      <div class="kpi-card success"><div class="kpi-label">Approved (30 days)</div><div class="kpi-value" id="kpi-app-approved">—</div></div>
      <div class="kpi-card danger"><div class="kpi-label">Not Approved (30 days)</div><div class="kpi-value" id="kpi-app-denied">—</div></div>
      <div class="kpi-card"><div class="kpi-label">Resident Accounts</div><div class="kpi-value" id="kpi-app-accounts">—</div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="tab-bar" role="tablist" style="margin-bottom:0;border-bottom:0">
          <button type="button" class="tab" role="tab" data-app-tab="pending" onclick="setApplicationTab('pending')">Pending</button>
          <button type="button" class="tab" role="tab" data-app-tab="decided" onclick="setApplicationTab('decided')">Decided</button>
        </div>
        <button class="btn btn-sm btn-outline" onclick="loadApplications()"><i data-icon=refresh></i> Refresh</button>
      </div>
      <div id="claims-list-wrap"><div class="resident-summary">Loading applications…</div></div>
    </div>

    <div class="modal-backdrop" id="modal-app-review" onclick="closeApplicationReview(event)">
      <div class="modal-box modal-lg">
        <div class="modal-header">
          <div class="modal-title"><div class="modal-title-icon"><i data-icon=key></i></div> <span id="app-review-title">Account Application</span></div>
          <button class="modal-close" onclick="closeApplicationReview()"><i data-icon=x></i></button>
        </div>
        <div class="modal-body" id="app-review-body"><p class="table-muted" style="text-align:center;padding:24px">Loading…</p></div>
        <div class="modal-footer" id="app-review-footer">
          <button class="btn btn-outline" onclick="closeApplicationReview()">Close</button>
        </div>
      </div>
    </div>
  `);
  applyApplicationTab();
  loadApplications();
}

function setApplicationTab(tab) {
  APP_TAB = tab === "decided" ? "decided" : "pending";
  applyApplicationTab();
  resetPage("accounts");
  loadApplications();
}

function applyApplicationTab() {
  document.querySelectorAll("[data-app-tab]").forEach((b) => {
    const on = b.dataset.appTab === APP_TAB;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
}

async function loadApplications() {
  const wrap = document.getElementById("claims-list-wrap");
  try {
    const r = await apiGet(
      `/api/account-applications?status=${APP_TAB}&account_id=${actingAccountId()}`
    );
    APPS = r.items || [];
    APP_STATS = r.stats || null;
    updateApplicationKpis();
    repaintAccountClaimsList();
  } catch (err) {
    if (wrap)
      wrap.innerHTML = `<div class="resident-summary" style="color:#b91c1c">
        ${accEsc(err.message)}
        <button class="btn btn-sm btn-outline" onclick="loadApplications()" style="margin-left:8px">Retry</button></div>`;
  }
}

function updateApplicationKpis() {
  const s = APP_STATS || {};
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  set("kpi-app-pending", (s.pending ?? 0).toLocaleString());
  set("kpi-app-approved", (s.approved_30d ?? 0).toLocaleString());
  set("kpi-app-denied", (s.denied_30d ?? 0).toLocaleString());
  set("kpi-app-accounts", (s.resident_accounts ?? 0).toLocaleString());
  // A backlog is visible rather than silent: say how long the oldest has waited.
  set("kpi-app-oldest", s.oldest_pending_at ? `Oldest waiting ${accAge(s.oldest_pending_at)}` : "Nothing waiting");
}

// The list plus its pager, in one block so a page button repaints only this.
function renderAccountClaimsList() {
  if (!APPS.length)
    return `<div class="resident-summary">${
      APP_TAB === "pending" ? "No applications are waiting for review." : "No decided applications yet."
    }</div>`;
  const page = paginate("accounts", APPS, repaintAccountClaimsList);
  const rows = page.items
    .map((a) => {
      const badge =
        a.status === "pending"
          ? `<span class="badge badge-warning">Pending</span>`
          : a.status === "approved"
            ? `<span class="badge badge-success">Approved</span><div class="table-muted" style="font-size:12px">${a.outcome === "created" ? "New record" : "Connected"}</div>`
            : `<span class="badge badge-danger">Not approved</span><div class="table-muted" style="font-size:12px;max-width:220px">${accEsc(a.decision_reason)}</div>`;
      const when = APP_TAB === "pending" ? accDate(a.submitted_at, true) : accDate(a.reviewed_at, true);
      return `<tr>
        <td class="table-mono">${accEsc(a.ref)}</td>
        <td class="table-name">${accEsc(a.name)}</td>
        <td class="table-muted">${accEsc(a.email)}</td>
        <td>${a.purok ? `<span class="badge badge-gray">${accEsc(a.purok)}</span>` : '<span class="table-muted">—</span>'}</td>
        <td class="table-muted">${accEsc(a.id_type)}</td>
        <td class="table-muted">${when}${APP_TAB === "decided" && a.reviewed_by_name ? `<div style="font-size:12px">by ${accEsc(a.reviewed_by_name)}</div>` : ""}</td>
        <td>${badge}</td>
        <td><button class="btn btn-sm ${a.status === "pending" ? "btn-gold" : "btn-outline"}" onclick="openApplicationReview('${accEsc(a.ref)}')">
          ${a.status === "pending" ? "<i data-icon=eye></i> Review" : "<i data-icon=eye></i> View"}</button></td>
      </tr>`;
    })
    .join("");
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Ref No.</th><th>Applicant</th><th>Email</th><th>Purok</th><th>ID</th><th>${APP_TAB === "pending" ? "Submitted" : "Decided"}</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${page.html}`;
}

function repaintAccountClaimsList() {
  const wrap = document.getElementById("claims-list-wrap");
  if (!wrap) return;
  wrap.innerHTML = renderAccountClaimsList();
  if (typeof hydrateIcons === "function") hydrateIcons(wrap);
}

// ── Review ──────────────────────────────────────────────────────────────────
async function openApplicationReview(ref) {
  const modal = document.getElementById("modal-app-review");
  const body = document.getElementById("app-review-body");
  REVIEW = null;
  body.innerHTML = `<p class="table-muted" style="text-align:center;padding:24px">Loading…</p>`;
  document.getElementById("app-review-footer").innerHTML =
    `<button class="btn btn-outline" onclick="closeApplicationReview()">Close</button>`;
  document.getElementById("app-review-title").textContent = ref;
  modal.classList.add("open");
  try {
    REVIEW = await apiGet(
      `/api/account-applications/${encodeURIComponent(ref)}?account_id=${actingAccountId()}`
    );
  } catch (err) {
    body.innerHTML = `<p style="color:#b91c1c;text-align:center;padding:24px">${accEsc(err.message)}</p>`;
    return;
  }
  renderReview();
  loadReviewPhotos();
}

function closeApplicationReview(e) {
  if (e && e.target !== document.getElementById("modal-app-review")) return;
  document.getElementById("modal-app-review").classList.remove("open");
  REVIEW = null;
}

function renderReview() {
  const { application: a, files, candidates } = REVIEW;
  const pending = a.status === "pending";
  const detail = (label, value) =>
    `<tr><th style="width:38%">${label}</th><td>${value || '<span class="table-muted">—</span>'}</td></tr>`;

  const decided = !pending
    ? `<div class="alert ${a.status === "approved" ? "alert-success" : "alert-warning"} alert-mb">
         <span class="alert-icon"><i data-icon=${a.status === "approved" ? "check" : "x"}></i></span>
         ${
           a.status === "approved"
             ? `<strong>Approved</strong> — ${a.outcome === "created" ? "a new resident record was created" : "connected to an existing record"} (resident #${a.resident_id})`
             : `<strong>Not approved:</strong> ${accEsc(a.decision_reason)}`
         }
         ${a.reviewed_by_name ? ` · by ${accEsc(a.reviewed_by_name)}` : ""} · ${accDate(a.reviewed_at, true)}
       </div>`
    : "";

  const photos = files
    .map(
      (f) => `
      <figure class="app-photo" data-kind="${f.kind}">
        <div class="app-photo-frame">${
          f.available
            ? `<span class="table-muted">Loading…</span>`
            : `<span class="table-muted" style="padding:8px;text-align:center">Deleted ${accDate(f.purged_at)} — kept 30 days after the decision</span>`
        }</div>
        <figcaption>${FILE_LABELS[f.kind] || f.kind}</figcaption>
      </figure>`
    )
    .join("");

  const canCreate =
    typeof moduleAllowedFor === "function"
      ? moduleAllowedFor("residency", (getSession() || {}).role)
      : true;

  const cand = candidates.length
    ? candidates
        .map((c) => {
          const why = [
            c.same_birthdate ? "same birthdate" : "different birthdate",
            c.same_last ? "same surname" : "different surname",
            c.same_first ? "same first name" : "different first name",
          ].join(" · ");
          const claimed = c.claimed
            ? `<div class="alert alert-warning" style="margin:8px 0 0">
                 <span class="alert-icon"><i data-icon=triangle-alert></i></span>
                 Already claimed by <strong>${accEsc(c.claimed_email)}</strong> since ${accDate(c.claimed_since)}.
                 Either this applicant or that account holder is not who they say. Release the claim only once you are sure it is not theirs.
               </div>`
            : "";
          const actions = !pending
            ? ""
            : c.claimed
              ? `<button class="btn btn-sm btn-outline btn-danger-outline" onclick="releaseClaim(${c.claimed_account_id}, '${accEsc(c.claimed_email)}', ${c.resident_id})"><i data-icon=lock></i> Release claim</button>`
              : `<button class="btn btn-sm btn-gold" onclick="connectApplication(${c.resident_id})"><i data-icon=check></i> Connect to this record</button>`;
          return `
            <div class="app-candidate">
              <div class="app-candidate-photo">${c.photo ? `<img src="${accEsc(c.photo)}" alt=""/>` : '<i data-icon=user></i>'}</div>
              <div class="app-candidate-main">
                <div class="table-name">${accEsc(c.full_name)} <span class="table-muted">#${c.resident_id}</span></div>
                <div class="table-muted" style="font-size:12px">${accEsc(c.birthdate || "no birthdate")} · ${accEsc(c.purok || "no purok")}${c.household ? " · " + accEsc(c.household) : ""}</div>
                <div class="table-muted" style="font-size:12px">${why}</div>
                <div style="font-size:12px;margin-top:4px">Number on file: ${c.contact_no ? accEsc(c.contact_no) : '<span class="table-muted">none</span>'}
                  ${
                    c.mobile_matches
                      ? '<span class="badge badge-success" style="margin-left:6px">matches the applicant\'s mobile</span>'
                      : c.contact_no
                        ? '<span class="badge badge-gray" style="margin-left:6px">differs from the applicant\'s</span>'
                        : ""
                  }</div>
                ${claimed}
              </div>
              <div class="app-candidate-actions">${actions}</div>
            </div>`;
        })
        .join("")
    : `<div class="resident-summary" style="margin:0">No barangay record matches this name and birthdate.${pending ? " If the applicant lives in the barangay, add a record for them." : ""}</div>`;

  document.getElementById("app-review-body").innerHTML = `
    ${decided}
    <div class="app-review-grid">
      <div>
        <div class="card-title" style="margin-bottom:8px">Applicant</div>
        <table class="detail-table">
          ${detail("Name", accEsc(a.name))}
          ${detail("Date of birth", accEsc(a.birthdate))}
          ${detail("Sex", a.sex === "M" ? "Male" : a.sex === "F" ? "Female" : "")}
          ${detail("Purok", accEsc(a.purok))}
          ${detail("Address", accEsc(a.address_text))}
          ${detail("Mobile", `${accEsc(a.mobile_local)}${a.mobile_confirmed_at ? ' <span class="badge badge-success">confirmed by code</span>' : ""}`)}
          ${detail("Email", accEsc(a.email))}
          ${detail("ID presented", accEsc(a.id_type))}
          ${detail("Submitted", accDate(a.submitted_at, true))}
          ${detail("Consent to ID check", accDate(a.consent_at, true))}
        </table>
      </div>
      <div>
        <div class="card-title" style="margin-bottom:8px">ID and selfie</div>
        <div class="app-photos">${photos}</div>
        <p class="modal-help-text">Compare the face in the selfie with the ID photo, and the name and birthdate on the ID with the form. Click a photo to enlarge it.</p>
      </div>
    </div>
    <div class="card-title" style="margin:18px 0 8px">Barangay records this could be</div>
    <p class="modal-help-text" style="margin-top:0">Shown to you only — the applicant is never told whether a record was found. Nothing is linked until you choose.</p>
    ${pending && candidates.some((c) => !c.claimed) ? `
      <label class="acc-consent" style="margin:0 0 10px">
        <input type="checkbox" id="app-replace-contact"/>
        <span>When connecting, replace the record's number on file with the applicant's mobile (${accEsc(a.mobile_local)}).</span>
      </label>` : ""}
    <div class="app-candidates">${cand}</div>
    <div id="app-create-form"></div>
  `;

  document.getElementById("app-review-footer").innerHTML = pending
    ? `<button class="btn btn-outline" onclick="closeApplicationReview()">Close</button>
       <button class="btn btn-outline btn-danger-outline" onclick="denyApplication()"><i data-icon=x></i> Deny</button>
       ${canCreate ? `<button class="btn btn-outline" onclick="showCreateRecordForm()"><i data-icon=plus></i> Add resident record</button>` : ""}`
    : `<button class="btn btn-outline" onclick="closeApplicationReview()">Close</button>`;
  if (typeof hydrateIcons === "function") {
    hydrateIcons(document.getElementById("app-review-body"));
    hydrateIcons(document.getElementById("app-review-footer"));
  }
}

// The photos arrive one request each, after the details are on screen.
async function loadReviewPhotos() {
  if (!REVIEW) return;
  const ref = REVIEW.application.ref;
  for (const f of REVIEW.files.filter((x) => x.available)) {
    const frame = document.querySelector(`.app-photo[data-kind="${f.kind}"] .app-photo-frame`);
    try {
      const r = await apiGet(
        `/api/account-applications/${encodeURIComponent(ref)}/files/${f.kind}?account_id=${actingAccountId()}`
      );
      if (!frame || !REVIEW || REVIEW.application.ref !== ref) return;
      frame.innerHTML = `<img src="${r.data_url}" alt="${accEsc(FILE_LABELS[f.kind])}"/>`;
      frame.querySelector("img").addEventListener("click", (e) =>
        e.currentTarget.closest(".app-photo").classList.toggle("app-photo-zoom")
      );
    } catch (err) {
      if (frame) frame.innerHTML = `<span style="color:#b91c1c;font-size:12px">${accEsc(err.message)}</span>`;
    }
  }
}

// What the decision's text did, said in the toast rather than left to the SMS
// Log. The applicant is told by SMS and nothing else — if that did not go, the
// person who decided is the one who can pick up the phone instead.
//
// "queued" is the good case; "dry-run"/"off" mean texting is not switched on
// yet; "not-mobile" means the number on the application cannot receive one.
function applicationSmsNote(sms) {
  const r = (sms && sms.applicant) || "error";
  if (r === "queued") return " — the applicant is being texted.";
  if (r === "duplicate") return " — already texted.";
  if (r === "no-number" || r === "not-mobile")
    return " — no mobile number to text; tell them another way.";
  if (r === "dry-run" || r === "off" || r === "no-key")
    return " — texting is not switched on, so nobody was told.";
  if (r === "not-allowlisted") return " — the number is not on the test allowlist.";
  return " — the text could not be queued; tell them another way.";
}

async function connectApplication(residentId) {
  if (!REVIEW) return;
  const a = REVIEW.application;
  const c = REVIEW.candidates.find((x) => x.resident_id === residentId);
  const replace = !!document.getElementById("app-replace-contact")?.checked;
  const ok = await uiConfirm({
    tone: "accent",
    icon: "check",
    title: "Connect and approve?",
    message: `${a.email} becomes the online account of this resident record, and can sign in straight away.`,
    target: { icon: "user", label: `${c ? c.full_name : "#" + residentId} — resident #${residentId}` },
    notes: [
      { icon: "info", text: "Only do this if the ID and the selfie show the same person, and the ID matches this record." },
      ...(replace ? [{ icon: "phone", text: `The record's number becomes ${a.mobile_local}.` }] : []),
      { icon: "phone", text: `${a.mobile_local} is texted that the application was approved.` },
      { icon: "clipboard", text: "The approval is recorded in the Audit Log under your name." },
    ],
    confirmLabel: "Connect & Approve",
    confirmIcon: "check",
  });
  if (!ok) return;
  let res;
  try {
    res = await apiPost(`/api/account-applications/${encodeURIComponent(a.ref)}/connect`, {
      account_id: actingAccountId(),
      resident_id: residentId,
      replace_contact: replace,
    });
  } catch (err) {
    showToast("Could not approve: " + err.message, "<i data-icon=triangle-alert></i>");
    return;
  }
  showToast(
    `${a.ref} approved — account connected` + applicationSmsNote(res && res.sms),
    "<i data-icon=check></i>"
  );
  // The number already on the record was warned that an account now exists in
  // that person's name. Said out loud, because it is a text the barangay sent
  // to somebody who did not ask for one.
  if (res && res.sms && res.sms.record === "queued")
    showToast(
      "A notice was also texted to the number on the record.",
      "<i data-icon=phone></i>"
    );
  closeApplicationReview();
  loadApplications();
}

async function denyApplication() {
  if (!REVIEW) return;
  const a = REVIEW.application;
  const reason = await uiPrompt({
    icon: "x",
    title: "Deny this application?",
    message:
      "The applicant is texted this reason, and told it again if they try to sign in — so write it for them.",
    target: { icon: "user", label: `${a.name} (${a.email})` },
    field: {
      label: "Reason",
      placeholder: "e.g. The ID photo is too blurry to read. Please apply again.",
    },
    validate: (v) => (v ? null : "Say why — the applicant is told the reason."),
    confirmLabel: "Deny Application",
    confirmIcon: "x",
  });
  if (!reason) return;
  let res;
  try {
    res = await apiPost(`/api/account-applications/${encodeURIComponent(a.ref)}/deny`, {
      account_id: actingAccountId(),
      reason,
    });
  } catch (err) {
    showToast("Could not deny: " + err.message, "<i data-icon=triangle-alert></i>");
    return;
  }
  showToast(
    `${a.ref} not approved` + applicationSmsNote(res && res.sms),
    "<i data-icon=x></i>"
  );
  closeApplicationReview();
  loadApplications();
}

// "Release claim": the record is held by an account that may not be its
// owner's. Archiving that account (the ordinary account delete, with a reason)
// frees the record; its row and history stay, and restoring it from the
// Archive is refused while the real owner's account is live.
async function releaseClaim(accountId, email, residentId) {
  const reason = await uiPrompt({
    icon: "lock",
    title: "Release this claim?",
    message: "The account holding this record is archived: it can no longer sign in, and the record becomes free to connect to this application.",
    target: { icon: "user", label: `${email} — resident #${residentId}` },
    field: {
      label: "Why is this claim being released?",
      placeholder: "e.g. The resident presented her PhilSys ID in person; the earlier account is not hers.",
    },
    validate: (v) => (v ? null : "Give the reason — it is kept with the archived account."),
    confirmLabel: "Release Claim",
    confirmIcon: "lock",
  });
  if (!reason) return;
  try {
    await apiDelete(
      `/api/accounts/${accountId}?account_id=${actingAccountId()}&reason=${encodeURIComponent("Claim released: " + reason)}`
    );
  } catch (err) {
    showToast("Could not release the claim: " + err.message, "<i data-icon=triangle-alert></i>");
    return;
  }
  showToast(`Claim released — ${email} archived`, "<i data-icon=lock></i>");
  openApplicationReview(REVIEW.application.ref);
}

// ── Add resident record ─────────────────────────────────────────────────────
// The applicant is not on file. The record created here is the one
// certificates will be issued from, so it is the full resident form, prefilled
// from the application; staff complete what the applicant could not know
// (household, classifications) or what they want to confirm in person.
async function showCreateRecordForm() {
  if (!REVIEW) return;
  const a = REVIEW.application;
  const box = document.getElementById("app-create-form");
  const [puroks, households] = await Promise.all([
    apiGet("/api/puroks").catch(() => []),
    apiGet("/api/households").catch(() => []),
  ]);
  const opt = (v, label, sel) => `<option value="${accEsc(v)}"${sel ? " selected" : ""}>${accEsc(label)}</option>`;
  box.innerHTML = `
    <div class="card" style="margin-top:18px;padding:16px">
      <div class="card-title" style="margin-bottom:4px">New resident record</div>
      <p class="modal-help-text" style="margin-top:0">Prefilled from the application. Check it against the ID before saving.</p>
      <div class="form-row form-row-tight">
        <div class="form-group form-group-flat"><label class="form-label">Last Name *</label><input class="form-control" id="nr-last" data-rule="name" maxlength="80" value="${accEsc(a.last_name)}"/></div>
        <div class="form-group form-group-flat"><label class="form-label">First Name *</label><input class="form-control" id="nr-first" data-rule="name" maxlength="80" value="${accEsc(a.first_name)}"/></div>
      </div>
      <div class="form-row form-row-tight">
        <div class="form-group form-group-flat"><label class="form-label">Middle Name</label><input class="form-control" id="nr-middle" data-rule="name" maxlength="80" value="${accEsc(a.middle_name || "")}"/></div>
        <div class="form-group form-group-flat"><label class="form-label">Suffix</label><input class="form-control" id="nr-suffix" data-rule="name" maxlength="10" value="${accEsc(a.suffix || "")}"/></div>
      </div>
      <div class="form-row form-row-tight">
        <div class="form-group form-group-flat"><label class="form-label">Birthdate</label><input class="form-control" type="date" id="nr-birthdate" data-rule="past-date" value="${accEsc(a.birthdate)}"/></div>
        <div class="form-group form-group-flat"><label class="form-label">Sex</label>
          <select class="form-control" id="nr-sex">${opt("", "Select sex", !a.sex)}${opt("M", "Male", a.sex === "M")}${opt("F", "Female", a.sex === "F")}</select></div>
      </div>
      <!-- Not on the application: the applicant is asked in person, and the
           barangay is the one vouching for it. Six months of it before a
           Certificate of Barangay Residency (routes/certificates.js). -->
      <div class="form-group form-group-flat"><label class="form-label">Start of Residency *</label>
        <input class="form-control" type="date" id="nr-residency-start" data-rule="past-date" data-after="nr-birthdate"/>
        <p class="modal-help-text" style="margin-top:6px">When they began living in Barangay Conde Labak — ask the applicant. A Certificate of Barangay Residency can only be requested after 6 months.</p></div>
      <div class="form-row form-row-tight">
        <div class="form-group form-group-flat"><label class="form-label">Civil Status</label>
          <select class="form-control" id="nr-civil"><option value="">Select civil status</option><option>Single</option><option>Married</option><option>Widowed</option><option>Separated</option></select></div>
        <div class="form-group form-group-flat"><label class="form-label">Voter Status</label>
          <select class="form-control" id="nr-voter"><option value="">Select voter status</option><option>Registered</option><option>Not Registered</option></select></div>
      </div>
      <div class="form-row form-row-tight">
        <div class="form-group form-group-flat"><label class="form-label">Contact No.</label><input class="form-control" id="nr-contact" data-rule="mobile" maxlength="11" value="${accEsc(a.mobile_local || "")}"/></div>
        <div class="form-group form-group-flat"><label class="form-label">Occupation</label><input class="form-control" id="nr-occupation" data-rule="words" maxlength="80"/></div>
      </div>
      <div class="form-row form-row-tight">
        <div class="form-group form-group-flat"><label class="form-label">Purok</label>
          <select class="form-control" id="nr-purok">${opt("", "Select purok", !a.purok_id)}${puroks.map((p) => opt(p.purok_id, p.name, p.purok_id === a.purok_id)).join("")}</select></div>
        <div class="form-group form-group-flat"><label class="form-label">Address</label><input class="form-control" id="nr-address" data-rule="address" maxlength="200" value="${accEsc(a.address_text || "")}"/></div>
      </div>
      <div class="form-group form-group-flat"><label class="form-label">Household</label>
        <select class="form-control" id="nr-household">${opt("", "Select household (optional)", true)}${(households || []).map((h) => opt(h.building_id, h.name || "Household #" + h.building_id, false)).join("")}</select></div>
      <div class="form-group form-group-flat"><label class="form-label">Classifications</label>
        <div class="checkbox-row" style="display:flex;gap:16px;flex-wrap:wrap">
          <label><input type="checkbox" class="nr-cat" value="senior"/> Senior Citizen</label>
          <label><input type="checkbox" class="nr-cat" value="pwd"/> PWD</label>
          <label><input type="checkbox" class="nr-cat" value="solo-parent"/> Solo Parent</label>
          <label><input type="checkbox" class="nr-cat" value="indigent"/> Indigent Family</label>
        </div></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px">
        <button class="btn btn-outline" onclick="document.getElementById('app-create-form').innerHTML=''">Cancel</button>
        <button class="btn btn-gold" id="nr-save" onclick="createRecordAndApprove()"><i data-icon=check></i> Create Record & Approve</button>
      </div>
    </div>`;
  if (typeof hydrateIcons === "function") hydrateIcons(box);
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function createRecordAndApprove() {
  if (!REVIEW) return;
  const a = REVIEW.application;
  const v = (id) => (document.getElementById(id)?.value || "").trim();
  const needed = [
    { id: "nr-last", message: "Last name is required." },
    { id: "nr-first", message: "First name is required." },
    { id: "nr-residency-start", message: "Enter when they started living in the barangay." },
  ];
  if (window.Motion ? !Motion.require(needed) : needed.some((f) => !v(f.id))) {
    showToast("The record needs a first and last name and a start of residency.", "<i data-icon=triangle-alert></i>");
    return;
  }
  if (window.InputGuard && !InputGuard.check(document.getElementById("app-create-form"))) return;
  const btn = document.getElementById("nr-save");
  btn.disabled = true;
  try {
    const r = await apiPost(`/api/account-applications/${encodeURIComponent(a.ref)}/create-resident`, {
      account_id: actingAccountId(),
      resident: {
        last_name: v("nr-last"),
        first_name: v("nr-first"),
        middle_name: v("nr-middle") || null,
        suffix: v("nr-suffix") || null,
        birthdate: v("nr-birthdate") || null,
        residency_start: v("nr-residency-start") || null,
        sex: v("nr-sex") || null,
        civil_status: v("nr-civil") || null,
        voter_status: v("nr-voter") || null,
        contact_no: v("nr-contact") || null,
        occupation: v("nr-occupation") || null,
        purok_id: v("nr-purok") || null,
        address_text: v("nr-address") || null,
        building_id: v("nr-household") || null,
        classifications: Array.from(document.querySelectorAll(".nr-cat"))
          .filter((c) => c.checked)
          .map((c) => c.value),
      },
    });
    showToast(
      `${a.ref} approved — resident #${r.resident_id} created` + applicationSmsNote(r && r.sms),
      "<i data-icon=check></i>"
    );
    closeApplicationReview();
    loadApplications();
  } catch (err) {
    btn.disabled = false;
    showToast("Could not create the record: " + err.message, "<i data-icon=triangle-alert></i>");
  }
}
