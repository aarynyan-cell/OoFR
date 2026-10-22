import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// A bottom sheet on phones, a centred card on wide screens. Escape and the
// backdrop close it; focus moves into it when it opens. Drawn at the end of
// the page, so a sheet opened from another sheet (释义有误？ from a word card)
// shows on top of it, not inside it.
let opened = 0;

export function Modal({ title, onClose, children, compact = false }: { title: string; onClose: () => void; children: ReactNode; compact?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  // The sheet opened last is on top.
  const [layer] = useState(() => (opened += 1));
  const close = useRef(onClose);
  close.current = onClose;
  // Runs once per opening, so re-renders never move the focus.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    node?.querySelector<HTMLElement>("input, textarea, button")?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close.current();
    node?.addEventListener("keydown", onKey);
    return () => {
      node?.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);
  return createPortal(
    <div className="modal-backdrop" style={{ zIndex: 50 + (layer % 1000) }} onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal${compact ? " modal-compact" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={panel}>
        <span className="sheet-handle" aria-hidden="true" />
        {children}
      </div>
    </div>,
    document.body
  );
}
