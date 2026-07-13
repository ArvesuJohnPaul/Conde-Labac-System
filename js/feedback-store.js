// js/feedback-store.js — shared store for resident feedback (localStorage).
// Loaded before the scripts that submit feedback (index.html landing modal,
// js/shell.js resident/staff modal) and the one that displays it
// (js/pages/feedback.js). Submissions persist here so they show up on the
// Feedback Management page's "Recent Feedback" list.
//
// Entry shape: { ts, rating, category, comment, name, contact }
(function () {
  "use strict";

  var FEEDBACK_KEY = "cares.feedback";
  var FEEDBACK_MAX = 500;

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

  // All feedback: user submissions (newest first) followed by the seed baseline.
  function getAll() {
    return getStored().concat(SEED_FEEDBACK);
  }

  function getStoredCount() {
    return getStored().length;
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
    formatDate: formatDate,
  };
})();
