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
  return text ? JSON.parse(text) : null;
}

const apiGet = (p) => apiRequest("GET", p);
const apiPost = (p, b) => apiRequest("POST", p, b);
const apiPut = (p, b) => apiRequest("PUT", p, b);
const apiDelete = (p) => apiRequest("DELETE", p);
