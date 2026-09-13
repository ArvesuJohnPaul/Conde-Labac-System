// js/pages/analytics.js — descriptive statistics + trend charts, all from
// live data (GET /api/stats/analytics). No more hardcoded numbers.
window.CURRENT_PAGE = "analytics";

const INCIDENT_TYPE_LABELS = {
  noise: "Noise",
  dispute: "Dispute",
  altercation: "Altercation",
  theft: "Theft",
  vandalism: "Vandalism",
  domestic: "Domestic",
  flooding: "Flooding",
  vehicular: "Vehicular",
  fire: "Fire",
  medical: "Medical",
  other: "Other",
};

const CERT_TYPE_LABELS = {
  "barangay-clearance": "Brgy Clearance",
  indigency: "Indigency",
  residency: "Residency",
  "solo-parent": "Solo Parent",
  "good-moral": "Good Moral",
  "business-clearance": "Business Clearance",
};

const CHART_PALETTE = [
  "#1d4ed8", "#22c55e", "#ef4444", "#f59e0b", "#8b5cf6",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#64748b", "#14b8a6",
];

function renderPage() {
  renderAnalytics();
  loadAnalytics();
}

function renderAnalytics() {
  setContent(`
    <div class="page-header"><h2 class="page-title">Analytics</h2><p class="page-desc">Descriptive statistics and trend charts for evidence-based barangay reporting</p></div>
    <div class="kpi-grid">
      <div class="kpi-card success"><div class="kpi-label">Registered Residents</div><div class="kpi-value" id="an-residents">—</div><div class="kpi-trend">Active records</div></div>
      <div class="kpi-card info"><div class="kpi-label">Certificate Efficiency</div><div class="kpi-value" id="an-cert-eff">—</div><div class="kpi-trend">Issued of all requests</div></div>
      <div class="kpi-card"><div class="kpi-label">Incident Resolution Rate</div><div class="kpi-value" id="an-inc-res">—</div><div class="kpi-trend">Resolved or dismissed</div></div>
      <div class="kpi-card warning"><div class="kpi-label">Average Satisfaction Score</div><div class="kpi-value" id="an-sat">—</div><div class="kpi-trend">From citizen feedback</div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title">Monthly Service Requests (Frequency)</div></div>
        <div class="chart-box chart-box-lg"><canvas id="analyticsChart1"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Incident Types (Percentage Composition)</div></div>
        <div class="chart-box chart-box-lg"><canvas id="analyticsChart2"></canvas></div>
      </div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title">Certificate Type Distribution</div></div>
        <div class="chart-box chart-box-lg"><canvas id="analyticsChart3"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Citizen Satisfaction Ratings (Likert Scale)</div></div>
        <div class="chart-box chart-box-lg"><canvas id="analyticsChart4"></canvas></div>
      </div>
    </div>

    <!-- Paired side by side so they match the other charts in BOTH dimensions:
         full-width cards made these two read as a different, more important
         class of thing than the four above. -->
    <div class="grid-2">
    <!-- When, not just how many. Built from the same report store the map and
         the blotter read, so the three can never disagree. Bucketing follows
         the range: days for a short window, months for a long one — 365 daily
         points would be unreadable noise. -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">Incident Activity</div>
        <div class="gis-heat-controls" style="margin:0">
          <select class="gis-filter-select" id="activity-range" onchange="setActivityRange(this.value)">
            <option value="30">Last 30 days</option>
            <option value="90" selected>Last 90 days</option>
            <option value="180">Last 6 months</option>
            <option value="365">Last 12 months</option>
            <option value="all">All time</option>
          </select>
          <select class="gis-filter-select" id="activity-type" onchange="setActivityType(this.value)">
            <option value="all">All incident types</option>
          </select>
        </div>
      </div>
      <div class="gis-heat-summary" id="activity-summary" style="margin:0 0 var(--space-3)"></div>
      <div class="chart-box chart-box-lg"><canvas id="activityChart"></canvas></div>
    </div>

    <!-- Where, not just how many. The charts above count incidents; this one
         says which corner of the barangay keeps producing them, which is the
         number that actually decides where a streetlight or a patrol goes. -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">Incident Hotspots</div>
        <button class="btn btn-sm btn-outline" onclick="nav(null, 'gis')"><i data-icon=map></i> Open Full Map</button>
      </div>
      <p class="modal-help-text">Where reports cluster. Counts every report on record — <strong>open, under review and resolved alike</strong> — because a spot that produced ten incidents is a hotspot whether or not the paperwork was closed.</p>
      <div class="gis-heat-controls">
        <select class="gis-filter-select" id="heat-type" onchange="setHeatmapType(this.value)">
          <option value="all">All incident types</option>
        </select>
        <button type="button" class="gis-filter-toggle" id="heat-layers-btn"
                onclick="toggleHeatBaseLayers(this)" aria-pressed="false">${typeof gisIcon === "function" ? gisIcon("layers") : ""} <span id="heat-layers-label">Show map details</span></button>
        <div class="gis-heat-summary" id="heat-summary">Loading map…</div>
      </div>
      <!-- Starts bare: the base layers are added back only on request. -->
      <div class="gis-heat-map gis-heat-bare" id="analytics-heatmap"></div>
      <div class="gis-heat-legend">
        <span>Fewer reports</span>
        <div class="gis-heat-scale" id="heat-scale"></div>
        <span>More reports</span>
        <span class="gis-heat-legend-cap" id="heat-peak"></span>
      </div>
    </div>
    </div>
  `);
  initHeatmap();
  initActivityChart();
}

