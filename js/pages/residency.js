// js/pages/residency.js
// Barangay Residency — two sub-pages behind one tab bar:
//
//   Resident Directory — the resident database (/api/residents → PostgreSQL).
//                        Fetched once on load, filtered client-side. Includes
//                        the Add / Edit / Delete write paths.
//   Edit Requests      — the approval queue for changes residents propose to
//                        their OWN record from Settings → My Account
//                        (js/account-edit.js). A resident cannot rewrite their
//                        name or birthdate directly, so those edits arrive here
//                        as pending requests carrying the resident's stated
//                        reason; approving one applies it to the resident row
//                        (PATCH /api/edit-requests/:id does it in a
//                        transaction), rejecting one requires remarks that are
//                        sent back to them as a notification.
//
// The two live on one page because they are the same subject matter — a
// reviewer approving a surname change usually wants the directory next to it.
window.CURRENT_PAGE = "residency";

// In-memory copy of what the API returned, so filtering doesn't re-hit the DB.
let RESIDENTS = [];
// Households (= buildings tagged as one on the GIS map) and puroks, cached for
// the Add-Resident dropdowns and loaded lazily on first open.
let HOUSEHOLD_OPTIONS = null;
let PUROK_OPTIONS = null;
// null = the modal is adding a new resident; a number = editing that resident.
let EDITING_ID = null;
// Whether the resident being edited has a claimed login account — decides
// whether the "Deceased" note warns about an account being suspended or not.
let EDITING_CLAIMED = false;
// Which sub-page is showing: "directory" | "requests".
let RESIDENCY_TAB = "directory";
// Profile-change requests from /api/edit-requests (all statuses).
let EDIT_REQUESTS = [];
// The request the reject modal is asking for remarks about.
let REJECT_TARGET = null;

// classification code (DB) → human label (UI badge)
const RESIDENT_CAT_LABELS = {
  senior: "Senior Citizen",
  pwd: "PWD",
  "solo-parent": "Solo Parent",
  indigent: "Indigent Family",
};

// Resident columns an edit request may touch → how they read in the review
// list. Mirrors EDITABLE in the server's routes/edit-requests.js and FIELDS in
// js/account-edit.js.
const EDIT_FIELD_LABELS = {
  last_name: "Last Name",
  first_name: "First Name",
  middle_name: "Middle Name",
  suffix: "Suffix",
  birthdate: "Birthdate",
  sex: "Sex",
  civil_status: "Civil Status",
  contact_no: "Contact No.",
  occupation: "Occupation",
  voter_status: "Voter Status",
  photo: "Profile Photo",
  building_id: "Household",
};

