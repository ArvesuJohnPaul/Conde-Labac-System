// js/pages/accounts.js
window.CURRENT_PAGE = "accounts";

// Demo queue — there is no claim-request table behind this page yet, so the
// rows are still fixtures. They are held in one array rather than inline in
// the template so the shared pager can slice them the same way every other
// list in the MIS is sliced.
const ACCOUNT_CLAIMS = [
  ["ACC-2025-0048", "Santos, Pedro J.", "pedro.santos@gmail.com", "Purok 1", "May 2, 2025", "Pending"],
  ["ACC-2025-0047", "Bautista, Liza M.", "liza.b@yahoo.com", "Purok 3", "May 1, 2025", "Pending"],
  ["ACC-2025-0046", "Ramos, Antonio S.", "antonio.ramos@gmail.com", "Purok 2", "Apr 30, 2025", "Pending"],
  ["ACC-2025-0045", "dela Cruz, Juana", "juana.dc@gmail.com", "Purok 4", "Apr 30, 2025", "Under Review"],
  ["ACC-2025-0044", "Cruz, Mark L.", "mark.cruz@outlook.com", "Purok 5", "Apr 29, 2025", "Approved"],
];

function renderPage() {
  renderAccountsPage();
}

function approveAccountClaim(ref, applicant) {
  if (typeof logAudit === "function")
    logAudit("ACC_CLAIM_APPROVE", `Account claim ${ref} approved for ${applicant}`, "info", "auth");
  showToast(`${ref} approved!`, "<i data-icon=check></i>");
}

function renderAccountsPage() {
  setContent(`
    <div class="page-header">
      <h2 class="page-title">Account Claiming</h2>
      <p class="page-desc">Review and approve resident account claim requests</p>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card warning"><div class="kpi-label">Pending Review</div><div class="kpi-value">12</div></div>
      <div class="kpi-card success"><div class="kpi-label">Approved (30 days)</div><div class="kpi-value">34</div></div>
      <div class="kpi-card danger"><div class="kpi-label">Rejected</div><div class="kpi-value">3</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Accounts</div><div class="kpi-value">487</div></div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Pending Account Claims</div></div>
      <div id="claims-list-wrap">${renderAccountClaimsList()}</div>
    </div>
  `);
}

// The claims table plus its pager, in one block so a page button repaints only
// this part of the page.
function renderAccountClaimsList() {
  const page = paginate("accounts", ACCOUNT_CLAIMS, repaintAccountClaimsList);
  const rows = page.items
    .map(([ref, name, email, purok, date, status]) => {
      const badge = { Pending: "badge-warning", "Under Review": "badge-info", Approved: "badge-success" }[status];
      return `<tr>
        <td class="table-mono">${ref}</td>
        <td class="table-name">${name}</td>
        <td class="table-muted">${email}</td>
        <td><span class="badge badge-gray">${purok}</span></td>
        <td class="table-muted">${date}</td>
        <td><span class="badge ${badge}">${status}</span></td>
        <td><div class="btn-group">
          <button class="btn btn-sm btn-outline" onclick="showToast('Viewing ${ref}')">View</button>
          ${status !== "Approved" ? `<button class="btn btn-sm btn-gold" onclick="approveAccountClaim('${ref}', '${name.replace(/'/g, "\\'")}')">Approve</button>` : ""}
        </div></td>
      </tr>`;
    })
    .join("");
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Ref No.</th><th>Applicant</th><th>Email</th><th>Purok</th><th>Submitted</th><th>Status</th><th>Actions</th></tr></thead>
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
