import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { OoFRDatabase, db, setDatabase } from "../src/db/database";
import { convertV1State } from "../src/migrate/v1-convert";
import { detectV1, importV1Bundle, importV1File, importV1FromThisDevice } from "../src/migrate/v1-import";
import { V1_AUDIO_DB, V1_AUDIO_STORE, V1_STATE_KEY } from "../src/migrate/v1-sources";
import { memoryStorage, putValue } from "./helpers/v1-browser";

const fixtureText = readFileSync(new URL("./fixtures/v1-state.json", import.meta.url), "utf8");
let run = 0;

beforeEach(() => {
  setDatabase(new OoFRDatabase(`oofr2-test-${(run += 1)}`));
});

describe("bringing 1.0 data into 2.0", () => {
  it("imports everything and records what it did", async () => {
    const added = await importV1File(fixtureText);
    expect(added).toEqual({ tapes: 3, materials: 5, cards: 4, wordbooks: 1, recordings: 0 });
    expect(await db.materials.count()).toBe(5);
    const settings = (await db.kv.get("settings"))?.value as { rate: number; voice: string };
    expect(settings.rate).toBe(0.75);
    expect(settings.voice).toBe("Thomas|fr-FR");
  });

  it("is safe to run twice: nothing is duplicated", async () => {
    await importV1File(fixtureText);
    const again = await importV1File(fixtureText);
    expect(again).toEqual({ tapes: 0, materials: 0, cards: 0, wordbooks: 0, recordings: 0 });
    expect(await db.materials.count()).toBe(5);
    expect(await db.cards.count()).toBe(4);
  });

  it("never overwrites what the learner changed in 2.0", async () => {
    await importV1File(fixtureText);
    await db.materials.update("demo_lesson", { title: "我改过的标题", position: 4 });
    await db.kv.put({ key: "settings", value: { ...((await db.kv.get("settings"))?.value as object), rate: 1.1 } });
    await importV1File(fixtureText);
    const demo = await db.materials.get("demo_lesson");
    expect(demo?.title).toBe("我改过的标题");
    expect(demo?.position).toBe(4);
    expect(((await db.kv.get("settings"))?.value as { rate: number }).rate).toBe(1.1);
  });

  it("does not add a word the learner already saved in 2.0", async () => {
    const bundle = convertV1State(JSON.parse(fixtureText));
    const cafe = bundle.cards.find((card) => card.normalized === "café")!;
    await db.cards.add({ ...cafe, id: "my_own_cafe", translation: "咖啡馆" });
    await importV1Bundle(bundle, "1.0-file");
    const cafes = await db.cards.where("normalized").equals("café").toArray();
    expect(cafes.map((card) => card.translation)).toEqual(["咖啡馆"]);
  });

  it("copies recordings from 1.0 on this device and leaves 1.0 untouched", async () => {
    const indexedDB = new IDBFactory();
    const blob = new Blob([new Uint8Array([7, 7, 7, 7])], { type: "audio/mp4" });
    await putValue(indexedDB, V1_AUDIO_DB, V1_AUDIO_STORE, "rec_demo_turn_3", blob);
    const localStorage = memoryStorage({ [V1_STATE_KEY]: fixtureText });

    const detection = await detectV1({ indexedDB, localStorage });
    expect(detection.status).toBe("found");
    expect(detection.counts).toMatchObject({ materials: 5, recordings: 1 });

    const added = await importV1FromThisDevice({ indexedDB, localStorage });
    expect(added.recordings).toBe(1);
    const recording = await db.recordings.get("rec_demo_turn_3");
    expect(recording?.blob.size).toBe(4);
    expect(recording?.durationMs).toBe(2300);

    expect(localStorage.getItem(V1_STATE_KEY)).toBe(fixtureText);
    expect((await detectV1({ indexedDB, localStorage })).status).toBe("imported");
  });

  it("explains clearly when there is nothing to import", async () => {
    await expect(importV1FromThisDevice({ indexedDB: new IDBFactory(), localStorage: memoryStorage() })).rejects.toThrow("没有找到 1.0 的数据");
    await expect(importV1File("not json")).rejects.toThrow("JSON");
    await expect(importV1File(JSON.stringify({ type: "oofr.learning-package" }))).rejects.toThrow("1.0");
  });
});
