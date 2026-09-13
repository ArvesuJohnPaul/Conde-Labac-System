// js/pages/dashboard.js
window.CURRENT_PAGE = "dashboard";

function renderPage() {
  renderDashboard();
  // Every number and every chart on this page comes from the server. They are
  // painted as placeholders first so the layout does not jump when the data
  // lands, and each loader is independent — a slow /activity must not hold up
  // the KPI row.
  loadDashboardStats();
  loadSiteActivity();
  loadOperations();
  // setContent() rebuilt the DOM, but a briefing generated earlier this session
  // is still held in shell.js — repaint it so navigating away and back does not
  // silently lose it. No-ops (leaving the placeholder) when nothing exists yet.
  if (typeof renderAiSummary === "function") renderAiSummary();
  // The briefing replaced the old hardcoded alert banners, so it has to be
  // there without anyone pressing anything.
  if (typeof loadAiSummary === "function") loadAiSummary();
  // Same reasoning, more so: an urgent alert nobody pressed a button to see is
  // an urgent alert nobody sees. Costs no AI quota — the flags were raised when
  // the comments were analysed, this only reads them.
  if (typeof renderAiAlerts === "function") renderAiAlerts();
  if (typeof loadAiAlerts === "function") loadAiAlerts();
  // Recent Activity paints from the local trail immediately, then repaints
  // once the shared DB trail lands — that is where the mobile app's and the
  // database triggers' entries live, so the first paint is only this browser's
  // own history. Same two-step the Audit Logs page uses.
  if (typeof auditFetchServerLogs === "function")
    auditFetchServerLogs().then(function (got) {
      if (got) repaintDashActivity();
    });
}

// ── Recent Activity ─────────────────────────────────────────────────────────
// The five most recent entries from the real audit trail (js/audit-log.js) —
// the same source the Audit Logs page reads, which is what the card's "View
// log" link opens. This used to be five hardcoded lines naming residents who
// do not exist, dated "Today, 10:45 AM" whatever day it was.
const DASH_ACTIVITY_LIMIT = 5;

// Audit level → timeline dot colour. Level, not category: the dot is there to
// say "how much does this matter", and the wording beside it already says what
// kind of thing happened.
const DASH_DOT_BY_LEVEL = { critical: "red", warning: "gold", info: "green" };

function dashEscape(str) {
  const div = document.createElement("div");
  div.textContent = String(str == null ? "" : str);
  return div.innerHTML;
}

// "10:45 AM" for today, "Yesterday, 4:30 PM", then the date — the same
// shorthand the hardcoded rows used, because it is the right shorthand for a
// list that is almost always same-day.
function dashActivityWhen(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return "";
  const time = d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.floor((startOfToday.getTime() - d.getTime()) / 86400000);
  if (d.getTime() >= startOfToday.getTime()) return `Today, ${time}`;
  if (days === 0) return `Yesterday, ${time}`;
  return (
    d.toLocaleDateString("en-PH", { month: "short", day: "numeric" }) + ", " + time
  );
}

function renderDashActivity() {
  const logs =
    typeof auditAllLogs === "function" ? auditAllLogs().slice(0, DASH_ACTIVITY_LIMIT) : [];
  if (!logs.length) {
    return `<div class="resident-empty">No activity recorded yet. Certificate approvals, incident reports, map edits and sign-ins all appear here as they happen.</div>`;
  }
  return logs
    .map((e) => {
      const dot = DASH_DOT_BY_LEVEL[e.level] || "gray";
      // The details line is the human sentence logAudit() was given; the
      // action code beside the user is what the Audit Logs page shows.
      const what = e.details || e.action || "Activity";
      const who = [e.user, e.role].filter(Boolean).join(" · ");
      return `
        <div class="timeline-item">
          <div class="timeline-dot ${dot}"></div>
          <div class="timeline-body">
            <div class="timeline-title">${dashEscape(what)}</div>
            <div class="timeline-meta">${dashEscape(dashActivityWhen(e.ts))}${who ? " · " + dashEscape(who) : ""}</div>
          </div>
        </div>`;
    })
    .join("");
}

