import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { href } from "../app/router";
import type { Tape } from "../db/types";
import { inkFor } from "./color";

// The row of tapes on 磁带. Tapping a tape opens it; holding a tape (or
// dragging it with the mouse) picks it up, and it can be moved to another
// place on the shelf. The order stays on this device.

interface Press {
  id: string;
  pointerId: number;
  element: HTMLElement;
  x: number;
  y: number;
  mouse: boolean;
  dragging: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

const HOLD_MS = 350;
const EDGE = 48;

export function TapeShelf({
  tapes,
  counts,
  selectedId,
  onReorder
}: {
  tapes: Tape[];
  counts: Map<string, number>;
  selectedId?: string;
  onReorder: (ids: string[]) => void;
}) {
  const shelf = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const justDragged = useRef(false);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const order = draft ?? tapes.map((tape) => tape.id);
  const byId = new Map(tapes.map((tape) => [tape.id, tape]));

  // While a tape is held, the finger moves it instead of scrolling the shelf.
  useEffect(() => {
    const element = shelf.current;
    if (!element) return;
    const hold = (event: TouchEvent) => {
      if (press.current?.dragging) event.preventDefault();
    };
    element.addEventListener("touchmove", hold, { passive: false });
    return () => element.removeEventListener("touchmove", hold);
  }, []);

  const pickUp = () => {
    const current = press.current;
    if (!current || current.dragging) return;
    current.dragging = true;
    current.timer = null;
    try {
      current.element.setPointerCapture(current.pointerId);
    } catch {
      // The pointer is already gone.
    }
    navigator.vibrate?.(10);
    setDragId(current.id);
    setDraft(tapes.map((tape) => tape.id));
  };

  const letGo = (commit: boolean) => {
    const current = press.current;
    press.current = null;
    if (current?.timer) clearTimeout(current.timer);
    if (!current?.dragging) return;
    justDragged.current = true;
    setTimeout(() => (justDragged.current = false), 0);
    if (commit && draft) onReorder(draft);
    setDragId(null);
    setDraft(null);
  };

  const down = (event: ReactPointerEvent<HTMLAnchorElement>, id: string) => {
    if (event.button !== 0 || tapes.length < 2) return;
    const mouse = event.pointerType === "mouse";
    press.current = {
      id,
      pointerId: event.pointerId,
      element: event.currentTarget,
      x: event.clientX,
      y: event.clientY,
      mouse,
      dragging: false,
      timer: mouse ? null : setTimeout(pickUp, HOLD_MS)
    };
  };

  const move = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    const current = press.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.dragging) {
      if (current.mouse && Math.abs(dx) > 6) pickUp();
      // A finger that moves before the hold is up is scrolling.
      else if (!current.mouse && Math.hypot(dx, dy) > 8) letGo(false);
      return;
    }
    event.preventDefault();
    const row = shelf.current;
    if (!row) return;
    // Near an edge, the shelf scrolls along.
    const bounds = row.getBoundingClientRect();
    if (event.clientX < bounds.left + EDGE) row.scrollLeft -= 12;
    else if (event.clientX > bounds.right - EDGE) row.scrollLeft += 12;
    // The held tape takes the place of the tape under the finger.
    const slots = [...row.querySelectorAll<HTMLElement>("[data-tape]")];
    const target = slots.findIndex((slot) => {
      const box = slot.getBoundingClientRect();
      return event.clientX >= box.left && event.clientX <= box.right;
    });
    setDraft((ids) => {
      if (!ids || target < 0) return ids;
      const from = ids.indexOf(current.id);
      if (from === target) return ids;
      const next = ids.filter((id) => id !== current.id);
      next.splice(target, 0, current.id);
      return next;
    });
  };

  return (
    <div ref={shelf} className={`shelf${dragId ? " is-sorting" : ""}`} role="group" aria-label="选择磁带（按住磁带可以拖动排序）">
      {order.map((id) => {
        const tape = byId.get(id);
        if (!tape) return null;
        return (
          <a
            key={tape.id}
            data-tape={tape.id}
            className={`shelf-tape${dragId === tape.id ? " is-dragging" : ""}`}
            href={href({ name: "tapes", tapeId: tape.id })}
            aria-current={tape.id === selectedId ? "true" : undefined}
            style={{ "--tape-color": tape.color, "--tape-ink": inkFor(tape.color) } as CSSProperties}
            draggable={false}
            onPointerDown={(event) => down(event, tape.id)}
            onPointerMove={move}
            onPointerUp={() => letGo(true)}
            onPointerCancel={() => letGo(false)}
            onContextMenu={(event) => event.preventDefault()}
            onClickCapture={(event) => {
              // The click that ends a drag does not open the tape.
              if (justDragged.current) {
                event.preventDefault();
                justDragged.current = false;
              }
            }}
          >
            <span className="shelf-label">
              <b>{tape.title}</b>
              <span className="shelf-window" aria-hidden="true"><span className="reel reel-small" /><span className="reel reel-small" /></span>
            </span>
            <span className="muted small">{counts.get(tape.id) ?? 0} 条素材</span>
          </a>
        );
      })}
    </div>
  );
}
