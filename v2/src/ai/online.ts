// Free online AI (2.1): Groq, SiliconFlow and Zhipu, with the learner's own
// free keys. Keys stay on this device (not in backups, not synced) and go only
// to the provider they belong to. Requests rotate over the learner's keys and
// fall back to the next model when one is busy, out of quota or failing.
//
// All three speak the OpenAI chat format and allow calls from web pages.

import { db } from "../db/database";
import { GeminiSpeech } from "../speech/gemini";
import { type AiBackend, AiError, type ChatBody } from "./backend";

// gemini: only for voices (src/speech/gemini.ts), not for translations or explanations.
export type ProviderId = "groq" | "siliconflow" | "zhipu" | "gemini";
export const ONLINE_KEYS = "online.keys";
// The order the key boxes are shown in: the recommended provider first.
export const PROVIDER_ORDER: ProviderId[] = ["groq", "siliconflow", "zhipu", "gemini"];
// The providers whose models translate and explain.
const AI_PROVIDERS: ProviderId[] = ["groq", "siliconflow", "zhipu"];

export interface Provider {
  id: ProviderId;
  name: string;
  base: string;
  signup: string;
  note: string;
}

export const PROVIDERS: Record<ProviderId, Provider> = {
  groq: { id: "groq", name: "Groq", base: "https://api.groq.com/openai/v1", signup: "https://console.groq.com/keys", note: "推荐：最快最准，翻译和讲解都用它" },
  siliconflow: { id: "siliconflow", name: "硅基流动", base: "https://api.siliconflow.cn/v1", signup: "https://cloud.siliconflow.cn/i/y1ddnCxC", note: "备用：国内直连，需要实名认证" },
  zhipu: { id: "zhipu", name: "智谱 AI", base: "https://open.bigmodel.cn/api/paas/v4", signup: "https://open.bigmodel.cn", note: "可选：讲解的备用" },
  gemini: { id: "gemini", name: "Gemini", base: "https://generativelanguage.googleapis.com/v1beta", signup: "https://aistudio.google.com/app/apikey", note: "手机的优化语音：自然的法语朗读，不用电脑" }
};

export interface Route {
  provider: ProviderId;
  model: string;
  // A translation-only model: plain text in, plain text out, no JSON.
  translationOnly?: boolean;
  // Extra request fields, e.g. turning "thinking" off.
  extra?: Record<string, unknown>;
}

export type Task = "translate" | "explain";

// Order tried for each task. Compared on the same lessons (2026-10-22, idioms,
// context, numbers): Qwen3.8-27B on Groq made no mistakes and answered in a
// fraction of a second, and wrote a fully correct explanation; GLM-4-9B and
// Qwen3.5-4B on SiliconFlow translate well (GLM also explains, Qwen3.5-4B's
// explanations were slow and wrong); Hunyuan-MT-7B reversed "Tu me manques".
const QWEN_GROQ: Route = { provider: "groq", model: "qwen/qwen3.8-27b", extra: { reasoning_effort: "none" } };
const GLM_SF: Route = { provider: "siliconflow", model: "THUDM/GLM-4-9B-0414" };
export const ROUTES: Record<Task, Route[]> = {
  translate: [
    QWEN_GROQ,
    GLM_SF,
    { provider: "siliconflow", model: "Qwen/Qwen3.5-4B", extra: { enable_thinking: false } },
    { provider: "siliconflow", model: "tencent/Hunyuan-MT-7B", translationOnly: true },
    { provider: "zhipu", model: "glm-4-flash" }
  ],
  explain: [QWEN_GROQ, { provider: "zhipu", model: "glm-4-flash" }, GLM_SF]
};

export type OnlineKeys = Record<ProviderId, string[]>;

const noKeys = (): OnlineKeys => ({ groq: [], siliconflow: [], zhipu: [], gemini: [] });

export async function loadKeys(): Promise<OnlineKeys> {
  const value = (await db.kv.get(ONLINE_KEYS))?.value as Partial<OnlineKeys> | undefined;
  return { groq: value?.groq ?? [], siliconflow: value?.siliconflow ?? [], zhipu: value?.zhipu ?? [], gemini: value?.gemini ?? [] };
}

// One key per line; spaces and duplicates removed.
export function cleanKeys(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((key) => key.trim()).filter((key) => key.length >= 16 && /^[\w.\-]+$/.test(key)))];
}

