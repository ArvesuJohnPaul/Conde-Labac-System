// js/pages/sms.js
// SMS Log — every text message the system has queued, sent, or decided not to
// send, with the reason. Backed by the sms_message outbox
// (conde-labak-server/sms-service.js): a route never texts anyone directly, it
// writes a row here and the worker sends it.
//
// In dry-run mode (the default) nothing is sent at all — each row shows the
// exact text that WOULD have gone out, which is also how the system is
// demonstrated without spending credits.
window.CURRENT_PAGE = "sms";

let SMS_ROWS = [];
let SMS_STATUS = null;

const smsEsc = (s) =>
  String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

const SMS_KIND_LABELS = {
  certificate: "Certificate",
  incident_ack: "Report received",
  incident_status: "Report status",
  incident_report: "Incident report",
  broadcast: "Announcement",
  direct: "Message",
  code: "Verification code",
  application: "Account application",
  claim_notice: "Account notice",
  test: "Setup check",
};

const SMS_STATUS_BADGES = {
  queued: ["badge-info", "Queued"],
  sending: ["badge-info", "Sending"],
  submitted: ["badge-gold", "With the network"],
  sent: ["badge-success", "Sent"],
  failed: ["badge-danger", "Failed"],
  refunded: ["badge-gray", "Refunded"],
  skipped: ["badge-gray", "Not sent"],
  expired: ["badge-warning", "Expired"],
};

// Why a row was never sent, in words a desk officer can act on.
const SMS_SKIP_REASONS = {
  off: "SMS is switched off",
  "dry-run": "Dry run — shown here, not sent",
  "not-mobile": "Not a mobile number",
  "setting-off": "The resident turned these texts off",
  "not-allowlisted": "Not on the test allowlist",
  "no-key": "No Semaphore API key on the server",
  "hourly-cap": "Hourly limit on report texts reached",
};

const SMS_MODE_LABELS = {
  off: ["badge-gray", "Off", "Nothing is sent. Texts are logged here as not sent."],
  "dry-run": [
    "badge-warning",
    "Dry run",
    "Nothing is sent. Every text is written here exactly as it would go out — safe for demonstrations.",
  ],
  live: ["badge-success", "Live", "Texts are being sent through Semaphore and cost credits."],
};

function renderPage() {
  const session = typeof getSession === "function" ? getSession() : null;
  const isAdmin = session && session.role === "Admin";
  setContent(`
    <div class="page-header">
      <h2 class="page-title">SMS Log</h2>
      <p class="page-desc">Every text message the system queued, sent, or held back — and why</p>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Mode</div><div class="kpi-value" id="sms-kpi-mode">—</div><div class="kpi-trend" id="sms-kpi-mode-note">&nbsp;</div></div>
      <div class="kpi-card info"><div class="kpi-label">Credits Today</div><div class="kpi-value" id="sms-kpi-today">—</div><div class="kpi-trend" id="sms-kpi-cap">&nbsp;</div></div>
      <div class="kpi-card success"><div class="kpi-label">Balance</div><div class="kpi-value" id="sms-kpi-balance">—</div><div class="kpi-trend" id="sms-kpi-sender">&nbsp;</div></div>
      <div class="kpi-card warning"><div class="kpi-label">Incident Reports Go To</div><div class="kpi-value" id="sms-kpi-recipients">—</div><div class="kpi-trend">officials with texts switched on</div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">Messages</div>
        <div class="btn-group">
          ${isAdmin ? `<button class="btn btn-sm btn-outline" onclick="sendSmsSetupCheck()"><i data-icon=phone></i> Send setup check</button>` : ""}
          <button class="btn btn-sm btn-outline" onclick="loadSmsPage()"><i data-icon=refresh></i> Refresh</button>
        </div>
      </div>
      <div class="gis-filter-row">
        <div class="gis-search-wrap">
          ${typeof gisIcon === "function" ? gisIcon("search", "gis-search-icon") : ""}
          <input type="text" class="gis-search-input" id="sms-q" autocomplete="off"
                 placeholder="Search by reference (CERT-, INC-, ACC-) or number…" onchange="loadSmsLog()"/>
        </div>
        <select class="gis-filter-select" id="sms-kind" onchange="loadSmsLog()">
          <option value="">All Kinds</option>
          ${Object.entries(SMS_KIND_LABELS).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}
        </select>
        <select class="gis-filter-select" id="sms-status" onchange="loadSmsLog()">
          <option value="">All Statuses</option>
          ${Object.entries(SMS_STATUS_BADGES).map(([k, [, l]]) => `<option value="${k}">${l}</option>`).join("")}
        </select>
      </div>
      <div id="sms-log-wrap"><div class="resident-summary">Loading…</div></div>
    </div>
  `);
  loadSmsPage();
}

