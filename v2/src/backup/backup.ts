// 2.0 backups, plus one entry point for every file the learner may import:
// a 2.0 backup, a 1.0 backup, or a 1.0 learning package (a lesson with AI
// explanations made on the Mac). Imports never delete anything; before
// writing, the current lessons and phrasebook are set aside so the import
// can be undone.

import { db } from "../db/database";
import { nowIso } from "../db/defaults";
import type { Card, DictionaryEntry, ImportCounts, KvRow, Material, Sentence, Tape, Wordbook } from "../db/types";
import { convertV1State, looksLikeV1State } from "../migrate/v1-convert";
import { addV1Bundle, importV1Bundle } from "../migrate/v1-import";
import { MATERIAL_TYPES, type MaterialType } from "../text/split";

export const BACKUP_TYPE = "oofr2.backup";
export const SNAPSHOT_KEY = "snapshot.beforeImport";
// Kept in sync with src/ai/paired.ts (not imported, so backups stay free of the AI code).
const PAIRING_KEY = "pairing";
const LEARNING_PACKAGE_TYPE = "oofr.learning-package";

interface BackupRecording {
  key: string;
  mimeType: string;
  durationMs: number;
  createdAt: string;
  data: string;
}

export interface BackupFile {
  type: typeof BACKUP_TYPE;
  version: 1;
  appVersion: string;
  exportedAt: string;
  tapes: Tape[];
  materials: Material[];
  cards: Card[];
  wordbooks: Wordbook[];
  dictionary: DictionaryEntry[];
  kv: KvRow[];
  recordings: BackupRecording[];
}

export interface ImportOutcome {
  kind: "backup" | "v1" | "package";
  added: ImportCounts;
  updated: number;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function base64ToBlob(data: string, type: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

export async function createBackup(appVersion: string): Promise<BackupFile> {
  const recordings = await db.recordings.toArray();
  return {
    type: BACKUP_TYPE,
    version: 1,
    appVersion,
    exportedAt: nowIso(),
    tapes: await db.tapes.toArray(),
    materials: await db.materials.toArray(),
    cards: await db.cards.toArray(),
    wordbooks: await db.wordbooks.toArray(),
    dictionary: await db.dictionary.toArray(),
    // The undo copy of an earlier import and the pairing key of this phone stay on this device.
    kv: (await db.kv.toArray()).filter((row) => row.key !== SNAPSHOT_KEY && row.key !== PAIRING_KEY),
    recordings: await Promise.all(
      recordings.map(async (recording) => ({
        key: recording.key,
        mimeType: recording.mimeType,
        durationMs: recording.durationMs,
        createdAt: recording.createdAt,
        data: await blobToBase64(recording.blob)
      }))
    )
  };
}

export function backupFileName(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `oofr2-backup-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.json`;
}

// ---------- reading untrusted files ----------

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 20000) => (typeof value === "string" ? value.slice(0, max) : "");
const id = (value: unknown) => text(value, 200).trim();
const stamp = (value: unknown) => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : nowIso());
const optionalStamp = (value: unknown) => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null);
const count = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));
const strings = (value: unknown) => (Array.isArray(value) ? value.map((item) => text(item, 2000)).filter(Boolean) : []);

function sanitizeTape(raw: unknown): Tape | null {
  if (!isObject(raw) || !id(raw.id) || !text(raw.title).trim()) return null;
  return {
    id: id(raw.id),
    title: text(raw.title, 200).trim(),
    description: text(raw.description, 2000),
    color: /^#[0-9a-f]{3,8}$/i.test(text(raw.color)) ? text(raw.color) : "#E9C46A",
    order: count(raw.order),
    createdAt: stamp(raw.createdAt),
    updatedAt: stamp(raw.updatedAt)
  };
}

