import { describe, expect, it } from "vitest";
import { MASTERED_DAYS, isNew, preview, retrievability, review } from "../src/review/fsrs";

const day = 86400000;
const start = new Date("2026-10-18T09:00:00Z");
const later = (from: Date, days: number) => new Date(from.getTime() + days * day);

describe("spaced repetition (FSRS-5)", () => {
  it("schedules a new card by the first answer", () => {
    expect(preview(null, start)).toEqual({ 1: "10 分钟后", 2: "明天", 3: "3 天后" });
    const good = review(null, 3, start);
    expect(good.reps).toBe(1);
    expect(Date.parse(good.due) - start.getTime()).toBe(3 * day);
  });

  it("spaces reviews further apart each time the card is remembered", () => {
    let state = review(null, 3, start);
    const intervals: number[] = [];
    let now = start;
    for (let round = 0; round < 5; round += 1) {
      now = new Date(state.due);
      const next = review(state, 3, now);
      intervals.push(Math.round((Date.parse(next.due) - now.getTime()) / day));
      state = next;
    }
    intervals.reduce((previous, interval) => {
      expect(interval).toBeGreaterThan(previous);
      return interval;
    }, 0);
    expect(state.stability).toBeGreaterThan(MASTERED_DAYS);
  });

  it("brings a forgotten card back soon and lowers its stability", () => {
    const learned = review(review(null, 3, start), 3, later(start, 3));
    const forgotten = review(learned, 1, new Date(learned.due));
    expect(forgotten.stability).toBeLessThan(learned.stability);
    expect(forgotten.lapses).toBe(1);
    expect(Date.parse(forgotten.due) - Date.parse(learned.due)).toBe(10 * 60000);
  });

  it("makes cards answered 'hard' harder than cards answered 'good'", () => {
    const first = review(null, 3, start);
    expect(review(first, 2, later(start, 3)).difficulty).toBeGreaterThan(review(first, 3, later(start, 3)).difficulty);
  });

  it("treats cards brought over from 1.0 without a schedule as new", () => {
    expect(isNew({ due: start.toISOString(), stability: 0, difficulty: 0, reps: 2, lapses: 0, lastReview: null })).toBe(true);
    const migrated = review({ due: start.toISOString(), stability: 0, difficulty: 0, reps: 2, lapses: 0, lastReview: null }, 3, start);
    expect(migrated.stability).toBeGreaterThan(0);
    expect(migrated.reps).toBe(3);
  });

  it("recall is 90% when the elapsed time equals the stability", () => {
    expect(retrievability(10, 10)).toBeCloseTo(0.9, 5);
  });
});
