"use strict";

// Loads the classic-script app.js into a vm context with a stub DOM so its
// state, storage and import logic can be tested without a browser.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../../app.js");

function stubElement() {
  const handler = {
    get(_target, key) {
      if (key === Symbol.toPrimitive) return () => "";
      if (key === "classList") return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (key === "dataset" || key === "style") return {};
      if (key === "children" || key === "childNodes") return [];
      if (key === "querySelectorAll") return () => [];
      if (key === "querySelector") return () => stubElement();
      if (key === "getBoundingClientRect") return () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 });
      return stubElement();
    },
    set() { return true; },
    apply() { return stubElement(); }
  };
  return new Proxy(function stub() {}, handler);
}

function createMemoryStorage(initial = {}, { quotaChars = Infinity } = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem(key, value) {
      const next = { ...data, [key]: String(value) };
      const size = Object.entries(next).reduce((sum, [k, v]) => sum + k.length + v.length, 0);
      if (size > quotaChars) {
        const error = new Error("The quota has been exceeded.");
        error.name = "QuotaExceededError";
        throw error;
      }
      data[key] = String(value);
    },
    removeItem(key) { delete data[key]; }
  };
}

function loadApp({ store = {}, quotaChars, hostname = "example.github.io", protocol = "https:", extra = {} } = {}) {
  const source = fs.readFileSync(APP_PATH, "utf8").replace(/^initApp\(\)[^\n]*$/m, "/* initApp is started by the tests */");
  const localStorage = createMemoryStorage(store, { quotaChars });
  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Option: function Option(label, value) { return { label, value }; },
    document: {
      querySelector: () => stubElement(),
      querySelectorAll: () => [],
      createElement: () => stubElement(),
      addEventListener() {},
      body: stubElement(),
      head: stubElement(),
      documentElement: stubElement()
    },
    localStorage,
    navigator: { language: "zh-CN", userAgent: "node-test" },
    location: { protocol, hostname },
    structuredClone, URL, URLSearchParams, Intl, JSON, Math, Date, Map, Set, Promise, TextEncoder, TextDecoder, Blob,
    ...extra
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: "app.js" });
  return {
    context,
    localStorage,
    // Evaluate code inside the app's global scope (top-level let/const are visible).
    run: (code) => vm.runInContext(code, context)
  };
}

module.exports = { loadApp, createMemoryStorage, stubElement };
