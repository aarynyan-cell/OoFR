import { existsSync, readFileSync } from "node:fs";

// Version strings baked into the build: the app's own and the dictionary's
// (shard addresses carry it, so caches can never serve an outdated shard).
export function appVersion(): string {
  return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
}

// Covers the shards and the AI-translated Chinese layer, so either changing
// gives shards new addresses.
export function dictionaryVersion(): string {
  const read = (name: string) => {
    const file = new URL(`../../dictionary/${name}`, import.meta.url);
    return existsSync(file) ? String((JSON.parse(readFileSync(file, "utf8")) as { version?: string }).version || "") : "";
  };
  const base = read("manifest.json") || "none";
  const zh = read("zh-manifest.json");
  return zh ? `${base}+zh.${zh}` : base;
}
