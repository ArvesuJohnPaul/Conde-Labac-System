// js/pages/archive.js — the system recycle bin. Deleting a resident,
// certificate request, blotter report, feedback entry, announcement, or
// official now snapshots it to the shared `archive` table (see the server's
// archive-service.js) instead of destroying it, so it can be restored here.
// Deleted GIS map buildings keep their own section further down.
window.CURRENT_PAGE = "archive";

function renderPage() {
  renderArchive();
  loadDeletedRecords();
  syncArchivedBuildingsFromServer();
}

// ── Deleted records (residents / certificates / blotter / feedback / site) ────
let deletedRecords = [];

const ARCHIVE_MODULE_META = {
  residency: { icon: "houses", label: "Resident" },
  certificates: { icon: "file-text", label: "Certificate" },
  incidents: { icon: "siren", label: "Blotter / Incident" },
  feedback: { icon: "message-square", label: "Feedback" },
  announcements: { icon: "megaphone", label: "Announcement" },
  officials: { icon: "users", label: "Official" },
  users: { icon: "user", label: "User Account" },
  audit: { icon: "clipboard", label: "Cleared Audit Entries" },
};

// How long a scheduled snapshot has left, as a phrase and a severity. Most
// archive rows have no schedule at all — they wait for a person — so this
// returns null for them rather than inventing a deadline.
function archiveCountdown(purgeAfter) {
  if (!purgeAfter) return null;
  const due = new Date(purgeAfter);
  if (isNaN(due)) return null;
  const days = Math.ceil((due.getTime() - Date.now()) / 86400000);
  const on = due.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  // Past due but still listed: the daily sweep has not run yet. Say that,
  // rather than showing a negative countdown.
  if (days <= 0)
    return { tone: "due", text: `Due for permanent deletion (${on})` };
  if (days <= 7)
    return { tone: "soon", text: `Permanently deleted in ${days} day${days === 1 ? "" : "s"} — ${on}` };
  return { tone: "ok", text: `Permanently deleted in ${days} days — ${on}` };
}

const archiveAccountId = () => (getSession() || {}).account_id || null;

async function loadDeletedRecords() {
  const list = document.getElementById("deleted-records-list");
  if (list) list.innerHTML = `<div class="resident-summary">Loading…</div>`;
  try {
    deletedRecords = await apiGet("/api/archive");
  } catch (e) {
    if (list)
      list.innerHTML = `<div class="resident-empty">Could not load the archive (${archiveEscapeHtml(
        e.message
      )}).</div>`;
    return;
  }
  renderDeletedRecords();
}

function renderDeletedRecords() {
  const list = document.getElementById("deleted-records-list");
  const count = document.getElementById("deleted-records-count");
  if (count)
    count.textContent = `${deletedRecords.length} item${
      deletedRecords.length !== 1 ? "s" : ""
    }`;
  if (!list) return;
  if (!deletedRecords.length) {
    list.innerHTML = `<div class="resident-empty">Nothing in the recycle bin. Deleted records across the system appear here and can be restored.</div>`;
    return;
  }
  const page = paginate("archive-records", deletedRecords, renderDeletedRecords);
  list.innerHTML = page.items
    .map((r) => {
      const meta = ARCHIVE_MODULE_META[r.module] || {
        icon: "archive",
        label: r.typeLabel || "Record",
      };
      const when = r.archivedAt ? new Date(r.archivedAt).toLocaleString() : "";
      const sub = [
        r.typeLabel || meta.label,
        r.subtitle,
        r.archivedBy ? "by " + r.archivedBy : "",
        when,
      ]
        .filter(Boolean)
        .map(archiveEscapeHtml)
        .join(" · ");
      const countdown = archiveCountdown(r.purgeAfter);
      return `
        <div class="archive-card">
          <div class="archive-icon"><i data-icon="${meta.icon}"></i></div>
          <div class="archive-meta">
            <div class="archive-name">${archiveEscapeHtml(r.title || meta.label)}</div>
            <div class="archive-info">${sub}</div>
            ${
              countdown
                ? `<div class="archive-timer archive-timer-${countdown.tone}">
                     <i data-icon="clock"></i> ${archiveEscapeHtml(countdown.text)}
                   </div>`
                : ""
            }
          </div>
          <div class="archive-actions">
            <button class="btn btn-sm btn-gold" onclick="restoreDeletedRecord(${r.archiveId})">
              <i data-icon="refresh"></i> Restore
            </button>
            ${
              // No manual delete for cleared audit entries. They already have a
              // timer, and the whole point of an audit trail is that the person
              // it incriminates cannot reach in and remove it. The server
              // refuses this too (routes/archive.js) — hiding the button alone
              // would only stop the honest.
              r.table === "audit_log"
                ? `<span class="archive-locked" title="Removed automatically when the retention timer ends — it cannot be deleted by hand."><i data-icon="lock"></i></span>`
                : `<button class="btn btn-sm btn-outline btn-archive-purge" title="Delete permanently" onclick="purgeDeletedRecord(${r.archiveId})">
              <i data-icon="trash"></i>
            </button>`
            }
          </div>
        </div>`;
    })
    .join("") + page.html;
  if (typeof hydrateIcons === "function") hydrateIcons(list);
}

