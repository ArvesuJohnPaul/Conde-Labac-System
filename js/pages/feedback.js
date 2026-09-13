// js/pages/feedback.js
window.CURRENT_PAGE = "feedback";

// The slice currently painted into Recent Feedback, so a Delete button can
// resolve its own entry by index. Paging itself is the shared helper in
// shell.js (paginate / resetPage), the same one every other list uses.
let FEEDBACK_ON_PAGE = [];

// AI sentiment insights from GET /api/ai/feedback/insights — real sentiment
// counts, aggregated topics, and the high-urgency queue. Null until the first
// fetch lands (or permanently, if the server has no Gemini key), in which case
// every AI surface on this page falls back to its pre-AI behaviour.
let FEEDBACK_INSIGHTS = null;
let AI_STATUS = null;

function renderPage() {
  // Read before the first paint: the id has to be known by the time the queue
  // is built, because the highlight is part of that markup rather than
  // something applied to it afterwards. See highlightFeedbackEntry().
  highlightFromHash();
  renderFeedbackPage();
  // Feedback lives in the shared `feedback` table; localStorage is only a
  // mirror for offline/instant display. Pull the real list, then repaint so
  // the KPIs, the sentiment split and the Recent list all describe the same
  // records the Delete buttons act on.
  if (window.FeedbackStore && FeedbackStore.syncFromServer)
    FeedbackStore.syncFromServer().then((rows) => {
      if (rows) renderFeedbackPage();
    });
  loadFeedbackInsights();
}

// Pulls the AI insights + the server's AI status. Neither is required for the
// page to work: every failure path leaves FEEDBACK_INSIGHTS null and the page
// renders exactly as it did before this feature existed.
async function loadFeedbackInsights() {
  try {
    const [status, insights] = await Promise.all([
      apiGet("/api/ai/status").catch(() => null),
      apiGet("/api/ai/feedback/insights").catch(() => null),
    ]);
    AI_STATUS = status;
    FEEDBACK_INSIGHTS = insights;
    if (insights) renderFeedbackPage();
  } catch (e) {
    /* non-fatal — the page stays on its non-AI rendering */
  }
}

