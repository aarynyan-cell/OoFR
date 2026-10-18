import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { serviceWorker } from "./plugins/service-worker.ts";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  // Relative paths: the same build runs from a GitHub Pages sub-folder, the Mac app and a local server.
  base: "./",
  plugins: [react(), serviceWorker()],
  define: {
    __APP_VERSION__: JSON.stringify(version)
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
