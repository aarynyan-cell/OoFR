const test = require("node:test");
const assert = require("node:assert/strict");

const { loadApp } = require("./helpers/load-app.js");
const { createFakeIndexedDb } = require("./helpers/fake-indexeddb.js");

const APP_KEY = "oofr.app.v1";
const wait = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));
const json = (value) => JSON.parse(JSON.stringify(value));

// A saved state as an older version (localStorage only) wrote it.
function legacyState(title = "旧版本里的课程") {
  const app = loadApp();
  return JSON.stringify(app.run(`(() => { const s = createStarterState({}); s.albums[0].title = ${JSON.stringify(title)}; return s; })()`));
}

function newApp({ store = {}, indexedDB = createFakeIndexedDb(), extra = {}, ...options } = {}) {
  const app = loadApp({ store, extra: { indexedDB, ...extra }, ...options });
  app.run("renderMy = function () {}; queueSyncedSettings = function () {};");
  return { app, indexedDB };
}

const storedRecord = (indexedDB, key = APP_KEY) => indexedDB.databases.get("oofr-state")?.stores.get("kv")?.get(key);

test("the real start-up completes (a constant used too early would break it silently)", async () => {
  const errors = [];
  const sandboxConsole = { log() {}, info() {}, warn() {}, error: (...args) => errors.push(args.map(String).join(" ")) };
  const indexedDB = createFakeIndexedDb();
  const app = loadApp({ startApp: true, store: { [APP_KEY]: legacyState() }, extra: { indexedDB, console: sandboxConsole } });
  await wait(80);
  assert.equal(app.run("typeof state"), "object");
  assert.equal(app.run("state.albums[0].title"), "旧版本里的课程");
  assert.deepEqual(errors.filter((line) => /failed to start|Cannot access|before initialization/i.test(line)), []);
  assert.ok(storedRecord(indexedDB), "the state was copied into IndexedDB");
});

test("first start after the upgrade copies the saved state into IndexedDB and leaves the old copy alone", async () => {
  const legacy = legacyState();
  const { app, indexedDB } = newApp({ store: { [APP_KEY]: legacy } });
  const loaded = await app.run("loadAppState()");
  assert.equal(loaded.albums[0].title, "旧版本里的课程");
  assert.equal(JSON.parse(storedRecord(indexedDB).json).albums[0].title, "旧版本里的课程");
  assert.equal(app.localStorage.getItem(APP_KEY), legacy, "the localStorage copy is untouched");
});

test("later starts read IndexedDB, and saves go there instead of localStorage", async () => {
  const { app, indexedDB } = newApp({ store: { [APP_KEY]: legacyState() } });
  await app.run("loadAppState().then((loaded) => { state = loaded; })");
  app.run("state.albums[0].title = '在 IndexedDB 里改过'; persist();");
  await wait();
  assert.equal(JSON.parse(storedRecord(indexedDB).json).albums[0].title, "在 IndexedDB 里改过");
  assert.equal(JSON.parse(app.localStorage.getItem(APP_KEY)).albums[0].title, "旧版本里的课程", "no second copy is kept in sync");

  // A new page load with the localStorage copy gone still finds the data.
  const next = newApp({ indexedDB });
  const reloaded = await next.app.run("loadAppState()");
  assert.equal(reloaded.albums[0].title, "在 IndexedDB 里改过");
});

test("a fresh install starts empty on IndexedDB without touching localStorage", async () => {
  const { app, indexedDB } = newApp();
  const loaded = await app.run("loadAppState()");
  assert.equal(loaded.albums[0].title, "入门练习", "the starter lessons");
  app.run("state = ensureStateShape(createStarterState({})); persist();");
  await wait();
  assert.ok(storedRecord(indexedDB));
  assert.equal(app.localStorage.getItem(APP_KEY), null);
});

test("when IndexedDB cannot be opened the session runs on localStorage and marks it as the newer copy", async () => {
  const indexedDB = createFakeIndexedDb({ failOpen: true });
  const { app } = newApp({ store: { [APP_KEY]: legacyState() }, indexedDB });
  const loaded = await app.run("loadAppState()");
  assert.equal(loaded.albums[0].title, "旧版本里的课程");
  app.run("state = loaded = ensureStateShape(JSON.parse(localStorage.getItem('oofr.app.v1'))); state.albums[0].title = '只存在 localStorage 里'; persist();");
  await wait();
  assert.equal(JSON.parse(app.localStorage.getItem(APP_KEY)).albums[0].title, "只存在 localStorage 里");
  assert.ok(app.localStorage.getItem("oofr.state.legacy-newer"));
});

