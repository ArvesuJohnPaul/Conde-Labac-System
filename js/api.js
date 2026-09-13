// Thin fetch wrapper — every API call in the app goes through here, so the base
// URL (window.API_BASE, set by api-config.js) and JSON/error handling live in
// one place. These replace the old localStorage read/write helpers.
//
// Usage:
//   const residents = await apiGet("/api/residents");
//   await apiPost("/api/residents", { last_name, first_name });
async function apiRequest(method, path, body) {
  const headers = {
    // Skips free-ngrok's "You are about to visit..." interstitial for fetch
    // calls. Harmless (ignored) when the API isn't behind ngrok.
    "ngrok-skip-browser-warning": "true",
  };
  if (body) headers["Content-Type"] = "application/json";
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
    try {
      const j = await res.json();
      if (j && j.error) msg = j.error;
    } catch (e) {}
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
