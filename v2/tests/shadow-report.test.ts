import { describe, expect, it } from "vitest";
import { starterContent } from "../src/db/starter";
import { buildShadowReport } from "../src/practice/shadowReport";
import { encodeWav, resample } from "../src/speech/wav";

const lesson = starterContent().material;
const withTakes = (scores: (number | null | undefined)[], missed: string[][] = []) => ({
  ...lesson,
  sentences: lesson.sentences.map((sentence, index) =>
    scores[index] === undefined
      ? sentence
      : { ...sentence, recordingKey: `rec:${index}`, shadow: { score: scores[index] ?? null, missed: missed[index] ?? [], heard: "", at: "2026-10-18T10:00:00Z" } }
  )
});

describe("shadowing summary", () => {
  it("praises a clean reading and notes unread sentences", () => {
    const report = buildShadowReport(withTakes([1, 1, 0.96]));
    expect(report).toMatchObject({ read: 3, total: 6, weakSentences: [] });
    expect(report.comment).toContain("非常清楚");
    expect(report.comment).toContain("还有 3 句没读");
  });

  it("lists the words missed most and the weakest sentences first", () => {
    const report = buildShadowReport(withTakes([0.9, 0.5, 0.75, 1], [["dix"], ["merci", "dix"], ["vous"], []]));
    expect(report.missedWords).toEqual([{ word: "dix", count: 2 }, { word: "merci", count: 1 }, { word: "vous", count: 1 }]);
    expect(report.weakSentences).toEqual([1, 2]);
    expect(report.average).toBeCloseTo(0.7875);
    expect(report.comment).toContain("不错");
  });

  it("explains when the device could not score the takes", () => {
    expect(buildShadowReport(withTakes([null, null])).comment).toContain("不能自动打分");
    expect(buildShadowReport(lesson).comment).toContain("还没有跟读录音");
  });
});

describe("joining recordings into one file", () => {
  it("writes a valid 16-bit mono WAV header", async () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1]), 22050);
    const view = new DataView(await wav.arrayBuffer());
    const text = (offset: number, length: number) => String.fromCharCode(...new Uint8Array(view.buffer, offset, length));
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(22050);
    expect(view.getUint32(40, true)).toBe(10);
    expect(view.getInt16(44 + 3 * 2, true)).toBe(32767);
    expect(view.getInt16(44 + 4 * 2, true)).toBe(-32768);
    expect(wav.type).toBe("audio/wav");
  });

  it("resamples to the target rate", () => {
    expect(resample(new Float32Array(44100), 44100, 22050)).toHaveLength(22050);
    const ramp = resample(new Float32Array([0, 1]), 1, 2);
    expect(Array.from(ramp)).toEqual([0, 0.5, 1, 1]);
  });
});
