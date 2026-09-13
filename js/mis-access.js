// js/mis-access.js
// "May this role open the MIS at all?" — one question, asked in two places that
// share no other code: the public landing page (index.html), which decides
// whether the MIS link appears in its navbar, and the MIS shell itself
// (js/shell.js), which refuses to render for a role that has been shut out.
//
// The answer comes from the Role Access Matrix on User Management, stored in
// shared settings under 'module-access' beside every other module row — MIS
// access is simply the module key 'mis'. Keeping it in the same store means the
// mobile app reads the same decision from the same place.
//
// Admin is never lockable out: an Admin who revoked their own MIS access would
// have no way back in to undo it.

const MIS_ACCESS_KEY = "mis";

// Built-in defaults, used until an Admin says otherwise. Staff work in the MIS;
// residents use the public portal, which is what the landing page already did
// before this was configurable.
const MIS_ACCESS_DEFAULTS = { admin: true, officer: true, resident: false };

// The fetched settings map, shared by every caller on the page so the MIS
// shell and this file never make the same request twice.
// null = not fetched yet or the fetch failed (fall back to the defaults above).
let MIS_ACCESS_MAP = null;
let MIS_ACCESS_PROMISE = null;

// Decide from an already-loaded { roleKey: { moduleKey: bool } } map.
function misAccessFromMap(map, role) {
  if (!role) return false;
  const rk = String(role).toLowerCase();
  if (rk === "admin") return true;
  const entry = map && map[rk];
  if (entry && Object.prototype.hasOwnProperty.call(entry, MIS_ACCESS_KEY))
    return entry[MIS_ACCESS_KEY] === true;
  return MIS_ACCESS_DEFAULTS[rk] === true;
}

// Fetch (once) the whole module-access map. A failed request resolves to null
// rather than rejecting: a server hiccup must not lock staff out of their own
// system, so callers fall back to the built-in defaults.
function loadMisAccessMap(force) {
  if (!force && MIS_ACCESS_PROMISE) return MIS_ACCESS_PROMISE;
  MIS_ACCESS_PROMISE = (
    typeof apiGet === "function"
      ? apiGet("/api/settings/module-access")
      : Promise.reject(new Error("api not loaded"))
  )
    .then((r) => {
      MIS_ACCESS_MAP =
        r && r.value && typeof r.value === "object" ? r.value : {};
      return MIS_ACCESS_MAP;
    })
    .catch(() => {
      MIS_ACCESS_MAP = null;
      return null;
    });
  return MIS_ACCESS_PROMISE;
}

// Called by User Management right after it saves a matrix toggle, so the answer
// on this page changes with the tap instead of on the next reload.
function primeMisAccessMap(map) {
  MIS_ACCESS_MAP = map && typeof map === "object" ? map : null;
  MIS_ACCESS_PROMISE = Promise.resolve(MIS_ACCESS_MAP);
}

async function canAccessMis(role) {
  return misAccessFromMap(await loadMisAccessMap(), role);
}
