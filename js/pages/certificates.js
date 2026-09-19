// js/pages/certificates.js
// Certificate Processing — live request queue from the API (/api/certificates
// → PostgreSQL certificate table), replacing the old hardcoded demo rows.
// Actions: Approve / Reject (pending), Undo (approved/rejected → pending),
// Message the requester (lands in their notification bell, in-app + push).
window.CURRENT_PAGE = "certificates";

// In-memory copy of what the API returned (same pattern as residency.js).
let CERT_REQUESTS = [];

// CERT_TYPE_LABELS (slug → display name) comes from js/certificate-types.js,
// which loads the barangay's certificate definitions — the list this page, the
// request picker and the printable forms all share. Those definitions are
// edited on this page's second tab (js/certificate-forms.js).

const CERT_STATUS_BADGES = {
  pending: "badge-warning",
  approved: "badge-info",
  issued: "badge-success",
  rejected: "badge-danger",
};

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function certFmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt)
    ? String(d)
    : dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

function renderPage() {
  renderCertificatesPage();
}

// Options for the certificate-type filter, built from the shared list in
// js/certificate-types.js so a new certificate shows up here on its own —
// hidden ones included, since their old requests are still in the queue. The
// short names keep the closed pill readable — .gis-filter-select caps at 240px.
function certTypeFilterOptions() {
  return (window.CERT_TYPE_ALL || [])
    .map(
      (t) =>
        `<option value="${escapeHtml(t.slug)}">${escapeHtml(t.short || t.label)}</option>`
    )
    .join("");
}