// ── Incident activity over time ────────────────────────────────────────────
// Fed by gisAllCommunityReports — the same store behind the map pins and the
// blotter — so this chart cannot drift from either.
let ACTIVITY_RANGE = "90";
let ACTIVITY_TYPE = "all";

function initActivityChart() {
  const sel = document.getElementById("activity-type");
  if (sel && typeof GIS_REPORT_TYPE_META !== "undefined") {
    sel.innerHTML =
      `<option value="all">All incident types</option>` +
      Object.entries(GIS_REPORT_TYPE_META)
        .map(([key, m]) => `<option value="${key}">${m.label}</option>`)
        .join("");
  }
  renderActivityChart();
  // The local snapshot paints first; repaint once the shared pull lands so a
  // first visit is not drawn from whatever this browser had cached.
  if (typeof gisSyncCommunityReports === "function")
    gisSyncCommunityReports().then(renderActivityChart);
}

function setActivityRange(v) {
  ACTIVITY_RANGE = v;
  renderActivityChart();
}
function setActivityType(v) {
  ACTIVITY_TYPE = v;
  renderActivityChart();
}

// Bucket width follows the range: a 12-month window plotted daily is 365
// points of mostly zeroes, which hides the trend rather than showing it.
function activityBuckets(days) {
  if (days === null || days > 300) return { unit: "month", count: 12 };
  if (days > 120) return { unit: "month", count: 6 };
  if (days > 45) return { unit: "week", count: Math.ceil(days / 7) };
  return { unit: "day", count: days };
}

function activityBucketKey(d, unit) {
  if (unit === "month") return d.getFullYear() + "-" + d.getMonth();
  if (unit === "week") {
    // Monday-anchored week key.
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
    return t.getFullYear() + "-" + t.getMonth() + "-" + t.getDate();
  }
  return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
}

function activityBucketLabel(d, unit) {
  if (unit === "month")
    return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderActivityChart() {
  const ctx = document.getElementById("activityChart");
  if (!ctx || typeof Chart === "undefined") return;

  const all = typeof gisAllCommunityReports === "function" ? gisAllCommunityReports() : [];
  const days = ACTIVITY_RANGE === "all" ? null : Number(ACTIVITY_RANGE);
  const { unit, count } = activityBuckets(days);

  // Build the empty timeline first so quiet periods show as zero rather than
  // vanishing — a gap in the line would read as "no data", not "no incidents".
  const now = new Date();
  const slots = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now);
    if (unit === "month") d.setMonth(d.getMonth() - i);
    else if (unit === "week") d.setDate(d.getDate() - i * 7);
    else d.setDate(d.getDate() - i);
    slots.push(d);
  }
  const index = new Map();
  slots.forEach((d, i) => index.set(activityBucketKey(d, unit), i));

  const filed = new Array(slots.length).fill(0);
  const resolved = new Array(slots.length).fill(0);
  let total = 0;

  all.forEach((r) => {
    if (ACTIVITY_TYPE !== "all" && r.reportType !== ACTIVITY_TYPE) return;
    if (r.createdAt) {
      const i = index.get(activityBucketKey(new Date(r.createdAt), unit));
      if (i !== undefined) {
        filed[i]++;
        total++;
      }
    }
    if (r.resolved && r.resolvedAt) {
      const i = index.get(activityBucketKey(new Date(r.resolvedAt), unit));
      if (i !== undefined) resolved[i]++;
    }
  });

  const summary = document.getElementById("activity-summary");
  if (summary) {
    const label =
      ACTIVITY_TYPE === "all"
        ? "report"
        : ((typeof GIS_REPORT_TYPE_META !== "undefined" &&
            GIS_REPORT_TYPE_META[ACTIVITY_TYPE]?.label) ||
            "report");
    summary.innerHTML = total
      ? `<strong>${total.toLocaleString()}</strong> ${label.toLowerCase()}${total === 1 ? "" : "s"} filed in this period`
      : "No reports filed in this period.";
  }

  if (charts.activity) {
    charts.activity.destroy();
    delete charts.activity;
  }
  charts.activity = new Chart(ctx, {
    type: "line",
    data: {
      labels: slots.map((d) => activityBucketLabel(d, unit)),
      datasets: [
        {
          label: "Filed",
          data: filed,
          borderColor: "#ef4444",
          backgroundColor: "rgba(239,68,68,0.14)",
          fill: true,
          tension: 0.35,
          pointRadius: unit === "day" ? 0 : 3,
          pointHoverRadius: 5,
          borderWidth: 2,
        },
        {
          label: "Resolved",
          data: resolved,
          borderColor: "#22c55e",
          backgroundColor: "rgba(34,197,94,0.12)",
          fill: true,
          tension: 0.35,
          pointRadius: unit === "day" ? 0 : 3,
          pointHoverRadius: 5,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "bottom" } },
      scales: {
        // Counts are whole reports — a "2.5 incidents" gridline is meaningless.
        y: { beginAtZero: true, ticks: { precision: 0 } },
        x: { grid: { display: false } },
      },
    },
  });
}

