// 学习记录 on 我的: the streak, a calendar of studied days, totals and badges.
// Days are counted as the learner studies (markStudiedToday); days from before
// that are worked out from what is already kept (takes, saved and reviewed
// words, lessons studied and finished), so the calendar is never empty.

import { db } from "../db/database";
import { localDateKey } from "../db/defaults";
import { currentStreak, getStudy } from "../db/repo";

export interface Badge {
  id: string;
  title: string;
  hint: string;
  icon: "reel" | "mic" | "bookmark" | "check" | "sparkle" | "cassette";
  value: number;
  goal: number;
}

export interface StudyRecord {
  days: Map<string, number>;
  streak: number;
  bestStreak: number;
  studiedToday: boolean;
  daysStudied: number;
  shadowed: number;
  saved: number;
  mastered: number;
  finished: number;
  reviews: number;
  badges: Badge[];
}

const dayOf = (stamp: string | null | undefined) => {
  const time = stamp ? Date.parse(stamp) : Number.NaN;
  return Number.isNaN(time) ? "" : localDateKey(new Date(time));
};

// The longest run of studied days in a row.
export function longestRun(days: Iterable<string>): number {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let previous = "";
  for (const day of sorted) {
    const expected = previous ? new Date(`${previous}T12:00:00`) : null;
    expected?.setDate(expected.getDate() + 1);
    run = expected && localDateKey(expected) === day ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  return best;
}

export function badgesFor(record: Omit<StudyRecord, "badges" | "days" | "studiedToday" | "streak">): Badge[] {
  return [
    { id: "first-lesson", title: "第一盘磁带", hint: "听完 1 课", icon: "cassette", value: record.finished, goal: 1 },
    { id: "week", title: "一周不断", hint: "连续学习 7 天", icon: "reel", value: record.bestStreak, goal: 7 },
    { id: "shadow-50", title: "开口跟读", hint: "跟读 50 句", icon: "mic", value: record.shadowed, goal: 50 },
    { id: "saved-100", title: "词句收藏家", hint: "收藏 100 个词句", icon: "bookmark", value: record.saved, goal: 100 },
    { id: "mastered-50", title: "记住了", hint: "掌握 50 个词句", icon: "check", value: record.mastered, goal: 50 },
    { id: "lessons-10", title: "十盘磁带", hint: "听完 10 课", icon: "cassette", value: record.finished, goal: 10 },
    { id: "month", title: "月度坚持", hint: "连续学习 30 天", icon: "reel", value: record.bestStreak, goal: 30 },
    { id: "shadow-300", title: "跟读达人", hint: "跟读 300 句", icon: "mic", value: record.shadowed, goal: 300 },
    { id: "reviews-500", title: "复习 500 次", hint: "复习词句 500 次", icon: "sparkle", value: record.reviews, goal: 500 }
  ];
}

export async function studyRecord(today = new Date()): Promise<StudyRecord> {
  const [study, recordings, cards, materials] = await Promise.all([getStudy(), db.recordings.toArray(), db.cards.toArray(), db.materials.toArray()]);
  const days = new Map<string, number>(Object.entries(study.days ?? {}));
  const counted = new Set(days.keys());
  // Days from before they were counted: one mark for each thing done that day.
  const add = (stamp: string | null | undefined) => {
    const day = dayOf(stamp);
    if (day && !counted.has(day)) days.set(day, (days.get(day) ?? 0) + 1);
  };
  for (const recording of recordings) add(recording.createdAt);
  for (const card of cards) {
    add(card.createdAt);
    add(card.review?.lastReview);
    add(card.lastPracticedAt);
  }
  for (const material of materials) {
    add(material.lastStudiedAt);
    add(material.finishedAt);
  }
  if (study.lastStudyDate && !days.has(study.lastStudyDate)) days.set(study.lastStudyDate, 1);

  const streak = currentStreak(study, today);
  const totals = {
    bestStreak: Math.max(study.bestStreak ?? 0, streak, longestRun(days.keys())),
    daysStudied: days.size,
    shadowed: recordings.length,
    saved: cards.length,
    mastered: cards.filter((card) => card.status === "got").length,
    finished: materials.filter((material) => material.finishedAt).length,
    reviews: study.cardsReviewed
  };
  return { ...totals, days, streak, studiedToday: days.has(localDateKey(today)), badges: badgesFor(totals) };
}
