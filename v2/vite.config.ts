import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { devLogReceiver } from "./plugins/devlog.ts";
import { dictionaryFiles } from "./plugins/dictionary.ts";
import { serviceWorker } from "./plugins/service-worker.ts";
import { appVersion, dictionaryVersion } from "./plugins/versions.ts";

export default defineConfig({
  // Relative paths: the same build runs from a GitHub Pages sub-folder, the Mac app and a local server.
  base: "./",
  plugins: [react(), dictionaryFiles(), serviceWorker(), devLogReceiver()],
  // Phone tests over https (an iPhone records only on a secure address), with a
  // certificate made on this Mac (v2/.dev-cert, never committed): OOFR_HTTPS=1.
  server: process.env.OOFR_HTTPS
    ? { https: { key: readFileSync(".dev-cert/key.pem"), cert: readFileSync(".dev-cert/cert.pem") } }
    : undefined,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
    __DICTIONARY_VERSION__: JSON.stringify(dictionaryVersion())
  },
  build: {
    outDir: "dist",
    target: "es2022",
    // Keep fonts and icons as files so the service worker can cache them for offline use.
    assetsInlineLimit: 0
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
