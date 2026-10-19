import { useEffect, useRef, useState } from "react";
import { explainNow, planLesson, retryJob, useAiJob } from "../ai/enrich";
import { useAi } from "../ai/state";
import { useCardIndex } from "../app/cards";
import { materialKey, playMaterial, speakOnce, togglePause, toggleSpeech, usePlayer } from "../app/audio";
import { type LessonMode, href } from "../app/router";
import { toast } from "../app/toast";
import { db } from "../db/database";
import { useLive } from "../db/live";
import { getSettings, materialsOfTape, saveSettings, setPosition, toggleSentence, trackLabel } from "../db/repo";
import type { Material, Sentence, Settings, TextMode } from "../db/types";
import { player } from "../speech/player";
import { AiPanel } from "../ui/AiSheet";
import { CounterReels } from "../ui/Cassette";
import { Modal } from "../ui/Modal";
import { SaveToggle } from "../ui/SaveToggle";
import { SentenceText, type TappedWord } from "../ui/SentenceText";
import { type WordTarget, WordSheet } from "../ui/WordSheet";
import { LessonTop } from "./LessonTop";
import { PracticeMode } from "./PracticeMode";
import { ShadowMode } from "./ShadowMode";
import { BookmarkFilledIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, ReelIcon, SparkleIcon } from "../ui/icons";

const RATES = [0.7, 0.85, 1, 1.15];
const TEXT_MODES: { mode: TextMode; label: string; hint: string }[] = [
  { mode: "both", label: "双语", hint: "显示法语和中文" },
  { mode: "fr", label: "法", hint: "只显示法语" },
  { mode: "zh", label: "中", hint: "只显示中文（还没有译文的句子显示法语）" }
];
const pad = (value: number) => String(value).padStart(2, "0");

export function LessonPage({ id, mode = "listen" }: { id: string; mode?: LessonMode }) {
  // null: not found; undefined: still loading.
  const material = useLive(async () => (await db.materials.get(id)) ?? null, [id]);
  const settings = useLive(() => getSettings(), []);
  const siblings = useLive(async () => (material ? materialsOfTape(await db.materials.where("tapeId").equals(material.tapeId).toArray(), material.tapeId) : []), [material?.tapeId]);
  const tape = useLive(async () => (material ? db.tapes.get(material.tapeId) : undefined), [material?.tapeId]);

  if (material === undefined || !settings) return <main className="page" aria-busy="true" />;
  if (!material) {
    return (
      <main className="page">
        <p className="empty">找不到这条素材，可能已经删除了。</p>
        <a className="button button-outline" href={href({ name: "tapes" })}>回到磁带</a>
      </main>
    );
  }
  const track = siblings ? siblings.findIndex((item) => item.id === material.id) : -1;
  const info = { material, settings, trackName: track >= 0 ? trackLabel(track) : "", tapeTitle: tape?.title ?? "" };
  if (mode === "shadow") return <ShadowMode {...info} />;
  if (mode === "practice") return <PracticeMode {...info} />;
  return <Lesson {...info} />;
}

