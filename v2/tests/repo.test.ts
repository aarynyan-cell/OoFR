import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { OoFRDatabase, db, setDatabase } from "../src/db/database";
import {
  createMaterial,
  createTape,
  currentStreak,
  filterCards,
  getSettings,
  markFinished,
  markStudiedToday,
  progressOf,
  saveSentence,
  saveSettings,
  setPosition,
  trackLabel
} from "../src/db/repo";
import { addStarterContentIfEmpty } from "../src/db/starter";

let run = 0;
beforeEach(() => {
  setDatabase(new OoFRDatabase(`oofr2-repo-${(run += 1)}`));
});

describe("lessons", () => {
  it("creates a lesson from pasted text, with speakers for dialogues", async () => {
    const tape = await createTape("旅行");
    const material = await createMaterial({ title: "", tapeId: tape.id, text: "A : Bonjour !\nB : Salut. Ça va ?" });
    expect(material.materialType).toBe("情景对话");
    expect(material.title).toBe("Bonjour !");
    expect(material.sentences.map((sentence) => [sentence.speakerLabel, sentence.text])).toEqual([["A", "Bonjour !"], ["B", "Salut."], ["B", "Ça va ?"]]);
  });

  it("refuses empty text and unknown tapes with a clear message", async () => {
    const tape = await createTape("旅行");
    await expect(createMaterial({ title: "x", tapeId: tape.id, text: "   " })).rejects.toThrow("没有找到可以朗读的句子");
    await expect(createMaterial({ title: "x", tapeId: "nope", text: "Bonjour." })).rejects.toThrow("请先选一盘磁带");
  });

  it("remembers where the learner is and when a lesson is finished", async () => {
    const tape = await createTape("旅行");
    const material = await createMaterial({ title: "t", tapeId: tape.id, text: "Un. Deux. Trois. Quatre." });
    expect(progressOf(material).label).toBe("还没开始");
    await setPosition(material.id, 2);
    expect(progressOf((await db.materials.get(material.id))!)).toMatchObject({ label: "学到第 3 句", ratio: 0.5 });
    await markFinished(material.id);
    const finished = (await db.materials.get(material.id))!;
    expect(progressOf(finished).done).toBe(true);
    expect(finished.studyCount).toBe(1);
  });

  it("numbers materials like tracks on a tape", () => {
    expect([0, 1, 25, 26].map(trackLabel)).toEqual(["A1", "A2", "A26", "B1"]);
  });

  it("adds the demo tape only to an empty app", async () => {
    expect(await addStarterContentIfEmpty()).toBe(true);
    expect(await addStarterContentIfEmpty()).toBe(false);
    expect(await db.materials.count()).toBe(1);
  });
});

describe("phrasebook", () => {
  it("saves a sentence once, even when tapped twice", async () => {
    const tape = await createTape("旅行");
    const material = await createMaterial({ title: "t", tapeId: tape.id, text: "Bonjour, ça va ?" });
    const first = await saveSentence(material, material.sentences[0]);
    const second = await saveSentence(material, { ...material.sentences[0], text: "bonjour,  ça va ?" });
    expect(second.id).toBe(first.id);
    expect(await db.cards.count()).toBe(1);
  });

  it("filters by status, missing translation, wordbook and search text", async () => {
    const tape = await createTape("旅行");
    const material = await createMaterial({ title: "t", tapeId: tape.id, text: "Merci. Bonjour." });
    await saveSentence(material, { ...material.sentences[0], translation: "谢谢" });
    await saveSentence(material, material.sentences[1]);
    const merci = (await db.cards.toArray()).find((card) => card.text === "Merci.")!;
    await db.cards.update(merci.id, { status: "got", wordbookIds: ["wb"] });
    const all = await db.cards.toArray();
    expect(filterCards(all, "got").map((card) => card.text)).toEqual(["Merci."]);
    expect(filterCards(all, "todo").map((card) => card.text)).toEqual(["Bonjour."]);
    expect(filterCards(all, "incomplete").map((card) => card.text)).toEqual(["Bonjour."]);
    expect(filterCards(all, "all", "谢谢").map((card) => card.text)).toEqual(["Merci."]);
    expect(filterCards(all, "all", "", "wb").map((card) => card.text)).toEqual(["Merci."]);
  });
});

describe("settings and streak", () => {
  it("keeps defaults for anything not changed", async () => {
    await saveSettings({ rate: 1 });
    expect(await getSettings()).toMatchObject({ rate: 1, repeat: 1, theme: "night" });
  });

  it("counts consecutive study days and resets after a gap", async () => {
    const day = (iso: string) => new Date(`${iso}T12:00:00`);
    expect((await markStudiedToday(day("2026-10-16"))).streak).toBe(1);
    expect((await markStudiedToday(day("2026-10-16"))).streak).toBe(1);
    expect((await markStudiedToday(day("2026-10-17"))).streak).toBe(2);
    const afterGap = await markStudiedToday(day("2026-10-20"));
    expect(afterGap.streak).toBe(1);
    expect(currentStreak(afterGap, day("2026-10-21"))).toBe(1);
    expect(currentStreak(afterGap, day("2026-10-23"))).toBe(0);
  });
});
