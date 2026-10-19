import { useEffect, useRef, useState } from "react";
import { speakOnce } from "../app/audio";
import { toast } from "../app/toast";
import { db } from "../db/database";
import { useLive } from "../db/live";
import { useCardIndex } from "../app/cards";
import { stopRecordingAudio, toggleRecordings, useRecordingPlayback } from "../app/recordings";
import { markStudiedToday, saveRecording, setPosition, toggleSentence } from "../db/repo";
import type { Material, Settings } from "../db/types";
import { player } from "../speech/player";
import { type Listening, canRecognize, listen } from "../speech/recognizer";
import { type RecordingSession, RecorderError, recordingProblem, startRecording, waveform } from "../speech/recorder";
import { type MicState, askMicrophone, canOpenSystemSettings, micState, micSteps, openSystemSettings } from "../speech/microphone";
import { type SpeechCheck, compareSpeech } from "../text/compare";
import { frenchSpacing } from "../text/typography";
import { SaveToggle } from "../ui/SaveToggle";
import { SentenceText } from "../ui/SentenceText";
import { type WordTarget, WordSheet } from "../ui/WordSheet";
import { MicIcon, PlayIcon, SpeakerIcon, StopIcon } from "../ui/icons";
import { ShadowSummary } from "./ShadowSummary";
import { LessonTop } from "./LessonTop";

interface Attempt {
  check: SpeechCheck | null;
  heard: string;
  bars: number[];
}

const seconds = (ms: number) => `0:${String(Math.round(ms / 1000)).padStart(2, "0")}`;

// The allow-microphone question is shown once per visit, as soon as shadowing opens.
let askedThisVisit = false;