function sanitizeSentence(raw: unknown, index: number, materialId: string): Sentence | null {
  if (!isObject(raw) || !text(raw.text).trim()) return null;
  const explanation = isObject(raw.explanation)
    ? {
        summary: text(raw.explanation.summary),
        structure: text(raw.explanation.structure),
        grammarPoints: strings(raw.explanation.grammarPoints),
        morphology: text(raw.explanation.morphology),
        pitfalls: strings(raw.explanation.pitfalls),
        examples: strings(raw.explanation.examples),
        model: text(raw.explanation.model, 200),
        language: text(raw.explanation.language, 20),
        version: text(raw.explanation.version, 20),
        source: text(raw.explanation.source, 100),
        generatedAt: optionalStamp(raw.explanation.generatedAt)
      }
    : null;
  return {
    id: id(raw.id) || `${materialId}_s${index + 1}`,
    text: text(raw.text, 2000).trim(),
    translation: text(raw.translation, 2000),
    ...(raw.translationSource === "ai" ? { translationSource: "ai" as const } : {}),
    speakerId: text(raw.speakerId, 40) || "a",
    speakerLabel: text(raw.speakerLabel, 60),
    explanation,
    recordingKey: text(raw.recordingKey, 300),
    recordingMs: count(raw.recordingMs),
    shadow: isObject(raw.shadow)
      ? {
          score: typeof raw.shadow.score === "number" && raw.shadow.score >= 0 && raw.shadow.score <= 1 ? raw.shadow.score : null,
          missed: strings(raw.shadow.missed).slice(0, 50),
          heard: text(raw.shadow.heard, 2000),
          at: stamp(raw.shadow.at)
        }
      : undefined
  };
}

function sanitizeMaterial(raw: unknown): Material | null {
  if (!isObject(raw) || !id(raw.id) || !id(raw.tapeId)) return null;
  const materialId = id(raw.id);
  const sentences = (Array.isArray(raw.sentences) ? raw.sentences : []).map((sentence, index) => sanitizeSentence(sentence, index, materialId)).filter((sentence): sentence is Sentence => Boolean(sentence));
  if (!sentences.length) return null;
  return {
    id: materialId,
    tapeId: id(raw.tapeId),
    title: text(raw.title, 200).trim() || sentences[0].text.slice(0, 24),
    language: raw.language === "en" ? "en" : "fr",
    materialType: MATERIAL_TYPES.includes(raw.materialType as MaterialType) ? (raw.materialType as MaterialType) : "自定义文本",
    description: text(raw.description, 2000),
    notes: text(raw.notes, 5000),
    sentences,
    lexicalUnits: (Array.isArray(raw.lexicalUnits) ? raw.lexicalUnits : []).filter(isObject).map((item) => ({ text: text(item.text, 64), lemma: text(item.lemma, 64), type: text(item.type, 40), verified: text(item.verified, 20) })).filter((item) => item.text).slice(0, 200),
    position: Math.min(count(raw.position), sentences.length - 1),
    finishedAt: optionalStamp(raw.finishedAt),
    studyCount: count(raw.studyCount),
    lastStudiedAt: optionalStamp(raw.lastStudiedAt),
    createdAt: stamp(raw.createdAt),
    updatedAt: stamp(raw.updatedAt)
  };
}

