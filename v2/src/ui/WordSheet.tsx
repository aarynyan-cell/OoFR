import { useEffect, useState } from "react";
import { speakOnce } from "../app/audio";
import { toast } from "../app/toast";
import { db } from "../db/database";
import { useLive } from "../db/live";
import { cardKey, saveWord } from "../db/repo";
import type { Material, Settings } from "../db/types";
import { type LookupResult, dictionary, featuresLabel, posLabel } from "../dict/dictionary";
import { Modal } from "./Modal";
import { BookmarkIcon, SpeakerIcon } from "./icons";

export interface WordTarget {
  text: string;
  occurrence: number;
  context: string;
  translation: string;
}

type State = { status: "loading" } | { status: "found"; result: LookupResult } | { status: "missing" };

export function WordSheet({ target, material, settings, onClose }: { target: WordTarget; material: Material; settings: Settings; onClose: () => void }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    dictionary
      .lookup(target.text, material.language, { context: target.context, occurrence: target.occurrence })
      .then((result) => current && setState(result ? { status: "found", result } : { status: "missing" }))
      .catch(() => current && setState({ status: "missing" }));
    return () => {
      current = false;
    };
  }, [target.text, target.context, target.occurrence, material.language]);

  const lemma = state.status === "found" ? state.result.lemma : target.text;
  const saved = useLive(() => db.cards.where("normalized").equals(cardKey("word", lemma)).first(), [lemma]);

  const save = async () => {
    if (state.status !== "found") return;
    const { result } = state;
    const { added } = await saveWord(
      {
        lemma: result.lemma,
        surface: target.text,
        translation: (result.zhSenses.length ? result.zhSenses : result.enSenses).slice(0, 3).join("；"),
        ipa: result.ipa,
        partOfSpeech: posLabel(result.posList)
      },
      material
    );
    toast(added ? `已收藏 ${result.lemma}` : `${result.lemma} 已在词句本里，记下了这个词形`);
  };

  const wiktionary = `https://fr.wiktionary.org/wiki/${encodeURIComponent(lemma)}`;

  return (
    <Modal title={`${target.text} 的释义`} onClose={onClose}>
      <div className="stack-16 sheet-scroll">
        <div className="row-between word-head">
          <div className="stack-6 grow">
            <p className="word-title-row">
              <b className="fr word-title" lang={material.language}>{target.text}</b>
              {state.status === "found" && state.result.isInflected && (
                <span className="muted">原形 <b className="fr accent-text" lang={material.language}>{state.result.lemma}</b></span>
              )}
            </p>
            {state.status === "found" && (
              <p className="dim small">
                {(state.result.formIpa || state.result.ipa) && <span className="ipa">{state.result.formIpa || state.result.ipa} · </span>}
                {[posLabel(state.result.posList), state.result.form ? featuresLabel(state.result.form.features) : ""].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </div>

        <button type="button" className="button button-outline button-small align-start" onClick={() => speakOnce(target.text, settings, material.language)}>
          <SpeakerIcon size={18} />发音
        </button>

        {state.status === "loading" && <p className="dim">正在查离线词典…</p>}
        {state.status === "missing" && (
          <p className="muted">离线词典里没有找到这个词。可以打开完整词典看看。</p>
        )}
        {state.status === "found" && (
          <section className="stack-6">
            <h3 className="sheet-subtitle">释义</h3>
            <ol className="senses">
              {(state.result.zhSenses.length ? state.result.zhSenses : state.result.enSenses).slice(0, 5).map((sense) => <li key={sense}>{sense}</li>)}
            </ol>
          </section>
        )}
        {/* The English meanings (Wiktionary) are the accurate reference while the Chinese layer is being rebuilt. */}
        {state.status === "found" && !state.result.curated && state.result.zhSenses.length > 0 && state.result.enSenses.length > 0 && (
          <section className="stack-4">
            <h3 className="sheet-subtitle">英文释义</h3>
            <p className="muted small" lang="en">{state.result.enSenses.slice(0, 3).join("; ")}</p>
          </section>
        )}

        {target.translation && (
          <section className="soft-box stack-4">
            <h3 className="sheet-subtitle accent-text">这句的意思</h3>
            <p>{target.translation}</p>
          </section>
        )}

        <div className="grid-2">
          <button type="button" className={`button ${saved ? "button-outline" : "button-primary"}`} onClick={save} disabled={state.status !== "found"}>
            <BookmarkIcon size={18} />{saved ? "已在词句本" : "收藏到词句本"}
          </button>
          <a className="button button-outline" href={wiktionary} target="_blank" rel="noreferrer">完整词典</a>
        </div>
        {state.status === "found" && <p className="dim small">来源：{state.result.curated ? "OoFR 人工校订" : state.result.source}</p>}
      </div>
    </Modal>
  );
}