// Run the batch analyzer over the unanalysed backlog, then repaint.
// rescan:true first puts already-analysed comments back on that queue.
async function analyzePendingFeedback(btn, rescan) {
  const label = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Analyzing…";
  }
  try {
    const r = await apiPost("/api/ai/feedback/analyze", {
      account_id: actingAccountId(),
      limit: 50,
      rescan: !!rescan,
    });
    // The flagged count is the part worth interrupting for — it is the number
    // of residents who have been waiting on something nobody had noticed.
    showToast(
      `Analyzed ${r.analyzed} comment${r.analyzed === 1 ? "" : "s"}` +
        (r.flagged ? ` — ${r.flagged} flagged urgent` : "") +
        (r.remaining ? `, ${r.remaining} still pending` : ""),
      r.flagged ? "<i data-icon=triangle-alert></i>" : "<i data-icon=sparkles></i>"
    );
    await loadFeedbackInsights();
    if (window.FeedbackStore && FeedbackStore.syncFromServer)
      await FeedbackStore.syncFromServer();
    renderFeedbackPage();
    // A re-scan can raise alerts, and the bell is what tells everyone else.
    if (typeof loadNotifications === "function") loadNotifications();
  } catch (err) {
    showToast(err.message || "Analysis failed", "<i data-icon=triangle-alert></i>");
    if (btn) {
      btn.disabled = false;
      btn.textContent = label || "Analyze pending";
    }
  }
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
        <div class="card-header">
          <div class="card-title">Sentiment Breakdown</div>
          ${renderSentimentSubtitle()}
        </div>
        <div class="chart-box chart-box-md"><canvas id="sentChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title">Top Themes</div>
          <span class="fb-ai-note">
            <span class="fb-ai-badge">AI</span>
            Read from the comments and grouped by meaning
          </span>
        </div>
        ${renderTopThemes()}
      </div>
    </div>
    ${renderNeedsAttention()}
    <div class="card">
      <div class="card-header"><div class="card-title">Recent Feedback</div><button class="btn btn-sm btn-gold" onclick="openServicePopup('feedback')">⊕ Submit Feedback</button></div>
      <div id="recent-feedback-wrap"></div>
    </div>
  `);

  renderRecentFeedback();
  // Every paint ends here, which is what makes the highlight reliable: whichever
  // of the three loads finishes last, the entry is still lit and still scrolled
  // to. No-ops when nothing is highlighted.
  settleFeedbackHighlight();

  setTimeout(() => {
    const ctx = document.getElementById("sentChart");
    // setContent() replaced the canvas, so the previous Chart instance is
    // orphaned — dispose of it before building its replacement (the page
    // re-renders whenever the server list arrives or an entry is deleted).
    if (charts.sent) {
      charts.sent.destroy();
      charts.sent = null;
    }
    if (!ctx) return;

    // ── Real sentiment, when the AI has analysed anything ──────────────────
    // Note the 4th slice: "mixed" is a comment that praises one service and
    // complains about another (5★ + "sana po maayos na ang ilaw"). The old
    // rating-derived split could not represent that case at all — it painted
    // those green.
    const ai = FEEDBACK_INSIGHTS;
    let labels, data, colors;
    if (ai && ai.analyzed > 0) {
      labels = ["Positive", "Neutral", "Negative", "Mixed"];
      data = [ai.positive, ai.neutral, ai.negative, ai.mixed];
      colors = ["#22c55e", "#94a3b8", "#ef4444", "#f59e0b"];
    } else {
      // Fallback: nothing analysed (or no Gemini key on the server), so fall
      // back to the old rating-derived bucketing — 4-5 positive, 3 neutral,
      // 1-2 negative. Approximate, but the page never looks broken because AI
      // is switched off.
      let pos = 0,
        neu = 0,
        neg = 0;
      all.forEach((f) => {
        const r = Number(f.rating) || 0;
        if (r >= 4) pos++;
        else if (r === 3) neu++;
        else neg++;
      });
      labels = ["Positive", "Neutral", "Negative"];
      data = total ? [pos, neu, neg] : [62, 24, 14];
      colors = ["#22c55e", "#94a3b8", "#ef4444"];
    }

    charts.sent = new Chart(ctx, {
      type: "pie",
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors, borderWidth: 2 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
      },
    });
  }, 100);
}

// Card-header subtitle for the pie: says plainly whether it is showing real
// analysed sentiment or the rating-derived approximation, and offers the
// Analyze button when there is a backlog and the server has AI configured.
function renderSentimentSubtitle() {
  const ai = FEEDBACK_INSIGHTS;
  if (!ai) return "";
  const pending = ai.total - ai.analyzed;
  const enabled = AI_STATUS && AI_STATUS.enabled;
  const canAnalyze = enabled && pending > 0;
  // Re-scan re-reads comments that were ALREADY analysed. It exists because the
  // questions the pass asks have changed since some rows were classified — the
  // urgent-alert judgement is newer than the sentiment one, so a comment
  // analysed before it was added has no answer for it and never will, since
  // "unanalysed" is the only work queue the analyzer has. It spends quota (one
  // call per 25 comments), which is why it is a separate, plainly-labelled
  // button rather than something that happens on its own.
  const canRescan = enabled && ai.analyzed > 0;
  const note = ai.analyzed
    ? `${ai.analyzed} of ${ai.total} analyzed`
    : "Showing star ratings — not yet analyzed";
  return `
    <span class="fb-ai-note">
      <span class="fb-ai-badge">AI</span> ${note}
      ${canAnalyze ? `<button class="btn btn-sm btn-outline" onclick="analyzePendingFeedback(this)">Analyze pending</button>` : ""}
      ${canRescan ? `<button class="btn btn-sm btn-outline" onclick="rescanAllFeedback(this)">Re-scan all</button>` : ""}
    </span>`;
}

// Re-read every stored comment under the current prompt. Alerts an official has
// already resolved stay resolved — the server preserves alert_resolved_at, so a
// re-scan cannot put handled work back on the board.
async function rescanAllFeedback(btn) {
  const ai = FEEDBACK_INSIGHTS || {};
  const ok = await uiConfirm({
    title: "Re-scan all feedback?",
    message:
      "Every stored comment is read again by the AI, including ones already analyzed. Use this after the analysis has been improved — it re-checks each comment for urgent issues.",
    icon: "sparkles",
    tone: "accent",
    notes: [
      { icon: "info", text: `${ai.analyzed || 0} comment(s) will be queued — roughly one AI call per 25.` },
      { icon: "check", text: "Alerts already marked resolved stay resolved." },
    ],
    confirmLabel: "Re-scan",
    confirmIcon: "sparkles",
  });
  if (!ok) return;
  await analyzePendingFeedback(btn, true);
}

// Themes extracted and normalised to English by the model, so a complaint
// written as "madilim sa kanto" lands in the same bucket as one written as
// "broken streetlight". Bar colour tracks the average sentiment of the
// comments that raised the theme — red themes are the ones costing goodwill.
//
// Nothing here is a fixed list of themes: the phrases come from the comments,
// and the server groups them into themes named from those same phrases (see
// groupFeedbackTopics in ai-feedback-service.js). That grouping is why the card
// says something — ungrouped, the first 22 comments produced 24 different
// phrases and every bar was the same length. A theme built from more than one
// phrase names them underneath, so staff can see what was merged and say when
// the AI has put two unrelated things together.
function renderTopThemes() {
  const ai = FEEDBACK_INSIGHTS;
  if (!ai || !ai.topics || !ai.topics.length) {
    return `<div class="resident-empty">${
      AI_STATUS && !AI_STATUS.enabled
        ? "Themes are extracted by AI, which is not configured on this server."
        : "No themes yet — analyze the feedback comments to extract them."
    }</div>`;
  }
  const max = ai.topics[0].n || 1;
  return ai.topics
    .map((t) => {
      const score = t.avg_score == null ? 0 : t.avg_score;
      const tone = score <= -0.2 ? "neg" : score >= 0.2 ? "pos" : "neu";
      const phrases = Array.isArray(t.phrases) ? t.phrases : [];
      // Only worth showing when the theme actually merged something — a theme
      // of one phrase would just repeat its own label.
      const merged =
        phrases.length > 1
          ? `<span class="fb-theme-merged" title="Comments about this theme were written as: ${fbEscape(
              phrases.join(", ")
            )}">${fbEscape(phrases.join(" · "))}</span>`
          : "";
      return `
      <div class="stat-row fb-theme-row">
        <span class="stat-row-label">${fbEscape(t.topic)}${merged}</span>
        <div class="stat-row-bar"><div class="progress-bar"><div class="progress-fill fb-theme-${tone}" data-width="${Math.round((t.n / max) * 100)}"></div></div></div>
        <span class="stat-row-value">${t.n}</span>
      </div>`;
    })
    .join("");
}

