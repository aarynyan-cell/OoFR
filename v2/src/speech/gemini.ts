// Natural French voices for a phone on its own (2.1): Google's Gemini speech
// models with the learner's free key. Web pages on an iPhone only get the two
// basic voices; with this the phone needs neither the Mac nor a download.
//
// The free key allows only about 10 requests a day per model (and 3 a minute),
// so a stretch of a lesson (up to 8 sentences) is read in one request, single
// words are left to the other voices, and the audio is cut at
// the pauses between sentences. A cut that does not match the sentences'
// lengths is not trusted: those sentences are read one by one instead. The
// audio is kept by the caller (src/speech/remote.ts), so each sentence is read
// once; the speed is applied when it plays.

import { encodeWav } from "./wav";

export const GEMINI_VOICE = "gemini:";
export const GEMINI_VOICES = [
  { name: "Kore", gender: "女声" },
  { name: "Aoede", gender: "女声" },
  { name: "Charon", gender: "男声" },
  { name: "Puck", gender: "男声" }
] as const;

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// Tried in this order; each has its own allowance a minute.
export const GEMINI_MODELS = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"];
const PER_REQUEST = 8;
const BUSY_PAUSE_MS = 60000;
// Background reading waits for a minute's allowance, not for the next day's.
const LONGEST_WAIT_MS = 120000;
const DAY_USED_UP = "Gemini 今天的免费额度用完了，明天会恢复";
const MINUTE_USED_UP = "Gemini 的免费额度这一分钟用完了";

type Fetcher = typeof fetch;

export class GeminiBusyError extends Error {}

interface Pcm {
  samples: Int16Array;
  rate: number;
}

// The audio in an answer: a WAV file (newer models) or raw 16-bit PCM.
export function readPcm(bytes: Uint8Array, mime: string): Pcm {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > 44 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF") {
    // Walk the chunks to "data" (headers are not always 44 bytes).
    const rate = view.getUint32(24, true);
    let at = 12;
    while (at + 8 <= bytes.length) {
      const id = String.fromCharCode(...bytes.subarray(at, at + 4));
      const size = view.getUint32(at + 4, true);
      if (id === "data") return { samples: new Int16Array(bytes.slice(at + 8, at + 8 + size).buffer), rate };
      at += 8 + size + (size % 2);
    }
    return { samples: new Int16Array(bytes.slice(44).buffer), rate };
  }
  const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
  return { samples: new Int16Array(bytes.slice(0, bytes.length - (bytes.length % 2)).buffer), rate };
}

