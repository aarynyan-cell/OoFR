import { afterAll, describe, expect, it } from "vitest";
import { type PlayItem, type PlayOptions, SpeechPlayer } from "../src/speech/player";
import { connectMediaControls } from "../src/speech/mediaControls";
import { RemoteSynth, type RemoteUtterance, remoteUtterance } from "../src/speech/remote";

// The phone's playback with the Mac's voices (src/speech/remote.ts) driven by
// the lesson player, with a pretend audio element and browser voice. The bug
// these guard against: audio that kept playing (or started) while the player
// showed it paused.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeAudio {
  src = "";
  paused = true;
  // Each real start of playback (not counting the silent unlock).
  starts: string[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  // Like a browser: a play() still getting going fails when the element is emptied.
  private abort: (() => void) | null = null;
  play() {
    this.paused = false;
    if (!this.src.startsWith("data:")) this.starts.push(this.src);
    return new Promise<void>((resolve, reject) => {
      this.abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      setTimeout(() => {
        this.abort = null;
        resolve();
      }, 5);
    });
  }
  pause() {
    this.paused = true;
  }
  load() {
    this.abort?.();
    this.abort = null;
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  // The sentence reaches its end.
  finish() {
    this.paused = true;
    this.onended?.();
  }
}

class FakeUtterance {
  lang = "";
  rate = 1;
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}
(globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = FakeUtterance;

class FakeWeb {
  spoken: string[] = [];
  cancels = 0;
  pauses = 0;
  current: FakeUtterance | null = null;
  speaking = false;
  paused = false;
  getVoices() {
    return [];
  }
  addEventListener() {}
  speak(utterance: FakeUtterance) {
    this.current = utterance;
    this.speaking = true;
    this.spoken.push(utterance.text);
  }
  cancel() {
    this.cancels += 1;
    const current = this.current;
    this.current = null;
    this.speaking = false;
    current?.onerror?.({ error: "interrupted" });
  }
  pause() {
    this.pauses += 1;
  }
  resume() {}
  finish() {
    const current = this.current;
    this.current = null;
    this.speaking = false;
    current?.onend?.();
  }
}

// The Mac's audio arrives after `delay` ms (or there is none: the browser voice reads).
class TestSynth extends RemoteSynth {
  constructor(web: FakeWeb, audio: FakeAudio, private readonly delay: number | null) {
    super(web as unknown as SpeechSynthesis, audio as unknown as HTMLAudioElement);
  }
  protected override canReadBetter(): boolean {
    return this.delay !== null;
  }
  protected override async audioFor(utterance: RemoteUtterance): Promise<Blob | null> {
    if (this.delay === null) return null;
    await sleep(this.delay);
    return new Blob([utterance.text], { type: "audio/mp4" });
  }
}

const items: PlayItem[] = [
  { text: "Bonjour.", lang: "fr-FR" },
  { text: "Merci.", lang: "fr-FR" }
];
const options = (gapMs = 30): PlayOptions => ({ rate: 1, repeat: 1, gapMs, mode: "all", voice: null });

function setup(delay: number | null) {
  const audio = new FakeAudio();
  const web = new FakeWeb();
  const synth = new TestSynth(web, audio, delay);
  const player = new SpeechPlayer(() => synth as unknown as SpeechSynthesis, (text) => remoteUtterance(text) as unknown as SpeechSynthesisUtterance);
  return { audio, web, synth, player };
}

describe("phone playback with the Mac's voices", () => {
  it("pausing a sentence stops it, and nothing plays until resume", async () => {
    const { audio, player } = setup(10);
    void player.play("lesson", items, 0, options());
    await sleep(40);
    expect(audio.starts).toHaveLength(1);
    player.pause();
    expect(audio.paused).toBe(true);
    await sleep(300);
    expect(audio.starts).toHaveLength(1);
    expect(audio.paused).toBe(true);
    player.resume();
    expect(audio.paused).toBe(false);
    audio.finish();
    await sleep(80);
    expect(audio.starts).toHaveLength(3);
    player.stop();
  });

  it("pausing while the audio is still on its way: it does not start when it arrives", async () => {
    const { audio, player } = setup(150);
    void player.play("lesson", items, 0, options());
    await sleep(30);
    player.pause();
    await sleep(300);
    expect(audio.starts).toHaveLength(0);
    expect(audio.paused).toBe(true);
    player.resume();
    expect(audio.starts).toHaveLength(1);
    player.stop();
  });

  it("pausing between two sentences holds the next one", async () => {
    const { audio, player } = setup(10);
    void player.play("lesson", items, 0, options(150));
    await sleep(40);
    audio.finish();
    await sleep(20);
    player.pause();
    await sleep(400);
    expect(audio.starts).toHaveLength(1);
    player.resume();
    await sleep(250);
    expect(audio.starts).toHaveLength(2);
    player.stop();
  });

  it("with the browser's own voice, pause really stops it and the sentence starts again on resume", async () => {
    const { web, player } = setup(null);
    void player.play("lesson", items, 0, options());
    await sleep(30);
    expect(web.spoken).toEqual(["Bonjour."]);
    player.pause();
    expect(web.cancels).toBeGreaterThan(0);
    expect(web.pauses).toBe(0);
    await sleep(300);
    expect(web.spoken).toEqual(["Bonjour."]);
    player.resume();
    await sleep(200);
    expect(web.spoken).toEqual(["Bonjour.", "Bonjour."]);
    player.stop();
  });

  it("pausing leaves nothing in the phone's media player, wherever the pause comes", async () => {
    const reading = setup(10);
    void reading.player.play("lesson", items, 0, options());
    await sleep(40);
    reading.player.pause();
    expect(reading.audio.src).toBe("");
    reading.player.stop();

    const between = setup(10);
    void between.player.play("lesson", items, 0, options(200));
    await sleep(40);
    between.audio.finish();
    await sleep(20);
    between.player.pause();
    expect(between.audio.src).toBe("");
    between.player.stop();

    const browserVoice = setup(null);
    void browserVoice.player.play("lesson", items, 0, options());
    await sleep(30);
    browserVoice.player.pause();
    expect(browserVoice.audio.src).toBe("");
    browserVoice.player.stop();
  });

  it("a pause just as a sentence starts neither fails nor switches to the browser voice", async () => {
    const { audio, web, player } = setup(10);
    void player.play("lesson", items, 0, options());
    await sleep(12);
    expect(audio.starts).toHaveLength(1);
    player.pause();
    await sleep(200);
    expect(web.spoken).toEqual([]);
    expect(player.getState().status).toBe("paused");
    player.resume();
    expect(audio.starts).toHaveLength(2);
    expect(audio.starts[1]).toBe(audio.starts[0]);
    player.stop();
  });

  it("a single sentence that has finished leaves nothing behind", async () => {
    const { audio, player } = setup(10);
    void player.play("once", [items[0]], 0, { ...options(), repeat: 1 });
    await sleep(40);
    audio.finish();
    await sleep(100);
    expect(player.getState().status).toBe("idle");
    expect(audio.src).toBe("");
  });

  it("stopping leaves nothing for the system's media controls to start again", async () => {
    const { audio, player } = setup(10);
    void player.play("lesson", items, 0, options());
    await sleep(40);
    player.stop();
    expect(audio.paused).toBe(true);
    expect(audio.src).toBe("");
    expect(audio.onended).toBeNull();
    await sleep(200);
    expect(audio.starts).toHaveLength(1);
  });
});

// The Dynamic Island / lock screen controls.
class FakeSession {
  handlers = new Map<string, (() => void) | null>();
  playbackState: MediaSessionPlaybackState = "none";
  metadata: unknown = { title: "Leçon" };
  setActionHandler(action: string, handler: (() => void) | null) {
    this.handlers.set(action, handler);
  }
  press(action: string) {
    this.handlers.get(action)?.();
  }
}

describe("the system's media controls", () => {
  function connected(delay: number | null = 10) {
    const parts = setup(delay);
    const session = new FakeSession();
    connectMediaControls(session as unknown as MediaSession, parts.player);
    return { ...parts, session };
  }

  it("play does nothing while nothing is playing", async () => {
    const { audio, web, session } = connected();
    session.press("play");
    await sleep(100);
    expect(audio.starts).toHaveLength(0);
    expect(web.spoken).toHaveLength(0);
    expect(session.playbackState).toBe("none");
  });

  it("show what the player is doing, and pause and resume it", async () => {
    const { audio, player, session } = connected();
    void player.play("lesson", items, 0, options());
    await sleep(40);
    expect(session.playbackState).toBe("playing");
    session.press("pause");
    expect(player.getState().status).toBe("paused");
    expect(session.playbackState).toBe("paused");
    expect(audio.paused).toBe(true);
    session.press("play");
    expect(player.getState().status).toBe("playing");
    expect(audio.paused).toBe(false);
    player.stop();
    expect(session.playbackState).toBe("none");
    expect(session.metadata).toBeNull();
  });

  it("offer no seeking or skipping that could start a sentence behind the player's back", () => {
    const { session } = connected();
    for (const action of ["seekbackward", "seekforward", "seekto", "previoustrack", "nexttrack"]) expect(session.handlers.get(action)).toBeNull();
    expect(session.handlers.get("stop")).toBeTypeOf("function");
  });
});

// Without the Mac: audio kept on the phone still plays in the Mac's voice.
describe("the Mac's voices after the Mac is gone", () => {
  const scope = globalThis as unknown as { localStorage?: unknown; caches?: unknown; location?: unknown };
  const saved = { localStorage: scope.localStorage, caches: scope.caches, location: scope.location };
  const store = new Map<string, string>();
  const kept: string[] = [];

  function install(rememberedVoices: string | null) {
    store.clear();
    if (rememberedVoices !== null) store.set("oofr2.macVoices", rememberedVoices);
    scope.localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) };
    scope.location = { origin: "https://example.test" };
    // Every sentence was kept while the Mac was connected.
    scope.caches = {
      open: async () => ({
        match: async (key: string) => {
          kept.push(key);
          return new Response(new Blob(["aac"], { type: "audio/mp4" }));
        },
        put: async () => undefined
      })
    };
  }

  afterAll(() => Object.assign(scope, saved));

  it("lists the remembered Mac voices and plays the kept audio", async () => {
    install(JSON.stringify([{ name: "Thomas (Enhanced)", lang: "fr-FR" }]));
    const audio = new FakeAudio();
    const web = new FakeWeb();
    const synth = new RemoteSynth(web as unknown as SpeechSynthesis, audio as unknown as HTMLAudioElement);
    expect(synth.getVoices().map((voice) => voice.voiceURI)).toContain("mac:Thomas (Enhanced)");
    const utterance = remoteUtterance("Bonjour.");
    synth.speak(utterance);
    await sleep(200);
    expect(audio.starts).toHaveLength(1);
    expect(web.spoken).toEqual([]);
    synth.cancel();
  });

  it("falls back to the browser's voice when no Mac voice was ever seen", async () => {
    install(null);
    const audio = new FakeAudio();
    const web = new FakeWeb();
    const synth = new RemoteSynth(web as unknown as SpeechSynthesis, audio as unknown as HTMLAudioElement);
    synth.speak(remoteUtterance("Bonjour."));
    await sleep(200);
    expect(audio.starts).toHaveLength(0);
    expect(web.spoken).toEqual(["Bonjour."]);
    synth.cancel();
  });
});
