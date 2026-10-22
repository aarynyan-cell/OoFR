import { useEffect, useState, useSyncExternalStore } from "react";
import { onPairedMac } from "../ai/state";
import { db } from "../db/database";
import { getSettings, markFinished, markStudiedToday, setPosition } from "../db/repo";
import type { Material, Settings } from "../db/types";
import { type PlayerState, keepSpeechForLater, loadVoices, player, prefetchSpeech, sentenceAudio, speechEngine } from "../speech/player";
import { connectMediaControls } from "../speech/mediaControls";
import { type Track, buildTrack } from "../speech/track";
import { pickVoice } from "../speech/voices";
import { stopRecordingAudio } from "./recordings";
import { toast } from "./toast";

let voices: SpeechSynthesisVoice[] = [];
const voiceListeners = new Set<() => void>();

function refreshVoices(): void {
  void loadVoices(speechEngine()).then((list) => {
    voices = list;
    voiceListeners.forEach((listener) => listener());
  });
}

if (typeof window !== "undefined" && speechEngine()) {
  refreshVoices();
  speechEngine()!.addEventListener?.("voiceschanged", refreshVoices);
  // A voice downloaded in system settings shows up when the learner comes back.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshVoices();
  });
}

if (typeof navigator !== "undefined") connectMediaControls(navigator.mediaSession, player);

// Whenever the phone reaches the Mac, the Mac's voice for every French sentence
// in the library is kept on the phone (a little at a time, after the open
// lesson), so the better voice still plays once the Mac is gone.
async function keepLibrarySpeech(): Promise<void> {
  const [materials, settings] = await Promise.all([db.materials.toArray(), getSettings()]);
  const texts = [...new Set(materials.filter((material) => material.language !== "en").flatMap((material) => material.sentences.map((sentence) => sentence.text)))];
  if (texts.length) keepSpeechForLater(texts, pickVoice(voices, settings.voice), "fr-FR", settings.rate);
}

if (typeof window !== "undefined") onPairedMac(() => void keepLibrarySpeech());

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

function options(settings: Settings, mode: "all" | "one" = "all") {
  return { rate: settings.rate, repeat: settings.repeat, gapMs: settings.gapMs, mode, voice: pickVoice(voices, settings.voice) };
}

// Remembers where the learner is while a lesson plays (sentence by sentence or as a track).
let stopFollowing: (() => void) | null = null;
function followPosition(material: Material, key: string, from: number): void {
  stopFollowing?.();
  let lastIndex = from;
  const unsubscribe = player.subscribe(() => {
    const state = player.getState();
    if (state.key !== key || state.status === "idle") {
      unsubscribe();
      if (stopFollowing === unsubscribe) stopFollowing = null;
      return;
    }
    if (state.index >= 0 && state.index !== lastIndex) {
      lastIndex = state.index;
      void setPosition(material.id, state.index);
    }
  });
  stopFollowing = unsubscribe;
}

// 后台播放: each lesson's track, made once and kept while the lesson and the
// reading settings stay the same (the last two lessons).
const tracks = new Map<string, Promise<Track | null>>();
const readyTracks = new Map<string, Track>();
const TRACKS_KEPT = 2;
// A track that became ready while the lesson was paused: the next 播放 uses it.
let waitingTrack: { key: string; track: Track; onLoop: () => void } | null = null;
const noTrackNoted = new Set<string>();

const trackKey = (material: Material, settings: Settings) => [material.id, material.updatedAt, settings.voice, settings.rate, settings.repeat, settings.gapMs].join("|");

