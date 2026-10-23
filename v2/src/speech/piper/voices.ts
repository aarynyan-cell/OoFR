// The phone's own voices (3.0): which Piper voices there are, where their
// files come from, and what the page and the engine worker say to each other.

// Every file the voices need, kept across app updates (like the dictionary).
export const VOICE_CACHE = "oofr3-piper";

// The engine's own files are served with the app (./voice-engine/, outside the
// offline shell so only learners who use these voices download them).
export const ENGINE_SIZES = { ortWasm: 14239897, phonemizeJs: 120714, phonemizeWasm: 635212, phonemizeData: 18077249 };
export const ENGINE_BYTES = Object.values(ENGINE_SIZES).reduce((sum, size) => sum + size, 0);

const MODELS = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/fr/fr_FR";

export type LocalVoiceId = "siwis" | "tom";

export interface LocalVoice {
  name: string;
  gender: string;
  model: string;
  modelBytes: number;
  speaker?: number;
}

export const VOICES: Record<LocalVoiceId, LocalVoice> = {
  siwis: { name: "Siwis", gender: "女声", model: `${MODELS}/siwis/medium/fr_FR-siwis-medium.onnx`, modelBytes: 63201294 },
  tom: { name: "Tom", gender: "男声", model: `${MODELS}/tom/medium/fr_FR-tom-medium.onnx`, modelBytes: 63511038 }
};

export const LOCAL_VOICE_IDS = Object.keys(VOICES) as LocalVoiceId[];

export interface EngineFiles {
  ortWasm: string;
  phonemizeJs: string;
  phonemizeWasm: string;
  phonemizeData: string;
}

export type ToEngine =
  | { t: "setup"; engine: EngineFiles }
  | { t: "stored"; id: number; voice: LocalVoiceId }
  | { t: "download"; id: number; voice: LocalVoiceId }
  | { t: "speak"; id: number; voice: LocalVoiceId; text: string; speed: number };

export type FromEngine =
  | { t: "stored"; id: number; stored: boolean }
  | { t: "progress"; voice: LocalVoiceId; loaded: number; total: number }
  | { t: "downloaded"; id: number }
  | { t: "audio"; id: number; pcm: Float32Array; rate: number; ms: number }
  | { t: "error"; id: number; message: string };
