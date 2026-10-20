// Better voices for the web app. Apple lets web pages (Safari, the iPhone
// home-screen app) use only the two basic French voices, so a phone paired
// with the Mac app asks the Mac to read each sentence with its own (enhanced)
// voices and plays the audio. Audio is kept on the phone, so a sentence heard
// once also plays well later without the Mac. Without either, the browser's
// own voice reads as before. This stands in for speechSynthesis.

import { onPairedMac, pairedMac } from "../ai/state";
import type { MacVoice } from "../ai/paired";
import { type VoiceLike, pickVoice, voiceBase } from "./voices";

const CACHE = "oofr2-voices";
// Marks the Mac's voices in the list (and in the saved choice).
export const MAC_VOICE = "mac:";

export interface RemoteUtterance {
  text: string;
  lang: string;
  voice: SpeechSynthesisVoice | null;
  rate: number;
  pitch: number;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}

export function remoteUtterance(text: string): RemoteUtterance {
  return { text, lang: "fr-FR", voice: null, rate: 1, pitch: 1, onend: null, onerror: null };
}

// A cache address per voice, speed and sentence (only a key; nothing is fetched from it).
async function cacheKey(voice: string, rate: number, text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${voice}|${rate}|${text}`));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${location.origin}/__oofr_voice__/${hex}`;
}

