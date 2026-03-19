const CACHE_NAME = "spectrum-plotter-pwa-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles/main.css",
  "./src/main.js",
  "./src/state.js",
  "./src/ui.js",
  "./src/parser.js",
  "./src/process.js",
  "./src/peaks.js",
  "./src/plot.js",
  "./src/export.js",
  "./manifest.webmanifest",
  "./assets/icons/icon.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
