// Sentence-by-sentence speech playback on the system voice (free, offline).
// Carries over the fixes 1.0 needed for real devices:
//  - cancel() before a new run, and resume() in case the engine stayed paused;
//  - a fallback timer because Chrome sometimes never fires "end";
//  - engines that implement pause() as cancel() (Chrome on Android, some iOS
//    versions) end the sentence early: after resume it is spoken again;
//  - three failures in a row stop playback with a clear message.

import { nativeSynth, nativeUtterance } from "./native";
import { RemoteSynth, remoteUtterance } from "./remote";
import { type Track, partAt } from "./track";

export interface PlayItem {
  text: string;
  lang: string;
}

export interface PlayOptions {
  rate: number;
  repeat: number;
  gapMs: number;
  // "all": play to the end; "one": keep repeating the starting sentence.
  mode: "all" | "one";
  // "all" only: start again from the first sentence after the last one.
  loop?: boolean;
  voice: SpeechSynthesisVoice | null;
}

export interface PlayerState {
  status: "idle" | "playing" | "paused";
  key: string;
  index: number;
  message: string;
  // 后台播放: the lesson plays as one track (keeps going with the phone locked).
  background?: boolean;
}

type Outcome = { status: "ended" | "cancelled" | "error"; error?: string };

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "请先点一下播放按钮，浏览器才允许朗读",
  "audio-busy": "扬声器正被其他应用占用",
  "audio-hardware": "找不到可用的扬声器",
  "voice-unavailable": "这台设备没有可用的法语声音",
  "language-unavailable": "这台设备没有法语朗读声音"
};

const IDLE: PlayerState = { status: "idle", key: "", index: -1, message: "", background: false };

