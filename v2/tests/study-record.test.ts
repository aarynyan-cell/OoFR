import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { longestRun, studyRecord } from "../src/app/studyRecord";
import { OoFRDatabase, db, setDatabase } from "../src/db/database";
import { getStudy, markStudiedToday } from "../src/db/repo";

// 学习记录: studied days, the streak, totals and badges.

let run = 0;
beforeEach(() => {
  setDatabase(new OoFRDatabase(`oofr2-record-${(run += 1)}`));
});

const day = (text: string) => new Date(`${text}T10:00:00`);

describe("studied days", () => {
  it("counts every bit of study on its day and keeps the longest streak", async () => {
    await markStudiedToday(day("2026-10-01"));
    await markStudiedToday(day("2026-10-02"));
    await markStudiedToday(day("2026-10-02"));
    await markStudiedToday(day("2026-10-03"));
    await markStudiedToday(day("2026-10-05"));
    const study = await getStudy();
    expect(study.days).toEqual({ "2026-10-01": 1, "2026-10-02": 2, "2026-10-03": 1, "2026-10-05": 1 });
    expect(study.streak).toBe(1);
    expect(study.bestStreak).toBe(3);
  });

  it("finds the longest run of days in a row, across months", () => {
    expect(longestRun(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-03"])).toBe(3);
    expect(longestRun([])).toBe(0);
  });

  it("works out earlier days from what was already kept, and the badges", async () => {
    await db.recordings.add({ key: "r1", blob: new Blob(["x"]), mimeType: "audio/mp4", durationMs: 900, createdAt: day("2026-09-10").toISOString() });
    await markStudiedToday(day("2026-10-21"));
    await markStudiedToday(day("2026-10-22"));
    const record = await studyRecord(day("2026-10-22"));
    expect(record.days.get("2026-09-10")).toBe(1);
    expect(record.daysStudied).toBe(3);
    expect(record.streak).toBe(2);
    expect(record.studiedToday).toBe(true);
    expect(record.shadowed).toBe(1);
    const week = record.badges.find((badge) => badge.id === "week");
    expect(week).toMatchObject({ value: 2, goal: 7 });
  });
});
