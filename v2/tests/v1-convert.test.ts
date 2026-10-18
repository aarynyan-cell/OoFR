import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { UNSORTED_TAPE_ID, convertV1State, looksLikeV1State } from "../src/migrate/v1-convert";

// Written by the real 1.0 code: see scripts/make-v1-fixture.cjs.
const fixtureText = readFileSync(new URL("./fixtures/v1-state.json", import.meta.url), "utf8");
const fixture = () => JSON.parse(fixtureText);

describe("converting 1.0 data", () => {
  it("rejects things that are not 1.0 state", () => {
    expect(looksLikeV1State({ type: "oofr.learning-package", albums: [] })).toBe(false);
    expect(looksLikeV1State([])).toBe(false);
    expect(() => convertV1State({ foo: 1 })).toThrow();
  });

  it("does not modify its input", () => {
    const raw = fixture();
    convertV1State(raw);
    expect(raw).toEqual(fixture());
  });

  it("turns each 1.0 tape (album) into a 2.0 tape with its colour", () => {
    const bundle = convertV1State(fixture());
    const titles = bundle.tapes.map((tape) => tape.title);
    expect(titles).toEqual(["入门练习", "旅行用语", "其他素材"]);
    expect(bundle.tapes.find((tape) => tape.title === "旅行用语")?.color).toBe("#7CC1B6");
  });

  it("keeps every lesson and every plain entry, each exactly once", () => {
    const raw = fixture();
    const bundle = convertV1State(raw);
    const byTitle = new Map(bundle.materials.map((material) => [material.title, material]));
    const tapeTitle = (tapeId: string) => bundle.tapes.find((tape) => tape.id === tapeId)?.title;

    expect(bundle.materials).toHaveLength(5);
    expect(tapeTitle(byTitle.get("每天十分钟法语")!.tapeId)).toBe("入门练习");
    expect(tapeTitle(byTitle.get("示例段落")!.tapeId)).toBe("入门练习");
    // The lesson 1.0 built from the first entry keeps that entry's title.
    expect(tapeTitle(byTitle.get("在咖啡馆点单")!.tapeId)).toBe("旅行用语");
    expect(byTitle.get("在咖啡馆点单")!.sentences.map((sentence) => sentence.speakerLabel)).toEqual(["A", "B", "B"]);
    // Added later to the same tape, never opened in 1.0: becomes its own material.
    expect(byTitle.get("问路")!.notes).toBe("记住 tout droit");
    expect(byTitle.get("问路")!.sentences).toHaveLength(2);
    expect(byTitle.get("导入的课程")!.tapeId).toBe(UNSORTED_TAPE_ID);
    expect(new Set(bundle.materials.map((material) => material.id)).size).toBe(5);
  });

  it("keeps translations, cached AI explanations and recordings", () => {
    const bundle = convertV1State(fixture());
    const demo = bundle.materials.find((material) => material.id === "demo_lesson")!;
    expect(demo.sentences).toHaveLength(6);
    expect(demo.sentences[0].translation).toBe("你好，今天过得怎么样？");
    const third = demo.sentences[2];
    expect(third.explanation?.structure).toBe("Je + voudrais + 动词原形");
    expect(third.explanation?.source).toBe("desktop");
    expect(third.recordingKey).toBe("rec_demo_turn_3");
    expect(third.recordingMs).toBe(2300);
    // 1.0's demo recordings ("demo:…") were never real audio.
    expect(demo.sentences[0].recordingKey).toBe("");
    expect(bundle.recordingKeys).toEqual(["rec_demo_turn_3"]);
  });

  it("merges the word list and the phrasebook without duplicates", () => {
    const bundle = convertV1State(fixture());
    const words = bundle.cards.filter((card) => card.kind === "word");
    const phrases = bundle.cards.filter((card) => card.kind === "phrase");
    expect(phrases.map((card) => card.text)).toEqual([
      "Bonjour, comment allez-vous aujourd'hui ?",
      "Pouvez-vous répéter cette phrase plus lentement ?"
    ]);
    // "pratiquer" is in both 1.0 lists: one card, still marked as known.
    expect(words.filter((card) => card.normalized === "pratiquer")).toHaveLength(1);
    expect(words.find((card) => card.normalized === "pratiquer")?.status).toBe("got");
    const cafe = words.find((card) => card.normalized === "café")!;
    expect(cafe.translation).toBe("咖啡");
    expect(cafe.ipa).toBe("/ka.fe/");
    // System wordbook ids ("all") are dropped, the learner's own ones kept.
    expect(cafe.wordbookIds).toEqual(["wordbook_food"]);
    expect(bundle.wordbooks.map((wordbook) => wordbook.title)).toEqual(["吃饭"]);
  });

  it("carries playback settings and the streak", () => {
    const bundle = convertV1State(fixture());
    expect(bundle.settings).toEqual({ rate: 0.75, repeat: 2, gapMs: 1200, voice: "Thomas|fr-FR", systemLanguage: "zh" });
    expect(bundle.study.streak).toBe(4);
    expect(bundle.study.lastStudyDate).toBe("2026-10-17");
  });

  it("converts very old albums that never got a lesson", () => {
    const bundle = convertV1State({
      albums: [{ id: "album_old", title: "老磁带" }],
      tapes: [{ id: "tape_old", albumId: "album_old", title: "A 面" }],
      entries: [
        { id: "entry_1", tapeId: "tape_old", title: "第一段", text: "Bonjour. Merci.", createdAt: "2025-01-01T00:00:00Z" },
        { id: "entry_2", tapeId: "tape_old", title: "第二段", text: "Au revoir.", createdAt: "2025-01-02T00:00:00Z" }
      ]
    });
    expect(bundle.materials).toHaveLength(1);
    expect(bundle.materials[0].id).toBe("course_album_old");
    expect(bundle.materials[0].title).toBe("老磁带");
    expect(bundle.materials[0].sentences.map((sentence) => sentence.text)).toEqual(["Bonjour.", "Merci.", "Au revoir."]);
  });

  it("survives damaged or hand-edited data", () => {
    const bundle = convertV1State({
      albums: [{ id: "a", title: "A", coverColor: "url(javascript:alert(1))" }, { title: "no id" }, null],
      tapes: [{ id: "t", albumId: "missing" }],
      entries: [{ id: "e", tapeId: "t", title: "x", text: 5 }],
      courseLessons: [{ id: "l", title: "L", turns: [{ text: "" }, { id: "dup", text: "Un." }, { id: "dup", text: "Deux." }] }],
      phraseItems: [{ text: "" }, { id: "p", text: "Salut", status: "weird" }],
      settings: { rate: "fast", repeat: -3, pause: "0.5" }
    });
    expect(bundle.tapes.map((tape) => tape.color)[0]).toMatch(/^#/);
    expect(bundle.materials).toHaveLength(1);
    expect(bundle.materials[0].sentences.map((sentence) => sentence.id)).toEqual(["dup", "l_turn_3"]);
    expect(bundle.cards).toHaveLength(1);
    expect(bundle.cards[0].status).toBe("new");
    expect(bundle.settings).toEqual({ gapMs: 500 });
  });
});
