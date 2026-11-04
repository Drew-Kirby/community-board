// Where the API lives.
// - Running locally (npm start): the same server serves the API.
// - On GitHub Pages: the API is the Render service.
// Loaded by both the page and the service worker, so it uses `self` instead of `window`.
self.API_BASE = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? ""
  : "https://community-board-rji1.onrender.com"; // <-- your Render URL (no trailing slash)
