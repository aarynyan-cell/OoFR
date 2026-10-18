import type { CardIndex } from "../app/cards";
import { groupWords, lookupText, tokenize } from "../text/tokens";
import { frenchSpacing } from "../text/typography";

export interface TappedWord {
  text: string;
  occurrence: number;
  words: string[];
  index: number;
}

// A French sentence with saved words highlighted by state (待学 yellow, 学习中
// orange, 已掌握 green). With onWord, every word is a button that opens the word card.
export function SentenceText({ text, cards, onWord, active }: { text: string; cards: CardIndex; onWord?: (word: TappedWord) => void; active?: TappedWord | null }) {
  const tokens = tokenize(text);
  const words = tokens.filter((token) => token.word).map(lookupText);
  let wordIndex = -1;
  return (
    <>
      {groupWords(tokens).map((group, groupIndex) =>
        group[0].word ? (
          // "allez" + "-vous" (and the punctuation after them) stay on one line.
          <span key={groupIndex} className="nowrap">
            {group.map((token, tokenIndex) => {
              if (!token.word) return <span key={tokenIndex}>{frenchSpacing(token.text)}</span>;
              wordIndex += 1;
              const position = wordIndex;
              const word = lookupText(token);
              const card = cards.word(word);
              const marked = card ? ` mark-${card.status}` : "";
              if (!onWord) return <span key={tokenIndex} className={marked.trim() || undefined}>{token.text}</span>;
              const on = active?.index === position ? " word-on" : "";
              return (
                <button key={tokenIndex} type="button" className={`word${marked}${on}`} onClick={() => onWord({ text: word, occurrence: token.occurrence, words, index: position })}>
                  {token.text}
                </button>
              );
            })}
          </span>
        ) : (
          <span key={groupIndex}>{frenchSpacing(group[0].text)}</span>
        )
      )}
    </>
  );
}
