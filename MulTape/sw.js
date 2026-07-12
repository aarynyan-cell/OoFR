const CACHE_NAME = "multape-v1.0.1-alpha-core";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=1.0.1-alpha",
  "./app/main.js?v=1.0.1-alpha",
  "./app/languages.js",
  "./app/i18n.js",
  "./app/lexicon-store.js",
  "./lexicons/manifest.json",
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

  const url = new URL(event.request.url);
  const acceptsHtml = event.request.headers.get("accept")?.includes("text/html");
  if (event.request.mode === "navigate" || acceptsHtml) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          cacheOkResponse(event.request, response);
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  if (url.pathname.includes("/lexicons/") && url.pathname.endsWith(".json")) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      cacheOkResponse(event.request, response);
      return response;
    }))
  );
});

function cacheOkResponse(request, response) {
  if (!response?.ok) return;
  const copy = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
}
