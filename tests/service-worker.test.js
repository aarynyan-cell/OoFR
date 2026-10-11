const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Runs sw.js in a minimal service-worker-like sandbox with an in-memory Cache API.
function createWorker({ origin = "https://example.github.io" } = {}) {
  const stores = new Map();
  const cacheFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name);
    return {
      put: async (request, response) => { entries.set(typeof request === "string" ? request : request.url, response); },
      match: async (request) => entries.get(typeof request === "string" ? request : request.url)
    };
  };
  const listeners = {};
  const state = { networkUp: true, networkCalls: [] };
  const scope = {
    importScripts() {}, skipWaiting() {}, clients: { claim() {} },
    location: new URL(`${origin}/OoFR/sw.js`),
    Request, Response, URL, console,
    caches: {
      open: async (name) => cacheFor(name),
      match: async (request) => {
        for (const entries of stores.values()) {
          const hit = entries.get(typeof request === "string" ? request : request.url);
          if (hit) return hit.clone();
        }
        return undefined;
      },
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name)
    },
    fetch: async (request) => {
      state.networkCalls.push(request.url || String(request));
      if (!state.networkUp) throw new TypeError("Failed to fetch");
      return new Response("fresh", { status: 200 });
    },
    addEventListener: (type, handler) => { listeners[type] = handler; },
    OOFR_VERSION: "1.0.0",
    OOFR_NETWORK_TIMEOUT_MS: 40,
    setTimeout, clearTimeout
  };
  scope.self = scope;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../sw.js"), "utf8"), scope);
  const respond = async (url) => {
    let answer;
    listeners.fetch({ request: new Request(url), respondWith: (value) => { answer = value; } });
    return answer === undefined ? undefined : answer;
  };
  const setFetch = (implementation) => { scope.fetch = async (request) => { state.networkCalls.push(request.url || String(request)); return implementation(request); }; };
  return { stores, state, listeners, respond, setFetch };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test("does not intercept cross-origin requests such as the local Ollama server", async () => {
  const worker = createWorker();
  assert.equal(await worker.respond("http://127.0.0.1:11434/api/tags"), undefined);
  assert.equal(await worker.respond("https://fr.wiktionary.org/w/api.php?titles=maison"), undefined);
  await settle();
  const cached = [...(worker.stores.get("oofr-v1.0.0") || new Map()).keys()];
  assert.deepEqual(cached, []);
});

test("still serves its own files from the cache when offline", async () => {
  const worker = createWorker();
  const url = "https://example.github.io/OoFR/app.js?v=1.0.0";
  await worker.respond(url); // online: fetched and cached
  await settle();
  worker.state.networkUp = false;
  const offline = await worker.respond(url);
  assert.equal(await offline.text(), "fresh");
});

test("an upgrade removes only OoFR's own old caches", async () => {
  const worker = createWorker();
  await (await caches_open(worker, "oofr-v0.9.0")).put("x", new Response("old"));
  await (await caches_open(worker, "other-app-v3")).put("y", new Response("keep"));
  await new Promise((resolve) => {
    worker.listeners.activate({ waitUntil: (promise) => promise.then(resolve) });
  });
  assert.ok(!worker.stores.has("oofr-v0.9.0"));
  assert.ok(worker.stores.has("other-app-v3"));
});

async function caches_open(worker, name) {
  if (!worker.stores.has(name)) worker.stores.set(name, new Map());
  const entries = worker.stores.get(name);
  return { put: async (key, value) => { entries.set(key, value); } };
}

test("a slow network does not stall the app when a cached copy exists, and is awaited when none exists", async () => {
  const worker = createWorker();
  const url = "https://example.github.io/OoFR/app.js?v=1.0.0";
  await worker.respond(url); // cache a fresh copy
  await settle();
  let release;
  worker.setFetch(() => new Promise((resolve) => { release = () => resolve(new Response("slow-fresh", { status: 200 })); }));
  const quick = await worker.respond(url);
  assert.equal(await quick.text(), "fresh", "served from cache after the timeout");
  release();

  const uncached = "https://example.github.io/OoFR/brand-new.js";
  let releaseNew;
  worker.setFetch(() => new Promise((resolve) => { releaseNew = () => resolve(new Response("late", { status: 200 })); }));
  const pending = worker.respond(uncached);
  await new Promise((resolve) => setTimeout(resolve, 80));
  releaseNew();
  assert.equal(await (await pending).text(), "late", "no cached copy: the network answer is still used");
});
