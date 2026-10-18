import { describe, expect, it } from "vitest";
import { starterContent } from "../src/db/starter";
import { buildExercises, isCorrect, sentenceWords } from "../src/practice/exercises";

// A repeatable "random" sequence so the questions are the same on every run.
function seeded(seed = 42) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

const lesson = starterContent().material;

describe("practice questions", () => {
  it("makes one question per sentence, rotating the kinds", () => {
    const exercises = buildExercises(lesson, seeded());
    expect(exercises).toHaveLength(lesson.sentences.length);
    expect(exercises.map((exercise) => exercise.sentence)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(exercises.map((exercise) => exercise.kind))).toEqual(new Set(["listen", "cloze", "order"]));
  });

  it("asks for a meaningful word in cloze questions, with four distinct options", () => {
    for (let seed = 1; seed < 30; seed += 1) {
      const cloze = buildExercises(lesson, seeded(seed)).find((exercise) => exercise.kind === "cloze");
      if (cloze?.kind !== "cloze") continue;
      expect(["le", "la", "de", "je", "vous", "et"]).not.toContain(cloze.answer.toLowerCase());
      expect(cloze.options).toContain(cloze.answer);
      expect(new Set(cloze.options.map((option) => option.toLowerCase())).size).toBe(4);
      expect(isCorrect(cloze, cloze.answer.toUpperCase())).toBe(true);
    }
  });

  it("shuffles order questions and accepts the original order", () => {
    const order = buildExercises(lesson, seeded()).find((exercise) => exercise.kind === "order");
    expect(order?.kind).toBe("order");
    if (order?.kind !== "order") return;
    expect(order.pieces).not.toEqual(order.answer);
    expect([...order.pieces].sort()).toEqual([...order.answer].sort());
    expect(isCorrect(order, order.answer)).toBe(true);
    expect(isCorrect(order, order.pieces)).toBe(false);
  });

  it("offers three different sentences in listening questions", () => {
    const listen = buildExercises(lesson, seeded()).find((exercise) => exercise.kind === "listen");
    if (listen?.kind !== "listen") throw new Error("expected a listening question");
    expect(new Set(listen.options).size).toBe(3);
    expect(listen.options).toContain(listen.sentence);
    expect(isCorrect(listen, listen.sentence)).toBe(true);
  });

  it("still works for a one-sentence material", () => {
    const single = { ...lesson, sentences: lesson.sentences.slice(2, 3) };
    const exercises = buildExercises(single, seeded());
    expect(exercises).toHaveLength(1);
    expect(exercises[0].kind).not.toBe("listen");
  });

  it("splits sentences into the words the learner taps", () => {
    expect(sentenceWords("Comment allez-vous ?")).toEqual(["Comment", "allez", "-vous"]);
  });
});
