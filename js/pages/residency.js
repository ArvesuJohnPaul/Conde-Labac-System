// js/pages/residency.js
window.CURRENT_PAGE = "residency";

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
      <div class="kpi-card"><div class="kpi-label">Total Residents</div><div class="kpi-value">5,612</div><div class="kpi-trend">Last updated: May 2025</div></div>
      <div class="kpi-card success"><div class="kpi-label">Verified Residents</div><div class="kpi-value">1,248</div></div>
      <div class="kpi-card info"><div class="kpi-label">Senior Citizens</div><div class="kpi-value">342</div></div>
      <div class="kpi-card warning"><div class="kpi-label">PWD Residents</div><div class="kpi-value">89</div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">Resident Directory</div>
        <div class="btn-group">
          <button class="btn btn-sm btn-gold" onclick="openServicePopup('residency')"><i data-icon=search></i> Open Search</button>
          <button class="btn btn-sm btn-outline"><i data-icon=download></i> Export CSV</button>
        </div>
      </div>
      <div class="filter-row">
        <input class="form-control filter-input" placeholder="Search by name..." oninput="this.nextElementSibling.click()"/>
        <select class="form-control filter-select"><option>All Puroks</option><option>Purok 1</option><option>Purok 2</option><option>Purok 3</option><option>Purok 4</option><option>Purok 5</option></select>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Age</th><th>Purok</th><th>Category</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${[
              ["Santos, Pedro J.",    "34", "Purok 1", "—",               "Active"],
              ["dela Cruz, Maria L.", "67", "Purok 2", "Senior Citizen",   "Active"],
              ["Reyes, Jose B.",      "45", "Purok 3", "Indigent Family",  "Active"],
              ["Aquino, Ana M.",      "29", "Purok 1", "Solo Parent",      "Active"],
              ["Bautista, Carlos F.", "52", "Purok 4", "PWD",              "Active"],
              ["Villanueva, Rosa T.", "78", "Purok 5", "Senior Citizen",   "Active"],
              ["Garcia, Luis N.",     "38", "Purok 2", "—",               "Active"],
              ["Mendoza, Elena P.",   "44", "Purok 3", "Indigent Family",  "Inactive"],
            ]
              .map(([n, a, p, c, s]) => `<tr>
              <td class="table-name">${n}</td><td>${a}</td><td><span class="badge badge-gray">${p}</span></td>
              <td>${c !== "—" ? `<span class="badge badge-gold">${c}</span>` : '<span class="table-muted">—</span>'}</td>
              <td><span class="badge ${s === "Active" ? "badge-success" : "badge-gray"}">${s}</span></td>
              <td><button class="btn btn-sm btn-outline" onclick="showToast('Viewing ${n.split(",")[0]}')">View</button></td>
            </tr>`)
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `);
}
