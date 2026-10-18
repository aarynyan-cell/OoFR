// Compares what the speech recogniser heard with the sentence the learner read,
// word by word, to point at words that may not have come out right.

import { lookupText, tokenize } from "./tokens";

export interface CheckedToken {
  text: string;
  word: boolean;
  // Only for words: was it heard, and if not, what was heard in its place.
  ok?: boolean;
  heardAs?: string;
}

export interface SpeechCheck {
  tokens: CheckedToken[];
  missed: string[];
  score: number;
}

const UNITS = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize"];
const TENS: Record<number, string> = { 2: "vingt", 3: "trente", 4: "quarante", 5: "cinquante", 6: "soixante" };

// Recognisers write "dix minutes" as "10 minutes": spell numbers out to compare.
export function frenchNumber(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 9999) return String(value);
  if (value <= 16) return UNITS[value];
  if (value < 20) return `dix-${UNITS[value - 10]}`;
  if (value < 70) {
    const ten = Math.floor(value / 10);
    const unit = value % 10;
    return unit === 0 ? TENS[ten] : unit === 1 ? `${TENS[ten]} et un` : `${TENS[ten]}-${UNITS[unit]}`;
  }
  if (value < 80) return value === 71 ? "soixante et onze" : `soixante-${frenchNumber(value - 60)}`;
  if (value < 100) return value === 80 ? "quatre-vingts" : `quatre-vingt-${frenchNumber(value - 80)}`;
  if (value < 1000) {
    const hundreds = Math.floor(value / 100);
    const rest = value % 100;
    const head = hundreds === 1 ? "cent" : `${UNITS[hundreds]} cent${rest === 0 ? "s" : ""}`;
    return rest ? `${head} ${frenchNumber(rest)}` : head;
  }
  const thousands = Math.floor(value / 1000);
  const rest = value % 1000;
  const head = thousands === 1 ? "mille" : `${frenchNumber(thousands)} mille`;
  return rest ? `${head} ${frenchNumber(rest)}` : head;
}

function key(word: string): string {
  return word
    .toLocaleLowerCase("fr-FR")
    .replace(/[’]/g, "'")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function words(text: string): string[] {
  const spelled = text.replace(/\d+/g, (digits) => ` ${frenchNumber(Number(digits))} `);
  return tokenize(spelled)
    .filter((token) => token.word)
    .flatMap((token) => lookupText(token).split("-"))
    .filter(Boolean);
}

export function compareSpeech(target: string, heard: string): SpeechCheck {
  const tokens: CheckedToken[] = tokenize(target).map((token) => ({ text: token.text, word: token.word }));
  // Each target word may be several comparable pieces ("dix-sept" → dix, sept).
  const pieces: { token: number; word: string }[] = [];
  tokens.forEach((token, index) => {
    if (!token.word) return;
    lookupText({ text: token.text, word: true, occurrence: 0 })
      .split("-")
      .filter(Boolean)
      .forEach((word) => pieces.push({ token: index, word: key(word) }));
  });
  const said = words(heard).map(key);

  // Edit-distance alignment between the target pieces and the heard words.
  const rows = pieces.length;
  const cols = said.length;
  const cost: number[][] = Array.from({ length: rows + 1 }, (_, i) => Array.from({ length: cols + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= rows; i += 1) {
    for (let j = 1; j <= cols; j += 1) {
      const same = pieces[i - 1].word === said[j - 1] ? 0 : 1;
      cost[i][j] = Math.min(cost[i - 1][j - 1] + same, cost[i - 1][j] + 1, cost[i][j - 1] + 1);
    }
  }
  const heardFor = new Map<number, string>();
  const matched = new Set<number>();
  let i = rows;
  let j = cols;
  while (i > 0 && j > 0) {
    const same = pieces[i - 1].word === said[j - 1] ? 0 : 1;
    if (cost[i][j] === cost[i - 1][j - 1] + same) {
      if (same === 0) matched.add(i - 1);
      else heardFor.set(i - 1, said[j - 1]);
      i -= 1;
      j -= 1;
    } else if (cost[i][j] === cost[i - 1][j] + 1) {
      i -= 1;
    } else {
      j -= 1;
    }
  }

  const missed: string[] = [];
  tokens.forEach((token, index) => {
    if (!token.word) return;
    const own = pieces.map((piece, position) => ({ piece, position })).filter(({ piece }) => piece.token === index);
    token.ok = own.every(({ position }) => matched.has(position));
    if (!token.ok) {
      const heardWords = own.map(({ position }) => heardFor.get(position)).filter(Boolean);
      if (heardWords.length) token.heardAs = heardWords.join(" ");
      missed.push(lookupText({ text: token.text, word: true, occurrence: 0 }));
    }
  });
  const wordCount = tokens.filter((token) => token.word).length;
  return { tokens, missed, score: wordCount ? (wordCount - missed.length) / wordCount : 0 };
}