// The operational payoff: the open urgent alerts, the same board the dashboard
// shows. This is a work queue, not a chart — it can surface a 5-star submission
// (the case the old rating-derived pie filed as "positive"), and it holds two
// different kinds of emergency: an active safety risk, and a service failure
// that has dragged on for months without hurting anyone.
//
// Each row carries the Resolve button, so the queue empties as it is worked
// through instead of accumulating for ever. Resolving here and resolving on the
// dashboard are the same action on the same row.
function renderNeedsAttention() {
  const ai = FEEDBACK_INSIGHTS;
  if (!ai || !ai.needs_attention || !ai.needs_attention.length) return "";
  return `
    <div class="card fb-attention-card">
      <div class="card-header">
        <div class="card-title">Needs Attention</div>
        <span class="fb-ai-note">
          <span class="fb-ai-badge">AI</span>
          Raised automatically from the comment text — read each one yourself before acting,
          and dismiss it if the AI has misjudged it
        </span>
      </div>
      ${ai.needs_attention
        .map((f) => {
          const r = Math.max(0, Math.min(5, Number(f.rating) || 0));
          const safety = f.urgency === "high";
          const reason = (f.alert_reason || f.summary || "").trim();
          const days = Number(f.days_old) || 0;
          const age =
            typeof aiAlertAge === "function"
              ? aiAlertAge(days)
              : `${days} days old`;
          // The anchor and the flash the dashboard's View button aims at. Both
          // are part of the markup rather than applied afterwards — see the
          // note above FEEDBACK_HIGHLIGHT_ID.
          const lit = Number(f.id) === FEEDBACK_HIGHLIGHT_ID;
          return `
        <div class="fb-attention-item${lit ? " is-highlighted" : ""}" id="attn-${Number(f.id)}">
          <div class="fb-attention-meta">
            <span class="badge badge-danger">${safety ? "Safety risk" : "Service failure"}</span>
            <span class="badge badge-gray">${fbEscape(f.sentiment)}</span>
            <span class="badge badge-gray">${fbEscape(f.category)}</span>
            <span class="feedback-stars">${"<i data-icon=star class=ic-fill></i>".repeat(r)}${"<i data-icon=star></i>".repeat(5 - r)}</span>
            <span class="feedback-date">${fbEscape(FeedbackStore.formatDate(f.created_at))} · ${fbEscape(age)}</span>
            <span class="fb-attention-actions">
              <!-- Dismiss first and quieter: it is the answer to "the AI got
                   this wrong", which has to be available without being the
                   easy default. Resolve is the one that closes the loop with
                   the resident, so it carries the emphasis. -->
              <button type="button" class="btn btn-sm btn-outline"
                      title="The AI misjudged this — take the alert down without telling the resident anything"
                      onclick="dismissAiAlert(${Number(f.id)}, this)">
                <i data-icon=x></i> Dismiss
              </button>
              <button type="button" class="btn btn-sm btn-gold"
                      title="Dealt with — you can send the resident a note saying what was done"
                      onclick="resolveAiAlert(${Number(f.id)}, this)">
                <i data-icon=check></i> Resolve
              </button>
            </span>
          </div>
          <p class="feedback-msg">${fbEscape(reason)}</p>
          ${f.comment ? `<p class="fb-attention-quote">${fbEscape(f.comment)}</p>` : ""}
        </div>`;
        })
        .join("")}
    </div>`;
}

