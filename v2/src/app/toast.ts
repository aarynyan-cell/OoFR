import { useSyncExternalStore } from "react";

// One short message at a time ("已收藏到词句本"), announced to screen readers.
let message = "";
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

export function toast(text: string, ms = 2600): void {
  message = text;
  clearTimeout(timer);
  timer = setTimeout(() => {
    message = "";
    listeners.forEach((listener) => listener());
  }, ms);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useToast(): string {
  return useSyncExternalStore(subscribe, () => message, () => "");
}
