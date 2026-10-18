import { existsSync, readFileSync } from "node:fs";

// Version strings baked into the build: the app's own and the dictionary's
// (shard addresses carry it, so caches can never serve an outdated shard).
export function appVersion(): string {
  return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
}

export function dictionaryVersion(): string {
  const manifest = new URL("../../dictionary/manifest.json", import.meta.url);
  if (!existsSync(manifest)) return "none";
  return String((JSON.parse(readFileSync(manifest, "utf8")) as { version?: string }).version || "none");
}
