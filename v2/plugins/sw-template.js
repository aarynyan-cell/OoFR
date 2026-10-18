// OoFR 2.0 service worker (generated at build time from plugins/sw-template.js).
// It only caches the app's own files. Learning data lives in IndexedDB and is
// never touched here, so an update can never cost the learner their data.
//
// Cache names start with "oofr2-shell-": 1.0's worker deletes every cache that
// starts with "oofr-", and this worker only ever deletes its own older copies.
const CACHE_PREFIX = "oofr2-shell-";
const CACHE_NAME = `${CACHE_PREFIX}__VERSION__`;
// Dictionary shards stay cached across app updates (a different prefix).
const DICTIONARY_CACHE = "oofr2-dictionary";
const DICTIONARY_VERSION = "__DICTIONARY_VERSION__";
const ASSETS = __ASSETS__;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS.map((asset) => new Request(asset, { cache: "reload" }))))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => pruneDictionary().catch(() => {}))
      .then(() => self.clients.claim())
  );
});

// The page asks for this after the learner taps "刷新" on the update notice.
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Other hosts (a local AI server, dictionaries) always go to the network.
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(openPage(request));
    return;
  }
  if (url.pathname.includes("/dictionary/")) {
    event.respondWith(dictionaryFile(request));
    return;
  }
  event.respondWith(fromCache(request));
});

// Shard addresses carry the dictionary version (?v=…), so a cached shard never
// goes stale: it answers at once and offline, without spending mobile data.
async function dictionaryFile(request) {
  const cache = await caches.open(DICTIONARY_CACHE);
  const cached = await cache.match(request.url, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.status === 200) cache.put(request.url, response.clone()).catch(() => {});
  return response;
}

// Shards of an older dictionary build are dropped once a new one is in use.
async function pruneDictionary() {
  const cache = await caches.open(DICTIONARY_CACHE);
  const requests = await cache.keys();
  await Promise.all(requests.filter((request) => new URL(request.url).searchParams.get("v") !== DICTIONARY_VERSION).map((request) => cache.delete(request)));
}

// Look files up by address only: module scripts and stylesheets are requested
// with an Origin header, and a server that answers "Vary: Origin" would
// otherwise make the cached copy never match.
async function fromCache(request) {
  const cached = await caches.match(request.url, { ignoreSearch: true, ignoreVary: true });
  return cached || fetch(request);
}

// Pages: the cached shell opens instantly and works offline; built files have
// content hashes in their names, so a new version arrives through a new worker.
async function openPage(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = (await cache.match("./index.html")) || (await cache.match("./"));
  if (cached) return cached;
  return fetch(request);
}