function sanitizeCard(raw: unknown): Card | null {
  if (!isObject(raw) || !id(raw.id) || !text(raw.text).trim() || !text(raw.normalized).trim()) return null;
  const review = isObject(raw.review) && optionalStamp(raw.review.due)
    ? { due: stamp(raw.review.due), stability: Math.max(0, Number(raw.review.stability) || 0), difficulty: Math.min(10, Math.max(0, Number(raw.review.difficulty) || 0)), reps: count(raw.review.reps), lapses: count(raw.review.lapses), lastReview: optionalStamp(raw.review.lastReview) }
    : null;
  return {
    id: id(raw.id),
    kind: raw.kind === "word" ? "word" : "phrase",
    text: text(raw.text, 2000).trim(),
    normalized: text(raw.normalized, 2000),
    lemma: text(raw.lemma, 200),
    translation: text(raw.translation, 2000),
    ipa: text(raw.ipa, 200),
    partOfSpeech: text(raw.partOfSpeech, 100),
    language: raw.language === "en" ? "en" : "fr",
    status: raw.status === "got" || raw.status === "learning" ? raw.status : "new",
    wordbookIds: strings(raw.wordbookIds).map((item) => item.slice(0, 200)),
    sourceMaterialId: id(raw.sourceMaterialId),
    sourceTitle: text(raw.sourceTitle, 200),
    seenForms: (Array.isArray(raw.seenForms) ? raw.seenForms : []).filter(isObject).map((form) => ({ form: text(form.form, 200), normalized: text(form.normalized, 200), count: Math.max(1, count(form.count)) })).filter((form) => form.normalized),
    practiceCount: count(raw.practiceCount),
    lastPracticedAt: optionalStamp(raw.lastPracticedAt),
    review,
    createdAt: stamp(raw.createdAt),
    updatedAt: stamp(raw.updatedAt)
  };
}

function sanitizeWordbook(raw: unknown): Wordbook | null {
  if (!isObject(raw) || !id(raw.id) || !text(raw.title).trim()) return null;
  return { id: id(raw.id), title: text(raw.title, 200).trim(), description: text(raw.description, 2000), createdAt: stamp(raw.createdAt), updatedAt: stamp(raw.updatedAt) };
}

function sanitizeDictionary(raw: unknown): DictionaryEntry | null {
  if (!isObject(raw) || !id(raw.key)) return null;
  return {
    key: id(raw.key),
    lemma: text(raw.lemma, 200),
    partOfSpeech: text(raw.partOfSpeech, 100),
    senses: strings(raw.senses).slice(0, 20),
    contextMeaning: text(raw.contextMeaning, 2000),
    formNote: text(raw.formNote, 2000),
    usageNote: text(raw.usageNote, 2000),
    model: text(raw.model, 200),
    version: text(raw.version, 20),
    updatedAt: stamp(raw.updatedAt)
  };
}

const sanitizeAll = <T>(value: unknown, sanitize: (raw: unknown) => T | null): T[] =>
  (Array.isArray(value) ? value : []).map(sanitize).filter((item): item is T => item !== null);

// ---------- merging ----------

// The newer copy of a lesson wins, but nothing the other copy knows is lost:
// translations and AI explanations fill gaps, and recordings stay attached.
export function mergeMaterial(existing: Material, incoming: Material): Material {
  const newer = Date.parse(incoming.updatedAt) > Date.parse(existing.updatedAt) ? incoming : existing;
  const older = newer === incoming ? existing : incoming;
  const olderById = new Map(older.sentences.map((sentence) => [sentence.id, sentence]));
  const olderByText = new Map(older.sentences.map((sentence) => [sentence.text, sentence]));
  const sentences = newer.sentences.map((sentence) => {
    const other = olderById.get(sentence.id) ?? olderByText.get(sentence.text);
    if (!other) return sentence;
    const newerExplanation =
      sentence.explanation && other.explanation
        ? Date.parse(other.explanation.generatedAt ?? "") > Date.parse(sentence.explanation.generatedAt ?? "") ? other.explanation : sentence.explanation
        : sentence.explanation ?? other.explanation;
    const translation = sentence.translation ? sentence : other;
    return {
      ...sentence,
      translation: translation.translation,
      translationSource: translation.translationSource,
      explanation: newerExplanation,
      recordingKey: sentence.recordingKey || other.recordingKey,
      recordingMs: sentence.recordingKey ? sentence.recordingMs : other.recordingMs
    };
  });
  return {
    ...newer,
    sentences,
    position: Math.max(existing.position, incoming.position) < sentences.length ? Math.max(existing.position, incoming.position) : newer.position,
    studyCount: Math.max(existing.studyCount, incoming.studyCount),
    finishedAt: newer.finishedAt ?? older.finishedAt,
    lastStudiedAt: [existing.lastStudiedAt, incoming.lastStudiedAt].filter(Boolean).sort().at(-1) ?? null
  };
}

