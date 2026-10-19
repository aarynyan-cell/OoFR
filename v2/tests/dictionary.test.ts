import { describe, expect, it } from "vitest";
import { Dictionary, featuresLabel, posLabel, senseList, shardFor } from "../src/dict/dictionary";
import { lookupText, tokenize } from "../src/text/tokens";

// A miniature dictionary laid out exactly like the real shards.
function miniDictionary(failFirst = false) {
  const files: Record<string, Record<string, unknown>> = {};
  const put = (kind: string, key: string, row: unknown) => {
    const path = `fr/${kind}-${shardFor(key)}.json`;
    (files[path] ??= {})[key] = row;
  };
  put("entries", "vouloir", ["vouloir", "/vu.lwaʁ/", "想要；希望\\n愿意", "to want", "verb", "", "Wiktionary"]);
  put("entries", "pratiquer", ["pratiquer", "/pʁa.ti.ke/", "练习、从事", "to practise", "verb", "", ""]);
  put("entries", "aller", ["aller", "/a.le/", "去；走", "to go", "verb", "", ""]);
  put("entries", "allez", ["allez", "/a.le/", "a. 肯定的；积极的\\n[医] 正的；加油", "come on", "interjection", "", ""]);
  put("entries", "marche", ["marche", "/maʁʃ/", "步行；行进", "walk", "noun", "", ""]);
  put("entries", "marcher", ["marcher", "/maʁ.ʃe/", "走；运转", "to walk; to work", "verb", "", ""]);
  put("entries", "école", ["école", "/e.kɔl/", "学校", "school", "noun", "", ""]);
  put("entries", "avoir", ["avoir", "/a.vwaʁ/", "有", "to have", "verb", "", ""]);
  put("forms", "voudrais", ["vouloir", "verb", "conditional · first person · singular", "/vu.dʁɛ/"]);
  put("forms", "allez", ["aller", "verb", "indicative · plural · present · second person", "/a.le/"]);
  put("forms", "marche", ["marcher", "verb", "indicative · present · third person · singular", "/maʁʃ/"]);
  put("forms", "ai", ["avoir", "verb", "indicative · present · first person · singular", "/e/"]);
  put("aliases", "ecole", ["école"]);
  put("entries", "comment", ["comment", "/kɔ.mɑ̃/", "怎样；如何", "how", "adverb；intj；noun", "", ""]);
  put("entries", "commer", ["commer", "/kɔ.me/", "比较", "to compare", "verb", "", ""]);
  put("forms", "comment", ["commer", "verb", "indicative · plural · present · third person", "/kɔm/"]);
  put("entries", "bien sûr", ["bien sûr", "/bjɛ̃ syʁ/", "", "of course", "adv", "", ""]);
  put("entries", "sûr", ["sûr", "/syʁ/", "确定的", "sure", "adj", "", ""]);
  put("zh", "pratiquer", [{ pos: "verb", gender: "", zh: ["练习", "从事"] }]);
  put("zh", "marche", [{ pos: "noun", gender: "feminine", zh: ["步行", "台阶"] }]);
  put("zh", "bien sûr", [{ pos: "adverb", gender: "", zh: ["当然"] }]);
  files["fr/expressions.json"] = ["bien sûr", "tout à fait"] as unknown as Record<string, unknown>;
  put("aliases", "a", ["a", "à"]);
  const curated = {
    fr: {
      il: { word: "il", pos: "pronoun", ipa: "/il/", zh: "他；它", en: "he; it" },
      aller: { word: "aller", pos: "verb", ipa: "/a.le/", zh: "去；走；进行", en: "to go" }
    }
  };
  let failed = !failFirst;
  const requests: string[] = [];
  const dictionary = new Dictionary(async (path) => {
    requests.push(path);
    if (!failed) {
      failed = true;
      throw new Error("offline");
    }
    if (path === "curated.json") return curated;
    return files[path] ?? {};
  });
  return { dictionary, requests };
}

