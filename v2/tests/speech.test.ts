import { describe, expect, it } from "vitest";
import { type PlayOptions, SpeechPlayer } from "../src/speech/player";
import { type VoiceLike, canDownloadBetterVoice, pickVoice, voiceId, voiceLabel } from "../src/speech/voices";

const voice = (name: string, lang = "fr-FR", extra = {}) => ({ name, lang, localService: true, default: false, ...extra });

describe("choosing a French voice", () => {
  it("prefers premium and enhanced voices, never the joke voices", () => {
    const voices = [voice("Eddy (French (France))"), voice("Thomas"), voice("Amélie", "fr-CA"), voice("Thomas (Enhanced)"), voice("Samantha", "en-US")];
    expect(pickVoice(voices)?.name).toBe("Thomas (Enhanced)");
    expect(pickVoice([voice("Eddy (French (France))"), voice("Jacques", "fr-FR")])?.name).toBe("Jacques");
    expect(pickVoice([voice("Samantha", "en-US")])).toBeNull();
  });

  it("prefers the online natural voices on Chrome and Edge", () => {
    expect(pickVoice([voice("Google français"), voice("Microsoft Paul - French (France)")])?.name).toBe("Google français");
    expect(pickVoice([voice("Microsoft Henri Online (Natural) - French (France)"), voice("Microsoft Paul - French (France)")])?.name).toMatch(/Henri/);
  });

  it("keeps the learner's choice (1.0 stored it as name|lang)", () => {
    const voices = [voice("Thomas (Enhanced)"), voice("Thomas"), voice("Jacques")];
    expect(pickVoice(voices, voiceId(voices[2]))?.name).toBe("Jacques");
    expect(pickVoice(voices, "Gone|fr-FR")?.name).toBe("Thomas (Enhanced)");
  });

  it("moves a chosen voice to its enhanced version once that is downloaded", () => {
    const before = [voice("Thomas"), voice("Jacques")];
    expect(pickVoice(before, "Thomas|fr-FR")?.name).toBe("Thomas");
    const after = [...before, voice("Thomas (Enhanced)"), voice("Amélie (Enhanced)", "fr-CA")];
    expect(pickVoice(after, "Thomas|fr-FR")?.name).toBe("Thomas (Enhanced)");
    expect(pickVoice(after, "Jacques|fr-FR")?.name).toBe("Jacques");
  });

  it("labels voices in plain words", () => {
    expect(voiceLabel(voice("Thomas (Enhanced)"))).toBe("Thomas · 增强版");
    expect(voiceLabel(voice("Amélie", "fr-CA"))).toBe("Amélie（加拿大）");
  });

  it("suggests the free better voice download on iPhone when only basic voices exist", () => {
    expect(canDownloadBetterVoice([voice("Thomas")], "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)")).toBe(true);
    expect(canDownloadBetterVoice([voice("Thomas (Enhanced)")], "Mozilla/5.0 (iPhone)")).toBe(false);
    expect(canDownloadBetterVoice([voice("Thomas")], "Mozilla/5.0 (Linux; Android 15)")).toBe(false);
  });
});

// A speech engine that "speaks" each sentence after a short delay.
function fakeSynth({ failWith = "" } = {}) {
  const spoken: string[] = [];
  let pending: { utterance: SpeechSynthesisUtterance; timer: ReturnType<typeof setTimeout> } | null = null;
  const synth = {
    speaking: false,
    paused: false,
    speak(utterance: SpeechSynthesisUtterance) {
      spoken.push(utterance.text);
      synth.speaking = true;
      const timer = setTimeout(() => {
        synth.speaking = false;
        pending = null;
        if (failWith) utterance.onerror?.({ error: failWith } as SpeechSynthesisErrorEvent);
        else utterance.onend?.({} as SpeechSynthesisEvent);
      }, 5);
      pending = { utterance, timer };
    },
    cancel() {
      if (pending) {
        clearTimeout(pending.timer);
        const { utterance } = pending;
        pending = null;
        synth.speaking = false;
        utterance.onerror?.({ error: "canceled" } as SpeechSynthesisErrorEvent);
      }
    },
    pause() { synth.paused = true; },
    resume() { synth.paused = false; },
    getVoices: () => []
  };
  const makeUtterance = (text: string) => ({ text, lang: "", rate: 1, pitch: 1, voice: null, onend: null, onerror: null }) as unknown as SpeechSynthesisUtterance;
  return { player: new SpeechPlayer(() => synth as unknown as SpeechSynthesis, makeUtterance), spoken };
}

