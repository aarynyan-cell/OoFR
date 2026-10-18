import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { OoFRDatabase, db, setDatabase } from "../src/db/database";
import { createMaterial, createTape, deleteMaterial, deleteTape, materialText, saveRecording, saveSentence, updateMaterial, updateTape } from "../src/db/repo";

let run = 0;
beforeEach(() => {
  setDatabase(new OoFRDatabase(`oofr2-manage-${(run += 1)}`));
});

const take = { blob: new Blob([new Uint8Array([9])], { type: "audio/mp4" }), durationMs: 500, mimeType: "audio/mp4" };

describe("editing a material", () => {
  it("keeps translations and recordings of unchanged sentences, drops removed ones", async () => {
    const tape = await createTape("旅行");
    const material = await createMaterial({ title: "t", tapeId: tape.id, text: "A : Bonjour.\nB : Merci.\nA : Au revoir." });
    await db.materials.update(material.id, { sentences: material.sentences.map((sentence) => ({ ...sentence, translation: `译 ${sentence.text}` })) });
    const merciKey = await saveRecording(material.id, material.sentences[1].id, take);
    const byeKey = await saveRecording(material.id, material.sentences[2].id, take);

    const edited = await updateMaterial(material.id, { title: "新标题", text: "A : Bonjour.\nB : Merci beaucoup.\nB : Merci." });
    expect(edited.title).toBe("新标题");
    expect(edited.sentences.map((sentence) => sentence.text)).toEqual(["Bonjour.", "Merci beaucoup.", "Merci."]);
    expect(edited.sentences[0].translation).toBe("译 Bonjour.");
    expect(edited.sentences[2]).toMatchObject({ translation: "译 Merci.", recordingKey: merciKey });
    expect(edited.sentences[1].translation).toBe("");
    expect(await db.recordings.get(byeKey)).toBeUndefined();
    expect(await db.recordings.get(merciKey)).toBeDefined();
  });

  it("writes dialogue text back with speaker labels for editing", async () => {
    const tape = await createTape("旅行");
    const material = await createMaterial({ title: "t", tapeId: tape.id, text: "A: Salut ! Ça va ?\nB: Oui." });
    expect(materialText(material)).toBe("A: Salut !\nA: Ça va ?\nB: Oui.");
  });

  it("moves a material to another tape and refuses unknown tapes", async () => {
    const first = await createTape("一");
    const second = await createTape("二");
    const material = await createMaterial({ title: "t", tapeId: first.id, text: "Bonjour." });
    expect((await updateMaterial(material.id, { tapeId: second.id })).tapeId).toBe(second.id);
    await expect(updateMaterial(material.id, { tapeId: "nope" })).rejects.toThrow("找不到这盘磁带");
  });

  it("deletes a material with its recordings but keeps saved phrases", async () => {
    const tape = await createTape("旅行");
    const material = await createMaterial({ title: "t", tapeId: tape.id, text: "Bonjour. Merci." });
    const key = await saveRecording(material.id, material.sentences[0].id, take);
    await saveSentence(material, material.sentences[1]);
    await deleteMaterial(material.id);
    expect(await db.materials.count()).toBe(0);
    expect(await db.recordings.get(key)).toBeUndefined();
    expect(await db.cards.count()).toBe(1);
  });
});

describe("managing tapes", () => {
  it("renames and recolours a tape", async () => {
    const tape = await createTape("旅行");
    await updateTape(tape.id, { title: "  出门  ", color: "#7CC1B6" });
    expect(await db.tapes.get(tape.id)).toMatchObject({ title: "出门", color: "#7CC1B6" });
  });

  it("moves lessons to another tape when a tape is deleted", async () => {
    const first = await createTape("一");
    const second = await createTape("二");
    await createMaterial({ title: "t", tapeId: first.id, text: "Bonjour." });
    expect(await deleteTape(first.id)).toEqual({ movedTo: "二", moved: 1 });
    expect((await db.materials.toArray())[0].tapeId).toBe(second.id);
    expect((await db.tapes.get(second.id))?.order).toBe(0);
  });

  it("keeps lessons safe even when the last tape is deleted", async () => {
    const only = await createTape("唯一");
    await createMaterial({ title: "t", tapeId: only.id, text: "Bonjour." });
    const outcome = await deleteTape(only.id);
    expect(outcome.movedTo).toBe("其他素材");
    expect(await db.materials.count()).toBe(1);
    expect(await db.tapes.count()).toBe(1);
  });
});