function repaintDashActivity() {
  const el = document.getElementById("dash-activity");
  if (!el) return;
  el.innerHTML = renderDashActivity();
  if (typeof hydrateIcons === "function") hydrateIcons(el);
}

function renderDashboard() {
  setContent(`
    <div class="page-header">
      <h2 class="page-title">Good morning, ${currentRole === "Officer" ? "Officer Reyes" : "Administrator"}! <i data-icon=wave></i></h2>
      <p class="page-desc">Here's what's happening in Barangay Conde Labac today</p>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Registered Residents</div><div class="kpi-value" id="kpi-residents">—</div><div class="kpi-trend" id="kpi-residents-sub">Active records on file</div></div>
      <div class="kpi-card success"><div class="kpi-label">Certificates Issued</div><div class="kpi-value" id="kpi-certs-issued">—</div><div class="kpi-trend" id="kpi-certs-issued-sub">Released to residents</div></div>
      <div class="kpi-card danger"><div class="kpi-label">Active Incidents</div><div class="kpi-value" id="kpi-incidents">—</div><div class="kpi-trend" id="kpi-incidents-sub">Open or under review</div></div>
      <div class="kpi-card info"><div class="kpi-label">Pending Requests</div><div class="kpi-value" id="kpi-pending">—</div><div class="kpi-trend" id="kpi-pending-sub">Awaiting action</div></div>
      <div class="kpi-card"><div class="kpi-label">Feedback Score</div><div class="kpi-value" id="kpi-feedback">—</div><div class="kpi-trend" id="kpi-feedback-sub">Average resident rating</div></div>
      <div class="kpi-card"><div class="kpi-label">Registered Households</div><div class="kpi-value" id="kpi-households">—</div><div class="kpi-trend" id="kpi-households-sub">Active households</div></div>
    </div>

    <!-- Sits directly under the KPIs, where the hardcoded alert banners used to
         be, and runs the full width: the KPIs say what the numbers are, this
         says what to do about them. Its four sections lay out as a horizontal
         strip rather than a tall column squeezed beside another card. -->
    <div class="card ai-card ai-briefing">
      <div class="card-header">
        <div class="card-title">AI Briefing</div>
        <span class="card-action" onclick="generateAiSummary('dashboard')">Generate</span>
      </div>
      <div id="ai-summary-text" class="ai-summary-text">
        No briefing yet. Use Generate for a summary of what is pending and what needs attention.
      </div>
      <!-- Urgent alerts, directly under the summary they belong to: the
           briefing's "Resident Sentiment" column says how many are flagged, and
           these are the actual items behind that number, each with the button
           that clears it. Kept as thin, individually-boxed rows so a run of
           them reads as a list of things to do rather than a second wall of
           text under the first.

           Hidden entirely when the board is clear — see the note above
           renderAiAlerts() in js/shell.js for why there is no "no alerts"
           state. -->
      <div class="ai-alerts" id="ai-alerts" hidden>
        <div class="ai-alerts-head">
          <i data-icon=triangle-alert></i>
          <span>Needs action now</span>
          <span class="ai-alert-count" id="ai-alerts-count"></span>
        </div>
        <div id="ai-alerts-list"></div>
      </div>
    </div>

    <!-- Site Activity — the one card on the dashboard that describes the
         SYSTEM rather than a single service. It is drawn from the audit trail,
         which is the only store every part of the system writes to: the web
         MIS, the mobile app and the database triggers alike. Counting rows in
         any one service table could only ever describe that service. -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">Site Activity</div>
        <div class="gis-heat-controls" style="margin:0">
          <!-- Three months is as far back as this chart looks. Past that the
               question is a retention one, answered by the Audit Logs page and
               the Archive, not by a trend line — and a 12-month bar chart of a
               trail the barangay clears periodically draws mostly the gaps. -->
          <select class="gis-filter-select" id="dash-activity-range" onchange="setDashActivityRange(this.value)">
            <option value="14">Last 2 weeks</option>
            <option value="30">Last month</option>
            <option value="90" selected>Last 3 months</option>
          </select>
          <!-- Grouping is chosen, not inferred. Weekly over three months is
               the default because it is the window where a barangay trend is
               actually legible: daily is too noisy to see a direction in, and
               monthly gives three bars. -->
          <select class="gis-filter-select" id="dash-activity-unit" onchange="setDashActivityUnit(this.value)">
            <option value="day">By day</option>
            <option value="week" selected>By week</option>
            <option value="month">By month</option>
          </select>
          <!-- The database triggers log one entry per changed row, so a bulk
               import or a migration buries every human action under a single
               column thousands high. This is the switch back to "what did
               people actually do" without pretending the rest didn't happen. -->
          <select class="gis-filter-select" id="dash-activity-scope" onchange="setDashActivityScope(this.value)">
            <option value="all" selected>All activity</option>
            <option value="people">Staff &amp; resident actions</option>
          </select>
          <span class="card-action" onclick="nav(null,'audit')">View log</span>
        </div>
      </div>
      <div class="gis-heat-summary" id="dash-activity-summary" style="margin:0 0 var(--space-3)">Loading activity…</div>
      <div class="chart-box chart-box-lg"><canvas id="siteActivityChart"></canvas></div>
    </div>

    <div class="grid-2">
      <!-- What is on the desk right now, per service. The KPIs above count the
           queue; this says which stage each item is stuck at, which is the
           thing an officer can actually act on. -->
      <div class="card">
        <div class="card-header"><div class="card-title">Open Workload by Stage</div></div>
        <div class="gis-heat-summary" id="dash-workload-summary" style="margin:0 0 var(--space-3)"></div>
        <div class="chart-box chart-box-lg"><canvas id="workloadChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Recent Activity</div><span class="card-action" onclick="nav(null,'audit')">View log</span></div>
        <div class="timeline" id="dash-activity">${renderDashActivity()}</div>
      </div>
    </div>

    <div class="grid-2">
      <!-- Requested against issued, week by week: two lines that drift apart
           are a backlog forming, which a single "requests" bar cannot show. -->
      <div class="card">
        <div class="card-header"><div class="card-title">Certificate Requests vs Issued (8 weeks)</div><span class="card-action" onclick="nav(null,'certificates')">View all</span></div>
        <div class="chart-box chart-box-lg"><canvas id="certChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Incidents by Type</div><span class="card-action" onclick="nav(null,'incidents')">View all</span></div>
        <div class="chart-box chart-box-lg"><canvas id="incidentChart"></canvas></div>
      </div>
    </div>

    <div class="grid-2">
      <!-- When the barangay is busy, not just how much. This is the chart that
           decides who is on the counter at 9am and who is on it at 4pm. -->
      <div class="card">
        <div class="card-header"><div class="card-title">Busiest Hours</div></div>
        <p class="modal-help-text">Activity by hour of day, following the range and filter set on Site Activity above.</p>
        <div class="chart-box chart-box-sm"><canvas id="hourChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Activity by Module</div></div>
        <p class="modal-help-text">Which parts of the system the activity above came from.</p>
        <div class="chart-box chart-box-sm"><canvas id="moduleChart"></canvas></div>
      </div>
    </div>
  `);
}

