// Picks the best French voice this device offers, so nobody has to dig through
// a list of 40 voices. Pure functions: easy to test with any voice list.

export interface VoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
}

export type VoiceQuality = "premium" | "enhanced" | "natural" | "standard" | "novelty";

// iOS/macOS joke and robot voices (Eloquence) exist in every language; never pick them.
const NOVELTY = /\b(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|fred|junior|kathy|ralph)\b/i;

export function voiceId(voice: VoiceLike): string {
  return `${voice.name}|${voice.lang}`;
}

export function isFrench(voice: VoiceLike): boolean {
  return /^fr([-_]|$)/i.test(voice.lang);
}

export function voiceQuality(voice: VoiceLike): VoiceQuality {
  const name = voice.name;
  if (NOVELTY.test(name)) return "novelty";
  if (/premium/i.test(name)) return "premium";
  if (/enhanced|amélioré/i.test(name)) return "enhanced";
  if (/natural|neural|online|google/i.test(name)) return "natural";
  return "standard";
}

const QUALITY_SCORE: Record<VoiceQuality, number> = { premium: 50, enhanced: 40, natural: 35, standard: 0, novelty: -100 };

export function scoreVoice(voice: VoiceLike): number {
  let score = QUALITY_SCORE[voiceQuality(voice)];
  const lang = voice.lang.replace("_", "-").toLowerCase();
  if (lang === "fr-fr") score += 20;
  else if (isFrench(voice)) score += 10;
  if (/^(thomas|amélie|audrey|aurélie|marie|daniel|google français|microsoft (henri|denise|vivienne|remy))/i.test(voice.name)) score += 5;
  if (voice.default) score += 2;
  return score;
}

export function frenchVoices<T extends VoiceLike>(voices: T[]): T[] {
  return voices.filter(isFrench).sort((a, b) => scoreVoice(b) - scoreVoice(a) || a.name.localeCompare(b.name));
}

// The learner's choice when this device still has it, otherwise the best voice.
export function pickVoice<T extends VoiceLike>(voices: T[], saved = ""): T | null {
  const french = frenchVoices(voices);
  if (saved) {
    const chosen = french.find((voice) => voiceId(voice) === saved || voice.name === saved.split("|")[0]);
    if (chosen) return chosen;
  }
  return french.find((voice) => voiceQuality(voice) !== "novelty") ?? null;
}

export function voiceLabel(voice: VoiceLike): string {
  const quality = voiceQuality(voice);
  const tag = quality === "premium" ? " · 高品质" : quality === "enhanced" ? " · 增强版" : quality === "natural" ? " · 自然" : "";
  const region = /ca/i.test(voice.lang) ? "（加拿大）" : /be/i.test(voice.lang) ? "（比利时）" : /ch/i.test(voice.lang) ? "（瑞士）" : "";
  return `${voice.name.replace(/\s*\((premium|enhanced|amélioré[e]?)\)\s*/i, " ").trim()}${region}${tag}`;
}

// Worth telling iPhone and Mac users about: these systems ship small default
// voices and offer much better ones as a free download in system settings.
export function canDownloadBetterVoice(voices: VoiceLike[], userAgent: string): boolean {
  const apple = /iPhone|iPad|Macintosh/i.test(userAgent);
  return apple && !frenchVoices(voices).some((voice) => ["premium", "enhanced"].includes(voiceQuality(voice)));
}