// Called by resolveAiAlert() in shell.js after the server confirms. The queue
// is server-derived, so it is refetched rather than patched locally — the
// insight counts beside it move too.
function onAiAlertResolved(_id) {
  // The row also carries its own alert state now (it moves from "urgent" to
  // "resolved" in the Recent Feedback list below), so the feedback list is
  // re-pulled alongside the queue.
  if (window.FeedbackStore && FeedbackStore.syncFromServer)
    FeedbackStore.syncFromServer().then(() => renderFeedbackPage());
  loadFeedbackInsights();
}

// Put an alert back on the board — for a Resolve pressed on the wrong row, or a
// problem that turned out not to be fixed after all. Offered from the Recent
// Feedback row itself, which is where a resolved alert now lives: a resolved
// alert is not a record in its own right, it is a fact about a feedback entry,
// so it is shown on that entry rather than in a list of its own.
async function reopenAiAlert(id, btn) {
  if (btn) btn.disabled = true;
  try {
    await apiPost(`/api/ai/alerts/${Number(id)}/reopen`, {
      account_id: actingAccountId(),
    });
  } catch (err) {
    if (btn) btn.disabled = false;
    showToast(err.message || "Could not reopen the alert", "<i data-icon=triangle-alert></i>");
    return;
  }
  if (typeof logAudit === "function")
    logAudit(
      "AI_ALERT_REOPEN",
      `Urgent AI alert reopened — feedback #${id}`,
      "warning",
      "feedback"
    );
  showToast("Alert reopened", "<i data-icon=refresh></i>");
  // The row's own alert state lives in the feedback list, so that is what has
  // to be re-pulled — the insights queue above it changes too.
  if (window.FeedbackStore && FeedbackStore.syncFromServer)
    await FeedbackStore.syncFromServer();
  await loadFeedbackInsights();
  renderFeedbackPage();
  // It belongs on the dashboard board again too, if that is loaded.
  if (typeof loadAiAlerts === "function") loadAiAlerts();
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

  const page = paginate("feedback", all, renderRecentFeedback);
  // Kept so the Delete buttons can name their entry by position rather than
  // by an id the seed baseline does not have.
  FEEDBACK_ON_PAGE = page.items;

  const itemsHtml = page.items
    .map((f, i) => {
      const r = Math.max(0, Math.min(5, Number(f.rating) || 0));
      const name = f.name || "Anonymous";
      const date = FeedbackStore.formatDate(f.ts);
      // The chip shows what the AI concluded from the words, which can disagree
      // with the stars beside it — that disagreement is the point. Hovering
      // gives the model's one-line reading.
      const chip = f.sentiment
        ? `<span class="fb-chip fb-chip-${fbEscape(f.sentiment)}" title="${fbEscape(f.aiSummary || "")}">${fbEscape(f.sentiment)}</span>`
        : "";

      // ── Alert state, inline ────────────────────────────────────────────
      // Three states, and each row shows exactly one of them:
      //   flagged and open     → red chip; it is on the dashboard board now
      //   flagged and resolved → muted chip naming who closed it, plus Reopen
      //   never flagged        → nothing
      // Resolved alerts used to be a card of their own further up the page.
      // Folding them in here means the whole history of a comment — what the
      // resident said, what the AI made of it, whether anyone acted — reads as
      // one row instead of being split across two places by its status.
      const flagged = f.alertLevel === "urgent";
      const closed = flagged && !!f.alertResolvedAt;
      const dismissed = closed && f.alertOutcome === "dismissed";
      const resolved = closed && !dismissed;
      const who = f.alertResolvedBy ? ` by ${f.alertResolvedBy}` : "";
      const when = closed ? FeedbackStore.formatDate(f.alertResolvedAt) : "";
      let alertChip = "";
      if (flagged && !closed) {
        alertChip = `<span class="fb-chip fb-chip-urgent" title="${fbEscape(f.alertReason || "Flagged as needing action")}">urgent</span>`;
      } else if (dismissed) {
        // Says the flag was wrong, not that the feedback was. The comment is
        // still in the list and still counts in every chart.
        alertChip = `<span class="fb-chip fb-chip-dismissed" title="${fbEscape(
          (f.alertReason ? "AI flagged: " + f.alertReason + " — " : "") +
            "Dismissed as a false alarm" + who + (when ? " on " + when : "") +
            (f.alertResolution ? ": " + f.alertResolution : "")
        )}">false alarm</span>`;
      } else if (resolved) {
        alertChip = `<span class="fb-chip fb-chip-resolved" title="${fbEscape(
          (f.alertReason ? f.alertReason + " — " : "") +
            "Resolved" + who + (when ? " on " + when : "")
        )}">alert resolved</span>`;
      }

      // The note staff wrote when they resolved it. Shown in full rather than
      // tucked into a tooltip, because on a resolve this text was SENT to the
      // resident — it is half of a conversation now, and whoever reads the row
      // next needs to see what was said in the barangay's name. A dismissal
      // note is internal, so it stays in the chip's tooltip.
      const reply =
        resolved && f.alertResolution
          ? `<p class="fb-reply"><span class="fb-reply-tag">Replied${fbEscape(who)}</span>${fbEscape(f.alertResolution)}</p>`
          : "";
      // Reopen sits beside Delete, on resolved rows only. Deliberately not a
      // chip: it is an action with a consequence (the alert returns to the
      // dashboard and the queue), not a label.
      // Same shape as the Delete button beside it (icon-only, btn-sm outline),
      // so the two read as one row of controls. Offered on both closed states:
      // a wrongly-dismissed alert needs putting back just as much as a
      // wrongly-resolved one.
      const reopen = closed
        ? `<button type="button" class="btn btn-sm btn-outline"
                   title="Reopen this alert — it returns to the dashboard and the Needs Attention queue"
                   onclick="reopenAiAlert(${Number(f.id)}, this)"><i data-icon=refresh></i></button>`
        : "";
      // Fallback anchor for View, used only when the alert has already been
      // closed and so is no longer in the Needs Attention queue above. Distinct
      // prefix from that queue's "attn-" — the same id on two elements would be
      // invalid, and getElementById would silently pick one of them. Seed and
      // local-mirror entries have no server id and so nothing to link to.
      const anchor = f.id != null ? ` id="fbrow-${Number(f.id)}"` : "";
      return `
      <div class="feedback-item${flagged && !closed ? " is-flagged" : ""}"${anchor}>
        <div class="feedback-meta">
          <span class="feedback-stars">${"<i data-icon=star class=ic-fill></i>".repeat(r)}${"<i data-icon=star></i>".repeat(5 - r)}</span>
          ${chip}${alertChip}
          <span class="badge badge-gray">${fbEscape(f.category)}</span>
          <span class="feedback-date">${fbEscape(name)} · ${fbEscape(date)}</span>
          <span class="feedback-item-actions">${reopen}${deleteButtonHtml(`deleteFeedbackEntry(${i})`, "")}</span>
        </div>
        <p class="feedback-msg">${fbEscape(f.comment)}</p>
        ${reply}
      </div>`;
    })
    .join("");

  wrap.innerHTML = itemsHtml + page.html;
  if (typeof hydrateIcons === "function") hydrateIcons(wrap);
}