// A sliver of silence played inside the tap that starts playback, so a track
// may start later without another tap (iPhone).
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export class SpeechPlayer {
  private state: PlayerState = IDLE;
  private listeners = new Set<() => void>();
  private runToken = 0;
  private current: SpeechSynthesisUtterance | null = null;
  // 后台播放: one audio element for lesson tracks, and the track playing in it.
  private trackAudio: HTMLAudioElement | null = null;
  private track: Track | null = null;

  constructor(
    private readonly getSynth: () => SpeechSynthesis | undefined = () => globalThis.speechSynthesis,
    private readonly makeUtterance: (text: string) => SpeechSynthesisUtterance = (text) => new SpeechSynthesisUtterance(text)
  ) {}

  get supported(): boolean {
    return Boolean(this.getSynth());
  }

  getState = (): PlayerState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(next: Partial<PlayerState>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
  }

  async play(key: string, items: PlayItem[], startIndex: number, options: PlayOptions, onFinish?: () => void): Promise<void> {
    const synth = this.getSynth();
    if (!synth) {
      this.set({ ...IDLE, message: "这个浏览器不支持朗读" });
      return;
    }
    const token = ++this.runToken;
    this.endTrack();
    synth.cancel();
    if (synth.paused) synth.resume();
    this.set({ status: "playing", key, index: startIndex, message: "", background: false });

    let failures = 0;
    let message = "";
    let finished = false;
    try {
      let index = startIndex;
      run: while (index >= 0 && index < items.length) {
        this.set({ index });
        for (let round = 0; round < Math.max(1, options.repeat); round += 1) {
          if (token !== this.runToken) break run;
          const outcome = await this.speakSentence(items[index], options, token);
          if (token !== this.runToken) break run;
          if (outcome.status === "cancelled") {
            message = "朗读被系统打断，已停止";
            break run;
          }
          if (outcome.status === "error") {
            failures += 1;
            if (failures >= 3) {
              message = ERROR_MESSAGES[outcome.error ?? ""] ?? "朗读连续失败，已停止";
              break run;
            }
          } else {
            failures = 0;
          }
          await this.wait(options.gapMs, token);
        }
        if (options.mode === "all") index += 1;
        // The lesson plays round until the learner pauses.
        if (options.loop && index >= items.length && token === this.runToken) {
          onFinish?.();
          index = 0;
        }
      }
      finished = token === this.runToken && !message;
    } finally {
      if (token === this.runToken) {
        this.current = null;
        // Done: the engine lets go of its audio, so the phone's Dynamic Island and lock screen clear.
        synth.cancel();
        this.set({ ...IDLE, message });
      }
    }
    if (finished) onFinish?.();
  }

  pause(): void {
    if (this.state.status !== "playing") return;
    if (this.track) {
      this.trackAudio?.pause();
      this.set({ status: "paused" });
      return;
    }
    const synth = this.getSynth();
    if (!synth) return;
    synth.pause();
    this.set({ status: "paused" });
  }

  resume(): void {
    if (this.state.status !== "paused") return;
    if (this.track) {
      this.set({ status: "playing" });
      void this.trackAudio?.play().catch(() => this.pause());
      return;
    }
    const synth = this.getSynth();
    if (!synth) return;
    this.set({ status: "playing" });
    synth.resume();
  }

  stop(): void {
    this.runToken += 1;
    this.endTrack();
    this.getSynth()?.cancel();
    this.current = null;
    this.set(IDLE);
  }

  // Called inside the tap that starts a lesson, so its track can start later on its own.
  unlockTrack(): void {
    const audio = this.trackElement();
    if (!audio || audio.src) return;
    audio.src = SILENCE;
    void audio.play().catch(() => undefined);
  }

  // 后台播放: plays a lesson's track from a sentence, round and round until paused.
  playTrack(key: string, track: Track, startIndex: number, onLoop?: () => void): void {
    const audio = this.trackElement();
    if (!audio) return;
    const token = ++this.runToken;
    this.getSynth()?.cancel();
    this.current = null;
    this.endTrack();
    this.track = track;
    const start = track.parts[Math.max(0, Math.min(startIndex, track.parts.length - 1))]?.start ?? 0;
    let last = start;
    audio.loop = true;
    audio.ontimeupdate = () => {
      if (token !== this.runToken) return;
      // Back at the start: the lesson went round once more.
      if (audio.currentTime + 1 < last) onLoop?.();
      last = audio.currentTime;
      const index = partAt(track.parts, audio.currentTime);
      if (index >= 0 && index !== this.state.index) this.set({ index });
    };
    audio.onerror = () => {
      if (token !== this.runToken) return;
      this.endTrack();
      this.set({ ...IDLE, message: "后台播放的音频出错了，已停止" });
    };
    audio.src = track.url;
    audio.defaultPlaybackRate = track.playbackRate ?? 1;
    audio.playbackRate = track.playbackRate ?? 1;
    audio.preservesPitch = true;
    // The position can be set once the browser knows the length.
    const seek = () => {
      audio.currentTime = start;
    };
    if (audio.readyState >= 1) seek();
    else audio.addEventListener("loadedmetadata", seek, { once: true });
    this.set({ status: "playing", key, index: startIndex, message: "", background: true });
    void audio.play().catch(() => {
      if (token !== this.runToken) return;
      this.endTrack();
      this.set({ ...IDLE, message: ERROR_MESSAGES["not-allowed"] });
    });
  }

  // 后台播放: moves to another sentence of the playing track (also from the lock screen).
  skipTo(index: number): boolean {
    const track = this.track;
    const audio = this.trackAudio;
    if (!track || !audio || this.state.status === "idle") return false;
    const part = track.parts[Math.max(0, Math.min(index, track.parts.length - 1))];
    audio.currentTime = part.start;
    this.set({ index: part.index });
    return true;
  }

  private trackElement(): HTMLAudioElement | null {
    if (!this.trackAudio && typeof Audio !== "undefined") this.trackAudio = new Audio();
    return this.trackAudio;
  }

  // Lets go of the track, so the phone's media controls clear (the track's file stays with its maker).
  private endTrack(): void {
    if (!this.track) return;
    this.track = null;
    const audio = this.trackAudio;
    if (!audio) return;
    audio.pause();
    audio.ontimeupdate = null;
    audio.onerror = null;
    audio.removeAttribute("src");
    audio.load();
  }

  private async speakSentence(item: PlayItem, options: PlayOptions, token: number): Promise<Outcome> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const outcome = await this.speakOnce(item, options, token);
      if (token !== this.runToken) return outcome;
      if (outcome.status !== "ended" && this.state.status === "paused") {
        await this.waitWhilePaused(token);
        if (token !== this.runToken) return outcome;
        continue;
      }
      return outcome;
    }
    return { status: "error", error: "retry-limit" };
  }

  private speakOnce(item: PlayItem, options: PlayOptions, token: number): Promise<Outcome> {
    const synth = this.getSynth();
    return new Promise((resolve) => {
      if (!synth || token !== this.runToken) {
        resolve({ status: "cancelled" });
        return;
      }
      const utterance = this.makeUtterance(item.text);
      utterance.lang = options.voice?.lang || item.lang;
      if (options.voice) utterance.voice = options.voice;
      utterance.rate = options.rate;
      utterance.pitch = 1;

      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (outcome: Outcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.current === utterance) this.current = null;
        resolve(outcome);
      };
      utterance.onend = () => finish({ status: "ended" });
      utterance.onerror = (event) => {
        const reason = String(event?.error || "");
        finish({ status: reason === "canceled" || reason === "interrupted" ? "cancelled" : "error", error: reason });
      };

      const estimate = Math.max(2400, (item.text.length * 95) / Math.max(0.5, options.rate) + 1600);
      let extended = false;
      const fallback = (delay: number) => {
        timer = setTimeout(() => {
          if (token !== this.runToken) return finish({ status: "cancelled" });
          // Paused, or the engine is still fetching this sentence's audio: keep waiting.
          if (this.state.status === "paused" || (synth as { pending?: boolean }).pending) return fallback(estimate);
          if (synth.speaking && !extended) {
            extended = true;
            return fallback(3000);
          }
          if (synth.speaking) synth.cancel();
          finish({ status: "ended" });
        }, delay);
      };
      fallback(estimate);

      // Keep a reference: Chrome can garbage-collect a speaking utterance and drop its events.
      this.current = utterance;
      synth.speak(utterance);
    });
  }

  private waitWhilePaused(token: number): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (token !== this.runToken || this.state.status !== "paused") resolve();
        else setTimeout(check, 120);
      };
      check();
    });
  }

  private wait(ms: number, token: number): Promise<void> {
    return new Promise((resolve) => {
      let remaining = ms;
      let last = Date.now();
      const tick = () => {
        if (token !== this.runToken) return resolve();
        const now = Date.now();
        if (this.state.status !== "paused") remaining -= now - last;
        last = now;
        if (remaining <= 0) return resolve();
        setTimeout(tick, Math.min(120, remaining));
      };
      tick();
    });
  }
}

