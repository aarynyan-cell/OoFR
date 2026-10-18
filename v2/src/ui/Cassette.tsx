// The cassette elements from the design spec: a cover for the lesson being
// studied, a small cassette for lists, and the reels next to the player counter.
import type { CSSProperties } from "react";

// Reel sizes follow progress: the right reel fills up as the tape plays.
function reelSizes(progress: number, small: number, large: number): [number, number] {
  const ratio = Math.min(1, Math.max(0, progress));
  return [Math.round(large - (large - small) * ratio), Math.round(small + (large - small) * ratio)];
}

function Reel({ size, ring }: { size: number; ring: number }) {
  return <span className="reel" style={{ width: size, height: size, borderWidth: ring }} />;
}

export function CassetteCover({ color, title, side, counter, progress }: { color: string; title: string; side: string; counter: string; progress: number }) {
  const [left, right] = reelSizes(progress, 26, 34);
  return (
    <div className="cassette-cover" style={{ "--tape-color": color } as CSSProperties}>
      <div className="cassette-label">
        <span className="cassette-side">{side}</span>
        <b className="cassette-title">{title}</b>
        <span className="cassette-counter">{counter}</span>
      </div>
      <div className="cassette-window" aria-hidden="true">
        <Reel size={left} ring={Math.round(left / 4)} />
        <span className="cassette-tape" />
        <Reel size={right} ring={Math.round(right / 4)} />
      </div>
    </div>
  );
}

export function MiniCassette({ color }: { color: string }) {
  return (
    <span className="mini-cassette" style={{ background: color }} aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

export function TapeSwatch({ color }: { color: string }) {
  return <span className="tape-swatch" style={{ background: color }} aria-hidden="true" />;
}

export function CounterReels({ progress }: { progress: number }) {
  const [left, right] = reelSizes(progress, 3, 5);
  return (
    <span className="counter-reels" aria-hidden="true">
      <span className="reel" style={{ width: 16, height: 16, borderWidth: left }} />
      <span className="reel" style={{ width: 16, height: 16, borderWidth: right }} />
    </span>
  );
}
