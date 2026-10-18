// The overall comment after shadowing a lesson, from the latest take of each sentence.

import type { Material } from "../db/types";

export interface ShadowReport {
  read: number;
  total: number;
  average: number | null;
  comment: string;
  // Words the recogniser did not hear right, most frequent first.
  missedWords: { word: string; count: number }[];
  // Sentences worth saving for review: the weakest first.
  weakSentences: number[];
}

export const WEAK_SCORE = 0.85;

export function buildShadowReport(material: Material): ShadowReport {
  const total = material.sentences.length;
  const read = material.sentences.filter((sentence) => sentence.recordingKey).length;
  const scored = material.sentences.map((sentence, index) => ({ index, score: sentence.shadow?.score })).filter((item): item is { index: number; score: number } => typeof item.score === "number");
  const average = scored.length ? scored.reduce((sum, item) => sum + item.score, 0) / scored.length : null;

  const counts = new Map<string, { word: string; count: number }>();
  for (const sentence of material.sentences) {
    for (const word of sentence.shadow?.missed ?? []) {
      const key = word.toLocaleLowerCase("fr-FR");
      const entry = counts.get(key) ?? { word, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
  }
  const missedWords = [...counts.values()].sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)).slice(0, 12);
  const weakSentences = scored.filter((item) => item.score < WEAK_SCORE).sort((a, b) => a.score - b.score).map((item) => item.index);

  let comment: string;
  if (!read) comment = "还没有跟读录音，先读一句试试吧。";
  else if (average === null) comment = `读了 ${read} 句。这台设备不能自动打分，回放自己的录音和原声比一比吧。`;
  else if (average >= 0.95) comment = "读得非常清楚，几乎每个词都读准了！可以试试把语速调快一点。";
  else if (average >= WEAK_SCORE) comment = "读得很好，只有少数词需要再听听原声。";
  else if (average >= 0.7) comment = "不错！还有一些词不太准，把下面这几个词多听几遍再跟读。";
  else comment = "先多听几遍原声，放慢语速再跟读，很快会进步。";
  if (read && read < total) comment += `还有 ${total - read} 句没读。`;
  return { read, total, average, comment, missedWords, weakSentences };
}
