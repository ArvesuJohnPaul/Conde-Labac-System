// js/pages/feedback.js
window.CURRENT_PAGE = "feedback";

const FEEDBACK_PER_PAGE = 10;
let feedbackPage = 1;

function renderPage() {
  renderFeedbackPage();
}

function fbEscape(str) {
  const div = document.createElement("div");
  div.textContent = String(str == null ? "" : str);
  return div.innerHTML;
}

function renderFeedbackPage() {
  const all = window.FeedbackStore ? FeedbackStore.getAll() : [];
  const total = all.length;
  const avg = total
    ? all.reduce((s, f) => s + (Number(f.rating) || 0), 0) / total
    : 0;
  const now = new Date();
  const thisMonth = all.filter((f) => {
    const d = new Date(f.ts);
    return (
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    );
  }).length;
  // Newly submitted (non-seed) entries are treated as "unreviewed".
  const unreviewed = window.FeedbackStore ? FeedbackStore.getStoredCount() : 0;

  setContent(`
    <div class="page-header">
      <h2 class="page-title">Feedback Management</h2>
      <p class="page-desc">Resident sentiment trends and submitted comments</p>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card success"><div class="kpi-label">Avg. Rating</div><div class="kpi-value">${avg.toFixed(1)}<i data-icon=star class=ic-fill></i></div><div class="kpi-trend">${total} submission${total !== 1 ? "s" : ""} total</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Submissions</div><div class="kpi-value">${total}</div></div>
      <div class="kpi-card info"><div class="kpi-label">This Month</div><div class="kpi-value">${thisMonth}</div></div>
      <div class="kpi-card warning"><div class="kpi-label">Unreviewed</div><div class="kpi-value">${unreviewed}</div></div>
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
          ["Peace & Order", 52],
          ["Cleanliness", 44],
          ["Infrastructure", 38],
          ["Officials", 32],
          ["Health Services", 40],
        ]
          .map(([cat, n]) => `
          <div class="stat-row"><span class="stat-row-label">${cat}</span><div class="stat-row-bar"><div class="progress-bar"><div class="progress-fill" data-width="${Math.round((n / 78) * 100)}"></div></div></div><span class="stat-row-value">${n}</span></div>`)
          .join("")}
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Recent Feedback</div><button class="btn btn-sm btn-gold" onclick="openServicePopup('feedback')">⊕ Submit Feedback</button></div>
      <div id="recent-feedback-wrap"></div>
    </div>
  `);

  renderRecentFeedback();

  setTimeout(() => {
    const ctx = document.getElementById("sentChart");
    // Build the sentiment split from actual ratings: 4-5 positive, 3 neutral,
    // 1-2 negative.
    let pos = 0,
      neu = 0,
      neg = 0;
    all.forEach((f) => {
      const r = Number(f.rating) || 0;
      if (r >= 4) pos++;
      else if (r === 3) neu++;
      else neg++;
    });
    if (ctx)
      charts.sent = new Chart(ctx, {
        type: "pie",
        data: {
          labels: ["Positive", "Neutral", "Negative"],
          datasets: [
            {
              data: total ? [pos, neu, neg] : [62, 24, 14],
              backgroundColor: ["#22c55e", "#94a3b8", "#ef4444"],
              borderWidth: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom" } },
        },
      });
  }, 100);
}

// Renders just the paginated Recent Feedback list into #recent-feedback-wrap.
function renderRecentFeedback() {
  const wrap = document.getElementById("recent-feedback-wrap");
  if (!wrap) return;

  const all = window.FeedbackStore ? FeedbackStore.getAll() : [];
  const total = all.length;

  if (!total) {
    wrap.innerHTML =
      '<div class="resident-empty">No feedback submitted yet. Submissions from residents will appear here.</div>';
    return;
  }

  const pages = Math.max(1, Math.ceil(total / FEEDBACK_PER_PAGE));
  if (feedbackPage > pages) feedbackPage = pages;
  if (feedbackPage < 1) feedbackPage = 1;
  const start = (feedbackPage - 1) * FEEDBACK_PER_PAGE;
  const pageItems = all.slice(start, start + FEEDBACK_PER_PAGE);

  const itemsHtml = pageItems
    .map((f) => {
      const r = Math.max(0, Math.min(5, Number(f.rating) || 0));
      const name = f.name || "Anonymous";
      const date = FeedbackStore.formatDate(f.ts);
      return `
      <div class="feedback-item">
        <div class="feedback-meta">
          <span class="feedback-stars">${"<i data-icon=star class=ic-fill></i>".repeat(r)}${"<i data-icon=star></i>".repeat(5 - r)}</span>
          <span class="badge badge-gray">${fbEscape(f.category)}</span>
          <span class="feedback-date">${fbEscape(name)} · ${fbEscape(date)}</span>
        </div>
        <p class="feedback-msg">${fbEscape(f.comment)}</p>
      </div>`;
    })
    .join("");

  wrap.innerHTML =
    itemsHtml +
    (pages > 1 ? renderFeedbackPagination(pages, total, start, pageItems.length) : "");
  if (typeof hydrateIcons === "function") hydrateIcons(wrap);
}

function renderFeedbackPagination(pages, total, start, count) {
  let numbers = "";
  for (let p = 1; p <= pages; p++) {
    numbers += `<button class="fb-page-btn${p === feedbackPage ? " active" : ""}" onclick="gotoFeedbackPage(${p})">${p}</button>`;
  }
  return `
    <div class="feedback-pagination">
      <div class="feedback-page-info">Showing ${start + 1}–${start + count} of ${total}</div>
      <div class="feedback-page-controls">
        <button class="fb-page-btn fb-page-nav" ${feedbackPage === 1 ? "disabled" : ""} onclick="gotoFeedbackPage(${feedbackPage - 1})"><i data-icon=arrow-left></i></button>
        ${numbers}
        <button class="fb-page-btn fb-page-nav" ${feedbackPage === pages ? "disabled" : ""} onclick="gotoFeedbackPage(${feedbackPage + 1})"><i data-icon=arrow-right></i></button>
      </div>
    </div>`;
}

function gotoFeedbackPage(p) {
  feedbackPage = p;
  renderRecentFeedback();
  const wrap = document.getElementById("recent-feedback-wrap");
  if (wrap) wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Called after a new submission (from shell.js) so the new entry shows on top.
function refreshRecentFeedback() {
  feedbackPage = 1;
  renderRecentFeedback();
}
