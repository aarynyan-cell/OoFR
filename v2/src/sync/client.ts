// The phone's side of syncing with its paired Mac: runs each time the phone
// connects, then every few minutes while the app is open.

import { db } from "../db/database";
import { nowIso } from "../db/defaults";
import type { Message } from "./frames";
import { type RecordSet, type Tombstone, applyTombstones, countRecords, manifest, mergeRecords, recordsFor, rehomeLessons } from "./sync";

export const LAST_SYNC_KEY = "sync.last";

export interface SyncOutcome {
  received: number;
  sent: number;
  at: string;
}

export async function syncWith(exchange: (message: Message) => Promise<Message>): Promise<SyncOutcome> {
  const local = await manifest();
  const reply = await exchange({ t: "sync-hello", v: 1, items: local.items, deleted: local.deleted });
  if (reply.t !== "sync-reply") throw new Error(typeof reply.message === "string" ? reply.message : "电脑没有同步回应");
  await applyTombstones(Array.isArray(reply.deleted) ? (reply.deleted as Tombstone[]) : []);
  const received = await mergeRecords((reply.records ?? {}) as Partial<RecordSet>);
  await rehomeLessons();
  const outgoing = await recordsFor(Array.isArray(reply.want) ? (reply.want as [never, string][]) : []);
  const done = await exchange({ t: "sync-push", records: outgoing });
  if (done.t !== "sync-done") throw new Error("电脑没有收下同步内容");
  const outcome = { received, sent: countRecords(outgoing), at: nowIso() };
  await db.kv.put({ key: LAST_SYNC_KEY, value: outcome });
  return outcome;
}

export async function lastSync(): Promise<SyncOutcome | null> {
  return ((await db.kv.get(LAST_SYNC_KEY))?.value as SyncOutcome | undefined) ?? null;
}
