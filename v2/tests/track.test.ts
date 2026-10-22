import { afterAll, describe, expect, it } from "vitest";

// 后台播放: a lesson joined into one track (so it keeps playing on a locked
// phone), and the player following it.

class FakeOfflineContext {
  constructor(public channels: number, public length: number, public sampleRate: number) {}
  // Each "sentence" lasts as many seconds as its first byte says.
  async decodeAudioData(data: ArrayBuffer) {
    const seconds = new Uint8Array(data)[0];
    const samples = new Float32Array(seconds * this.sampleRate).fill(0.5);
    return { sampleRate: this.sampleRate, length: samples.length, numberOfChannels: 1, getChannelData: () => samples };
  }
}

class FakeAudio {
  src = "";
  paused = true;
  loop = false;
  currentTime = 0;
  readyState = 4;
  ontimeupdate: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  load() {}
  addEventListener() {}
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  at(seconds: number) {
    this.currentTime = seconds;
    this.ontimeupdate?.();
  }
}

const scope = globalThis as unknown as { window?: unknown; Audio?: unknown };
const before = { window: scope.window, Audio: scope.Audio };
let lastAudio: FakeAudio | null = null;
scope.window = { OfflineAudioContext: FakeOfflineContext };
scope.Audio = class extends FakeAudio {
  constructor() {
    super();
    lastAudio = this;
  }
};
afterAll(() => Object.assign(scope, before));

const { buildTrack, partAt } = await import("../src/speech/track");
const { SpeechPlayer } = await import("../src/speech/player");
const sentence = (seconds: number) => new Blob([new Uint8Array([seconds])], { type: "audio/mp4" });

describe("a lesson as one track", () => {
  it("joins the sentences with their repeats and pauses, and knows which sentence is when", async () => {
    const track = await buildTrack([sentence(2), sentence(3)], { repeat: 2, gapMs: 500, sampleRate: 100 });
    expect(track).not.toBeNull();
    // 2 × (2 + 0.5) then 2 × (3 + 0.5).
    expect(track!.parts).toEqual([
      { index: 0, start: 0, end: 5 },
      { index: 1, start: 5, end: 12 }
    ]);
    expect(track!.duration).toBe(12);
    expect(partAt(track!.parts, 4.9)).toBe(0);
    expect(partAt(track!.parts, 5)).toBe(1);
    expect(partAt(track!.parts, 99)).toBe(1);
  });

  it("the player follows the track, pauses, skips, goes round, and lets go on stop", async () => {
    const track = (await buildTrack([sentence(2), sentence(2), sentence(2)], { repeat: 1, gapMs: 0, sampleRate: 100 }))!;
    const player = new SpeechPlayer(() => ({ cancel() {}, speaking: false, paused: false }) as unknown as SpeechSynthesis);
    let rounds = 0;
    player.playTrack("lesson", track, 1, () => (rounds += 1));
    const audio = lastAudio!;
    expect(audio.src).toBe(track.url);
    expect(audio.loop).toBe(true);
    expect(audio.currentTime).toBe(2);
    expect(player.getState()).toMatchObject({ status: "playing", key: "lesson", index: 1, background: true });

    audio.at(4.5);
    expect(player.getState().index).toBe(2);
    // Round to the start again.
    audio.at(0.2);
    expect(rounds).toBe(1);
    expect(player.getState().index).toBe(0);

    player.pause();
    expect(audio.paused).toBe(true);
    expect(player.getState().status).toBe("paused");
    player.resume();
    expect(audio.paused).toBe(false);

    expect(player.skipTo(2)).toBe(true);
    expect(audio.currentTime).toBe(4);
    expect(player.getState().index).toBe(2);

    player.stop();
    expect(audio.src).toBe("");
    expect(player.getState()).toMatchObject({ status: "idle", background: false });
    expect(player.skipTo(0)).toBe(false);
  });
});