// ── Arriving from the dashboard's View button ───────────────────────────────
// The dashboard alert row is one truncated line, so its button brings the
// officer here instead of letting them close an alert they have not read. The
// feedback id comes in on the URL hash (#alert-23) because this is a separate
// document — nothing in memory survives the navigation.
//
// WHY THIS IS A VARIABLE AND NOT A classList.add()
// The page paints up to three times on arrival: once off the localStorage
// mirror, again when the server feedback list lands, and again when the AI
// insights land — and each of those goes through setContent(), which replaces
// the whole DOM. A class added to a live element is destroyed by whichever
// render happens next, and the insights fetch (two API calls) almost always
// finishes last. So the highlight is held here as an id and written INTO the
// markup by renderNeedsAttention(); every repaint then reproduces it instead
// of erasing it.
let FEEDBACK_HIGHLIGHT_ID = null;
let FEEDBACK_HIGHLIGHT_TIMER = null;

function highlightFromHash() {
  const m = /^#alert-(\d+)$/.exec(window.location.hash || "");
  FEEDBACK_HIGHLIGHT_ID = m ? Number(m[1]) : null;
}

// Called when the button is pressed while already on this page.
function highlightFeedbackEntry(id) {
  FEEDBACK_HIGHLIGHT_ID = Number(id);
  clearTimeout(FEEDBACK_HIGHLIGHT_TIMER);
  FEEDBACK_HIGHLIGHT_TIMER = null;
  renderFeedbackPage(); // repaints with the highlight in the markup
  return FEEDBACK_HIGHLIGHT_ID != null;
}

