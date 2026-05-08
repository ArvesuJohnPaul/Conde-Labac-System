// js/pages/archive.js
window.CURRENT_PAGE = "archive";

function renderPage() {
  renderArchive();
}

function renderArchive() {
  setContent(`
    <div class="page-header"><h2 class="page-title">Archive</h2><p class="page-desc">Records retention, backup status, and restore workflows</p></div>
    <div class="kpi-grid">
      <div class="kpi-card success"><div class="kpi-label">Last Backup</div><div class="kpi-value table-text-sm">2h ago</div><div class="kpi-trend">Auto-backup: Daily 2:00 AM</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Archived Size</div><div class="kpi-value table-text-sm">14.8 GB</div></div>
      <div class="kpi-card"><div class="kpi-label">Records Archived</div><div class="kpi-value">12,408</div></div>
      <div class="kpi-card warning"><div class="kpi-label">Storage Used</div><div class="kpi-value table-text-sm">78%</div><div class="kpi-trend">19.0 GB of 25 GB</div></div>
    </div>
    <div class="alert alert-warning"><span class="alert-icon">⚑</span> Storage is at 78%. Consider upgrading storage or purging records older than 5 years.</div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">Backup Archives</div>
        <button class="btn btn-sm btn-gold" onclick="showToast('Backup started...','💾')">💾 Manual Backup</button>
      </div>
      ${[
        ["💾","backup_2025-05-02_02-00.zip","98.4 MB · Today, 02:00 AM",          "Verified"],
        ["💾","backup_2025-05-01_02-00.zip","97.1 MB · Yesterday, 02:00 AM",      "Verified"],
        ["💾","backup_2025-04-30_02-00.zip","96.8 MB · Apr 30, 02:00 AM",         "Verified"],
        ["📦","archive_Q1-2025_full.zip",   "1.2 GB · Apr 1, 2025 · Quarterly",  "Verified"],
      ]
        .map(([icon, name, info, status]) => `
        <div class="archive-card">
          <div class="archive-icon">${icon}</div>
          <div class="archive-meta">
            <div class="archive-name">${name}</div>
            <div class="archive-info">${info} · <span class="archive-status">${status}</span></div>
          </div>
          <div class="archive-actions">
            <button class="btn btn-sm btn-outline" onclick="showToast('Restore initiated','🔄')">Restore</button>
            <button class="btn btn-sm btn-outline" onclick="showToast('Downloading...','⬇')">⬇</button>
          </div>
        </div>`)
        .join("")}
    </div>
  `);
}
