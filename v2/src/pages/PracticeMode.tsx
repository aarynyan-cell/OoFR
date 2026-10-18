import { useEffect, useMemo, useState } from "react";
import { speakOnce } from "../app/audio";
import { href } from "../app/router";
import { toast } from "../app/toast";
import { markStudiedToday, saveSentence } from "../db/repo";
import type { Material, Settings } from "../db/types";
import { type Exercise, buildExercises, isCorrect } from "../practice/exercises";
import { tokenize } from "../text/tokens";
import { frenchSpacing } from "../text/typography";
import { PlayIcon } from "../ui/icons";
import { LessonTop } from "./LessonTop";

const PROMPTS: Record<Exercise["kind"], string> = {
  listen: "听一听，选出你听到的句子",
  cloze: "选出缺的那个词",
  order: "按顺序点出这句话"
};

export function PracticeMode({ material, settings, trackName, tapeTitle }: { material: Material; settings: Settings; trackName: string; tapeTitle: string }) {
  const [round, setRound] = useState(0);
  // A new set of questions each round; the material's sentences are read once per round.
  const exercises = useMemo(() => buildExercises(material), [round, material.id]);
  const [position, setPosition] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);

  const exercise = exercises[position];
  const finished = position >= exercises.length;

  const restart = () => {
    setRound((value) => value + 1);
    setPosition(0);
    setResults([]);
  };

  return (
    <main className="page page-lesson">
      <LessonTop material={material} mode="practice" trackName={trackName} tapeTitle={tapeTitle} />
      <div className="practice-body">
        {finished ? (
          <Summary material={material} exercises={exercises} results={results} onRestart={restart} />
        ) : exercise ? (
          <>
            <div className="practice-progress">
              <span className="progress grow" aria-hidden="true"><span style={{ width: `${(position / exercises.length) * 100}%` }} /></span>
              <span className="mono small muted">{position + 1} / {exercises.length}</span>
            </div>
            <Question
              key={`${round}-${position}`}
              exercise={exercise}
              material={material}
              settings={settings}
              onAnswered={(correct) => {
                setResults((current) => [...current, correct]);
                if (position === 0) void markStudiedToday();
              }}
              onNext={() => setPosition((current) => current + 1)}
            />
          </>
        ) : (
          <p className="empty">这条素材太短，还出不了题。</p>
        )}
      </div>
    </main>
  );
}

function Question({ exercise, material, settings, onAnswered, onNext }: {
  exercise: Exercise;
  material: Material;
  settings: Settings;
  onAnswered: (correct: boolean) => void;
  onNext: () => void;
}) {
  const sentence = material.sentences[exercise.sentence];
  const [picked, setPicked] = useState<number | string | null>(null);
  const [order, setOrder] = useState<number[]>([]);
  const answered = exercise.kind === "order" ? order.length === exercise.pieces.length : picked !== null;
  const correct = answered && isCorrect(exercise, exercise.kind === "order" ? order.map((index) => exercise.pieces[index]) : picked!);
  const speak = () => speakOnce(sentence.text, settings, material.language);

  useEffect(() => {
    if (exercise.kind === "listen") speak();
    // Speak once when the question appears.
  }, []);

  useEffect(() => {
    if (!answered) return;
    onAnswered(correct);
    if (exercise.kind !== "listen") speak();
  }, [answered]);

  const optionClass = (isAnswer: boolean, isPicked: boolean) =>
    `option${answered && isAnswer ? " option-right" : ""}${answered && isPicked && !isAnswer ? " option-wrong" : ""}`;

  return (
    <section className="card practice-card" aria-live="polite">
      <p className="muted small">{PROMPTS[exercise.kind]}</p>

      {exercise.kind === "listen" && (
        <>
          <button type="button" className="round-button round-accent round-large align-center" onClick={speak} aria-label="再听一遍"><PlayIcon size={26} /></button>
          <div className="options">
            {exercise.options.map((option) => (
              <button key={option} type="button" className={`fr ${optionClass(option === exercise.sentence, picked === option)}`} lang={material.language} disabled={answered} onClick={() => setPicked(option)}>
                {frenchSpacing(material.sentences[option].text)}
              </button>
            ))}
          </div>
        </>
      )}

      {exercise.kind === "cloze" && (
        <>
          <p className="fr practice-sentence" lang={material.language}>
            {tokenize(sentence.text).map((token, index) =>
              index === exercise.blank ? <span key={index} className={`blank${answered ? " blank-filled" : ""}`}>{answered ? exercise.answer : "____"}</span> : <span key={index}>{frenchSpacing(token.text)}</span>
            )}
          </p>
          {sentence.translation && <p className="dim small">{sentence.translation}</p>}
          <div className="options options-grid">
            {exercise.options.map((option) => (
              <button key={option} type="button" className={`fr ${optionClass(option === exercise.answer, picked === option)}`} lang={material.language} disabled={answered} onClick={() => setPicked(option)}>
                {option}
              </button>
            ))}
          </div>
        </>
      )}

      {exercise.kind === "order" && (
        <>
          {sentence.translation && <p className="dim small">{sentence.translation}</p>}
          <div className={`order-line fr${answered ? (correct ? " order-right" : " order-wrong") : ""}`} lang={material.language} aria-label="你排出的句子">
            {order.length ? order.map((index, position) => (
              <button key={position} type="button" className="chip" disabled={answered} onClick={() => setOrder((current) => current.filter((_, at) => at !== position))}>
                {exercise.pieces[index]}
              </button>
            )) : <span className="dim small">点下面的词，按顺序组成句子</span>}
          </div>
          <div className="chips">
            {exercise.pieces.map((piece, index) => (
              <button key={index} type="button" className="chip fr" lang={material.language} disabled={order.includes(index) || answered} onClick={() => setOrder((current) => [...current, index])}>
                {piece}
              </button>
            ))}
          </div>
        </>
      )}

      {answered && (
        <div className="stack-8">
          <p className={correct ? "ok-text" : "accent-text"}><b>{correct ? "答对了！" : "差一点"}</b></p>
          {!correct && <p className="fr" lang={material.language}>正确答案：{frenchSpacing(sentence.text)}</p>}
          <button type="button" className="button button-primary" onClick={onNext}>下一题</button>
        </div>
      )}
    </section>
  );
}

function Summary({ material, exercises, results, onRestart }: { material: Material; exercises: Exercise[]; results: boolean[]; onRestart: () => void }) {
  const right = results.filter(Boolean).length;
  const missed = exercises.filter((_, index) => results[index] === false).map((exercise) => material.sentences[exercise.sentence]);
  const save = async (index: number) => {
    await saveSentence(material, missed[index]);
    toast("已收藏到词句本，会在复习里再见到它");
  };
  return (
    <section className="stack-16">
      <div className="card stack-8 center">
        <p className="mono practice-score">{right} / {exercises.length}</p>
        <p className="muted">{right === exercises.length ? "全部答对，这条素材你已经很熟了！" : "做完了。错的句子可以收藏起来，复习时再练。"}</p>
      </div>
      {missed.length > 0 && (
        <ul className="list list-plain">
          {missed.map((sentence, index) => (
            <li key={sentence.id} className="list-row">
              <span className="grow fr" lang={material.language}>{frenchSpacing(sentence.text)}</span>
              <button type="button" className="button button-outline button-small" onClick={() => save(index)}>收藏</button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid-2">
        <button type="button" className="button button-outline" onClick={onRestart}>再练一次</button>
        <a className="button button-primary" href={href({ name: "lesson", id: material.id })}>回到听读</a>
      </div>
    </section>
  );
}