export function ShadowMode({ material, settings, trackName, tapeTitle }: { material: Material; settings: Settings; trackName: string; tapeTitle: string }) {
  const total = material.sentences.length;
  const index = Math.min(Math.max(0, material.position), total - 1);
  const sentence = material.sentences[index];
  const lang = material.language === "en" ? "en-US" : "fr-FR";
  const [phase, setPhase] = useState<"idle" | "recording" | "checking">("idle");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [view, setView] = useState<"read" | "summary">("read");
  const [word, setWord] = useState<WordTarget | null>(null);
  const session = useRef<RecordingSession | null>(null);
  const listening = useRef<Listening | null>(null);
  const recording = useLive(async () => (sentence.recordingKey ? db.recordings.get(sentence.recordingKey) : undefined), [sentence.recordingKey]);
  const cards = useCardIndex();
  const savedCard = cards.phrase(sentence.text);
  const playback = useRecordingPlayback();
  const mineKey = `shadow:${material.id}:${sentence.id}`;
  const anyTakes = material.sentences.some((item) => item.recordingKey);
  const problem = recordingProblem();
  const [mic, setMic] = useState<MicState>("unknown");

  // Shadowing needs the microphone: ask straight away instead of waiting for the first take.
  useEffect(() => {
    if (problem) return;
    void micState().then(async (state) => {
      // The Mac app's web view cannot report the system's answer in advance; asking is what adds OoFR to System Settings.
      if (state === "granted" || (state === "denied" && !canOpenSystemSettings()) || askedThisVisit) return setMic(state);
      askedThisVisit = true;
      setMic(await askMicrophone());
    });
  }, []);

  const retryMic = async () => {
    const state = await askMicrophone();
    setMic(state);
    if (state === "granted") toast("麦克风已经可以用了");
  };

  // A new sentence starts with a clean slate; leaving stops the microphone.
  useEffect(() => {
    setAttempt(null);
    return () => {
      session.current?.cancel();
      listening.current?.cancel();
      session.current = null;
      listening.current = null;
      setPhase("idle");
    };
  }, [sentence.id]);

  useEffect(() => () => stopRecordingAudio(), []);

  useEffect(() => {
    if (phase !== "recording") return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - started), 250);
    return () => clearInterval(timer);
  }, [phase]);

  const playMine = () => recording && toggleRecordings(mineKey, [recording.blob]);

  const begin = async () => {
    player.stop();
    stopRecordingAudio();
    setAttempt(null);
    try {
      session.current = await startRecording();
    } catch (error) {
      if (error instanceof RecorderError && /允许/.test(error.message)) setMic("denied");
      toast(error instanceof RecorderError ? error.message : "录音没能开始");
      return;
    }
    setMic("granted");
    listening.current = listen(lang);
    setElapsed(0);
    setPhase("recording");
  };

  const finish = async () => {
    const current = session.current;
    if (!current) return;
    setPhase("checking");
    session.current = null;
    try {
      const take = await current.stop();
      const heard = (await listening.current?.finish()) ?? "";
      listening.current = null;
      const bars = await waveform(take.blob);
      const check = heard ? compareSpeech(sentence.text, heard) : null;
      await saveRecording(material.id, sentence.id, take, { score: check ? check.score : null, missed: check?.missed ?? [], heard });
      void markStudiedToday();
      setAttempt({ heard, bars, check });
    } catch (error) {
      listening.current?.cancel();
      listening.current = null;
      toast(error instanceof RecorderError ? error.message : "这次没录好，请再试一次");
    } finally {
      setPhase("idle");
    }
  };

  const goTo = (next: number) => {
    stopRecordingAudio();
    void setPosition(material.id, Math.min(Math.max(0, next), total - 1));
  };

  const toggleSave = async () => toast((await toggleSentence(material, sentence)) ? "已收藏到词句本" : "已取消收藏");

  const recordLabel = phase === "recording" ? `读完点一下 · ${seconds(elapsed)}` : phase === "checking" ? "正在对比…" : "按一下开始跟读";

  return (
    <main className="page page-lesson">
      <LessonTop material={material} mode="shadow" trackName={trackName} tapeTitle={tapeTitle} />

      {view === "summary" ? (
        <div className="shadow-body">
          <button type="button" className="text-button" onClick={() => setView("read")}>‹ 回到跟读</button>
          <ShadowSummary material={material} settings={settings} onRestart={() => setView("read")} />
        </div>
      ) : (
        <>
          <div className="shadow-body">
            <section className="card stack-10 shadow-sentence">
              <div className="row-between">
                <span className="mono eyebrow">{String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
                {anyTakes && <button type="button" className="text-button" onClick={() => setView("summary")}>跟读总结 ›</button>}
              </div>
              <p className="fr shadow-text" lang={material.language}>
                <SentenceText text={sentence.text} cards={cards} onWord={(tapped) => setWord({ ...tapped, context: sentence.text })} active={word} />
              </p>
              {sentence.translation && <p className="muted small">{sentence.translation}</p>}
            </section>

            {mic === "denied" && !problem && (
              <section className="card stack-10 mic-help" role="alert">
                <h2 className="sheet-subtitle">跟读需要麦克风</h2>
                <ol className="bullets">{micSteps().map((step) => <li key={step}>{step}</li>)}</ol>
                <div className="row-8">
                  {canOpenSystemSettings() && <button type="button" className="button button-primary button-small" onClick={() => void openSystemSettings()}>打开系统设置</button>}
                  <button type="button" className="button button-outline button-small" onClick={() => void retryMic()}>再试一次</button>
                </div>
              </section>
            )}

            <section className="record-row" aria-label="录音控制">
              <button type="button" className="record-side" onClick={() => speakOnce(sentence.text, settings, material.language)}>
                <span className="round-button round-outline round-medium"><PlayIcon size={22} /></span>听原声
              </button>
              <button
                type="button"
                className={`record-main${phase === "recording" ? " is-recording" : ""}`}
                onClick={phase === "recording" ? finish : begin}
                disabled={phase === "checking" || Boolean(problem)}
                aria-label={recordLabel}
              >
                <span className="record-button"><MicIcon size={32} /></span>
                {recordLabel}
              </button>
              <button type="button" className="record-side" onClick={playMine} disabled={!recording}>
                <span className="round-button round-outline round-medium">{playback.key === mineKey && playback.status === "playing" ? <StopIcon size={20} /> : <SpeakerIcon size={22} />}</span>听我的
              </button>
            </section>
            <p className="dim small center">
              {problem || (recording ? `上一遍录音 ${seconds(recording.durationMs)}${canRecognize() ? " · 读完会自动和原句对比" : ""}` : canRecognize() ? "读完会自动和原句对比" : "读完可以回放，对比自己和原声")}
            </p>

            {attempt && (
              <section className="card stack-10" aria-live="polite">
                {attempt.bars.length > 0 && (
                  <div className="wave-row">
                    <span className="dim small">我的</span>
                    <span className="wave" aria-hidden="true">
                      {attempt.bars.map((bar, barIndex) => (
                        <span key={barIndex} className={attempt.check && !attempt.check.missed.length ? "wave-ok" : ""} style={{ height: `${4 + Math.round(bar * 24)}px` }} />
                      ))}
                    </span>
                  </div>
                )}
                {attempt.check ? (
                  <>
                    <p className="fr shadow-check" lang={material.language}>
                      {attempt.check.tokens.map((token, tokenIndex) =>
                        token.word && !token.ok ? <mark key={tokenIndex} className="missed">{token.text}</mark> : <span key={tokenIndex}>{frenchSpacing(token.text)}</span>
                      )}
                    </p>
                    <p className="muted small">
                      {attempt.check.missed.length === 0
                        ? "每个词都读出来了，很好！"
                        : `有 ${attempt.check.missed.length} 个词可能没读准：${attempt.check.missed.join("、")}。点“听原声”再对比一下。`}
                    </p>
                    <p className="dim small">听到的是：{attempt.heard}</p>
                    {attempt.check.missed.length > 0 && (
                      <SaveToggle variant="small" saved={Boolean(savedCard)} tone={savedCard?.status} onToggle={() => void toggleSave()} label="收藏这句，复习时再练" />
                    )}
                  </>
                ) : (
                  <p className="muted small">{canRecognize() ? "没有听清这一遍，可以再读一次，或者回放自己的录音听一听。" : "这台设备不能自动对比，可以回放自己的录音和原声比一比。"}</p>
                )}
              </section>
            )}
          </div>

          <div className="bottom-actions">
            <button type="button" className="button button-outline" onClick={() => goTo(index - 1)} disabled={index === 0 || phase !== "idle"}>上一句</button>
            {index >= total - 1 ? (
              <button type="button" className="button button-primary" onClick={() => setView("summary")} disabled={phase !== "idle" || !anyTakes}>完成，看总结</button>
            ) : (
              <button type="button" className="button button-primary" onClick={() => goTo(index + 1)} disabled={phase !== "idle"}>下一句</button>
            )}
          </div>
        </>
      )}
      {word && <WordSheet target={word} material={material} settings={settings} onClose={() => setWord(null)} />}
    </main>
  );
}