// ── Incident hotspot heat map ──────────────────────────────────────────────
// Reuses the GIS engine rather than drawing a second map: it already has the
// boundary, the projection, the base layers and the pan/zoom, and — more to
// the point — it is fed by the same report store as the pins on the GIS page,
// so the two can never disagree about where an incident happened.
let heatmapInstance = null;

async function initHeatmap() {
  // Type filter, built from the engine's own dictionary so a new report type
  // appears here without touching this file.
  const sel = document.getElementById("heat-type");
  if (sel && typeof GIS_REPORT_TYPE_META !== "undefined") {
    sel.innerHTML =
      `<option value="all">All incident types</option>` +
      Object.entries(GIS_REPORT_TYPE_META)
        .map(([key, m]) => `<option value="${key}">${m.label}</option>`)
        .join("");
  }
  const scale = document.getElementById("heat-scale");
  if (scale && typeof gisHeatGradientCss === "function")
    scale.style.background = gisHeatGradientCss();

  if (typeof initGisMap !== "function") return;
  heatmapInstance = await initGisMap("analytics-heatmap", {
    heatmap: true,
    // No filter row, no legend overlay — the card supplies both, and the map
    // itself should be nothing but the barangay and the cloud.
    minimal: true,
  });
  // Boundary data unreachable — initGisMap has already written its own error
  // into the container, so just make the summary line stop saying "Loading".
  if (!heatmapInstance) {
    const el = document.getElementById("heat-summary");
    if (el) el.textContent = "Map unavailable.";
    return;
  }
  updateHeatSummary();

  // init paints from the local snapshot; the shared-DB pull lands after it.
  // Wait for the report sync, repaint, and relabel — otherwise a first visit
  // shows a cloud built from whatever this browser happened to have cached.
  if (typeof gisSyncCommunityReports === "function") {
    await gisSyncCommunityReports();
    heatmapInstance.refreshAll();
    updateHeatSummary();
  }
  // gisSyncMapState() (base layers + legacy accident markers) resolves on its
  // own schedule inside initGisMap and repaints when it does; one late pass
  // catches the label up with it.
  setTimeout(updateHeatSummary, 1500);
}

function setHeatmapType(type) {
  if (!heatmapInstance) return;
  heatmapInstance.setHeatType(type);
  updateHeatSummary();
}

// Streets and buildings underneath compete with the cloud, so they start off.
// This puts them back for anyone who needs to place a cluster against a
// landmark. Purely a CSS class — nothing is re-rendered.
function toggleHeatBaseLayers(btn) {
  const el = document.getElementById("analytics-heatmap");
  if (!el) return;
  const nowBare = el.classList.toggle("gis-heat-bare");
  // Only the label swaps — replacing the button's whole contents would drop
  // the icon with it.
  const label = document.getElementById("heat-layers-label");
  if (label) label.textContent = nowBare ? "Show map details" : "Hide map details";
  if (btn) btn.setAttribute("aria-pressed", nowBare ? "false" : "true");
}

