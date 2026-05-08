// js/pages/feedback.js
window.CURRENT_PAGE = "feedback";

function renderPage() {
  renderFeedbackPage();
}

function renderFeedbackPage() {
  setContent(`
    <div class="page-header">
      <h2 class="page-title">Feedback Management</h2>
      <p class="page-desc">Resident sentiment trends and submitted comments</p>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card success"><div class="kpi-label">Avg. Rating</div><div class="kpi-value">4.2★</div><div class="kpi-trend"><span class="up">↑ 0.3</span> vs last quarter</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Submissions</div><div class="kpi-value">284</div></div>
      <div class="kpi-card info"><div class="kpi-label">This Month</div><div class="kpi-value">42</div></div>
      <div class="kpi-card warning"><div class="kpi-label">Unreviewed</div><div class="kpi-value">11</div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title">Sentiment Breakdown</div></div>
        <div class="chart-box chart-box-md"><canvas id="sentChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">By Category</div></div>
        ${[
          ["Barangay Services", 78],
          ["Peace & Order",     52],
          ["Cleanliness",       44],
          ["Infrastructure",    38],
          ["Officials",         32],
          ["Health Services",   40],
        ]
          .map(([cat, n]) => `
          <div class="stat-row"><span class="stat-row-label">${cat}</span><div class="stat-row-bar"><div class="progress-bar"><div class="progress-fill" data-width="${Math.round((n / 78) * 100)}"></div></div></div><span class="stat-row-value">${n}</span></div>`)
          .join("")}
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Recent Feedback</div><button class="btn btn-sm btn-gold" onclick="openServicePopup('feedback')">⊕ Submit Feedback</button></div>
      ${[
        [4, "Barangay Services", "The clearance process was much faster this time. Keep it up!",                                       "Pedro Santos",    "May 2"],
        [5, "Health Services",   "Free medical mission was very helpful for our community. Thank you!",                                "Anonymous",       "May 1"],
        [3, "Infrastructure",    "The streetlights in Purok 2 need repair. Several have been broken for months.",                      "Maria dela Cruz", "Apr 30"],
        [2, "Cleanliness",       "The garbage collection schedule is inconsistent. Please improve.",                                   "Anonymous",       "Apr 29"],
        [5, "Officials",         "Very responsive barangay officials. I was helped immediately with my concern.",                      "Jose Reyes",      "Apr 28"],
      ]
        .map(([r, cat, msg, name, date]) => `
        <div class="feedback-item">
          <div class="feedback-meta">
            <span class="feedback-stars">${"★".repeat(r)}${"☆".repeat(5 - r)}</span>
            <span class="badge badge-gray">${cat}</span>
            <span class="feedback-date">${name} · ${date}</span>
          </div>
          <p class="feedback-msg">${msg}</p>
        </div>`)
        .join("")}
    </div>
  `);

  setTimeout(() => {
    const ctx = document.getElementById("sentChart");
    if (ctx)
      charts.sent = new Chart(ctx, {
        type: "pie",
        data: {
          labels: ["Positive", "Neutral", "Negative"],
          datasets: [{
            data: [62, 24, 14],
            backgroundColor: ["#22c55e", "#94a3b8", "#ef4444"],
            borderWidth: 2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom" } },
        },
      });
  }, 100);
}
