// Keeping a phone and the Mac it is paired with in step: tapes, lessons (with
// translations and explanations), the phrasebook and wordbooks. Each side lists
// what it has with a fingerprint of each item; only items that differ travel.
// Merging is the same as importing a backup (translations and explanations from
// both sides are kept, the newer edit wins otherwise) and gives the same result
// whichever side does it, so both end up identical. Deletions travel as
// tombstones. Recordings and per-device settings (voice, theme, speed) stay put.

import { mergeMaterial, sanitizeCard, sanitizeMaterial, sanitizeTape, sanitizeWordbook } from "../backup/backup";
import { db } from "../db/database";
import { DELETED_KEY, type SyncKind, type Tombstone, forgetDeleted, rememberDeleted, tombstones } from "../db/repo";
import type { Card, Material, Tape, Wordbook } from "../db/types";

export type { SyncKind, Tombstone };
export type ItemKey = [SyncKind, string];

export interface Manifest {
  // [kind, id, fingerprint, updatedAt]
  items: [SyncKind, string, string, string][];
  deleted: Tombstone[];
}

export interface RecordSet {
  tapes: Tape[];
  materials: Material[];
  cards: Card[];
  wordbooks: Wordbook[];
}

type Synced = Tape | Material | Card | Wordbook;

// JSON with keys in a fixed order, so equal content gives equal text on any device.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

