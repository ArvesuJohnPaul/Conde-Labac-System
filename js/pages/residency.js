// js/pages/residency.js
// Resident directory — backed by the API (/api/residents → PostgreSQL).
// Data is fetched once on load, then filtered client-side for search/purok.
// Includes the "Add Resident" write path (POST /api/residents).
window.CURRENT_PAGE = "residency";

// In-memory copy of what the API returned, so filtering doesn't re-hit the DB.
let RESIDENTS = [];
// Households cached for the Add-Resident dropdown (loaded lazily on first open).
let HOUSEHOLD_OPTIONS = null;
// null = the modal is adding a new resident; a number = editing that resident.
let EDITING_ID = null;

// classification code (DB) → human label (UI badge)
const RESIDENT_CAT_LABELS = {
  senior: "Senior Citizen",
  pwd: "PWD",
  "solo-parent": "Solo Parent",
  indigent: "Indigent Family",
};

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function renderPage() {
  renderResidencyPage();
}

function renderResidencyPage() {
  setContent(`
    <div class="page-header">
      <h2 class="page-title">Barangay Residency</h2>
      <p class="page-desc">Full resident database — search, view, and manage resident profiles</p>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Total Residents</div><div class="kpi-value" id="kpi-total">—</div><div class="kpi-trend">Live from database</div></div>
      <div class="kpi-card info"><div class="kpi-label">Senior Citizens</div><div class="kpi-value" id="kpi-senior">—</div></div>
      <div class="kpi-card warning"><div class="kpi-label">PWD Residents</div><div class="kpi-value" id="kpi-pwd">—</div></div>
      <div class="kpi-card success"><div class="kpi-label">Solo Parents</div><div class="kpi-value" id="kpi-solo">—</div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">Resident Directory</div>
        <div class="btn-group">
          <button class="btn btn-sm btn-primary" onclick="openAddResident()"><i data-icon=plus></i> Add Resident</button>
          <button class="btn btn-sm btn-gold" onclick="openServicePopup('residency')"><i data-icon=search></i> Open Search</button>
          <button class="btn btn-sm btn-outline" onclick="loadResidents()"><i data-icon=refresh></i> Refresh</button>
        </div>
      </div>
      <div class="filter-row">
        <input class="form-control filter-input" id="res-search" placeholder="Search by name..." oninput="filterResidentsPage()"/>
        <select class="form-control filter-select" id="res-purok" onchange="filterResidentsPage()">
          <option>All Puroks</option><option>Purok 1</option><option>Purok 2</option><option>Purok 3</option><option>Purok 4</option><option>Purok 5</option>
        </select>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Age</th><th>Purok</th><th>Category</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody id="resident-tbody">
            <tr><td colspan="6" class="table-muted" style="text-align:center;padding:24px">Loading residents…</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Add Resident modal -->
    <div class="modal-backdrop" id="modal-add-resident" onclick="closeAddResident(event)">
      <div class="modal-box">
        <div class="modal-header">
          <div class="modal-title"><div class="modal-title-icon"><i data-icon=users></i></div> <span id="add-resident-title">Add Resident</span></div>
          <button class="modal-close" onclick="closeAddResident()"><i data-icon=x></i></button>
        </div>
        <div class="modal-body">
          <div class="form-row form-row-tight">
            <div class="form-group form-group-flat">
              <label class="form-label">Last Name *</label>
              <input class="form-control" id="add-last" placeholder="e.g. Santos"/>
            </div>
            <div class="form-group form-group-flat">
              <label class="form-label">First Name *</label>
              <input class="form-control" id="add-first" placeholder="e.g. Pedro"/>
            </div>
          </div>
          <div class="form-row form-row-tight">
            <div class="form-group form-group-flat">
              <label class="form-label">Middle Name</label>
              <input class="form-control" id="add-middle" placeholder="optional"/>
            </div>
            <div class="form-group form-group-flat">
              <label class="form-label">Suffix</label>
              <input class="form-control" id="add-suffix" placeholder="e.g. Jr., III"/>
            </div>
          </div>
          <div class="form-row form-row-tight">
            <div class="form-group form-group-flat">
              <label class="form-label">Birthdate</label>
              <input class="form-control" id="add-birthdate" type="date"/>
            </div>
            <div class="form-group form-group-flat">
              <label class="form-label">Sex</label>
              <select class="form-control" id="add-sex">
                <option value="">—</option><option value="M">Male</option><option value="F">Female</option>
              </select>
            </div>
          </div>
          <div class="form-row form-row-tight">
            <div class="form-group form-group-flat">
              <label class="form-label">Civil Status</label>
              <select class="form-control" id="add-civil">
                <option value="">—</option><option>Single</option><option>Married</option><option>Widowed</option><option>Separated</option>
              </select>
            </div>
            <div class="form-group form-group-flat">
              <label class="form-label">Voter Status</label>
              <select class="form-control" id="add-voter">
                <option value="">—</option><option>Registered</option><option>Not Registered</option>
              </select>
            </div>
          </div>
          <div class="form-row form-row-tight">
            <div class="form-group form-group-flat">
              <label class="form-label">Contact No.</label>
              <input class="form-control" id="add-contact" placeholder="e.g. 0917 123 4567"/>
            </div>
            <div class="form-group form-group-flat">
              <label class="form-label">Occupation</label>
              <input class="form-control" id="add-occupation" placeholder="e.g. Farmer"/>
            </div>
          </div>
          <div class="form-row form-row-tight">
            <div class="form-group form-group-flat">
              <label class="form-label">Household</label>
              <select class="form-control" id="add-household"><option value="">— None —</option></select>
            </div>
            <div class="form-group form-group-flat">
              <label class="form-label">Relationship to Head</label>
              <select class="form-control" id="add-relationship">
                <option value="">—</option><option>Head</option><option>Spouse</option><option>Child</option><option>Parent</option><option>Sibling</option><option>Other Relative</option><option>Non-relative</option>
              </select>
            </div>
          </div>
          <div class="form-group form-group-flat">
            <label class="form-label">Classifications</label>
            <div class="checkbox-row" style="display:flex;gap:16px;flex-wrap:wrap">
              <label><input type="checkbox" class="add-cat" value="senior"/> Senior Citizen</label>
              <label><input type="checkbox" class="add-cat" value="pwd"/> PWD</label>
              <label><input type="checkbox" class="add-cat" value="solo-parent"/> Solo Parent</label>
              <label><input type="checkbox" class="add-cat" value="indigent"/> Indigent Family</label>
            </div>
          </div>
          <p class="modal-help-text" style="margin-top:8px">New residents start as <strong>Unclaimed</strong> — the status becomes Active only when the resident claims their account via Account Claiming.</p>
          <div id="add-resident-error" style="color:#b91c1c;font-size:13px;min-height:16px"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" onclick="closeAddResident()">Cancel</button>
          <button class="btn btn-primary" id="add-resident-save" onclick="submitAddResident()"><i data-icon=check></i> Save Resident</button>
        </div>
      </div>
    </div>

    <!-- View Resident modal -->
    <div class="modal-backdrop" id="modal-view-resident" onclick="closeViewResident(event)">
      <div class="modal-box">
        <div class="modal-header">
          <div class="modal-title"><div class="modal-title-icon"><i data-icon=user></i></div> Resident Profile</div>
          <button class="modal-close" onclick="closeViewResident()"><i data-icon=x></i></button>
        </div>
        <div class="modal-body" id="view-resident-body">
          <p class="table-muted" style="text-align:center;padding:24px">Loading…</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" onclick="closeViewResident()">Close</button>
        </div>
      </div>
    </div>
  `);
  loadResidents();
}

