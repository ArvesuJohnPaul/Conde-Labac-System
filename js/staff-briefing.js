// js/staff-briefing.js
// The window an officer or Admin meets when they sign in: what came in while
// they were away, and what they left unfinished.
//
// WHY
// The sidebar pills already count the open queues, but a pill reading "7" is
// the same pill on the day a request arrives and on the day it turns a
// fortnight old. Nothing in the MIS said which of those seven were new to the
// person looking at them, so new work and forgotten work looked identical and
// the oldest request was the easiest one to keep missing.
//
// So this shows two lists, in this order:
//   1. New — arrived since this account's last briefing. Nobody signed in has
//      seen these yet.
//   2. Still waiting — open before that, so this officer HAS seen it and it is
//      not finished. This is the half that is easy to lose.
// Both come from GET /api/briefing, which splits the queues against a marker
// kept per account (routes/briefing.js). Closing the window moves that marker,
// which is what turns today's "new" into tomorrow's "still waiting".
//
// WHO SEES IT
// Staff only — Admin, Officer, and any custom staff role the Role Access
// Matrix lets into the MIS. A resident has no queues to be briefed on, and the
// endpoint refuses them anyway. Each section is also limited to the modules
// the role actually holds: an officer with no Feedback access is not told
// about feedback they cannot open.
//
// WHEN
// Once per sign-in, not once per page. system.html marks the session as owed a
// briefing at the moment the password is accepted; the first MIS page to load
// spends that mark and clears it, so moving between pages afterwards does not
// re-open the window. The bell panel can bring it back by hand.

// The session field system.html sets on a successful staff sign-in.
const BRIEFING_FLAG = "briefing_pending";

// Icons per queue — the row should be recognisable before it is read.
const BRIEFING_ICONS = {
  certificate: "file-text",
  incident: "siren",
  feedback: "message-square",
  application: "user",
  edit_request: "pencil",
};

let BRIEFING_DATA = null;
let BRIEFING_OPEN = false;

function brfEsc(str) {
  return String(str == null ? "" : str).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

// "2h ago" for something that just arrived.
function brfWhen(ts) {
  if (typeof notifWhen === "function") return notifWhen(ts);
  const d = new Date(ts);
  return isNaN(d) ? "" : d.toLocaleDateString();
}

// "waiting 12 days" for something that did not. Age, not a date: how long it
// has been sitting is the thing that should make somebody act.
function brfAge(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days >= 1) return `waiting ${days} day${days === 1 ? "" : "s"}`;
  const hrs = Math.floor((Date.now() - d.getTime()) / 3600000);
  if (hrs >= 1) return `waiting ${hrs} hour${hrs === 1 ? "" : "s"}`;
  return "waiting since earlier today";
}

const brfPlural = (n, s) => `${n} ${n === 1 ? s.one : s.many}`;

// One tappable row. Pressing it closes the window and opens the page that
// queue is worked on — a briefing that only tells you is half a briefing.
function brfRow(item, section, mode) {
  // The title is what it IS; the reference number and the person go on the
  // second line. Pushing "BRF-2026-0043" into the heading pushed the part that
  // can be recognised at a glance off the end of it.
  const title = String(item.what || "");
  const sub = [item.who, item.ref].filter(Boolean).join(" · ");
  const when = mode === "new" ? brfWhen(item.created_at) : brfAge(item.created_at);
  return `
    <button type="button" class="brf-item${item.urgent ? " is-urgent" : ""}"
            onclick="brfGoTo('${section.module}')">
      <span class="brf-item-icon"><i data-icon=${
        BRIEFING_ICONS[section.kind] || "inbox"
      }></i></span>
      <span class="brf-item-main">
        <span class="brf-item-title">${brfEsc(title)}</span>
        <span class="brf-item-sub">${brfEsc(sub)}</span>
      </span>
      <span class="brf-item-when">${brfEsc(when)}</span>
    </button>`;
}

// One queue inside one of the two lists: a heading that counts the whole
// queue, then up to six rows, then a line for the rest.
function brfQueueBlock(section, mode) {
  const items = mode === "new" ? section.new : section.waiting;
  const total = mode === "new" ? section.new_count : section.waiting_count;
  if (!total) return "";
  const hidden = total - items.length;
  return `
    <div class="brf-queue">
      <div class="brf-queue-head">${brfEsc(brfPlural(total, section))}</div>
      ${items.map((it) => brfRow(it, section, mode)).join("")}
      ${
        hidden > 0
          ? `<button type="button" class="brf-more" onclick="brfGoTo('${section.module}')">
               and ${hidden} more — open ${brfEsc(section.many)}
             </button>`
          : ""
      }
    </div>`;
}

function brfList(data, mode) {
  return data.sections.map((s) => brfQueueBlock(s, mode)).join("");
}