function Lesson({ material, settings, trackName, tapeTitle }: { material: Material; settings: Settings; trackName: string; tapeTitle: string }) {
  const state = usePlayer();
  const key = materialKey(material);
  const running = state.key === key && state.status !== "idle";
  const total = material.sentences.length;
  const index = running ? state.index : Math.min(Math.max(0, material.position), total - 1);
  const sentence = material.sentences[index];
  const cards = useCardIndex();
  const savedCard = sentence ? cards.phrase(sentence.text) : undefined;
  const [explaining, setExplaining] = useState<string | null>(null);
  const ai = useAi();
  const [word, setWord] = useState<WordTarget | null>(null);
  const currentRef = useRef<HTMLElement>(null);
  const sentenceKey = `sentence:${material.id}:${sentence?.id}`;
  const sentenceState = state.key === sentenceKey ? state.status : "idle";

  // Looking a word up stops the lesson; the card reads the word, and nothing resumes on its own.
  const openWord = (tapped: TappedWord) => {
    if (running) player.stop();
    setWord({ ...tapped, context: sentence.text });
  };

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [index]);

  // The local AI fills in missing translations and gets the next explanations ready.
  useEffect(() => {
    if (ai.phase === "ready" && settings.aiPrepare) planLesson(material, index);
  }, [ai.phase, settings.aiPrepare, material.id, index]);

  // Leaving the lesson stops its audio.
  useEffect(() => () => {
    if (player.getState().key === key) player.stop();
  }, [key]);

  useEffect(() => {
    if (state.message) toast(state.message);
  }, [state.message]);

  const goTo = (next: number) => {
    const target = Math.min(Math.max(0, next), total - 1);
    if (running) playMaterial(material, target, settings);
    else void setPosition(material.id, target);
  };

  const playPause = () => {
    if (running) togglePause();
    else playMaterial(material, index, settings);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]")) return;
      if (event.key === " ") {
        event.preventDefault();
        playPause();
      } else if (event.key === "ArrowRight") goTo(index + 1);
      else if (event.key === "ArrowLeft") goTo(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Plays just this sentence once, whatever the 全文 / 单句 setting; the same button pauses and resumes it.
  const playSentence = () => {
    void setPosition(material.id, index);
    toggleSpeech(sentenceKey, sentence.text, settings, material.language);
  };

  // Tapping another sentence moves there and reads only that sentence.
  const playOther = (itemIndex: number, item: Sentence) => {
    void setPosition(material.id, itemIndex);
    speakOnce(item.text, settings, material.language, `sentence:${material.id}:${item.id}`);
  };

  const textMode = settings.textMode;
  const cycleText = () => {
    const at = TEXT_MODES.findIndex((item) => item.mode === textMode);
    const next = TEXT_MODES[(at + 1) % TEXT_MODES.length];
    void saveSettings({ textMode: next.mode, showTranslation: next.mode !== "fr" });
    toast(next.hint);
  };
  // In 中 mode a sentence without a translation yet still shows its French.
  const chineseOnly = (item: Sentence) => textMode === "zh" && Boolean(item.translation);

  const explain = () => setExplaining(sentence.id);

  const save = async () => toast((await toggleSentence(material, sentence)) ? "已收藏到词句本" : "已取消收藏");

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(settings.rate) + 1) % RATES.length] ?? 0.85;
    void saveSettings({ rate: next });
    toast(`语速 ${next}×${running ? "，下一句起生效" : ""}`);
  };

  const speakerLabel = (label: string) => (label && label !== "旁白" ? ` · ${label.replace(/^[AB]\s*·\s*/, "").toLocaleUpperCase("fr-FR")}` : "");

  return (
    <main className="page page-lesson">
      <LessonTop material={material} mode="listen" trackName={trackName} tapeTitle={tapeTitle} />

      <div className="reading">
        {material.sentences.map((item, itemIndex) =>
          itemIndex === index ? (
            <article key={item.id} className="current" aria-current="true" ref={currentRef}>
              <span className="mono current-label"><ReelIcon size={14} />{pad(itemIndex + 1)}{speakerLabel(item.speakerLabel)}</span>
              {chineseOnly(item) ? (
                <p className="current-text current-zh">{item.translation}</p>
              ) : (
                <p className="fr current-text" lang={material.language}>
                  <SentenceText text={item.text} cards={cards} onWord={openWord} active={word} />
                </p>
              )}
              {textMode === "both" && item.translation && (
                <p className="current-translation">
                  {item.translation}
                  {item.translationSource === "ai" && <span className="ai-tag" title="由本机 AI 翻译">AI 译</span>}
                </p>
              )}
              <div className="actions-3">
                <button type="button" className={`action${sentenceState === "idle" ? "" : " action-on"}`} onClick={playSentence} aria-label={sentenceState === "playing" ? "暂停这一句" : "播放这一句"}>
                  {sentenceState === "playing" ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
                  {sentenceState === "playing" ? "暂停" : sentenceState === "paused" ? "继续" : "播放"}
                </button>
                <button type="button" className={`action${item.explanation ? "" : " action-muted"}`} onClick={explain}><SparkleIcon size={20} />讲解</button>
                <SaveToggle variant="action" saved={Boolean(savedCard)} tone={savedCard?.status} onToggle={() => void save()} />
              </div>
            </article>
          ) : (
            <button
              key={item.id}
              type="button"
              className={`fr sentence${itemIndex < index ? " sentence-done" : ""}`}
              lang={material.language}
              onClick={() => playOther(itemIndex, item)}
              aria-label={`播放第 ${itemIndex + 1} 句：${item.text}`}
            >
              {chineseOnly(item) ? <span className="sentence-zh">{item.translation}</span> : <SentenceText text={item.text} cards={cards} />}
              {textMode === "both" && item.translation && <span className="sentence-translation">{item.translation}</span>}
              {cards.phrase(item.text) && (
                <span className={`saved-mark tone-${cards.phrase(item.text)!.status}`} aria-label="已收藏"><BookmarkFilledIcon size={14} /></span>
              )}
            </button>
          )
        )}
      </div>

      <section className="player" aria-label="播放器">
        <div className="player-progress">
          <CounterReels progress={(index + 1) / total} />
          <span className="progress grow" aria-hidden="true"><span style={{ width: `${((index + 1) / total) * 100}%` }} /></span>
          <span className="mono small muted">{pad(index + 1)} / {pad(total)}</span>
        </div>
        {/* The big button plays on from the current sentence; a tapped sentence plays alone. */}
        <div className="player-controls">
          <button type="button" className="mono player-text" onClick={cycleRate} aria-label={`语速 ${settings.rate} 倍，点一下切换`}>{settings.rate}×</button>
          <button type="button" className="icon-button" onClick={() => goTo(index - 1)} aria-label="上一句" disabled={index === 0}><PrevIcon /></button>
          <button type="button" className="round-button round-accent round-large" onClick={playPause} aria-label={running && state.status === "playing" ? "暂停" : "播放"}>
            {running && state.status === "playing" ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
          </button>
          <button type="button" className="icon-button" onClick={() => goTo(index + 1)} aria-label="下一句" disabled={index >= total - 1}><NextIcon /></button>
          <button type="button" className="player-text" onClick={cycleText} aria-label={`文字显示：${TEXT_MODES.find((item) => item.mode === textMode)?.hint}，点一下切换`}>{TEXT_MODES.find((item) => item.mode === textMode)?.label}</button>
        </div>
      </section>

      {explaining && <ExplanationSheet material={material} sentenceId={explaining} onClose={() => setExplaining(null)} />}
      {word && <WordSheet target={word} material={material} settings={settings} onClose={() => setWord(null)} />}
    </main>
  );
}

function ExplanationSheet({ material, sentenceId, onClose }: { material: Material; sentenceId: string; onClose: () => void }) {
  const sentence = material.sentences.find((item) => item.id === sentenceId);
  const explanation = sentence?.explanation ?? null;
  const ai = useAi();
  const job = useAiJob("explain", material.id, sentenceId);

  // No explanation yet: ask for one as soon as the AI is ready (it goes ahead of the queue).
  useEffect(() => {
    if (sentence && !explanation && ai.phase === "ready" && !job) explainNow(material, sentence);
  }, [ai.phase, Boolean(explanation)]);

  const section = (title: string, items: string[]) =>
    items.length > 0 && (
      <section className="stack-6">
        <h3 className="sheet-subtitle">{title}</h3>
        <ul className="bullets">{items.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>
    );
  return (
    <Modal title="句子讲解" onClose={onClose}>
      <div className="stack-16 sheet-scroll">
        <h2 className="sheet-title">句子讲解</h2>
        <p className="fr explain-text" lang={material.language}>{sentence?.text}</p>
        {explanation ? (
          <>
            {explanation.summary && <p>{explanation.summary}</p>}
            {explanation.structure && section("句子结构", [explanation.structure])}
            {explanation.morphology && (
              <section className="stack-6">
                <h3 className="sheet-subtitle">词形（来自词典）</h3>
                <p className="morphology small">{explanation.morphology}</p>
              </section>
            )}
            {section("语法点", explanation.grammarPoints)}
            {section("易错点", explanation.pitfalls)}
            {section("换个说法", explanation.examples)}
            <span className="pill pill-ok">{explanation.model ? `本机 AI（${explanation.model}）生成` : "AI 生成"} · 已离线保存</span>
          </>
        ) : ai.phase === "ready" ? (
          job?.status === "failed" ? (
            <>
              <p className="error-text" role="alert">{job.error}</p>
              <button type="button" className="button button-primary" onClick={() => retryJob("explain", material.id, sentenceId)}>再试一次</button>
            </>
          ) : (
            <p className="thinking" aria-live="polite">本机 AI 正在写这句的讲解，大约半分钟…</p>
          )
        ) : (
          <>
            <p className="dim">这句还没有讲解。开启本机 AI 后会自动生成，之后不联网也能看。</p>
            <AiPanel />
          </>
        )}
        <button type="button" className="button button-outline" onClick={onClose}>关闭</button>
      </div>
    </Modal>
  );
}
