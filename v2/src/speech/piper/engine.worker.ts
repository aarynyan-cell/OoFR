// The phone's own natural French voices (3.0): Piper voice models
// (rhasspy/piper, MIT) run here, in a worker, so reading never stalls the page.
// Text → phonemes (espeak-ng compiled to WebAssembly) → the voice model (ONNX
// Runtime, WebAssembly) → PCM. Every file is kept in Cache Storage the first
// time, so after the one download it works offline and needs no one else.

import * as ort from "onnxruntime-web/wasm";
import { ENGINE_SIZES, type EngineFiles, type FromEngine, type LocalVoiceId, type ToEngine, VOICES, VOICE_CACHE } from "./voices";

const scope = self as unknown as { postMessage(message: FromEngine, transfer?: Transferable[]): void; onmessage: ((event: MessageEvent<ToEngine>) => void) | null };
const post = (message: FromEngine, transfer: Transferable[] = []) => scope.postMessage(message, transfer);

interface VoiceConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  speaker_id_map: Record<string, number>;
}

type Phonemizer = (module: Record<string, unknown>) => Promise<{ callMain(args: string[]): void }>;

let engine: EngineFiles | null = null;
let phonemizer: { create: Phonemizer; wasm: WebAssembly.Module; data: ArrayBuffer } | null = null;
let ortReady: Promise<void> | null = null;
const sessions = new Map<string, Promise<{ session: ort.InferenceSession; config: VoiceConfig }>>();

// Where Cache Storage is refused (some test addresses), files stay in memory for this visit.
const memory = new Map<string, ArrayBuffer>();

async function openCache(): Promise<Cache | null> {
  try {
    return await caches.open(VOICE_CACHE);
  } catch {
    return null;
  }
}

// A file from the cache, or downloaded (with progress) and kept.
async function cached(url: string, onProgress?: (loaded: number) => void): Promise<ArrayBuffer> {
  const remembered = memory.get(url);
  if (remembered) return remembered;
  const cache = await openCache();
  const found = await cache?.match(url);
  if (found) return found.arrayBuffer();
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`下载失败（${response.status}）`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded);
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  try {
    if (!cache) throw new Error("no cache");
    await cache.put(url, new Response(bytes, { headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/octet-stream" } }));
  } catch {
    memory.set(url, bytes.buffer);
  }
  return bytes.buffer;
}

async function isCached(url: string): Promise<boolean> {
  if (memory.has(url)) return true;
  return Boolean(await (await openCache())?.match(url));
}

function filesOf(voice: LocalVoiceId): string[] {
  if (!engine) throw new Error("engine not set");
  const model = VOICES[voice].model;
  return [engine.ortWasm, engine.phonemizeJs, engine.phonemizeWasm, engine.phonemizeData, model, `${model}.json`];
}

async function loadOrt(): Promise<void> {
  ortReady ??= (async () => {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmBinary = await cached(engine!.ortWasm);
  })();
  return ortReady;
}

async function loadPhonemizer(): Promise<NonNullable<typeof phonemizer>> {
  if (phonemizer) return phonemizer;
  const [script, wasm, data] = await Promise.all([cached(engine!.phonemizeJs), cached(engine!.phonemizeWasm), cached(engine!.phonemizeData)]);
  // An Emscripten build that declares `var createPiperPhonemize`.
  const create = new Function(`${new TextDecoder().decode(script)}\nreturn createPiperPhonemize;`)() as Phonemizer;
  phonemizer = { create, wasm: await WebAssembly.compile(wasm), data };
  return phonemizer;
}

// Phoneme ids for one sentence (the build runs its main() once per instance).
async function phonemes(text: string, espeakVoice: string): Promise<number[]> {
  const { create, wasm, data } = await loadPhonemizer();
  return new Promise((resolve, reject) => {
    let done = false;
    void create({
      print: (line: string) => {
        if (done) return;
        try {
          done = true;
          resolve((JSON.parse(line) as { phoneme_ids: number[] }).phoneme_ids);
        } catch (error) {
          reject(error);
        }
      },
      printErr: () => undefined,
      instantiateWasm: (imports: WebAssembly.Imports, success: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) => {
        void WebAssembly.instantiate(wasm, imports).then((instance) => success(instance, wasm));
        return {};
      },
      // The espeak-ng data, fetched once (the build only reads it).
      getPreloadedPackage: () => data,
      locateFile: (name: string) => name
    })
      .then((module) => module.callMain(["-l", espeakVoice, "--input", JSON.stringify([{ text }]), "--espeak_data", "/espeak-ng-data"]))
      .catch(reject);
  });
}

function sessionFor(voice: LocalVoiceId): Promise<{ session: ort.InferenceSession; config: VoiceConfig }> {
  const model = VOICES[voice].model;
  let pending = sessions.get(model);
  if (!pending) {
    pending = (async () => {
      await loadOrt();
      const config = JSON.parse(new TextDecoder().decode(await cached(`${model}.json`))) as VoiceConfig;
      const session = await ort.InferenceSession.create(new Uint8Array(await cached(model)), { executionProviders: ["wasm"] });
      return { session, config };
    })();
    pending.catch(() => sessions.delete(model));
    sessions.set(model, pending);
  }
  return pending;
}

async function speak(voice: LocalVoiceId, text: string, speed: number): Promise<{ pcm: Float32Array; rate: number }> {
  const { session, config } = await sessionFor(voice);
  const ids = await phonemes(text, config.espeak.voice);
  const feeds: Record<string, ort.Tensor> = {
    input: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]),
    input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
    // Slower or faster by stretching the phonemes (the voice keeps its pitch).
    scales: new ort.Tensor("float32", Float32Array.from([config.inference.noise_scale, config.inference.length_scale / Math.max(0.5, speed), config.inference.noise_w]), [3])
  };
  if (Object.keys(config.speaker_id_map).length) feeds.sid = new ort.Tensor("int64", BigInt64Array.from([BigInt(VOICES[voice].speaker ?? 0)]), [1]);
  const output = await session.run(feeds);
  return { pcm: new Float32Array(output.output.data as Float32Array), rate: config.audio.sample_rate };
}

