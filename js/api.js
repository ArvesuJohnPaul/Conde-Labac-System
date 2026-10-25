// Thin fetch wrapper — every API call in the app goes through here, so the base
// URL (window.API_BASE, set by api-config.js), the session token and JSON/error
// handling live in one place. These replace the old localStorage read/write
// helpers.
//
// Usage:
//   const residents = await apiGet("/api/residents");
//   await apiPost("/api/residents", { last_name, first_name });

// ── The session token ───────────────────────────────────────────────────────
// Signing in (system.html) stores the server's token inside the session object.
// It goes out on every request as `Authorization: Bearer …`, and it — not the
// role or account_id kept beside it — is what the server believes
// (conde-labak-server/session.js).
//
// Named API_SESSION_KEY, not SESSION_KEY: shell.js and the pages' inline
// scripts each declare their own SESSION_KEY, and two top-level consts of one
// name across classic scripts is a SyntaxError that takes the second file down.
const API_SESSION_KEY = "ibmdss.session";

function apiSession() {
  try {
    return JSON.parse(localStorage.getItem(API_SESSION_KEY));
  } catch (e) {
    return null;
  }
}

function apiToken() {
  const s = apiSession();
  return (s && s.token) || "";
}

// A session saved before tokens existed has nothing to send, and the server is
// about to stop taking a bare account_id on trust. Dropped here — this file
// loads ahead of everything that reads the session — so the page comes up
// signed out and asks for a sign-in, once, instead of half working.
(function () {
  const s = apiSession();
  if (s && !s.token) {
    try {
      localStorage.removeItem(API_SESSION_KEY);
    } catch (e) {}
  }
})();

// The server said this token is dead: it expired, the password changed, or the
// account was suspended. Leave the way signing out does, then go where a
// signed-out visitor belongs — the sign-in page from inside the MIS, the same
// page again (now as a visitor) anywhere public.
let apiSessionEnding = false;
function apiSessionExpired(sentToken) {
  // Another tab may have signed in again since this request left; that newer
  // session is not the one the server refused.
  if (apiSessionEnding || apiToken() !== sentToken) return;
  apiSessionEnding = true;
  try {
    localStorage.removeItem(API_SESSION_KEY);
  } catch (e) {}
  if (typeof clearSessionAvatarCache === "function") clearSessionAvatarCache();
  if (/\/pages\/[^/]*$/.test(location.pathname))
    location.href = "../system.html?expired=1";
  else if (!/system\.html$/.test(location.pathname)) location.reload();
}

async function apiRequest(method, path, body) {
  const headers = {
    // Skips free-ngrok's "You are about to visit..." interstitial for fetch
    // calls. Harmless (ignored) when the API isn't behind ngrok.
    "ngrok-skip-browser-warning": "true",
  };
  if (body) headers["Content-Type"] = "application/json";
  const token = apiToken();
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch((window.API_BASE || "") + path, {
    method: method,
    headers: headers,
    body: body ? JSON.stringify(body) : undefined,
    // Never serve an API response from the browser's disk cache. Express sends
    // an ETag on every JSON response, so a GET is otherwise cacheable — and a
    // barangay record read from cache is a record that may already be wrong.
    // It also removes a whole class of "the server is fine but the browser
    // shows something else" failure, where a corrupted cache entry is replayed
    // in place of the live response.
    cache: "no-store",
  });
  if (!res.ok) {
    let msg = res.status + " " + res.statusText;
    let code = "";
    try {
      const j = await res.json();
      if (j && j.error) msg = j.error;
      if (j && j.code) code = j.code;
    } catch (e) {}
    // Only the server's own "session_expired" ends the session. Other 401s —
    // a wrong password at sign-in, a wrong current password — are answers to
    // the question that was asked, not news about the session.
    if (res.status === 401 && code === "session_expired" && token)
      apiSessionExpired(token);
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    // A 200 that isn't JSON means the request reached something that is not
    // this API — most often window.API_BASE (js/api-config.js) pointing at a
    // stale tunnel, a login/interstitial page, or the static site itself.
    // "Unexpected token" alone cannot tell you that, so say where the request
    // went and show what came back instead.
    const type = res.headers.get("content-type") || "unknown";
    const head = text.slice(0, 80).replace(/\s+/g, " ");
    throw new Error(
      `${path} did not return JSON (content-type: ${type}). ` +
        `Got: ${head}${text.length > 80 ? "…" : ""} — check window.API_BASE (${window.API_BASE || "same origin"}).`
    );
  }
}

const apiGet = (p) => apiRequest("GET", p);
const apiPost = (p, b) => apiRequest("POST", p, b);
const apiPut = (p, b) => apiRequest("PUT", p, b);
const apiPatch = (p, b) => apiRequest("PATCH", p, b);
const apiDelete = (p) => apiRequest("DELETE", p);

// Once per page load, ask the server who this token belongs to. Two things come
// of it: a dead token is found before the page is used (apiRequest handles the
// 401 above), and a role an Admin changed since sign-in reaches this browser
// without signing in again — the stored role only decides what the screen
// offers, and it should offer what the server will actually allow.
(function () {
  const before = apiSession();
  if (!before || !before.token) return;
  apiGet("/api/auth/me")
    .then((me) => {
      const now = apiSession();
      if (!me || !now || now.token !== before.token) return;
      const residentId = me.resident_id || null;
      if (me.role === now.role && residentId === (now.resident_id || null)) return;
      now.role = me.role;
      now.kind = me.kind;
      now.resident_id = residentId;
      localStorage.setItem(API_SESSION_KEY, JSON.stringify(now));
      location.reload();
    })
    .catch(() => {
      /* offline, or the 401 already handled above */
    });
})();
