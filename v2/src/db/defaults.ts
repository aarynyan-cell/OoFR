import type { Settings, StudyStats } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  rate: 0.85,
  repeat: 1,
  gapMs: 400,
  voice: "",
  playMode: "all",
  showTranslation: true,
  textMode: "both",
  theme: "system",
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

// Label colours for tapes: the design spec's amber, teal and cream first, then
// more soft cassette-label colours so tapes need not share one. All are light
// enough for dark label text in both themes.
export const TAPE_PALETTE = [
  { color: "#E9C46A", name: "琥珀" },
  { color: "#7CC1B6", name: "青绿" },
  { color: "#D8D3C4", name: "米白" },
  { color: "#F4A261", name: "杏橙" },
  { color: "#9DB4D3", name: "雾蓝" },
  { color: "#A8C686", name: "草绿" },
  { color: "#E5989B", name: "豆沙" },
  { color: "#C3AED6", name: "淡紫" },
  { color: "#E07A5F", name: "陶红" },
  { color: "#B8A99A", name: "灰褐" }
] as const;
export const TAPE_COLORS: string[] = TAPE_PALETTE.map((item) => item.color);

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
