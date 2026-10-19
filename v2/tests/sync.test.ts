import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { OoFRDatabase, db, setDatabase } from "../src/db/database";
import { applySentenceAi, createMaterial, createTape, deleteMaterial, saveWord, tombstones } from "../src/db/repo";
import { Reassembler, toFrames } from "../src/sync/frames";
import { syncWith } from "../src/sync/client";
import { answerSync } from "../src/sync/host";
import { manifest } from "../src/sync/sync";

let run = 0;
let phone: OoFRDatabase;
let mac: OoFRDatabase;

beforeEach(() => {
  run += 1;
  phone = new OoFRDatabase(`oofr2-phone-${run}`);
  mac = new OoFRDatabase(`oofr2-mac-${run}`);
  setDatabase(phone);
});

// Runs a step "on" one device.
async function on<T>(device: OoFRDatabase, step: () => Promise<T>): Promise<T> {
  const before = db;
  setDatabase(device);
  try {
    return await step();
  } finally {
    setDatabase(before);
  }
}

// The phone talks to the Mac through frames, as over the real connection.
const exchange = async (message: Record<string, unknown>) => {
  const assembler = new Reassembler();
  let request: Record<string, unknown> | null = null;
  for (const frame of toFrames(message)) request = assembler.push(frame);
  const answer = await on(mac, () => answerSync(request!));
  const back = new Reassembler();
  let result: Record<string, unknown> | null = null;
  for (const frame of toFrames(answer!)) result = back.push(frame);
  return result!;
};

const sync = () => on(phone, () => syncWith(exchange));
const titles = (device: OoFRDatabase) => on(device, async () => (await db.materials.toArray()).map((material) => material.title).sort());

describe("syncing a phone with its Mac", () => {
  it("brings both sides to the same lessons, tapes and phrasebook", async () => {
    const phoneTape = await on(phone, () => createTape("手机的磁带"));
    await on(phone, () => createMaterial({ title: "Au café", tapeId: phoneTape.id, text: "Un café, s'il vous plaît." }));
    const macTape = await on(mac, () => createTape("电脑的磁带"));
    const lesson = await on(mac, () => createMaterial({ title: "À la gare", tapeId: macTape.id, text: "Le train part à midi." }));
    await on(mac, () => saveWord({ surface: "train", lemma: "train", translation: "火车", ipa: "", partOfSpeech: "noun" }, lesson));

    const first = await sync();
    expect(first.received).toBe(3);
    expect(first.sent).toBe(2);
    expect(await titles(phone)).toEqual(["Au café", "À la gare"]);
    expect(await titles(mac)).toEqual(["Au café", "À la gare"]);
    expect(await on(phone, () => db.cards.count())).toBe(1);
    expect(await on(phone, () => manifest())).toEqual(await on(mac, () => manifest()));

    // Nothing changed: nothing travels.
    const second = await sync();
    expect([second.received, second.sent]).toEqual([0, 0]);
  });

  it("carries the Mac's AI translations and explanations to the phone without losing the phone's own", async () => {
    const tape = await on(mac, () => createTape("共同"));
    const lesson = await on(mac, () => createMaterial({ title: "Salut", tapeId: tape.id, text: "Bonjour. Merci." }));
    await sync();
    const [hello, thanks] = lesson.sentences;
    await on(mac, () => applySentenceAi(lesson.id, [{ sentenceId: hello.id, text: hello.text, translation: "你好。" }]));
    await on(phone, () => db.materials.update(lesson.id, { sentences: [hello, { ...thanks, translation: "谢谢（我自己写的）" }] }));
    await sync();
    for (const device of [phone, mac]) {
      const stored = await on(device, () => db.materials.get(lesson.id));
      expect(stored!.sentences.map((sentence) => sentence.translation)).toEqual(["你好。", "谢谢（我自己写的）"]);
    }
  });

  it("deletes on the other side what was deleted, unless it was edited there later", async () => {
    const tape = await on(phone, () => createTape("t"));
    const keep = await on(phone, () => createMaterial({ title: "keep", tapeId: tape.id, text: "Oui." }));
    const gone = await on(phone, () => createMaterial({ title: "gone", tapeId: tape.id, text: "Non." }));
    await sync();
    await on(phone, () => deleteMaterial(gone.id));
    await on(phone, () => deleteMaterial(keep.id));
    // Edited on the Mac after the phone deleted it: the edit wins.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await on(mac, () => db.materials.update(keep.id, { title: "keep (edited)", updatedAt: new Date(Date.now() + 1000).toISOString() }));
    await sync();
    expect(await titles(mac)).toEqual(["keep (edited)"]);
    expect(await titles(phone)).toEqual(["keep (edited)"]);
    expect((await on(mac, () => tombstones())).map((item) => item.id)).toContain(gone.id);
  });

  it("joins the same word saved on both devices into one", async () => {
    const tape = await on(phone, () => createTape("t"));
    const lessonPhone = await on(phone, () => createMaterial({ title: "a", tapeId: tape.id, text: "Bonjour." }));
    await sync();
    const lessonMac = (await on(mac, () => db.materials.get(lessonPhone.id)))!;
    const word = { surface: "bonjour", lemma: "bonjour", translation: "你好", ipa: "", partOfSpeech: "interjection" };
    await on(phone, () => saveWord(word, lessonPhone));
    await on(mac, () => saveWord(word, lessonMac));
    await sync();
    await sync();
    const phoneCards = await on(phone, () => db.cards.toArray());
    const macCards = await on(mac, () => db.cards.toArray());
    expect(phoneCards).toHaveLength(1);
    expect(macCards.map((card) => card.id)).toEqual(phoneCards.map((card) => card.id));
  });

  it("splits long messages into parts and puts them back together", () => {
    const message = { t: "sync-push", id: 3, records: { materials: [{ title: "长".repeat(150000) }] } };
    const frames = toFrames(message);
    expect(frames.length).toBeGreaterThan(3);
    expect(frames.every((frame) => frame.length < 41000)).toBe(true);
    const assembler = new Reassembler();
    const results = frames.map((frame) => assembler.push(frame));
    expect(results.slice(0, -1).every((result) => result === null)).toBe(true);
    expect(results.at(-1)).toEqual(message);
  });

  it("joins tapes and lessons made separately on both devices, and keeps each device's reading place", async () => {
    const text = "Bonjour. Comment ça va ? Très bien.";
    const phoneTape = await on(phone, () => createTape("我的素材"));
    const phoneLesson = await on(phone, () => createMaterial({ title: "Salut", tapeId: phoneTape.id, text }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const macTape = await on(mac, () => createTape("我的素材"));
    await on(mac, () => createMaterial({ title: "Salut", tapeId: macTape.id, text }));
    await on(phone, () => db.materials.update(phoneLesson.id, { position: 2 }));
    await sync();
    await sync();
    for (const device of [phone, mac]) {
      expect(await on(device, async () => (await db.tapes.toArray()).filter((tape) => tape.title === "我的素材").length)).toBe(1);
      expect(await on(device, () => db.materials.count())).toBe(1);
    }
    // Both devices kept the same copy.
    expect((await on(phone, () => db.materials.toArray()))[0].id).toBe((await on(mac, () => db.materials.toArray()))[0].id);
    // The phone's reading place stays (it was on the third sentence).
    expect((await on(phone, () => db.materials.toArray()))[0].position).toBe(2);
    expect((await on(mac, () => db.materials.toArray()))[0].position).toBe(0);
    const again = await sync();
    expect([again.received, again.sent]).toEqual([0, 0]);
  });
});
