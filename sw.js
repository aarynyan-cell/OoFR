importScripts("./version.js?v=1.0.0");

const CACHE_NAME = `oofr-v${self.OOFR_VERSION || "1.0.0"}`;
const APP_ASSETS = [
  "./",
  "./index.html",
  "./reset.html",
  "./version.js?v=1.0.0",
  "./learning-package.js?v=1.0.0",
  "./styles.css?v=1.0.0",
  "./desktop-ai.js?v=1.0.0",
  "./ollama-client.js?v=1.0.0",
  "./dictionary.js?v=1.0.0",
  "./dictionary/manifest.json",
  "./app.js?v=1.0.0",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.all(
      APP_ASSETS.map((asset) => fetch(asset, { cache: "reload" }).then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to cache ${asset}: ${response.status}`);
        }
        return cache.put(asset, response);
      }))
    ))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const acceptsHtml = event.request.headers.get("accept")?.includes("text/html");
  if (event.request.mode === "navigate" || acceptsHtml) {
    event.respondWith(
      fetch(event.request, { cache: "no-cache" })
        .then((response) => {
          cacheOkResponse(event.request, response);
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  event.respondWith(
    fetch(event.request, { cache: "no-cache" })
      .then((response) => {
        cacheOkResponse(event.request, response);
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

function cacheOkResponse(request, response) {
  if (!response?.ok) return;
  const copy = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
}
