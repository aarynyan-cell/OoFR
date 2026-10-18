import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Plugin } from "vite";
import { dictionaryVersion } from "./versions.ts";

// Writes dist/sw.js after the build: it lists every built file so the app opens
// offline, and its cache name changes whenever any file changes.
export function serviceWorker(): Plugin {
  let outDir = "dist";
  return {
    name: "oofr-service-worker",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      // .woff copies are only for browsers without woff2 support; none of our targets need them offline.
      // The dictionary is far too big to download up front: its shards are cached as words are looked up.
      const files = listFiles(outDir).filter(
        (file) => file !== "sw.js" && !file.endsWith(".map") && !file.endsWith(".woff") && !file.startsWith("dictionary/")
      );
      const template = readFileSync(new URL("./sw-template.js", import.meta.url), "utf8");
      const hash = createHash("sha256").update(template);
      files.forEach((file) => hash.update(file).update(readFileSync(join(outDir, file))));
      const version = hash.digest("hex").slice(0, 12);
      const assets = ["./", ...files.map((file) => `./${file}`)];
      writeFileSync(
        join(outDir, "sw.js"),
        template
          .replace("__VERSION__", version)
          .replace("__DICTIONARY_VERSION__", dictionaryVersion())
          .replace("__ASSETS__", JSON.stringify(assets, null, 2))
      );
    }
  };
}

function listFiles(root: string, dir = root): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listFiles(root, path);
    return [relative(root, path).split(sep).join("/")];
  });
}
