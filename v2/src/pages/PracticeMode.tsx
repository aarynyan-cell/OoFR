import { useEffect, useMemo, useState } from "react";
import { speakOnce, usePlayer } from "../app/audio";
import { href } from "../app/router";
import { toast } from "../app/toast";
import { useCardIndex } from "../app/cards";
import { markStudiedToday, saveSettings, toggleSentence } from "../db/repo";
import type { Material, Sentence, Settings } from "../db/types";
import { EXERCISE_KINDS, type Exercise, type ExerciseKind, buildExercises, isCorrect } from "../practice/exercises";
import { tokenize } from "../text/tokens";
import { frenchSpacing } from "../text/typography";
import { SaveToggle } from "../ui/SaveToggle";
import { CheckIcon, PlayIcon } from "../ui/icons";
import { LessonTop } from "./LessonTop";

const PROMPTS: Record<Exercise["kind"], string> = {
  listen: "听一听，选出你听到的句子",
  cloze: "选出缺的那个词",
  order: "按顺序点出这句话"
};

const KIND_INFO: Record<ExerciseKind, { label: string; hint: string }> = {
  listen: { label: "听音选句", hint: "听一句，选出听到的是哪句" },
  cloze: { label: "选词填空", hint: "句子里缺一个词，从四个里选" },
  order: { label: "连词成句", hint: "把打乱的词按顺序点回来" }
};

const REVEAL_SECONDS = 5;

export function PracticeMode({ material, settings, trackName, tapeTitle }: { material: Material; settings: Settings; trackName: string; tapeTitle: string }) {
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<"setup" | "running">("setup");
  const kinds = settings.practiceKinds.length ? settings.practiceKinds : EXERCISE_KINDS;
  // A new set of questions each round, from the kinds chosen on the setup screen.
  const exercises = useMemo(() => buildExercises(material, Math.random, kinds), [round, material.id, kinds.join()]);
  const [position, setPosition] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);

  const exercise = exercises[position];
  const finished = position >= exercises.length;

  const start = () => {
    setRound((value) => value + 1);
    setPosition(0);
    setResults([]);
    setPhase("running");
  };

  const toggleKind = (kind: ExerciseKind) => {
    const next = kinds.includes(kind) ? kinds.filter((item) => item !== kind) : [...kinds, kind];
    if (!next.length) {
      toast("至少选一种题型");
      return;
    }
    void saveSettings({ practiceKinds: EXERCISE_KINDS.filter((item) => next.includes(item)) });
  };

  return (
    <main className="page page-lesson">
      <LessonTop material={material} mode="practice" trackName={trackName} tapeTitle={tapeTitle} />
      <div className="practice-body">
        {phase === "setup" ? (
          <section className="stack-16">
            <h2 className="section-title">选择题型</h2>
            <div className="kind-list" role="group" aria-label="题型">
              {EXERCISE_KINDS.map((kind) => (
                <button key={kind} type="button" className="kind-card" aria-pressed={kinds.includes(kind)} onClick={() => toggleKind(kind)}>
                  <span className="kind-check" aria-hidden="true">{kinds.includes(kind) && <CheckIcon size={16} />}</span>
                  <span className="grow stack-2">
                    <b>{KIND_INFO[kind].label}</b>
                    <span className="muted small">{KIND_INFO[kind].hint}</span>
                  </span>
                </button>
              ))}
            </div>
            <button type="button" className="button button-primary button-block" onClick={start} disabled={!exercises.length}>
              {exercises.length ? `开始练习 · ${exercises.length} 题` : "这条素材出不了这些题型"}
            </button>
          </section>
        ) : finished ? (
          <Summary material={material} exercises={exercises} results={results} onRestart={start} onChangeKinds={() => setPhase("setup")} />
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
        ) : null}
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
  // Time ran out before an answer: the answer is shown and counts as not known.
  const [revealed, setRevealed] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const chosen = exercise.kind === "order" ? order.length === exercise.pieces.length : picked !== null;
  const answered = chosen || revealed;
  const correct = chosen && isCorrect(exercise, exercise.kind === "order" ? order.map((index) => exercise.pieces[index]) : picked!);
  const key = `practice:${exercise.kind}:${exercise.sentence}`;
  const speak = () => speakOnce(sentence.text, settings, material.language, key);
  const playerState = usePlayer();
  const speaking = playerState.key === key && playerState.status !== "idle";

  // Every question reads its sentence when it appears.
  useEffect(() => {
    speak();
  }, []);

  // Five seconds after the sentence has been read, the answer shows by itself
  // (not once the learner has started putting the words in order).
  const started = exercise.kind === "order" && order.length > 0;
  useEffect(() => {
    if (answered || speaking || started) {
      setLeft(null);
      return;
    }
    setLeft(REVEAL_SECONDS);
    const timer = setInterval(() => setLeft((value) => (value === null ? null : Math.max(0, value - 1))), 1000);
    return () => clearInterval(timer);
  }, [answered, speaking, started]);

  useEffect(() => {
    if (left === 0 && !answered) setRevealed(true);
  }, [left]);

  useEffect(() => {
    if (!answered) return;
    onAnswered(correct);
    if (chosen && exercise.kind !== "listen") speak();
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

      {!answered && left !== null && <p className="dim small countdown" aria-live="polite">{left} 秒后显示答案</p>}

      {answered && (
        <div className="stack-8">
          <p className={correct ? "ok-text" : "accent-text"}><b>{correct ? "答对了！" : revealed ? "时间到" : "差一点"}</b></p>
          {!correct && <p className="fr" lang={material.language}>正确答案：{frenchSpacing(sentence.text)}</p>}
          <button type="button" className="button button-primary" onClick={onNext}>下一题</button>
        </div>
      )}
    </section>
  );
}

function Summary({ material, exercises, results, onRestart, onChangeKinds }: {
  material: Material;
  exercises: Exercise[];
  results: boolean[];
  onRestart: () => void;
  onChangeKinds: () => void;
}) {
  const cards = useCardIndex();
  const right = results.filter(Boolean).length;
  const missed = exercises.filter((_, index) => results[index] === false).map((exercise) => material.sentences[exercise.sentence]);
  const toggle = async (sentence: Sentence) => toast((await toggleSentence(material, sentence)) ? "已收藏，会在复习里再见到它" : "已取消收藏");
  return (
    <section className="stack-16">
      <div className="card stack-8 center">
        <p className="mono practice-score">{right} / {exercises.length}</p>
        <p className="muted">{right === exercises.length ? "全部答对，这条素材你已经很熟了！" : "做完了。错的句子可以收藏起来，复习时再练。"}</p>
      </div>
      {missed.length > 0 && (
        <ul className="list list-plain">
          {missed.map((sentence) => {
            const card = cards.phrase(sentence.text);
            return (
              <li key={sentence.id} className="list-row">
                <span className="grow fr" lang={material.language}>{frenchSpacing(sentence.text)}</span>
                <SaveToggle variant="small" saved={Boolean(card)} tone={card?.status} onToggle={() => void toggle(sentence)} />
              </li>
            );
          })}
        </ul>
      )}
      <div className="grid-2">
        <button type="button" className="button button-outline" onClick={onChangeKinds}>换题型</button>
        <button type="button" className="button button-primary" onClick={onRestart}>再练一次</button>
      </div>
      <a className="text-button align-center" href={href({ name: "lesson", id: material.id })}>回到听读</a>
    </section>
  );
}