function renderCertificatesPage() {
  setContent(`
    <div class="page-header">
      <h2 class="page-title">Certificate Processing</h2>
      <p class="page-desc">Manage, approve, and issue barangay certificates</p>
    </div>
    <!-- Two jobs on one page: working the queue, and keeping the certificates
         themselves (names, requirements, the printed wording) up to date. -->
    <div class="sc-tabs cert-page-tabs" role="tablist" aria-label="Certificate Processing sections">
      <button type="button" class="sc-tab is-active" id="cert-tab-requests" role="tab" aria-selected="true" onclick="certShowTab('requests')">
        <i data-icon=inbox></i><span>Requests</span>
      </button>
      <button type="button" class="sc-tab" id="cert-tab-forms" role="tab" aria-selected="false" onclick="certShowTab('forms')">
        <i data-icon=pencil></i><span>Certificate Forms</span>
      </button>
    </div>
    <div id="cert-panel-forms" hidden></div>
    <div id="cert-panel-requests">
    <div class="kpi-grid">
      <div class="kpi-card warning"><div class="kpi-label">Pending Review</div><div class="kpi-value" id="kpi-cert-pending">—</div></div>
      <div class="kpi-card info"><div class="kpi-label">Approved</div><div class="kpi-value" id="kpi-cert-approved">—</div></div>
      <div class="kpi-card success"><div class="kpi-label">Issued</div><div class="kpi-value" id="kpi-cert-issued">—</div></div>
      <div class="kpi-card danger"><div class="kpi-label">Rejected</div><div class="kpi-value" id="kpi-cert-rejected">—</div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">Certificate Requests</div>
        <div class="btn-group">
          <button class="btn btn-sm btn-gold" onclick="openServicePopup('certificates')">⊕ New Request</button>
          <button class="btn btn-sm btn-outline" onclick="loadCertRequests()"><i data-icon=refresh></i> Refresh</button>
        </div>
      </div>
      <!-- Filters use the GIS map's pill row (.gis-filter-row / -search-wrap /
           -select in css/gis.css) so the two pages read as one system. -->
      <div class="gis-filter-row">
        <div class="gis-search-wrap">
          ${typeof gisIcon === "function" ? gisIcon("search", "gis-search-icon") : ""}
          <input type="text" class="gis-search-input" id="cert-search" autocomplete="off"
                 placeholder="Search by applicant or req. no…" oninput="certFilterChanged()"/>
        </div>
        <select class="gis-filter-select" id="cert-status" onchange="certFilterChanged()">
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="issued">Issued</option>
          <option value="rejected">Rejected</option>
        </select>
        <select class="gis-filter-select" id="cert-type" onchange="certFilterChanged()">
          <option value="">All Certificate Types</option>
          ${certTypeFilterOptions()}
        </select>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Req. No.</th><th>Applicant</th><th>Certificate Type</th><th>Date Filed</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody id="cert-tbody">
            <tr><td colspan="6" class="table-muted" style="text-align:center;padding:24px">Loading requests…</td></tr>
          </tbody>
        </table>
      </div>
      <div id="cert-pagination"></div>
    </div>
    </div>

    <!-- "View" opens the Certificate Request modal from certificate-export.js:
         the request's details, the fill-in blanks and a live preview of the
         sheet, all in one place. Nothing to declare here. -->

    <!-- Reject modal — the reason goes on the record and into the requester's
         notification, so it is asked for rather than optional. -->
    <div class="modal-backdrop" id="modal-cert-reject" onclick="closeCertReject(event)">
      <div class="modal-box">
        <div class="modal-header">
          <div class="modal-title"><div class="modal-title-icon"><i data-icon=x></i></div> <span id="cert-reject-title">Reject Request</span></div>
          <button class="modal-close" onclick="closeCertReject()"><i data-icon=x></i></button>
        </div>
        <div class="modal-body">
          <p class="modal-help-text">The applicant is told their request was turned down, and the remarks below are sent with it so they know what to fix. This is recorded in the Audit Log under your name and can be undone from the same row.</p>
          <div class="form-group">
            <label class="form-label">Reason for rejection</label>
            <textarea class="form-control" id="cert-reject-remarks" rows="4" placeholder="e.g. The barangay ID presented has expired — please bring a valid ID and re-file."></textarea>
          </div>
          <div id="cert-reject-error" style="color:#b91c1c;font-size:13px;min-height:16px"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" onclick="closeCertReject()">Cancel</button>
          <button class="btn btn-primary" id="cert-reject-confirm" style="background:#b91c1c;border-color:#b91c1c" onclick="confirmCertReject()"><i data-icon=x></i> Reject request</button>
        </div>
      </div>
    </div>

    <!-- Message Requester modal -->
    <div class="modal-backdrop" id="modal-cert-message" onclick="closeCertMessage(event)">
      <div class="modal-box">
        <div class="modal-header">
          <div class="modal-title"><div class="modal-title-icon"><i data-icon=mail></i></div> <span id="cert-message-title">Message Requester</span></div>
          <button class="modal-close" onclick="closeCertMessage()"><i data-icon=x></i></button>
        </div>
        <div class="modal-body">
          <p class="modal-help-text">The message is delivered to the requester's C.A.R.E.S. account — it shows up in their notifications (and as a push on their phone).</p>
          <div class="form-group">
            <label class="form-label">Message</label>
            <textarea class="form-control" id="cert-message-text" rows="4" placeholder="e.g. Please bring a valid ID when picking up your certificate."></textarea>
          </div>
          <div id="cert-message-error" style="color:#b91c1c;font-size:13px;min-height:16px"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" onclick="closeCertMessage()">Cancel</button>
          <button class="btn btn-primary" id="cert-message-send" onclick="sendCertMessage()"><i data-icon=mail></i> Send</button>
        </div>
      </div>
    </div>
  `);
  loadCertRequests();
  // #forms reopens the forms tab — a reload mid-edit lands back where it was.
  if (location.hash === "#forms") certShowTab("forms");
}

// ── Tabs ───────────────────────────────────────────────────────────────────
function certShowTab(tab) {
  const forms = tab === "forms";
  const set = (id, on) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("is-active", on);
    el.setAttribute("aria-selected", on ? "true" : "false");
  };
  set("cert-tab-requests", !forms);
  set("cert-tab-forms", forms);
  const reqPanel = document.getElementById("cert-panel-requests");
  const formPanel = document.getElementById("cert-panel-forms");
  if (reqPanel) reqPanel.hidden = forms;
  if (formPanel) formPanel.hidden = !forms;
  history.replaceState(null, "", forms ? "#forms" : location.pathname + location.search);
  if (forms && formPanel && typeof CertForms !== "undefined") CertForms.mount(formPanel);
}

// A certificate renamed, added or hidden on the forms tab shows up in the
// filter and the queue's labels straight away.
document.addEventListener("cert-types-loaded", () => {
  const sel = document.getElementById("cert-type");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">All Certificate Types</option>${certTypeFilterOptions()}`;
  sel.value = current;
  if (CERT_REQUESTS.length) filterCertRequests();
});

