// Brings 1.0 data into 2.0. Only adds what 2.0 does not have yet (matched by id,
// and words/phrases also by their text), so running it twice changes nothing
// and nothing the learner did in 2.0 is overwritten.

import { db } from "../db/database";
import { DEFAULT_SETTINGS, DEFAULT_STUDY, nowIso } from "../db/defaults";
import type { ImportCounts, MigrationRecord, Recording, Settings, StudyStats } from "../db/types";
import { type V1Bundle, convertV1State } from "./v1-convert";
import { type V1Environment, readV1Recordings, readV1State } from "./v1-sources";

export const MIGRATION_KEY = "migration.v1";

export interface V1Detection {
  status: "none" | "found" | "unreadable" | "imported";
  counts?: ImportCounts;
  bundle?: V1Bundle;
  error?: string;
  record?: MigrationRecord;
}

export function summarize(bundle: V1Bundle): ImportCounts {
  return {
    tapes: bundle.tapes.length,
    materials: bundle.materials.length,
    cards: bundle.cards.length,
    wordbooks: bundle.wordbooks.length,
    recordings: bundle.recordingKeys.length
  };
}

export async function getMigrationRecord(): Promise<MigrationRecord | undefined> {
  return (await db.kv.get(MIGRATION_KEY))?.value as MigrationRecord | undefined;
}

// Looks for 1.0 data on this device without changing anything.
export async function detectV1(env?: V1Environment): Promise<V1Detection> {
  const record = await getMigrationRecord();
  const read = await readV1State(env);
  if (read.status === "none") return { status: record ? "imported" : "none", record };
  if (read.status === "unreadable") return { status: "unreadable", error: read.error, record };
  try {
    const bundle = convertV1State(read.raw);
    return { status: record ? "imported" : "found", bundle, counts: summarize(bundle), record };
  } catch (error) {
    return { status: "unreadable", error: error instanceof Error ? error.message : String(error), record };
  }
}

export async function importV1Bundle(
  bundle: V1Bundle,
  source: MigrationRecord["source"],
  recordings: Map<string, Blob> = new Map()
): Promise<ImportCounts> {
  const previous = await getMigrationRecord();
  const added: ImportCounts = { tapes: 0, materials: 0, cards: 0, wordbooks: 0, recordings: 0 };

  await db.transaction("rw", [db.tapes, db.materials, db.cards, db.wordbooks, db.recordings, db.dictionary, db.kv], async () => {
    const tapeIds = new Set(await db.tapes.toCollection().primaryKeys());
    const existingTapeCount = tapeIds.size;
    const newTapes = bundle.tapes
      .filter((tape) => !tapeIds.has(tape.id))
      .map((tape, index) => ({ ...tape, order: existingTapeCount + index }));
    await db.tapes.bulkAdd(newTapes);
    added.tapes = newTapes.length;

    const materialIds = new Set(await db.materials.toCollection().primaryKeys());
    const newMaterials = bundle.materials.filter((material) => !materialIds.has(material.id));
    await db.materials.bulkAdd(newMaterials);
    added.materials = newMaterials.length;

    const existingCards = await db.cards.toArray();
    const cardIds = new Set(existingCards.map((card) => card.id));
    const cardTexts = new Set(existingCards.map((card) => `${card.kind}:${card.normalized}`));
    const newCards = bundle.cards.filter((card) => !cardIds.has(card.id) && !cardTexts.has(`${card.kind}:${card.normalized}`));
    await db.cards.bulkAdd(newCards);
    added.cards = newCards.length;

    const wordbookIds = new Set(await db.wordbooks.toCollection().primaryKeys());
    const newWordbooks = bundle.wordbooks.filter((wordbook) => !wordbookIds.has(wordbook.id));
    await db.wordbooks.bulkAdd(newWordbooks);
    added.wordbooks = newWordbooks.length;

    const dictionaryKeys = new Set(await db.dictionary.toCollection().primaryKeys());
    await db.dictionary.bulkAdd(bundle.dictionary.filter((entry) => !dictionaryKeys.has(entry.key)));

    const recordingKeys = new Set(await db.recordings.toCollection().primaryKeys());
    const durations = new Map(bundle.materials.flatMap((material) => material.sentences.map((sentence) => [sentence.recordingKey, sentence.recordingMs] as const)));
    const newRecordings: Recording[] = [...recordings.entries()]
      .filter(([key]) => !recordingKeys.has(key))
      .map(([key, blob]) => ({ key, blob, mimeType: blob.type, durationMs: durations.get(key) || 0, createdAt: nowIso() }));
    await db.recordings.bulkAdd(newRecordings);
    added.recordings = newRecordings.length;

    // Playback settings and study stats come over once, on the first import only,
    // so later imports never undo changes made in 2.0.
    if (!previous) {
      const settings = ((await db.kv.get("settings"))?.value as Settings | undefined) ?? DEFAULT_SETTINGS;
      await db.kv.put({ key: "settings", value: { ...settings, ...bundle.settings } });
      const study = ((await db.kv.get("study"))?.value as StudyStats | undefined) ?? DEFAULT_STUDY;
      await db.kv.put({
        key: "study",
        value: {
          ...study,
          ...bundle.study,
          streak: Math.max(study.streak, bundle.study.streak ?? 0),
          cardsReviewed: study.cardsReviewed + (bundle.study.cardsReviewed ?? 0),
          cardsKnown: study.cardsKnown + (bundle.study.cardsKnown ?? 0)
        }
      });
    }

    const record: MigrationRecord = {
      importedAt: nowIso(),
      source,
      counts: previous ? addCounts(previous.counts, added) : added
    };
    await db.kv.put({ key: MIGRATION_KEY, value: record });
  });

  return added;
}

function addCounts(left: ImportCounts, right: ImportCounts): ImportCounts {
  return {
    tapes: left.tapes + right.tapes,
    materials: left.materials + right.materials,
    cards: left.cards + right.cards,
    wordbooks: left.wordbooks + right.wordbooks,
    recordings: left.recordings + right.recordings
  };
}

// One tap on "搬过来": read this device's 1.0 data, copy recordings, import.
export async function importV1FromThisDevice(env?: V1Environment): Promise<ImportCounts> {
  const read = await readV1State(env);
  if (read.status === "none") throw new Error("这台设备上没有找到 1.0 的数据");
  if (read.status === "unreadable") throw new Error("1.0 的数据无法读取，请在 1.0 里先导出备份");
  const bundle = convertV1State(read.raw);
  const recordings = await readV1Recordings(bundle.recordingKeys, env);
  return importV1Bundle(bundle, "1.0-local", recordings);
}

// A 1.0 backup file (exported from 1.0 "导出完整备份", or the extension/Mac app).
export async function importV1File(text: string): Promise<ImportCounts> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的 JSON");
  }
  return importV1Bundle(convertV1State(raw), "1.0-file");
}
