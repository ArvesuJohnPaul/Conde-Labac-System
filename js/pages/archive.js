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
    <div class="alert alert-warning"><span class="alert-icon"><i data-icon=triangle-alert></i></span> Storage is at 78%. Consider upgrading storage or purging records older than 5 years.</div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">Backup Archives</div>
        <button class="btn btn-sm btn-gold" onclick="startManualBackup()"><i data-icon=database></i> Manual Backup</button>
      </div>
      ${[
        ["<i data-icon=database></i>","backup_2025-05-02_02-00.zip","98.4 MB · Today, 02:00 AM",          "Verified"],
        ["<i data-icon=database></i>","backup_2025-05-01_02-00.zip","97.1 MB · Yesterday, 02:00 AM",      "Verified"],
        ["<i data-icon=database></i>","backup_2025-04-30_02-00.zip","96.8 MB · Apr 30, 02:00 AM",         "Verified"],
        ["<i data-icon=archive></i>","archive_Q1-2025_full.zip",   "1.2 GB · Apr 1, 2025 · Quarterly",  "Verified"],
      ]
        .map(([icon, name, info, status]) => `
        <div class="archive-card">
          <div class="archive-icon">${icon}</div>
          <div class="archive-meta">
            <div class="archive-name">${name}</div>
            <div class="archive-info">${info} · <span class="archive-status">${status}</span></div>
          </div>
          <div class="archive-actions">
            <button class="btn btn-sm btn-outline" onclick="restoreBackupArchive('${name}')">Restore</button>
            <button class="btn btn-sm btn-outline" onclick="downloadBackupArchive('${name}')"><i data-icon=download></i></button>
          </div>
        </div>`)
        .join("")}
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">Deleted Map Buildings</div>
      </div>
      <div id="archived-buildings-list">${renderArchivedBuildingsList()}</div>
    </div>
  `);
}

function startManualBackup() {
  if (typeof logAudit === "function")
    logAudit("ARCHIVE_BACKUP", "Manual backup started from Archive module", "info", "archive");
  showToast("Backup started...", "<i data-icon=database></i>");
}

function restoreBackupArchive(name) {
  if (typeof logAudit === "function")
    logAudit("ARCHIVE_RESTORE", `Restore initiated from backup ${name}`, "warning", "archive");
  showToast("Restore initiated", "<i data-icon=refresh></i>");
}

function downloadBackupArchive(name) {
  if (typeof logAudit === "function")
    logAudit("ARCHIVE_DOWNLOAD", `Backup ${name} downloaded`, "info", "archive");
  showToast("Downloading...", "<i data-icon=download></i>");
}

function archiveEscapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

// Buildings deleted from the GIS map land here (see gis-map.js's
// gisArchiveBuilding) instead of a transient in-map "Undo" toast, so staff
// can restore them from the Archive at any time, not just in the few
// seconds right after deleting.
function renderArchivedBuildingsList() {
  const archived = typeof gisLoadArchivedBuildings === "function" ? gisLoadArchivedBuildings() : [];
  if (!archived.length) {
    return `<div class="resident-empty">No deleted map buildings to restore.</div>`;
  }
  return archived
    .slice()
    .reverse()
    .map((entry) => {
      const name = entry.tag?.name || "Untagged Building";
      const catMeta =
        typeof gisTagDisplayMeta === "function" && typeof gisNormalizeBuildingTag === "function"
          ? gisTagDisplayMeta(gisNormalizeBuildingTag(entry.tag))
          : null;
      const when = new Date(entry.archivedAt).toLocaleString();
      return `
        <div class="archive-card">
          <div class="archive-icon"><i data-icon="building"></i></div>
          <div class="archive-meta">
            <div class="archive-name">${archiveEscapeHtml(name)}</div>
            <div class="archive-info">${catMeta ? archiveEscapeHtml(catMeta.label) + " · " : ""}Deleted ${when}</div>
          </div>
          <div class="archive-actions">
            <button class="btn btn-sm btn-outline" onclick="restoreArchivedBuildingFromArchive('${entry.id}')"><i data-icon="refresh"></i> Restore</button>
          </div>
        </div>`;
    })
    .join("");
}

function restoreArchivedBuildingFromArchive(id) {
  if (typeof gisRestoreArchivedBuilding === "function" && gisRestoreArchivedBuilding(id)) {
    if (typeof showToast === "function") showToast("Building restored", "<i data-icon=building></i>");
    document.getElementById("archived-buildings-list").innerHTML = renderArchivedBuildingsList();
  }
}