async function loadCertRequests() {
  const tbody = document.getElementById("cert-tbody");
  if (tbody)
    tbody.innerHTML = `<tr><td colspan="6" class="table-muted" style="text-align:center;padding:24px">Loading requests…</td></tr>`;
  try {
    // The rows are labelled and filtered by certificate name, and whether
    // Export is offered depends on the type having a printable form.
    const [rows] = await Promise.all([
      apiGet("/api/certificates"),
      window.certTypesReady || Promise.resolve(),
    ]);
    CERT_REQUESTS = rows;
    updateCertKpis();
    filterCertRequests();
  } catch (err) {
    if (tbody)
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:#b91c1c">
        Could not reach the server (${escapeHtml(err.message)}).
        <button class="btn btn-sm btn-outline" onclick="loadCertRequests()" style="margin-left:8px">Retry</button>
      </td></tr>`;
  }
}

function updateCertKpis() {
  const count = (s) => CERT_REQUESTS.filter((r) => r.status === s).length;
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set("kpi-cert-pending", count("pending"));
  set("kpi-cert-approved", count("approved"));
  set("kpi-cert-issued", count("issued"));
  set("kpi-cert-rejected", count("rejected"));
}

// Narrowing the list restarts it at page one.
function certFilterChanged() {
  resetPage("certificates");
  filterCertRequests();
}

function filterCertRequests() {
  const q = (document.getElementById("cert-search")?.value || "").toLowerCase();
  const status = document.getElementById("cert-status")?.value || "";
  const type = document.getElementById("cert-type")?.value || "";
  const list = CERT_REQUESTS.filter((r) => {
    const matchQ =
      !q ||
      (r.applicant_name || "").toLowerCase().includes(q) ||
      (r.request_no || "").toLowerCase().includes(q);
    return matchQ && (!status || r.status === status) && (!type || r.type === type);
  });
  renderCertRows(list);
}

function renderCertRows(list) {
  const tbody = document.getElementById("cert-tbody");
  if (!tbody) return;
  const pager = document.getElementById("cert-pagination");
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-muted" style="text-align:center;padding:24px">No requests match. Requests filed from the app or web portal appear here.</td></tr>`;
    if (pager) pager.innerHTML = "";
    return;
  }
  const page = paginate("certificates", list, filterCertRequests);
  if (pager) {
    pager.innerHTML = page.html;
    if (typeof hydrateIcons === "function") hydrateIcons(pager);
  }
  tbody.innerHTML = page.items
    .map((r) => {
      const badge = CERT_STATUS_BADGES[r.status] || "badge-gray";
      // Two clusters. The left one is the review workflow and changes with the
      // status. The right one is fixed — Message, Delete, Export, with Export at
      // the far edge — and a slot a row doesn't have is held by an invisible
      // stand-in, so those three line up down the column and stay put when a
      // request moves from one status to the next.
      const actions = [
        `<button class="btn btn-sm btn-outline" onclick="openViewCert(${r.id})">View/Edit</button>`,
      ];
      if (r.status === "pending") {
        actions.push(
          `<button class="btn btn-sm btn-gold" onclick="setCertStatus(${r.id}, 'approved')">Approve</button>`,
          `<button class="btn btn-sm btn-outline" style="color:#b91c1c;border-color:#b91c1c" onclick="openCertReject(${r.id})">Reject</button>`
        );
      } else if (r.status === "approved") {
        actions.push(
          `<button class="btn btn-sm btn-gold" onclick="setCertStatus(${r.id}, 'issued')">Issue</button>`,
          `<button class="btn btn-sm btn-outline" onclick="setCertStatus(${r.id}, 'pending')">Undo</button>`
        );
      } else if (r.status === "rejected") {
        actions.push(
          `<button class="btn btn-sm btn-outline" onclick="setCertStatus(${r.id}, 'pending')">Undo</button>`
        );
      }
      // Export goes straight to the print dialog with whatever is on file — no
      // modal in the way. Use View to check or change it first. Only offered
      // once a request is past review; a pending one has nothing to hand out.
      const canExport =
        (r.status === "approved" || r.status === "issued") &&
        typeof certHasTemplate === "function" &&
        certHasTemplate(r.type);
      // Delete needs no stand-in: it depends on the role, not the row, so it is
      // either on every row or on none.
      const fixed = [
        certSlotButton(!!r.resident_id, `openCertMessage(${r.id})`, "Message"),
        deleteButtonHtml(`deleteCertRequest(${r.id})`, ""),
        certSlotButton(
          canExport,
          `exportCertificate(${r.id})`,
          "<i data-icon=download></i>",
          'title="Export — print or save as PDF" aria-label="Export"'
        ),
      ];
      return `<tr>
        <td class="table-mono">${escapeHtml(r.request_no)}</td>
        <td class="table-name">${escapeHtml(r.applicant_name)}</td>
        <td class="table-text-sm">${escapeHtml(CERT_TYPE_LABELS[r.type] || r.type)}</td>
        <td class="table-muted">${certFmtDate(r.created_at)}</td>
        <td><span class="badge ${badge}">${escapeHtml(r.status.charAt(0).toUpperCase() + r.status.slice(1))}</span></td>
        <td>
          <div class="cert-actions">
            <div class="btn-group">${actions.join("")}</div>
            <div class="btn-group cert-actions-fixed">${fixed.join("")}</div>
          </div>
        </td>
      </tr>`;
    })
    .join("");
  if (typeof hydrateIcons === "function") hydrateIcons(tbody);
}

