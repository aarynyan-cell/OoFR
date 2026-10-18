// Turning pasted text into sentences. Ported from OoFR 1.0 (app.js splitCourseTurns
// and friends) so lessons split the same way they always have.

export type MaterialType = "情景对话" | "文章" | "歌词" | "笔记" | "自定义文本";
export const MATERIAL_TYPES: MaterialType[] = ["情景对话", "文章", "歌词", "笔记", "自定义文本"];

export interface SplitSentence {
  text: string;
  speakerId?: string;
  speakerLabel?: string;
}

const SPEAKER_LINE = /^([^:：]{1,24})\s*[:：]\s*(.+)$/u;

export function normalizeWord(word: string): string {
  return String(word || "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[’]/g, "'")
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}'\-]/gu, "")
    .replace(/^['-]+|['-]+$/g, "");
}

// Same as 1.0, plus one fix: French puts a space before closing guillemets
// ("« Oui. »"), which 1.0 split off into the next sentence.
export function splitSentenceChunks(value: string): string[] {
  const source = String(value || "").replace(/\s+/g, " ").trim();
  if (!source) return [];
  const chunks = source.match(/[^.!?。！？]+(?:[.!?。！？]+(?:[”’"'»)]| [»”])*|$)/gu) || [source];
  return chunks.map((chunk) => chunk.trim()).filter(Boolean);
}

function lines(text: string): string[] {
  return String(text || "").replace(/\r\n?/g, "\n").split("\n");
}

export function detectDialogue(text: string): boolean {
  const labels = lines(text)
    .map((line) => line.trim().match(SPEAKER_LINE))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => normalizeWord(match[1]));
  return labels.length >= 2 && new Set(labels.filter(Boolean)).size >= 2;
}

export function inferMaterialType(text: string): MaterialType {
  if (detectDialogue(text)) return "情景对话";
  const sentenceCount = lines(text).flatMap(splitSentenceChunks).length;
  return String(text || "").length > 240 || sentenceCount >= 4 ? "文章" : "笔记";
}

export function speakerIdFor(label: string): string {
  const normalized = normalizeWord(label);
  if (/^[a-z]$/.test(normalized)) return normalized;
  if (/^(b|alex|teacher|landlord|friend|assistant|对方|乙)$/.test(normalized)) return "b";
  return "a";
}

export function splitSentences(text: string, materialType?: MaterialType | ""): SplitSentence[] {
  const source = lines(text)
    .flatMap((line) => (line.trim() ? [line.trim()] : []))
    .flatMap((line) => (line.includes("\t") ? line.split("\t") : [line]));
  const isDialogue = materialType === "情景对话" || (!materialType && detectDialogue(text));
  return source
    .flatMap((line): SplitSentence[] => {
      const match = isDialogue ? line.match(SPEAKER_LINE) : null;
      if (match) {
        const label = match[1].trim();
        return splitSentenceChunks(match[2]).map((sentence) => ({ text: sentence, speakerLabel: label, speakerId: speakerIdFor(label) }));
      }
      return splitSentenceChunks(line).map((sentence) => ({ text: sentence }));
    })
    .filter((item) => item.text);
}

export function countSpeakers(sentences: SplitSentence[]): number {
  return new Set(sentences.map((item) => item.speakerLabel).filter(Boolean)).size;
}

const FRENCH_HINTS = /\b(le|la|les|des|une?|je|tu|il|elle|nous|vous|est|et|pas|que|qui|pour|avec|dans|sur|bonjour|merci|c'est|j'ai|ça)\b|[àâçéèêëîïôûùüÿœ]/giu;
const ENGLISH_HINTS = /\b(the|and|is|are|you|to|of|in|that|it|with|for|this|have|what|hello|thanks)\b/giu;

// A rough guess, only used to pre-fill the language chip; the learner can change it.
export function guessLanguage(text: string): "fr" | "en" {
  const french = (text.match(FRENCH_HINTS) || []).length;
  const english = (text.match(ENGLISH_HINTS) || []).length;
  return english > french * 1.5 ? "en" : "fr";
}
