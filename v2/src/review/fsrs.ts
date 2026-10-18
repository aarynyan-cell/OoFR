// Spaced repetition with FSRS-5 (the free, open scheduler Anki uses), default
// parameters, aiming at 90% recall. Three answers, matching the review card:
// 忘了 (again), 模糊 (hard), 记得 (good).
//
// Stability S = days until recall drops to 90%; difficulty D in 1..10.

import type { ReviewState } from "../db/types";

export type Grade = 1 | 2 | 3;

const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const DECAY = -0.5;
const FACTOR = 19 / 81;
const DAY = 86400000;
export const RELEARN_MINUTES = 10;
// A card this stable is shown as "已掌握".
export const MASTERED_DAYS = 21;

const clampDifficulty = (value: number) => Math.min(10, Math.max(1, value));

export function retrievability(elapsedDays: number, stability: number): number {
  return Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / stability, DECAY);
}

function initialDifficulty(grade: number): number {
  return clampDifficulty(W[4] - Math.exp(W[5] * (grade - 1)) + 1);
}

function nextDifficulty(difficulty: number, grade: Grade): number {
  const delta = -W[6] * (grade - 3);
  const damped = difficulty + (delta * (10 - difficulty)) / 9;
  return clampDifficulty(W[7] * initialDifficulty(4) + (1 - W[7]) * damped);
}

function recallStability(difficulty: number, stability: number, recall: number, grade: Grade): number {
  const hardPenalty = grade === 2 ? W[15] : 1;
  return stability * (Math.exp(W[8]) * (11 - difficulty) * Math.pow(stability, -W[9]) * (Math.exp(W[10] * (1 - recall)) - 1) * hardPenalty + 1);
}

function forgetStability(difficulty: number, stability: number, recall: number): number {
  const value = W[11] * Math.pow(difficulty, -W[12]) * (Math.pow(stability + 1, W[13]) - 1) * Math.exp(W[14] * (1 - recall));
  return Math.min(value, stability);
}

function shortTermStability(stability: number, grade: Grade): number {
  return stability * Math.exp(W[17] * (grade - 3 + W[18]));
}

export function isNew(review: ReviewState | null): boolean {
  return !review || review.stability <= 0;
}

export function review(previous: ReviewState | null, grade: Grade, now = new Date()): ReviewState {
  let stability: number;
  let difficulty: number;
  if (isNew(previous)) {
    stability = W[grade - 1];
    difficulty = initialDifficulty(grade);
  } else {
    const last = previous!.lastReview ? Date.parse(previous!.lastReview) : now.getTime();
    const elapsed = (now.getTime() - last) / DAY;
    difficulty = nextDifficulty(previous!.difficulty, grade);
    if (elapsed < 1) stability = shortTermStability(previous!.stability, grade);
    else {
      const recall = retrievability(elapsed, previous!.stability);
      stability = grade === 1 ? forgetStability(previous!.difficulty, previous!.stability, recall) : recallStability(previous!.difficulty, previous!.stability, recall, grade);
    }
  }
  stability = Math.max(0.1, stability);
  const due = new Date(now.getTime() + intervalMs(stability, grade));
  return {
    due: due.toISOString(),
    stability,
    difficulty,
    reps: (previous?.reps ?? 0) + 1,
    lapses: (previous?.lapses ?? 0) + (grade === 1 && !isNew(previous) ? 1 : 0),
    lastReview: now.toISOString()
  };
}

// At 90% target recall the interval equals the stability; a forgotten card
// comes back within the same session.
function intervalMs(stability: number, grade: Grade): number {
  if (grade === 1) return RELEARN_MINUTES * 60000;
  return Math.max(1, Math.round(stability)) * DAY;
}

// What each button would schedule, for the labels under them ("4 天后").
export function preview(previous: ReviewState | null, now = new Date()): Record<Grade, string> {
  const label = (grade: Grade) => {
    const next = review(previous, grade, now);
    const ms = Date.parse(next.due) - now.getTime();
    if (ms < 3600000) return `${Math.round(ms / 60000)} 分钟后`;
    const days = Math.round(ms / DAY);
    if (days === 1) return "明天";
    if (days < 30) return `${days} 天后`;
    if (days < 365) return `${Math.round(days / 30)} 个月后`;
    return `${(days / 365).toFixed(1)} 年后`;
  };
  // Never show "记得" sooner than "模糊".
  const hard = review(previous, 2, now);
  const good = review(previous, 3, now);
  const labels = { 1: label(1), 2: label(2), 3: label(3) } as Record<Grade, string>;
  if (Date.parse(good.due) <= Date.parse(hard.due)) labels[3] = labels[2];
  return labels;
}
