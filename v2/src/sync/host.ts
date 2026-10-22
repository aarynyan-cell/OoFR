// The Mac's side of syncing: a paired phone's sync messages arrive from the Mac
// app's connection (desktop/src-tauri/src/pair.rs) as "pair-message" events, and
// the answers go back with the pair_send command.

import { tauri } from "../ai/backend";
import { loadKeys } from "../ai/online";
import { type Message, Reassembler, toFrames } from "./frames";
import { type Manifest, type RecordSet, applyTombstones, manifest, mergeRecords, plan, recordsFor, rehomeLessons } from "./sync";

export async function answerSync(message: Message): Promise<Message | null> {
  if (message.t === "sync-hello") {
    const remote: Manifest = { items: Array.isArray(message.items) ? (message.items as Manifest["items"]) : [], deleted: Array.isArray(message.deleted) ? (message.deleted as Manifest["deleted"]) : [] };
    await applyTombstones(remote.deleted);
    const local = await manifest();
    const { send, want } = plan(local, remote);
    return { t: "sync-reply", id: message.id, records: await recordsFor(send), want, deleted: local.deleted };
  }
  // A paired phone takes the online AI keys from here (they travel only over the paired connection).
  if (message.t === "keys-get") return { t: "keys", id: message.id, keys: await loadKeys() };
  if (message.t === "sync-push") {
    const changed = await mergeRecords((message.records ?? {}) as Partial<RecordSet>);
    await rehomeLessons();
    return { t: "sync-done", id: message.id, changed };
  }
  return null;
}

let started = false;

export function startSyncHost(): void {
  const app = tauri();
  if (!app || started) return;
  started = true;
  const assemblers = new Map<string, Reassembler>();
  void app.event.listen<{ peer: string; text: string }>("pair-message", ({ payload }) => {
    const assembler = assemblers.get(payload.peer) ?? new Reassembler();
    assemblers.set(payload.peer, assembler);
    const message = assembler.push(payload.text);
    if (!message) return;
    void answerSync(message)
      .catch((error) => ({ t: "sync-error", id: message.id, message: error instanceof Error ? error.message : "同步失败" }))
      .then(async (answer) => {
        if (!answer) return;
        for (const frame of toFrames(answer)) await app.core.invoke("pair_send", { peer: payload.peer, text: frame });
      });
  });
}
