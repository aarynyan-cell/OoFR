const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("index.html stays valid under the extension and desktop CSP (no inline script, handlers or javascript: URLs)", () => {
  const html = read("index.html");
  const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter((match) => !/\bsrc=/.test(match[1]));
  assert.deepEqual(inlineScripts.map((match) => match[0].slice(0, 60)), []);
  assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /<(?:link|script)[^>]+(?:https?:)?\/\/(?!ai\.google\.dev)/i, "no external scripts or stylesheets");
});

test("every element app.js looks up by id exists in index.html (known leftovers aside)", () => {
  const app = read("app.js");
  const html = read("index.html");
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  const referenced = new Set([...app.matchAll(/querySelector\("#([A-Za-z0-9_-]+)"\)/g)].map((match) => match[1]));
  // Left over from an older player layout; every use is guarded. Remove them with the dead-code clean-up.
  const knownLeftovers = new Set(["courseProgressFill", "coursePrevBtn", "coursePlayBtn", "courseNextBtn", "courseSentenceLoop", "courseWordHelpBtn", "courseExplanationTitle", "courseExplanationBody"]);
  const missing = [...referenced].filter((id) => !ids.has(id) && !knownLeftovers.has(id));
  assert.deepEqual(missing, []);
});

test("every CSS custom property that is used is defined", () => {
  const css = read("styles.css");
  const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1]));
  const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/gi)].map((match) => match[1]));
  // Set from JavaScript at run time.
  const runtime = new Set(["--category-color", "--material-color"]);
  const undefinedTokens = [...used].filter((token) => !defined.has(token) && !runtime.has(token));
  assert.deepEqual(undefinedTokens, []);
});

test("form fields are at least 16px on iOS, where smaller text makes Safari zoom the page", () => {
  const css = read("styles.css");
  const block = css.match(/@supports \(-webkit-touch-callout: none\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(block, /select/);
  assert.match(block, /textarea/);
  assert.match(block, /font-size:\s*16px/);
  assert.doesNotMatch(read("index.html"), /maximum-scale|user-scalable\s*=\s*no/i, "page zoom must stay available");
});

test("the player menus open below the sticky player so they stay on screen", () => {
  const css = read("styles.css");
  assert.match(css, /\.course-bottom-player \.course-custom-options,\s*\.course-bottom-player \.course-voice-options \{[^}]*top:\s*calc\(100% \+ 8px\);[^}]*bottom:\s*auto/);
});

test("the page offers what iOS needs to treat it as an app", () => {
  const html = read("index.html");
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /name="apple-mobile-web-app-capable"/);
  assert.match(html, /name="format-detection" content="telephone=no"/);
  assert.match(html, /name="description"/);
});
