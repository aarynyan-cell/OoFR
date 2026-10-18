// Records the learner's voice with the browser's MediaRecorder (free, on device).
// The microphone is released as soon as a take ends.

export interface Take {
  blob: Blob;
  durationMs: number;
  mimeType: string;
}

export interface RecordingSession {
  stop(): Promise<Take>;
  cancel(): void;
}

// iPhone records AAC in MP4; Chrome and Firefox record Opus in WebM.
const MIME_TYPES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];

export class RecorderError extends Error {}

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
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    throw new RecorderError(name === "NotAllowedError" ? "需要允许使用麦克风：请在浏览器或系统设置里打开" : name === "NotFoundError" ? "没有找到麦克风" : "麦克风打不开，请稍后再试");
  }
  const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported?.(type));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  const startedAt = performance.now();
  recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
  const release = () => stream.getTracks().forEach((track) => track.stop());
  const finished = new Promise<Take>((resolve, reject) => {
    recorder.onstop = () => {
      release();
      const type = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunks, { type });
      if (!blob.size) reject(new RecorderError("没有录到声音，请再试一次"));
      else resolve({ blob, durationMs: Math.round(performance.now() - startedAt), mimeType: type });
    };
    recorder.onerror = () => {
      release();
      reject(new RecorderError("录音中断了，请再试一次"));
    };
  });
  recorder.start();
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

// Loudness bars for the waveform under a take (empty when the audio cannot be decoded).
export async function waveform(blob: Blob, bars = 36): Promise<number[]> {
  const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return [];
  const context = new AudioContextClass();
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    const data = audio.getChannelData(0);
    const size = Math.max(1, Math.floor(data.length / bars));
    const peaks = Array.from({ length: bars }, (_, bar) => {
      let peak = 0;
      for (let index = bar * size; index < Math.min(data.length, (bar + 1) * size); index += 1) peak = Math.max(peak, Math.abs(data[index]));
      return peak;
    });
    const loudest = Math.max(...peaks, 0.001);
    return peaks.map((peak) => peak / loudest);
  } catch {
    return [];
  } finally {
    void context.close?.();
  }
}
