const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("keeps every public release surface on version 1.0.0", () => {
  const version = require("../version.js");
  const extensionManifest = JSON.parse(read("manifest.json"));
  const desktopPackage = JSON.parse(read("desktop/package.json"));
  const tauriConfig = JSON.parse(read("desktop/src-tauri/tauri.conf.json"));
  const index = read("index.html");
  const serviceWorker = read("sw.js");
  const dictionaryClient = read("dictionary.js");

  assert.equal(version, "1.0.0");
  assert.equal(extensionManifest.version, version);
  assert.equal(desktopPackage.version, version);
  assert.equal(tauriConfig.version, version);
  assert.match(index, /OoFR · v1\.0\.0/);
  assert.doesNotMatch(index, /v=0\.25\.4|v0\.25\.4/);
  assert.match(serviceWorker, /version\.js\?v=1\.0\.0/);
  assert.match(dictionaryClient, /global\.OOFR_VERSION \|\| "1\.0\.0"/);
  assert.doesNotMatch(dictionaryClient, /0\.25\.4/);
});

test("ships cloud sync as disabled and makes no Supabase script load", () => {
  const index = read("index.html");
  const app = read("app.js");
  const config = read("supabase-config.js");

  assert.match(index, /该功能暂未开放/);
  assert.doesNotMatch(index, /<script[^>]+(?:supabase-config|cloud-sync)/);
  assert.match(app, /const CLOUD_SYNC_ENABLED = false/);
  assert.doesNotMatch(config, /https:\/\/[^"']+\.supabase\.co/);
  assert.match(config, /url: ""/);
  assert.match(config, /anonKey: ""/);
});

test("prepares the complete offline desktop web payload", () => {
  const prepareScript = read("desktop/scripts/prepare-desktop.mjs");
  for (const required of ["learning-package.js", "desktop-ai.js", "dictionary", "manifest.webmanifest"]) {
    assert.match(prepareScript, new RegExp(required.replace(".", "\\.")));
  }
});