// A button that keeps its place in the row whether or not it applies. When it
// doesn't, the same button is drawn invisible and inert — identical markup, so
// an identical width, and the buttons beside it don't shift.
function certSlotButton(show, handler, inner, attrs) {
  const extra = attrs ? " " + attrs : "";
  return show
    ? `<button class="btn btn-sm btn-outline" onclick="${handler}"${extra}>${inner}</button>`
    : `<button class="btn btn-sm btn-outline cert-action-placeholder" disabled tabindex="-1" aria-hidden="true">${inner}</button>`;
}

// ── status changes (approve / reject / issue / undo) ──────────────────────
// `remarks` is only passed by the reject flow — the API leaves the column alone
// when it is null, so an Undo doesn't wipe the reason a rejection was recorded.
async function setCertStatus(id, status, remarks) {
  const r = CERT_REQUESTS.find((x) => x.id === id);
  if (!r) return;
  const verb =
    status === "pending" ? "move back to pending" : status;
  // Rejecting asks for a reason in its own modal (openCertReject), so by the
  // time it reaches here it is already confirmed. Approve and Issue move a
  // request forward and are undoable from the row; Undo needs a second look.
  if (status === "pending") {
    const ok = await uiConfirm({
      tone: "accent",
      icon: "refresh",
      title: "Move this back to pending?",
      message: `It returns to the review queue from "${r.status}".`,
      target: {
        icon: "file-text",
        label: `${r.request_no} — ${r.applicant_name}`,
      },
      notes: [
        {
          icon: "info",
          text: "Any approval or issuance already recorded on it is set aside.",
        },
        {
          icon: "clipboard",
          text: "The change is recorded in the Audit Log under your name.",
        },
      ],
      confirmLabel: "Undo",
      confirmIcon: "refresh",
    });
    if (!ok) return;
  }
  const session = typeof getSession === "function" ? getSession() : null;
  try {
    await apiPatch(`/api/certificates/${id}`, {
      status: status,
      remarks: remarks || null,
      account_id: session?.account_id || null,
    });
  } catch (err) {
    showToast(`Could not ${verb} the request: ${err.message}`, "<i data-icon=triangle-alert></i>");
    return;
  }
  if (remarks) r.remarks = remarks;
  r.status = status;
  updateCertKpis();
  filterCertRequests();
  // The sidebar pill counts pending requests — this just changed one.
  if (typeof refreshNavBadges === "function") refreshNavBadges();
  const actions = {
    approved: "CERT_APPROVE",
    rejected: "CERT_REJECT",
    issued: "CERT_ISSUE",
    pending: "CERT_UNDO",
  };
  if (typeof logAudit === "function")
    logAudit(
      actions[status] || "CERT_UPDATE",
      `${CERT_TYPE_LABELS[r.type] || r.type} (${r.request_no}) → ${status} for ${r.applicant_name}`,
      "info",
      "certificate"
    );
  showToast(
    status === "pending"
      ? `${r.request_no} moved back to pending`
      : `${r.request_no} ${status}!`
  );
}

// ── Delete (archive) ───────────────────────────────────────────────────────
// DELETE /api/certificates/:id snapshots the request into the shared Archive
// and lifts the row out of the queue; the Archive page can put it back.
// deleteRecord() in shell.js handles permission, confirmation and the audit
// entry — the server writes its own ARCHIVE entry on top.
async function deleteCertRequest(id) {
  const r = CERT_REQUESTS.find((x) => x.id === id);
  if (!r) return;
  await deleteRecord({
    label: `${r.request_no} — ${r.applicant_name}`,
    what: "certificate request",
    icon: "file-text",
    action: "CERT_DELETE",
    category: "certificate",
    details: `Certificate request ${r.request_no} (${CERT_TYPE_LABELS[r.type] || r.type}) for ${r.applicant_name} deleted and moved to the Archive`,
    request: () => apiDelete(`/api/certificates/${id}?account_id=${actingAccountId()}`),
    onDone: () => {
      CERT_REQUESTS = CERT_REQUESTS.filter((x) => x.id !== id);
      updateCertKpis();
      filterCertRequests();
      if (typeof refreshNavBadges === "function") refreshNavBadges();
    },
  });
}

