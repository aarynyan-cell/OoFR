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
  "./dictionary/curated.json",
  "./app-state.js?v=1.0.0",
  "./app-speech.js?v=1.0.0",
  "./app-course-player.js?v=1.0.0",
  "./app-local-ai.js?v=1.0.0",
  "./app-words.js?v=1.0.0",
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
      // Other apps on the same origin (e.g. other GitHub Pages projects) keep their caches.
      keys.filter((key) => key.startsWith("oofr-") && key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // Only our own files are cached. Cross-origin GETs (the local Ollama server,
  // Wiktionary) must reach the network untouched; answering them from cache
  // would report a stopped Ollama as still running.
  if (new URL(event.request.url).origin !== self.location.origin) return;

  const acceptsHtml = event.request.headers.get("accept")?.includes("text/html");
  const isPage = event.request.mode === "navigate" || acceptsHtml;
  event.respondWith(networkFirst(event.request, isPage ? "./index.html" : ""));
});

// Fresh files when the network answers; the cached copy when it fails or is
// too slow (a weak phone connection must not stall opening the app).
async function networkFirst(request, pageFallback) {
  const limit = self.OOFR_NETWORK_TIMEOUT_MS || 4000;
  const network = fetch(request, { cache: "no-cache" }).then((response) => {
    cacheOkResponse(request, response);
    return response;
  });
  let timer = 0;
  const outcome = await Promise.race([
    network.catch(() => null),
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), limit); })
  ]);
  clearTimeout(timer);
  if (outcome) return outcome;
  const cached = (await caches.match(request)) || (pageFallback ? await caches.match(pageFallback) : undefined);
  // Nothing cached: keep waiting for the network (or fail the way it fails).
  return cached || network;
}

function cacheOkResponse(request, response) {
  // Partial (206) responses cannot be cached.
  if (!response?.ok || response.status !== 200) return;
  const copy = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
}
