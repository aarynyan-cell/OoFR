// The page's side of the phone's own voices (3.0): downloads a voice once,
// then reads sentences in the engine worker, one at a time, the sentence the
// learner asks for before the ones being prepared in the background.

import { useSyncExternalStore } from "react";
// The runtime's own bundle emits this file too; importing its address keeps one copy.
import ortWasm from "../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import { encodeWav } from "../wav";
import { type EngineFiles, type FromEngine, LOCAL_VOICE_IDS, type LocalVoiceId, type ToEngine, VOICES, VOICE_CACHE } from "./voices";

export const LOCAL_VOICE = "local:";

export interface LocalVoicesState {
  stored: LocalVoiceId[];
  downloading: { voice: LocalVoiceId; loaded: number; total: number } | null;
  error: string;
}

interface Job {
  voice: LocalVoiceId;
  text: string;
  speed: number;
  resolve: (audio: Blob) => void;
  reject: (error: Error) => void;
}

function engineFiles(): EngineFiles {
  const at = (name: string) => new URL(`./voice-engine/${name}`, document.baseURI).href;
  return { ortWasm: new URL(ortWasm, document.baseURI).href, phonemizeJs: at("piper_phonemize.js"), phonemizeWasm: at("piper_phonemize.wasm"), phonemizeData: at("piper_phonemize.data") };
}

export class LocalVoices {
  private state: LocalVoicesState = { stored: [], downloading: null, error: "" };
  private listeners = new Set<() => void>();
  private worker: Worker | null = null;
  private number = 0;
  private replies = new Map<number, (message: FromEngine) => void>();
  private jobs: Job[] = [];
  private working = false;
  private pending = new Map<string, Promise<Blob>>();

  constructor() {
    void this.checkStored();
  }

  getState = (): LocalVoicesState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(next: Partial<LocalVoicesState>): void {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
  }

  // Which voices have every file kept on this device.
  async checkStored(): Promise<void> {
    if (typeof caches === "undefined" || typeof document === "undefined") return;
    try {
      const cache = await caches.open(VOICE_CACHE);
      const engine = Object.values(engineFiles());
      const stored: LocalVoiceId[] = [];
      for (const voice of LOCAL_VOICE_IDS) {
        const files = [...engine, VOICES[voice].model, `${VOICES[voice].model}.json`];
        if ((await Promise.all(files.map((file) => cache.match(file)))).every(Boolean)) stored.push(voice);
      }
      this.set({ stored });
    } catch {
      // No Cache Storage here (a private window): these voices are not offered.
    }
  }

  private engine(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (event: MessageEvent<FromEngine>) => {
        const message = event.data;
        if (message.t === "progress") {
          this.set({ downloading: { voice: message.voice, loaded: message.loaded, total: message.total } });
          return;
        }
        this.replies.get(message.id)?.(message);
        this.replies.delete(message.id);
      };
      this.send({ t: "setup", engine: engineFiles() });
    }
    return this.worker;
  }

  private send(message: ToEngine): void {
    this.engine().postMessage(message);
  }

  private ask(make: (id: number) => ToEngine): Promise<FromEngine> {
    const id = (this.number += 1);
    return new Promise((resolve) => {
      this.replies.set(id, resolve);
      this.send(make(id));
    });
  }

  async download(voice: LocalVoiceId): Promise<void> {
    if (this.state.downloading) return;
    this.set({ downloading: { voice, loaded: 0, total: 0 }, error: "" });
    const reply = await this.ask((id) => ({ t: "download", id, voice }));
    this.set({ downloading: null, error: reply.t === "error" ? `下载没有完成：${reply.message}` : "" });
    await this.checkStored();
    // Downloaded but not kept (no Cache Storage here): usable until the page closes.
    if (reply.t === "downloaded" && !this.has(voice)) this.set({ stored: [...this.state.stored, voice] });
  }

  has(voice: string): voice is LocalVoiceId {
    return this.state.stored.includes(voice as LocalVoiceId);
  }

  // One sentence's audio; `urgent` (the learner is waiting) goes before what is being prepared.
  speak(voice: LocalVoiceId, text: string, speed: number, urgent: boolean): Promise<Blob> {
    const key = `${voice}|${speed}|${text}`;
    const under = this.pending.get(key);
    if (under) {
      // Asked for now while it waits in the background queue: move it to the front.
      if (urgent) {
        const at = this.jobs.findIndex((job) => `${job.voice}|${job.speed}|${job.text}` === key);
        if (at > 0) this.jobs.unshift(...this.jobs.splice(at, 1));
      }
      return under;
    }
    const audio = new Promise<Blob>((resolve, reject) => {
      const job = { voice, text, speed, resolve, reject };
      if (urgent) this.jobs.unshift(job);
      else this.jobs.push(job);
    });
    this.pending.set(key, audio);
    void audio.finally(() => this.pending.delete(key)).catch(() => undefined);
    this.work();
    return audio;
  }

  // Background sentences of a lesson the learner has left.
  dropBackground(keep: (text: string) => boolean): void {
    const dropped = this.jobs.filter((job) => !keep(job.text));
    this.jobs = this.jobs.filter((job) => keep(job.text));
    dropped.forEach((job) => job.reject(new Error("dropped")));
  }

  private work(): void {
    if (this.working) return;
    const job = this.jobs.shift();
    if (!job) return;
    this.working = true;
    void this.ask((id) => ({ t: "speak", id, voice: job.voice, text: job.text, speed: job.speed })).then((reply) => {
      this.working = false;
      if (reply.t === "audio") job.resolve(encodeWav(reply.pcm, reply.rate));
      else job.reject(new Error(reply.t === "error" ? reply.message : "没有读出来"));
      this.work();
    });
  }
}

export const localVoices = new LocalVoices();

export function useLocalVoices(): LocalVoicesState {
  return useSyncExternalStore(localVoices.subscribe, localVoices.getState, localVoices.getState);
}