// Downloads what is not kept yet, reporting the bytes of this download.
async function download(voice: LocalVoiceId): Promise<void> {
  const files = filesOf(voice);
  const expected = [ENGINE_SIZES.ortWasm, ENGINE_SIZES.phonemizeJs, ENGINE_SIZES.phonemizeWasm, ENGINE_SIZES.phonemizeData, VOICES[voice].modelBytes, 5000];
  const missing: number[] = [];
  for (const [index, file] of files.entries()) if (!(await isCached(file))) missing.push(index);
  const total = missing.reduce((sum, index) => sum + expected[index], 0);
  let before = 0;
  for (const index of missing) {
    await cached(files[index], (loaded) => post({ t: "progress", voice, loaded: before + loaded, total }));
    before += expected[index];
  }
}

scope.onmessage = (event) => {
  const message = event.data;
  if (message.t === "setup") {
    engine = message.engine;
    return;
  }
  if (message.t === "stored") {
    void (async () => {
      const results = await Promise.all(filesOf(message.voice).map(isCached));
      post({ t: "stored", id: message.id, stored: results.every(Boolean) });
    })().catch(() => post({ t: "stored", id: message.id, stored: false }));
    return;
  }
  if (message.t === "download") {
    void download(message.voice)
      .then(() => post({ t: "downloaded", id: message.id }))
      .catch((error: unknown) => post({ t: "error", id: message.id, message: error instanceof Error ? error.message : String(error) }));
    return;
  }
  if (message.t === "speak") {
    const started = performance.now();
    void speak(message.voice, message.text, message.speed)
      .then(({ pcm, rate }) => post({ t: "audio", id: message.id, pcm, rate, ms: Math.round(performance.now() - started) }, [pcm.buffer]))
      .catch((error: unknown) => post({ t: "error", id: message.id, message: error instanceof Error ? error.message : String(error) }));
  }
};