const EDIT_STATUS_BADGES = {
  pending: "badge-warning",
  approved: "badge-success",
  rejected: "badge-danger",
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
    <!-- Two sub-pages. The tab bar (.tab-bar / .tab / .tab-content in
         css/system.css) switches between them client-side; both are rendered
         up front so switching costs no fetch. The pending count rides on the
         Edit Requests tab because that queue is the one thing on this page
         that can sit unattended. -->
    <div class="tab-bar" role="tablist">
      <button type="button" class="tab" role="tab" data-residency-tab="directory"
              onclick="setResidencyTab('directory')">Resident Directory</button>
      <button type="button" class="tab" role="tab" data-residency-tab="requests"
              onclick="setResidencyTab('requests')">Edit Requests <span class="tab-count" id="er-tab-count"></span></button>
    </div>

    <div class="tab-content" data-residency-panel="directory">
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
          <button class="btn btn-sm btn-outline" onclick="loadResidents()"><i data-icon=refresh></i> Refresh</button>
        </div>
      </div>
      <!-- Filters use the GIS map's pill row (.gis-filter-row / -search-wrap /
           -select in css/gis.css) so the two pages read as one system.
           The old "Open Search" button opened a second, popup copy of this
           same directory; the two columns it could narrow by — Category and
           Status — are filters on the real table instead, so there is one
           list to search and it is the one already on screen. -->
      <div class="gis-filter-row">
        <div class="gis-search-wrap">
          ${typeof gisIcon === "function" ? gisIcon("search", "gis-search-icon") : ""}
          <input type="text" class="gis-search-input" id="res-search" autocomplete="off"
                 placeholder="Search by name…" oninput="residentFilterChanged()"/>
        </div>
        <select class="gis-filter-select" id="res-purok" onchange="residentFilterChanged()">
          <option>All Puroks</option><option>Purok 1</option><option>Purok 2</option><option>Purok 3</option><option>Purok 4</option><option>Purok 5</option><option>Purok 6</option><option>Purok 7</option><option>Purok 8</option>
        </select>
        <select class="gis-filter-select" id="res-cat" onchange="residentFilterChanged()">
          <option value="">All Categories</option>
          ${Object.entries(RESIDENT_CAT_LABELS)
            .map(([code, label]) => `<option value="${code}">${label}</option>`)
            .join("")}
        </select>
        <select class="gis-filter-select" id="res-status" onchange="residentFilterChanged()">
          <option value="">All Statuses</option>
          <option value="claimed">Active (claimed)</option>
          <option value="unclaimed">Unclaimed</option>
          <option value="deceased">Deceased</option>
          <option value="moved">Moved out</option>
        </select>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th class="res-photo-col"><span class="sr-only">Photo</span></th><th>Name</th><th>Age</th><th>Purok</th><th>Category</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody id="resident-tbody">
            <tr><td colspan="7" class="table-muted" style="text-align:center;padding:24px">Loading residents…</td></tr>
          </tbody>
        </table>
      </div>
      <div id="resident-pagination"></div>
    </div>
    </div><!-- /directory panel -->

    <div class="tab-content" data-residency-panel="requests">
      <div class="kpi-grid">
        <div class="kpi-card warning"><div class="kpi-label">Awaiting Review</div><div class="kpi-value" id="kpi-er-pending">—</div><div class="kpi-trend">Filed from Settings → My Account</div></div>
        <div class="kpi-card success"><div class="kpi-label">Approved</div><div class="kpi-value" id="kpi-er-approved">—</div></div>
        <div class="kpi-card danger"><div class="kpi-label">Rejected</div><div class="kpi-value" id="kpi-er-rejected">—</div></div>
        <div class="kpi-card"><div class="kpi-label">Total Requests</div><div class="kpi-value" id="kpi-er-total">—</div></div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title">Profile Change Requests</div>
          <div class="btn-group">
            <button class="btn btn-sm btn-outline" onclick="loadEditRequests()"><i data-icon=refresh></i> Refresh</button>
          </div>
        </div>
        <p class="modal-help-text">Changes residents proposed to their own record. Approving applies them.</p>
        <div class="gis-filter-row">
          <div class="gis-search-wrap">
            ${typeof gisIcon === "function" ? gisIcon("search", "gis-search-icon") : ""}
            <input type="text" class="gis-search-input" id="er-search" autocomplete="off"
                   placeholder="Search by resident, field, or reason…" oninput="editRequestFilterChanged()"/>
          </div>
          <select class="gis-filter-select" id="er-status" onchange="editRequestFilterChanged()">
            <option value="pending">Awaiting Review</option>
            <option value="">All Statuses</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div id="er-list"><div class="resident-summary">Loading requests…</div></div>
        <div id="er-pagination"></div>
      </div>
    </div><!-- /requests panel -->

    <!-- Reject modal — the remarks go on the record and are sent to the
         requester with the decision, so they are asked for rather than
         optional. Same shape as the certificate rejection flow. -->
    <div class="modal-backdrop" id="modal-er-reject" onclick="closeEditRequestReject(event)">
      <div class="modal-box">
        <div class="modal-header">
          <div class="modal-title"><div class="modal-title-icon"><i data-icon=x></i></div> <span id="er-reject-title">Reject Change Request</span></div>
          <button class="modal-close" onclick="closeEditRequestReject()"><i data-icon=x></i></button>
        </div>
        <div class="modal-body">
          <p class="modal-help-text">The remarks below are sent to the resident with the decision.</p>
          <div class="form-group">
            <label class="form-label">Reason for rejection</label>
            <textarea class="form-control" id="er-reject-remarks" rows="4"
              placeholder="e.g. Please bring your marriage certificate to the barangay hall so the surname change can be verified."></textarea>
          </div>
          <div id="er-reject-error" style="color:#b91c1c;font-size:13px;min-height:16px"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" onclick="closeEditRequestReject()">Cancel</button>
          <button class="btn btn-primary" id="er-reject-confirm" style="background:#b91c1c;border-color:#b91c1c" onclick="confirmEditRequestReject()"><i data-icon=x></i> Reject request</button>
        </div>
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
          <!-- Where the resident lives. Purok and Address sit on the resident
               record itself: they are known for everyone, whereas the
               household below exists only once someone has tagged the house on
               the GIS map. -->
          <div class="form-row form-row-tight">
            <div class="form-group form-group-flat">
              <label class="form-label">Purok</label>
              <select class="form-control" id="add-purok"><option value="">—</option></select>
            </div>
            <div class="form-group form-group-flat">
              <label class="form-label">Address</label>
              <input class="form-control" id="add-address" placeholder="e.g. 49 Sitio Gitna"/>
            </div>
          </div>
          <div class="form-group form-group-flat">
            <label class="form-label">Household</label>
            <select class="form-control" id="add-household"><option value="">— None —</option></select>
            <p class="modal-help-text" style="margin-top:6px">
              A household is a building tagged as one on the
              <a href="gis.html">GIS map</a>. Tag the resident's house there and
              it appears in this list.
            </p>
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
          <!-- Record classification. Editing only: a resident being added is
               alive and living here by definition, and offering "Deceased" on
               a blank form is an invitation to a mis-click on a record nobody
               has checked yet. -->
          <div class="form-group form-group-flat" id="edit-status-group" style="display:none">
            <label class="form-label">Record Classification</label>
            <select class="form-control" id="add-status" onchange="residentStatusChanged()">
              <option value="active">Active resident</option>
              <option value="deceased">Deceased</option>
              <option value="moved">Moved out of the barangay</option>
            </select>
            <p class="modal-help-text" id="status-note" style="margin-top:6px"></p>
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
  applyResidencyTab();
  loadResidents();
  loadEditRequests();
}