describe("looking up words (same rules as 1.0)", () => {
  it("finds inflected forms and explains them", async () => {
    const { dictionary } = miniDictionary();
    const result = await dictionary.lookup("voudrais", "fr", { context: "Je voudrais pratiquer le français." });
    expect(result?.lemma).toBe("vouloir");
    expect(result?.isInflected).toBe(true);
    expect(result?.formIpa).toBe("/vu.dʁɛ/");
    expect(result?.zhSenses).toEqual(["想要", "希望", "愿意"]);
    expect(featuresLabel(result!.form!.features)).toBe("条件式 · 第一人称 · 单数");
  });

  it("uses hand-reviewed entries first", async () => {
    const { dictionary } = miniDictionary();
    expect((await dictionary.lookup("Il", "fr"))?.curated).toBe(true);
  });

  it("looks through elisions (j'ai → avoir)", async () => {
    const { dictionary } = miniDictionary();
    expect((await dictionary.lookup("j'ai", "fr"))?.lemma).toBe("avoir");
  });

  it("reads noun/verb homographs from context", async () => {
    const { dictionary } = miniDictionary();
    expect((await dictionary.lookup("marche", "fr", { context: "Mon téléphone marche bien." }))?.lemma).toBe("marcher");
    expect((await dictionary.lookup("marche", "fr", { context: "Une marche rapide." }))?.lemma).toBe("marche");
  });

  it("reads an adverb as the adverb, not as a rare verb form", async () => {
    const { dictionary } = miniDictionary();
    for (const context of ["Bonjour, comment allez-vous ?", "Comment tu t'appelles ?", "Je ne sais pas comment faire."]) {
      const result = await dictionary.lookup(context.startsWith("Comment") ? "Comment" : "comment", "fr", { context });
      expect(result?.lemma).toBe("comment");
      expect(result?.isInflected).toBe(false);
    }
  });

  it("treats 'allez' next to a subject as the verb, not the interjection", async () => {
    const { dictionary } = miniDictionary();
    const inverted = await dictionary.lookup("allez", "fr", { context: "Comment allez-vous aujourd'hui ?" });
    expect(inverted?.lemma).toBe("aller");
    // The base form comes from the hand-reviewed layer, not the noisy shard.
    expect(inverted?.zhSenses).toEqual(["去", "走", "进行"]);
    expect(inverted?.curated).toBe(true);
    expect((await dictionary.lookup("allez", "fr", { context: "Vous allez bien ?" }))?.lemma).toBe("aller");
    expect((await dictionary.lookup("Allez", "fr", { context: "Allez ! On y va." }))?.lemma).toBe("allez");
  });

  it("finds accented words typed without accents, but never guesses between a and à", async () => {
    const { dictionary } = miniDictionary();
    expect((await dictionary.lookup("ecole", "fr"))?.word).toBe("école");
    expect(await dictionary.lookup("a", "fr")).toBeNull();
  });

  it("tries again after a failed download", async () => {
    const { dictionary } = miniDictionary(true);
    await dictionary.lookup("pratiquer", "fr");
    expect((await dictionary.lookup("pratiquer", "fr"))?.word).toBe("pratiquer");
  });

  it("cleans dictionary meanings", () => {
    expect(senseList("a. 肯定的；积极的\\n[医] 正的；加油；加油")).toEqual(["肯定的", "积极的", "正的", "加油"]);
    expect(posLabel(["noun", "adjective"])).toBe("名词 / 形容词");
    expect(featuresLabel("indicative · R @ t E · plural · present")).toBe("直陈式 · 现在时 · 复数");
  });
});

describe("Chinese meanings and fixed expressions", () => {
  it("prefers hand-reviewed meanings, then the AI translation, and marks 1.0's machine column", async () => {
    const { dictionary } = miniDictionary();
    expect((await dictionary.lookup("il", "fr"))?.meaningSource).toBe("curated");
    const practise = await dictionary.lookup("pratiquer", "fr");
    expect(practise?.meaningSource).toBe("ai");
    expect(practise?.meanings).toEqual([{ pos: "动词", gender: "", senses: ["练习", "从事"] }]);
    const noun = await dictionary.lookup("marche", "fr", { context: "Une marche rapide." });
    expect(noun?.meanings[0]).toMatchObject({ pos: "名词", gender: "feminine" });
    expect((await dictionary.lookup("école", "fr"))?.meaningSource).toBe("machine");
  });

  it("finds the fixed expression a tapped word belongs to", async () => {
    const { dictionary, requests } = miniDictionary();
    const expression = await dictionary.findExpression(["Bien", "sûr", "on", "commence"], 1);
    expect(expression?.word).toBe("bien sûr");
    expect(expression?.meanings[0].senses).toEqual(["当然"]);
    requests.length = 0;
    expect(await dictionary.findExpression(["on", "commence"], 0)).toBeNull();
    // Unknown word pairs cost no shard downloads.
    expect(requests.filter((path) => path.includes("entries"))).toEqual([]);
  });
});

describe("tappable words", () => {
  it("splits inverted subjects but keeps compounds and elisions", () => {
    const words = tokenize("Comment allez-vous aujourd'hui ? Peut-être. Va-t-il venir ? J'ai faim.").filter((token) => token.word);
    expect(words.map((token) => token.text)).toEqual(["Comment", "allez", "-vous", "aujourd'hui", "Peut-être", "Va", "-t-il", "venir", "J'ai", "faim"]);
    expect(words.map(lookupText)).toContain("il");
  });

  it("keeps every character of the sentence", () => {
    const sentence = "« Bonjour », dit-elle, l’air ravi.";
    expect(tokenize(sentence).map((token) => token.text).join("")).toBe(sentence);
  });

  it("counts repeated words so each is looked up in its own place", () => {
    const tokens = tokenize("Le chat voit le chien.").filter((token) => token.word);
    expect(tokens.filter((token) => token.text.toLowerCase() === "le").map((token) => token.occurrence)).toEqual([0, 1]);
  });
});

describe("keeping words and their punctuation together", () => {
  it("groups inverted subjects and closing punctuation", async () => {
    const { groupWords, tokenize } = await import("../src/text/tokens");
    const groups = groupWords(tokenize("Comment allez-vous aujourd'hui ? Oui."));
    expect(groups.map((group) => group.map((token) => token.text).join(""))).toEqual(["Comment", " ", "allez-vous", " ", "aujourd'hui ?", " ", "Oui."]);
  });
});