// The box is a fixed height matching .chart-box-lg (see css/gis.css), so the
// hotspot card lines up with every other chart on the page. The engine's own
// computeFitZoom() scales the boundary to whatever box it is given, with
// GIS_FIT_MARGIN keeping it off the edges — so no sizing maths is needed here.

function updateHeatSummary() {
  if (!heatmapInstance) return;
  // refreshAll() may have repainted the cloud since the last setHeatType, so
  // read the engine's summary rather than caching one here.
  const s = heatmapInstance.getHeatSummary();
  const summaryEl = document.getElementById("heat-summary");
  const peakEl = document.getElementById("heat-peak");
  if (summaryEl) {
    summaryEl.innerHTML = s.total
      ? `<strong>${s.total.toLocaleString()}</strong> report${s.total === 1 ? "" : "s"} across <strong>${s.cells.toLocaleString()}</strong> area${s.cells === 1 ? "" : "s"}`
      : "No reports of this type have been filed yet.";
  }
  if (peakEl)
    peakEl.textContent = s.max ? `Peak: ${s.max} in one area` : "";
}

async function loadAnalytics() {
  let d;
  try {
    d = await apiGet("/api/stats/analytics");
  } catch (e) {
    if (typeof showToast === "function")
      showToast("Could not load analytics: " + e.message, "<i data-icon=triangle-alert></i>");
    return;
  }

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setText("an-residents", (d.residents ?? 0).toLocaleString());
  setText("an-cert-eff", `${d.cert_efficiency ?? 0}%`);
  setText("an-inc-res", `${d.incident_resolution_rate ?? 0}%`);
  setText("an-sat", d.satisfaction_avg != null ? `${d.satisfaction_avg}/5` : "N/A");

  buildAnalyticsCharts(d);
}

function buildAnalyticsCharts(d) {
  if (typeof Chart === "undefined") return;
  // Tear down any charts from a previous render so canvases are reusable.
  ["a1", "a2", "a3", "a4"].forEach((k) => {
    if (charts[k]) {
      charts[k].destroy();
      delete charts[k];
    }
  });

  const monthly = d.monthly || [];
  const gridOpts = {
    responsive: true,
    maintainAspectRatio: false,
    scales: { y: { beginAtZero: true }, x: { grid: { display: false } } },
  };

  // 1 ─ Monthly service requests: certificates + incidents + feedback, stacked.
  const c1 = document.getElementById("analyticsChart1");
  if (c1)
    charts.a1 = new Chart(c1, {
      type: "bar",
      data: {
        labels: monthly.map((m) => m.label),
        datasets: [
          { label: "Certificates", data: monthly.map((m) => m.certificates), backgroundColor: "rgba(201,162,39,0.8)" },
          { label: "Incidents", data: monthly.map((m) => m.incidents), backgroundColor: "rgba(239,68,68,0.75)" },
          { label: "Feedback", data: monthly.map((m) => m.feedback), backgroundColor: "rgba(29,78,216,0.7)" },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true } },
      },
    });

  // 2 ─ Incident types (doughnut).
  const inc = d.incident_by_type || [];
  const c2 = document.getElementById("analyticsChart2");
  if (c2)
    charts.a2 = new Chart(c2, {
      type: "doughnut",
      data: {
        labels: inc.map((r) => INCIDENT_TYPE_LABELS[r.type] || r.type),
        datasets: [{ data: inc.map((r) => r.n), backgroundColor: inc.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]) }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "right" } },
      },
    });

  // 3 ─ Certificate type distribution (horizontal bar).
  const cert = d.certificate_by_type || [];
  const c3 = document.getElementById("analyticsChart3");
  if (c3)
    charts.a3 = new Chart(c3, {
      type: "bar",
      data: {
        labels: cert.map((r) => CERT_TYPE_LABELS[r.type] || r.type),
        datasets: [{ label: "Requests", data: cert.map((r) => r.n), backgroundColor: cert.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]) }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true }, y: { grid: { display: false } } },
      },
    });

  // 4 ─ Satisfaction ratings (Likert 1–5).
  const sat = d.satisfaction_by_rating || [];
  const ratingColors = ["#dc2626", "#f97316", "#eab308", "#22c55e", "#15803d"];
  const c4 = document.getElementById("analyticsChart4");
  if (c4)
    charts.a4 = new Chart(c4, {
      type: "bar",
      data: {
        labels: sat.map((r) => `${r.rating} ★`),
        datasets: [{ label: "Responses", data: sat.map((r) => r.n), backgroundColor: sat.map((r) => ratingColors[r.rating - 1] || "#64748b") }],
      },
      options: { ...gridOpts, plugins: { legend: { display: false } } },
    });
}
