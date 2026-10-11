const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function runWorker({ contexts, getContextsThrows = false, getContextsMissing = false } = {}) {
  const calls = [];
  let handler;
  const chrome = {
    action: { onClicked: { addListener: (fn) => { handler = fn; } } },
    runtime: {
      getURL: (name) => `chrome-extension://abc/${name}`,
      ...(getContextsMissing ? {} : {
        getContexts: async () => {
          if (getContextsThrows) throw new Error("not supported");
          return contexts || [];
        }
      })
    },
    tabs: {
      update: async (id, props) => calls.push(["tabs.update", id, props]),
      create: async (props) => calls.push(["tabs.create", props])
    },
    windows: { update: async (id, props) => calls.push(["windows.update", id, props]) }
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../extension-service-worker.js"), "utf8"), { chrome });
  // Objects created inside the vm have another prototype; compare plain JSON.
  return { click: () => handler(), get calls() { return JSON.parse(JSON.stringify(calls)); } };
}

test("clicking the toolbar button opens OoFR when it is not open yet", async () => {
  const worker = runWorker({ contexts: [] });
  await worker.click();
  assert.deepEqual(worker.calls, [["tabs.create", { url: "chrome-extension://abc/index.html" }]]);
});

test("clicking it again brings the open OoFR tab forward instead of opening a second copy", async () => {
  const worker = runWorker({ contexts: [
    { documentUrl: "chrome-extension://abc/options.html", tabId: 4, windowId: 1 },
    { documentUrl: "chrome-extension://abc/index.html", tabId: 9, windowId: 2 }
  ] });
  await worker.click();
  assert.deepEqual(worker.calls, [
    ["tabs.update", 9, { active: true }],
    ["windows.update", 2, { focused: true }]
  ]);
});

test("if the browser cannot list its tabs, a new tab is opened", async () => {
  for (const options of [{ getContextsThrows: true }, { getContextsMissing: true }]) {
    const worker = runWorker(options);
    await worker.click();
    assert.deepEqual(worker.calls, [["tabs.create", { url: "chrome-extension://abc/index.html" }]]);
  }
});