test("the next start prefers that newer localStorage copy over an older IndexedDB record", async () => {
  const indexedDB = createFakeIndexedDb();
  // Session 1: IndexedDB works and holds "版本一".
  const first = newApp({ store: { [APP_KEY]: legacyState("版本一") }, indexedDB });
  await first.app.run("loadAppState().then((loaded) => { state = loaded; })");
  assert.ok(storedRecord(indexedDB));
  // Session 2: IndexedDB fails; the learner edits on localStorage ("版本二") and a marker is left.
  const store = { ...first.app.localStorage.data };
  const second = newApp({ store, indexedDB: createFakeIndexedDb({ failOpen: true }) });
  await second.app.run("loadAppState().then((loaded) => { state = loaded; state.albums[0].title = '版本二'; persist(); })");
  await wait();
  const afterSecond = { ...second.app.localStorage.data };
  assert.equal(JSON.parse(afterSecond[APP_KEY]).albums[0].title, "版本二");
  // Session 3: IndexedDB is back, with the older "版本一" record.
  const third = newApp({ store: afterSecond, indexedDB });
  const loaded = await third.app.run("loadAppState()");
  assert.equal(loaded.albums[0].title, "版本二", "the newer data wins");
  assert.equal(JSON.parse(storedRecord(indexedDB).json).albums[0].title, "版本二", "and is copied into IndexedDB");
  assert.equal(third.app.localStorage.getItem("oofr.state.legacy-newer"), null, "the marker is cleared");
});

test("an IndexedDB that never answers is given up on after a few seconds", async () => {
  const fastTimers = (fn, ms, ...args) => setTimeout(fn, ms >= 1000 ? 20 : ms, ...args);
  const { app } = newApp({ store: { [APP_KEY]: legacyState() }, indexedDB: createFakeIndexedDb({ hangOpen: true }), extra: { setTimeout: fastTimers } });
  const loaded = await app.run("loadAppState()");
  assert.equal(loaded.albums[0].title, "旧版本里的课程");
});

test("a failed IndexedDB write is reported, not hidden behind a second copy", async () => {
  const { app, indexedDB } = newApp();
  await app.run("loadAppState().then((loaded) => { state = loaded; })");
  indexedDB.switches.failPut = true;
  app.run("persist()");
  await wait();
  assert.equal(app.run("storageNotice && storageNotice.kind"), "save-failed");
  assert.equal(app.localStorage.getItem(APP_KEY), null);
});

test("the import backup and the raw-data download use the active store", async () => {
  const { app, indexedDB } = newApp({ store: { [APP_KEY]: legacyState() } });
  await app.run("loadAppState().then((loaded) => { state = loaded; })");
  app.run("renderAll = function () {}; syncSettingsControls = function () {}; window.confirm = () => true;");
  const incoming = app.run("JSON.stringify(createStarterState({}))");
  assert.equal((await app.run(`importBackupText(${JSON.stringify(incoming)})`)).imported, true);
  assert.ok(storedRecord(indexedDB, "oofr.app.v1.backup"), "the pre-import copy is in IndexedDB");
  assert.equal(await app.run("storageDriver.hasLocal('oofr.app.v1.backup')"), true);
  const raw = await app.run("storageDriver.getRaw('oofr.app.v1')");
  assert.equal(JSON.parse(raw).albums.length >= 1, true);
});

test("windows sharing the database tell each other when one of them saved", async () => {
  const bus = new Set();
  class FakeChannel {
    constructor() { bus.add(this); }
    postMessage(message) { bus.forEach((other) => { if (other !== this) setTimeout(() => other.onmessage?.({ data: message }), 0); }); }
  }
  const indexedDB = createFakeIndexedDb();
  const writer = newApp({ indexedDB, extra: { BroadcastChannel: FakeChannel } });
  const reader = newApp({ indexedDB, extra: { BroadcastChannel: FakeChannel } });
  reader.app.run("storageDriver.onExternalChange(handleExternalStateChange);");
  await writer.app.run("loadAppState().then((loaded) => { state = loaded; })");
  writer.app.run("persist()");
  await wait(30);
  assert.equal(reader.app.run("storageNotice && storageNotice.kind"), "changed-elsewhere");
  assert.equal(writer.app.run("storageNotice"), null, "the writer does not warn itself");
});
