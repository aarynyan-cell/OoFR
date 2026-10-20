// The Mac app reads aloud with the Mac's own voices (desktop/src-tauri: tts_*),
// because its web view only offers web pages the two basic French voices. Each
// sentence is rendered to audio by the Mac and played here; the coming sentences
// are rendered while one plays. This stands in for speechSynthesis, so the
// player works the same everywhere.

import { tauri } from "../ai/backend";
import { pickVoice } from "./voices";

interface SystemVoice {
  name: string;
  lang: string;
  voiceUri: string;
  localService: boolean;
}

export interface NativeUtterance {
  text: string;
  lang: string;
  voice: SpeechSynthesisVoice | null;
  rate: number;
  pitch: number;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}

export function nativeUtterance(text: string): NativeUtterance {
  return { text, lang: "fr-FR", voice: null, rate: 1, pitch: 1, onend: null, onerror: null };
}

type App = NonNullable<ReturnType<typeof tauri>>;

const CACHE_LIMIT = 400;

export class NativeSynth {
  speaking = false;
  paused = false;
  pending = false;
  private voices: SpeechSynthesisVoice[] = [];
  private listeners = new Set<() => void>();
  // Each sentence gets a number; a newer one or a stop makes older ones give up.
  private number = 0;
  // One audio element for every sentence: the web view lets an element that
  // has played once keep playing without another tap.
  private audio = typeof Audio === "undefined" ? null : new Audio();
  private rendered = new Map<string, Promise<string>>();
  private queue: { text: string; voice: string; rate: number }[] = [];
  private prefetching = false;

  constructor(private readonly app: App) {
    void this.loadVoices();
  }

  async loadVoices(): Promise<void> {
    const list = await this.app.core.invoke<SystemVoice[]>("tts_voices").catch((): SystemVoice[] => []);
    this.voices = list.map((voice) => ({ name: voice.name, lang: voice.lang, voiceURI: voice.voiceUri, localService: true, default: false }) as SpeechSynthesisVoice);
    this.listeners.forEach((listener) => listener());
  }

  getVoices(): SpeechSynthesisVoice[] {
    return this.voices;
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === "voiceschanged") this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === "voiceschanged") this.listeners.delete(listener);
  }

  private voiceFor(utterance: { voice: SpeechSynthesisVoice | null; lang: string }): string {
    return utterance.voice?.name ?? pickVoice(this.voices.filter((item) => item.lang.slice(0, 2) === utterance.lang.slice(0, 2)))?.name ?? "";
  }

  // The audio of one sentence (kept, so a sentence heard again starts at once).
  render(text: string, voice: string, rate: number): Promise<string> {
    const key = `${voice}|${rate}|${text}`;
    let pending = this.rendered.get(key);
    if (!pending) {
      pending = this.app.core.invoke<ArrayBuffer>("tts_render", { text, voice, rate }).then((bytes) => URL.createObjectURL(new Blob([bytes], { type: "audio/mp4" })));
      // A failed sentence is tried again next time.
      pending.catch(() => this.rendered.delete(key));
      this.rendered.set(key, pending);
      if (this.rendered.size > CACHE_LIMIT) {
        const [oldest, url] = this.rendered.entries().next().value as [string, Promise<string>];
        this.rendered.delete(oldest);
        void url.then((value) => URL.revokeObjectURL(value), () => undefined);
      }
    }
    return pending;
  }

  // The sentences coming up, rendered one by one while the current one plays.
  prefetch(texts: string[], voice: SpeechSynthesisVoice | null, lang: string, rate: number): void {
    const name = this.voiceFor({ voice, lang });
    this.queue = texts.map((text) => ({ text, voice: name, rate }));
    if (this.prefetching) return;
    this.prefetching = true;
    void (async () => {
      while (this.queue.length) {
        const next = this.queue.shift()!;
        await this.render(next.text, next.voice, next.rate).catch(() => undefined);
      }
      this.prefetching = false;
    })();
  }

  speak(utterance: NativeUtterance): void {
    const number = (this.number += 1);
    this.speaking = true;
    this.paused = false;
    const fail = (error: string) => {
      if (number !== this.number) return;
      this.speaking = false;
      utterance.onerror?.({ error });
    };
    this.pending = true;
    this.render(utterance.text, this.voiceFor(utterance), utterance.rate).then((url) => {
      const audio = this.audio;
      if (number !== this.number || !audio) return;
      this.pending = false;
      audio.onended = () => {
        if (number !== this.number) return;
        this.speaking = false;
        utterance.onend?.();
      };
      audio.onerror = () => fail("audio-hardware");
      audio.src = url;
      // Paused while the sentence was being rendered: it starts on resume.
      if (!this.paused) void audio.play().catch(() => fail("not-allowed"));
    }, () => {
      this.pending = false;
      fail("synthesis-failed");
    });
  }

  cancel(): void {
    this.number += 1;
    this.speaking = false;
    this.paused = false;
    this.pending = false;
    this.audio?.pause();
    this.audio?.removeAttribute("src");
  }

  pause(): void {
    if (!this.speaking) return;
    this.paused = true;
    this.audio?.pause();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    void this.audio?.play().catch(() => undefined);
  }
}

let native: NativeSynth | null = null;

// The Mac's speech in the Mac app; null in a browser.
export function nativeSynth(): NativeSynth | null {
  const app = tauri();
  if (!app) return null;
  native ??= new NativeSynth(app);
  return native;
}
