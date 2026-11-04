// Service worker: makes the app installable and usable offline.
// - App shell (HTML/CSS/JS/icons): network first, cached copy when offline.
// - API reads (GET /api/...): network first, falling back to the last cached copy.
// - API writes and logins: always go to the network.
// Bump SHELL_CACHE when shell files change so old caches get cleared.
importScripts("config.js"); // sets self.API_BASE

const SHELL_CACHE = "community-board-v4";
const API_CACHE = "community-board-api"; // must match app.js
const SHELL = ["./", "index.html", "styles.css", "app.js", "config.js", "manifest.json", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

// API_BASE is "" when running locally (same origin as the page).
const apiRoot = new URL(`${self.API_BASE || self.location.origin}/api/`).href;
const indexUrl = new URL("index.html", self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== API_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  if (req.url.startsWith(apiRoot)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(API_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req, { cacheName: API_CACHE }).then(
            (cached) =>
              cached ||
              new Response(JSON.stringify({ error: "You're offline and this page hasn't been loaded before." }), {
                status: 503,
                headers: { "Content-Type": "application/json" },
              })
          )
        )
    );
    return;
  }

  if (new URL(req.url).origin !== self.location.origin) return;

  // App files: network first so updates show up right away; cached copy when offline.
  // Page navigations all use the single app shell.
  const key = req.mode === "navigate" ? indexUrl : req;
  event.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(key, copy));
        }
        return res;
      })
      .catch(() => caches.match(key, { cacheName: SHELL_CACHE }))
  );
});