// Where to cut one reading of `lengths.length` sentences: the longest quiet
// stretches, kept only when the pieces match the sentences' lengths.
export function cutPoints(pcm: Pcm, lengths: number[]): number[] | null {
  const count = lengths.length;
  if (count === 1) return [];
  const window = Math.max(1, Math.round(pcm.rate * 0.02));
  let peak = 1;
  for (const sample of pcm.samples) peak = Math.max(peak, Math.abs(sample));
  const quiet: { start: number; end: number }[] = [];
  let from = -1;
  const windows = Math.ceil(pcm.samples.length / window);
  for (let index = 0; index <= windows; index += 1) {
    let sum = 0;
    const start = index * window;
    const end = Math.min(pcm.samples.length, start + window);
    for (let at = start; at < end; at += 1) sum += pcm.samples[at] * pcm.samples[at];
    const silent = index < windows && end > start && Math.sqrt(sum / (end - start)) < peak * 0.02;
    if (silent && from < 0) from = start;
    if (!silent && from >= 0) {
      quiet.push({ start: from, end: start });
      from = -1;
    }
  }
  // Pauses inside the reading (not the silence before or after it).
  const inner = quiet.filter((stretch) => stretch.start > 0 && stretch.end < pcm.samples.length);
  if (inner.length < count - 1) return null;
  const chosen = [...inner].sort((a, b) => b.end - b.start - (a.end - a.start)).slice(0, count - 1).sort((a, b) => a.start - b.start);
  const cuts = chosen.map((stretch) => Math.round((stretch.start + stretch.end) / 2));
  // Each piece's share of the time should roughly be its sentence's share of the letters.
  const total = pcm.samples.length;
  const letters = lengths.reduce((sum, length) => sum + length, 0);
  const edges = [0, ...cuts, total];
  for (let index = 0; index < count; index += 1) {
    const share = (edges[index + 1] - edges[index]) / total;
    const expected = lengths[index] / letters;
    if (share < expected * 0.35 || share > expected * 2.8) return null;
  }
  return cuts;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

export class GeminiSpeech {
  // A model that answered "too many requests" rests until then.
  private resting = new Map<string, number>();
  // Models whose allowance for the day is used up (they rest until it renews).
  private dayUsedUp = new Set<string>();

  constructor(private readonly key: () => string | null, private readonly fetcher: Fetcher = (...args) => fetch(...args)) {}

  get available(): boolean {
    return Boolean(this.key());
  }

  // Every model resting (for the day or the minute): nothing can be read now.
  get unavailable(): boolean {
    const now = Date.now();
    return GEMINI_MODELS.every((name) => (this.resting.get(name) ?? 0) > now);
  }

  private async request(model: string, text: string, voice: string, signal?: AbortSignal): Promise<Pcm> {
    const key = this.key();
    if (!key) throw new Error("还没有填写 Gemini 的密钥");
    const response = await this.fetcher(`${BASE}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000)
    });
    if (response.status === 429) {
      const data = (await response.json().catch(() => ({}))) as { error?: { details?: { retryDelay?: string; violations?: { quotaId?: string }[] }[] } };
      const details = data.error?.details ?? [];
      const seconds = Number.parseFloat(details.find((detail) => detail.retryDelay)?.retryDelay ?? "");
      const daily = details.some((detail) => detail.violations?.some((violation) => /PerDay/i.test(violation.quotaId ?? "")));
      this.resting.set(model, Date.now() + (Number.isFinite(seconds) ? seconds * 1000 + 500 : BUSY_PAUSE_MS));
      if (daily) this.dayUsedUp.add(model);
      throw new GeminiBusyError(daily ? DAY_USED_UP : MINUTE_USED_UP);
    }
    if (!response.ok) throw new Error(`Gemini 返回 ${response.status}`);
    const data = (await response.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] };
    const audio = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
    if (!audio?.data) throw new Error("Gemini 没有读出来");
    return readPcm(Uint8Array.from(atob(audio.data), (char) => char.charCodeAt(0)), audio.mimeType ?? "");
  }

  // One request on the first model that is not resting; `patient` waits for one
  // (background work), otherwise a busy Gemini says so at once.
  private async read(text: string, voice: string, patient: boolean, signal?: AbortSignal): Promise<Pcm> {
    for (;;) {
      const now = Date.now();
      const model = GEMINI_MODELS.find((name) => (this.resting.get(name) ?? 0) <= now);
      if (model) {
        try {
          return await this.request(model, text, voice, signal);
        } catch (error) {
          if (error instanceof GeminiBusyError) continue;
          throw error;
        }
      }
      const wait = Math.min(...GEMINI_MODELS.map((name) => (this.resting.get(name) ?? 0) - now));
      const message = GEMINI_MODELS.every((name) => this.dayUsedUp.has(name)) ? DAY_USED_UP : MINUTE_USED_UP;
      if (!patient || wait > LONGEST_WAIT_MS) throw new GeminiBusyError(message);
      await sleep(Math.max(500, wait), signal);
    }
  }

  // The audio of each sentence (in order, from one lesson), as WAV files.
  async readSentences(texts: string[], voice: string, { patient = false, signal }: { patient?: boolean; signal?: AbortSignal } = {}): Promise<Map<string, Blob>> {
    const out = new Map<string, Blob>();
    const unique = [...new Set(texts.map((text) => text.trim()).filter(Boolean))];
    for (let start = 0; start < unique.length; start += PER_REQUEST) {
      const part = unique.slice(start, start + PER_REQUEST);
      const pcm = await this.read(part.join("\n\n"), voice, patient, signal);
      const cuts = cutPoints(pcm, part.map((text) => text.length));
      if (cuts) {
        const edges = [0, ...cuts, pcm.samples.length];
        part.forEach((text, index) => out.set(text, toWav(pcm.samples.subarray(edges[index], edges[index + 1]), pcm.rate)));
        continue;
      }
      // The pauses did not match: each sentence of this stretch on its own.
      for (const text of part) {
        const one = await this.read(text, voice, patient, signal);
        out.set(text, toWav(one.samples, one.rate));
      }
    }
    return out;
  }

  // Checks a key with the cheapest request there is: the list of models.
  static async check(key: string, fetcher: Fetcher = (...args) => fetch(...args)): Promise<boolean> {
    try {
      const response = await fetcher(`${BASE}?pageSize=1`, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(15000) });
      return response.ok;
    } catch {
      return false;
    }
  }
}

function toWav(samples: Int16Array, rate: number): Blob {
  const floats = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) floats[index] = samples[index] / 32768;
  return encodeWav(floats, rate);
}
