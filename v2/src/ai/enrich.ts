// The local AI's work queue: one job at a time, newest lesson first. While a
// lesson is open it fills in missing translations and prepares the
// explanations of the next few sentences, so 讲解 is usually ready when tapped.

import { useSyncExternalStore } from "react";
import { db } from "../db/database";
import { applySentenceAi } from "../db/repo";
import type { Material, Sentence } from "../db/types";
import { dictionary } from "../dict/dictionary";
import { type FormLookup, sentenceFacts } from "./grammar";
import { noteAiFailure, onAiChange, readyAi } from "./state";
import { explainSentence, translateSentences } from "./tasks";

type Kind = "translate" | "explain";

interface Job {
  kind: Kind;
  materialId: string;
  // "" for a lesson's translations.
  sentenceId: string;
}

export interface JobState {
  status: "queued" | "running" | "failed";
  error: string;
}

const AHEAD = 3;
const TRANSLATE_BATCH = 8;

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

function enqueue(job: Job, first = false): void {
  const key = keyOf(job);
  if (states.get(key)?.status === "running") return;
  queue = queue.filter((item) => keyOf(item) !== key);
  if (first) queue.unshift(job);
  else queue.push(job);
  setState(job, { status: "queued", error: "" });
}

// Called when a lesson opens or the learner moves to another sentence.
export function planLesson(material: Material, index: number): void {
  // Work queued for other lessons can wait until they are opened again.
  for (const job of queue.filter((item) => item.materialId !== material.id)) states.delete(keyOf(job));
  queue = queue.filter((item) => item.materialId === material.id);
  if (material.sentences.some((sentence) => !sentence.translation.trim())) enqueue({ kind: "translate", materialId: material.id, sentenceId: "" });
  for (const sentence of material.sentences.slice(index, index + AHEAD)) {
    if (!sentence.explanation && states.get(`explain:${material.id}:${sentence.id}`)?.status !== "failed") {
      enqueue({ kind: "explain", materialId: material.id, sentenceId: sentence.id });
    }
  }
  void pump();
}

// The learner tapped 讲解 on a sentence that has none yet: it goes first.
export function explainNow(material: Material, sentence: Sentence): void {
  enqueue({ kind: "explain", materialId: material.id, sentenceId: sentence.id }, true);
  void pump();
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
    const missing = material.sentences.filter((sentence) => !sentence.translation.trim());
    for (let start = 0; start < missing.length; start += TRANSLATE_BATCH) {
      const part = missing.slice(start, start + TRANSLATE_BATCH);
      const result = await translateSentences(ai.backend, ai.model, material, part);
      await applySentenceAi(material.id, part.filter((sentence) => result.has(sentence.id)).map((sentence) => ({ sentenceId: sentence.id, text: sentence.text, translation: result.get(sentence.id) })));
    }
    return;
  }
  const sentence = material.sentences.find((item) => item.id === job.sentenceId);
  if (!sentence || sentence.explanation) return;
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
onAiChange(() => {
  if (readyAi() && queue.length) void pump();
});

// A failed sentence can be asked again.
export function retryJob(kind: Kind, materialId: string, sentenceId = ""): void {
  enqueue({ kind, materialId, sentenceId }, true);
  void pump();
}

export function resetQueueForTests(): void {
  queue = [];
  running = false;
  states.clear();
}