function trackFor(material: Material, settings: Settings): Promise<Track | null> {
  const key = trackKey(material, settings);
  let pending = tracks.get(key);
  if (pending) return pending;
  pending = (async () => {
    const voice = pickVoice(voices, settings.voice);
    const lang = material.language === "en" ? "en-US" : "fr-FR";
    const audios: Blob[] = [];
    for (const sentence of material.sentences) {
      const audio = await sentenceAudio(sentence.text, voice, lang, settings.rate);
      // A sentence without the Mac's voice (not kept, Mac not connected): no track this time.
      if (!audio) return null;
      audios.push(audio);
    }
    return buildTrack(audios, { repeat: settings.repeat, gapMs: settings.gapMs });
  })().catch(() => null);
  tracks.set(key, pending);
  void pending.then((track) => {
    if (track) readyTracks.set(key, track);
    else tracks.delete(key);
  });
  while (tracks.size > TRACKS_KEPT) {
    const [oldest, old] = tracks.entries().next().value as [string, Promise<Track | null>];
    tracks.delete(oldest);
    readyTracks.delete(oldest);
    void old.then((track) => track && URL.revokeObjectURL(track.url));
  }
  return pending;
}

// Plays a lesson from one sentence on, round and round until paused, remembering where the learner is.
export function playMaterial(material: Material, startIndex: number, settings: Settings): void {
  const key = materialKey(material);
  stopRecordingAudio();
  const items = material.sentences.map((sentence) => ({ text: sentence.text, lang: material.language === "en" ? "en-US" : "fr-FR" }));
  void markStudiedToday();
  void setPosition(material.id, startIndex);
  if (typeof MediaMetadata !== "undefined" && navigator.mediaSession) navigator.mediaSession.metadata = new MediaMetadata({ title: material.title, artist: import.meta.env.DEV ? "OoFR 测试版" : "OoFR 法语磁带" });
  // The Mac app (and a phone paired with it) prepares the coming sentences while one plays.
  const lang = material.language === "en" ? "en-US" : "fr-FR";
  prefetchSpeech([...items.slice(startIndex), ...items.slice(0, startIndex)].map((item) => item.text), pickVoice(voices, settings.voice), lang, settings.rate);
  followPosition(material, key, startIndex);
  const onLoop = () => void markFinished(material.id);
  waitingTrack = null;

  if (settings.backgroundPlay) {
    // Still inside the tap: the track may start later without another one.
    player.unlockTrack();
    const ready = readyTracks.get(trackKey(material, settings));
    if (ready) {
      const state = player.getState();
      if (state.key === key && state.background && state.status === "playing") player.skipTo(startIndex);
      else player.playTrack(key, ready, startIndex, onLoop);
      return;
    }
    // Plays sentence by sentence now and moves to the track once it is ready.
    void trackFor(material, settings).then((track) => {
      const state = player.getState();
      if (state.key !== key || state.background) return;
      if (!track) {
        if (!noTrackNoted.has(material.id)) {
          noTrackNoted.add(material.id);
          toast("后台播放要用电脑朗读的声音：连上电脑后打开一次这课，之后锁屏也能接着播放");
        }
        return;
      }
      if (state.status === "playing") player.playTrack(key, track, Math.max(0, state.index), onLoop);
      else if (state.status === "paused") waitingTrack = { key, track, onLoop };
    });
  }

  void player.play(key, items, startIndex, { ...options(settings), loop: true }, onLoop);
}

// Opening a lesson: the Mac app, or a phone paired with it, prepares its sentences' audio
// (a phone keeps them, so they also play later without the Mac).
export function prepareLessonSpeech(material: Material, settings: Settings, from = 0): void {
  const texts = material.sentences.map((sentence) => sentence.text);
  prefetchSpeech([...texts.slice(from), ...texts.slice(0, from)], pickVoice(voices, settings.voice), material.language === "en" ? "en-US" : "fr-FR", settings.rate);
  // 后台播放: the lesson's track is made ahead, so 播放 can start with it.
  if (settings.backgroundPlay) void trackFor(material, settings);
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
  else if (state.status === "paused" && waitingTrack?.key === state.key && !state.background) {
    // 后台播放: the track got ready during the pause, so playing on uses it.
    const { key, track, onLoop } = waitingTrack;
    waitingTrack = null;
    player.unlockTrack();
    player.playTrack(key, track, Math.max(0, state.index), onLoop);
  } else if (state.status === "paused") player.resume();
}
