import { useMemo } from "react";
import { db } from "../db/database";
import { useLive } from "../db/live";
import { cardKey } from "../db/repo";
import type { Card } from "../db/types";
import { normalizeWord } from "../text/split";

export interface CardIndex {
  // A saved word, found by its dictionary form or any form already met (voudrais → vouloir).
  word(surface: string): Card | undefined;
  phrase(text: string): Card | undefined;
}

// Everything in the phrasebook, indexed for highlighting words in a text and
// for showing whether a sentence is saved. Updates live.
export function useCardIndex(): CardIndex {
  const cards = useLive(() => db.cards.toArray(), []);
  return useMemo(() => {
    const words = new Map<string, Card>();
    const phrases = new Map<string, Card>();
    for (const card of cards ?? []) {
      if (card.kind === "phrase") {
        phrases.set(card.normalized, card);
        continue;
      }
      for (const key of [card.normalized, normalizeWord(card.text), normalizeWord(card.lemma), ...card.seenForms.map((form) => form.normalized)]) {
        if (key && !words.has(key)) words.set(key, card);
      }
    }
    return {
      word: (surface) => words.get(normalizeWord(surface)),
      phrase: (text) => phrases.get(cardKey("phrase", text))
    };
  }, [cards]);
}
