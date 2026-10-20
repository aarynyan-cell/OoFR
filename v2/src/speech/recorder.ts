// Records the learner's voice with the browser's MediaRecorder (free, on device).
// The microphone is released as soon as a take ends.

import { devLog } from "../app/devlog";
import { decodeAudio } from "./decode";

export interface Take {
  blob: Blob;
  durationMs: number;
  mimeType: string;
}

export interface RecordingSession {
  stop(): Promise<Take>;
  cancel(): void;
}

// With the phone's voice processing: without it an iPhone records about 15
// times quieter (tried on a real iPhone: takes were hard to hear).
const MICROPHONE: MediaStreamConstraints = { audio: { echoCancellation: true, noiseSuppression: true } };

// iPhone records AAC in MP4; Chrome and Firefox record Opus in WebM.
const MIME_TYPES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];

export class RecorderError extends Error {
  // The microphone was on but gave no sound at all.
  silent = false;
}

export function recordingProblem(): string {
  if (typeof window === "undefined") return "这个环境不能录音";
  if (!window.isSecureContext) return "录音需要正式的 https 网址，本地测试地址不支持";
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return "这个浏览器不支持录音";
  return "";
}

export async function startRecording(maxMs = 20000): Promise<RecordingSession> {
  const problem = recordingProblem();
  if (problem) throw new RecorderError(problem);
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(MICROPHONE);
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    throw new RecorderError(name === "NotAllowedError" ? "需要允许使用麦克风：请在浏览器或系统设置里打开" : name === "NotFoundError" ? "没有找到麦克风" : "麦克风打不开，请稍后再试");
  }
  const startedAt = performance.now();
  // A microphone still held by the last take can come back muted: wait a moment, then ask again once.
  const track = stream.getAudioTracks()[0];
  devLog("mic", { muted: track?.muted, state: track?.readyState, label: track?.label, session: (navigator as { audioSession?: { type?: string } }).audioSession?.type, echo: track?.getSettings?.().echoCancellation });
  if (track?.muted) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 800);
      track.addEventListener("unmute", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
    devLog("mic-was-muted", { stillMuted: track.muted });
    if (track.muted) {
      stream.getTracks().forEach((item) => item.stop());
      stream = await navigator.mediaDevices.getUserMedia(MICROPHONE);
      devLog("mic-again", { muted: stream.getAudioTracks()[0]?.muted });
    }
  }
  const recording = stream.getAudioTracks()[0];
  if (import.meta.env.DEV && recording) {
    for (const name of ["mute", "unmute", "ended"]) recording.addEventListener(name, () => devLog(`track-${name}`, { ms: Math.round(performance.now() - startedAt) }));
  }
  const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported?.(type));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
  const release = () => stream.getTracks().forEach((track) => track.stop());
  const finished = new Promise<Take>((resolve, reject) => {
    recorder.onstop = () => {
      release();
      const type = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunks, { type });
      devLog("take", { size: blob.size, chunks: chunks.length, ms: Math.round(performance.now() - startedAt), type, muted: recording?.muted });
      if (import.meta.env.DEV && blob.size) void loudness(blob).then((level) => devLog("take-loudness", { level }));
      if (!blob.size) {
        const error = new RecorderError("没有录到声音，请再试一次");
        error.silent = true;
        reject(error);
      } else resolve({ blob, durationMs: Math.round(performance.now() - startedAt), mimeType: type });
    };
    recorder.onerror = (event) => {
      devLog("recorder-error", { error: (event as unknown as { error?: { name?: string } }).error?.name });
      release();
      reject(new RecorderError("录音中断了，请再试一次"));
    };
  });
  // Small slices: a take keeps whatever was recorded even if the engine stops early.
  recorder.start(250);
  const limit = setTimeout(() => recorder.state === "recording" && recorder.stop(), maxMs);
  return {
    stop() {
      clearTimeout(limit);
      if (recorder.state === "recording") recorder.stop();
      return finished;
    },
    cancel() {
      clearTimeout(limit);
      finished.catch(() => {});
      if (recorder.state === "recording") recorder.stop();
      else release();
    }
  };
}

// How loud the loudest moment of a take is (0 = silence; test versions only).
async function loudness(blob: Blob): Promise<number> {
  const audio = await decodeAudio(blob);
  if (!audio) return -1;
  const data = audio.getChannelData(0);
  let peak = 0;
  for (let index = 0; index < data.length; index += 1) peak = Math.max(peak, Math.abs(data[index]));
  return Math.round(peak * 1000) / 1000;
}

// Loudness bars for the waveform under a take (empty when the audio cannot be decoded).
export async function waveform(blob: Blob, bars = 36): Promise<number[]> {
  const audio = await decodeAudio(blob);
  if (!audio) return [];
  const data = audio.getChannelData(0);
  const size = Math.max(1, Math.floor(data.length / bars));
  const peaks = Array.from({ length: bars }, (_, bar) => {
    let peak = 0;
    for (let index = bar * size; index < Math.min(data.length, (bar + 1) * size); index += 1) peak = Math.max(peak, Math.abs(data[index]));
    return peak;
  });
  const loudest = Math.max(...peaks, 0.001);
  return peaks.map((peak) => peak / loudest);
}
