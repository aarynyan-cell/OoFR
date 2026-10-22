// Better voices for the web app. Apple lets web pages (Safari, the iPhone
// home-screen app) use only the two basic French voices, so a phone paired
// with the Mac app asks the Mac to read each sentence with its own (enhanced)
// voices and plays the audio. Audio is kept on the phone, so a sentence heard
// once also plays well later without the Mac. Without either, the browser's
// own voice reads as before. This stands in for speechSynthesis.

import { devLog } from "../app/devlog";
import { checkMacAgain, onPairedMac, pairedMac } from "../ai/state";
import type { MacVoice } from "../ai/paired";
import { type VoiceLike, pickVoice, voiceBase } from "./voices";

const CACHE = "oofr2-voices";
// The Mac's voices as last seen, so audio kept on the phone still plays after
// the Mac is gone (its cache addresses need the voice's name).
const MAC_VOICES_KEY = "oofr2.macVoices";

function rememberedMacVoices(): MacVoice[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(MAC_VOICES_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((voice): voice is MacVoice => typeof voice?.name === "string" && typeof voice?.lang === "string") : [];
  } catch {
    return [];
  }
}

function rememberMacVoices(voices: MacVoice[]): void {
  try {
    localStorage.setItem(MAC_VOICES_KEY, JSON.stringify(voices.map(({ name, lang }) => ({ name, lang }))));
  } catch {
    // Only a convenience: without it, kept audio plays once the Mac is back.
  }
}

const asVoice = (voice: MacVoice) => ({ name: voice.name, lang: voice.lang, voiceURI: `${MAC_VOICE}${voice.name}`, localService: false, default: false }) as SpeechSynthesisVoice;
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

