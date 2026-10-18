import { useEffect, useState } from "react";
import { speakOnce } from "../app/audio";
import { href } from "../app/router";
import { db } from "../db/database";
import { useLive } from "../db/live";
import { getSettings, gradeCard, reviewQueue } from "../db/repo";
import type { Card } from "../db/types";
import { type Grade, preview } from "../review/fsrs";
import { frenchSpacing } from "../text/typography";
import { CloseIcon, SpeakerIcon } from "../ui/icons";

const ANSWERS: { grade: Grade; label: string }[] = [
  { grade: 1, label: "忘了" },
  { grade: 2, label: "模糊" },
  { grade: 3, label: "记得" }
];

export function ReviewPage() {
  const cards = useLive(() => db.cards.toArray(), []);
  const settings = useLive(() => getSettings(), []);
  // The session works on the queue as it was when it started; forgotten cards return at the end.
  const [queue, setQueue] = useState<string[] | null>(null);
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(0);

  useEffect(() => {
    if (cards && queue === null) setQueue(reviewQueue(cards).map((card) => card.id));
  }, [cards, queue]);

  if (!cards || !queue || !settings) return <main className="page" aria-busy="true" />;

  const card: Card | undefined = cards.find((item) => item.id === queue[position]);
  if (!card) {
    return (
      <main className="page review-done">
        <h1 className="page-title">{done ? "今天的复习完成了" : "现在没有要复习的"}</h1>
        <p className="muted">{done ? `复习了 ${done} 次。记忆会在快忘的时候再提醒你。` : "收藏的词句到了该复习的时候，会出现在这里。"}</p>
        <a className="button button-primary" href={href({ name: "today" })}>回到今日</a>
      </main>
    );
  }

  const labels = preview(card.review);
  const answer = async (grade: Grade) => {
    await gradeCard(card.id, grade);
    setDone((count) => count + 1);
    if (grade === 1) setQueue((current) => [...(current ?? []), card.id]);
    setRevealed(false);
    setPosition((current) => current + 1);
  };

  return (
    <main className="page page-review">
      <header className="review-head">
        <a className="icon-button" href={href({ name: "today" })} aria-label="结束复习"><CloseIcon size={22} /></a>
        <span className="progress grow" aria-hidden="true"><span style={{ width: `${(position / queue.length) * 100}%` }} /></span>
        <span className="mono small muted">{String(position + 1).padStart(2, "0")}/{String(queue.length).padStart(2, "0")}</span>
      </header>

      <section className="card review-card">
        <span className="row-8 dim small">
          <span className="tag">{card.kind === "word" ? "单词" : "句子"}</span>
          {card.sourceTitle && <span>来自 {card.sourceTitle}</span>}
        </span>
        <div className="review-face">
          <p className={`fr review-text${card.kind === "word" ? " review-word" : ""}`} lang={card.language}>{frenchSpacing(card.text)}</p>
          <button type="button" className="round-button round-outline round-medium align-center" onClick={() => speakOnce(card.text, settings, card.language)} aria-label="再听一遍">
            <SpeakerIcon size={22} />
          </button>
          {revealed ? (
            <>
              <div className="side-b" aria-hidden="true"><span /><span className="mono">SIDE B</span><span /></div>
              <p className="review-answer">{card.translation || "还没有中文释义"}</p>
              {card.kind === "word" && (card.ipa || card.partOfSpeech) && <p className="dim small center">{[card.ipa, card.partOfSpeech].filter(Boolean).join(" · ")}</p>}
            </>
          ) : (
            <button type="button" className="button button-outline align-center" onClick={() => setRevealed(true)}>看答案</button>
          )}
        </div>
      </section>

      {revealed && (
        <>
          <p className="dim small center">这句你记得怎么样？</p>
          <div className="answers">
            {ANSWERS.map((item) => (
              <button key={item.grade} type="button" className={`answer${item.grade === 3 ? " answer-good" : ""}`} onClick={() => answer(item.grade)}>
                <b>{item.label}</b>
                <span>{labels[item.grade]}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
