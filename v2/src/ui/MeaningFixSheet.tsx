import { useEffect, useState } from "react";
import { noteAiFailure, readyAi, useAi } from "../ai/state";
import { type MeaningCheck, checkMeaningFix } from "../ai/tasks";
import { toast } from "../app/toast";
import { type WordSource, type WordToSave, fixWordMeaning, meaningSenses, reportWordMeaning } from "../db/repo";
import { type LookupResult, dictionary, posLabel } from "../dict/dictionary";
import { Modal } from "./Modal";

// 释义有误？ With the local AI (the Mac app, or a phone connected to it) the
// learner writes the right meaning and the AI checks it before it is kept.
// Without it the word can only be marked: it waits in 词句 → 待补充 until it
// is fixed with the AI. Fixes stay on the learner's own devices.

export function meaningsLine(entry: LookupResult): string {
  const groups = entry.meanings.length ? entry.meanings.map((group) => group.senses.slice(0, 4).join("、")) : [entry.enSenses.slice(0, 3).join("; ")];
  return groups.filter(Boolean).join("；");
}

type Phase = "edit" | "checking" | "rejected";

export function MeaningFixSheet({
  lemma,
  surface,
  context,
  source,
  marked = false,
  onClose
}: {
  lemma: string;
  surface?: string;
  context?: string;
  source: WordSource;
  // Already marked as wrong (opened from 词句 → 待补充).
  marked?: boolean;
  onClose: () => void;
}) {
  const ai = useAi();
  const [entry, setEntry] = useState<LookupResult | null | undefined>(undefined);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("edit");
  const [check, setCheck] = useState<MeaningCheck | null>(null);

  useEffect(() => {
    let current = true;
    dictionary.lookup(lemma, source.language).then(
      (found) => current && setEntry(found),
      () => current && setEntry(null)
    );
    return () => {
      current = false;
    };
  }, [lemma, source.language]);

  const now = entry ? meaningsLine(entry) : "";
  const word: WordToSave = {
    lemma: entry?.lemma ?? lemma,
    surface: surface ?? lemma,
    translation: entry?.meanings.length ? now : "",
    ipa: entry?.ipa ?? "",
    partOfSpeech: entry ? posLabel(entry.posList) : ""
  };
  const canFix = ai.phase === "ready" && ai.canExplain;

  const mark = async () => {
    await reportWordMeaning(word, source);
    toast("已标记，这个词放进了 词句 · 待补充");
    onClose();
  };

  const keep = async (meaning: string, note: string) => {
    await fixWordMeaning(word, meaningSenses(meaning), source);
    toast(note);
    onClose();
  };

  const submit = async () => {
    const ready = readyAi();
    if (!ready || !text.trim()) return;
    setPhase("checking");
    try {
      const result = await checkMeaningFix(ready.backend, ready.model, {
        word: surface ?? lemma,
        lemma: word.lemma,
        partOfSpeech: word.partOfSpeech,
        english: entry?.enSenses ?? [],
        current: now,
        proposed: text.trim(),
        context
      });
      if (result.ok) return keep(text, "已修正：AI 检查过，这个释义没问题");
      setCheck(result);
      setPhase("rejected");
    } catch (error) {
      noteAiFailure(error);
      toast("AI 这次没有回应，请稍后再试");
      setPhase("edit");
    }
  };

  return (
    <Modal title="释义有误？" onClose={onClose} compact>
      <div className="stack-16 fix-sheet">
        <div className="stack-6">
          <h2 className="sheet-title">释义有误？</h2>
          <p className="fix-word">
            <b className="fr" lang={source.language}>{word.lemma}</b>
            {word.partOfSpeech && <span className="dim small">{word.partOfSpeech}</span>}
          </p>
          <p className="dim small">词典现在写的是：{entry === undefined ? "…" : now || "（没有中文释义）"}</p>
        </div>

        {canFix ? (
          <>
            <label className="field">
              正确的中文释义
              <textarea
                rows={2}
                value={text}
                maxLength={120}
                placeholder="几个意思用顿号分开，比如：活泼的、鲜明的"
                onChange={(event) => {
                  setText(event.target.value);
                  if (phase === "rejected") setPhase("edit");
                }}
                disabled={phase === "checking"}
              />
            </label>
            {phase === "rejected" && check ? (
              <section className="fix-verdict" role="alert">
                <p><b>AI 觉得不太对：</b>{check.reason || "和词典的英文释义对不上"}</p>
                {check.suggestion && <p>AI 的建议：<b>{check.suggestion}</b></p>}
                <div className="row-8">
                  {check.suggestion && <button type="button" className="button button-primary button-small" onClick={() => void keep(check.suggestion, "已采用 AI 建议的释义")}>用 AI 的建议</button>}
                  <button type="button" className="button button-outline button-small" onClick={() => setPhase("edit")}>再改改</button>
                </div>
              </section>
            ) : (
              <p className="dim small">本机 AI 会先检查改得对不对，合理才会保存。修改只在你自己的设备上生效。</p>
            )}
            <div className="row-12">
              {!marked && <button type="button" className="button button-outline grow" onClick={() => void mark()} disabled={phase === "checking"}>只标记</button>}
              <button type="button" className="button button-primary grow" onClick={() => void submit()} disabled={!text.trim() || phase === "checking"}>
                {phase === "checking" ? "AI 正在检查…" : "让 AI 检查并保存"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="small">{ai.online ? "修改释义要 AI 检查改得对不对：在 我的 → AI 翻译与讲解 里加上智谱的免费密钥后就能改。" : "修改释义需要连接本机 AI（电脑版 OoFR，或连上电脑的手机），AI 会检查改得对不对。"}</p>
            {marked ? (
              <>
                <p className="dim small">这个词已经标记过了，在 词句 · 待补充 里等着。连上电脑后再打开这里就能修正。</p>
                <button type="button" className="button button-outline" onClick={onClose}>知道了</button>
              </>
            ) : (
              <>
                <p className="dim small">现在可以先标记：这个词会放进 词句 · 待补充，连上电脑后在那里修正。</p>
                <div className="row-12">
                  <button type="button" className="button button-outline grow" onClick={onClose}>取消</button>
                  <button type="button" className="button button-primary grow" onClick={() => void mark()}>标记为有误</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
