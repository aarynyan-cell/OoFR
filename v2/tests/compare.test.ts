import { describe, expect, it } from "vitest";
import { compareSpeech, frenchNumber } from "../src/text/compare";

describe("checking a shadowing attempt", () => {
  it("accepts a correct reading regardless of case, accents and punctuation", () => {
    const check = compareSpeech("Je voudrais pratiquer le français pendant dix minutes.", "je voudrais pratiquer le francais pendant dix minutes");
    expect(check.missed).toEqual([]);
    expect(check.score).toBe(1);
  });

  it("points at the word heard differently", () => {
    const check = compareSpeech("Je voudrais pratiquer le français pendant dix minutes.", "je voudrais pratiquer le français pendant dis minutes");
    expect(check.missed).toEqual(["dix"]);
    expect(check.tokens.find((token) => token.text === "dix")).toMatchObject({ ok: false, heardAs: "dis" });
    expect(check.score).toBeCloseTo(7 / 8);
  });

  it("marks words that were left out", () => {
    const check = compareSpeech("Bien sûr, on peut commencer.", "bien sûr on commencer");
    expect(check.missed).toEqual(["peut"]);
  });

  it("understands numbers written as digits", () => {
    expect(compareSpeech("Pendant dix minutes.", "pendant 10 minutes").missed).toEqual([]);
    expect(compareSpeech("J'ai vingt et un ans.", "j'ai 21 ans").missed).toEqual([]);
  });

  it("handles inverted subjects and elisions", () => {
    expect(compareSpeech("Comment allez-vous ?", "comment allez vous").missed).toEqual([]);
    expect(compareSpeech("Comment allez-vous ?", "comment allez-vous").missed).toEqual([]);
    expect(compareSpeech("C'est l'heure.", "c'est l'heure").missed).toEqual([]);
  });

  it("keeps the sentence text intact for display", () => {
    const sentence = "« Oui », dit-elle.";
    expect(compareSpeech(sentence, "").tokens.map((token) => token.text).join("")).toBe(sentence);
    expect(compareSpeech(sentence, "").score).toBe(0);
  });

  it("spells numbers the French way", () => {
    expect([1, 17, 21, 70, 71, 80, 91, 200, 1001].map(frenchNumber)).toEqual([
      "un", "dix-sept", "vingt et un", "soixante-dix", "soixante et onze", "quatre-vingts", "quatre-vingt-onze", "deux cents", "mille un"
    ]);
  });
});
