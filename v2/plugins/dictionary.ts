import { cpSync, createReadStream, existsSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Connect, Plugin } from "vite";

// The offline dictionary (about 100 MB of shards) lives once, in the repository's
// dictionary/ folder shared with 1.0. The dev and preview servers serve it at
// ./dictionary/, and a build copies it next to index.html.
const SOURCE = fileURLToPath(new URL("../../dictionary/", import.meta.url));

function serve(): Connect.NextHandleFunction {
  return (request, response: ServerResponse, next) => {
    const path = decodeURIComponent((request.url ?? "/").split("?")[0]);
    const file = normalize(join(SOURCE, path));
    if (!file.startsWith(SOURCE.endsWith(sep) ? SOURCE : SOURCE + sep) || !existsSync(file) || !statSync(file).isFile()) {
      next();
      return;
    }
    response.setHeader("Content-Type", file.endsWith(".json") ? "application/json; charset=utf-8" : "application/octet-stream");
    createReadStream(file).pipe(response);
  };
}

export function dictionaryFiles(): Plugin {
  let outDir = "dist";
  return {
    name: "oofr-dictionary",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use("/dictionary", serve());
    },
    configurePreviewServer(server) {
      server.middlewares.use("/dictionary", serve());
    },
    closeBundle() {
      if (!existsSync(SOURCE)) return;
      cpSync(SOURCE, join(outDir, "dictionary"), { recursive: true, filter: (file) => !file.endsWith("README.md") });
    }
  };
}
