// js/pages/certificates.js
window.CURRENT_PAGE = "certificates";

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
      <div class="kpi-card warning"><div class="kpi-label">Pending Review</div><div class="kpi-value">7</div></div>
      <div class="kpi-card success"><div class="kpi-label">Issued This Month</div><div class="kpi-value">87</div><div class="kpi-trend"><span class="up">↑ +12%</span></div></div>
      <div class="kpi-card"><div class="kpi-label">Total This Year</div><div class="kpi-value">412</div></div>
      <div class="kpi-card danger"><div class="kpi-label">Rejected</div><div class="kpi-value">6</div><div class="kpi-trend">Incomplete docs</div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">Certificate Requests</div>
        <div class="btn-group">
          <button class="btn btn-sm btn-gold" onclick="openServicePopup('certificates')">⊕ New Request</button>
          <button class="btn btn-sm btn-outline">⬇ Export</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Req. No.</th><th>Applicant</th><th>Certificate Type</th><th>Date Filed</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${[
              ["CERT-2025-087", "Santos, Pedro J.",    "Barangay Clearance",        "May 2, 2025",  "pending"],
              ["CERT-2025-086", "dela Cruz, Maria L.", "Certificate of Indigency",  "May 1, 2025",  "approved"],
              ["CERT-2025-085", "Reyes, Jose B.",      "Certificate of Residency",  "Apr 30, 2025", "issued"],
              ["CERT-2025-084", "Aquino, Ana M.",      "Solo Parent Certificate",   "Apr 30, 2025", "pending"],
              ["CERT-2025-083", "Bautista, Carlos F.", "Good Moral Certificate",    "Apr 29, 2025", "rejected"],
              ["CERT-2025-082", "Garcia, Luis N.",     "Barangay Clearance",        "Apr 29, 2025", "issued"],
              ["CERT-2025-081", "Mendoza, Elena P.",   "Business Clearance",        "Apr 28, 2025", "pending"],
            ]
              .map(([no, name, type, date, status]) => {
                const badge = { pending: "badge-warning", approved: "badge-info", issued: "badge-success", rejected: "badge-danger" }[status];
                return `<tr>
                <td class="table-mono">${no}</td>
                <td class="table-name">${name}</td>
                <td class="table-text-sm">${type}</td>
                <td class="table-muted">${date}</td>
                <td><span class="badge ${badge}">${status.charAt(0).toUpperCase() + status.slice(1)}</span></td>
                <td><div class="btn-group">
                  <button class="btn btn-sm btn-outline" onclick="showToast('Viewing ${no}')">View</button>
                  ${status === "pending" ? `<button class="btn btn-sm btn-gold" onclick="showToast('${no} approved! ✓','✓')">Approve</button>` : ""}
                </div></td>
              </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `);
}