// ── Shared chart plumbing ──────────────────────────────────────────────────
// One palette for the whole dashboard, matching js/pages/analytics.js so a
// reader moving between the two pages does not have to relearn the colours.
const DASH_PALETTE = [
  "#1d4ed8", "#22c55e", "#ef4444", "#f59e0b", "#8b5cf6",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#64748b", "#14b8a6",
];

// Canvases are reused across renders (a range change repaints in place), and
// Chart.js refuses to attach twice to the same canvas.
function dashChart(key, canvasId, config) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || typeof Chart === "undefined") return;
  if (charts[key]) {
    charts[key].destroy();
    delete charts[key];
  }
  charts[key] = new Chart(ctx, config);
}

function dashText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ── KPI row ────────────────────────────────────────────────────────────────
async function loadDashboardStats() {
  let d;
  try {
    d = await apiGet("/api/stats/dashboard");
  } catch (e) {
    // Blank every figure, not just the first: leaving the rest empty makes a
    // failed load look like a barangay with no certificates and no incidents,
    // which is a worse lie than showing nothing.
    [
      "kpi-residents",
      "kpi-certs-issued",
      "kpi-incidents",
      "kpi-pending",
      "kpi-feedback",
      "kpi-households",
    ].forEach((id) => dashText(id, "—"));
    if (typeof showToast === "function")
      showToast("Could not load dashboard figures: " + e.message, "<i data-icon=triangle-alert></i>");
    return;
  }
  const certs = d.certificates_by_status || {};
  dashText("kpi-residents", (d.residents ?? 0).toLocaleString());
  dashText("kpi-certs-issued", (certs.issued ?? 0).toLocaleString());
  dashText("kpi-incidents", (d.incidents_open ?? 0).toLocaleString());
  dashText("kpi-pending", (d.certificates_pending ?? 0).toLocaleString());
  dashText("kpi-feedback", d.feedback_avg != null ? d.feedback_avg.toFixed(1) : "N/A");
  dashText("kpi-households", (d.households ?? 0).toLocaleString());

  dashText(
    "kpi-incidents-sub",
    `${(d.incidents_this_month ?? 0).toLocaleString()} filed this month`,
  );
  dashText("kpi-pending-sub", "Certificates awaiting action");
  dashText(
    "kpi-feedback-sub",
    `${(d.feedback_new ?? 0).toLocaleString()} unread submission${d.feedback_new === 1 ? "" : "s"}`,
  );
  dashText(
    "kpi-residents-sub",
    `${(d.residents_unclaimed ?? 0).toLocaleString()} yet to claim an account`,
  );
}