// What a whole key looks like: Groq "gsk_…", SiliconFlow "sk-…", Zhipu
// "<id>.<secret>" (a key copied only up to the dot is refused by Zhipu).
export function looksComplete(provider: ProviderId, key: string): boolean {
  if (provider === "groq") return /^gsk_[A-Za-z0-9]{30,}$/.test(key);
  if (provider === "siliconflow") return /^sk-[A-Za-z0-9]{20,}$/.test(key);
  if (provider === "gemini") return /^AIza[0-9A-Za-z_-]{30,}$/.test(key);
  return /^[A-Za-z0-9]{16,}\.[A-Za-z0-9]{8,}$/.test(key);
}

export async function saveKeys(keys: Partial<OnlineKeys>): Promise<void> {
  const all = { ...noKeys(), ...keys };
  await db.kv.put({ key: ONLINE_KEYS, value: { groq: all.groq, siliconflow: all.siliconflow, zhipu: all.zhipu, gemini: all.gemini } });
  keyListeners.forEach((listener) => listener());
}

// Someone may want to know when keys change (the phone's voices follow the Gemini key).
const keyListeners = new Set<() => void>();
export function onKeysChange(listener: () => void): () => void {
  keyListeners.add(listener);
  return () => keyListeners.delete(listener);
}

// Online AI (translations, explanations) is on with any of these keys; a Gemini key only gives voices.
export const hasKeys = (keys: OnlineKeys) => AI_PROVIDERS.some((provider) => keys[provider].length > 0);

// Some key reaches a model that can explain (a SiliconFlow key always does, through GLM-4-9B).
export const canExplainWith = (keys: OnlineKeys) => ROUTES.explain.some((route) => keys[route.provider].length > 0);

// The JSON in an answer, also when the model wrapped it in ```json fences or text.
export function jsonIn(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const body = (fenced ?? text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

// The fields a JSON schema asks for, written out for models without schema support.
function describeSchema(schema: unknown): string {
  return `只返回一个 JSON 对象，不要任何其他文字。结构：${JSON.stringify(schema)}`;
}

type Fetcher = typeof fetch;

const CJK = /[㐀-鿿]/u;
// One request translates up to this many sentences.
const LINES_PER_REQUEST = 20;

// Hunyuan-MT's own instruction for translating into Chinese; general models
// get the same lines with an instruction as the system message.
const translationPrompt = (text: string) => `把下面的文本翻译成中文，不要额外解释，保持一行对应一行。\n\n${text}`;
const TRANSLATOR = "你是专业的法译中译者。把每一行翻译成自然、准确的简体中文，习语按意思翻译，人名保留原文。只输出译文，保持原来的编号，一行一句，不要解释。";

function translationMessages(route: Route, text: string): ChatBody["messages"] {
  return route.translationOnly
    ? [{ role: "user", content: translationPrompt(text) }]
    : [
        { role: "system", content: TRANSLATOR },
        { role: "user", content: text }
      ];
}

// A busy model (too many requests a minute) waits this long unless the provider says.
const BUSY_PAUSE_MS = 20000;
// The longest wait for a busy model when no other model can answer.
const LONGEST_WAIT_MS = 60000;
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });

// Remove the "thinking" some models write before the answer.
const withoutThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

const isAbort = (error: unknown, signal?: AbortSignal) => error instanceof DOMException && error.name === "AbortError" && Boolean(signal?.aborted);

// "1. 你好" lines back in their places (null where one is missing).
export function numberedLines(text: string, count: number): (string | null)[] {
  const out: (string | null)[] = Array.from({ length: count }, () => null);
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const numbered = lines.map((line) => /^(\d+)\s*[.、．)）:：]\s*(.*)$/.exec(line));
  if (numbered.every(Boolean)) {
    for (const match of numbered) {
      const at = Number(match![1]) - 1;
      if (at >= 0 && at < count && !out[at]) out[at] = match![2].trim() || null;
    }
  } else if (lines.length === count) {
    lines.forEach((line, index) => (out[index] = line.replace(/^\d+\s*[.、．)）:：]\s*/, "")));
  }
  return out;
}

