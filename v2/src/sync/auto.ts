// Syncing runs by itself: when the phone connects to its Mac, every few minutes
// while OoFR is open, and when the learner comes back to the app.

import { useSyncExternalStore } from "react";
import { toast } from "../app/toast";
import type { Message } from "./frames";
import { type SyncOutcome, syncWith } from "./client";

interface Exchanger {
  exchange(message: Message, timeout?: number): Promise<Message>;
}

const EVERY = 3 * 60 * 1000;
let current: Exchanger | null = null;
let running = false;
let timer: ReturnType<typeof setInterval> | undefined;
let state: { syncing: boolean; last: SyncOutcome | null; error: string } = { syncing: false, last: null, error: "" };
const listeners = new Set<() => void>();

function update(patch: Partial<typeof state>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function useSync(): typeof state {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state
  );
}

export async function syncNow(): Promise<SyncOutcome | null> {
  if (!current || running) return null;
  running = true;
  update({ syncing: true, error: "" });
  try {
    const outcome = await syncWith((message) => current!.exchange(message));
    if (outcome.received) toast(`已和电脑同步：收到 ${outcome.received} 项更新`);
    update({ syncing: false, last: outcome });
    return outcome;
  } catch (error) {
    update({ syncing: false, error: error instanceof Error ? error.message : "同步没有完成" });
    return null;
  } finally {
    running = false;
  }
}

// Reconnecting often (every status check) must not mean syncing every time.
const MIN_GAP = 30 * 1000;

export function startAutoSync(exchanger: Exchanger): void {
  current = exchanger;
  const lastAt = state.last ? Date.parse(state.last.at) : 0;
  if (Date.now() - lastAt > MIN_GAP) void syncNow();
  clearInterval(timer);
  timer = setInterval(() => {
    if (document.visibilityState === "visible") void syncNow();
  }, EVERY);
}

export function stopAutoSync(): void {
  current = null;
  clearInterval(timer);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    const lastAt = state.last ? Date.parse(state.last.at) : 0;
    if (document.visibilityState === "visible" && Date.now() - lastAt > MIN_GAP) void syncNow();
  });
}
