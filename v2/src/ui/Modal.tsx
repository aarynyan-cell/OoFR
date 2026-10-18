import { type ReactNode, useEffect, useRef } from "react";

// A bottom sheet on phones, a centred card on wide screens. Escape and the
// backdrop close it; focus moves into it when it opens.
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    node?.querySelector<HTMLElement>("input, textarea, button")?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    node?.addEventListener("keydown", onKey);
    return () => {
      node?.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={panel}>
        <span className="sheet-handle" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
