// What OoFR asks the local AI: lesson translations and sentence explanations.
// Answers fill a JSON form (Ollama structured output), so they always parse.

import type { Explanation, Language, Material, Sentence } from "../db/types";
import { nowIso } from "../db/defaults";
import { type AiBackend, AiError } from "./backend";
import { type SentenceFacts, TERMS, factLines, factsText } from "./grammar";

// Keeps the model in memory for a few minutes between sentences, then frees it.
export const KEEP_ALIVE = "3m";
export const EXPLANATION_VERSION = "2.0-1";

const LANGUAGE_NAME: Record<Language, string> = { fr: "法语", en: "英语" };
const CJK = /[㐀-鿿]/u;

export const TEACHER =
  "你是面向中文母语者的外语老师。所有解释只用简体中文；外语原句、单词和例句保留原文。不写拼音，解释里不出现英文单词。不确定的内容不要写。" + TERMS;

interface Ask {
  prompt: string;
  schema: unknown;
  maxTokens: number;
  signal?: AbortSignal;
}

export async function askJson<T>(backend: AiBackend, model: string, { prompt, schema, maxTokens, signal }: Ask): Promise<T> {
  const content = await backend.chat(
    {
      model,
      stream: false,
      // qwen3.5 otherwise "thinks" for minutes before answering.
      think: false,
      keep_alive: KEEP_ALIVE,
      format: schema,
      options: { temperature: 0.2, num_ctx: 8192, num_predict: maxTokens },
      messages: [
        { role: "system", content: TEACHER },
        { role: "user", content: prompt }
      ]
    },
    signal
  );
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new AiError("本机 AI 的回答不完整，请再试一次");
  }
}

const text = (value: unknown, limit: number) => (typeof value === "string" ? value.trim().slice(0, limit) : "");
// Left out: items cut off at the length limit, and the model thinking aloud ("等等", "词典事实").
const THINKING = /词典事实|等等|不质疑|需严格遵循|\?{2,}|？等/u;
const keep = (item: string, limit: number) => Boolean(item) && item.length < limit - 1 && !THINKING.test(item);
const list = (value: unknown, limit: number, count: number) =>
  (Array.isArray(value) ? value : []).map((item) => text(item, limit + 1)).filter((item) => keep(item, limit + 1)).slice(0, count);

// Sentence id → Chinese translation, for the sentences given (one lesson, in order).
export async function translateSentences(backend: AiBackend, model: string, material: Material, sentences: Sentence[], signal?: AbortSignal): Promise<Map<string, string>> {
  const items = sentences.map((sentence, index) => ({ id: index, text: sentence.text }));
  const schema = {
    type: "object",
    properties: {
      translations: {
        type: "array",
        minItems: items.length,
        maxItems: items.length,
        items: { type: "object", properties: { id: { type: "integer" }, zh: { type: "string", maxLength: 240 } }, required: ["id", "zh"] }
      }
    },
    required: ["translations"]
  };
  const prompt =
    `把这些${LANGUAGE_NAME[material.language]}句子翻译成自然、准确的简体中文。它们按顺序来自同一篇素材《${material.title}》。` +
    "习语按意思翻译，人名保留原文；不要解释，不要漏句或合并，id 保持不变。只返回要求的 JSON。\n\n" +
    JSON.stringify(items);
  const data = await askJson<{ translations?: { id?: unknown; zh?: unknown }[] }>(backend, model, { prompt, schema, maxTokens: 120 + 90 * items.length, signal });
  const result = new Map<string, string>();
  for (const item of data.translations ?? []) {
    const sentence = typeof item.id === "number" ? sentences[item.id] : undefined;
    const zh = text(item.zh, 240);
    if (sentence && CJK.test(zh)) result.set(sentence.id, zh);
  }
  return result;
}

const EXPLAIN_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", maxLength: 120 },
    structure: { type: "string", maxLength: 160 },
    grammarPoints: { type: "array", minItems: 1, maxItems: 3, items: { type: "string", maxLength: 160 } },
    pitfalls: { type: "array", minItems: 0, maxItems: 2, items: { type: "string", maxLength: 140 } },
    examples: { type: "array", minItems: 1, maxItems: 2, items: { type: "string", maxLength: 160 } }
  },
  required: ["summary", "structure", "grammarPoints", "pitfalls", "examples"]
};

