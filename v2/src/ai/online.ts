// Free online AI (2.1): SiliconFlow and Zhipu, with the learner's own free keys.
// Keys stay on this device (not in backups, not synced) and go only to the
// provider they belong to. Requests rotate over the learner's keys and fall
// back to the next model when one is busy, out of quota or failing.
//
// Both providers speak the OpenAI chat format and allow calls from web pages.

import { db } from "../db/database";
import { type AiBackend, AiError, type ChatBody } from "./backend";

export type ProviderId = "siliconflow" | "zhipu";
export const ONLINE_KEYS = "online.keys";

export interface Provider {
  id: ProviderId;
  name: string;
  base: string;
  signup: string;
}

export const PROVIDERS: Record<ProviderId, Provider> = {
  siliconflow: { id: "siliconflow", name: "硅基流动", base: "https://api.siliconflow.cn/v1", signup: "https://cloud.siliconflow.cn/i/y1ddnCxC" },
  zhipu: { id: "zhipu", name: "智谱 AI", base: "https://open.bigmodel.cn/api/paas/v4", signup: "https://open.bigmodel.cn" }
};

export interface Route {
  provider: ProviderId;
  model: string;
  // A translation-only model: plain text in, plain text out, no JSON.
  translationOnly?: boolean;
  // Qwen3 models "think" first unless told not to.
  noThinking?: boolean;
}

export type Task = "translate" | "explain";

// Order tried for each task: only models the providers list as free (checked
// on SiliconFlow's price list, 2026-10-22: Hunyuan-MT-7B is free, its small
// Qwen models are not listed as free; Zhipu's GLM-4-Flash is free). The free
// general model on SiliconFlow (Xing4.0-29B) took about a minute and got the
// grammar wrong, so explanations go to Zhipu only.
export const ROUTES: Record<Task, Route[]> = {
  translate: [
    { provider: "siliconflow", model: "tencent/Hunyuan-MT-7B", translationOnly: true },
    { provider: "zhipu", model: "glm-4-flash" }
  ],
  explain: [{ provider: "zhipu", model: "glm-4-flash" }]
};

export type OnlineKeys = Record<ProviderId, string[]>;

export async function loadKeys(): Promise<OnlineKeys> {
  const value = (await db.kv.get(ONLINE_KEYS))?.value as Partial<OnlineKeys> | undefined;
  return { siliconflow: value?.siliconflow ?? [], zhipu: value?.zhipu ?? [] };
}

// One key per line; spaces and duplicates removed.
export function cleanKeys(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((key) => key.trim()).filter((key) => key.length >= 16 && /^[\w.\-]+$/.test(key)))];
}

export async function saveKeys(keys: OnlineKeys): Promise<void> {
  await db.kv.put({ key: ONLINE_KEYS, value: { siliconflow: keys.siliconflow, zhipu: keys.zhipu } });
}

export const hasKeys = (keys: OnlineKeys) => keys.siliconflow.length + keys.zhipu.length > 0;

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

  private async send(attempt: Attempt, messages: ChatBody["messages"], options: { json: boolean; maxTokens: number; temperature: number }, signal?: AbortSignal): Promise<string> {
    const { route, key } = attempt;
    const body: Record<string, unknown> = { model: route.model, messages, stream: false, temperature: options.temperature, max_tokens: options.maxTokens };
    if (options.json && !route.translationOnly) body.response_format = { type: "json_object" };
    if (route.noThinking) body.enable_thinking = false;
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
    if (!response.ok) throw new AiError(`${PROVIDERS[route.provider].name} 返回 ${response.status}`);
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = String(data.choices?.[0]?.message?.content ?? "").trim();
    if (!content) throw new AiError("没有回答");
    this.lastModel = route.model;
    return content;
  }

  // Tries each model and key in turn; the first good answer wins.
  private async firstAnswer(task: Task, messages: ChatBody["messages"], options: { json: boolean; maxTokens: number; temperature: number }, accept: (text: string, route: Route) => boolean, signal?: AbortSignal, skipTranslationOnly = false): Promise<string> {
    const attempts = this.attempts(task).filter((attempt) => !(skipTranslationOnly && attempt.route.translationOnly));
    if (!attempts.length) throw new AiError("还没有填写在线 AI 的密钥");
    let last: unknown = null;
    for (const attempt of attempts) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const text = await this.send(attempt, messages, options, signal);
        if (accept(text, attempt.route)) return text;
        last = new AiError("回答格式不对");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError" && signal?.aborted) throw error;
        last = error;
      }
    }
    throw last instanceof Error ? last : new AiError("在线 AI 暂时没有回答");
  }

  // Structured answers (explanations, batch translations) from a general model.
  async chat(body: ChatBody, signal?: AbortSignal, task: Task = "explain"): Promise<string> {
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
    const text = await this.firstAnswer(task, messages, { json: Boolean(body.format), maxTokens: body.options?.num_predict ?? 900, temperature: body.options?.temperature ?? 0.2 }, accept, signal, true);
    return body.format ? jsonIn(text) : text;
  }

  // Sentence translations: the translation model, one sentence a request (it
  // returns plain text); general models are only asked when it cannot answer.
  async translateLines(lines: string[], sourceLanguage: string, signal?: AbortSignal): Promise<(string | null)[]> {
    const out: (string | null)[] = [];
    for (const line of lines) {
      const messages = [{ role: "user" as const, content: `Translate the following segment into Chinese, without additional explanation.\n\n${line}` }];
      try {
        out.push(
          await this.firstAnswer("translate", messages, { json: false, maxTokens: 400, temperature: 0.1 }, (text) => /[㐀-鿿]/u.test(text), signal)
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        out.push(null);
      }
    }
    void sourceLanguage;
    return out;
  }

  // Checks one key with the cheapest request there is (SiliconFlow lists its
  // models; Zhipu has no list, so it gets a one-word question to its free model).
  static async check(provider: ProviderId, key: string, fetcher: Fetcher = (...args) => fetch(...args)): Promise<boolean> {
    try {
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
      const response =
        provider === "siliconflow"
          ? await fetcher(`${PROVIDERS.siliconflow.base}/models`, { headers, signal: AbortSignal.timeout(15000) })
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
