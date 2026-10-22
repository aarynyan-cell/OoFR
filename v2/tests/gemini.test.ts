import { describe, expect, it } from "vitest";
import { GEMINI_MODELS, GeminiBusyError, GeminiSpeech, cutPoints, readPcm } from "../src/speech/gemini";
import { pickVoice, voiceLabel } from "../src/speech/voices";

// The phone's own natural voices (2.1): Gemini reads a stretch of a lesson in
// one request (its free key allows about 3 a minute) and the audio is cut at
// the pauses between sentences.

const RATE = 1000;
// A fake reading: a tone for each sentence (length by its letters), with pauses between.
function reading(lengths: number[], pause = 0.8, shortPause = 0): Int16Array {
  const parts: number[] = [];
  const silence = (seconds: number) => parts.push(...new Array(Math.round(seconds * RATE)).fill(0));
  silence(0.2);
  lengths.forEach((length, index) => {
    const seconds = length / 20;
    for (let at = 0; at < seconds * RATE; at += 1) {
      // A short gap inside a sentence (a comma).
      if (shortPause && at > (seconds * RATE) / 2 && at < (seconds * RATE) / 2 + shortPause * RATE) parts.push(0);
      else parts.push(Math.round(Math.sin(at / 3) * 8000));
    }
    if (index < lengths.length - 1) silence(pause);
  });
  silence(0.2);
  return Int16Array.from(parts);
}

function wavBytes(samples: Int16Array, rate = RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return bytes;
}

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

describe("cutting a reading into sentences", () => {
  it("reads WAV answers and raw PCM answers", () => {
    const samples = Int16Array.from([1, -2, 3]);
    expect(Array.from(readPcm(wavBytes(samples), "audio/wav").samples)).toEqual([1, -2, 3]);
    const raw = readPcm(new Uint8Array(samples.buffer), "audio/L16;codec=pcm;rate=24000");
    expect(raw.rate).toBe(24000);
    expect(Array.from(raw.samples)).toEqual([1, -2, 3]);
  });

  it("cuts at the longest pauses, not at a comma inside a sentence", () => {
    const lengths = [58, 37, 30, 28];
    const cuts = cutPoints({ samples: reading(lengths, 0.8, 0.4), rate: RATE }, lengths);
    expect(cuts).toHaveLength(3);
    // The first cut falls in the pause after the first sentence (0.2 s + 2.9 s).
    expect(cuts![0] / RATE).toBeGreaterThan(3.1);
    expect(cuts![0] / RATE).toBeLessThan(3.9);
  });

  it("does not trust a cut whose pieces do not match the sentences", () => {
    // Read as two sentences, but four were asked for.
    expect(cutPoints({ samples: reading([60, 60]), rate: RATE }, [30, 30, 30, 30])).toBeNull();
  });
});

describe("reading with Gemini", () => {
  function gemini(behaviour: { busyModels?: string[]; lengthsFor: (text: string) => number[] }) {
    const calls: { model: string; text: string }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      const model = /models\/([^:]+):/.exec(url)?.[1] ?? "";
      const text = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
      calls.push({ model, text });
      if (behaviour.busyModels?.includes(model)) {
        return new Response(JSON.stringify({ error: { code: 429, details: [{ retryDelay: "55s" }] } }), { status: 429 });
      }
      const audio = base64(wavBytes(reading(behaviour.lengthsFor(text))));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/wav", data: audio } }] } }] }));
    }) as typeof fetch;
    return { calls, speech: new GeminiSpeech(() => "AIzaTESTKEY", fetcher) };
  }

  it("reads a stretch of sentences in one request and gives each its own audio", async () => {
    const texts = ["Bonjour madame.", "Bien sûr, avec plaisir.", "Merci beaucoup."];
    const { calls, speech } = gemini({ lengthsFor: (text) => text.split("\n\n").map((line) => line.length) });
    const audios = await speech.readSentences(texts, "Kore");
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toBe(texts.join("\n\n"));
    expect([...audios.keys()]).toEqual(texts);
    for (const audio of audios.values()) expect(audio.type).toBe("audio/wav");
  });

  it("reads one by one when the pauses do not match", async () => {
    const texts = ["Bonjour madame.", "Bien sûr, avec plaisir.", "Merci beaucoup."];
    // The stretch comes back as one long sentence; single sentences come back fine.
    const { calls, speech } = gemini({ lengthsFor: (text) => (text.includes("\n\n") ? [text.length] : [text.length]) });
    const audios = await speech.readSentences(texts, "Kore");
    expect(audios.size).toBe(3);
    expect(calls).toHaveLength(4);
  });

  it("moves to the second model when the first is busy, and says so when both are", async () => {
    const one = gemini({ busyModels: [GEMINI_MODELS[0]], lengthsFor: (text) => [text.length] });
    await one.speech.readSentences(["Merci."], "Kore");
    expect(one.calls.map((call) => call.model)).toEqual(GEMINI_MODELS);
    const both = gemini({ busyModels: GEMINI_MODELS, lengthsFor: (text) => [text.length] });
    await expect(both.speech.readSentences(["Merci."], "Kore")).rejects.toBeInstanceOf(GeminiBusyError);
  });
});

describe("Gemini voices in the voice list", () => {
  const gemini = (name: string) => ({ name, lang: "fr-FR", voiceURI: `gemini:${name}` });
  it("come first when there is a key, Kore first, with a plain label", () => {
    const voices = [{ name: "Thomas (Enhanced)", lang: "fr-FR", voiceURI: "mac:Thomas (Enhanced)" }, gemini("Charon"), gemini("Kore"), { name: "Thomas", lang: "fr-FR" }];
    expect(pickVoice(voices)?.voiceURI).toBe("gemini:Kore");
    expect(voiceLabel(gemini("Charon"))).toBe("Charon · 男声（在线语音）");
    // A voice the learner chose stays chosen.
    expect(pickVoice(voices, "mac:Thomas (Enhanced)|fr-FR")?.voiceURI).toBe("mac:Thomas (Enhanced)");
  });
});
