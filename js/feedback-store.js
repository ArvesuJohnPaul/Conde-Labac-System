// js/feedback-store.js — shared store for resident feedback (localStorage).
// Loaded before the scripts that submit feedback (index.html landing modal,
// js/shell.js resident/staff modal) and the one that displays it
// (js/pages/feedback.js). Submissions persist here so they show up on the
// Feedback Management page's "Recent Feedback" list.
//
// Entry shape: { ts, rating, category, comment, name, contact, id?, source }
//   id     — feedback_id when the entry came from the API; absent otherwise
//   source — 'server' | 'local' | 'seed'; decides how remove() disposes of it
//
// Where the data lives: real submissions go to POST /api/feedback (see
// portal-account.js, which replaces the demo handler on every page) and are
// only mirrored into localStorage so the staff list updates instantly. The
// server is therefore the source of truth whenever it answers — syncFromServer()
// pulls it and getAll() prefers it, falling back to the local mirror offline.
(function () {
  "use strict";

  var FEEDBACK_KEY = "cares.feedback";
  var FEEDBACK_MAX = 500;
  // Seed entries a staff member deleted. They are demo baseline constants, not
  // rows, so "deleting" one can only mean remembering not to show it again.
  var HIDDEN_SEED_KEY = "cares.feedback_hidden_seeds";

  // Baseline sample feedback so the page isn't empty on a fresh install. Real
  // submissions are stored separately and always appear *above* these.
  var SEED_FEEDBACK = [
    { ts: new Date(2025, 4, 2).getTime(), rating: 4, category: "Barangay Services", comment: "The clearance process was much faster this time. Keep it up!", name: "Pedro Santos" },
    { ts: new Date(2025, 4, 1).getTime(), rating: 5, category: "Health Services", comment: "Free medical mission was very helpful for our community. Thank you!", name: "Anonymous" },
    { ts: new Date(2025, 3, 30).getTime(), rating: 3, category: "Infrastructure", comment: "The streetlights in Purok 2 need repair. Several have been broken for months.", name: "Maria dela Cruz" },
    { ts: new Date(2025, 3, 29).getTime(), rating: 2, category: "Cleanliness", comment: "The garbage collection schedule is inconsistent. Please improve.", name: "Anonymous" },
    { ts: new Date(2025, 3, 28).getTime(), rating: 5, category: "Officials", comment: "Very responsive barangay officials. I was helped immediately with my concern.", name: "Jose Reyes" },
  ];

  function getStored() {
    try {
      var raw = JSON.parse(localStorage.getItem(FEEDBACK_KEY));
      if (Array.isArray(raw)) return raw;
    } catch (e) {
      /* fall through */
    }
    return [];
  }

  function getHiddenSeeds() {
    try {
      var raw = JSON.parse(localStorage.getItem(HIDDEN_SEED_KEY));
      if (Array.isArray(raw)) return raw;
    } catch (e) {
      /* fall through */
    }
    return [];
  }

  function visibleSeeds() {
    var hidden = getHiddenSeeds();
    return SEED_FEEDBACK.filter(function (s) {
      return hidden.indexOf(s.ts) === -1;
    }).map(function (s) {
      return Object.assign({}, s, { source: "seed" });
    });
  }

  // ── Shared DB (GET /api/feedback) ─────────────────────────────────────────
  // null until a fetch has succeeded; after that it is the authoritative list.
  var serverEntries = null;

  function fromServerRow(r) {
    return {
      id: r.id,
      ts: new Date(r.created_at).getTime() || 0,
      rating: Number(r.rating) || 0,
      category: r.category || "Other",
      comment: r.comment || "",
      name: r.name || "Anonymous",
      contact: r.contact || "",
      status: r.status || "new",
      // AI sentiment, filled by Gemini after submission. Absent on rows that
      // have not been analysed yet (and on every row when the server has no
      // Gemini key) — the Feedback page falls back to the star rating there.
      sentiment: r.sentiment || "",
      sentimentScore: r.sentiment_score == null ? null : Number(r.sentiment_score),
      urgency: r.urgency || "",
      topics: Array.isArray(r.topics) ? r.topics : [],
      aiSummary: r.ai_summary || "",
      analyzed: !!r.ai_analyzed_at,
      // Urgent-alert state. 'urgent' means the AI judged this to need an
      // official today; alertResolvedAt is set once one said it was dealt with.
      // Both are carried on the row so Recent Feedback can show a flagged item
      // and a resolved one differently, and offer Reopen on the latter.
      alertLevel: r.alert_level || "",
      alertReason: r.alert_reason || "",
      alertResolvedAt: r.alert_resolved_at || null,
      // 'resolved' (dealt with) or 'dismissed' (the AI was wrong). They read
      // very differently on the row, so the row needs to know which it was.
      alertOutcome: r.alert_outcome || "",
      // The staff note written when it was closed. On a resolve this was also
      // sent to the resident, so it is shown on the row rather than hidden in a
      // tooltip — it is now half of a conversation, and staff need to see what
      // was said in their name.
      alertResolution: r.alert_resolution || "",
      alertResolvedBy: r.alert_resolved_by_name || "",
      source: "server",
    };
  }

  // Resolves to the mapped list, or null when the API is unreachable (the
  // caller just keeps showing the local mirror).
  function syncFromServer() {
    if (typeof apiGet !== "function") return Promise.resolve(null);
    return apiGet("/api/feedback")
      .then(function (rows) {
        serverEntries = (Array.isArray(rows) ? rows : []).map(fromServerRow);
        return serverEntries;
      })
      .catch(function () {
        return null;
      });
  }

  // All feedback, newest first, followed by whatever is left of the seed
  // baseline. Server rows win over the local mirror once they have arrived —
  // otherwise every submission made through the portal would appear twice.
  function getAll() {
    var live = serverEntries
      ? serverEntries
      : getStored().map(function (f) {
          return Object.assign({}, f, { source: "local" });
        });
    return live.concat(visibleSeeds());
  }

  function getStoredCount() {
    return serverEntries
      ? serverEntries.filter(function (f) {
          return f.status === "new";
        }).length
      : getStored().length;
  }

  // Removes one entry, by whatever route its source allows:
  //   server — DELETE /api/feedback/:id, which snapshots it into the shared
  //            Archive first, so an Admin can restore it
  //   local  — drop it from the localStorage mirror (nothing to archive: it
  //            never reached the DB)
  //   seed   — remember not to render that demo row again
  // Resolves to { archived: bool }; rejects only when the API call fails.
  function remove(entry, accountId) {
    if (!entry) return Promise.reject(new Error("no entry"));

    if (entry.source === "seed") {
      var hidden = getHiddenSeeds();
      hidden.push(entry.ts);
      try {
        localStorage.setItem(HIDDEN_SEED_KEY, JSON.stringify(hidden));
      } catch (e) {
        /* best-effort */
      }
      return Promise.resolve({ archived: false });
    }

    if (entry.id != null && typeof apiDelete === "function") {
      return apiDelete(
        "/api/feedback/" + entry.id + "?account_id=" + (accountId || "")
      ).then(function () {
        if (serverEntries)
          serverEntries = serverEntries.filter(function (f) {
            return f.id !== entry.id;
          });
        removeStored(entry.ts);
        return { archived: true };
      });
    }

    removeStored(entry.ts);
    return Promise.resolve({ archived: false });
  }

  // Drops the localStorage mirror row with this timestamp, if there is one.
  function removeStored(ts) {
    var list = getStored().filter(function (f) {
      return f.ts !== ts;
    });
    try {
      localStorage.setItem(FEEDBACK_KEY, JSON.stringify(list));
    } catch (e) {
      /* best-effort */
    }
  }

  function add(entry) {
    entry = entry || {};
    var list = getStored();
    var record = {
      ts: Date.now(),
      rating: Number(entry.rating) || 0,
      category: entry.category || "Other",
      comment: entry.comment || "",
      name:
        entry.name && String(entry.name).trim()
          ? String(entry.name).trim()
          : "Anonymous",
      contact: entry.contact || "",
    };
    list.unshift(record);
    if (list.length > FEEDBACK_MAX) list.length = FEEDBACK_MAX;
    try {
      localStorage.setItem(FEEDBACK_KEY, JSON.stringify(list));
    } catch (e) {
      /* best-effort */
    }
    return record;
  }

  // Short date label, e.g. "May 2".
  function formatDate(ts) {
    try {
      return new Date(ts).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    } catch (e) {
      return "";
    }
  }

  window.FeedbackStore = {
    KEY: FEEDBACK_KEY,
    SEED: SEED_FEEDBACK,
    getAll: getAll,
    getStored: getStored,
    getStoredCount: getStoredCount,
    add: add,
    remove: remove,
    syncFromServer: syncFromServer,
    formatDate: formatDate,
  };
})();
