import type { Settings, StudyStats } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  rate: 0.85,
  repeat: 1,
  gapMs: 400,
  voice: "",
  playMode: "all",
  showTranslation: true,
  theme: "night",
  systemLanguage: "zh",
  lastBackupAt: "",
  practiceKinds: ["listen", "cloze", "order"],
  aiPrepare: true
};

export const DEFAULT_STUDY: StudyStats = {
  streak: 0,
  lastStudyDate: null,
  dailyGoal: 3,
  cardsReviewed: 0,
  cardsKnown: 0,
  shadowedThisWeek: 0,
  shadowWeek: ""
};

// Label colours for tapes (see the design spec: amber, teal, cream).
export const TAPE_COLORS = ["#E9C46A", "#7CC1B6", "#D8D3C4"];

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`;
}

export function localDateKey(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
