// Messages between a phone and the Mac go over a WebRTC data channel, which
// takes messages of limited size. Longer ones travel as numbered parts and are
// put back together on arrival. Used on both sides.

// Characters, not bytes: Chinese text is three bytes a character, so this stays
// well under the channel's 256 KB message limit.
export const PART_CHARS = 40000;

export type Message = Record<string, unknown> & { t?: string; id?: number };

interface Part {
  t: "part";
  pid: string;
  i: number;
  n: number;
  data: string;
}

let counter = 0;

export function toFrames(message: Message): string[] {
  const text = JSON.stringify(message);
  if (text.length <= PART_CHARS) return [text];
  const pid = `${Date.now().toString(36)}${(counter += 1).toString(36)}`;
  const n = Math.ceil(text.length / PART_CHARS);
  return Array.from({ length: n }, (_, i) => JSON.stringify({ t: "part", pid, i, n, data: text.slice(i * PART_CHARS, (i + 1) * PART_CHARS) } satisfies Part));
}

// Feeds received frames; returns a whole message when one is complete.
export class Reassembler {
  private pending = new Map<string, { parts: string[]; got: number; at: number }>();

  push(frame: string): Message | null {
    let value: unknown;
    try {
      value = JSON.parse(frame);
    } catch {
      return null;
    }
    const message = value as Message;
    if (message.t !== "part") return message;
    const part = value as Part;
    if (typeof part.pid !== "string" || !Number.isInteger(part.i) || !Number.isInteger(part.n) || part.n > 2000 || part.i < 0 || part.i >= part.n) return null;
    // Forget halves of messages that never finished.
    for (const [pid, entry] of this.pending) if (Date.now() - entry.at > 120000) this.pending.delete(pid);
    const entry = this.pending.get(part.pid) ?? { parts: new Array<string>(part.n), got: 0, at: Date.now() };
    if (entry.parts[part.i] === undefined) entry.got += 1;
    entry.parts[part.i] = String(part.data ?? "");
    this.pending.set(part.pid, entry);
    if (entry.got < part.n) return null;
    this.pending.delete(part.pid);
    try {
      return JSON.parse(entry.parts.join("")) as Message;
    } catch {
      return null;
    }
  }
}
