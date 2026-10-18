import { describe, expect, it } from "vitest";
import { countSpeakers, detectDialogue, guessLanguage, inferMaterialType, normalizeWord, splitSentenceChunks, splitSentences } from "../src/text/split";

describe("sentence splitting (same rules as 1.0)", () => {
  it("splits on sentence punctuation and keeps closing quotes", () => {
    expect(splitSentenceChunks("Bonjour ! Ça va ? « Oui. » Très bien")).toEqual(["Bonjour !", "Ça va ?", "« Oui. »", "Très bien"]);
  });

  it("reads speaker labels in dialogues", () => {
    const text = "A: Bonjour, je voudrais un café.\nB : Sur place ? Ou à emporter ?";
    expect(detectDialogue(text)).toBe(true);
    const sentences = splitSentences(text);
    expect(sentences).toEqual([
      { text: "Bonjour, je voudrais un café.", speakerLabel: "A", speakerId: "a" },
      { text: "Sur place ?", speakerLabel: "B", speakerId: "b" },
      { text: "Ou à emporter ?", speakerLabel: "B", speakerId: "b" }
    ]);
    expect(countSpeakers(sentences)).toBe(2);
  });

  it("reads 1.0 speaker labels such as 'B · Alex'", () => {
    expect(splitSentences("A · Camille: Bonjour.\nB · Alex: Salut.").map((sentence) => sentence.speakerId)).toEqual(["a", "b"]);
  });

  it("does not treat a single 'label:' line as a dialogue", () => {
    expect(detectDialogue("Note: il faut réviser.")).toBe(false);
    expect(splitSentences("Note: il faut réviser.")).toEqual([{ text: "Note: il faut réviser." }]);
  });

  it("guesses the material type like 1.0", () => {
    expect(inferMaterialType("A: Salut\nB: Salut")).toBe("情景对话");
    expect(inferMaterialType("Une phrase. Deux phrases.")).toBe("笔记");
    expect(inferMaterialType("Un. Deux. Trois. Quatre.")).toBe("文章");
  });

  it("normalizes words the way 1.0 stores them", () => {
    expect(normalizeWord("  L’Été! ")).toBe("l'été");
  });

  it("guesses French unless the text is clearly English", () => {
    expect(guessLanguage("Je voudrais un café, s'il vous plaît.")).toBe("fr");
    expect(guessLanguage("I would like a coffee and the bill, please.")).toBe("en");
  });
});
