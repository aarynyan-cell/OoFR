import { useSyncExternalStore } from "react";
import { player } from "../speech/player";

// Playback of the learner's own recordings: one take, or every take of a lesson
// in a row. Only one sound plays at a time: this stops the speech voice, and
// starting the voice stops this (see audio.ts).

export interface RecordingPlayback {
  status: "idle" | "playing";
  key: string;
  // Which take of a sequence is playing.
  index: number;
}

const IDLE: RecordingPlayback = { status: "idle", key: "", index: -1 };
let state = IDLE;
let element: HTMLAudioElement | null = null;
let run = 0;
const listeners = new Set<() => void>();

function set(next: RecordingPlayback) {
  state = next;
  listeners.forEach((listener) => listener());
}

// Emptied, so the phone's Dynamic Island and lock screen do not keep a finished recording.
function letGo(audio: HTMLAudioElement): void {
  audio.pause();
  audio.onended = null;
  audio.onerror = null;
  URL.revokeObjectURL(audio.src);
  audio.removeAttribute("src");
  audio.load();
}

export function stopRecordingAudio(): void {
  run += 1;
  if (element) {
    letGo(element);
    element = null;
  }
  if (state.status !== "idle") set(IDLE);
}

function playOne(blob: Blob, token: number): Promise<void> {
  return new Promise((resolve) => {
    if (token !== run) return resolve();
    const audio = new Audio(URL.createObjectURL(blob));
    element = audio;
    const done = () => {
      letGo(audio);
      if (element === audio) element = null;
      resolve();
    };
    audio.onended = done;
    audio.onerror = done;
    void audio.play().catch(done);
  });
}

export async function playRecordings(key: string, blobs: Blob[], gapMs = 500): Promise<void> {
  player.stop();
  stopRecordingAudio();
  const token = run;
  for (let index = 0; index < blobs.length; index += 1) {
    if (token !== run) return;
    set({ status: "playing", key, index });
    await playOne(blobs[index], token);
    if (index < blobs.length - 1) await new Promise((resolve) => setTimeout(resolve, gapMs));
  }
  if (token === run) set(IDLE);
}

// Tapping the same control again stops it.
export function toggleRecordings(key: string, blobs: Blob[]): void {
  if (state.key === key && state.status === "playing") stopRecordingAudio();
  else void playRecordings(key, blobs);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRecordingPlayback(): RecordingPlayback {
  return useSyncExternalStore(subscribe, () => state, () => IDLE);
}
