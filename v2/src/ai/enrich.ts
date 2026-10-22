// The local AI's work queue, one job at a time, in this order:
//   0. the sentence the learner asked 讲解 for;
//   1. the open lesson: its missing translations (from the current sentence on),
//      then its explanations sentence by sentence (current one first);
//   2. missing translations of other lessons, newest first (new lessons start
//      as soon as they are saved).
// Moving to another sentence re-plans tier 1, so that sentence comes next.

import { useSyncExternalStore } from "react";
import { db } from "../db/database";
import { applySentenceAi, getSettings } from "../db/repo";
import type { Material, Sentence } from "../db/types";
import { dictionary } from "../dict/dictionary";
import { type FormLookup, sentenceFacts } from "./grammar";
import { AiError } from "./backend";
import { NEEDS_EXPLAIN_KEY, aiState, noteAiFailure, onAiChange, readyAi } from "./state";
import { explainSentence, translateSentences } from "./tasks";

type Kind = "translate" | "explain";

interface Job {
  kind: Kind;
  materialId: string;
  // "" for a lesson's translations.
  sentenceId: string;
  tier: 0 | 1 | 2;
  // Translations start from this sentence.
  from?: number;
}

export interface JobState {
  status: "queued" | "running" | "failed";
  error: string;
}

const TRANSLATE_BATCH = 8;
const LIBRARY_LESSONS = 10;

let queue: Job[] = [];
let running = false;
const states = new Map<string, JobState>();
const listeners = new Set<() => void>();

const keyOf = (job: Job) => `${job.kind}:${job.materialId}:${job.sentenceId}`;

function notify(): void {
  listeners.forEach((listener) => listener());
}

function setState(job: Job, value: JobState | null): void {
  if (value) states.set(keyOf(job), value);
  else states.delete(keyOf(job));
  notify();
}

export function useAiJob(kind: Kind, materialId: string, sentenceId = ""): JobState | undefined {
  const key = `${kind}:${materialId}:${sentenceId}`;
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => states.get(key),
    () => undefined
  );
}

// Tier 0 goes to the very front; other jobs go after everything of their tier.
function enqueue(job: Job): void {
  const key = keyOf(job);
  if (states.get(key)?.status === "running") return;
  const existing = queue.find((item) => keyOf(item) === key);
  queue = queue.filter((item) => keyOf(item) !== key);
  const placed = existing && existing.tier < job.tier ? { ...job, tier: existing.tier } : job;
  const at = placed.tier === 0 ? 0 : queue.findIndex((item) => item.tier > placed.tier);
  queue.splice(at < 0 ? queue.length : at, 0, placed);
  setState(placed, { status: "queued", error: "" });
}

const missingTranslation = (material: Material) => material.sentences.some((sentence) => !sentence.translation.trim());

// Called when a lesson opens or the learner moves to another sentence.
export function planLesson(material: Material, index: number): void {
  // The previous open lesson's explanations wait until it is opened again.
  for (const job of queue.filter((item) => item.tier === 1)) states.delete(keyOf(job));
  queue = queue.filter((item) => item.tier !== 1);
  if (missingTranslation(material)) enqueue({ kind: "translate", materialId: material.id, sentenceId: "", tier: 1, from: index });
  const order = aiState().canExplain ? [...material.sentences.slice(index), ...material.sentences.slice(0, index)] : [];
  for (const sentence of order) {
    if (!sentence.explanation && states.get(`explain:${material.id}:${sentence.id}`)?.status !== "failed") {
      enqueue({ kind: "explain", materialId: material.id, sentenceId: sentence.id, tier: 1 });
    }
  }
  void pump();
}

// The learner tapped 讲解 on a sentence that has none yet: it goes first.
export function explainNow(material: Material, sentence: Sentence): void {
  const job: Job = { kind: "explain", materialId: material.id, sentenceId: sentence.id, tier: 0 };
  // Online with a translation key only: say what is missing instead of trying.
  if (!aiState().canExplain) return setState(job, { status: "failed", error: NEEDS_EXPLAIN_KEY });
  enqueue(job);
  void pump();
}

