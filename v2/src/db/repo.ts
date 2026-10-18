// Everything the pages read and change. Pages never talk to Dexie directly.

import { db } from "./database";
import { DEFAULT_SETTINGS, DEFAULT_STUDY, TAPE_COLORS, localDateKey, makeId, nowIso } from "./defaults";
import type { Card, CardStatus, Material, Sentence, Settings, StudyStats, Tape } from "./types";
import { type MaterialType, guessLanguage, inferMaterialType, normalizeWord, splitSentences } from "../text/split";

export async function getSettings(): Promise<Settings> {
  const stored = (await db.kv.get("settings"))?.value as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await db.transaction("rw", db.kv, async () => {
    await db.kv.put({ key: "settings", value: { ...(await getSettings()), ...patch } });
  });
}

export async function getStudy(): Promise<StudyStats> {
  const stored = (await db.kv.get("study"))?.value as Partial<StudyStats> | undefined;
  return { ...DEFAULT_STUDY, ...stored };
}

// Called when the learner actually studies (plays a lesson, reviews a card).
export async function markStudiedToday(today = new Date()): Promise<StudyStats> {
  return db.transaction("rw", db.kv, async () => {
    const study = await getStudy();
    const key = localDateKey(today);
    if (study.lastStudyDate === key) return study;
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const next = { ...study, streak: study.lastStudyDate === localDateKey(yesterday) ? study.streak + 1 : 1, lastStudyDate: key };
    await db.kv.put({ key: "study", value: next });
    return next;
  });
}

// A streak only counts while it is unbroken (studied today or yesterday).
export function currentStreak(study: StudyStats, today = new Date()): number {
  if (!study.lastStudyDate) return 0;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  return [localDateKey(today), localDateKey(yesterday)].includes(study.lastStudyDate) ? study.streak : 0;
}

export async function listTapes(): Promise<Tape[]> {
  return db.tapes.orderBy("order").toArray();
}

