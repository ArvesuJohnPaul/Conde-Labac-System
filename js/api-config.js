// Resolves WHERE the API lives, once, before any other script runs.
//
// ► SET THIS to your permanent ngrok (or Cloudflare) domain once you have it.
//   Then GitHub Pages "just works" with no ?api= parameter, forever.
//   Leave "" if you only run locally. Example:
//     var PERMANENT_API_BASE = "https://conde-labac-8842.ngrok-free.app";
var PERMANENT_API_BASE = "https://conde-labak.onrender.com";

// Resolution priority — on a HOSTED page (GitHub Pages, the tunnel, Railway):
//   1. PERMANENT_API_BASE above, and nothing else.
//
// On a page opened from localhost (development):
//   1. ?api=<url> in the address bar → saved to localStorage (one-off override /
//      testing; ?api= with empty value clears the saved override)
//   2. a previously-saved override in localStorage
//   3. same origin (the Express server serves this page too, so a relative
//      "/api/..." path just works)
//
// The ?api= override used to work everywhere, and it was saved permanently. A
// link to the real site ending in ?api=https://somewhere.else would silently
// re-point that browser — for good — and the next sign-in would send the
// email and password to somewhere.else. A hosted page now ignores the
// parameter and throws away any override an earlier visit saved.
(function () {
  var KEY = "condeApiBase";
  var host = location.hostname;
  var isLocal = host === "localhost" || host === "127.0.0.1" || host === "";
  if (!isLocal) {
    try {
      localStorage.removeItem(KEY);
    } catch (e) {}
    window.API_BASE = PERMANENT_API_BASE;
    return;
  }
  try {
    var override = new URLSearchParams(location.search).get("api");
    if (override !== null) {
      if (override === "") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, override.replace(/\/+$/, "")); // trim trailing /
    }
  } catch (e) {}
  var saved = "";
  try {
    saved = localStorage.getItem(KEY) || "";
  } catch (e) {}
  // saved override wins; else same-origin.
  window.API_BASE = saved;
})();