export async function explainSentence(
  backend: AiBackend,
  model: string,
  material: Material,
  sentence: Sentence,
  facts: SentenceFacts | null,
  signal?: AbortSignal
): Promise<Explanation> {
  const index = material.sentences.findIndex((item) => item.id === sentence.id);
  const before = material.sentences[index - 1]?.text;
  const after = material.sentences[index + 1]?.text;
  const known = facts ? factsText(facts) : "";
  const prompt = [
    `讲解这个${LANGUAGE_NAME[material.language]}句子。`,
    `句子：${sentence.text}`,
    sentence.translation && `参考译文：${sentence.translation}`,
    (before || after) && `上下文：${[before && `前一句「${before}」`, after && `后一句「${after}」`].filter(Boolean).join("，")}`,
    known && `词典确定的事实（讲解必须与之一致，不要改成别的时态或语式；没有列出的词，不要断言它的时态）：\n${known}`,
    "要求：summary 用一句话写这句的中文意思；structure 用中文成分名写句子骨架，每个成分后面写对应的原文词，例如“主语 je + 谓语 voudrais + 宾语 pratiquer le français + 时间状语 pendant dix minutes”；" +
      "grammarPoints 写最多 3 个最重要的语法点；" +
      "pitfalls 写最多 2 个学习者容易错的地方，没有就留空；examples 写 1 到 2 个可以替换练习的原文例句，每句后面用括号附中文。" +
      "只写这句里确实有的语法现象和你有把握的内容，宁可少写也不要编造；不谈拼写和发音，除非完全确定。" +
      "直接写结论，不写思考过程，也不要提“词典事实”这几个字。只返回要求的 JSON。"
  ]
    .filter(Boolean)
    .join("\n\n");
  const data = await askJson<Record<string, unknown>>(backend, model, { prompt, schema: EXPLAIN_SCHEMA, maxTokens: 900, signal });
  const summary = text(data.summary, 120);
  if (!summary) throw new AiError("本机 AI 没有给出讲解，请再试一次");
  return {
    summary,
    structure: text(data.structure, 160),
    grammarPoints: list(data.grammarPoints, 160, 3),
    // Word forms come from the dictionary, not from the model.
    morphology: facts ? factLines(facts).join("\n") : "",
    pitfalls: list(data.pitfalls, 140, 2),
    examples: list(data.examples, 160, 2),
    model,
    language: "zh",
    version: EXPLANATION_VERSION,
    source: "local-ai",
    generatedAt: nowIso()
  };
}

// 词典修正: is the learner's Chinese meaning of a word right? The local AI
// checks it against the Wiktionary senses before it replaces the dictionary's.
export interface MeaningCheck {
  ok: boolean;
  reason: string;
  // The AI's own accurate meaning, offered when the learner's is not right.
  suggestion: string;
}

export interface MeaningToCheck {
  word: string;
  lemma: string;
  partOfSpeech: string;
  english: string[];
  current: string;
  proposed: string;
  context?: string;
}

const MEANING_SCHEMA = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    reason: { type: "string", maxLength: 120 },
    suggestion: { type: "string", maxLength: 80 }
  },
  required: ["ok", "reason", "suggestion"]
};

export async function checkMeaningFix(backend: AiBackend, model: string, item: MeaningToCheck, signal?: AbortSignal): Promise<MeaningCheck> {
  const prompt =
    `${TEACHER}\n你在审核学习者对法语词典的修改：判断学习者给的中文释义是否准确（意思对、和词性相符、不含糊）。\n` +
    `单词：${item.word}${item.lemma && item.lemma !== item.word ? `（原形 ${item.lemma}）` : ""}${item.partOfSpeech ? `，${item.partOfSpeech}` : ""}\n` +
    (item.english.length ? `维基词典的英文释义：${item.english.slice(0, 6).join("; ")}\n` : "") +
    (item.context ? `出现的句子：${item.context}\n` : "") +
    `词典原来的中文：${item.current || "（没有）"}\n` +
    `学习者的修改：${item.proposed}\n` +
    "修改准确、或比原来更好时 ok 为 true；意思不对、词性不符或含糊时 ok 为 false。reason 用一句简体中文说明理由。" +
    "suggestion 写你认为准确的中文释义，几个义项用顿号分开。只返回要求的 JSON。";
  const data = await askJson<{ ok?: unknown; reason?: unknown; suggestion?: unknown }>(backend, model, { prompt, schema: MEANING_SCHEMA, maxTokens: 220, signal });
  const suggestion = text(data.suggestion, 80);
  return { ok: data.ok === true, reason: text(data.reason, 120), suggestion: CJK.test(suggestion) ? suggestion : "" };
}

