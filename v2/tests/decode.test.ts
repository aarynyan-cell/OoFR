import { afterAll, describe, expect, it } from "vitest";

// Recordings are decoded (waveform, joined takes) without a live AudioContext:
// on a real iPhone one or two of those left the microphone recording nothing
// until the page was reloaded.

let liveContexts = 0;
class LiveContext {
  constructor() {
    liveContexts += 1;
  }
}

class FakeOfflineContext {
  constructor(public channels: number, public length: number, public sampleRate: number) {}
  async decodeAudioData(data: ArrayBuffer) {
    const bytes = new Uint8Array(data);
    if (bytes[0] === 0) throw new Error("not audio");
    // A "recording": one loud moment in the middle.
    const samples = new Float32Array(480).fill(0.01);
    samples[240] = 0.8;
    return { sampleRate: this.sampleRate, length: samples.length, numberOfChannels: 1, getChannelData: () => samples };
  }
}

const scope = globalThis as unknown as { window?: unknown };
const before = scope.window;
scope.window = { AudioContext: LiveContext, OfflineAudioContext: FakeOfflineContext };
afterAll(() => {
  scope.window = before;
});

const { waveform } = await import("../src/speech/recorder");
const { mergeRecordings } = await import("../src/speech/wav");
const take = (first = 1) => new Blob([new Uint8Array([first, 2, 3])], { type: "audio/mp4" });

describe("decoding recordings", () => {
  it("draws the waveform without opening the speakers", async () => {
    const bars = await waveform(take(), 4);
    expect(bars).toHaveLength(4);
    expect(Math.max(...bars)).toBe(1);
    expect(liveContexts).toBe(0);
  });

  it("joins takes without opening the speakers, skipping one that cannot be decoded", async () => {
    const { wav, skipped } = await mergeRecordings([take(), take(0), take()]);
    expect(skipped).toBe(1);
    expect(wav.type).toBe("audio/wav");
    expect(wav.size).toBeGreaterThan(44);
    expect(liveContexts).toBe(0);
  });
});
