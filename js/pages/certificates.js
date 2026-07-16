// js/pages/certificates.js
// Certificate Processing — live request queue from the API (/api/certificates
// → PostgreSQL certificate table), replacing the old hardcoded demo rows.
// Actions: Approve / Reject (pending), Undo (approved/rejected → pending),
// Message the requester (lands in their notification bell, in-app + push).
window.CURRENT_PAGE = "certificates";

// In-memory copy of what the API returned (same pattern as residency.js).
let CERT_REQUESTS = [];

const CERT_TYPE_LABELS = {
  "barangay-clearance": "Barangay Clearance",
  indigency: "Certificate of Indigency",
  residency: "Certificate of Residency",
  "business-clearance": "Business Clearance",
  "good-moral": "Certificate of Good Moral",
  "solo-parent": "Certificate of Solo Parent",
};

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

function renderCertificatesPage() {
  setContent(`
    <div class="page-header">
      <h2 class="page-title">Certificate Processing</h2>
      <p class="page-desc">Manage, approve, and issue barangay certificates</p>
    </div>
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
      <div class="filter-row">
        <input class="form-control filter-input" id="cert-search" placeholder="Search by applicant or req. no..." oninput="filterCertRequests()"/>
        <select class="form-control filter-select" id="cert-status" onchange="filterCertRequests()">
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="issued">Issued</option>
          <option value="rejected">Rejected</option>
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
    </div>

    <!-- View Request modal -->
    <div class="modal-backdrop" id="modal-view-cert" onclick="closeViewCert(event)">
      <div class="modal-box">
        <div class="modal-header">
          <div class="modal-title"><div class="modal-title-icon"><i data-icon=file-text></i></div> Certificate Request</div>
          <button class="modal-close" onclick="closeViewCert()"><i data-icon=x></i></button>
        </div>
        <div class="modal-body" id="view-cert-body"></div>
        <div class="modal-footer">
          <button class="btn btn-outline" onclick="closeViewCert()">Close</button>
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
}

async function loadCertRequests() {
  const tbody = document.getElementById("cert-tbody");
  if (tbody)
    tbody.innerHTML = `<tr><td colspan="6" class="table-muted" style="text-align:center;padding:24px">Loading requests…</td></tr>`;
  try {
    CERT_REQUESTS = await apiGet("/api/certificates");
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

function filterCertRequests() {
  const q = (document.getElementById("cert-search")?.value || "").toLowerCase();
  const status = document.getElementById("cert-status")?.value || "";
  const list = CERT_REQUESTS.filter((r) => {
    const matchQ =
      !q ||
      (r.applicant_name || "").toLowerCase().includes(q) ||
      (r.request_no || "").toLowerCase().includes(q);
    return matchQ && (!status || r.status === status);
  });
  renderCertRows(list);
}

function renderCertRows(list) {
  const tbody = document.getElementById("cert-tbody");
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-muted" style="text-align:center;padding:24px">No requests match. Requests filed from the app or web portal appear here.</td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((r) => {
      const badge = CERT_STATUS_BADGES[r.status] || "badge-gray";
      const actions = [
        `<button class="btn btn-sm btn-outline" onclick="openViewCert(${r.id})">View</button>`,
      ];
      if (r.status === "pending") {
        actions.push(
          `<button class="btn btn-sm btn-gold" onclick="setCertStatus(${r.id}, 'approved')">Approve</button>`,
          `<button class="btn btn-sm btn-outline" style="color:#b91c1c;border-color:#b91c1c" onclick="setCertStatus(${r.id}, 'rejected')">Reject</button>`
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
      if (r.resident_id) {
        actions.push(
          `<button class="btn btn-sm btn-outline" onclick="openCertMessage(${r.id})">Message</button>`
        );
      }
      return `<tr>
        <td class="table-mono">${escapeHtml(r.request_no)}</td>
        <td class="table-name">${escapeHtml(r.applicant_name)}</td>
        <td class="table-text-sm">${escapeHtml(CERT_TYPE_LABELS[r.type] || r.type)}</td>
        <td class="table-muted">${certFmtDate(r.created_at)}</td>
        <td><span class="badge ${badge}">${escapeHtml(r.status.charAt(0).toUpperCase() + r.status.slice(1))}</span></td>
        <td><div class="btn-group">${actions.join("")}</div></td>
      </tr>`;
    })
    .join("");
  if (typeof hydrateIcons === "function") hydrateIcons(tbody);
}

// ── status changes (approve / reject / issue / undo) ──────────────────────
async function setCertStatus(id, status) {
  const r = CERT_REQUESTS.find((x) => x.id === id);
  if (!r) return;
  const verb =
    status === "pending" ? "move back to pending" : status;
  if (
    (status === "rejected" || status === "pending") &&
    !confirm(`${status === "rejected" ? "Reject" : "Undo"} ${r.request_no} (${r.applicant_name})?`)
  )
    return;
  const session = typeof getSession === "function" ? getSession() : null;
  try {
    await apiPatch(`/api/certificates/${id}`, {
      status: status,
      account_id: session?.account_id || null,
    });
  } catch (err) {
    alert(`Could not ${verb} the request: ` + err.message);
    return;
  }
  r.status = status;
  updateCertKpis();
  filterCertRequests();
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

// ── View modal ─────────────────────────────────────────────────────────────
function openViewCert(id) {
  const r = CERT_REQUESTS.find((x) => x.id === id);
  const modal = document.getElementById("modal-view-cert");
  const body = document.getElementById("view-cert-body");
  if (!r || !modal || !body) return;
  const row = (label, value) => `
    <div style="display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid rgba(0,0,0,.06)">
      <span class="table-muted" style="flex-shrink:0">${label}</span>
      <span style="text-align:right;font-weight:500">${value}</span>
    </div>`;
  const dash = '<span class="table-muted">—</span>';
  const badge = CERT_STATUS_BADGES[r.status] || "badge-gray";
  body.innerHTML =
    row("Request No.", escapeHtml(r.request_no)) +
    row("Applicant", escapeHtml(r.applicant_name)) +
    row("Type", escapeHtml(CERT_TYPE_LABELS[r.type] || r.type)) +
    row("Status", `<span class="badge ${badge}">${escapeHtml(r.status)}</span>`) +
    row("Filed", certFmtDate(r.created_at)) +
    row("Purpose / Details", r.purpose ? escapeHtml(r.purpose) : dash) +
    row("Remarks", r.remarks ? escapeHtml(r.remarks) : dash) +
    row("Processed By", r.processed_by_name ? escapeHtml(r.processed_by_name) : dash) +
    row("Processed At", r.processed_at ? certFmtDate(r.processed_at) : dash) +
    row("Linked Resident", r.resident_id ? "#" + r.resident_id : dash);
  modal.classList.add("open");
}

function closeViewCert(e) {
  if (e && e.target !== document.getElementById("modal-view-cert")) return;
  document.getElementById("modal-view-cert")?.classList.remove("open");
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
