import { useEffect, useState, useSyncExternalStore } from "react";
import { markFinished, markStudiedToday, setPosition } from "../db/repo";
import type { Material, Settings } from "../db/types";
import { type PlayerState, loadVoices, player } from "../speech/player";
import { pickVoice } from "../speech/voices";
import { stopRecordingAudio } from "./recordings";

let voices: SpeechSynthesisVoice[] = [];
const voiceListeners = new Set<() => void>();

function refreshVoices(): void {
  void loadVoices().then((list) => {
    voices = list;
    voiceListeners.forEach((listener) => listener());
  });
}

if (typeof window !== "undefined" && globalThis.speechSynthesis) {
  refreshVoices();
  globalThis.speechSynthesis.addEventListener?.("voiceschanged", refreshVoices);
}

export function useVoices(): SpeechSynthesisVoice[] {
  const [list, setList] = useState(voices);
  useEffect(() => {
    const update = () => setList(voices);
    voiceListeners.add(update);
    update();
    return () => {
      voiceListeners.delete(update);
    };
  }, []);
  return list;
}

export function usePlayer(): PlayerState {
  return useSyncExternalStore(player.subscribe, player.getState, player.getState);
}

export const materialKey = (material: Material) => `material:${material.id}`;

function options(settings: Settings, mode = settings.playMode) {
  return { rate: settings.rate, repeat: settings.repeat, gapMs: settings.gapMs, mode, voice: pickVoice(voices, settings.voice) };
}

// Plays a lesson from one sentence on, remembering where the learner is.
export function playMaterial(material: Material, startIndex: number, settings: Settings): void {
  const key = materialKey(material);
  stopRecordingAudio();
  const items = material.sentences.map((sentence) => ({ text: sentence.text, lang: material.language === "en" ? "en-US" : "fr-FR" }));
  void markStudiedToday();
  void setPosition(material.id, startIndex);
  let lastIndex = startIndex;
  const unsubscribe = player.subscribe(() => {
    const state = player.getState();
    if (state.key !== key) return;
    if (state.index >= 0 && state.index !== lastIndex) {
      lastIndex = state.index;
      void setPosition(material.id, state.index);
    }
  });
  void player
    .play(key, items, startIndex, options(settings), () => {
      if (settings.playMode === "all") void markFinished(material.id);
    })
    .finally(unsubscribe);
}

// A single sentence or word, outside a lesson run (词句本, word card, review).
export function speakOnce(text: string, settings: Settings, language: "fr" | "en" = "fr", key = `once:${text}`): void {
  stopRecordingAudio();
  void player.play(key, [{ text, lang: language === "en" ? "en-US" : "fr-FR" }], 0, { ...options(settings, "all"), repeat: 1 });
}

// One button that plays a sentence, pauses it, and resumes it.
export function toggleSpeech(key: string, text: string, settings: Settings, language: "fr" | "en" = "fr"): void {
  const state = player.getState();
  if (state.key === key && state.status === "playing") player.pause();
  else if (state.key === key && state.status === "paused") player.resume();
  else speakOnce(text, settings, language, key);
}

export function togglePause(): void {
  const state = player.getState();
  if (state.status === "playing") player.pause();
  else if (state.status === "paused") player.resume();
}
