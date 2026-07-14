// Resolves WHERE the API lives, once, before any other script runs.
//
// ► SET THIS to your permanent ngrok (or Cloudflare) domain once you have it.
//   Then GitHub Pages "just works" with no ?api= parameter, forever.
//   Leave "" if you only run locally. Example:
//     var PERMANENT_API_BASE = "https://conde-labac-8842.ngrok-free.app";
var PERMANENT_API_BASE = "https://graffiti-grunge-doorway.ngrok-free.dev";

// Resolution priority:
//   1. ?api=<url> in the address bar → saved to localStorage (one-off override /
//      testing; ?api= with empty value clears the saved override)
//   2. a previously-saved override in localStorage
//   3. PERMANENT_API_BASE above — used when the page is NOT served locally
//      (i.e. on GitHub Pages)
//   4. same origin (local dev: the Express server serves this page too, so a
//      relative "/api/..." path just works)
(function () {
  var KEY = "condeApiBase";
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
  var host = location.hostname;
  var isLocal = host === "localhost" || host === "127.0.0.1" || host === "";
  // saved override wins; else the permanent domain when hosted; else same-origin.
  window.API_BASE = saved || (isLocal ? "" : PERMANENT_API_BASE);
})();
