import { copyFileSync, createReadStream, existsSync, mkdirSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Connect, Plugin } from "vite";

// The phone's own voices (src/speech/piper) need the espeak-ng phonemizer's
// files. They are served at ./voice-engine/ (dev server) and copied there by a
// build, outside the offline shell: only a learner who downloads a voice
// fetches them, once. (ONNX Runtime's WebAssembly is a built asset already.)
const modules = fileURLToPath(new URL("../node_modules/", import.meta.url));
export const ENGINE_FILES: Record<string, string> = {
  "piper_phonemize.js": "@diffusionstudio/piper-wasm/build/piper_phonemize.js",
  "piper_phonemize.wasm": "@diffusionstudio/piper-wasm/build/piper_phonemize.wasm",
  "piper_phonemize.data": "@diffusionstudio/piper-wasm/build/piper_phonemize.data"
};

function serve(): Connect.NextHandleFunction {
  return (request, response: ServerResponse, next) => {
    const name = decodeURIComponent((request.url ?? "/").split("?")[0]).replace(/^\//, "");
    const source = ENGINE_FILES[name];
    if (!source) return next();
    response.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : name.endsWith(".js") ? "text/javascript" : "application/octet-stream");
    createReadStream(join(modules, source)).pipe(response);
  };
}

export function voiceEngine(): Plugin {
  let outDir = "dist";
  return {
    name: "oofr-voice-engine",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use("/voice-engine", serve());
    },
    configurePreviewServer(server) {
      server.middlewares.use("/voice-engine", serve());
    },
    closeBundle() {
      const target = join(outDir, "voice-engine");
      mkdirSync(target, { recursive: true });
      for (const [name, source] of Object.entries(ENGINE_FILES)) {
        if (existsSync(join(modules, source))) copyFileSync(join(modules, source), join(target, name));
      }
    }
  };
}
