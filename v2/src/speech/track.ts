// 后台播放: a whole lesson as one piece of audio. A phone keeps playing audio
// when it is locked or another app is open, but not the sentence-by-sentence
// player, which needs the page between sentences. So each sentence's audio
// (the Mac's voice) is decoded and joined, with the repeats and the pauses,
// into one WAV that plays round and round; `parts` say which sentence is when.

import { decodeAudio } from "./decode";
import { encodeWav } from "./wav";

export interface TrackPart {
  index: number;
  // Seconds into the track: the sentence's first reading to the end of its last pause.
  start: number;
  end: number;
}

export interface Track {
  url: string;
  parts: TrackPart[];
  duration: number;
}

export interface TrackOptions {
  repeat: number;
  gapMs: number;
  // The Mac's voices are 22 kHz: more would only make the file bigger.
  sampleRate?: number;
}

// Null when a sentence's audio cannot be decoded.
export async function buildTrack(audios: Blob[], { repeat, gapMs, sampleRate = 22050 }: TrackOptions): Promise<Track | null> {
  const pieces: Float32Array[] = [];
  const parts: TrackPart[] = [];
  const gap = new Float32Array(Math.round((gapMs / 1000) * sampleRate));
  let length = 0;
  for (const [index, blob] of audios.entries()) {
    const audio = await decodeAudio(blob, sampleRate);
    if (!audio) return null;
    const samples = audio.getChannelData(0);
    const start = length / sampleRate;
    for (let round = 0; round < Math.max(1, repeat); round += 1) {
      pieces.push(samples, gap);
      length += samples.length + gap.length;
    }
    parts.push({ index, start, end: length / sampleRate });
  }
  if (!parts.length) return null;
  const joined = new Float32Array(length);
  let offset = 0;
  for (const piece of pieces) {
    joined.set(piece, offset);
    offset += piece.length;
  }
  return { url: URL.createObjectURL(encodeWav(joined, sampleRate)), parts, duration: length / sampleRate };
}

// The sentence playing at a moment of the track.
export function partAt(parts: TrackPart[], seconds: number): number {
  const part = parts.find((item) => seconds >= item.start && seconds < item.end);
  return part ? part.index : parts.length ? parts[parts.length - 1].index : -1;
}