export async function createTape(title: string, color?: string): Promise<Tape> {
  const count = await db.tapes.count();
  const tape: Tape = {
    id: makeId("tape"),
    title: title.trim() || "新磁带",
    description: "",
    color: color ?? TAPE_COLORS[count % TAPE_COLORS.length],
    order: count,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  await db.tapes.add(tape);
  return tape;
}

export function materialsOfTape(materials: Material[], tapeId: string): Material[] {
  return materials.filter((material) => material.tapeId === tapeId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// "A1", "A2"… within a tape, in the order the materials were added.
export function trackLabel(index: number): string {
  const side = index < 26 ? "A" : "B";
  return `${side}${(index % 26) + 1}`;
}

export interface MaterialProgress {
  done: boolean;
  started: boolean;
  ratio: number;
  label: string;
}

export function progressOf(material: Material): MaterialProgress {
  const total = material.sentences.length;
  if (material.finishedAt) return { done: true, started: true, ratio: 1, label: "学完了" };
  if (!material.lastStudiedAt) return { done: false, started: false, ratio: 0, label: "还没开始" };
  const position = Math.min(material.position, Math.max(0, total - 1));
  return { done: false, started: true, ratio: total ? position / total : 0, label: `学到第 ${position + 1} 句` };
}

export async function recentMaterials(limit = 3): Promise<Material[]> {
  const all = await db.materials.toArray();
  return all
    .filter((material) => material.lastStudiedAt)
    .sort((a, b) => String(b.lastStudiedAt).localeCompare(String(a.lastStudiedAt)))
    .slice(0, limit);
}

export interface NewMaterial {
  title: string;
  tapeId: string;
  text: string;
  materialType?: MaterialType;
  language?: "fr" | "en";
}

export function sentencesFromText(text: string, materialType: MaterialType): Sentence[] {
  const narration = ["文章", "笔记", "歌词"].includes(materialType);
  return splitSentences(text, materialType).map((part, index) => ({
    id: makeId("s"),
    text: part.text,
    translation: "",
    speakerId: narration ? "narrator" : part.speakerId || (index % 2 === 0 ? "a" : "b"),
    speakerLabel: narration ? "旁白" : part.speakerLabel || "",
    explanation: null,
    recordingKey: "",
    recordingMs: 0
  }));
}

export async function createMaterial(input: NewMaterial): Promise<Material> {
  const materialType = input.materialType ?? inferMaterialType(input.text);
  const sentences = sentencesFromText(input.text, materialType);
  if (!sentences.length) throw new Error("没有找到可以朗读的句子");
  if (!(await db.tapes.get(input.tapeId))) throw new Error("请先选一盘磁带");
  const material: Material = {
    id: makeId("material"),
    tapeId: input.tapeId,
    title: input.title.trim() || sentences[0].text.slice(0, 24),
    language: input.language ?? guessLanguage(input.text),
    materialType,
    description: "",
    notes: "",
    sentences,
    lexicalUnits: [],
    position: 0,
    finishedAt: null,
    studyCount: 0,
    lastStudiedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  await db.materials.add(material);
  return material;
}

export async function setPosition(materialId: string, position: number): Promise<void> {
  await db.materials.update(materialId, { position: Math.max(0, position), lastStudiedAt: nowIso() });
}

export async function markFinished(materialId: string): Promise<void> {
  await db.transaction("rw", db.materials, async () => {
    const material = await db.materials.get(materialId);
    if (!material) return;
    await db.materials.update(materialId, { finishedAt: nowIso(), studyCount: material.studyCount + 1, lastStudiedAt: nowIso() });
  });
}

export function recordingKeyFor(materialId: string, sentenceId: string): string {
  return `rec:${materialId}:${sentenceId}`;
}

// Keeps the learner's latest take of a sentence (an earlier take is replaced).
export async function saveRecording(materialId: string, sentenceId: string, take: { blob: Blob; durationMs: number; mimeType: string }): Promise<string> {
  const key = recordingKeyFor(materialId, sentenceId);
  await db.transaction("rw", db.recordings, db.materials, db.kv, async () => {
    const material = await db.materials.get(materialId);
    if (!material) throw new Error("找不到这条素材");
    const previous = material.sentences.find((sentence) => sentence.id === sentenceId)?.recordingKey;
    if (previous && previous !== key) await db.recordings.delete(previous);
    await db.recordings.put({ key, blob: take.blob, mimeType: take.mimeType, durationMs: take.durationMs, createdAt: nowIso() });
    await db.materials.update(materialId, {
      sentences: material.sentences.map((sentence) => (sentence.id === sentenceId ? { ...sentence, recordingKey: key, recordingMs: take.durationMs } : sentence)),
      lastStudiedAt: nowIso()
    });
    const study = await getStudy();
    const week = weekKey(new Date());
    await db.kv.put({
      key: "study",
      value: { ...study, shadowWeek: week, shadowedThisWeek: study.shadowWeek === week ? study.shadowedThisWeek + 1 : 1 }
    });
  });
  return key;
}

// "2026-W42": the Monday-based week a date falls in.
export function weekKey(date: Date): string {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function shadowedThisWeek(study: StudyStats, today = new Date()): number {
  return study.shadowWeek === weekKey(today) ? study.shadowedThisWeek : 0;
}

function phraseKey(text: string): string {
  return text.toLocaleLowerCase("fr-FR").replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
}

export function cardKey(kind: Card["kind"], text: string): string {
  return kind === "word" ? normalizeWord(text) : phraseKey(text);
}

export async function findCard(kind: Card["kind"], text: string): Promise<Card | undefined> {
  const normalized = cardKey(kind, text);
  return db.cards.where("normalized").equals(normalized).and((card) => card.kind === kind).first();
}

// 收藏 a sentence. Saving it again keeps the one already there.
export async function saveSentence(material: Material, sentence: Sentence): Promise<Card> {
  const existing = await findCard("phrase", sentence.text);
  if (existing) return existing;
  const card: Card = {
    id: makeId("card"),
    kind: "phrase",
    text: sentence.text,
    normalized: cardKey("phrase", sentence.text),
    lemma: "",
    translation: sentence.translation,
    ipa: "",
    partOfSpeech: "",
    language: material.language,
    status: "new",
    wordbookIds: [],
    sourceMaterialId: material.id,
    sourceTitle: material.title,
    seenForms: [],
    practiceCount: 0,
    lastPracticedAt: null,
    review: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  await db.cards.add(card);
  return card;
}

export interface WordToSave {
  lemma: string;
  surface: string;
  translation: string;
  ipa: string;
  partOfSpeech: string;
}

// 收藏 a word under its dictionary form; saving another form of it (voudrais,
// veux…) only records that form on the card already there.
export async function saveWord(word: WordToSave, material: Material): Promise<{ card: Card; added: boolean }> {
  return db.transaction("rw", db.cards, async () => {
    const existing = await findCard("word", word.lemma);
    const form = { form: word.surface, normalized: normalizeWord(word.surface), count: 1 };
    if (existing) {
      const seen = existing.seenForms.find((item) => item.normalized === form.normalized);
      const seenForms = seen ? existing.seenForms.map((item) => (item === seen ? { ...item, count: item.count + 1 } : item)) : [...existing.seenForms, form];
      await db.cards.update(existing.id, { seenForms, translation: existing.translation || word.translation, updatedAt: nowIso() });
      return { card: { ...existing, seenForms }, added: false };
    }
    const card: Card = {
      id: makeId("card"),
      kind: "word",
      text: word.lemma,
      normalized: cardKey("word", word.lemma),
      lemma: word.lemma,
      translation: word.translation,
      ipa: word.ipa,
      partOfSpeech: word.partOfSpeech,
      language: material.language,
      status: "new",
      wordbookIds: [],
      sourceMaterialId: material.id,
      sourceTitle: material.title,
      seenForms: [form],
      practiceCount: 0,
      lastPracticedAt: null,
      review: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await db.cards.add(card);
    return { card, added: true };
  });
}

export async function removeCard(cardId: string): Promise<void> {
  await db.cards.delete(cardId);
}

export async function setCardStatus(cardId: string, status: CardStatus): Promise<void> {
  await db.cards.update(cardId, { status, updatedAt: nowIso() });
}

export type CardFilter = "all" | "todo" | "got" | "incomplete";

export function filterCards(cards: Card[], filter: CardFilter, query = "", wordbookId = ""): Card[] {
  const needle = query.trim().toLocaleLowerCase("zh-CN");
  return cards
    .filter((card) => {
      if (filter === "todo") return card.status !== "got";
      if (filter === "got") return card.status === "got";
      if (filter === "incomplete") return !card.translation.trim();
      return true;
    })
    .filter((card) => !wordbookId || card.wordbookIds.includes(wordbookId))
    .filter((card) => !needle || `${card.text} ${card.translation} ${card.lemma}`.toLocaleLowerCase("zh-CN").includes(needle))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