// "这对我来说没有意义（或者说：……）" → the translation without the note in
// brackets, when the sentence itself has no brackets.
export function withoutNotes(translation: string, source: string): string {
  if (/[(（]/.test(source)) return translation.trim();
  const clean = translation.replace(/\s*[（(][^（）()]*[）)]\s*/g, "").trim();
  return CJK.test(clean) ? clean : translation.trim();
}

interface Attempt {
  route: Route;
  key: string;
}

export class OnlineBackend implements AiBackend {
  readonly kind = "online" as const;
  // The model that wrote the last answer, for the explanation's label.
  lastModel = "";
  private turn = 0;
  // Keys the provider refused (wrong or deleted) are skipped until the page reloads.
  private refused = new Set<string>();
  // A model and key that answered "too many requests" rest until then (Groq allows so much a minute).
  private resting = new Map<string, number>();

  constructor(private readonly keys: OnlineKeys, private readonly fetcher: Fetcher = (...args) => fetch(...args)) {}

  async version(): Promise<string | null> {
    return hasKeys(this.keys) ? "online" : null;
  }

  async models(): Promise<string[]> {
    return [...new Set([...ROUTES.translate, ...ROUTES.explain].filter((route) => this.keys[route.provider].length).map((route) => route.model))];
  }

  async pull(): Promise<void> {
    throw new AiError("在线 AI 不需要下载模型");
  }

  // Every model of the task, each with the keys of its provider, starting from a
  // different key each time so the keys share the load.
  private attempts(task: Task): Attempt[] {
    const start = this.turn++;
    return ROUTES[task].flatMap((route) => {
      const keys = this.keys[route.provider].filter((key) => !this.refused.has(key));
      return keys.map((_, index) => ({ route, key: keys[(start + index) % keys.length] }));
    });
  }

  private restKey = (attempt: Attempt) => `${attempt.route.model}|${attempt.key}`;

  // How long until a resting attempt may be tried again (0: now).
  private restLeft(attempt: Attempt): number {
    return Math.max(0, (this.resting.get(this.restKey(attempt)) ?? 0) - Date.now());
  }

  private async send(attempt: Attempt, messages: ChatBody["messages"], options: { json: boolean; maxTokens: number; temperature: number }, signal?: AbortSignal): Promise<string> {
    const { route, key } = attempt;
    const body: Record<string, unknown> = { model: route.model, messages, stream: false, temperature: options.temperature, max_tokens: options.maxTokens, ...(route.extra ?? {}) };
    if (options.json && !route.translationOnly) body.response_format = { type: "json_object" };
    const timeout = AbortSignal.timeout(90000);
    const response = await this.fetcher(`${PROVIDERS[route.provider].base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    });
    if (response.status === 401) {
      this.refused.add(key);
      throw new AiError("密钥无效");
    }
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after"));
      this.resting.set(this.restKey(attempt), Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : BUSY_PAUSE_MS));
      throw new AiError(`${PROVIDERS[route.provider].name} 太忙，稍等一下`);
    }
    if (!response.ok) throw new AiError(`${PROVIDERS[route.provider].name} 返回 ${response.status}`);
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = withoutThinking(String(data.choices?.[0]?.message?.content ?? ""));
    if (!content) throw new AiError("没有回答");
    this.lastModel = route.model;
    return content;
  }

  // Tries each model and key in turn; the first good answer wins. Resting
  // ones are passed over; when only resting ones are left, it waits for the
  // first to be ready again (at most a minute).
  private async firstAnswer(
    task: Task,
    messagesFor: (route: Route) => ChatBody["messages"],
    options: { json: boolean; maxTokens: number; temperature: number },
    accept: (text: string, route: Route) => boolean,
    signal?: AbortSignal,
    skipTranslationOnly = false,
    // Background work waits for a resting better model instead of moving on.
    patient = false
  ): Promise<string> {
    const attempts = this.attempts(task).filter((attempt) => !(skipTranslationOnly && attempt.route.translationOnly));
    if (!attempts.length) throw new AiError("还没有填写在线 AI 的密钥");
    let last: unknown = null;
    const tried = new Set<Attempt>();
    for (;;) {
      let again = false;
      for (const attempt of attempts) {
        if (tried.has(attempt) || this.refused.has(attempt.key)) continue;
        const rest = this.restLeft(attempt);
        if (rest > 0) {
          if (!patient || rest > LONGEST_WAIT_MS) continue;
          await sleep(rest + 200, signal);
        }
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        tried.add(attempt);
        try {
          const text = await this.send(attempt, messagesFor(attempt.route), options, signal);
          if (accept(text, attempt.route)) return text;
          last = new AiError("回答格式不对");
        } catch (error) {
          if (isAbort(error, signal)) throw error;
          last = error;
          // A busy model may be tried again once it has rested; background work waits for it.
          if (this.restLeft(attempt) > 0) {
            tried.delete(attempt);
            if (patient) {
              again = true;
              break;
            }
          }
        }
      }
      if (again) continue;
      const waits = attempts.filter((attempt) => !tried.has(attempt) && !this.refused.has(attempt.key)).map((attempt) => this.restLeft(attempt)).filter((left) => left > 0);
      const wait = waits.length ? Math.min(...waits) : 0;
      if (!wait || wait > LONGEST_WAIT_MS) break;
      await sleep(wait + 200, signal);
    }
    throw last instanceof Error ? last : new AiError("在线 AI 暂时没有回答");
  }

  // Structured answers (explanations, batch translations) from a general model.
  async chat(body: ChatBody, signal?: AbortSignal, task: Task = "explain", patient = false): Promise<string> {
    const messages = body.format
      ? [{ role: "system" as const, content: `${body.messages.find((message) => message.role === "system")?.content ?? ""}\n${describeSchema(body.format)}` }, ...body.messages.filter((message) => message.role !== "system")]
      : body.messages;
    const accept = (text: string) => {
      if (!body.format) return true;
      try {
        JSON.parse(jsonIn(text));
        return true;
      } catch {
        return false;
      }
    };
    const text = await this.firstAnswer(task, () => messages, { json: Boolean(body.format), maxTokens: body.options?.num_predict ?? 900, temperature: body.options?.temperature ?? 0.2 }, accept, signal, true, patient);
    return body.format ? jsonIn(text) : text;
  }

  // Sentence translations: a lesson's sentences go together, one numbered
  // line each, so the model sees the context ("Vous la voulez bien cuite ?" at
  // the bakery is about the bread); lines that do not come back are asked one
  // by one. Notes the model adds in brackets are left out.
  async translateLines(lines: string[], sourceLanguage: string, signal?: AbortSignal, patient = false): Promise<(string | null)[]> {
    const out: (string | null)[] = lines.map(() => null);
    for (let start = 0; start < lines.length; start += LINES_PER_REQUEST) {
      const part = lines.slice(start, start + LINES_PER_REQUEST);
      try {
        const numbered = part.map((line, index) => `${index + 1}. ${line}`).join("\n");
        const text = await this.firstAnswer("translate", (route) => translationMessages(route, numbered), { json: false, maxTokens: 120 + 90 * part.length, temperature: 0.1 }, (answer) => CJK.test(answer), signal, false, patient);
        numberedLines(text, part.length).forEach((line, index) => {
          if (line && CJK.test(line)) out[start + index] = withoutNotes(line, part[index]);
        });
      } catch (error) {
        if (isAbort(error, signal)) throw error;
      }
      for (const [index, line] of part.entries()) {
        if (out[start + index]) continue;
        try {
          const text = await this.firstAnswer("translate", (route) => translationMessages(route, `1. ${line}`), { json: false, maxTokens: 400, temperature: 0.1 }, (answer) => CJK.test(answer), signal, false, patient);
          out[start + index] = withoutNotes(numberedLines(text, 1)[0] ?? text, line);
        } catch (error) {
          if (isAbort(error, signal)) throw error;
        }
      }
    }
    void sourceLanguage;
    return out;
  }

  // Checks one key with the cheapest request there is (Groq and SiliconFlow
  // list their models; Zhipu has no list, so it gets a one-word question to its free model).
  static async check(provider: ProviderId, key: string, fetcher: Fetcher = (...args) => fetch(...args)): Promise<boolean> {
    if (provider === "gemini") return GeminiSpeech.check(key, fetcher);
    try {
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
      const response =
        provider !== "zhipu"
          ? await fetcher(`${PROVIDERS[provider].base}/models`, { headers, signal: AbortSignal.timeout(15000) })
          : await fetcher(`${PROVIDERS.zhipu.base}/chat/completions`, {
              method: "POST",
              headers,
              body: JSON.stringify({ model: "glm-4-flash", messages: [{ role: "user", content: "你好" }], max_tokens: 4 }),
              signal: AbortSignal.timeout(20000)
            });
      return response.ok;
    } catch {
      return false;
    }
  }
}