// Runs at the end of every paint. Scrolls to the highlighted entry once it
// actually exists — on the first paint the queue is not built yet, because the
// insights it comes from have not arrived — then starts the timer that ends the
// highlight so a later repaint does not flash it all over again.
function settleFeedbackHighlight() {
  if (FEEDBACK_HIGHLIGHT_ID == null) return;
  const id = FEEDBACK_HIGHLIGHT_ID;

  // The Needs Attention entry is the target: it is the one with the full
  // comment and the two buttons, which is what View is for. The Recent Feedback
  // row is the fallback for an alert that has since been closed and so has left
  // the queue — that row can be on any page, so its page has to be found first.
  let el = document.getElementById("attn-" + id);
  if (!el) {
    // The queue is built from the AI insights, and the first paint happens
    // before those land. Until they do there is nothing to look in, so wait for
    // the next paint — falling through here would scroll to the Recent Feedback
    // row and light THAT up, which is precisely what this should not do.
    if (!FEEDBACK_INSIGHTS) return;
    const all = window.FeedbackStore ? FeedbackStore.getAll() : [];
    const index = all.findIndex((f) => Number(f.id) === id);
    if (index < 0) return;
    const size = typeof PAGE_SIZE === "number" ? PAGE_SIZE : 15;
    const page = Math.floor(index / size) + 1;
    if (
      typeof gotoPage === "function" &&
      typeof pagerState !== "undefined" &&
      pagerState.feedback &&
      pagerState.feedback.page !== page
    ) {
      gotoPage("feedback", page); // repaints the list on the right page
    }
    el = document.getElementById("fbrow-" + id);
    if (!el) return;
    el.classList.add("is-highlighted");
  }

  // Scroll once only. The timer doubles as the "already handled" flag: later
  // paints keep the entry lit but must not yank the page back to it after the
  // officer has started reading or scrolled away.
  if (FEEDBACK_HIGHLIGHT_TIMER) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  FEEDBACK_HIGHLIGHT_TIMER = setTimeout(() => {
    FEEDBACK_HIGHLIGHT_ID = null;
    FEEDBACK_HIGHLIGHT_TIMER = null;
    // Drop the hash too, so reloading the page does not replay the flash for
    // something the officer has already looked at.
    if (window.location.hash && window.history && history.replaceState)
      history.replaceState(null, "", window.location.pathname + window.location.search);
    const still = document.getElementById("attn-" + id);
    if (still) still.classList.remove("is-highlighted");
  }, 2600);
}

