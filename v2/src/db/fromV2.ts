// 3.0's first start: the learner's 2.0 data on this device (same site, same
// layout) is copied in, so their tapes, lessons, phrasebook, recordings and
// progress are all there. 2.0's database is only read, never written: 2.0
// stays as it was, installed alongside.

import Dexie from "dexie";
import { OoFRDatabase, V2_DB_NAME, db } from "./database";

const COPIED_KEY = "copiedFromV2";
// Not copied: this device's pairing (it belongs to 2.0's Mac app; 3.0 pairs
// with its own), the undo copy of an old import, and when 2.0 last synced.
const SKIP_KV = new Set(["pairing", "snapshot.beforeImport", "sync.last", COPIED_KEY]);

// How many tapes, lessons and phrasebook entries were copied (0 when there was
// nothing to copy, or 3.0 already had data).
export async function copyFromV2(): Promise<number> {
  if (await db.kv.get(COPIED_KEY)) return 0;
  let copied = 0;
  const empty = (await db.tapes.count()) + (await db.materials.count()) + (await db.cards.count()) === 0;
  if (empty && (await Dexie.exists(V2_DB_NAME).catch(() => false))) {
    const old = new OoFRDatabase(V2_DB_NAME);
    try {
      await old.open();
      const [tapes, materials, cards, wordbooks, recordings, dictionary, kv] = await Promise.all([
        old.tapes.toArray(),
        old.materials.toArray(),
        old.cards.toArray(),
        old.wordbooks.toArray(),
        old.recordings.toArray(),
        old.dictionary.toArray(),
        old.kv.toArray()
      ]);
      await db.transaction("rw", [db.tapes, db.materials, db.cards, db.wordbooks, db.recordings, db.dictionary, db.kv], async () => {
        await db.tapes.bulkPut(tapes);
        await db.materials.bulkPut(materials);
        await db.cards.bulkPut(cards);
        await db.wordbooks.bulkPut(wordbooks);
        await db.recordings.bulkPut(recordings);
        await db.dictionary.bulkPut(dictionary);
        await db.kv.bulkPut(kv.filter((row) => !SKIP_KV.has(row.key)));
      });
      copied = tapes.length + materials.length + cards.length;
    } catch {
      // 2.0's data has a newer layout or cannot be read: 3.0 starts fresh.
      copied = 0;
    } finally {
      old.close();
    }
  }
  await db.kv.put({ key: COPIED_KEY, value: new Date().toISOString() });
  return copied;
}
