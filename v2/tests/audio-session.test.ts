import { describe, expect, it } from "vitest";
import { holdRecordingSession, restartRecordingSession } from "../src/speech/audioSession";

// 跟读 on an iPhone: the phone stays ready to play and record while it is open
// (a sentence played between takes left the recorder silent otherwise).

class FakeSession {
  history: string[] = [];
  private current = "auto";
  get type() {
    return this.current;
  }
  set type(value: string) {
    this.current = value;
    this.history.push(value);
  }
}

describe("the iPhone's audio session in 跟读", () => {
  it("plays and records while 跟读 is open, and goes back when it closes", () => {
    const session = new FakeSession();
    const release = holdRecordingSession(session);
    expect(session.type).toBe("play-and-record");
    release();
    expect(session.type).toBe("auto");
  });

  it("puts back what another part of the page had chosen", () => {
    const session = new FakeSession();
    session.type = "playback";
    holdRecordingSession(session)();
    expect(session.type).toBe("playback");
  });

  it("does nothing where the browser has no audio session", () => {
    expect(() => holdRecordingSession(undefined)()).not.toThrow();
  });

  it("starts the microphone afresh after a silent take, and keeps playing and recording", async () => {
    const session = new FakeSession();
    holdRecordingSession(session);
    await restartRecordingSession(session, 5);
    expect(session.history).toEqual(["play-and-record", "auto", "play-and-record"]);
  });
});
