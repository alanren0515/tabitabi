const CACHE_NAME = "tabitabi-shell-v24";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/src/styles.css",
  "/src/app.js",
  "/src/analysis-queue.js",
  "/src/analyzer.js",
  "/src/candidate-selection.js",
  "/src/capabilities.js",
  "/src/client-routes.js",
  "/src/data.js",
  "/src/event-client.js",
  "/src/image-input.js",
  "/src/privacy-data.js",
  "/src/recent-analyses.js",
  "/src/saved-plans.js",
  "/src/screenshot-extraction.js",
  "/src/settings.js",
  "/src/share-result.js",
  "/src/shared-input.js",
  "/src/terms-data.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("tabitabi-shell-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/")));
    return;
  }

  if (!APP_SHELL.includes(url.pathname)) return;
  event.respondWith(caches.match(url.pathname).then((cached) => cached || fetch(request)));
});
