// Sentence-by-sentence speech playback on the system voice (free, offline).
// Carries over the fixes 1.0 needed for real devices:
//  - cancel() before a new run, and resume() in case the engine stayed paused;
//  - a fallback timer because Chrome sometimes never fires "end";
//  - engines that implement pause() as cancel() (Chrome on Android, some iOS
//    versions) end the sentence early: after resume it is spoken again;
//  - three failures in a row stop playback with a clear message.

import { nativeSynth, nativeUtterance } from "./native";

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
}

type Outcome = { status: "ended" | "cancelled" | "error"; error?: string };

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "请先点一下播放按钮，浏览器才允许朗读",
  "audio-busy": "扬声器正被其他应用占用",
  "audio-hardware": "找不到可用的扬声器",
  "voice-unavailable": "这台设备没有可用的法语声音",
  "language-unavailable": "这台设备没有法语朗读声音"
};

const IDLE: PlayerState = { status: "idle", key: "", index: -1, message: "" };

export class SpeechPlayer {
  private state: PlayerState = IDLE;
  private listeners = new Set<() => void>();
  private runToken = 0;
  private current: SpeechSynthesisUtterance | null = null;

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
    synth.cancel();
    if (synth.paused) synth.resume();
    this.set({ status: "playing", key, index: startIndex, message: "" });

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
        this.set({ ...IDLE, message });
      }
    }
    if (finished) onFinish?.();
  }

  pause(): void {
    const synth = this.getSynth();
    if (!synth || this.state.status !== "playing") return;
    synth.pause();
    this.set({ status: "paused" });
  }

  resume(): void {
    const synth = this.getSynth();
    if (!synth || this.state.status !== "paused") return;
    this.set({ status: "playing" });
    synth.resume();
  }

  stop(): void {
    this.runToken += 1;
    this.getSynth()?.cancel();
    this.current = null;
    this.set(IDLE);
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
          if (this.state.status === "paused") return fallback(estimate);
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

// In the Mac app, the Mac's own speech (enhanced voices); elsewhere the browser's.
const system = nativeSynth();
export const player = system
  ? new SpeechPlayer(() => system as unknown as SpeechSynthesis, (text) => nativeUtterance(text) as unknown as SpeechSynthesisUtterance)
  : new SpeechPlayer();

export function speechEngine(): SpeechSynthesis | undefined {
  return (system as unknown as SpeechSynthesis | null) ?? globalThis.speechSynthesis;
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
