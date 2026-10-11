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
  assert.equal(tauriConfig.bundle.macOS.signingIdentity, "-");
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

test("every ?v= cache-busting version, in the page and in the service worker, matches version.js", () => {
  const version = require("../version.js");
  const stale = [];
  for (const file of ["index.html", "sw.js"]) {
    for (const match of read(file).matchAll(/\?v=([0-9][0-9.]*)/g)) {
      if (match[1] !== version) stale.push(`${file}: ?v=${match[1]}`);
    }
  }
  assert.deepEqual(stale, []);
});

test("every script and file the page needs is cached, packaged for the extension and bundled for the desktop app", () => {
  const index = read("index.html");
  const scripts = [...index.matchAll(/<script src="\.\/([^"?]+)/g)].map((match) => match[1]);
  const stylesheets = [...index.matchAll(/<link rel="stylesheet" href="\.\/([^"?]+)/g)].map((match) => match[1]);
  const needed = [...scripts, ...stylesheets, "index.html", "dictionary", "icons"];
  assert.ok(scripts.includes("app.js") && scripts.includes("dictionary.js"));

  const worker = read("sw.js");
  const packageScript = read("scripts/package_extension.sh");
  const prepareScript = read("desktop/scripts/prepare-desktop.mjs");
  const lacking = [];
  for (const name of needed) {
    if (!fs.existsSync(path.join(root, name))) lacking.push(`missing file: ${name}`);
    if (!packageScript.includes(name)) lacking.push(`extension package lacks ${name}`);
    if (!prepareScript.includes(`"${name}"`)) lacking.push(`desktop bundle lacks ${name}`);
    if (!/^(dictionary|icons)$/.test(name) && !worker.includes(`./${name}`)) lacking.push(`service worker does not precache ${name}`);
  }
  assert.deepEqual(lacking, []);
  for (const asset of [...worker.matchAll(/"\.\/([^"?]+)/g)].map((match) => match[1]).filter((name) => name && name !== "")) {
    assert.ok(fs.existsSync(path.join(root, asset)), `service worker caches a file that does not exist: ${asset}`);
  }
});

test("every icon the extension manifest and the page refer to exists at its stated size", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const named = [
    ...Object.entries(manifest.icons),
    ...Object.entries(manifest.action.default_icon)
  ];
  for (const [size, file] of named) {
    const png = fs.readFileSync(path.join(root, file));
    assert.equal(png.readUInt32BE(16), Number(size), `${file} should be ${size}px wide`);
    assert.equal(png.readUInt32BE(20), Number(size), `${file} should be ${size}px high`);
  }
  const touchIcon = read("index.html").match(/rel="apple-touch-icon" href="\.\/([^"]+)"/)?.[1];
  assert.ok(touchIcon && fs.existsSync(path.join(root, touchIcon)));
});