const items = ["Un.", "Deux.", "Trois."].map((text) => ({ text, lang: "fr-FR" }));
const options: PlayOptions = { rate: 1, repeat: 1, gapMs: 0, mode: "all", voice: null };

describe("playing a lesson", () => {
  it("reads from the chosen sentence to the end, then reports it finished", async () => {
    const { player, spoken } = fakeSynth();
    const indexes: number[] = [];
    const unsubscribe = player.subscribe(() => indexes.push(player.getState().index));
    let finished = false;
    await player.play("lesson", items, 1, options, () => { finished = true; });
    unsubscribe();
    expect(spoken).toEqual(["Deux.", "Trois."]);
    expect(finished).toBe(true);
    expect(indexes).toContain(2);
    expect(player.getState().status).toBe("idle");
  });

  it("repeats each sentence when asked", async () => {
    const { player, spoken } = fakeSynth();
    await player.play("lesson", items.slice(0, 2), 0, { ...options, repeat: 2 });
    expect(spoken).toEqual(["Un.", "Un.", "Deux.", "Deux."]);
  });

  it("loops one sentence until stopped", async () => {
    const { player, spoken } = fakeSynth();
    const run = player.play("lesson", items, 0, { ...options, mode: "one" });
    await new Promise((resolve) => setTimeout(resolve, 40));
    player.stop();
    await run;
    expect(spoken.length).toBeGreaterThan(2);
    expect(new Set(spoken)).toEqual(new Set(["Un."]));
  });

  it("a new run replaces the old one", async () => {
    const { player, spoken } = fakeSynth();
    const first = player.play("a", items, 0, options);
    const second = player.play("b", items, 2, options);
    await Promise.all([first, second]);
    expect(spoken).toEqual(["Un.", "Trois."]);
  });

  it("stops after three failures with a readable message", async () => {
    const { player } = fakeSynth({ failWith: "language-unavailable" });
    await player.play("lesson", items, 0, { ...options, mode: "one" });
    expect(player.getState().message).toBe("这台设备没有法语朗读声音");
  });

  it("explains when the browser cannot speak at all", async () => {
    const player = new SpeechPlayer(() => undefined);
    await player.play("lesson", items, 0, options);
    expect(player.getState().message).toBe("这个浏览器不支持朗读");
  });
});

describe("voices read by a paired Mac", () => {
  const mac = (name: string, lang = "fr-FR") => ({ name, lang, localService: false, default: false, voiceURI: `mac:${name}` });

  it("keeps the Mac's voices apart from the browser's and labels them", () => {
    expect(voiceId(mac("Thomas"))).toBe("mac:Thomas|fr-FR");
    expect(voiceId(voice("Thomas"))).toBe("Thomas|fr-FR");
    expect(voiceLabel(mac("Thomas (Enhanced)"))).toBe("Thomas · 增强版（电脑朗读）");
  });

  it("moves to the Mac's enhanced voice while connected, and back to the browser's without it", () => {
    const browser = [voice("Thomas"), voice("Amélie", "fr-CA")];
    expect(voiceId(pickVoice<VoiceLike>([mac("Thomas (Enhanced)"), ...browser], "Thomas|fr-FR")!)).toBe("mac:Thomas (Enhanced)|fr-FR");
    expect(pickVoice(browser, "mac:Thomas (Enhanced)|fr-FR")?.name).toBe("Thomas");
  });
});