// ── View: the Certificate Request modal ────────────────────────────────────
// One modal for both jobs — the request's details and the printable form with
// its blanks. certOpenSheet() lives in js/certificate-export.js.
function openViewCert(id) {
  const r = CERT_REQUESTS.find((x) => x.id === id);
  if (!r) return;
  certOpenSheet(r, { mode: "staff" });
}

// Export: no modal, straight to the print dialog with what is on file.
function exportCertificate(id) {
  const r = CERT_REQUESTS.find((x) => x.id === id);
  if (r) certPrintRequest(r);
}

// ── Reject with a reason ───────────────────────────────────────────────────
// The reason is required: it is written to certificate.remarks and sent to the
// requester with the rejection notice, so "rejected" alone is never all they
// get.
let CERT_REJECT_TARGET = null;

function openCertReject(id) {
  const r = CERT_REQUESTS.find((x) => x.id === id);
  if (!r) return;
  CERT_REJECT_TARGET = r;
  const title = document.getElementById("cert-reject-title");
  if (title) title.textContent = `Reject ${r.request_no} — ${r.applicant_name}`;
  const text = document.getElementById("cert-reject-remarks");
  if (text) text.value = "";
  const err = document.getElementById("cert-reject-error");
  if (err) err.textContent = "";
  document.getElementById("modal-cert-reject")?.classList.add("open");
  document.getElementById("cert-reject-remarks")?.focus();
}

function closeCertReject(e) {
  if (e && e.target !== document.getElementById("modal-cert-reject")) return;
  document.getElementById("modal-cert-reject")?.classList.remove("open");
}

async function confirmCertReject() {
  const r = CERT_REJECT_TARGET;
  const remarks = (document.getElementById("cert-reject-remarks")?.value || "").trim();
  const errEl = document.getElementById("cert-reject-error");
  const btn = document.getElementById("cert-reject-confirm");
  if (!r) return;
  if (!remarks) {
    if (errEl) errEl.textContent = "Please give a reason — the applicant is shown it.";
    return;
  }
  if (btn) btn.disabled = true;
  await setCertStatus(r.id, "rejected", remarks);
  if (btn) btn.disabled = false;
  closeCertReject();
}

// ── Message the requester ──────────────────────────────────────────────────
let CERT_MESSAGE_TARGET = null;

function openCertMessage(id) {
  const r = CERT_REQUESTS.find((x) => x.id === id);
  if (!r) return;
  CERT_MESSAGE_TARGET = r;
  const title = document.getElementById("cert-message-title");
  if (title) title.textContent = `Message ${r.applicant_name.split(",")[0]} · ${r.request_no}`;
  const text = document.getElementById("cert-message-text");
  if (text) text.value = "";
  const err = document.getElementById("cert-message-error");
  if (err) err.textContent = "";
  document.getElementById("modal-cert-message")?.classList.add("open");
}

function closeCertMessage(e) {
  if (e && e.target !== document.getElementById("modal-cert-message")) return;
  document.getElementById("modal-cert-message")?.classList.remove("open");
}

async function sendCertMessage() {
  const r = CERT_MESSAGE_TARGET;
  const text = (document.getElementById("cert-message-text")?.value || "").trim();
  const errEl = document.getElementById("cert-message-error");
  const btn = document.getElementById("cert-message-send");
  if (!r) return;
  if (!text) {
    if (errEl) errEl.textContent = "Please write a message first.";
    return;
  }
  if (btn) btn.disabled = true;
  try {
    await apiPost("/api/notifications", {
      resident_id: r.resident_id,
      title: "Message from the Barangay Office",
      body: text,
      kind: "message",
      ref: r.request_no,
    });
  } catch (err) {
    if (errEl) errEl.textContent = "Could not send: " + err.message;
    if (btn) btn.disabled = false;
    return;
  }
  if (btn) btn.disabled = false;
  closeCertMessage();
  if (typeof logAudit === "function")
    logAudit(
      "CERT_MESSAGE",
      `Message sent to ${r.applicant_name} re ${r.request_no}`,
      "info",
      "certificate"
    );
  showToast(`Message sent to ${r.applicant_name.split(",")[0]}`, "<i data-icon=mail></i>");
}
