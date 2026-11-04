// Service worker: makes the app installable and usable offline.
// - App shell (HTML/CSS/JS/icons): served from cache, refreshed in the background.
// - API reads (GET /api/...): network first, falling back to the last cached copy.
// - API writes (POST/PATCH/DELETE): always go to the network.
// Bump CACHE when shell files change so old caches get cleared.
const CACHE = "community-board-v1";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then(
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

  // Page navigations all use the single app shell.
  const key = req.mode === "navigate" ? "/index.html" : req;
  event.respondWith(
    caches.match(key).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(key, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
