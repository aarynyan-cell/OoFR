import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  V1_AUDIO_DB,
  V1_AUDIO_STORE,
  V1_LEGACY_NEWER_KEY,
  V1_STATE_DB,
  V1_STATE_KEY,
  V1_STATE_STORE,
  readV1Recordings,
  readV1State
} from "../src/migrate/v1-sources";
import { databaseNames, memoryStorage, putValue } from "./helpers/v1-browser";

const stateWith = (title: string) => JSON.stringify({ albums: [{ id: "a", title }] });

describe("finding 1.0 data on the device", () => {
  it("reports nothing when 1.0 was never used, and creates no 1.0 database", async () => {
    const indexedDB = new IDBFactory();
    const result = await readV1State({ indexedDB, localStorage: memoryStorage() });
    expect(result).toEqual({ status: "none" });
    expect(await databaseNames(indexedDB)).toEqual([]);
    expect(await readV1Recordings(["x"], { indexedDB })).toEqual(new Map());
    expect(await databaseNames(indexedDB)).toEqual([]);
  });

  it("reads 1.0.0 data from localStorage", async () => {
    const result = await readV1State({ indexedDB: new IDBFactory(), localStorage: memoryStorage({ [V1_STATE_KEY]: stateWith("本地") }) });
    expect(result).toMatchObject({ status: "found", from: "localstorage", raw: { albums: [{ title: "本地" }] } });
  });

  it("prefers the IndexedDB copy the 1.0 refactor writes", async () => {
    const indexedDB = new IDBFactory();
    await putValue(indexedDB, V1_STATE_DB, V1_STATE_STORE, V1_STATE_KEY, { savedAt: "2026-10-10T00:00:00.000Z", json: stateWith("数据库") });
    const result = await readV1State({ indexedDB, localStorage: memoryStorage({ [V1_STATE_KEY]: stateWith("旧副本") }) });
    expect(result).toMatchObject({ status: "found", from: "indexeddb", raw: { albums: [{ title: "数据库" }] } });
  });

  it("uses localStorage when 1.0 marked it as the newer copy", async () => {
    const indexedDB = new IDBFactory();
    await putValue(indexedDB, V1_STATE_DB, V1_STATE_STORE, V1_STATE_KEY, { savedAt: "2026-10-10T00:00:00.000Z", json: stateWith("数据库") });
    const localStorage = memoryStorage({ [V1_STATE_KEY]: stateWith("更新的副本"), [V1_LEGACY_NEWER_KEY]: "2026-10-12T00:00:00.000Z" });
    const result = await readV1State({ indexedDB, localStorage });
    expect(result).toMatchObject({ status: "found", from: "localstorage", raw: { albums: [{ title: "更新的副本" }] } });
  });

  it("reports damaged data instead of guessing", async () => {
    const result = await readV1State({ indexedDB: new IDBFactory(), localStorage: memoryStorage({ [V1_STATE_KEY]: "{broken" }) });
    expect(result).toMatchObject({ status: "unreadable", from: "localstorage" });
  });

  it("works when localStorage itself throws (blocked storage)", async () => {
    const localStorage = { getItem: () => { throw new Error("blocked"); } };
    expect(await readV1State({ indexedDB: new IDBFactory(), localStorage })).toEqual({ status: "none" });
  });

  it("reads recordings without changing them", async () => {
    const indexedDB = new IDBFactory();
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mp4" });
    await putValue(indexedDB, V1_AUDIO_DB, V1_AUDIO_STORE, "rec_1", blob);
    const blobs = await readV1Recordings(["rec_1", "rec_missing"], { indexedDB });
    expect([...blobs.keys()]).toEqual(["rec_1"]);
    expect(blobs.get("rec_1")?.size).toBe(3);
  });
});
