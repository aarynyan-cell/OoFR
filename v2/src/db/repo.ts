// Everything the pages read and change. Pages never talk to Dexie directly.

import { db } from "./database";
import { DEFAULT_SETTINGS, DEFAULT_STUDY, TAPE_COLORS, localDateKey, makeId, nowIso } from "./defaults";
import type { Card, CardStatus, Material, Sentence, Settings, ShadowResult, StudyStats, Tape, Wordbook } from "./types";
import { type Grade, MASTERED_DAYS, review as scheduleReview } from "../review/fsrs";
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

// The text as the learner would type it again ("A: …" lines for dialogues).
export function materialText(material: Material): string {
  const dialogue = material.materialType === "情景对话";
  return material.sentences.map((sentence) => (dialogue && sentence.speakerLabel ? `${sentence.speakerLabel}: ${sentence.text}` : sentence.text)).join("\n");
}

export interface MaterialChanges {
  title?: string;
  tapeId?: string;
  text?: string;
  materialType?: MaterialType;
}

// Editing the text keeps everything attached to sentences that did not change
// (translation, explanation, recording); recordings of removed sentences go.
export async function updateMaterial(materialId: string, changes: MaterialChanges): Promise<Material> {
  return db.transaction("rw", db.materials, db.recordings, db.tapes, async () => {
    const material = await db.materials.get(materialId);
    if (!material) throw new Error("找不到这条素材");
    if (changes.tapeId && !(await db.tapes.get(changes.tapeId))) throw new Error("找不到这盘磁带");
    const next: Material = { ...material, updatedAt: nowIso() };
    if (changes.title !== undefined) next.title = changes.title.trim() || material.title;
    if (changes.tapeId) next.tapeId = changes.tapeId;
    if (changes.text !== undefined) {
      const materialType = changes.materialType ?? material.materialType;
      const fresh = sentencesFromText(changes.text, materialType);
      if (!fresh.length) throw new Error("没有找到可以朗读的句子");
      const unused = [...material.sentences];
      next.sentences = fresh.map((sentence) => {
        const match = unused.findIndex((old) => old.text === sentence.text);
        if (match < 0) return sentence;
        const [old] = unused.splice(match, 1);
        return old.speakerLabel === sentence.speakerLabel ? old : { ...old, speakerId: sentence.speakerId, speakerLabel: sentence.speakerLabel };
      });
      next.materialType = materialType;
      next.position = Math.min(material.position, next.sentences.length - 1);
      await db.recordings.bulkDelete(unused.map((sentence) => sentence.recordingKey).filter(Boolean));
    }
    await db.materials.put(next);
    return next;
  });
}

// Removes a material and its recordings. Saved words and sentences stay in the phrasebook.
export async function deleteMaterial(materialId: string): Promise<void> {
  await db.transaction("rw", db.materials, db.recordings, async () => {
    const material = await db.materials.get(materialId);
    if (!material) return;
    await db.recordings.bulkDelete(material.sentences.map((sentence) => sentence.recordingKey).filter(Boolean));
    await db.materials.delete(materialId);
  });
}

export async function updateTape(tapeId: string, changes: { title?: string; color?: string }): Promise<void> {
  await db.tapes.update(tapeId, {
    ...(changes.title !== undefined && changes.title.trim() ? { title: changes.title.trim() } : {}),
    ...(changes.color ? { color: changes.color } : {}),
    updatedAt: nowIso()
  });
}

