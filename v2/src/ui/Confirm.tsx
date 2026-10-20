import { useSyncExternalStore } from "react";
import { Modal } from "./Modal";

// OoFR's own "are you sure?" dialog. The Mac app's web view does not show the
// browser's window.confirm (it answers "no" without asking), so deleting a
// lesson or a tape there did nothing; this works the same everywhere.

interface Question {
  message: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

let current: Question | null = null;
const listeners = new Set<() => void>();

function set(next: Question | null): void {
  current = next;
  listeners.forEach((listener) => listener());
}

export function confirmAction(message: string, { confirmLabel = "确定", danger = false } = {}): Promise<boolean> {
  current?.resolve(false);
  return new Promise((resolve) => set({ message, confirmLabel, danger, resolve }));
}

function answer(ok: boolean): void {
  const question = current;
  set(null);
  question?.resolve(ok);
}

// Rendered once by the app.
export function ConfirmHost() {
  const question = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null
  );
  if (!question) return null;
  return (
    <Modal title="请确认" onClose={() => answer(false)} compact>
      <div className="stack-16">
        <p className="confirm-message">{question.message}</p>
        <div className="row-8 confirm-actions">
          <button type="button" className="button button-outline grow" onClick={() => answer(false)}>取消</button>
          <button type="button" className={`button grow ${question.danger ? "button-danger" : "button-primary"}`} onClick={() => answer(true)}>{question.confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}