// A sliver of silence played on the first tap, so later sentences may start on their own (iPhone).
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export class RemoteSynth {
  pending = false;
  private macVoices: SpeechSynthesisVoice[] = [];
  private listeners = new Set<() => void>();
  private number = 0;
  private audio: HTMLAudioElement | null = typeof Audio === "undefined" ? null : new Audio();
  // "audio" while a Mac (or kept) recording plays, "web" while the browser voice speaks.
  private mode: "audio" | "web" | "" = "";
  private audioPaused = false;
  private queue: { text: string; voice: string; rate: number }[] = [];
  private prefetching = false;

  constructor(private readonly web: SpeechSynthesis | undefined = globalThis.speechSynthesis) {
    web?.addEventListener?.("voiceschanged", () => this.notify());
    // A new connection may bring other voices: fetch them again before the next sentence.
    onPairedMac(() => {
      this.macVoices = [];
      void this.macVoicesReady();
    });
    if (typeof document !== "undefined") {
      const unlock = () => {
        if (!this.audio || this.mode) return;
        this.audio.src = SILENCE;
        void this.audio.play().then(() => this.audio?.pause(), () => undefined);
      };
      document.addEventListener("pointerdown", unlock, { once: true, capture: true });
    }
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  private voicesLoading: Promise<void> | null = null;

  // The Mac's voices, fetched once per connection before its first sentence.
  private macVoicesReady(): Promise<void> {
    if (this.macVoices.length || !pairedMac()) return Promise.resolve();
    this.voicesLoading ??= this.loadMacVoices().finally(() => {
      this.voicesLoading = null;
    });
    return this.voicesLoading;
  }

  private async loadMacVoices(): Promise<void> {
    const mac = pairedMac();
    let voices: MacVoice[] = [];
    try {
      voices = mac ? await mac.voices() : [];
    } catch {
      voices = [];
    }
    // Only voices better than the browser's basic ones are worth the trip.
    this.macVoices = voices.map((voice) => ({ name: voice.name, lang: voice.lang, voiceURI: `${MAC_VOICE}${voice.name}`, localService: false, default: false }) as SpeechSynthesisVoice);
    this.notify();
  }

  get speaking(): boolean {
    return this.mode === "audio" ? true : this.mode === "web" ? Boolean(this.web?.speaking) : false;
  }

  get paused(): boolean {
    return this.mode === "audio" ? this.audioPaused : Boolean(this.web?.paused);
  }

  getVoices(): SpeechSynthesisVoice[] {
    return [...this.macVoices, ...(this.web?.getVoices() ?? [])];
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === "voiceschanged") this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === "voiceschanged") this.listeners.delete(listener);
  }

  // The Mac voice to ask for: the chosen one when it is a Mac voice, else the Mac's best for the language.
  private macVoiceFor(voice: SpeechSynthesisVoice | null, lang: string): string {
    if (voice?.voiceURI?.startsWith(MAC_VOICE)) return voice.name;
    const sameLanguage = this.macVoices.filter((item) => item.lang.slice(0, 2) === lang.slice(0, 2));
    const base = voice ? voiceBase(voice as VoiceLike) : "";
    return (sameLanguage.find((item) => voiceBase(item as VoiceLike) === base && /enhanced|premium/i.test(item.name)) ?? pickVoice(sameLanguage))?.name ?? "";
  }

  private async kept(voice: string, rate: number, text: string): Promise<Blob | null> {
    try {
      const cache = await caches.open(CACHE);
      const found = await cache.match(await cacheKey(voice, rate, text));
      return found ? await found.blob() : null;
    } catch {
      return null;
    }
  }

  private async fetchFromMac(voice: string, rate: number, text: string): Promise<Blob | null> {
    const mac = pairedMac();
    if (!mac || !voice) return null;
    try {
      const audio = await mac.speech(text, voice, rate);
      try {
        const cache = await caches.open(CACHE);
        await cache.put(await cacheKey(voice, rate, text), new Response(audio, { headers: { "Content-Type": audio.type } }));
      } catch {
        // No room to keep it: it still plays now.
      }
      return audio;
    } catch {
      return null;
    }
  }

  // The audio for a sentence: kept on the phone, or read by the paired Mac now.
  private async audioFor(utterance: RemoteUtterance): Promise<Blob | null> {
    await Promise.race([this.macVoicesReady(), new Promise((resolve) => setTimeout(resolve, 3000))]);
    const voice = this.macVoiceFor(utterance.voice, utterance.lang);
    if (!voice) return null;
    return (await this.kept(voice, utterance.rate, utterance.text)) ?? (await this.fetchFromMac(voice, utterance.rate, utterance.text));
  }

  // While the Mac is connected, the coming sentences are fetched and kept one by one.
  prefetch(texts: string[], voice: SpeechSynthesisVoice | null, lang: string, rate: number): void {
    if (!pairedMac()) return;
    void this.macVoicesReady().then(() => {
      const name = this.macVoiceFor(voice, lang);
      if (!name) return;
      this.queue = texts.map((text) => ({ text, voice: name, rate }));
      this.runQueue();
    });
  }

  private runQueue(): void {
    if (this.prefetching) return;
    this.prefetching = true;
    void (async () => {
      while (this.queue.length && pairedMac()) {
        const next = this.queue.shift()!;
        if (!(await this.kept(next.voice, next.rate, next.text))) await this.fetchFromMac(next.voice, next.rate, next.text);
      }
      this.prefetching = false;
    })();
  }

  speak(utterance: RemoteUtterance): void {
    const number = (this.number += 1);
    this.mode = "audio";
    this.audioPaused = false;
    void this.audioFor(utterance).then((blob) => {
      if (number !== this.number) return;
      const audio = this.audio;
      if (!blob || !audio) return this.speakWithBrowser(utterance, number);
      const url = URL.createObjectURL(blob);
      const done = (finish: () => void) => {
        URL.revokeObjectURL(url);
        if (number !== this.number) return;
        this.mode = "";
        finish();
      };
      audio.onended = () => done(() => utterance.onend?.());
      audio.onerror = () => done(() => this.speakWithBrowser(utterance, number));
      audio.src = url;
      if (!this.audioPaused) void audio.play().catch(() => done(() => this.speakWithBrowser(utterance, number)));
    });
  }

  private speakWithBrowser(utterance: RemoteUtterance, number: number): void {
    if (number !== this.number) return;
    if (!this.web) {
      this.mode = "";
      utterance.onerror?.({ error: "voice-unavailable" });
      return;
    }
    this.mode = "web";
    const spoken = new SpeechSynthesisUtterance(utterance.text);
    spoken.lang = utterance.lang;
    spoken.rate = utterance.rate;
    // A Mac voice cannot speak here: the browser's voice of the same name (or its best) does.
    const webVoices = this.web.getVoices();
    const chosen = utterance.voice && webVoices.includes(utterance.voice) ? utterance.voice : pickVoice(webVoices.filter((voice) => voice.lang.slice(0, 2) === utterance.lang.slice(0, 2)));
    if (chosen) spoken.voice = chosen;
    spoken.onend = () => {
      if (number === this.number) this.mode = "";
      utterance.onend?.();
    };
    spoken.onerror = (event) => {
      if (number === this.number) this.mode = "";
      utterance.onerror?.({ error: event.error });
    };
    this.web.speak(spoken);
  }

  cancel(): void {
    this.number += 1;
    this.mode = "";
    this.audioPaused = false;
    this.audio?.pause();
    this.web?.cancel();
  }

  pause(): void {
    if (this.mode === "audio") {
      this.audioPaused = true;
      this.audio?.pause();
    } else this.web?.pause();
  }

  resume(): void {
    if (this.mode === "audio") {
      this.audioPaused = false;
      void this.audio?.play().catch(() => undefined);
    } else this.web?.resume();
  }
}
