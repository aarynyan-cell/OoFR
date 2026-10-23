import { afterEach, describe, expect, it, vi } from "vitest";

// 3.0.1: the phone reads with its own downloaded voices first; Gemini (about
// 20 requests a day) is kept for lesson sentences; a basic voice the learner
// chose is that voice, and it starts inside the tap (on an iPhone it stayed
// silent when started later, after the audio element had been used).

vi.mock("../src/ai/online", async (original) => ({
  ...(await original<typeof import("../src/ai/online")>()),
  loadKeys: async () => ({ groq: [], siliconflow: [], zhipu: [], gemini: ["AIzaTESTKEY"] }),
  onKeysChange: () => () => undefined
}));

const { RemoteSynth, remoteUtterance } = await import("../src/speech/remote");
const { GeminiSpeech, GEMINI_MODELS } = await import("../src/speech/gemini");
const { isTinyVoice, pickVoice, voiceLabel } = await import("../src/speech/voices");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeUtterance {
  lang = "";
  rate = 1;
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}
(globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = FakeUtterance;

const voice = (name: string, voiceURI: string, lang = "fr-FR") => ({ name, lang, voiceURI, localService: true, default: false }) as SpeechSynthesisVoice;
const tinyThomas = voice("Thomas", "com.apple.voice.super-compact.fr-FR.Thomas");
const compactThomas = voice("Thomas", "com.apple.voice.compact.fr-FR.Thomas");

class FakeWeb {
  spoken: FakeUtterance[] = [];
  speaking = false;
  paused = false;
  constructor(private readonly voices: SpeechSynthesisVoice[]) {}
  getVoices() {
    return this.voices;
  }
  addEventListener() {}
  speak(utterance: FakeUtterance) {
    this.spoken.push(utterance);
  }
  cancel() {}
}

function phone(voices: SpeechSynthesisVoice[]) {
  const web = new FakeWeb(voices);
  const synth = new RemoteSynth(web as unknown as SpeechSynthesis, null);
  return { web, synth };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the phone's own voices in the voice list", () => {
  const local = (name: string) => ({ name, lang: "fr-FR", voiceURI: `local:${name.toLowerCase()}` });
  it("come before Gemini's and the Mac's, with a plain label", () => {
    const voices = [{ name: "Kore", lang: "fr-FR", voiceURI: "gemini:Kore" }, { name: "Thomas (Enhanced)", lang: "fr-FR", voiceURI: "mac:Thomas (Enhanced)" }, local("Tom"), local("Siwis")];
    expect(pickVoice(voices)?.voiceURI).toBe("local:siwis");
    expect(voiceLabel(local("Tom"))).toBe("Tom · 男声（手机本地）");
  });

  it("an iPhone's super-compact copy of a voice comes after its fuller copy", () => {
    expect(isTinyVoice(tinyThomas)).toBe(true);
    expect(isTinyVoice(compactThomas)).toBe(false);
    expect(pickVoice([tinyThomas, compactThomas])?.voiceURI).toBe(compactThomas.voiceURI);
  });
});

describe("the browser's own voice on an iPhone", () => {
  it("with nothing better to read it, starts inside the tap and leaves the audio element alone", () => {
    const audio = { src: "", plays: 0, play() { this.plays += 1; return Promise.resolve(); }, pause() {}, load() {}, removeAttribute() {} };
    const web = new FakeWeb([compactThomas]);
    const synth = new RemoteSynth(web as unknown as SpeechSynthesis, audio as unknown as HTMLAudioElement);
    synth.speak({ ...remoteUtterance("Bonjour."), voice: compactThomas });
    // At once, not after a wait.
    expect(web.spoken.map((utterance) => utterance.text)).toEqual(["Bonjour."]);
    synth.cancel();
    expect(audio.plays).toBe(0);
    expect(audio.src).toBe("");
  });
});

describe("Gemini's few requests a day", () => {
  it("are not spent on a basic voice the learner chose, nor on a single word", async () => {
    const fetches: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetches.push(String(url));
      return new Response("{}", { status: 500 });
    });
    const { web, synth } = phone([compactThomas]);
    await sleep(10);
    // A basic voice chosen: that voice reads, Gemini is not asked (even for a sentence of the open lesson).
    synth.prefetch(["Bonjour madame."], compactThomas, "fr-FR", 1);
    synth.speak({ ...remoteUtterance("Bonjour madame."), voice: compactThomas });
    await sleep(30);
    expect(web.spoken.map((utterance) => utterance.text)).toEqual(["Bonjour madame."]);
    // Gemini's voice chosen, a single word tapped (not a sentence of the open lesson): no request.
    synth.speak({ ...remoteUtterance("madame"), voice: voice("Kore", "gemini:Kore") });
    await sleep(30);
    expect(web.spoken.map((utterance) => utterance.text)).toEqual(["Bonjour madame.", "madame"]);
    expect(fetches.filter((url) => url.includes("generativelanguage"))).toEqual([]);
  });

  it("says the day's allowance is used up, and background reading does not wait for tomorrow", async () => {
    const calls: string[] = [];
    const fetcher = (async (url: string) => {
      calls.push(url);
      return new Response(
        JSON.stringify({ error: { code: 429, details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }, { retryDelay: "28973s" }] } }),
        { status: 429 }
      );
    }) as typeof fetch;
    const speech = new GeminiSpeech(() => "AIzaTESTKEY", fetcher);
    const started = Date.now();
    await expect(speech.readSentences(["Merci."], "Kore", { patient: true })).rejects.toThrow("今天的免费额度用完了");
    expect(Date.now() - started).toBeLessThan(1000);
    expect(calls).toHaveLength(GEMINI_MODELS.length);
    expect(speech.unavailable).toBe(true);
  });
});
