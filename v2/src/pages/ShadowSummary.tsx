import { useState } from "react";
import { useCardIndex } from "../app/cards";
import { speakOnce } from "../app/audio";
import { shareOrDownload } from "../app/download";
import { toggleRecordings, useRecordingPlayback } from "../app/recordings";
import { toast } from "../app/toast";
import { db } from "../db/database";
import { useLive } from "../db/live";
import { setPosition, toggleSentence } from "../db/repo";
import type { Material, Sentence, Settings } from "../db/types";
import { buildShadowReport } from "../practice/shadowReport";
import { mergeRecordings } from "../speech/wav";
import { SaveToggle } from "../ui/SaveToggle";
import { SentenceText } from "../ui/SentenceText";
import { type WordTarget, WordSheet } from "../ui/WordSheet";
import { DownloadIcon, PlayIcon, SpeakerIcon, StopIcon } from "../ui/icons";

// After shadowing: an overall comment, words to look at again, sentences worth
// saving, playback of the whole reading or one sentence, and the audio to keep.
export function ShadowSummary({ material, settings, onRestart }: { material: Material; settings: Settings; onRestart: () => void }) {
  const report = buildShadowReport(material);
  const cards = useCardIndex();
  const playback = useRecordingPlayback();
  const [word, setWord] = useState<WordTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const read = material.sentences.map((sentence, index) => ({ sentence, index })).filter(({ sentence }) => sentence.recordingKey);
  const recordings = useLive(async () => (await db.recordings.bulkGet(read.map(({ sentence }) => sentence.recordingKey))).filter(Boolean), [read.map(({ sentence }) => sentence.recordingKey).join()]);
  const blobs = (recordings ?? []).map((recording) => recording!.blob);
  const playingIndex = playback.key === `shadow:${material.id}:all` && playback.status === "playing" ? read[playback.index]?.index : undefined;

  const toggleSave = async (sentence: Sentence) => toast((await toggleSentence(material, sentence)) ? "已收藏到词句本" : "已取消收藏");

  const playOne = (sentence: Sentence, position: number) => {
    const blob = recordings?.[position]?.blob;
    if (blob) toggleRecordings(`shadow:${material.id}:${sentence.id}`, [blob]);
  };

  const download = async () => {
    setSaving(true);
    try {
      const { wav, skipped } = await mergeRecordings(blobs);
      const outcome = await shareOrDownload(wav, `${material.title}-跟读.wav`);
      if (outcome !== "cancelled") toast(skipped ? `跟读音频已生成（${skipped} 句无法读取，已跳过）` : "跟读音频已生成");
    } catch (error) {
      toast(error instanceof Error ? error.message : "没能生成音频");
    } finally {
      setSaving(false);
    }
  };

  const restart = () => {
    void setPosition(material.id, 0);
    onRestart();
  };

  return (
    <div className="stack-16">
      <section className="card stack-10 summary-card">
        <div className="row-between">
          <span className="mono eyebrow">跟读总结 · {report.read} / {report.total} 句</span>
          {report.average !== null && <span className="mono summary-score">{Math.round(report.average * 100)}<small>分</small></span>}
        </div>
        <p>{report.comment}</p>
        {blobs.length > 0 && (
          <div className="grid-2">
            <button type="button" className="button button-primary" onClick={() => toggleRecordings(`shadow:${material.id}:all`, blobs)}>
              {playingIndex !== undefined ? <StopIcon size={18} /> : <PlayIcon size={18} />}
              {playingIndex !== undefined ? "停止回放" : "全文回放"}
            </button>
            <button type="button" className="button button-outline" onClick={download} disabled={saving}>
              <DownloadIcon size={18} />{saving ? "正在生成…" : "保存跟读音频"}
            </button>
          </div>
        )}
      </section>

      {report.missedWords.length > 0 && (
        <section className="stack-8">
          <h2 className="section-title">常读不准的词</h2>
          <div className="chips">
            {report.missedWords.map(({ word: missed, count }) => {
              const card = cards.word(missed);
              return (
                <button key={missed} type="button" className={`chip fr${card ? ` mark-${card.status}` : ""}`} lang={material.language}
                  onClick={() => setWord({ text: missed, occurrence: 0, context: missed, words: [missed], index: 0 })}>
                  {missed}{count > 1 ? <span className="dim small">×{count}</span> : null}
                </button>
              );
            })}
          </div>
          <p className="dim small">点一个词听发音、看意思，觉得有用就收藏。</p>
        </section>
      )}

      {report.weakSentences.length > 0 && (
        <section className="stack-8">
          <h2 className="section-title">建议收藏的句子</h2>
          <ul className="list list-plain">
            {report.weakSentences.map((index) => {
              const sentence = material.sentences[index];
              const card = cards.phrase(sentence.text);
              return (
                <li key={sentence.id} className="list-row summary-row">
                  <span className="grow stack-4">
                    <span className="fr" lang={material.language}><MissedText sentence={sentence} /></span>
                    {typeof sentence.shadow?.score === "number" && <span className="dim small">{Math.round(sentence.shadow.score * 100)} 分</span>}
                  </span>
                  <SaveToggle variant="small" saved={Boolean(card)} tone={card?.status} onToggle={() => void toggleSave(sentence)} />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {read.length > 0 && (
        <section className="stack-8">
          <h2 className="section-title">逐句回放</h2>
          <ul className="list list-plain">
            {read.map(({ sentence, index }, position) => {
              const key = `shadow:${material.id}:${sentence.id}`;
              const playingOne = playback.key === key && playback.status === "playing";
              return (
                <li key={sentence.id} className={`list-row summary-row${playingIndex === index ? " is-playing" : ""}`}>
                  <span className="mono track">{String(index + 1).padStart(2, "0")}</span>
                  <span className="grow fr" lang={material.language}><SentenceText text={sentence.text} cards={cards} /></span>
                  <button type="button" className="round-button round-outline" onClick={() => speakOnce(sentence.text, settings, material.language)} aria-label="听原声"><SpeakerIcon size={18} /></button>
                  <button type="button" className="round-button round-outline" onClick={() => playOne(sentence, position)} aria-label={playingOne ? "停止" : "听我的"}>
                    {playingOne ? <StopIcon size={16} /> : <PlayIcon size={16} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <button type="button" className="button button-outline" onClick={restart}>从第一句再跟读一遍</button>
      {word && <WordSheet target={word} material={material} settings={settings} onClose={() => setWord(null)} />}
    </div>
  );
}

// The sentence with the words that were not heard right marked.
function MissedText({ sentence }: { sentence: Sentence }) {
  const missed = new Set((sentence.shadow?.missed ?? []).map((word) => word.toLocaleLowerCase("fr-FR")));
  return (
    <>
      {sentence.text.split(/(\s+)/).map((part, index) => {
        const bare = part.replace(/[^\p{L}\p{M}'’-]/gu, "").toLocaleLowerCase("fr-FR");
        return bare && missed.has(bare) ? <mark key={index} className="missed">{part}</mark> : <span key={index}>{part}</span>;
      })}
    </>
  );
}
