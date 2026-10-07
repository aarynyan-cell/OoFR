import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, "..");
const rootDir = resolve(desktopDir, "..");
const distDir = join(desktopDir, "dist");

const files = [
  "index.html",
  "reset.html",
  "styles.css",
  "version.js",
  "learning-package.js",
  "desktop-ai.js",
  "ollama-client.js",
  "dictionary.js",
  "dictionary",
  "app.js",
  "lexicon.js",
  "manifest.webmanifest",
  "sw.js",
  "icons"
];

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
for (const item of files) {
  await cp(join(rootDir, item), join(distDir, item), { recursive: true });
}
