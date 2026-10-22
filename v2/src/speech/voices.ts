// Picks the best French voice this device offers, so nobody has to dig through
// a list of 40 voices. Pure functions: easy to test with any voice list.

export interface VoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
  // "mac:…" for a paired Mac's voice (src/speech/remote.ts).
  voiceURI?: string;
}

const fromMac = (voice: VoiceLike) => Boolean(voice.voiceURI?.startsWith("mac:"));
// "gemini:…": an online voice read by Gemini with the learner's key (src/speech/gemini.ts).
const fromGemini = (voice: VoiceLike) => Boolean(voice.voiceURI?.startsWith("gemini:"));
const GEMINI_GENDER: Record<string, string> = { Kore: "女声", Aoede: "女声", Charon: "男声", Puck: "男声" };

export type VoiceQuality = "premium" | "enhanced" | "natural" | "standard" | "novelty";

// iOS/macOS joke and robot voices (Eloquence) exist in every language; never pick them.
const NOVELTY = /\b(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|fred|junior|kathy|ralph)\b/i;

export function voiceId(voice: VoiceLike): string {
  return `${fromMac(voice) ? "mac:" : fromGemini(voice) ? "gemini:" : ""}${voice.name}|${voice.lang}`;
}

export function isFrench(voice: VoiceLike): boolean {
  return /^fr([-_]|$)/i.test(voice.lang);
}

export function voiceQuality(voice: VoiceLike): VoiceQuality {
  if (fromGemini(voice)) return "natural";
  const name = voice.name;
  if (NOVELTY.test(name)) return "novelty";
  if (/premium/i.test(name)) return "premium";
  if (/enhanced|amélioré/i.test(name)) return "enhanced";
  if (/natural|neural|online|google/i.test(name)) return "natural";
  return "standard";
}

const QUALITY_SCORE: Record<VoiceQuality, number> = { premium: 50, enhanced: 40, natural: 35, standard: 0, novelty: -100 };

export function scoreVoice(voice: VoiceLike): number {
  // Gemini's voices come first when the learner added the key for them (Kore first).
  if (fromGemini(voice)) return 100 - Object.keys(GEMINI_GENDER).indexOf(voice.name);
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

// "Thomas (Enhanced)" → "thomas": the same voice in another quality.
export function voiceBase(voice: VoiceLike): string {
  return voice.name.replace(/\s*\((premium|enhanced|amélioré[e]?)\)\s*/i, "").trim().toLocaleLowerCase();
}

// The learner's choice when this device still has it, otherwise the best voice.
// A chosen voice is upgraded when its enhanced or premium version has been
// downloaded since ("Thomas" → "Thomas (Enhanced)").
export function pickVoice<T extends VoiceLike>(voices: T[], saved = ""): T | null {
  const french = frenchVoices(voices);
  if (saved) {
    const chosen = french.find((voice) => voiceId(voice) === saved || voice.name === saved.split("|")[0]);
    if (chosen) {
      const better = french.find((voice) => voiceBase(voice) === voiceBase(chosen) && voice.lang === chosen.lang && scoreVoice(voice) > scoreVoice(chosen));
      return better ?? chosen;
    }
  }
  return french.find((voice) => voiceQuality(voice) !== "novelty") ?? null;
}

export function voiceLabel(voice: VoiceLike): string {
  if (fromGemini(voice)) return `${voice.name} · ${GEMINI_GENDER[voice.name] ?? ""}（在线语音）`;
  const quality = voiceQuality(voice);
  const tag = quality === "premium" ? " · 高品质" : quality === "enhanced" ? " · 增强版" : quality === "natural" ? " · 自然" : "";
  const region = /ca/i.test(voice.lang) ? "（加拿大）" : /be/i.test(voice.lang) ? "（比利时）" : /ch/i.test(voice.lang) ? "（瑞士）" : "";
  return `${voice.name.replace(/\s*\((premium|enhanced|amélioré[e]?)\)\s*/i, " ").trim()}${region}${tag}${fromMac(voice) ? "（电脑朗读）" : ""}`;
}

// Worth telling iPhone and Mac users about: these systems ship small default
// voices and offer much better ones as a free download in system settings.
export function canDownloadBetterVoice(voices: VoiceLike[], userAgent: string): boolean {
  const apple = /iPhone|iPad|Macintosh/i.test(userAgent);
  return apple && !frenchVoices(voices).some((voice) => ["premium", "enhanced"].includes(voiceQuality(voice)));
}
