import { useEffect, useRef, useState } from "react";
import { materialKey, playMaterial, speakOnce, togglePause, usePlayer } from "../app/audio";
import { href } from "../app/router";
import { toast } from "../app/toast";
import { db } from "../db/database";
import { useLive } from "../db/live";
import { cardKey, getSettings, materialsOfTape, saveSentence, saveSettings, setPosition, trackLabel } from "../db/repo";
import type { Explanation, Material, Settings } from "../db/types";
import { player } from "../speech/player";
import { groupWords, lookupText, tokenize } from "../text/tokens";
import { CounterReels } from "../ui/Cassette";
import { Modal } from "../ui/Modal";
import { type WordTarget, WordSheet } from "../ui/WordSheet";
import { BackIcon, BookmarkIcon, MicIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, ReelIcon, ReplayIcon, SparkleIcon } from "../ui/icons";

const RATES = [0.7, 0.85, 1, 1.15];
const pad = (value: number) => String(value).padStart(2, "0");

export function LessonPage({ id }: { id: string }) {
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
  return <Lesson material={material} settings={settings} trackName={track >= 0 ? trackLabel(track) : ""} tapeTitle={tape?.title ?? ""} />;
}

function Lesson({ material, settings, trackName, tapeTitle }: { material: Material; settings: Settings; trackName: string; tapeTitle: string }) {
  const state = usePlayer();
  const key = materialKey(material);
  const running = state.key === key && state.status !== "idle";
  const total = material.sentences.length;
  const index = running ? state.index : Math.min(Math.max(0, material.position), total - 1);
  const sentence = material.sentences[index];
  const savedCard = useLive(() => db.cards.where("normalized").equals(cardKey("phrase", sentence?.text ?? "")).first(), [sentence?.text]);
  const [explaining, setExplaining] = useState<Explanation | null>(null);
  const [word, setWord] = useState<WordTarget | null>(null);
  const currentRef = useRef<HTMLElement>(null);

  // Looking a word up pauses the lesson; closing the card does not resume it on its own.
  const openWord = (text: string, occurrence: number) => {
    if (running && state.status === "playing") player.pause();
    setWord({ text, occurrence, context: sentence.text, translation: sentence.translation });
  };

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [index]);

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

  const replay = () => {
    void setPosition(material.id, index);
    speakOnce(sentence.text, settings, material.language);
  };

  const explain = () => {
    if (sentence.explanation) setExplaining(sentence.explanation);
    else toast("这句还没有讲解。下一步会加入一键 AI：电脑上自动生成，手机也能看");
  };

  const save = async () => {
    const before = await db.cards.where("normalized").equals(cardKey("phrase", sentence.text)).count();
    await saveSentence(material, sentence);
    toast(before ? "这句已经在词句本里了" : "已收藏到词句本");
  };

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(settings.rate) + 1) % RATES.length] ?? 0.85;
    void saveSettings({ rate: next });
    toast(`语速 ${next}×${running ? "，下一句起生效" : ""}`);
  };

  const toggleMode = () => {
    const next = settings.playMode === "all" ? "one" : "all";
    void saveSettings({ playMode: next });
    toast(next === "one" ? "单句循环：一直重复当前这句" : "全文播放：从当前句播到最后");
  };

  const comingSoon = (what: string) => toast(`${what}正在制作中，下一步上线`);
  const speakerLabel = (label: string) => (label && label !== "旁白" ? ` · ${label.replace(/^[AB]\s*·\s*/, "").toLocaleUpperCase("fr-FR")}` : "");

  return (
    <main className="page page-lesson">
      <div className="lesson-top">
        <header className="lesson-head">
          <a className="icon-button" href={href({ name: "tapes", tapeId: material.tapeId })} aria-label="返回磁带"><BackIcon /></a>
          <div className="grow stack-2">
            <h1 className="lesson-title">{material.title}</h1>
            <span className="mono eyebrow">{[tapeTitle, "SIDE A", trackName].filter(Boolean).join(" · ")}</span>
          </div>
        </header>

        <nav className="segmented lesson-modes" aria-label="学习模式">
          <a className="segment" aria-current="page" href={href({ name: "lesson", id: material.id })}>听读</a>
          <button type="button" className="segment" onClick={() => comingSoon("跟读")}>跟读</button>
          <button type="button" className="segment" onClick={() => comingSoon("练习")}>练习</button>
        </nav>
      </div>

      <div className="reading">
        {material.sentences.map((item, itemIndex) =>
          itemIndex === index ? (
            <article key={item.id} className="current" aria-current="true" ref={currentRef}>
              <span className="mono current-label"><ReelIcon size={14} />{pad(itemIndex + 1)}{speakerLabel(item.speakerLabel)}</span>
              <p className="fr current-text" lang={material.language}>
                {groupWords(tokenize(item.text)).map((group, groupIndex) =>
                  group[0].word ? (
                    // "allez" + "-vous" are two buttons that must stay on one line.
                    <span key={groupIndex} className="nowrap">
                      {group.map((token, tokenIndex) => (
                        <button
                          key={tokenIndex}
                          type="button"
                          className={`word${word?.text === lookupText(token) && word.occurrence === token.occurrence ? " word-on" : ""}`}
                          onClick={() => openWord(lookupText(token), token.occurrence)}
                        >
                          {token.text}
                        </button>
                      ))}
                    </span>
                  ) : (
                    <span key={groupIndex}>{group[0].text}</span>
                  )
                )}
              </p>
              {settings.showTranslation && item.translation && <p className="current-translation">{item.translation}</p>}
              <div className="actions-4">
                <button type="button" className="action" onClick={replay}><ReplayIcon size={20} />重听</button>
                <button type="button" className={`action${item.explanation ? "" : " action-muted"}`} onClick={explain}><SparkleIcon size={20} />讲解</button>
                <button type="button" className="action action-muted" onClick={() => comingSoon("跟读")}><MicIcon size={20} />跟读</button>
                <button type="button" className={`action${savedCard ? " action-on" : ""}`} onClick={save} aria-pressed={Boolean(savedCard)}><BookmarkIcon size={20} />{savedCard ? "已收藏" : "收藏"}</button>
              </div>
            </article>
          ) : (
            <button
              key={item.id}
              type="button"
              className={`fr sentence${itemIndex < index ? " sentence-done" : ""}`}
              lang={material.language}
              onClick={() => playMaterial(material, itemIndex, settings)}
              aria-label={`从第 ${itemIndex + 1} 句开始播放：${item.text}`}
            >
              {item.text}
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
        <div className="player-controls">
          <button type="button" className="mono player-text" onClick={cycleRate} aria-label={`语速 ${settings.rate} 倍，点一下切换`}>{settings.rate}×</button>
          <button type="button" className="icon-button" onClick={() => goTo(index - 1)} aria-label="上一句" disabled={index === 0}><PrevIcon /></button>
          <button type="button" className="round-button round-accent round-large" onClick={playPause} aria-label={running && state.status === "playing" ? "暂停" : "播放"}>
            {running && state.status === "playing" ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
          </button>
          <button type="button" className="icon-button" onClick={() => goTo(index + 1)} aria-label="下一句" disabled={index >= total - 1}><NextIcon /></button>
          <button type="button" className="player-text" onClick={toggleMode} aria-label="切换播放方式">{settings.playMode === "one" ? "单句" : "全文"}</button>
        </div>
      </section>

      {explaining && <ExplanationSheet explanation={explaining} text={sentence.text} onClose={() => setExplaining(null)} />}
      {word && <WordSheet target={word} material={material} settings={settings} onClose={() => setWord(null)} />}
    </main>
  );
}

function ExplanationSheet({ explanation, text, onClose }: { explanation: Explanation; text: string; onClose: () => void }) {
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
        <p className="fr explain-text" lang="fr">{text}</p>
        {explanation.summary && <p>{explanation.summary}</p>}
        {explanation.structure && section("句子结构", [explanation.structure])}
        {section("语法点", explanation.grammarPoints)}
        {section("易错点", explanation.pitfalls)}
        {section("换个说法", explanation.examples)}
        <span className="pill pill-ok">{explanation.model ? `本机 AI（${explanation.model}）生成` : "AI 生成"} · 已离线保存</span>
        <button type="button" className="button button-outline" onClick={onClose}>关闭</button>
      </div>
    </Modal>
  );
}
