import type { MaterialType } from "../text/split";

export type Language = "fr" | "en";

// 磁带: a category the learner sorts materials into (1.0 called these "albums" internally).
export interface Tape {
  id: string;
  title: string;
  description: string;
  color: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Explanation {
  summary: string;
  structure: string;
  grammarPoints: string[];
  morphology: string;
  pitfalls: string[];
  examples: string[];
  model: string;
  language: string;
  version: string;
  source: string;
  generatedAt: string | null;
}

export interface Sentence {
  id: string;
  text: string;
  translation: string;
  speakerId: string;
  speakerLabel: string;
  explanation: Explanation | null;
  // "ai" when the local AI wrote the translation (shown as such; the learner's own is never replaced).
  translationSource?: "ai";
  // Key in the recordings table; "" when the learner has not recorded this sentence.
  recordingKey: string;
  recordingMs: number;
  // How the latest shadowing take went (score is null where speech recognition is missing).
  shadow?: ShadowResult;
}

export interface ShadowResult {
  score: number | null;
  missed: string[];
  heard: string;
  at: string;
}

export interface LexicalUnit {
  text: string;
  lemma: string;
  type: string;
  verified: string;
}

// 素材: one lesson, the entry point for listening, shadowing and practice.
export interface Material {
  id: string;
  tapeId: string;
  title: string;
  language: Language;
  materialType: MaterialType;
  description: string;
  notes: string;
  sentences: Sentence[];
  lexicalUnits: LexicalUnit[];
  // Index of the sentence the learner was on.
  position: number;
  finishedAt: string | null;
  studyCount: number;
  lastStudiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CardStatus = "new" | "learning" | "got";

export interface SeenForm {
  form: string;
  normalized: string;
  count: number;
}

export interface ReviewState {
  due: string;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  lastReview: string | null;
}

// 词句本 entry: a word or a sentence the learner kept.
export interface Card {
  id: string;
  kind: "word" | "phrase";
  text: string;
  normalized: string;
  lemma: string;
  translation: string;
  ipa: string;
  partOfSpeech: string;
  language: Language;
  status: CardStatus;
  wordbookIds: string[];
  sourceMaterialId: string;
  sourceTitle: string;
  seenForms: SeenForm[];
  practiceCount: number;
  lastPracticedAt: string | null;
  review: ReviewState | null;
  createdAt: string;
  updatedAt: string;
}

export interface Wordbook {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface Recording {
  key: string;
  blob: Blob;
  mimeType: string;
  durationMs: number;
  createdAt: string;
}

export interface DictionaryEntry {
  key: string;
  lemma: string;
  partOfSpeech: string;
  senses: string[];
  contextMeaning: string;
  formNote: string;
  usageNote: string;
  model: string;
  version: string;
  updatedAt: string;
}

export type ThemeChoice = "night" | "day" | "system";
export type PlayMode = "all" | "one";
export type TextMode = "fr" | "zh" | "both";

export interface Settings {
  rate: number;
  repeat: number;
  gapMs: number;
  voice: string;
  playMode: PlayMode;
  showTranslation: boolean;
  // What the lesson shows: French, Chinese, or both (法 / 中 / 双语).
  textMode: TextMode;
  theme: ThemeChoice;
  systemLanguage: "zh" | "en" | "fr";
  lastBackupAt: string;
  practiceKinds: ("listen" | "cloze" | "order")[];
  // Let the local AI prepare translations and the next explanations while a lesson is open.
  aiPrepare: boolean;
  // 后台播放: a lesson plays as one track, so it keeps going with the phone locked.
  backgroundPlay: boolean;
}

export interface StudyStats {
  streak: number;
  lastStudyDate: string | null;
  dailyGoal: number;
  cardsReviewed: number;
  cardsKnown: number;
  shadowedThisWeek: number;
  // Week ("2026-W42") the shadowing count belongs to.
  shadowWeek: string;
}

export interface MigrationRecord {
  importedAt: string;
  source: "1.0-local" | "1.0-file";
  counts: ImportCounts;
}

export interface ImportCounts {
  tapes: number;
  materials: number;
  cards: number;
  wordbooks: number;
  recordings: number;
}

export interface KvRow {
  key: string;
  value: unknown;
}