// Deleting a tape never deletes lessons: they move to another tape (one called
// 其他素材 is made if this was the last tape).
export async function deleteTape(tapeId: string): Promise<{ movedTo: string | null; moved: number }> {
  return db.transaction("rw", db.tapes, db.materials, async () => {
    const tapes = (await db.tapes.orderBy("order").toArray()).filter((tape) => tape.id !== tapeId);
    const materials = await db.materials.where("tapeId").equals(tapeId).toArray();
    let target: Tape | undefined = tapes[0];
    if (materials.length && !target) {
      target = { id: makeId("tape"), title: "其他素材", description: "", color: TAPE_COLORS[2], order: 0, createdAt: nowIso(), updatedAt: nowIso() };
      await db.tapes.add(target);
    }
    for (const material of materials) await db.materials.update(material.id, { tapeId: target!.id, updatedAt: nowIso() });
    await db.tapes.delete(tapeId);
    await Promise.all(tapes.map((tape, index) => db.tapes.update(tape.id, { order: index })));
    return { movedTo: materials.length ? target!.title : null, moved: materials.length };
  });
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
export async function saveRecording(
  materialId: string,
  sentenceId: string,
  take: { blob: Blob; durationMs: number; mimeType: string },
  result?: Omit<ShadowResult, "at">
): Promise<string> {
  const key = recordingKeyFor(materialId, sentenceId);
  await db.transaction("rw", db.recordings, db.materials, db.kv, async () => {
    const material = await db.materials.get(materialId);
    if (!material) throw new Error("找不到这条素材");
    const previous = material.sentences.find((sentence) => sentence.id === sentenceId)?.recordingKey;
    if (previous && previous !== key) await db.recordings.delete(previous);
    await db.recordings.put({ key, blob: take.blob, mimeType: take.mimeType, durationMs: take.durationMs, createdAt: nowIso() });
    await db.materials.update(materialId, {
      sentences: material.sentences.map((sentence) =>
        sentence.id === sentenceId ? { ...sentence, recordingKey: key, recordingMs: take.durationMs, shadow: result ? { ...result, at: nowIso() } : undefined } : sentence
      ),
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

// New cards introduced per day, so a big import does not turn into a wall of reviews.
export const NEW_CARDS_PER_DAY = 20;

// Today's reviews: cards that are due (oldest first), then new cards up to the daily limit.
// Cards marked 已掌握 in 1.0 without a schedule are left out of the new ones.
export function reviewQueue(cards: Card[], now = new Date()): Card[] {
  const today = localDateKey(now);
  const time = now.getTime();
  const due = cards
    .filter((card) => card.review && Date.parse(card.review.due) <= time)
    .sort((a, b) => Date.parse(a.review!.due) - Date.parse(b.review!.due));
  const introducedToday = cards.filter((card) => card.review?.reps === 1 && card.review.lastReview && localDateKey(new Date(card.review.lastReview)) === today).length;
  const fresh = cards
    .filter((card) => !card.review && card.status !== "got")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, Math.max(0, NEW_CARDS_PER_DAY - introducedToday));
  return [...due, ...fresh];
}

export async function gradeCard(cardId: string, grade: Grade, now = new Date()): Promise<Card | undefined> {
  const updated = await db.transaction("rw", db.cards, db.kv, async () => {
    const card = await db.cards.get(cardId);
    if (!card) return undefined;
    const next = scheduleReview(card.review, grade, now);
    const status: CardStatus = grade === 1 ? "learning" : next.stability >= MASTERED_DAYS ? "got" : "learning";
    const changes = { review: next, status, practiceCount: card.practiceCount + 1, lastPracticedAt: now.toISOString(), updatedAt: now.toISOString() };
    await db.cards.update(cardId, changes);
    const study = await getStudy();
    await db.kv.put({ key: "study", value: { ...study, cardsReviewed: study.cardsReviewed + 1 } });
    return { ...card, ...changes };
  });
  await markStudiedToday(now);
  return updated;
}

// The three states shown everywhere (text highlights, phrasebook tags, word card).
export type Tone = CardStatus;
export const TONE_LABEL: Record<Tone, string> = { new: "待学", learning: "学习中", got: "已掌握" };

// 收藏 / 取消收藏 with one tap; returns whether the item is saved afterwards.
export async function toggleSentence(material: Material, sentence: Sentence): Promise<boolean> {
  const existing = await findCard("phrase", sentence.text);
  if (existing) {
    await db.cards.delete(existing.id);
    return false;
  }
  await saveSentence(material, sentence);
  return true;
}

export async function toggleWord(word: WordToSave, material: Material): Promise<boolean> {
  const existing = await findCard("word", word.lemma);
  if (existing) {
    await db.cards.delete(existing.id);
    return false;
  }
  await saveWord(word, material);
  return true;
}

export async function updateCard(cardId: string, changes: { translation?: string; wordbookIds?: string[]; status?: CardStatus }): Promise<void> {
  await db.cards.update(cardId, {
    ...(changes.translation !== undefined ? { translation: changes.translation.trim() } : {}),
    ...(changes.wordbookIds ? { wordbookIds: [...new Set(changes.wordbookIds)] } : {}),
    ...(changes.status ? { status: changes.status } : {}),
    updatedAt: nowIso()
  });
}

export async function createWordbook(title: string): Promise<Wordbook> {
  const wordbook: Wordbook = { id: makeId("wordbook"), title: title.trim() || "新词本", description: "", createdAt: nowIso(), updatedAt: nowIso() };
  await db.wordbooks.add(wordbook);
  return wordbook;
}

// Removing a wordbook keeps its cards; they just leave that wordbook.
export async function deleteWordbook(wordbookId: string): Promise<void> {
  await db.transaction("rw", db.wordbooks, db.cards, async () => {
    await db.wordbooks.delete(wordbookId);
    const cards = await db.cards.filter((card) => card.wordbookIds.includes(wordbookId)).toArray();
    for (const card of cards) await db.cards.update(card.id, { wordbookIds: card.wordbookIds.filter((id) => id !== wordbookId), updatedAt: nowIso() });
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
