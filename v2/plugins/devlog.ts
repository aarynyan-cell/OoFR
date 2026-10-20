import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

// Test versions only: what a real phone reports while it is being tested
// (src/app/devlog.ts) is written to v2/devlog.log on the Mac. The dev server
// has this; published builds have neither the sender nor the receiver.
const LOG = fileURLToPath(new URL("../devlog.log", import.meta.url));

export function devLogReceiver(): Plugin {
  return {
    name: "oofr-devlog",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__oofr_log", (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end();
          return;
        }
        let body = "";
        request.on("data", (chunk) => {
          if (body.length < 65536) body += chunk;
        });
        request.on("end", () => {
          appendFileSync(LOG, `${new Date().toISOString()} ${request.socket.remoteAddress ?? "?"} ${body.replace(/\s+/g, " ").slice(0, 65536)}\n`);
          response.statusCode = 204;
          response.end();
        });
      });
    }
  };
}