function brfBodyHtml(data) {
  const newBlocks = brfList(data, "new");
  const waitBlocks = brfList(data, "waiting");

  // First sign-in: there is no "since you last looked", because there was no
  // last look. Saying so is better than implying everything open arrived
  // today.
  const newSub = data.first_time
    ? "Everything the barangay has not finished yet. From now on this list holds only what arrived since your last sign-in."
    : "Nobody has opened these yet.";

  return `
    <section class="brf-group">
      <div class="brf-group-head">
        <span class="brf-group-title">New since you last signed in</span>
        <span class="brf-group-count${data.new_total ? " is-on" : ""}">${
          data.new_total
        }</span>
      </div>
      ${
        data.new_total
          ? `<p class="brf-group-sub">${newSub}</p>${newBlocks}`
          : `<p class="brf-group-empty"><i data-icon=check-circle></i> Nothing new came in while you were away.</p>`
      }
    </section>

    <section class="brf-group brf-group-waiting">
      <div class="brf-group-head">
        <span class="brf-group-title">Still waiting from before</span>
        <span class="brf-group-count${data.waiting_total ? " is-on" : ""}">${
          data.waiting_total
        }</span>
      </div>
      ${
        data.waiting_total
          ? `<p class="brf-group-sub">You have seen these already and they are still not finished. Oldest first.</p>${waitBlocks}`
          : `<p class="brf-group-empty"><i data-icon=check-circle></i> Nothing is left over. Every earlier request has been dealt with.</p>`
      }
    </section>`;
}

// Built once, on first use, and reused — the window is rare enough that it
// does not belong in the markup of thirteen pages.
function brfEnsureModal() {
  let el = document.getElementById("briefing-modal");
  if (el) return el;
  el = document.createElement("div");
  el.className = "modal-backdrop";
  el.id = "briefing-modal";
  el.innerHTML = `
    <div class="modal-box modal-lg">
      <div class="modal-header">
        <div class="modal-title">
          <div class="modal-title-icon"><i data-icon=inbox></i></div>
          <span id="briefing-title">Welcome back</span>
        </div>
        <button type="button" class="modal-close" onclick="closeStaffBriefing()"
                aria-label="Close"><i data-icon=x></i></button>
      </div>
      <div class="modal-body" id="briefing-body"></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" onclick="closeStaffBriefing()">
          Got it
        </button>
      </div>
    </div>`;
  document.body.appendChild(el);
  // Clicking the dark area closes it, like every other modal here. Only the
  // backdrop itself: a click inside the box must not count.
  el.addEventListener("click", (e) => {
    if (e.target === el) closeStaffBriefing();
  });
  return el;
}

function brfGoTo(module) {
  closeStaffBriefing();
  if (typeof nav === "function") nav(null, module);
}

// Closing is the acknowledgement: it moves this account's marker to now, so
// what was listed as new is listed as waiting next time — until it is actually
// finished, at which point it leaves both lists by itself.
function closeStaffBriefing() {
  const el = document.getElementById("briefing-modal");
  if (el) el.classList.remove("open");
  if (!BRIEFING_OPEN) return;
  BRIEFING_OPEN = false;
  if (typeof apiPost === "function")
    apiPost("/api/briefing/seen", {}).catch(() => {
      // Offline: the marker stays where it was, so the same items are called
      // new again next time. Repeating a briefing is the harmless failure;
      // losing one is not.
    });
}

// Fetch and show. `silent` is for the automatic sign-in call: a server that is
// down should not greet an officer with an error they did not ask for.
async function openStaffBriefing(silent) {
  const session = typeof getSession === "function" ? getSession() : null;
  if (!session || session.role === "Resident") return;
  if (typeof apiGet !== "function") return;

  let data;
  try {
    data = await apiGet("/api/briefing");
  } catch (err) {
    if (!silent && typeof showToast === "function")
      showToast(
        err.message || "Could not load what is waiting",
        "<i data-icon=triangle-alert></i>"
      );
    return;
  }
  if (!data || !data.sections) return;
  BRIEFING_DATA = data;

  // Nothing open at all. On sign-in that is not worth a window — an empty
  // modal in the way of the dashboard is noise. Opened by hand it is an
  // answer, so it still shows.
  if (silent && !data.new_total && !data.waiting_total) return;

  const el = brfEnsureModal();
  const title = document.getElementById("briefing-title");
  if (title)
    title.textContent = session.shortName
      ? `Welcome back, ${session.shortName}`
      : "Welcome back";
  const body = document.getElementById("briefing-body");
  if (body) body.innerHTML = brfBodyHtml(data);
  if (typeof hydrateIcons === "function") hydrateIcons(el);
  BRIEFING_OPEN = true;
  el.classList.add("open");
}

// Called by the MIS shell on every page load. Opens the window only if this
// sign-in has not been briefed yet, and spends the mark first so a slow
// request cannot be answered twice.
function maybeOpenStaffBriefing() {
  const session = typeof getSession === "function" ? getSession() : null;
  if (!session || session.role === "Resident") return;
  if (!session[BRIEFING_FLAG]) return;
  delete session[BRIEFING_FLAG];
  if (typeof setSession === "function") setSession(session);
  openStaffBriefing(true);
}