function newerOf<T extends { updatedAt: string }>(existing: T, incoming: T): T {
  return Date.parse(incoming.updatedAt) > Date.parse(existing.updatedAt) ? incoming : existing;
}

// ---------- undo ----------

export async function snapshotBeforeImport(): Promise<void> {
  await db.kv.put({
    key: SNAPSHOT_KEY,
    value: { at: nowIso(), tapes: await db.tapes.toArray(), materials: await db.materials.toArray(), cards: await db.cards.toArray(), wordbooks: await db.wordbooks.toArray() }
  });
}

export async function snapshotInfo(): Promise<{ at: string } | undefined> {
  const value = (await db.kv.get(SNAPSHOT_KEY))?.value as { at: string } | undefined;
  return value ? { at: value.at } : undefined;
}

// Puts lessons and phrasebook back as they were before the last import.
// Recordings are left alone (imports only ever add them).
export async function restoreSnapshot(): Promise<boolean> {
  return db.transaction("rw", [db.tapes, db.materials, db.cards, db.wordbooks, db.kv], async () => {
    const snapshot = (await db.kv.get(SNAPSHOT_KEY))?.value as { tapes: Tape[]; materials: Material[]; cards: Card[]; wordbooks: Wordbook[] } | undefined;
    if (!snapshot) return false;
    await Promise.all([db.tapes.clear(), db.materials.clear(), db.cards.clear(), db.wordbooks.clear()]);
    await db.tapes.bulkAdd(snapshot.tapes);
    await db.materials.bulkAdd(snapshot.materials);
    await db.cards.bulkAdd(snapshot.cards);
    await db.wordbooks.bulkAdd(snapshot.wordbooks);
    await db.kv.delete(SNAPSHOT_KEY);
    return true;
  });
}

// ---------- importing ----------

async function restoreBackup(raw: Raw): Promise<ImportOutcome> {
  const tapes = sanitizeAll(raw.tapes, sanitizeTape);
  const materials = sanitizeAll(raw.materials, sanitizeMaterial);
  const cards = sanitizeAll(raw.cards, sanitizeCard);
  const wordbooks = sanitizeAll(raw.wordbooks, sanitizeWordbook);
  const dictionary = sanitizeAll(raw.dictionary, sanitizeDictionary);
  const recordings = (Array.isArray(raw.recordings) ? raw.recordings : []).filter(isObject).filter((item) => id(item.key) && typeof item.data === "string");
  const added: ImportCounts = { tapes: 0, materials: 0, cards: 0, wordbooks: 0, recordings: 0 };
  let updated = 0;

  await db.transaction("rw", [db.tapes, db.materials, db.cards, db.wordbooks, db.dictionary, db.recordings], async () => {
    for (const tape of tapes) {
      const existing = await db.tapes.get(tape.id);
      if (!existing) {
        await db.tapes.add({ ...tape, order: (await db.tapes.count()) });
        added.tapes += 1;
      } else if (newerOf(existing, tape) === tape) {
        await db.tapes.put({ ...tape, order: existing.order });
        updated += 1;
      }
    }
    for (const material of materials) {
      const existing = await db.materials.get(material.id);
      if (!existing) {
        await db.materials.add(material);
        added.materials += 1;
      } else {
        await db.materials.put(mergeMaterial(existing, material));
        updated += 1;
      }
    }
    for (const card of cards) {
      const existing = (await db.cards.get(card.id)) ?? (await db.cards.where("normalized").equals(card.normalized).and((item) => item.kind === card.kind).first());
      if (!existing) {
        await db.cards.add(card);
        added.cards += 1;
      } else if (newerOf(existing, card) === card) {
        await db.cards.put({ ...card, id: existing.id });
        updated += 1;
      }
    }
    for (const wordbook of wordbooks) {
      const existing = await db.wordbooks.get(wordbook.id);
      if (!existing) {
        await db.wordbooks.add(wordbook);
        added.wordbooks += 1;
      } else if (newerOf(existing, wordbook) === wordbook) await db.wordbooks.put(wordbook);
    }
    for (const entry of dictionary) if (!(await db.dictionary.get(entry.key))) await db.dictionary.add(entry);
    for (const recording of recordings) {
      const key = id(recording.key);
      if (await db.recordings.get(key)) continue;
      try {
        const type = text(recording.mimeType, 100) || "audio/mp4";
        await db.recordings.add({ key, blob: base64ToBlob(String(recording.data), type), mimeType: type, durationMs: count(recording.durationMs), createdAt: stamp(recording.createdAt) });
        added.recordings += 1;
      } catch {
        // A damaged recording is skipped; everything else still comes in.
      }
    }
  });
  return { kind: "backup", added, updated };
}