// ── Site Activity ──────────────────────────────────────────────────────────
// Weekly over three months — see the note beside the selectors.
let DASH_ACTIVITY_RANGE = "90";
let DASH_ACTIVITY_UNIT = "week";
let DASH_ACTIVITY_SCOPE = "all";
// The Busiest Hours and Activity by Module cards are cut from the same
// response, so they follow these selectors without controls of their own.
function setDashActivityRange(v) {
  DASH_ACTIVITY_RANGE = v;
  loadSiteActivity();
}
function setDashActivityUnit(v) {
  DASH_ACTIVITY_UNIT = v;
  loadSiteActivity();
}
function setDashActivityScope(v) {
  DASH_ACTIVITY_SCOPE = v;
  loadSiteActivity();
}

// Bucket starts arrive as ISO instants; label them at the granularity in play,
// so a monthly view reads "Aug 25" and a daily or weekly one "Aug 3". A weekly
// label is the Monday the bucket opens on — the summary line says so, because
// "Aug 3" on its own could as easily mean the day.
function dashSlotLabel(iso, unit) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  if (unit === "month")
    return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const DASH_UNIT_NOUN = { day: "day", week: "week", month: "month" };

async function loadSiteActivity() {
  let d;
  try {
    d = await apiGet(
      `/api/stats/activity?days=${encodeURIComponent(DASH_ACTIVITY_RANGE)}` +
        `&unit=${encodeURIComponent(DASH_ACTIVITY_UNIT)}` +
        `&scope=${encodeURIComponent(DASH_ACTIVITY_SCOPE)}`,
    );
  } catch (e) {
    dashText("dash-activity-summary", "Activity unavailable: " + e.message);
    return;
  }

  const summary = document.getElementById("dash-activity-summary");
  if (summary) {
    if (!d.total) {
      summary.textContent = "No recorded activity in this period.";
    } else {
      const warn = (d.by_level || {}).warning || 0;
      const crit = (d.by_level || {}).critical || 0;
      const noun = DASH_UNIT_NOUN[d.unit] || "period";
      const parts = [
        `<strong>${d.total.toLocaleString()}</strong> ${d.scope === "people" ? "action" : "recorded event"}${d.total === 1 ? "" : "s"}`,
        // Which bars these are. Without it, "Aug 3" on the axis is ambiguous
        // between a day and the week that starts on it.
        `grouped by ${noun} across ${(d.slots || []).length} ${noun}${(d.slots || []).length === 1 ? "" : "s"}`,
      ];
      if (crit) parts.push(`<strong>${crit.toLocaleString()}</strong> critical`);
      if (warn) parts.push(`<strong>${warn.toLocaleString()}</strong> warning${warn === 1 ? "" : "s"}`);
      if (d.busiest_day)
        parts.push(
          `busiest day ${new Date(d.busiest_day.day + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })} (${d.busiest_day.n.toLocaleString()})`,
        );
      summary.innerHTML = parts.join(" · ");
    }
  }

  const labels = (d.slots || []).map((s) => dashSlotLabel(s, d.unit));
  dashChart("siteActivity", "siteActivityChart", {
    type: "bar",
    data: {
      labels,
      datasets: (d.datasets || []).map((set, i) => ({
        label: set.label,
        data: set.data,
        backgroundColor: DASH_PALETTE[i % DASH_PALETTE.length],
        borderRadius: 3,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      // Clicking a legend entry isolates that module — the whole point of
      // stacking rather than drawing six separate cards.
      plugins: { legend: { position: "bottom" } },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          // "By day" over twelve months is 365 columns — readable as a shape,
          // not as 365 labels. Thin the axis rather than the data.
          ticks: { autoSkip: true, maxRotation: 0, maxTicksLimit: 16 },
        },
        // Actions are whole events; a "2.5 actions" gridline means nothing.
        y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });

  // Hour-of-day profile.
  const hours = d.by_hour || [];
  dashChart("hour", "hourChart", {
    type: "bar",
    data: {
      labels: hours.map((h) => {
        const hr = h.hour % 12 === 0 ? 12 : h.hour % 12;
        return `${hr}${h.hour < 12 ? "am" : "pm"}`;
      }),
      datasets: [
        {
          label: "Actions",
          data: hours.map((h) => h.n),
          backgroundColor: "rgba(29,78,216,0.75)",
          borderRadius: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        // 24 labels do not fit; show every third so the axis stays readable.
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });

  // Which module the activity came from.
  const cats = d.by_category || [];
  dashChart("module", "moduleChart", {
    type: "doughnut",
    data: {
      labels: cats.map((c) => DASH_CATEGORY_LABELS[c.category] || c.category),
      datasets: [
        {
          data: cats.map((c) => c.n),
          backgroundColor: cats.map((_, i) => DASH_PALETTE[i % DASH_PALETTE.length]),
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "right", labels: { font: { size: 11 } } } },
    },
  });
}

// audit_log.category is a machine vocabulary; these are the names the modules
// carry in the sidebar. Anything unmapped falls through to its raw value.
const DASH_CATEGORY_LABELS = {
  database: "Record changes",
  auth: "Sign-ins",
  certificate: "Certificates",
  concern: "Blotter",
  incident: "Blotter",
  feedback: "Feedback",
  resident: "Residency",
  settings: "Site Content",
  archive: "Archive",
  map: "GIS Map",
  ai: "AI",
  system: "System",
};

// ── Officer operations ─────────────────────────────────────────────────────
// The stage vocabulary each service uses, in the order work moves through it,
// with the colour saying whether that stage is waiting on staff (amber/red) or
// already dealt with (green/grey).
const DASH_WORKLOAD = [
  {
    label: "Certificates",
    field: "certificates_by_status",
    stages: [
      ["pending", "Pending", "#f59e0b"],
      ["approved", "Approved", "#06b6d4"],
      ["issued", "Issued", "#22c55e"],
      ["rejected", "Rejected", "#94a3b8"],
    ],
  },
  {
    label: "Incidents",
    field: "incidents_by_status",
    stages: [
      ["open", "Open", "#ef4444"],
      ["under-review", "Under review", "#f59e0b"],
      ["resolved", "Resolved", "#22c55e"],
      ["dismissed", "Dismissed", "#94a3b8"],
    ],
  },
  {
    label: "Feedback",
    field: "feedback_by_status",
    stages: [
      ["new", "New", "#f59e0b"],
      ["reviewed", "Reviewed", "#22c55e"],
    ],
  },
];

async function loadOperations() {
  let d;
  try {
    d = await apiGet("/api/stats/operations");
  } catch (e) {
    dashText("dash-workload-summary", "Workload unavailable: " + e.message);
    return;
  }

  // ── Open Workload by Stage ──
  // One horizontal stacked bar per service. Stage names are not shared between
  // services ("pending" vs "open"), so each stage is its own dataset pinned to
  // a single row — that is what keeps the legend honest.
  const rows = DASH_WORKLOAD.map((s) => s.label);
  const datasets = [];
  DASH_WORKLOAD.forEach((service, rowIndex) => {
    const counts = d[service.field] || {};
    service.stages.forEach(([key, label, color]) => {
      const data = new Array(rows.length).fill(0);
      data[rowIndex] = counts[key] || 0;
      if (!data[rowIndex]) return; // an empty stage adds a legend entry and no bar
      datasets.push({
        label: `${service.label}: ${label}`,
        data,
        backgroundColor: color,
        borderRadius: 3,
      });
    });
  });

  dashChart("workload", "workloadChart", {
    type: "bar",
    data: { labels: rows, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            // The dataset label already names the service, which the row does
            // too — show just the stage and the count.
            label: (c) => `${c.dataset.label.split(": ")[1]}: ${c.parsed.x}`,
          },
        },
      },
      scales: {
        x: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
        y: { stacked: true, grid: { display: false } },
      },
    },
  });

  // The line under the title: how long work is taking and what has gone stale.
  const t = d.turnaround || {};
  const age = d.aging || {};
  const bits = [];
  if (t.cert_days != null)
    bits.push(`Certificates take <strong>${t.cert_days}</strong> day${t.cert_days === 1 ? "" : "s"} on average`);
  if (t.incident_days != null)
    bits.push(`incidents <strong>${t.incident_days}</strong> day${t.incident_days === 1 ? "" : "s"}`);
  if (age.certs_overdue)
    bits.push(`<strong>${age.certs_overdue}</strong> request${age.certs_overdue === 1 ? "" : "s"} waiting over 3 days`);
  if (age.incidents_overdue)
    bits.push(`<strong>${age.incidents_overdue}</strong> incident${age.incidents_overdue === 1 ? "" : "s"} open over a week`);
  const wl = document.getElementById("dash-workload-summary");
  if (wl) wl.innerHTML = bits.length ? bits.join(" · ") : "Nothing outstanding.";

  // ── Certificates requested vs issued ──
  const weekly = d.certificates_weekly || [];
  dashChart("cert", "certChart", {
    type: "line",
    data: {
      labels: weekly.map((w) => w.label),
      datasets: [
        {
          label: "Requested",
          data: weekly.map((w) => w.requested),
          borderColor: "#c9a227",
          backgroundColor: "rgba(201,162,39,0.16)",
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 3,
        },
        {
          label: "Issued",
          data: weekly.map((w) => w.issued),
          borderColor: "#22c55e",
          backgroundColor: "rgba(34,197,94,0.12)",
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "bottom" } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });

  // ── Incidents by type ──
  // Reuses the Analytics page's label table when that file is loaded; on the
  // dashboard it is not, so fall back to the raw key title-cased.
  const inc = d.incident_by_type || [];
  const typeLabel = (k) =>
    (typeof INCIDENT_TYPE_LABELS !== "undefined" && INCIDENT_TYPE_LABELS[k]) ||
    String(k || "other").replace(/(^|-)(\w)/g, (_, sep, c) => (sep ? " " : "") + c.toUpperCase());
  dashChart("inc", "incidentChart", {
    type: "doughnut",
    data: {
      labels: inc.map((r) => typeLabel(r.type)),
      datasets: [
        {
          data: inc.map((r) => r.n),
          backgroundColor: inc.map((_, i) => DASH_PALETTE[i % DASH_PALETTE.length]),
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "right", labels: { font: { size: 11 } } } },
    },
  });
}