async function restoreDeletedRecord(archiveId) {
  const rec = deletedRecords.find((r) => r.archiveId === archiveId);
  try {
    await apiPost(`/api/archive/${archiveId}/restore`, {
      account_id: archiveAccountId(),
    });
  } catch (e) {
    showToast("Could not restore: " + e.message, "<i data-icon=triangle-alert></i>");
    return;
  }
  if (typeof logAudit === "function")
    logAudit(
      "ARCHIVE_RESTORE",
      `Restored ${rec ? rec.typeLabel + " — " + rec.title : "record #" + archiveId}`,
      "info",
      "archive"
    );
  deletedRecords = deletedRecords.filter((r) => r.archiveId !== archiveId);
  renderDeletedRecords();
  showToast("Record restored", "<i data-icon=refresh></i>");
}

async function purgeDeletedRecord(archiveId) {
  const rec = deletedRecords.find((r) => r.archiveId === archiveId);
  const meta = (rec && ARCHIVE_MODULE_META[rec.module]) || { icon: "archive" };
  // The one irreversible action in the system — it gets the bluntest wording.
  const ok = await uiConfirm({
    icon: "triangle-alert",
    title: "Permanently delete this record?",
    message:
      "The recycle bin is the last copy. Once it is gone from here, there is nothing left to restore.",
    target: {
      icon: meta.icon,
      label: rec ? `${rec.typeLabel || "Record"} — ${rec.title}` : "This record",
    },
    notes: [
      {
        icon: "triangle-alert",
        text: "This cannot be undone. Restore it instead if you are not certain.",
      },
      {
        icon: "clipboard",
        text: "The permanent deletion is recorded in the Audit Log as a critical event.",
      },
    ],
    confirmLabel: "Delete Permanently",
    confirmIcon: "trash",
  });
  if (!ok) return;
  try {
    await apiDelete(`/api/archive/${archiveId}?account_id=${archiveAccountId() || ""}`);
  } catch (e) {
    showToast("Could not delete: " + e.message, "<i data-icon=triangle-alert></i>");
    return;
  }
  if (typeof logAudit === "function")
    logAudit(
      "ARCHIVE_PURGE",
      `Permanently deleted ${
        rec ? rec.typeLabel + " — " + rec.title : "record #" + archiveId
      }`,
      "critical",
      "archive"
    );
  deletedRecords = deletedRecords.filter((r) => r.archiveId !== archiveId);
  renderDeletedRecords();
  showToast("Record permanently deleted", "<i data-icon=trash></i>");
}