// Fetch all residents from the API and paint the table + KPIs.
async function loadResidents() {
  const tbody = document.getElementById("resident-tbody");
  if (tbody)
    tbody.innerHTML = `<tr><td colspan="6" class="table-muted" style="text-align:center;padding:24px">Loading residents…</td></tr>`;
  try {
    RESIDENTS = await apiGet("/api/residents");
    updateResidentKpis();
    filterResidentsPage();
  } catch (err) {
    if (tbody)
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:#b91c1c">
        Could not reach the server (${escapeHtml(err.message)}).
        <button class="btn btn-sm btn-outline" onclick="loadResidents()" style="margin-left:8px">Retry</button>
      </td></tr>`;
  }
}

// Apply the search box + purok dropdown to the in-memory list and re-render.
// NOTE: named *Page to avoid colliding with shell.js's modal filterResidents().
function filterResidentsPage() {
  const q = (document.getElementById("res-search")?.value || "").toLowerCase();
  const purok = document.getElementById("res-purok")?.value || "All Puroks";
  const list = RESIDENTS.filter((r) => {
    const matchName = !q || (r.name || "").toLowerCase().includes(q);
    const matchPurok = purok === "All Puroks" || r.purok === purok;
    return matchName && matchPurok;
  });
  renderResidentRows(list);
}

function renderResidentRows(list) {
  const tbody = document.getElementById("resident-tbody");
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-muted" style="text-align:center;padding:24px">No residents match.</td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((r) => {
      const cats = (r.cats && r.cats.length ? r.cats : r.cat ? [r.cat] : [])
        .map(
          (c) =>
            `<span class="badge badge-gold">${escapeHtml(RESIDENT_CAT_LABELS[c] || c)}</span>`
        )
        .join(" ");
      // "Status" column reflects account-claimed ONLY: claimed → Active
      // (green), otherwise Unclaimed (gray). No fallback to lifecycle status —
      // an unclaimed resident must never show as Active.
      const claimed = r.claimed === true;
      return `<tr>
        <td class="table-name">${escapeHtml(r.name)}</td>
        <td>${r.age == null ? '<span class="table-muted">—</span>' : r.age}</td>
        <td>${r.purok ? `<span class="badge badge-gray">${escapeHtml(r.purok)}</span>` : '<span class="table-muted">—</span>'}</td>
        <td>${cats || '<span class="table-muted">—</span>'}</td>
        <td><span class="badge ${claimed ? "badge-success" : "badge-gray"}">${claimed ? "Active" : "Unclaimed"}</span></td>
        <td><div class="btn-group">
          <button class="btn btn-sm btn-outline" onclick="openViewResident(${Number(r.id)})">View</button>
          <button class="btn btn-sm btn-gold" onclick="openEditResident(${Number(r.id)})">Edit</button>
        </div></td>
      </tr>`;
    })
    .join("");
}

function updateResidentKpis() {
  const count = (code) =>
    RESIDENTS.filter((r) => (r.cats || []).includes(code)).length;
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set("kpi-total", RESIDENTS.length.toLocaleString());
  set("kpi-senior", count("senior"));
  set("kpi-pwd", count("pwd"));
  set("kpi-solo", count("solo-parent"));
}

// ─────────────────────────── View Resident (detail) ──────────────────────────
async function openViewResident(id) {
  const modal = document.getElementById("modal-view-resident");
  const body = document.getElementById("view-resident-body");
  if (!modal || !body) return;
  body.innerHTML = `<p class="table-muted" style="text-align:center;padding:24px">Loading…</p>`;
  modal.classList.add("open");
  try {
    const r = await apiGet("/api/residents/" + id);
    body.innerHTML = renderResidentDetail(r);
    if (typeof logAudit === "function")
      logAudit("RESIDENT_VIEW", `Viewed resident profile: ${r.last_name}, ${r.first_name} (#${r.resident_id})`, "info", "resident");
  } catch (err) {
    body.innerHTML = `<p style="text-align:center;padding:24px;color:#b91c1c">Could not load resident (${escapeHtml(err.message)}).</p>`;
  }
}

function closeViewResident(e) {
  if (e && e.target !== document.getElementById("modal-view-resident")) return;
  document.getElementById("modal-view-resident")?.classList.remove("open");
}

// Full profile layout: header (name + status badges) then label/value grid.
function renderResidentDetail(r) {
  const dash = '<span class="table-muted">—</span>';
  const v = (x) => (x == null || x === "" ? dash : escapeHtml(x));
  // Middle name always displays as an initial ("A."), never in full.
  const fullName =
    `${r.last_name}, ${r.first_name}` +
    (r.middle_name ? " " + r.middle_name[0] + "." : "") +
    (r.suffix ? " " + r.suffix : "");
  const sex = r.sex === "M" ? "Male" : r.sex === "F" ? "Female" : null;
  const cats = (r.classifications || [])
    .map((c) => `<span class="badge badge-gold">${escapeHtml(RESIDENT_CAT_LABELS[c] || c)}</span>`)
    .join(" ");
  const fmtDate = (d) => {
    if (!d) return null;
    const dt = new Date(d + "T00:00:00");
    return isNaN(dt) ? d : dt.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
  };
  const row = (label, value) => `
    <div style="display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid rgba(0,0,0,.06)">
      <span class="table-muted" style="flex-shrink:0">${label}</span>
      <span style="text-align:right;font-weight:500">${value}</span>
    </div>`;
  return `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
      <div class="resident-avatar-sm">${escapeHtml((r.first_name[0] || "") + (r.last_name[0] || ""))}</div>
      <div>
        <div style="font-weight:700;font-size:16px">${escapeHtml(fullName)}</div>
        <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap">
          <span class="badge ${r.account_claimed ? "badge-success" : "badge-gray"}">${r.account_claimed ? "Active (claimed)" : "Unclaimed"}</span>
          <span class="badge badge-gray">Record: ${escapeHtml(r.status)}</span>
        </div>
      </div>
    </div>
    ${row("Resident ID", "#" + r.resident_id)}
    ${row("Age", r.age == null ? dash : r.age + " yrs")}
    ${row("Birthdate", v(fmtDate(r.birthdate)))}
    ${row("Sex", v(sex))}
    ${row("Civil Status", v(r.civil_status))}
    ${row("Contact No.", v(r.contact_no))}
    ${row("Occupation", v(r.occupation))}
    ${row("Voter Status", v(r.voter_status))}
    ${row("Purok", v(r.purok))}
    ${row("Household No.", v(r.household_no))}
    ${row("Address", v(r.address_text))}
    ${row("Relationship to Head", v(r.relationship_to_head))}
    ${row("Classifications", cats || dash)}
    ${row("Date Registered", v(fmtDate(r.date_registered)))}
  `;
}

// ──────────────────── Add / Edit Resident (write path) ───────────────────────
// One modal, two modes: EDITING_ID null = add (POST), set = edit (PUT).
function resetResidentForm() {
  [
    "add-last", "add-first", "add-middle", "add-suffix", "add-birthdate",
    "add-contact", "add-occupation",
    "add-sex", "add-civil", "add-voter", "add-household", "add-relationship",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  document.querySelectorAll(".add-cat").forEach((c) => (c.checked = false));
  const errEl = document.getElementById("add-resident-error");
  if (errEl) errEl.textContent = "";
}

function setResidentModalMode(editing) {
  const title = document.getElementById("add-resident-title");
  if (title) title.textContent = editing ? "Edit Resident" : "Add Resident";
  const btn = document.getElementById("add-resident-save");
  if (btn) {
    btn.innerHTML = `<i data-icon=check></i> ${editing ? "Save Changes" : "Save Resident"}`;
    if (typeof hydrateIcons === "function") hydrateIcons(btn);
  }
}

async function openAddResident() {
  const modal = document.getElementById("modal-add-resident");
  if (!modal) return;
  EDITING_ID = null;
  resetResidentForm();
  setResidentModalMode(false);
  modal.classList.add("open");
  await populateHouseholdOptions();
}

async function openEditResident(id) {
  const modal = document.getElementById("modal-add-resident");
  if (!modal) return;
  EDITING_ID = id;
  resetResidentForm();
  setResidentModalMode(true);
  modal.classList.add("open");
  const errEl = document.getElementById("add-resident-error");
  try {
    // Load households first so the select has its options before we set value.
    await populateHouseholdOptions();
    const r = await apiGet("/api/residents/" + id);
    const set = (elId, val) => {
      const el = document.getElementById(elId);
      if (el) el.value = val == null ? "" : val;
    };
    set("add-last", r.last_name);
    set("add-first", r.first_name);
    set("add-middle", r.middle_name);
    set("add-suffix", r.suffix);
    set("add-birthdate", r.birthdate);
    set("add-sex", r.sex);
    set("add-civil", r.civil_status);
    set("add-voter", r.voter_status);
    set("add-contact", r.contact_no);
    set("add-occupation", r.occupation);
    set("add-household", r.household_id);
    set("add-relationship", r.relationship_to_head);
    const cats = r.classifications || [];
    document
      .querySelectorAll(".add-cat")
      .forEach((c) => (c.checked = cats.includes(c.value)));
  } catch (err) {
    if (errEl) errEl.textContent = "Could not load resident: " + err.message;
  }
}

function closeAddResident(e) {
  if (e && e.target !== document.getElementById("modal-add-resident")) return;
  const modal = document.getElementById("modal-add-resident");
  if (modal) modal.classList.remove("open");
}

// Fetch households once and fill the dropdown (id → "HH-0001 — Purok 1 (3)").
async function populateHouseholdOptions() {
  const sel = document.getElementById("add-household");
  if (!sel) return;
  if (HOUSEHOLD_OPTIONS === null) {
    try {
      HOUSEHOLD_OPTIONS = await apiGet("/api/households");
    } catch (err) {
      HOUSEHOLD_OPTIONS = []; // non-fatal — resident can be saved without one
    }
  }
  sel.innerHTML =
    `<option value="">— None —</option>` +
    HOUSEHOLD_OPTIONS.map(
      (h) =>
        `<option value="${h.household_id}">${escapeHtml(h.household_no || "HH-" + h.household_id)}${h.purok ? " — " + escapeHtml(h.purok) : ""} (${h.members || 0})</option>`
    ).join("");
}

async function submitAddResident() {
  const errEl = document.getElementById("add-resident-error");
  const btn = document.getElementById("add-resident-save");
  const val = (id) => (document.getElementById(id)?.value || "").trim();
  const last = val("add-last");
  const first = val("add-first");
  if (!last || !first) {
    if (errEl) errEl.textContent = "Last name and first name are required.";
    return;
  }
  const classifications = Array.from(document.querySelectorAll(".add-cat"))
    .filter((c) => c.checked)
    .map((c) => c.value);
  // account_claimed is never sent — new residents always start Unclaimed;
  // only the Account Claiming flow (POST /api/residents/claim) activates it.
  const body = {
    last_name: last,
    first_name: first,
    middle_name: val("add-middle") || null,
    suffix: val("add-suffix") || null,
    birthdate: val("add-birthdate") || null,
    sex: val("add-sex") || null,
    civil_status: val("add-civil") || null,
    relationship_to_head: val("add-relationship") || null,
    contact_no: val("add-contact") || null,
    occupation: val("add-occupation") || null,
    voter_status: val("add-voter") || null,
    household_id: val("add-household") ? Number(val("add-household")) : null,
    classifications,
  };
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = "Saving…";
  }
  if (errEl) errEl.textContent = "";
  try {
    if (EDITING_ID != null) {
      await apiPut("/api/residents/" + EDITING_ID, body);
    } else {
      await apiPost("/api/residents", body);
    }
    const verb = EDITING_ID != null ? "updated" : "added";
    closeAddResident();
    if (typeof showToast === "function")
      showToast(`Resident ${first} ${last} ${verb}`);
    if (typeof logAudit === "function")
      logAudit(
        EDITING_ID != null ? "RESIDENT_EDIT" : "RESIDENT_ADD",
        `Resident ${last}, ${first} ${verb}`,
        "info",
        "resident"
      );
    EDITING_ID = null;
    await loadResidents();
  } catch (err) {
    if (errEl) errEl.textContent = "Could not save: " + err.message;
  } finally {
    if (btn) {
      btn.disabled = false;
      setResidentModalMode(EDITING_ID != null);
    }
  }
}