function loadSmsPage() {
  loadSmsStatus();
  loadSmsLog();
}

async function loadSmsStatus() {
  try {
    SMS_STATUS = await apiGet(`/api/sms/status?account_id=${actingAccountId()}`);
  } catch (err) {
    const el = document.getElementById("sms-kpi-mode-note");
    if (el) el.textContent = err.message;
    return;
  }
  const s = SMS_STATUS;
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = v;
  };
  const [badge, label, note] = SMS_MODE_LABELS[s.mode] || SMS_MODE_LABELS.off;
  set("sms-kpi-mode", `<span class="badge ${badge}" style="font-size:15px">${label}</span>`);
  set("sms-kpi-mode-note", smsEsc(note + (s.allowlist_active ? " Test allowlist active." : "")));
  set("sms-kpi-today", String(s.credits_today));
  set("sms-kpi-cap", `of ${s.cap} a day · quiet hours ${smsEsc(s.quiet_hours)}`);
  set(
    "sms-kpi-balance",
    s.balance != null ? `${Number(s.balance).toLocaleString()}` : "—"
  );
  set(
    "sms-kpi-sender",
    s.configured
      ? smsEsc(s.sender ? `Sender ${s.sender}` : "Sender: the account's registered name") +
          (s.balance_error ? ` · ${smsEsc(s.balance_error)}` : "")
      : "No API key on the server"
  );
  set(
    "sms-kpi-recipients",
    `<span style="color:${s.report_recipients ? "inherit" : "#b91c1c"}">${s.report_recipients}</span>`
  );
}

async function loadSmsLog() {
  const wrap = document.getElementById("sms-log-wrap");
  const qs = new URLSearchParams({ account_id: actingAccountId(), limit: "200" });
  const q = (document.getElementById("sms-q")?.value || "").trim();
  const kind = document.getElementById("sms-kind")?.value || "";
  const status = document.getElementById("sms-status")?.value || "";
  if (q) qs.set("q", q);
  if (kind) qs.set("kind", kind);
  if (status) qs.set("status", status);
  try {
    const r = await apiGet(`/api/sms/messages?${qs}`);
    SMS_ROWS = r.items || [];
    resetPage("sms");
    repaintSmsLog();
  } catch (err) {
    if (wrap)
      wrap.innerHTML = `<div class="resident-summary" style="color:#b91c1c">${smsEsc(err.message)}
        <button class="btn btn-sm btn-outline" onclick="loadSmsLog()" style="margin-left:8px">Retry</button></div>`;
  }
}

