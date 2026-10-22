import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

// Test versions only: hands the online AI keys in v2/.env.local (never
// committed) to a page opened on this Mac itself, so the online version can be
// tried without typing the keys or passing them around. Other devices on the
// network get nothing; builds have no such address.
const FILE = fileURLToPath(new URL("../.env.local", import.meta.url));
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function readKeys(): { siliconflow: string[]; zhipu: string[] } {
  const keys = { siliconflow: [] as string[], zhipu: [] as string[] };
  if (!existsSync(FILE)) return keys;
  for (const line of readFileSync(FILE, "utf8").split(/\r?\n/)) {
    const match = /^\s*(SILICONFLOW|ZHIPU)_KEY_\d+\s*=\s*["']?([^"'\s]+)["']?\s*$/.exec(line);
    if (match) keys[match[1] === "ZHIPU" ? "zhipu" : "siliconflow"].push(match[2]);
  }
  return keys;
}

export function devKeys(): Plugin {
  return {
    name: "oofr-devkeys",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__oofr_dev_keys", (request, response) => {
        if (!LOOPBACK.has(request.socket.remoteAddress ?? "")) {
          response.statusCode = 403;
          response.end();
          return;
        }
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Cache-Control", "no-store");
        response.end(JSON.stringify(readKeys()));
      });
    }
  };
}