// ── Page scaffold ─────────────────────────────────────────────────────────────
function renderArchive() {
  setContent(`
    <div class="page-header"><h2 class="page-title">Archive</h2><p class="page-desc">Recycle bin, records retention, and restore workflows</p></div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">Deleted Records <span id="deleted-records-count" class="badge badge-gray"></span></div>
        <button class="btn btn-sm btn-outline" onclick="loadDeletedRecords()"><i data-icon=refresh></i> Refresh</button>
      </div>
      <p class="modal-help-text">Deleted records from across the system. Restoring puts one back exactly where it was; every delete, restore and permanent-delete is logged. Items are kept <strong>30 days</strong>, then deleted automatically — <strong>cleared audit entries for 90 days</strong>, and those can only leave by their timer.</p>
      <div id="deleted-records-list"><div class="resident-summary">Loading…</div></div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">Deleted Map Buildings</div>
      </div>
      <div id="archived-buildings-list">${renderArchivedBuildingsList()}</div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">Backup Archives</div>
        <button class="btn btn-sm btn-gold" onclick="startManualBackup()"><i data-icon=database></i> Manual Backup</button>
      </div>
      ${[
        ["<i data-icon=database></i>", "backup_2025-05-02_02-00.zip", "98.4 MB · Today, 02:00 AM", "Verified"],
        ["<i data-icon=database></i>", "backup_2025-05-01_02-00.zip", "97.1 MB · Yesterday, 02:00 AM", "Verified"],
        ["<i data-icon=archive></i>", "archive_Q1-2025_full.zip", "1.2 GB · Apr 1, 2025 · Quarterly", "Verified"],
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

// ── Deleted GIS map buildings (their own archive/restore path) ────────────────
// The archive list lives in the shared DB (archive table) so every device sees
// the same recycle bin. Pull it, reconcile the localStorage snapshot, repaint.
//
// Reconciled through gisMergeServerArchive rather than overwritten outright:
// overwriting would drop a deletion this browser made while the API was
// unreachable, which is the one thing the local copy knows and the server does
// not. Everything else the server says is taken as final — including that a
// snapshot it no longer lists has been purged, restored or deleted for good.
async function syncArchivedBuildingsFromServer() {
  if (typeof apiGet !== "function") return;
  try {
    const rows = await apiGet("/api/gis/archive");
    if (typeof gisMergeServerArchive === "function")
      await gisMergeServerArchive(rows);
    else gisSaveJSON(GIS_ARCHIVED_BUILDINGS_KEY, rows);
    repaintArchivedBuildingsList();
  } catch (e) {
    /* offline — the local snapshot stays */
  }
}

function repaintArchivedBuildingsList() {
  const el = document.getElementById("archived-buildings-list");
  if (!el) return;
  el.innerHTML = renderArchivedBuildingsList();
  if (typeof hydrateIcons === "function") hydrateIcons(el);
}

function renderArchivedBuildingsList() {
  const archived = typeof gisLoadArchivedBuildings === "function" ? gisLoadArchivedBuildings() : [];
  if (!archived.length) {
    return `<div class="resident-empty">No deleted map buildings to restore.</div>`;
  }
  // Newest deletion first, then paged like every other list.
  const page = paginate(
    "archive-buildings",
    archived.slice().reverse(),
    repaintArchivedBuildingsList
  );
  return page.items
    .map((entry) => {
      const name = entry.tag?.name || "Untagged Building";
      const catMeta =
        typeof gisTagDisplayMeta === "function" && typeof gisNormalizeBuildingTag === "function"
          ? gisTagDisplayMeta(gisNormalizeBuildingTag(entry.tag))
          : null;
      const when = new Date(entry.archivedAt).toLocaleString();
      const countdown = archiveCountdown(entry.purgeAfter);
      return `
        <div class="archive-card">
          <div class="archive-icon"><i data-icon="building"></i></div>
          <div class="archive-meta">
            <div class="archive-name">${archiveEscapeHtml(name)}</div>
            <div class="archive-info">${catMeta ? archiveEscapeHtml(catMeta.label) + " · " : ""}Deleted ${when}</div>
            ${
              countdown
                ? `<div class="archive-timer archive-timer-${countdown.tone}">
                     <i data-icon="clock"></i> ${archiveEscapeHtml(countdown.text)}
                   </div>`
                : ""
            }
          </div>
          <div class="archive-actions">
            <button class="btn btn-sm btn-outline" onclick="restoreArchivedBuildingFromArchive('${entry.id}')"><i data-icon="refresh"></i> Restore</button>
          </div>
        </div>`;
    })
    .join("") + page.html;
}

function restoreArchivedBuildingFromArchive(id) {
  if (typeof gisRestoreArchivedBuilding === "function" && gisRestoreArchivedBuilding(id)) {
    if (typeof showToast === "function") showToast("Building restored", "<i data-icon=building></i>");
    repaintArchivedBuildingsList();
  }
}