// A sliver of silence played inside the tap that starts playback, so the
// sentences that follow may start on their own (iPhone).
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export class RemoteSynth {
  pending = false;
  private macVoices: SpeechSynthesisVoice[] = [];
  private listeners = new Set<() => void>();
  private number = 0;
  // "audio" while a Mac (or kept) recording plays, "web" while the browser voice speaks.
  private mode: "audio" | "web" | "" = "";
  private audioPaused = false;
  private unlocked = false;
  private queue: { text: string; voice: string; rate: number }[] = [];
  private laterQueue: { text: string; voice: string; rate: number }[] = [];
  private prefetching = false;
  // The sentence whose audio is playing (or waiting for resume).
  private current: { url: string; utterance: RemoteUtterance; number: number } | null = null;

  constructor(
    private readonly web: SpeechSynthesis | undefined = globalThis.speechSynthesis,
    private readonly audio: HTMLAudioElement | null = typeof Audio === "undefined" ? null : new Audio()
  ) {
    this.macVoices = rememberedMacVoices().map(asVoice);
    web?.addEventListener?.("voiceschanged", () => this.notify());
    // A new connection may bring other voices: ask again before the next sentence.
    onPairedMac(() => {
      this.voicesAsked = false;
      void this.macVoicesReady();
    });
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  private voicesLoading: Promise<void> | null = null;
  // Whether this connection's Mac has been asked for its voices yet.
  private voicesAsked = false;

  // The Mac's voices, asked once per connection before its first sentence.
  private macVoicesReady(): Promise<void> {
    if (this.voicesAsked || !pairedMac()) return Promise.resolve();
    this.voicesLoading ??= this.loadMacVoices().finally(() => {
      this.voicesLoading = null;
    });
    return this.voicesLoading;
  }

  private async loadMacVoices(): Promise<void> {
    const mac = pairedMac();
    if (!mac) return;
    let voices: MacVoice[];
    try {
      voices = await mac.voices();
    } catch {
      // Not answered: keep the voices known from before.
      return;
    }
    this.voicesAsked = true;
    rememberMacVoices(voices);
    this.macVoices = voices.map(asVoice);
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
      // The connection may be gone (phone locked, network changed): look for the Mac again.
      checkMacAgain();
      return null;
    }
  }

  // The audio for a sentence: kept on the phone, or read by the paired Mac now.
  protected async audioFor(utterance: RemoteUtterance): Promise<Blob | null> {
    await Promise.race([this.macVoicesReady(), new Promise((resolve) => setTimeout(resolve, 3000))]);
    const voice = this.macVoiceFor(utterance.voice, utterance.lang);
    if (!voice) return null;
    const kept = await this.kept(voice, utterance.rate, utterance.text);
    if (kept) return kept;
    const started = Date.now();
    const fetched = await this.fetchFromMac(voice, utterance.rate, utterance.text);
    devLog("voice-from-mac", { ok: Boolean(fetched), ms: Date.now() - started, queued: this.queue.length, prefetching: this.prefetching });
    return fetched;
  }

  // One sentence's audio in the Mac's voice: kept on the phone, or from the Mac now (for 后台播放's track).
  audioBlob(text: string, voice: SpeechSynthesisVoice | null, lang: string, rate: number): Promise<Blob | null> {
    return this.audioFor({ ...remoteUtterance(text), voice, lang, rate });
  }

  // While the Mac is connected, the coming sentences are fetched and kept one by
  // one; `later` ones (the rest of the library) wait until those are done.
  prefetch(texts: string[], voice: SpeechSynthesisVoice | null, lang: string, rate: number, later = false): void {
    if (!pairedMac()) return;
    void this.macVoicesReady().then(() => {
      const name = this.macVoiceFor(voice, lang);
      if (!name) return;
      const items = texts.map((text) => ({ text, voice: name, rate }));
      if (later) this.laterQueue = items;
      else this.queue = items;
      this.runQueue();
    });
  }

  private runQueue(): void {
    if (this.prefetching) return;
    this.prefetching = true;
    void (async () => {
      while ((this.queue.length || this.laterQueue.length) && pairedMac()) {
        const next = (this.queue.length ? this.queue : this.laterQueue).shift()!;
        if (!(await this.kept(next.voice, next.rate, next.text))) await this.fetchFromMac(next.voice, next.rate, next.text);
      }
      this.prefetching = false;
    })();
  }

  speak(utterance: RemoteUtterance): void {
    const number = (this.number += 1);
    this.mode = "audio";
    this.audioPaused = false;
    this.pending = true;
    this.dropCurrent();
    // Still inside the learner's tap the first time: start the element now, so
    // the sentence can play when its audio arrives.
    if (this.audio && !this.unlocked) {
      this.unlocked = true;
      this.audio.src = SILENCE;
      void this.audio.play().catch(() => undefined);
    }
    const asked = Date.now();
    void this.audioFor(utterance).then((blob) => {
      devLog("voice", { words: utterance.text.split(/\s+/).length, audio: Boolean(blob), ms: Date.now() - asked, current: number === this.number });
      if (number !== this.number) return;
      this.pending = false;
      if (!blob || !this.audio) return this.speakWithBrowser(utterance, number);
      this.current = { url: URL.createObjectURL(blob), utterance, number };
      // Paused while the audio was on its way: it starts on resume, not before.
      if (!this.audioPaused) this.startCurrent();
    });
  }

  // Plays the current sentence's audio from its start.
  private startCurrent(): void {
    const audio = this.audio;
    const current = this.current;
    if (!audio || !current) return;
    const { url, utterance, number } = current;
    const done = (finish: () => void) => {
      if (number !== this.number) return;
      this.dropCurrent();
      this.mode = "";
      finish();
    };
    audio.onended = () => done(() => utterance.onend?.());
    audio.onerror = () => {
      devLog("voice-error", { code: audio.error?.code });
      done(() => this.speakWithBrowser(utterance, number));
    };
    audio.src = url;
    void audio.play().catch((error: unknown) => {
      // Paused or stopped before it got going: not a failure.
      if (this.audioPaused || number !== this.number) return;
      devLog("voice-play-failed", { error: error instanceof Error ? error.name : String(error) });
      done(() => this.speakWithBrowser(utterance, number));
    });
  }

  private dropCurrent(): void {
    if (this.current) URL.revokeObjectURL(this.current.url);
    this.current = null;
  }

  private speakWithBrowser(utterance: RemoteUtterance, number: number): void {
    if (number !== this.number) return;
    this.pending = false;
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

  // Nothing left for the system's media controls (Dynamic Island, lock screen) to start again.
  private release(): void {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.onended = null;
    this.audio.onerror = null;
    this.audio.removeAttribute("src");
    this.audio.load();
  }

  cancel(): void {
    this.number += 1;
    this.mode = "";
    this.pending = false;
    this.audioPaused = false;
    this.release();
    this.dropCurrent();
    this.web?.cancel();
  }

  // A paused sentence leaves nothing in the phone's media player, so the
  // Dynamic Island and lock screen have nothing to show or start on their own;
  // the sentence plays again from its start on resume.
  pause(): void {
    if (this.mode === "audio") this.audioPaused = true;
    // The iPhone's speech often ignores pause(): stop it for sure; the player
    // reads the sentence again on resume.
    else if (this.mode === "web") this.web?.cancel();
    this.release();
  }

  resume(): void {
    if (this.mode !== "audio") return;
    this.audioPaused = false;
    if (!this.pending) this.startCurrent();
  }
}
