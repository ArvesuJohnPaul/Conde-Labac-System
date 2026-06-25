// js/pages/analytics.js
window.CURRENT_PAGE = "analytics";

function renderPage() {
  renderAnalytics();
}

function renderAnalytics() {
  setContent(`
    <div class="page-header"><h2 class="page-title">Analytics</h2><p class="page-desc">Descriptive statistics and trend charts for evidence-based barangay reporting</p></div>
    <div class="kpi-grid">
      <div class="kpi-card success"><div class="kpi-label">Registered Residents</div><div class="kpi-value">5,742</div><div class="kpi-trend">As of May 2026</div></div>
      <div class="kpi-card info"><div class="kpi-label">Certificate Efficiency</div><div class="kpi-value">94%</div><div class="kpi-trend">On-time issuance rate</div></div>
      <div class="kpi-card"><div class="kpi-label">Incident Resolution Rate</div><div class="kpi-value">87%</div><div class="kpi-trend">Within 30 days</div></div>
      <div class="kpi-card warning"><div class="kpi-label">Average Satisfaction Score</div><div class="kpi-value">4.2/5</div><div class="kpi-trend">From citizen feedback forms</div></div>
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
  `);

  setTimeout(() => {
    const c1 = document.getElementById("analyticsChart1");
    if (c1)
      charts.a1 = new Chart(c1, {
        type: "bar",
        data: {
          labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
          datasets: [{
            label: "Total Requests",
            data: [118, 126, 132, 124, 139, 145],
            backgroundColor: "rgba(201,162,39,0.7)",
            borderColor: "#c9a227",
            borderWidth: 1.5,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true }, x: { grid: { display: false } } },
        },
      });

    const c2 = document.getElementById("analyticsChart2");
    if (c2)
      charts.a2 = new Chart(c2, {
        type: "doughnut",
        data: {
          labels: ["Noise","Property","Physical","Theft","Vandalism","Flooding","Other"],
          datasets: [{
            data: [28, 22, 15, 18, 12, 19, 8],
            backgroundColor: ["#3b82f6","#22c55e","#ef4444","#f59e0b","#8b5cf6","#06b6d4","#6b7280"],
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "bottom" },
          },
        },
      });

    const c3 = document.getElementById("analyticsChart3");
    if (c3)
      charts.a3 = new Chart(c3, {
        type: "bar",
        data: {
          labels: ["Barangay Clearance", "Residency", "Indigency", "Business Permit", "Others"],
          datasets: [{
            label: "Count",
            data: [210, 168, 124, 96, 54],
            backgroundColor: ["#1d4ed8", "#0891b2", "#16a34a", "#f59e0b", "#64748b"],
          }],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { x: { beginAtZero: true }, y: { grid: { display: false } } },
        },
      });

    const c4 = document.getElementById("analyticsChart4");
    if (c4)
      charts.a4 = new Chart(c4, {
        type: "bar",
        data: {
          labels: ["1 - Very Dissatisfied", "2 - Dissatisfied", "3 - Neutral", "4 - Satisfied", "5 - Very Satisfied"],
          datasets: [{
            label: "Responses",
            data: [8, 16, 42, 138, 174],
            backgroundColor: ["#dc2626", "#f97316", "#eab308", "#22c55e", "#15803d"],
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true }, x: { grid: { display: false } } },
        },
      });
  }, 100);
}