// The learner asked for this lesson's translations (法 / 中 / 双语): they go first.
export function translateNow(material: Material, index = 0): boolean {
  if (!missingTranslation(material)) return false;
  enqueue({ kind: "translate", materialId: material.id, sentenceId: "", tier: 0, from: index });
  void pump();
  return true;
}

// A lesson was just added: translate it in the background straight away.
export function prepareMaterial(material: Material): void {
  if (missingTranslation(material)) enqueue({ kind: "translate", materialId: material.id, sentenceId: "", tier: 2 });
  void pump();
}

// When the AI becomes ready: the newest lessons still missing translations.
async function prepareLibrary(): Promise<void> {
  if (!(await getSettings()).aiPrepare) return;
  const materials = await db.materials.orderBy("createdAt").reverse().toArray();
  materials.filter(missingTranslation).slice(0, LIBRARY_LESSONS).forEach(prepareMaterial);
}

const formLookup: FormLookup = async (word, context, occurrence) => {
  const result = await dictionary.lookup(word, "fr", { context, occurrence });
  if (!result) return null;
  // Form details only when the dictionary read the word as that form ("comment" is the adverb, not a form of "commer").
  if (!result.isInflected || !result.form) return { lemma: result.lemma, pos: result.posList[0] ?? "", features: "" };
  return { lemma: result.form.lemma || result.lemma, pos: result.form.pos, features: result.form.features };
};

async function run(job: Job, ai: NonNullable<ReturnType<typeof readyAi>>): Promise<void> {
  const material = await db.materials.get(job.materialId);
  if (!material) return;
  if (job.kind === "translate") {
    // The sentences the learner is about to read first.
    const from = Math.min(Math.max(0, job.from ?? 0), material.sentences.length);
    const ordered = [...material.sentences.slice(from), ...material.sentences.slice(0, from)];
    const missing = ordered.filter((sentence) => !sentence.translation.trim());
    for (let start = 0; start < missing.length; start += TRANSLATE_BATCH) {
      const part = missing.slice(start, start + TRANSLATE_BATCH);
      const result = await translateSentences(ai.backend, ai.model, material, part);
      await applySentenceAi(material.id, part.filter((sentence) => result.has(sentence.id)).map((sentence) => ({ sentenceId: sentence.id, text: sentence.text, translation: result.get(sentence.id) })));
    }
    return;
  }
  const sentence = material.sentences.find((item) => item.id === job.sentenceId);
  if (!sentence || sentence.explanation) return;
  if (!aiState().canExplain) throw new AiError(NEEDS_EXPLAIN_KEY);
  const facts = material.language === "fr" ? await sentenceFacts(sentence.text, formLookup).catch(() => null) : null;
  const explanation = await explainSentence(ai.backend, ai.model, material, sentence, facts);
  await applySentenceAi(material.id, [{ sentenceId: sentence.id, text: sentence.text, explanation }]);
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const ai = readyAi();
      const job = queue[0];
      if (!ai || !job) return;
      queue.shift();
      setState(job, { status: "running", error: "" });
      try {
        await run(job, ai);
        setState(job, null);
      } catch (error) {
        setState(job, { status: "failed", error: error instanceof Error ? error.message : "生成失败" });
        noteAiFailure(error);
      }
    }
  } finally {
    running = false;
  }
}

// Work waiting for the AI starts as soon as it becomes ready.
let wasReady = false;
onAiChange(() => {
  const ready = Boolean(readyAi());
  if (ready && !wasReady) void prepareLibrary();
  wasReady = ready;
  if (ready && queue.length) void pump();
});

// A failed sentence can be asked again.
export function retryJob(kind: Kind, materialId: string, sentenceId = ""): void {
  enqueue({ kind, materialId, sentenceId, tier: 0 });
  void pump();
}

export function resetQueueForTests(): void {
  queue = [];
  running = false;
  wasReady = false;
  states.clear();
}

export function queueForTests(): string[] {
  return queue.map(keyOf);
}
