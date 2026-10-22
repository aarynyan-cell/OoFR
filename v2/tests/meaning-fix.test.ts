import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { sanitizeCard } from "../src/backup/backup";
import { OoFRDatabase, db, setDatabase } from "../src/db/database";
import { LOOKUP_SOURCE, clearWordIssue, filterCards, fixWordMeaning, meaningSenses, reportWordMeaning } from "../src/db/repo";

// 词典报错 / 修正: a wrong dictionary meaning is marked (waits in 待补充) or,
// with the local AI's check, fixed; both ride on the word's 词句 entry.

let run = 0;
beforeEach(() => {
  setDatabase(new OoFRDatabase(`oofr2-fix-${(run += 1)}`));
});

const vive = { lemma: "vive", surface: "vive", translation: "鲈鱼", ipa: "/viv/", partOfSpeech: "名词" };

describe("reporting and fixing a dictionary meaning", () => {
  it("a reported word is saved and waits in 待补充, until the mark is taken back", async () => {
    const card = await reportWordMeaning(vive, LOOKUP_SOURCE);
    expect(card.dictIssue).toBeTruthy();
    expect(card.sourceTitle).toBe("查词");
    const cards = await db.cards.toArray();
    expect(filterCards(cards, "incomplete").map((item) => item.lemma)).toEqual(["vive"]);
    await clearWordIssue(card.id);
    expect(filterCards(await db.cards.toArray(), "incomplete")).toEqual([]);
  });

  it("a fix becomes the word's meaning and clears the mark", async () => {
    await reportWordMeaning(vive, LOOKUP_SOURCE);
    const fixed = await fixWordMeaning(vive, meaningSenses("龙䲢、 毒刺鱼；龙䲢"), LOOKUP_SOURCE);
    const stored = await db.cards.get(fixed.id);
    expect(stored?.dictFix?.senses).toEqual(["龙䲢", "毒刺鱼"]);
    expect(stored?.translation).toBe("龙䲢；毒刺鱼");
    expect(stored?.dictIssue).toBeUndefined();
    expect(await db.cards.count()).toBe(1);
  });

  it("sync and backups keep a mark and a fix, and leave other cards as they were", async () => {
    const card = await fixWordMeaning(vive, ["龙䲢"], LOOKUP_SOURCE);
    const again = sanitizeCard(JSON.parse(JSON.stringify({ ...card, dictIssue: "2026-10-22T10:00:00.000Z" })));
    expect(again?.dictFix?.senses).toEqual(["龙䲢"]);
    expect(again?.dictIssue).toBe("2026-10-22T10:00:00.000Z");
    const { dictFix: _fix, ...plain } = card;
    expect(Object.keys(sanitizeCard(plain) ?? {})).not.toContain("dictFix");
    expect(Object.keys(sanitizeCard(plain) ?? {})).not.toContain("dictIssue");
  });
});
