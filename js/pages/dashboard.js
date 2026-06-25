// js/pages/dashboard.js
window.CURRENT_PAGE = "dashboard";

function renderPage() {
  renderDashboard();
}

function renderDashboard() {
  setContent(`
    <div class="page-header">
      <h2 class="page-title">Good morning, ${currentRole === "Officer" ? "Officer Reyes" : "Administrator"}! 👋</h2>
      <p class="page-desc">Here's what's happening in Barangay Conde Labac today</p>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Registered Households</div><div class="kpi-value">1,248</div><div class="kpi-trend"><span class="up">↑ +23</span> this month</div></div>
      <div class="kpi-card success"><div class="kpi-label">Certificates Issued</div><div class="kpi-value">87</div><div class="kpi-trend"><span class="up">↑ +12%</span> vs last month</div></div>
      <div class="kpi-card danger"><div class="kpi-label">Active Incidents</div><div class="kpi-value">3</div><div class="kpi-trend"><span class="dn">↑ +2</span> this week</div></div>
      <div class="kpi-card info"><div class="kpi-label">Pending Requests</div><div class="kpi-value">19</div><div class="kpi-trend"><span class="dn">−5</span> resolved today</div></div>
      <div class="kpi-card"><div class="kpi-label">Feedback Score</div><div class="kpi-value">4.2</div><div class="kpi-trend"><span class="up">↑ 0.3</span> vs last quarter</div></div>
      <div class="kpi-card"><div class="kpi-label">Resident Population</div><div class="kpi-value">5,612</div><div class="kpi-trend">Last census: Jan 2025</div></div>
    </div>

    <div class="alert alert-danger"><span class="alert-icon">⚠</span><div><strong>Critical Incident:</strong> Flooding reported at Purok 3 — Sitio Malinis. 14 families affected. Response team dispatched.</div></div>
    <div class="alert alert-warning"><span class="alert-icon">⚑</span><div><strong>12 pending account claims</strong> require document verification before approval.</div></div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title">Certificate Requests (30 days)</div><span class="card-action" onclick="nav(null,'certificates')">View all</span></div>
        <div class="chart-box chart-box-lg"><canvas id="certChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Recent Activity</div><span class="card-action" onclick="nav(null,'audit')">View log</span></div>
        <div class="timeline">
          ${[
            [
              "green",
              "Barangay Clearance issued — Pedro Santos",
              "Today, 10:45 AM · Officer Reyes",
            ],
            [
              "red",
              "Incident #INC-2025-041 logged — Flooding, Purok 3",
              "Today, 09:12 AM · System",
            ],
            [
              "green",
              "Account claim approved — Maria dela Cruz",
              "Today, 08:55 AM · Admin",
            ],
            [
              "gray",
              "Certificate request submitted — Jose Reyes",
              "Yesterday, 4:30 PM · Self-service",
            ],
            [
              "gray",
              "Feedback received — 4★ rating, Barangay Services",
              "Yesterday, 3:12 PM · Anonymous",
            ],
          ]
            .map(
              ([dot, title, meta]) => `
            <div class="timeline-item">
              <div class="timeline-dot ${dot}"></div>
              <div class="timeline-body"><div class="timeline-title">${title}</div><div class="timeline-meta">${meta}</div></div>
            </div>`,
            )
            .join("")}
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title">Services Quick Access</div></div>
        <div class="quick-access-grid">
          ${[
            ["🏘️", "Residency", "residency"],
            ["📄", "Certificates", "certificates"],
            ["🚨", "Blotter", "incidents"],
            ["💬", "Feedback", "feedback"],
            ["🗺️", "GIS Map", "gis"],
            ["🔑", "Account Claiming", "accounts"],
          ]
            .map(
              ([icon, label, mod]) => `
            <button class="quick-access-btn" onclick="openServicePopup('${mod}')">
              <span class="quick-access-icon">${icon}</span> ${label}
            </button>`,
            )
            .join("")}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Incident Heatmap by Purok</div></div>
        <div class="chart-box chart-box-sm"><canvas id="incidentChart"></canvas></div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card ai-card">
        <div class="card-header"><div class="card-title">AI Summaries</div><span class="card-action" onclick="generateAiSummary('dashboard')">Generate</span></div>
        <div class="card-body">
          <p id="ai-summary-text" class="ai-summary-text">No summary generated yet. Use the Generate button to request an AI-assisted summary of incidents and feedback.</p>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Quick Actions</div></div>
        <div class="card-body">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary" onclick="nav(null,'residency')">Open Residency</button>
            <button class="btn btn-outline" onclick="nav(null,'gis')">Open GIS Map</button>
            <button class="btn btn-outline" onclick="nav(null,'analytics')">Open Analytics</button>
          </div>
        </div>
      </div>
    </div>
  `);

  setTimeout(() => {
    const certCtx = document.getElementById("certChart");
    if (certCtx) {
      charts.cert = new Chart(certCtx, {
        type: "bar",
        data: {
          labels: ["Wk 1", "Wk 2", "Wk 3", "Wk 4"],
          datasets: [
            {
              label: "Certificates Issued",
              data: [18, 24, 21, 24],
              backgroundColor: "rgba(201,162,39,0.7)",
              borderColor: "#c9a227",
              borderWidth: 1.5,
              borderRadius: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, grid: { color: "rgba(0,0,0,.05)" } },
            x: { grid: { display: false } },
          },
        },
      });
    }
    const incCtx = document.getElementById("incidentChart");
    if (incCtx) {
      charts.inc = new Chart(incCtx, {
        type: "doughnut",
        data: {
          labels: ["Purok 1", "Purok 2", "Purok 3", "Purok 4", "Purok 5"],
          datasets: [
            {
              data: [4, 7, 12, 3, 6],
              backgroundColor: [
                "#3b82f6",
                "#22c55e",
                "#ef4444",
                "#f59e0b",
                "#8b5cf6",
              ],
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "right", labels: { font: { size: 11 } } },
          },
        },
      });
    }
  }, 100);
}