// A 1.0 learning package is one lesson; it goes in like a tiny 1.0 backup, and
// for a lesson already here it only fills in translations and explanations.
async function importLearningPackage(raw: Raw): Promise<ImportOutcome> {
  const course = isObject(raw.course) ? raw.course : null;
  if (!course || !id(course.id) || !Array.isArray(course.turns) || !course.turns.length) throw new Error("学习包里没有可用的课程");
  const material = isObject(raw.material) ? raw.material : {};
  const albumId = id(isObject(material.album) ? material.album.id : "") || `package_${id(course.id)}`;
  const album = { title: "学习包", ...(isObject(material.album) ? material.album : {}), id: albumId, courseLessonId: id(course.id) };
  const tapeId = id(isObject(material.tape) ? material.tape.id : "") || `package_tape_${id(course.id)}`;
  const tape = { title: "学习包", ...(isObject(material.tape) ? material.tape : {}), id: tapeId, albumId };
  const entry = isObject(material.entry) ? { ...material.entry, tapeId, courseLessonId: id(course.id), title: text(material.entry.title) || text(course.title), text: text(material.entry.text) } : null;
  const bundle = convertV1State({
    albums: [album],
    tapes: [tape],
    entries: entry ? [entry] : [],
    courseLessons: [course],
    phraseItems: raw.phraseItems,
    dictionaryEntries: raw.dictionaryEntries
  });
  let updated = 0;
  const incoming = bundle.materials[0];
  const existing = incoming ? await db.materials.get(incoming.id) : undefined;
  if (existing && incoming) {
    await db.materials.put(mergeMaterial(existing, { ...incoming, tapeId: existing.tapeId, updatedAt: existing.updatedAt }));
    updated = 1;
  }
  const added = await addV1Bundle({ ...bundle, materials: existing ? [] : bundle.materials, tapes: existing ? [] : bundle.tapes });
  return { kind: "package", added, updated };
}

export async function importAnyFile(content: string): Promise<ImportOutcome> {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error("文件不是有效的备份（JSON 格式不对）");
  }
  if (!isObject(raw)) throw new Error("认不出这个文件");
  if (raw.type !== BACKUP_TYPE && raw.type !== LEARNING_PACKAGE_TYPE && !looksLikeV1State(raw)) {
    throw new Error("认不出这个文件：请选 OoFR 的备份或学习包");
  }
  await snapshotBeforeImport();
  if (raw.type === BACKUP_TYPE) return restoreBackup(raw);
  if (raw.type === LEARNING_PACKAGE_TYPE) return importLearningPackage(raw);
  const added = await importV1Bundle(convertV1State(raw), "1.0-file");
  return { kind: "v1", added, updated: 0 };
}
