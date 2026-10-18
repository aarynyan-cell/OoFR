// Practice questions built from a lesson's own sentences. None of them needs a
// translation, so freshly pasted materials can be practised right away:
//  - listen: hear a sentence, pick it among three;
//  - cloze: one word is missing, pick it among four;
//  - order: put the shuffled words back in order.

import type { Material } from "../db/types";
import { lookupText, tokenize } from "../text/tokens";

export type Exercise =
  | { kind: "listen"; sentence: number; options: number[] }
  | { kind: "cloze"; sentence: number; blank: number; options: string[]; answer: string }
  | { kind: "order"; sentence: number; pieces: string[]; answer: string[] };

export type Random = () => number;

// Little words make poor blanks: the answer should carry meaning.
const LITTLE_WORDS = new Set([
  "le", "la", "les", "l'", "un", "une", "des", "du", "de", "d'", "et", "ou", "à", "au", "aux", "en", "y",
  "je", "j'", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "ce", "c'", "ça", "se", "s'", "ne", "n'", "pas",
  "que", "qu'", "qui", "me", "m'", "te", "t'", "mon", "ma", "mes", "son", "sa", "ses", "est", "a", "the", "a", "an", "to", "of", "and"
]);

const FALLBACK_WORDS = ["maison", "toujours", "parler", "petit", "demain", "travail", "heureux", "ville", "manger", "souvent"];

function shuffle<T>(items: T[], random: Random): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

const lower = (word: string) => word.toLocaleLowerCase("fr-FR");

export function sentenceWords(text: string): string[] {
  return tokenize(text).filter((token) => token.word).map((token) => token.text);
}

function clozeFor(material: Material, sentence: number, random: Random): Exercise | null {
  const tokens = tokenize(material.sentences[sentence].text);
  const candidates = tokens
    .map((token, index) => ({ token, index }))
    .filter(({ token }) => token.word && !token.text.startsWith("-") && lookupText(token).length >= 3 && !LITTLE_WORDS.has(lower(lookupText(token))));
  if (!candidates.length) return null;
  const longest = Math.max(...candidates.map(({ token }) => token.text.length));
  const pick = shuffle(candidates.filter(({ token }) => token.text.length >= longest - 2), random)[0];
  const answer = pick.token.text;
  // One spelling per word ("Bien" and "bien" are the same option).
  const pool = [...new Map(material.sentences.flatMap((item) => sentenceWords(item.text)).map((word) => [lower(word), word])).values()]
    .filter((word) => word.length >= 3 && !word.startsWith("-") && lower(word) !== lower(answer) && !LITTLE_WORDS.has(lower(word)));
  const distractors = shuffle(pool, random).slice(0, 3);
  for (const word of shuffle(FALLBACK_WORDS, random)) {
    if (distractors.length >= 3) break;
    if (lower(word) !== lower(answer) && !distractors.some((item) => lower(item) === word)) distractors.push(word);
  }
  return { kind: "cloze", sentence, blank: pick.index, answer, options: shuffle([answer, ...distractors], random) };
}

function orderFor(material: Material, sentence: number, random: Random): Exercise | null {
  const answer = sentenceWords(material.sentences[sentence].text);
  if (answer.length < 3 || answer.length > 10) return null;
  let pieces = shuffle(answer, random);
  for (let attempt = 0; attempt < 5 && pieces.join(" ") === answer.join(" "); attempt += 1) pieces = shuffle(answer, random);
  if (pieces.join(" ") === answer.join(" ")) pieces = [...answer].reverse();
  return { kind: "order", sentence, pieces, answer };
}

function listenFor(material: Material, sentence: number, random: Random): Exercise | null {
  const others = material.sentences.map((_, index) => index).filter((index) => index !== sentence && material.sentences[index].text !== material.sentences[sentence].text);
  if (others.length < 2) return null;
  return { kind: "listen", sentence, options: shuffle([sentence, ...shuffle(others, random).slice(0, 2)], random) };
}

// One question per sentence, rotating through the three kinds.
export function buildExercises(material: Material, random: Random = Math.random): Exercise[] {
  const builders = [listenFor, clozeFor, orderFor];
  return material.sentences.flatMap((_, sentence) => {
    for (let offset = 0; offset < builders.length; offset += 1) {
      const exercise = builders[(sentence + offset) % builders.length](material, sentence, random);
      if (exercise) return [exercise];
    }
    return [];
  });
}

export function isCorrect(exercise: Exercise, choice: number | string | string[]): boolean {
  if (exercise.kind === "listen") return choice === exercise.sentence;
  if (exercise.kind === "cloze") return typeof choice === "string" && lower(choice) === lower(exercise.answer);
  return Array.isArray(choice) && choice.map(lower).join(" ") === exercise.answer.map(lower).join(" ");
}
