import { afterAll, afterEach, describe, expect, it } from "vitest";

// Playing back the learner's own recordings (跟读): when one finishes or is
// stopped, nothing stays in the phone's media player for the Dynamic Island.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const made: FakeAudio[] = [];

class FakeAudio {
  src: string;
  paused = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(src = "") {
    this.src = src;
    made.push(this);
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  load() {}
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  finish() {
    this.paused = true;
    this.onended?.();
  }
}

const globals = globalThis as unknown as { Audio: unknown };
const before = globals.Audio;
globals.Audio = FakeAudio;
afterEach(() => {
  made.length = 0;
});
afterAll(() => {
  globals.Audio = before;
});

const { playRecordings, stopRecordingAudio } = await import("../src/app/recordings");
const blob = () => new Blob(["take"], { type: "audio/mp4" });

describe("playing back recordings", () => {
  it("a recording that has finished leaves nothing behind", async () => {
    const done = playRecordings("take", [blob()]);
    await sleep(5);
    expect(made).toHaveLength(1);
    made[0].finish();
    await done;
    expect(made[0].src).toBe("");
    expect(made[0].onended).toBeNull();
  });

  it("stopping a recording empties it", async () => {
    void playRecordings("take", [blob(), blob()], 10);
    await sleep(5);
    stopRecordingAudio();
    expect(made[0].paused).toBe(true);
    expect(made[0].src).toBe("");
    await sleep(50);
    expect(made).toHaveLength(1);
  });
});