function smsWhen(iso) {
  const d = new Date(iso);
  return isNaN(d)
    ? "—"
    : d.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function renderSmsLog() {
  if (!SMS_ROWS.length) return `<div class="resident-summary">No text messages match.</div>`;
  const session = typeof getSession === "function" ? getSession() : null;
  const isAdmin = session && session.role === "Admin";
  const page = paginate("sms", SMS_ROWS, repaintSmsLog);
  const rows = page.items
    .map((m) => {
      const [badge, label] = SMS_STATUS_BADGES[m.status] || ["badge-gray", m.status];
      const why =
        m.status === "skipped"
          ? SMS_SKIP_REASONS[m.skip_reason] || m.skip_reason || ""
          : m.status === "failed" || m.status === "expired"
            ? m.error || (m.status === "expired" ? "Not sent in time — an emergency text is never sent late" : "")
            : m.status === "queued" && new Date(m.next_attempt_at) > new Date()
              ? (m.error ? `Retrying at ${smsWhen(m.next_attempt_at)} — ${m.error}` : `Waiting until ${smsWhen(m.next_attempt_at)}`)
              : m.network || "";
      const retry =
        isAdmin && (m.status === "failed" || m.status === "expired")
          ? `<button class="btn btn-sm btn-outline" onclick="retrySms(${m.sms_id})"><i data-icon=refresh></i> Retry</button>`
          : "";
      return `<tr>
        <td class="table-muted" style="white-space:nowrap">${smsWhen(m.created_at)}</td>
        <td class="table-mono">${smsEsc(m.recipient_local)}</td>
        <td>${smsEsc(SMS_KIND_LABELS[m.kind] || m.kind)}${m.queue === "priority" ? ' <span class="badge badge-danger">priority</span>' : ""}</td>
        <td class="table-mono">${smsEsc(m.ref || "—")}</td>
        <td style="max-width:360px">${m.body ? smsEsc(m.body) : '<span class="table-muted">Removed after the retention period</span>'}</td>
        <td class="table-muted">${m.segments} · ${m.credits} cr</td>
        <td><span class="badge ${badge}">${label}</span>${why ? `<div class="table-muted" style="font-size:12px;max-width:200px">${smsEsc(why)}</div>` : ""}</td>
        <td>${retry}</td>
      </tr>`;
    })
    .join("");
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>When</th><th>To</th><th>Kind</th><th>Ref</th><th>Message</th><th>Parts · Credits</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${page.html}`;
}

function repaintSmsLog() {
  const wrap = document.getElementById("sms-log-wrap");
  if (!wrap) return;
  wrap.innerHTML = renderSmsLog();
  if (typeof hydrateIcons === "function") hydrateIcons(wrap);
}

async function retrySms(id) {
  try {
    const r = await apiPost(`/api/sms/messages/${id}/retry`, { account_id: actingAccountId() });
    showToast(
      r.mode === "live" ? "Queued again — it goes out within a minute" : `Queued again (SMS mode is ${r.mode}: it will not be sent)`,
      "<i data-icon=refresh></i>"
    );
  } catch (err) {
    showToast("Could not retry: " + err.message, "<i data-icon=triangle-alert></i>");
  }
  loadSmsLog();
}

// One harmless text to one number: proves the key, the sender name and the
// credits in one go.
async function sendSmsSetupCheck() {
  const to = await uiPrompt({
    icon: "phone",
    title: "Send a setup check",
    message: 'Texts "Brgy Conde Labac: SMS setup check…" to one number, to prove the key, sender name and credits work.',
    field: { label: "Mobile number", placeholder: "09XX XXX XXXX" },
    validate: (v) =>
      /^(?:\+?63|0)?9\d{9}$/.test(v.replace(/[^\d+]/g, "")) ? null : "Enter a mobile number like 0917 123 4567.",
    confirmLabel: "Send",
    confirmIcon: "check",
  });
  if (!to) return;
  try {
    const r = await apiPost("/api/sms/test", { account_id: actingAccountId(), to });
    showToast(
      r.status === "queued"
        ? "Setup check queued — it goes out within a minute"
        : `Logged, not sent: ${SMS_SKIP_REASONS[r.skip_reason] || r.skip_reason}`,
      "<i data-icon=phone></i>"
    );
  } catch (err) {
    showToast("Could not send: " + err.message, "<i data-icon=triangle-alert></i>");
  }
  loadSmsLog();
}
