import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { createBackup, importAnyFile, mergeMaterial, restoreSnapshot, snapshotInfo } from "../src/backup/backup";
import { OoFRDatabase, db, setDatabase } from "../src/db/database";
import { createMaterial, createTape, saveRecording, saveSentence } from "../src/db/repo";
import { starterContent } from "../src/db/starter";

const learningPackage = readFileSync(new URL("../../tests/fixtures/learning-package.json", import.meta.url), "utf8");
const v1State = readFileSync(new URL("./fixtures/v1-state.json", import.meta.url), "utf8");
let run = 0;
const freshDatabase = () => setDatabase(new OoFRDatabase(`oofr2-backup-${(run += 1)}`));

beforeEach(freshDatabase);

async function someData() {
  const tape = await createTape("旅行");
  const material = await createMaterial({ title: "咖啡馆", tapeId: tape.id, text: "Un café, s'il vous plaît. Merci." });
  await saveSentence(material, material.sentences[0]);
  await saveRecording(material.id, material.sentences[1].id, { blob: new Blob([new Uint8Array([1, 2, 3, 250])], { type: "audio/mp4" }), durationMs: 900, mimeType: "audio/mp4" });
  return { tape, material };
}

describe("2.0 backups", () => {
  it("brings back everything, recordings included, on another device", async () => {
    const { material } = await someData();
    const file = JSON.stringify(await createBackup("2.0.0"));

    freshDatabase();
    const outcome = await importAnyFile(file);
    expect(outcome).toMatchObject({ kind: "backup", added: { tapes: 1, materials: 1, cards: 1, recordings: 1 } });
    const restored = await db.materials.get(material.id);
    expect(restored?.sentences.map((sentence) => sentence.text)).toEqual(material.sentences.map((sentence) => sentence.text));
    const key = restored!.sentences[1].recordingKey;
    const recording = await db.recordings.get(key);
    expect([...new Uint8Array(await recording!.blob.arrayBuffer())]).toEqual([1, 2, 3, 250]);
    expect(recording?.durationMs).toBe(900);
  });

  it("importing the same backup twice changes nothing", async () => {
    await someData();
    const file = JSON.stringify(await createBackup("2.0.0"));
    const again = await importAnyFile(file);
    expect(again.added).toEqual({ tapes: 0, materials: 0, cards: 0, wordbooks: 0, recordings: 0 });
    expect(await db.materials.count()).toBe(1);
  });

  it("skips broken records instead of failing the whole import", async () => {
    const outcome = await importAnyFile(JSON.stringify({
      type: "oofr2.backup",
      version: 1,
      tapes: [{ id: "t", title: "好的", color: "red; background:url(x)" }, { title: "无 id" }],
      materials: [{ id: "m", tapeId: "t", sentences: [{ text: "Bonjour." }, { text: 42 }] }, { id: "empty", tapeId: "t", sentences: [] }],
      cards: [{ id: "c" }],
      recordings: [{ key: "r", data: "%%% not base64" }]
    }));
    expect(outcome.added).toMatchObject({ tapes: 1, materials: 1, cards: 0, recordings: 0 });
    expect((await db.tapes.get("t"))?.color).toBe("#E9C46A");
    expect((await db.materials.get("m"))?.sentences).toHaveLength(1);
  });

  it("rejects files that are not OoFR data", async () => {
    await expect(importAnyFile("hello")).rejects.toThrow("JSON");
    await expect(importAnyFile(JSON.stringify({ name: "something else" }))).rejects.toThrow("认不出");
  });
});

describe("merging two copies of a lesson", () => {
  it("keeps recordings, translations and the newest explanation", () => {
    const base = starterContent().material;
    const phone = { ...base, updatedAt: "2026-10-18T10:00:00Z", position: 4, sentences: base.sentences.map((sentence, index) => (index === 1 ? { ...sentence, recordingKey: "rec:phone", recordingMs: 800 } : sentence)) };
    const explanation = { summary: "s", structure: "", grammarPoints: ["g"], morphology: "", pitfalls: [], examples: [], model: "qwen", language: "zh", version: "2", source: "desktop", generatedAt: "2026-10-18T11:00:00Z" };
    const mac = { ...base, updatedAt: "2026-10-18T12:00:00Z", position: 1, sentences: base.sentences.map((sentence, index) => (index === 1 ? { ...sentence, explanation } : sentence)) };
    const merged = mergeMaterial(phone, mac);
    expect(merged.sentences[1].recordingKey).toBe("rec:phone");
    expect(merged.sentences[1].explanation?.model).toBe("qwen");
    expect(merged.position).toBe(4);
  });
});

describe("learning packages and 1.0 backups through the same button", () => {
  it("adds a 1.0 learning package with its AI explanations", async () => {
    const outcome = await importAnyFile(learningPackage);
    expect(outcome.kind).toBe("package");
    const material = await db.materials.get("course_fixture");
    expect(material?.sentences[0].translation).toBe("我走一小会儿。");
    expect(material?.sentences[0].explanation).not.toBeNull();
    expect((await db.tapes.get(material!.tapeId))?.title).toBe("测试磁带");
  });

  it("fills a lesson that is already here without touching the learner's progress", async () => {
    await importAnyFile(learningPackage);
    const material = (await db.materials.get("course_fixture"))!;
    await db.materials.update(material.id, {
      position: 0,
      studyCount: 5,
      sentences: material.sentences.map((sentence) => ({ ...sentence, translation: "", explanation: null, recordingKey: "rec:mine" }))
    });
    const again = await importAnyFile(learningPackage);
    expect(again.updated).toBe(1);
    const updated = (await db.materials.get("course_fixture"))!;
    expect(updated.studyCount).toBe(5);
    expect(updated.sentences[0]).toMatchObject({ translation: "我走一小会儿。", recordingKey: "rec:mine" });
    expect(updated.sentences[0].explanation).not.toBeNull();
    expect(await db.materials.count()).toBe(1);
  });

  it("accepts a 1.0 backup file", async () => {
    expect((await importAnyFile(v1State)).added.materials).toBe(5);
  });
});

describe("undoing an import", () => {
  it("puts lessons and phrasebook back as they were", async () => {
    await someData();
    await importAnyFile(v1State);
    expect(await db.materials.count()).toBe(6);
    expect(await snapshotInfo()).toBeDefined();
    expect(await restoreSnapshot()).toBe(true);
    expect(await db.materials.count()).toBe(1);
    expect(await db.cards.count()).toBe(1);
    expect(await snapshotInfo()).toBeUndefined();
    expect(await restoreSnapshot()).toBe(false);
  });
});
