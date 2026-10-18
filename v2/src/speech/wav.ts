// Joins the learner's recordings into one WAV file to keep or share.
// Recordings come as MP4 (iPhone) or WebM (Chrome); WAV plays everywhere.

// 16-bit mono PCM WAV.
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  });
  return new Blob([buffer], { type: "audio/wav" });
}

// Linear resampling of one channel to the target rate.
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const length = Math.max(1, Math.round((samples.length * to) / from));
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = (index * from) / to;
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    output[index] = samples[left] + (samples[right] - samples[left]) * (position - left);
  }
  return output;
}

// Takes in order with a short silence between them, at 22 kHz mono (about 2.6 MB a minute).
export async function mergeRecordings(blobs: Blob[], gapSeconds = 0.6, sampleRate = 22050): Promise<{ wav: Blob; skipped: number }> {
  const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error("这个浏览器不能合并录音");
  const context = new AudioContextClass();
  const parts: Float32Array[] = [];
  let skipped = 0;
  try {
    for (const blob of blobs) {
      try {
        const audio = await context.decodeAudioData(await blob.arrayBuffer());
        const mono = new Float32Array(audio.length);
        for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
          const data = audio.getChannelData(channel);
          for (let index = 0; index < data.length; index += 1) mono[index] += data[index] / audio.numberOfChannels;
        }
        parts.push(resample(mono, audio.sampleRate, sampleRate), new Float32Array(Math.round(gapSeconds * sampleRate)));
      } catch {
        skipped += 1;
      }
    }
  } finally {
    void context.close?.();
  }
  if (!parts.length) throw new Error("录音无法解码，合并失败");
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return { wav: encodeWav(joined, sampleRate), skipped };
}