// Delete one feedback entry. A submission that reached the DB is snapshotted
// into the shared Archive first (DELETE /api/feedback/:id), so an Admin can
// restore it; a browser-only mirror row or a demo baseline row has nothing to
// archive and is simply dropped. Either way the deletion is written to the
// Audit Log. deleteRecord() in shell.js handles permission and confirmation.
async function deleteFeedbackEntry(index) {
  const entry = FEEDBACK_ON_PAGE[index];
  if (!entry) return;
  const who = entry.name || "Anonymous";
  const snippet = (entry.comment || "").slice(0, 60);
  await deleteRecord({
    label: `${who} — ${entry.rating || "?"}★`,
    what: "feedback entry",
    icon: "message-square",
    // Only submissions that reached the `feedback` table can be archived; a
    // browser-only mirror row or a demo baseline entry is gone for good.
    archives: entry.source === "server",
    action: "FEEDBACK_DELETE",
    category: "feedback",
    details: `Feedback from ${who} (${entry.rating || "?"}/5, ${entry.category || "Other"})${snippet ? ' — "' + snippet + '"' : ""} deleted`,
    request: () => FeedbackStore.remove(entry, actingAccountId()),
    onDone: () => renderFeedbackPage(),
  });
}

// Called after a new submission (from shell.js) so the new entry shows on top.
// Re-pulls the shared list first: the submission went to the API, and the
// server list is what getAll() returns once it has been fetched.
function refreshRecentFeedback() {
  resetPage("feedback");
  if (window.FeedbackStore && FeedbackStore.syncFromServer)
    FeedbackStore.syncFromServer().then(() => renderRecentFeedback());
  renderRecentFeedback();
}
