import Dexie, { type EntityTable } from "dexie";
import type { Card, DictionaryEntry, KvRow, Material, Recording, Tape, Wordbook } from "./types";

// 3.0 (the online AI version) keeps its data in its own database: it shares
// the site with 2.0, which stays installed alongside. On first start it copies
// 2.0's data (src/db/fromV2.ts); 2.0's "oofr2" and 1.0's storage ("oofr.app.v1",
// "oofr-state", "oofr-audio") are only ever read, never written.
export const DB_NAME = "oofr3";
export const V2_DB_NAME = "oofr2";

export class OoFRDatabase extends Dexie {
  tapes!: EntityTable<Tape, "id">;
  materials!: EntityTable<Material, "id">;
  cards!: EntityTable<Card, "id">;
  wordbooks!: EntityTable<Wordbook, "id">;
  recordings!: EntityTable<Recording, "key">;
  dictionary!: EntityTable<DictionaryEntry, "key">;
  kv!: EntityTable<KvRow, "key">;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      tapes: "id, order",
      materials: "id, tapeId, lastStudiedAt, createdAt",
      cards: "id, normalized, status, sourceMaterialId, createdAt",
      wordbooks: "id",
      recordings: "key",
      dictionary: "key",
      kv: "key"
    });
  }
}

export let db = new OoFRDatabase();

// Tests swap in a fresh database for each case.
export function setDatabase(next: OoFRDatabase): void {
  db = next;
}