// FNV-1a: a fingerprint, not a security measure.
export function fingerprint(value: unknown): string {
  const text = canonical(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16)}.${text.length}`;
}

// A tape's place in the list is this device's own arrangement.
// A tape's place in the list and a lesson's reading position belong to each device.
const comparable = (kind: SyncKind, record: Synced): unknown =>
  kind === "tape" ? { ...(record as Tape), order: 0 } : kind === "material" ? { ...(record as Material), position: 0 } : record;

const SANITIZE: Record<SyncKind, (raw: unknown) => Synced | null> = {
  tape: sanitizeTape,
  material: sanitizeMaterial,
  card: sanitizeCard,
  wordbook: sanitizeWordbook
};

const TABLES = { tape: () => db.tapes, material: () => db.materials, card: () => db.cards, wordbook: () => db.wordbooks } as const;
const SET_KEY: Record<SyncKind, keyof RecordSet> = { tape: "tapes", material: "materials", card: "cards", wordbook: "wordbooks" };

// Both sides keep records in the form an import would produce, so their fingerprints agree.
function normalized(kind: SyncKind, record: unknown): Synced | null {
  return SANITIZE[kind](record);
}

async function allRecords(): Promise<[SyncKind, Synced][]> {
  const [tapes, materials, cards, wordbooks] = await Promise.all([db.tapes.toArray(), db.materials.toArray(), db.cards.toArray(), db.wordbooks.toArray()]);
  return [
    ...tapes.map((record) => ["tape", record] as [SyncKind, Synced]),
    ...materials.map((record) => ["material", record] as [SyncKind, Synced]),
    ...cards.map((record) => ["card", record] as [SyncKind, Synced]),
    ...wordbooks.map((record) => ["wordbook", record] as [SyncKind, Synced])
  ];
}

export async function manifest(): Promise<Manifest> {
  const items: Manifest["items"] = [];
  for (const [kind, record] of await allRecords()) {
    const clean = normalized(kind, record);
    if (clean) items.push([kind, clean.id, fingerprint(comparable(kind, clean)), clean.updatedAt]);
  }
  return { items, deleted: await tombstones() };
}

// What this side sends and asks for, after the other side's deletions were applied here:
// whatever is still here survived them (it was edited after) and is sent; an item
// only the other side has is wanted unless it was deleted here after its last edit.
export function plan(local: Manifest, remote: Manifest): { send: ItemKey[]; want: ItemKey[] } {
  const key = (kind: string, id: string) => `${kind}:${id}`;
  const deletedAt = new Map(local.deleted.map((item) => [key(item.k, item.id), Date.parse(item.at)]));
  const theirs = new Map(remote.items.map(([kind, id, hash]) => [key(kind, id), hash]));
  const mine = new Map(local.items.map(([kind, id, hash]) => [key(kind, id), hash]));
  const send: ItemKey[] = [];
  const want: ItemKey[] = [];
  for (const [kind, id, hash] of local.items) {
    const other = theirs.get(key(kind, id));
    if (other === undefined) send.push([kind, id]);
    else if (other !== hash) {
      send.push([kind, id]);
      want.push([kind, id]);
    }
  }
  for (const [kind, id, , updatedAt] of remote.items) {
    if (mine.has(key(kind, id))) continue;
    const deleted = deletedAt.get(key(kind, id));
    if (deleted === undefined || Date.parse(updatedAt) > deleted) want.push([kind, id]);
  }
  return { send, want };
}

export async function recordsFor(keys: ItemKey[]): Promise<RecordSet> {
  const set: RecordSet = { tapes: [], materials: [], cards: [], wordbooks: [] };
  for (const [kind, id] of keys) {
    const record = (await TABLES[kind]().get(id)) as Synced | undefined;
    const clean = record && normalized(kind, record);
    if (clean) (set[SET_KEY[kind]] as Synced[]).push(clean);
  }
  return set;
}

// The other side's deletions: removed here unless edited here after they were deleted there.
export async function applyTombstones(incoming: Tombstone[]): Promise<number> {
  let removed = 0;
  await db.transaction("rw", [db.tapes, db.materials, db.cards, db.wordbooks, db.kv], async () => {
    const known = new Set((await tombstones()).map((item) => `${item.k}:${item.id}:${item.at}`));
    const fresh = incoming.filter((item) => item && TABLES[item.k] && typeof item.id === "string" && !Number.isNaN(Date.parse(item.at)) && !known.has(`${item.k}:${item.id}:${item.at}`));
    for (const item of fresh) {
      const record = (await TABLES[item.k]().get(item.id)) as Synced | undefined;
      // Edited here after it was deleted there: it stays, and goes back to the other side.
      if (record && Date.parse(record.updatedAt) > Date.parse(item.at)) continue;
      if (record) {
        await TABLES[item.k]().delete(item.id);
        removed += 1;
      }
      // Remembered here too, so a third look at the same item does not bring it back.
      await rememberDeleted([{ k: item.k, id: item.id }], item.at);
    }
  });
  return removed;
}

// The same pair always gives the same result, whichever side merges.
function ordered<T extends Synced>(a: T, b: T): [T, T] {
  const byTime = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
  if (byTime !== 0) return byTime < 0 ? [a, b] : [b, a];
  return canonical(a) <= canonical(b) ? [a, b] : [b, a];
}

function merged<T extends Synced>(kind: SyncKind, local: T, incoming: T): T {
  const [older, newer] = ordered(local, incoming);
  if (kind === "material") return mergeMaterial(older as Material, newer as Material) as T;
  return newer;
}

// Stores what the other side sent; returns how many items changed here.
export async function mergeRecords(set: Partial<RecordSet>): Promise<number> {
  let changed = 0;
  await db.transaction("rw", [db.tapes, db.materials, db.cards, db.wordbooks, db.kv], async () => {
    const deleted = await tombstones();
    const gone = new Map(deleted.map((item) => [`${item.k}:${item.id}`, Date.parse(item.at)]));
    for (const kind of ["tape", "material", "card", "wordbook"] as SyncKind[]) {
      const table = TABLES[kind]();
      for (const raw of (set[SET_KEY[kind]] ?? []) as unknown[]) {
        const incoming = normalized(kind, raw);
        if (!incoming) continue;
        // Deleted here after its last edit: stays deleted. Edited there after: it comes back.
        const deletedAt = gone.get(`${kind}:${incoming.id}`);
        if (deletedAt !== undefined) {
          if (Date.parse(incoming.updatedAt) <= deletedAt) continue;
          await forgetDeleted(kind, incoming.id);
        }
        // The same word saved on both devices under two ids becomes one, under the smaller id.
        const twin =
          kind === "card" ? await db.cards.where("normalized").equals((incoming as Card).normalized).and((card) => card.kind === (incoming as Card).kind && card.id !== incoming.id).first() : undefined;
        const existing = ((await table.get(incoming.id)) as Synced | undefined) ?? twin;
        const local = existing && normalized(kind, existing);
        let next = local ? merged(kind, local, incoming) : incoming;
        if (kind === "card" && local && local.id !== incoming.id) {
          const keepId = local.id < incoming.id ? local.id : incoming.id;
          const dropId = keepId === local.id ? incoming.id : local.id;
          next = { ...next, id: keepId };
          if (await db.cards.get(dropId)) await db.cards.delete(dropId);
          await rememberDeleted([{ k: "card", id: dropId }]);
        }
        if (kind === "tape") next = { ...(next as Tape), order: (existing as Tape | undefined)?.order ?? (await db.tapes.count()) };
        if (kind === "material") {
          const sentences = (next as Material).sentences.length;
          next = { ...(next as Material), position: Math.min((local as Material | undefined)?.position ?? 0, Math.max(0, sentences - 1)) };
        }
        if (local && fingerprint(comparable(kind, local)) === fingerprint(comparable(kind, next)) && local.id === next.id) continue;
        await (table as unknown as { put(value: Synced): Promise<unknown> }).put(next);
        changed += 1;
      }
    }
    changed += await joinDuplicates();
  });
  return changed;
}

const sameTitle = (title: string) => title.trim().toLocaleLowerCase("fr-FR").replace(/\s+/g, " ");
const sameText = (material: Material) =>
  `${material.language}|${material.sentences.map((sentence) => sentence.text.trim().toLocaleLowerCase("fr-FR").replace(/\s+/g, " ")).join("\n")}`;

// The one both devices keep: the smaller id. Ids never change (dates can, when
// copies merge), so both devices always choose the same one.
function keeper<T extends { id: string }>(items: T[]): T {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}

const earliest = (items: { createdAt: string }[]) => items.map((item) => item.createdAt).sort()[0];

function groups<T>(items: T[], key: (item: T) => string): T[][] {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
  return [...map.values()].filter((group) => group.length > 1);
}

// Tapes with the same name, lessons with the same text and wordbooks with the
// same name, made separately on two devices, become one. Both devices pick the
// same keeper, and the others travel as deletions. Call inside a transaction.
export async function joinDuplicates(): Promise<number> {
  let joined = 0;
  for (const group of groups(await db.tapes.toArray(), (tape) => sameTitle(tape.title))) {
    const keep = keeper(group);
    for (const tape of group.filter((item) => item.id !== keep.id)) {
      await db.materials.where("tapeId").equals(tape.id).modify({ tapeId: keep.id });
      await db.tapes.delete(tape.id);
      await rememberDeleted([{ k: "tape", id: tape.id }]);
      joined += 1;
    }
  }
  for (const group of groups(await db.materials.toArray(), sameText)) {
    const keep = keeper(group);
    let result = normalized("material", keep) as Material;
    for (const other of group.filter((item) => item.id !== keep.id)) {
      const clean = normalized("material", other) as Material | null;
      if (clean) result = merged("material", result, clean);
      await db.materials.delete(other.id);
      await rememberDeleted([{ k: "material", id: other.id }]);
      joined += 1;
    }
    // Where this device was reading, whichever copy it was reading in.
    const position = Math.min(Math.max(...group.map((item) => item.position)), Math.max(0, result.sentences.length - 1));
    await db.materials.put({ ...result, id: keep.id, position, createdAt: earliest(group) });
  }
  for (const group of groups(await db.wordbooks.toArray(), (wordbook) => sameTitle(wordbook.title))) {
    const keep = keeper(group);
    const others = new Set(group.filter((item) => item.id !== keep.id).map((item) => item.id));
    await db.cards
      .filter((card) => card.wordbookIds.some((id) => others.has(id)))
      .modify((card) => {
        card.wordbookIds = [...new Set(card.wordbookIds.map((id) => (others.has(id) ? keep.id : id)))];
      });
    for (const id of others) {
      await db.wordbooks.delete(id);
      await rememberDeleted([{ k: "wordbook", id }]);
      joined += 1;
    }
  }
  return joined;
}

export const SYNC_DELETED_KEY = DELETED_KEY;

// A lesson whose tape is gone on this device goes to the first tape (or a new one).
export async function rehomeLessons(): Promise<void> {
  await db.transaction("rw", db.tapes, db.materials, async () => {
    const tapes = await db.tapes.orderBy("order").toArray();
    const ids = new Set(tapes.map((tape) => tape.id));
    const lost = (await db.materials.toArray()).filter((material) => !ids.has(material.tapeId));
    if (!lost.length) return;
    let target = tapes[0];
    if (!target) {
      const now = new Date().toISOString();
      target = { id: `tape_other_${Date.now().toString(36)}`, title: "其他素材", description: "", color: "#D8D3C4", order: 0, createdAt: now, updatedAt: now };
      await db.tapes.add(target);
    }
    for (const material of lost) await db.materials.update(material.id, { tapeId: target.id });
  });
}

export function countRecords(set: Partial<RecordSet>): number {
  return (set.tapes?.length ?? 0) + (set.materials?.length ?? 0) + (set.cards?.length ?? 0) + (set.wordbooks?.length ?? 0);
}
