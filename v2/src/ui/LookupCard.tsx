import { useEffect, useState } from "react";
import { useCardIndex } from "../app/cards";
import { speakOnce } from "../app/audio";
import { toast } from "../app/toast";
import { LOOKUP_SOURCE, toggleWord } from "../db/repo";
import type { Settings } from "../db/types";
import { type LookupResult, dictionary, posLabel } from "../dict/dictionary";
import { MeaningFixSheet, meaningsLine } from "./MeaningFixSheet";
import { SaveToggle } from "./SaveToggle";
import { MeaningSourceNote, WordMeanings, WordMeta } from "./WordSheet";
import { SpeakerIcon } from "./icons";

// 查词: a word or expression typed in 词句's search box, looked up in the
// offline dictionary, to hear, save, or report.

// French-looking: letters (with accents), apostrophes, hyphens and spaces, no Chinese.
export function looksFrench(query: string): boolean {
  const text = query.trim();
  return text.length > 0 && text.length <= 40 && /^[\p{Script=Latin}'’\- ]+$/u.test(text);
}

type State = { query: string; word: LookupResult | null } | null;

export function LookupCard({ query, settings }: { query: string; settings: Settings }) {
  const [state, setState] = useState<State>(null);
  const [fixing, setFixing] = useState(false);
  const index = useCardIndex();
  const text = query.trim();

  useEffect(() => {
    let current = true;
    // Looked up once typing pauses.
    const timer = setTimeout(() => {
      dictionary.lookup(text, "fr").then(
        (word) => current && setState({ query: text, word }),
        () => current && setState({ query: text, word: null })
      );
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [text]);

  const ready = state?.query === text;
  const word = ready ? state.word : null;
  const card = word ? index.word(word.lemma) : undefined;

  const toggle = async (entry: LookupResult) => {
    const saved = await toggleWord({ lemma: entry.lemma, surface: entry.surface, translation: meaningsLine(entry), ipa: entry.ipa, partOfSpeech: posLabel(entry.posList) }, LOOKUP_SOURCE);
    toast(saved ? `已收藏 ${entry.lemma}，在 词句 里` : `已取消收藏 ${entry.lemma}`);
  };

  return (
    <section className="card lookup-card" aria-live="polite" aria-label="查词典">
      {!ready && <p className="dim small">正在查词典…</p>}
      {ready && !word && (
        <div className="row-between">
          <p className="muted small">离线词典里没有「{text}」</p>
          <a className="text-button" href={`https://fr.wiktionary.org/wiki/${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">完整词典 ›</a>
        </div>
      )}
      {word && (
        <div className="word-sheet">
          <div className="word-head">
            <p className="word-title-row grow">
              <b className="fr word-title" lang="fr">{word.isInflected ? word.surface : word.lemma}</b>
              {word.isInflected && <span className="muted small">原形 <b className="fr accent-text" lang="fr">{word.lemma}</b></span>}
            </p>
            <button type="button" className="round-button round-outline" onClick={() => speakOnce(word.isInflected ? word.surface : word.lemma, settings, "fr")} aria-label={`朗读 ${word.lemma}`}>
              <SpeakerIcon size={20} />
            </button>
          </div>
          <WordMeta word={word} />
          <WordMeanings word={word} card={card} language="fr" />
          <div className="word-actions">
            <SaveToggle saved={Boolean(card)} tone={card?.status} onToggle={() => void toggle(word)} />
            <span className="row-8">
              <button type="button" className="text-button" onClick={() => setFixing(true)}>释义有误？</button>
              <a className="text-button" href={`https://fr.wiktionary.org/wiki/${encodeURIComponent(word.lemma)}`} target="_blank" rel="noreferrer">完整词典 ›</a>
            </span>
          </div>
          <MeaningSourceNote word={word} />
        </div>
      )}
      {fixing && word && <MeaningFixSheet lemma={word.lemma} surface={word.surface} source={LOOKUP_SOURCE} marked={Boolean(card?.dictIssue)} onClose={() => setFixing(false)} />}
    </section>
  );
}
