import { useEffect, useState } from "react";
import { useCardIndex } from "../app/cards";
import { speakOnce } from "../app/audio";
import { toast } from "../app/toast";
import { toggleWord } from "../db/repo";
import type { Material, Settings } from "../db/types";
import { type LookupResult, type MeaningGroup, dictionary, featuresLabel, posLabel } from "../dict/dictionary";
import { Modal } from "./Modal";
import { SaveToggle } from "./SaveToggle";
import { SpeakerIcon } from "./icons";

export interface WordTarget {
  text: string;
  occurrence: number;
  context: string;
  // The sentence's words and which one was tapped, to find fixed expressions.
  words: string[];
  index: number;
}

type State = { status: "loading" } | { status: "ready"; word: LookupResult | null; expression: LookupResult | null };

const GENDER = { masculine: "阳性", feminine: "阴性" } as Record<string, string>;

function meaningsText(entry: LookupResult): string {
  return (entry.meanings[0]?.senses ?? entry.enSenses).slice(0, 3).join("；");
}

// A compact card for a tapped word: it speaks the word, shows its meanings
// (and the fixed expression it belongs to), and saves or unsaves with one tap.
export function WordSheet({ target, material, settings, onClose }: { target: WordTarget; material: Material; settings: Settings; onClose: () => void }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const index = useCardIndex();

  useEffect(() => {
    speakOnce(target.text, settings, material.language);
    let current = true;
    setState({ status: "loading" });
    Promise.all([
      dictionary.lookup(target.text, material.language, { context: target.context, occurrence: target.occurrence }).catch(() => null),
      dictionary.findExpression(target.words, target.index, material.language).catch(() => null)
    ]).then(([word, expression]) => current && setState({ status: "ready", word, expression }));
    return () => {
      current = false;
    };
    // Look up and speak once per tapped word.
  }, [target.text, target.context, target.occurrence, target.index, material.language]);

  const toggle = async (entry: LookupResult) => {
    const saved = await toggleWord(
      { lemma: entry.lemma, surface: entry.surface, translation: meaningsText(entry), ipa: entry.ipa, partOfSpeech: posLabel(entry.posList) },
      material
    );
    toast(saved ? `已收藏 ${entry.lemma}` : `已取消收藏 ${entry.lemma}`);
  };

  const word = state.status === "ready" ? state.word : null;
  const expression = state.status === "ready" ? state.expression : null;
  const wordCard = word ? index.word(word.lemma) : index.word(target.text);
  const expressionCard = expression ? index.word(expression.lemma) : undefined;
  const meta = word
    ? [word.formIpa || word.ipa, posLabel(word.posList), GENDER[word.meanings.find((group) => group.gender)?.gender ?? ""] ?? "", word.form ? featuresLabel(word.form.features) : ""].filter(Boolean)
    : [];

  return (
    <Modal title={`${target.text} 的释义`} onClose={onClose} compact>
      <div className="word-sheet">
        <div className="word-head">
          <p className="word-title-row grow">
            <b className="fr word-title" lang={material.language}>{target.text}</b>
            {word?.isInflected && <span className="muted small">原形 <b className="fr accent-text" lang={material.language}>{word.lemma}</b></span>}
          </p>
          <button type="button" className="round-button round-outline" onClick={() => speakOnce(target.text, settings, material.language)} aria-label={`朗读 ${target.text}`}>
            <SpeakerIcon size={20} />
          </button>
        </div>
        {meta.length > 0 && (
          <p className="dim small">
            {meta.map((part, partIndex) => (
              <span key={part} className={partIndex === 0 && part.startsWith("/") ? "ipa" : undefined}>{partIndex ? " · " : ""}{part}</span>
            ))}
          </p>
        )}

        {expression && (
          <section className="expression">
            <div className="grow stack-2">
              <span className="dim small">固定搭配</span>
              <b className="fr" lang={material.language}>{expression.word}</b>
              <span className="small">{meaningsText(expression)}</span>
            </div>
            <SaveToggle variant="small" saved={Boolean(expressionCard)} tone={expressionCard?.status} onToggle={() => void toggle(expression)} />
          </section>
        )}

        {state.status === "loading" && <p className="dim small">正在查离线词典…</p>}
        {state.status === "ready" && !word && <p className="muted small">离线词典里没有这个词，可以打开完整词典看看。</p>}
        {word && <Meanings word={word} />}

        <div className="word-actions">
          <SaveToggle saved={Boolean(wordCard)} tone={wordCard?.status} onToggle={() => word && void toggle(word)} label={word && word.lemma !== target.text ? `收藏 ${word.lemma}` : "收藏"} />
          <a className="text-button" href={`https://fr.wiktionary.org/wiki/${encodeURIComponent(word?.lemma ?? target.text)}`} target="_blank" rel="noreferrer">完整词典 ›</a>
        </div>
        {word && (
          <p className="dim tiny">
            {word.meaningSource === "curated" ? "释义：OoFR 人工校订" : word.meaningSource === "ai" ? "释义：本机 AI 依据维基词典英文释义翻译" : `来源：${word.source}`}
          </p>
        )}
      </div>
    </Modal>
  );
}

function Meanings({ word }: { word: LookupResult }) {
  // 1.0's machine-matched Chinese is often wrong: the accurate English senses come first.
  if (word.meaningSource === "machine" || word.meaningSource === "none") {
    return (
      <section className="stack-6">
        <ol className="senses" lang="en">{word.enSenses.slice(0, 4).map((sense) => <li key={sense}>{sense}</li>)}</ol>
        {word.meaningSource === "machine" && <p className="dim tiny">机器对照中文（可能不准）：{word.zhSenses.slice(0, 3).join("；")}</p>}
      </section>
    );
  }
  return (
    <section className="meanings">
      {word.meanings.slice(0, 3).map((group: MeaningGroup) => (
        <p key={group.pos} className="meaning-row">
          <span className="meaning-pos">{group.pos}{GENDER[group.gender] ? ` · ${GENDER[group.gender]}` : ""}</span>
          <span>{group.senses.slice(0, 4).join("；")}</span>
        </p>
      ))}
    </section>
  );
}