// In the Mac app, the Mac's own voices. In a browser, the paired Mac's voices as
// audio when it is connected (or kept from before), else the browser's own.
const native = nativeSynth();
const remote = !native && typeof window !== "undefined" && globalThis.speechSynthesis ? new RemoteSynth() : null;
export const player = native
  ? new SpeechPlayer(() => native as unknown as SpeechSynthesis, (text) => nativeUtterance(text) as unknown as SpeechSynthesisUtterance)
  : remote
    ? new SpeechPlayer(() => remote as unknown as SpeechSynthesis, (text) => remoteUtterance(text) as unknown as SpeechSynthesisUtterance)
    : new SpeechPlayer();

export function speechEngine(): SpeechSynthesis | undefined {
  return ((native ?? remote) as unknown as SpeechSynthesis | null) ?? globalThis.speechSynthesis;
}

// The Mac app and a paired phone fetch the coming sentences' audio while one plays.
export function prefetchSpeech(texts: string[], voice: SpeechSynthesisVoice | null, lang: string, rate: number): void {
  (native ?? remote)?.prefetch(texts, voice, lang, rate);
}

// One sentence's audio in the Mac's voice (the Mac app renders it; a phone has
// it kept or asks the paired Mac), or null where there is none (browser voices
// cannot be recorded). 后台播放 joins these into a track.
export async function sentenceAudio(text: string, voice: SpeechSynthesisVoice | null, lang: string, rate: number): Promise<Blob | null> {
  if (native) return native.audioBlob(text, voice, lang, rate);
  if (remote) return remote.audioBlob(text, voice, lang, rate);
  return null;
}

// The speed a sentence's audio from sentenceAudio() plays at: Gemini's is read
// at its own speed and played at the learner's; the Mac reads at the speed asked.
export function speechPlaybackRate(voice: SpeechSynthesisVoice | null, lang: string, rate: number): number {
  return remote ? remote.playbackRateFor(voice, lang, rate) : 1;
}

// A phone paired with the Mac keeps the whole library's audio, after whatever is being prepared now.
export function keepSpeechForLater(texts: string[], voice: SpeechSynthesisVoice | null, lang: string, rate: number): void {
  remote?.prefetch(texts, voice, lang, rate, true);
}

// Voices arrive asynchronously on most engines.
export function loadVoices(synth: SpeechSynthesis | undefined = globalThis.speechSynthesis, timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  if (!synth) return Promise.resolve([]);
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener?.("voiceschanged", done);
      clearTimeout(timer);
      resolve(synth.getVoices());
    };
    const timer = setTimeout(done, timeoutMs);
    synth.addEventListener?.("voiceschanged", done);
  });
}
