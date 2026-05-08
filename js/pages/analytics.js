// js/pages/analytics.js
window.CURRENT_PAGE = "analytics";

function renderPage() {
  renderAnalytics();
}

function renderAnalytics() {
  setContent(`
    <div class="page-header"><h2 class="page-title">Analytics</h2><p class="page-desc">Predictive insights and trend analysis for data-driven governance</p></div>
    <div class="kpi-grid">
      <div class="kpi-card success"><div class="kpi-label">Population Growth Rate</div><div class="kpi-value">2.3%</div><div class="kpi-trend">vs 1.8% national avg</div></div>
      <div class="kpi-card info"><div class="kpi-label">Certificate Efficiency</div><div class="kpi-value">94%</div><div class="kpi-trend">On-time issuance rate</div></div>
      <div class="kpi-card"><div class="kpi-label">Incident Resolution Rate</div><div class="kpi-value">87%</div><div class="kpi-trend">Within 30 days</div></div>
      <div class="kpi-card warning"><div class="kpi-label">Feedback Response Rate</div><div class="kpi-value">68%</div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title">Monthly Certificate Volume (2025)</div></div>
        <div class="chart-box chart-box-lg"><canvas id="analyticsChart1"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Incident Types Distribution</div></div>
        <div class="chart-box chart-box-lg"><canvas id="analyticsChart2"></canvas></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">AI Predictive Insights</div></div>
      <div class="grid-2">
        ${[
          ["🌧️","Flood Risk Forecast",
           "Based on historical flood data and current rainfall patterns, Purok 3 has a <strong>72% probability</strong> of minor flooding within the next 2 weeks.",
           "badge-danger","High Risk"],
          ["📈","Population Projection",
           "At current growth rate, barangay population is projected to reach <strong>5,890 by end of 2025</strong>, requiring 45 additional household registrations.",
           "badge-info","Projected"],
          ["📄","Certificate Demand",
           "AI model predicts a <strong>23% surge</strong> in barangay clearance requests during May–June, coinciding with graduation and employment seasons.",
           "badge-warning","Trend Alert"],
          ["⭐","Service Quality Trend",
           "Resident satisfaction is trending upward. Model forecasts rating reaching <strong>4.5 by Q3 2025</strong> if current service improvements continue.",
           "badge-success","Positive"],
        ]
          .map(([icon, title, desc, badge, label]) => `
          <div class="insight-card">
            <div class="insight-head">
              <span class="insight-icon">${icon}</span>
              <div>
                <div class="insight-title">${title}</div>
                <span class="badge ${badge} insight-badge">${label}</span>
              </div>
            </div>
            <p class="insight-desc">${desc}</p>
          </div>`)
          .join("")}
      </div>
    </div>
  `);

  setTimeout(() => {
    const c1 = document.getElementById("analyticsChart1");
    if (c1)
      charts.a1 = new Chart(c1, {
        type: "line",
        data: {
          labels: ["Jan", "Feb", "Mar", "Apr", "May"],
          datasets: [{
            label: "Certificates",
            data: [62, 71, 84, 79, 87],
            borderColor: "#c9a227",
            backgroundColor: "rgba(201,162,39,0.1)",
            fill: true,
            tension: 0.4,
            pointRadius: 4,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: false }, x: { grid: { display: false } } },
        },
      });

    const c2 = document.getElementById("analyticsChart2");
    if (c2)
      charts.a2 = new Chart(c2, {
        type: "bar",
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
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true }, x: { grid: { display: false } } },
        },
      });
  }, 100);
}