// ─────────────────────────────── Sub-page tabs ───────────────────────────────
function setResidencyTab(tab) {
  RESIDENCY_TAB = tab === "requests" ? "requests" : "directory";
  applyResidencyTab();
}

function applyResidencyTab() {
  document.querySelectorAll("[data-residency-tab]").forEach((btn) => {
    const on = btn.getAttribute("data-residency-tab") === RESIDENCY_TAB;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll("[data-residency-panel]").forEach((panel) => {
    panel.classList.toggle(
      "active",
      panel.getAttribute("data-residency-panel") === RESIDENCY_TAB
    );
  });
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

// Any filter change starts the results over at page one — narrowing the list
// while parked on page 9 would otherwise land on an empty view.
function residentFilterChanged() {
  resetPage("residency");
  filterResidentsPage();
}

// Apply the search box + purok / category / status dropdowns to the in-memory
// list and re-render. Also the repaint callback the pager calls back into.
// NOTE: named *Page to avoid colliding with shell.js's modal filterResidents().
function filterResidentsPage() {
  const q = (document.getElementById("res-search")?.value || "").toLowerCase();
  const purok = document.getElementById("res-purok")?.value || "All Puroks";
  const cat = document.getElementById("res-cat")?.value || "";
  const status = document.getElementById("res-status")?.value || "";
  const list = RESIDENTS.filter((r) => {
    const matchName = !q || (r.name || "").toLowerCase().includes(q);
    const matchPurok = purok === "All Puroks" || r.purok === purok;
    // A resident can hold several classifications, so the filter asks whether
    // the chosen one is among them rather than comparing a single value.
    const cats = r.cats && r.cats.length ? r.cats : r.cat ? [r.cat] : [];
    const matchCat = !cat || cats.includes(cat);
    // Same rule the Status column paints by: a record classified deceased or
    // moved is that first, and claimed/unclaimed only for living residents.
    const matchStatus =
      !status ||
      (status === "deceased" || status === "moved"
        ? r.lifecycle === status
        : r.lifecycle !== "deceased" &&
          r.lifecycle !== "moved" &&
          (status === "claimed" ? r.claimed === true : r.claimed !== true));
    return matchName && matchPurok && matchCat && matchStatus;
  });
  renderResidentRows(list);
}

// Initials from a "Last, First M." directory name — first name's initial then
// the surname's, so "Santos, Pedro J." reads as PS the way a person would
// write it, not SP the way the string happens to be ordered.
function residentInitials(name) {
  const parts = String(name || "").split(",");
  const last = (parts[0] || "").trim();
  const first = (parts[1] || "").trim();
  return ((first[0] || "") + (last[0] || "")).toUpperCase() || "?";
}

// The Photo column. Residents who have uploaded one (from the mobile app, or
// through an approved profile change request) get the picture; everyone else
// gets their initials, so the column is never a row of empty boxes and always
// gives the eye something to track along the row.
//
// onerror falls back to the initials rather than leaving a broken-image icon:
// photos are stored as data URIs, and a truncated one would otherwise sit in
// the table looking like a bug.
function residentAvatarHtml(photo, name) {
  const initials = escapeHtml(residentInitials(name));
  if (!photo) return `<span class="resident-avatar-sm">${initials}</span>`;
  return `<img class="resident-avatar-img" src="${escapeHtml(photo)}" alt="" loading="lazy"
     data-initials="${initials}" onerror="residentAvatarFallback(this)" />`;
}

function residentAvatarFallback(img) {
  const span = document.createElement("span");
  span.className = "resident-avatar-sm";
  span.textContent = img.getAttribute("data-initials") || "?";
  img.replaceWith(span);
}

function renderResidentRows(list) {
  const tbody = document.getElementById("resident-tbody");
  if (!tbody) return;
  const pager = document.getElementById("resident-pagination");
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-muted" style="text-align:center;padding:24px">No residents match.</td></tr>`;
    if (pager) pager.innerHTML = "";
    return;
  }
  const page = paginate("residency", list, filterResidentsPage);
  if (pager) {
    pager.innerHTML = page.html;
    if (typeof hydrateIcons === "function") hydrateIcons(pager);
  }
  tbody.innerHTML = page.items
    .map((r) => {
      const cats = (r.cats && r.cats.length ? r.cats : r.cat ? [r.cat] : [])
        .map(
          (c) =>
            `<span class="badge badge-gold">${escapeHtml(RESIDENT_CAT_LABELS[c] || c)}</span>`
        )
        .join(" ");
      // "Status" column reflects account-claimed: claimed → Active (green),
      // otherwise Unclaimed (gray). An unclaimed resident must never show as
      // Active. The record's own classification wins over both when it is not
      // a living resident of the barangay — a deceased record reading "Active"
      // would be the worst kind of wrong.
      const claimed = r.claimed === true;
      if (r.lifecycle === "deceased" || r.lifecycle === "moved") {
        const dead = r.lifecycle === "deceased";
        return `<tr style="opacity:.72">
          <td class="res-photo-col">${residentAvatarHtml(r.photo, r.name)}</td>
          <td class="table-name">${escapeHtml(r.name)}</td>
          <td>${r.age == null ? '<span class="table-muted">—</span>' : r.age}</td>
          <td>${r.purok ? `<span class="badge badge-gray">${escapeHtml(r.purok)}</span>` : '<span class="table-muted">—</span>'}</td>
          <td>${cats || '<span class="table-muted">—</span>'}</td>
          <td><span class="badge ${dead ? "badge-danger" : "badge-gray"}">${dead ? "Deceased" : "Moved out"}</span></td>
          <td><div class="btn-group">
            <button class="btn btn-sm btn-outline" onclick="openViewResident(${Number(r.id)})">View</button>
            <button class="btn btn-sm btn-gold" onclick="openEditResident(${Number(r.id)})">Edit</button>
            ${deleteButtonHtml(`deleteResident(${Number(r.id)})`, "")}
          </div></td>
        </tr>`;
      }
      return `<tr>
        <td class="res-photo-col">${residentAvatarHtml(r.photo, r.name)}</td>
        <td class="table-name">${escapeHtml(r.name)}</td>
        <td>${r.age == null ? '<span class="table-muted">—</span>' : r.age}</td>
        <td>${r.purok ? `<span class="badge badge-gray">${escapeHtml(r.purok)}</span>` : '<span class="table-muted">—</span>'}</td>
        <td>${cats || '<span class="table-muted">—</span>'}</td>
        <td><span class="badge ${claimed ? "badge-success" : "badge-gray"}">${claimed ? "Active" : "Unclaimed"}</span></td>
        <td><div class="btn-group">
          <button class="btn btn-sm btn-outline" onclick="openViewResident(${Number(r.id)})">View</button>
          <button class="btn btn-sm btn-gold" onclick="openEditResident(${Number(r.id)})">Edit</button>
          ${deleteButtonHtml(`deleteResident(${Number(r.id)})`, "")}
        </div></td>
      </tr>`;
    })
    .join("");
  if (typeof hydrateIcons === "function") hydrateIcons(tbody);
}

// Delete = archive. DELETE /api/residents/:id snapshots the row into the
// shared Archive and flips the resident's status to 'archived', so the record
// (and everything referencing it) survives and an Admin can restore it from
// the Archive page. deleteRecord() in shell.js does the permission check,
// confirmation and audit entry.
async function deleteResident(id) {
  const r = RESIDENTS.find((x) => Number(x.id) === Number(id));
  if (!r) return;
  await deleteRecord({
    label: r.name,
    what: "resident",
    icon: "user",
    action: "RESIDENT_DELETE",
    category: "resident",
    details: `Resident ${r.name} (#${id}) deleted and moved to the Archive`,
    request: () => apiDelete(`/api/residents/${id}?account_id=${actingAccountId()}`),
    onDone: () => {
      RESIDENTS = RESIDENTS.filter((x) => Number(x.id) !== Number(id));
      updateResidentKpis();
      filterResidentsPage();
    },
  });
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
      ${residentAvatarHtml(r.photo, `${r.last_name}, ${r.first_name}`)}
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
    ${row("Address", v(r.address_text))}
    ${/* The household is a building tagged on the GIS map, so it is named
          ("Bahay ni Shane") rather than numbered. Blank means this resident's
          house has not been tagged on the map yet. */ ""}
    ${row("Household", v(r.household_name))}
    ${row("Classifications", cats || dash)}
    ${row("Date Registered", v(fmtDate(r.date_registered)))}
  `;
}

// ──────────────────── Add / Edit Resident (write path) ───────────────────────
// One modal, two modes: EDITING_ID null = add (POST), set = edit (PUT).
function resetResidentForm() {
  [
    "add-last", "add-first", "add-middle", "add-suffix", "add-birthdate",
    "add-contact", "add-occupation", "add-address",
    "add-sex", "add-civil", "add-voter", "add-household", "add-purok",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  document.querySelectorAll(".add-cat").forEach((c) => (c.checked = false));
  const status = document.getElementById("add-status");
  if (status) status.value = "active";
  EDITING_CLAIMED = false;
  residentStatusChanged();
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
  // Record Classification is an edit-only field — see the comment on the
  // markup above.
  const statusGroup = document.getElementById("edit-status-group");
  if (statusGroup) statusGroup.style.display = editing ? "" : "none";
}

// The note under the Record Classification select. "Deceased" is the one value
// with a consequence outside this record — it closes the person's login — so
// the form says so before it is saved, not in a toast afterwards.
function residentStatusChanged() {
  const note = document.getElementById("status-note");
  if (!note) return;
  const value = document.getElementById("add-status")?.value || "active";
  if (value === "deceased") {
    note.innerHTML = EDITING_CLAIMED
      ? "Their account is <strong>suspended</strong> when you save: it can no longer sign in, but nothing is deleted and it stays in User Management. Setting this back to Active lifts the suspension."
      : "This resident has no claimed account, so there is nothing to suspend. The record stays on file and stops counting as an active resident.";
  } else if (value === "moved") {
    note.textContent =
      "Kept on file as a former resident. This does not touch their account.";
  } else {
    note.textContent = EDITING_CLAIMED
      ? "Active. If this record was previously marked deceased, saving lifts the suspension it put on their account."
      : "Active.";
  }
}

async function openAddResident() {
  const modal = document.getElementById("modal-add-resident");
  if (!modal) return;
  EDITING_ID = null;
  resetResidentForm();
  setResidentModalMode(false);
  modal.classList.add("open");
  await Promise.all([populateHouseholdOptions(), populatePurokOptions()]);
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
    // Load both lists first so the selects have their options before we set
    // their values — a value set on an empty select is silently discarded.
    await Promise.all([populateHouseholdOptions(), populatePurokOptions()]);
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
    set("add-household", householdOptionValue(r.building_id));
    set("add-purok", r.purok_id);
    set("add-address", r.address_text);
    // 'archived' residents never reach this modal (they are out of the
    // directory), so anything unexpected is shown as Active rather than
    // silently rewriting the record's state on the next save.
    set("add-status", ["active", "deceased", "moved"].includes(r.status) ? r.status : "active");
    EDITING_CLAIMED = r.account_claimed === true;
    residentStatusChanged();
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

// Fill the Household dropdown from the buildings tagged as households on the
// GIS map — "Bahay ni Shane (3)". There is no household table any more: the
// tag on the map IS the household, so this list is exactly what the map shows.
// An untagged barangay yields an empty list, which is why the field is
// optional and the modal explains where households come from.
//
// A house drawn as several footprints and group-tagged on the map arrives as
// ONE row (the API collapses the group), so it appears once here — the option's
// value is the group's representative building, and every footprint in it is
// listed in member_ids.
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
  const label = (h) => {
    // Every classification the household holds, the way the map draws every one
    // of them — listing only the first would say a senior/solo-parent house is
    // just a senior one.
    const cls = (h.classifications || [])
      .map((k) => HOUSEHOLD_CLASS_LABEL[k] || k)
      .join(" + ");
    return (
      (h.name || "Untagged building #" + h.building_id) +
      (cls ? " — " + cls : "") +
      ` (${h.members || 0})` +
      // Only worth saying when it is more than one, and it explains why the
      // map highlights several buildings for this single entry.
      (h.buildings > 1 ? ` · ${h.buildings} buildings` : "")
    );
  };
  sel.innerHTML =
    `<option value="">— None —</option>` +
    HOUSEHOLD_OPTIONS.map(
      (h) => `<option value="${h.building_id}">${escapeHtml(label(h))}</option>`
    ).join("");
}

// The dropdown value for a resident's stored building_id. Usually the same
// number, but a resident attached to a group-tagged household may sit on any
// footprint of it while the option carries the group's representative — so map
// through member_ids, or the select would fall back to "— None —" and an
// innocent save would detach them.
function householdOptionValue(buildingId) {
  if (buildingId == null || buildingId === "") return "";
  const owner = (HOUSEHOLD_OPTIONS || []).find(
    (h) => h.building_id === buildingId || (h.member_ids || []).includes(buildingId)
  );
  return owner ? owner.building_id : buildingId;
}

// Mirrors GIS_HOUSEHOLD_SUBCAT_META in js/gis-map.js — the classification the
// map tag already carries, shown here so staff can tell two houses of the same
// family name apart.
const HOUSEHOLD_CLASS_LABEL = {
  seniors: "Senior Citizen",
  pwd: "PWD",
  "solo-parent": "Solo Parent",
  indigent: "Indigent Family",
};

// Purok list for the resident form. Small and static, so it is fetched once
// and reused like the household list.
async function populatePurokOptions() {
  const sel = document.getElementById("add-purok");
  if (!sel) return;
  if (PUROK_OPTIONS === null) {
    try {
      PUROK_OPTIONS = await apiGet("/api/puroks");
    } catch (err) {
      PUROK_OPTIONS = [];
    }
  }
  sel.innerHTML =
    `<option value="">—</option>` +
    PUROK_OPTIONS.map(
      (p) => `<option value="${p.purok_id}">${escapeHtml(p.name)}</option>`
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
    contact_no: val("add-contact") || null,
    occupation: val("add-occupation") || null,
    voter_status: val("add-voter") || null,
    // "" rather than null on purpose: the PUT reads "" as "clear this field"
    // and null as "leave it alone", so an emptied Household/Purok/Address on
    // the form actually detaches instead of silently keeping the old value.
    building_id: val("add-household"),
    purok_id: val("add-purok"),
    address_text: val("add-address"),
    classifications,
  };
  // Record Classification only exists in edit mode; a new resident takes the
  // table's 'active' default.
  if (EDITING_ID != null) body.status = val("add-status") || "active";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = "Saving…";
  }
  if (errEl) errEl.textContent = "";
  try {
    let result = null;
    if (EDITING_ID != null) {
      result = await apiPut("/api/residents/" + EDITING_ID, body);
    } else {
      await apiPost("/api/residents", body);
    }
    const verb = EDITING_ID != null ? "updated" : "added";
    closeAddResident();
    // The server reports whether saving this record also closed (or reopened)
    // the resident's login, because that is the part of the save that happened
    // somewhere the person clicking Save was not looking.
    if (typeof showToast === "function")
      showToast(
        result && result.account_suspended
          ? `Resident ${first} ${last} recorded as deceased — their account is suspended`
          : result && result.account_reactivated
            ? `Resident ${first} ${last} updated — their account can sign in again`
            : `Resident ${first} ${last} ${verb}`
      );
    if (typeof logAudit === "function")
      logAudit(
        EDITING_ID != null ? "RESIDENT_EDIT" : "RESIDENT_ADD",
        body.status === "deceased"
          ? `Resident ${last}, ${first} classified as deceased`
          : `Resident ${last}, ${first} ${verb}`,
        body.status === "deceased" ? "warning" : "info",
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

// ══════════════════ EDIT REQUESTS (approval sub-page) ═══════════════════════
// The staff half of the profile-change flow. Residents propose changes to
// their own record from Settings → My Account (js/account-edit.js); nothing on
// the resident row moves until one of these is approved here.
//
// Approving is a real write: PATCH /api/edit-requests/:id with status
// 'approved' applies the request's `changes` to the resident row and stamps
// the request in the same transaction, so a half-applied change is not a state
// the database can be left in. Rejecting requires remarks, which are sent to
// the resident as a notification alongside the decision.

async function loadEditRequests() {
  const list = document.getElementById("er-list");
  if (list) list.innerHTML = `<div class="resident-summary">Loading requests…</div>`;
  try {
    EDIT_REQUESTS = await apiGet("/api/edit-requests");
  } catch (err) {
    if (list)
      list.innerHTML = `<div class="resident-empty">Could not load change requests (${escapeHtml(err.message)}).
        <button class="btn btn-sm btn-outline" onclick="loadEditRequests()" style="margin-left:8px">Retry</button></div>`;
    return;
  }
  updateEditRequestKpis();
  filterEditRequests();
}

function updateEditRequestKpis() {
  const count = (s) => EDIT_REQUESTS.filter((r) => r.status === s).length;
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  const pending = count("pending");
  set("kpi-er-pending", pending);
  set("kpi-er-approved", count("approved"));
  set("kpi-er-rejected", count("rejected"));
  set("kpi-er-total", EDIT_REQUESTS.length);
  // The tab itself carries the pending count — this queue is the one thing on
  // the page that can sit unattended, and the directory tab is the default.
  const tabCount = document.getElementById("er-tab-count");
  if (tabCount) tabCount.textContent = pending ? String(pending) : "";
}

function editRequestFilterChanged() {
  resetPage("edit-requests");
  filterEditRequests();
}

function filterEditRequests() {
  const q = (document.getElementById("er-search")?.value || "").toLowerCase();
  // Defaults to "pending" — this is a work queue, and the processed history is
  // one dropdown away rather than padding out the list you came here to clear.
  const statusEl = document.getElementById("er-status");
  const status = statusEl ? statusEl.value : "pending";
  const list = EDIT_REQUESTS.filter((r) => {
    if (status && r.status !== status) return false;
    if (!q) return true;
    const fields = Object.keys(r.changes || {})
      .map((k) => EDIT_FIELD_LABELS[k] || k)
      .join(" ");
    return `${r.resident_name || ""} ${fields} ${r.reason || ""}`
      .toLowerCase()
      .includes(q);
  });
  renderEditRequests(list);
}

function editRequestDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return isNaN(d)
    ? String(ts)
    : d.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

// A stored value as it should read in the before/after column. Blank means the
// field is being cleared (or was never set) — "—" says that without pretending
// an empty string is a value.
function editRequestValue(key, raw, side, row) {
  // A household reads as its name. "3346 → 4712" is not something anyone can
  // approve; the server resolves both ids for us (see `households`), and says
  // so in the name itself when the household has since stopped being one.
  if (key === "building_id") {
    if (raw == null || raw === "")
      return '<span class="table-muted">No household</span>';
    const name = (row && row.households && row.households[raw]) || null;
    return name
      ? escapeHtml(name)
      : `<span class="table-muted">Building #${escapeHtml(String(raw))} (not found)</span>`;
  }
  if (raw == null || raw === "") return '<span class="table-muted">—</span>';
  let v = String(raw);
  if (key === "sex") v = v === "M" ? "Male" : v === "F" ? "Female" : v;
  if (key === "birthdate") {
    const d = new Date(v);
    if (!isNaN(d))
      v = d.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
  }
  // A photo is a base64 data URI hundreds of kilobytes long — printing it
  // would bury the rest of the diff. Show it as a thumbnail instead, which is
  // the only form in which it can actually be reviewed.
  if (key === "photo")
    return `<img class="er-photo" src="${escapeHtml(v)}" alt="${side === "new" ? "Requested" : "Current"} profile photo" />`;
  return escapeHtml(v);
}

function renderEditRequests(list) {
  const wrap = document.getElementById("er-list");
  const pager = document.getElementById("er-pagination");
  if (!wrap) return;
  if (!list.length) {
    const any = EDIT_REQUESTS.length > 0;
    wrap.innerHTML = `<div class="resident-empty">${
      any
        ? "No change requests match this filter."
        : "No change requests yet. When a resident edits their details from Settings → My Account, the request appears here for approval."
    }</div>`;
    if (pager) pager.innerHTML = "";
    return;
  }

  const page = paginate("edit-requests", list, filterEditRequests);
  wrap.innerHTML = page.items.map(editRequestCardHtml).join("");
  if (pager) pager.innerHTML = page.html;
  if (typeof hydrateIcons === "function") {
    hydrateIcons(wrap);
    if (pager) hydrateIcons(pager);
  }
}

function editRequestCardHtml(r) {
  const changes = r.changes || {};
  const current = r.current || {};
  const rows = Object.keys(changes)
    .map(
      (k) => `
      <tr>
        <td class="er-field">${escapeHtml(EDIT_FIELD_LABELS[k] || k)}</td>
        <td class="er-old">${editRequestValue(k, current[k], "old", r)}</td>
        <td class="er-arrow"><i data-icon=arrow-right></i></td>
        <td class="er-new">${editRequestValue(k, changes[k], "new", r)}</td>
      </tr>`
    )
    .join("");

  const decided =
    r.status === "pending"
      ? ""
      : `<div class="er-decision">
           ${escapeHtml(r.status === "approved" ? "Approved" : "Rejected")}
           ${r.processed_at ? " " + escapeHtml(editRequestDate(r.processed_at)) : ""}
           ${r.processed_by_name ? " by " + escapeHtml(r.processed_by_name) : ""}
           ${r.remarks ? `<div class="er-remarks">Remarks: ${escapeHtml(r.remarks)}</div>` : ""}
         </div>`;

  const actions =
    r.status === "pending"
      ? `<button class="btn btn-sm btn-gold" onclick="approveEditRequest(${Number(r.id)})"><i data-icon=check></i> Approve</button>
         <button class="btn btn-sm btn-outline" style="color:#b91c1c;border-color:#b91c1c" onclick="openEditRequestReject(${Number(r.id)})"><i data-icon=x></i> Reject</button>`
      : `<button class="btn btn-sm btn-outline" onclick="undoEditRequest(${Number(r.id)})"><i data-icon=refresh></i> Move back to pending</button>`;

  return `
    <div class="er-card${r.status === "pending" ? " is-pending" : ""}">
      <div class="er-head">
        <div class="er-who">
          <div class="er-name">${escapeHtml(r.resident_name || "Resident #" + r.resident_id)}</div>
          <div class="er-meta">
            ${r.purok ? escapeHtml(r.purok) + " · " : ""}Filed ${escapeHtml(editRequestDate(r.created_at))}
            ${r.requested_by_email ? " · " + escapeHtml(r.requested_by_email) : ""}
          </div>
        </div>
        <span class="badge ${EDIT_STATUS_BADGES[r.status] || "badge-gray"}">${escapeHtml(
          r.status.charAt(0).toUpperCase() + r.status.slice(1)
        )}</span>
      </div>

      <table class="er-diff">
        <thead><tr><th>Field</th><th>Currently</th><th></th><th>Requested</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="er-reason">
        <span class="er-reason-label">Resident&#39;s reason</span>
        ${
          r.reason
            ? escapeHtml(r.reason)
            : '<span class="table-muted">Not given — this request predates the reason field.</span>'
        }
      </div>
      ${decided}
      <div class="er-actions btn-group">${actions}</div>
    </div>`;
}

// ── Approve ────────────────────────────────────────────────────────────────
// Confirmed rather than one-click: approving writes the new values straight
// onto the resident record, and the only way back is a staff edit by hand.
async function approveEditRequest(id) {
  const r = EDIT_REQUESTS.find((x) => Number(x.id) === Number(id));
  if (!r) return;
  const fields = Object.keys(r.changes || {})
    .map((k) => EDIT_FIELD_LABELS[k] || k)
    .join(", ");
  const ok = await uiConfirm({
    tone: "accent",
    icon: "check",
    title: "Apply these changes to the record?",
    message: `${fields} will be written onto ${r.resident_name || "this resident"}'s barangay record.`,
    target: { icon: "user", label: r.resident_name || "Resident #" + r.resident_id },
    notes: [
      {
        icon: "info",
        text: r.reason
          ? `Their stated reason: "${r.reason}"`
          : "No reason was given with this request.",
      },
      { icon: "bell", text: "The resident is notified that the change was approved." },
      { icon: "clipboard", text: "The change is recorded in the Audit Log under your name." },
    ],
    confirmLabel: "Approve & Apply",
    confirmIcon: "check",
  });
  if (!ok) return;
  await setEditRequestStatus(r, "approved");
}

function openEditRequestReject(id) {
  const r = EDIT_REQUESTS.find((x) => Number(x.id) === Number(id));
  if (!r) return;
  REJECT_TARGET = r;
  const title = document.getElementById("er-reject-title");
  if (title) title.textContent = `Reject — ${r.resident_name || "Resident #" + r.resident_id}`;
  const text = document.getElementById("er-reject-remarks");
  if (text) text.value = "";
  const err = document.getElementById("er-reject-error");
  if (err) err.textContent = "";
  document.getElementById("modal-er-reject")?.classList.add("open");
  document.getElementById("er-reject-remarks")?.focus();
}

function closeEditRequestReject(e) {
  if (e && e.target !== document.getElementById("modal-er-reject")) return;
  document.getElementById("modal-er-reject")?.classList.remove("open");
}

async function confirmEditRequestReject() {
  const r = REJECT_TARGET;
  if (!r) return;
  const remarks = (document.getElementById("er-reject-remarks")?.value || "").trim();
  const errEl = document.getElementById("er-reject-error");
  const btn = document.getElementById("er-reject-confirm");
  if (!remarks) {
    if (errEl) errEl.textContent = "Please give a reason — the resident is shown it.";
    return;
  }
  if (btn) btn.disabled = true;
  const done = await setEditRequestStatus(r, "rejected", remarks);
  if (btn) btn.disabled = false;
  if (done) closeEditRequestReject();
}

// Undo puts a processed request back in the queue. It does NOT revert an
// approval that was already written to the resident row — the server says the
// same — so the confirmation says so plainly rather than implying a rollback.
async function undoEditRequest(id) {
  const r = EDIT_REQUESTS.find((x) => Number(x.id) === Number(id));
  if (!r) return;
  const ok = await uiConfirm({
    tone: "accent",
    icon: "refresh",
    title: "Move this back to pending?",
    message: `It returns to the review queue from "${r.status}".`,
    target: { icon: "user", label: r.resident_name || "Resident #" + r.resident_id },
    notes: [
      {
        icon: "triangle-alert",
        text: "If it was approved, the resident's record already carries the new values — this does not put the old ones back.",
      },
      { icon: "clipboard", text: "The change is recorded in the Audit Log under your name." },
    ],
    confirmLabel: "Undo",
    confirmIcon: "refresh",
  });
  if (!ok) return;
  await setEditRequestStatus(r, "pending");
}

async function setEditRequestStatus(r, status, remarks) {
  const session = typeof getSession === "function" ? getSession() : null;
  try {
    await apiPatch(`/api/edit-requests/${r.id}`, {
      status,
      remarks: remarks || null,
      account_id: session?.account_id || null,
    });
  } catch (err) {
    showToast(`Could not update the request: ${err.message}`, "<i data-icon=triangle-alert></i>");
    return false;
  }

  const fields = Object.keys(r.changes || {})
    .map((k) => EDIT_FIELD_LABELS[k] || k)
    .join(", ");
  if (typeof logAudit === "function")
    logAudit(
      status === "approved"
        ? "PROFILE_EDIT_APPROVE"
        : status === "rejected"
          ? "PROFILE_EDIT_REJECT"
          : "PROFILE_EDIT_UNDO",
      `Change request #${r.id} for ${r.resident_name || "resident #" + r.resident_id} (${fields}) → ${status}` +
        (remarks ? ` — ${remarks}` : ""),
      status === "approved" ? "warning" : "info",
      "resident"
    );
  showToast(
    status === "approved"
      ? "Changes applied to the resident record"
      : status === "rejected"
        ? "Request rejected — the resident has been notified"
        : "Request moved back to pending",
    status === "approved" ? "<i data-icon=check></i>" : "<i data-icon=refresh></i>"
  );

  // An approval rewrites the resident row, so the directory beside it is now
  // stale — reload both rather than only the queue that was clicked.
  await loadEditRequests();
  if (status === "approved") await loadResidents();
  return true;
}
