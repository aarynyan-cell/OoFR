import { useEffect, useRef, useState } from "react";
import { speakOnce } from "../app/audio";
import { toast } from "../app/toast";
import { db } from "../db/database";
import { useLive } from "../db/live";
import { markStudiedToday, saveRecording, setPosition } from "../db/repo";
import type { Material, Settings } from "../db/types";
import { player } from "../speech/player";
import { type Listening, canRecognize, listen } from "../speech/recognizer";
import { type RecordingSession, RecorderError, recordingProblem, startRecording, waveform } from "../speech/recorder";
import { type SpeechCheck, compareSpeech } from "../text/compare";
import { frenchSpacing } from "../text/typography";
import { MicIcon, PlayIcon, SpeakerIcon } from "../ui/icons";
import { LessonTop } from "./LessonTop";

interface Attempt {
  check: SpeechCheck | null;
  heard: string;
  bars: number[];
}

const seconds = (ms: number) => `0:${String(Math.round(ms / 1000)).padStart(2, "0")}`;

export function ShadowMode({ material, settings, trackName, tapeTitle }: { material: Material; settings: Settings; trackName: string; tapeTitle: string }) {
  const total = material.sentences.length;
  const index = Math.min(Math.max(0, material.position), total - 1);
  const sentence = material.sentences[index];
  const lang = material.language === "en" ? "en-US" : "fr-FR";
  const [phase, setPhase] = useState<"idle" | "recording" | "checking">("idle");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const session = useRef<RecordingSession | null>(null);
  const listening = useRef<Listening | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const recording = useLive(async () => (sentence.recordingKey ? db.recordings.get(sentence.recordingKey) : undefined), [sentence.recordingKey]);
  const problem = recordingProblem();

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

  useEffect(() => () => stopMine(), []);

  useEffect(() => {
    if (phase !== "recording") return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - started), 250);
    return () => clearInterval(timer);
  }, [phase]);

  function stopMine() {
    if (!audio.current) return;
    audio.current.pause();
    URL.revokeObjectURL(audio.current.src);
    audio.current = null;
  }

  const playMine = () => {
    if (!recording) return;
    player.stop();
    stopMine();
    const element = new Audio(URL.createObjectURL(recording.blob));
    element.onended = stopMine;
    audio.current = element;
    void element.play().catch(() => toast("这段录音播放不了"));
  };

  const begin = async () => {
    player.stop();
    stopMine();
    setAttempt(null);
    try {
      session.current = await startRecording();
    } catch (error) {
      toast(error instanceof RecorderError ? error.message : "录音没能开始");
      return;
    }
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
      await saveRecording(material.id, sentence.id, take);
      void markStudiedToday();
      setAttempt({ heard, bars, check: heard ? compareSpeech(sentence.text, heard) : null });
    } catch (error) {
      listening.current?.cancel();
      listening.current = null;
      toast(error instanceof RecorderError ? error.message : "这次没录好，请再试一次");
    } finally {
      setPhase("idle");
    }
  };

  const goTo = (next: number) => {
    stopMine();
    void setPosition(material.id, Math.min(Math.max(0, next), total - 1));
  };

  const recordLabel = phase === "recording" ? `读完点一下 · ${seconds(elapsed)}` : phase === "checking" ? "正在对比…" : "按一下开始跟读";

  return (
    <main className="page page-lesson">
      <LessonTop material={material} mode="shadow" trackName={trackName} tapeTitle={tapeTitle} />

      <div className="shadow-body">
        <section className="card stack-10 shadow-sentence">
          <span className="mono eyebrow">{String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
          <p className="fr shadow-text" lang={material.language}>{frenchSpacing(sentence.text)}</p>
          {sentence.translation && <p className="muted small">{sentence.translation}</p>}
        </section>

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
            <span className="round-button round-outline round-medium"><SpeakerIcon size={22} /></span>听我的
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
              </>
            ) : (
              <p className="muted small">{canRecognize() ? "没有听清这一遍，可以再读一次，或者回放自己的录音听一听。" : "这台设备不能自动对比，可以回放自己的录音和原声比一比。"}</p>
            )}
          </section>
        )}
      </div>

      <div className="bottom-actions">
        <button type="button" className="button button-outline" onClick={() => goTo(index - 1)} disabled={index === 0 || phase !== "idle"}>上一句</button>
        <button type="button" className="button button-primary" onClick={() => goTo(index + 1)} disabled={index >= total - 1 || phase !== "idle"}>下一句</button>
      </div>
    </main>
  );
}
