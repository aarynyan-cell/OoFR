import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { OnlineBackend, ROUTES, cleanKeys, jsonIn, loadKeys, looksComplete, numberedLines, saveKeys, withoutNotes } from "../src/ai/online";
import { aiState, refreshAi, resetAiForTests } from "../src/ai/state";
import { explainSentence, translateSentences } from "../src/ai/tasks";
import { createBackup } from "../src/backup/backup";
import { OoFRDatabase, setDatabase } from "../src/db/database";
import type { Material } from "../src/db/types";

interface Call {
  url: string;
  key: string;
  model: string;
  body: Record<string, unknown>;
}

// A pretend provider: answers by model, can be told to fail for some keys or models.
function provider(behaviour: { failModels?: string[]; badKeys?: string[]; busyKeys?: string[]; answer?: (model: string, body: Record<string, unknown>) => string }) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const key = String((init?.headers as Record<string, string>)?.Authorization ?? "").replace("Bearer ", "");
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const model = String(body.model ?? "");
    calls.push({ url, key, model, body });
    if (behaviour.badKeys?.includes(key)) return new Response("{}", { status: 401 });
    if (behaviour.busyKeys?.includes(key)) return new Response("{}", { status: 429 });
    if (behaviour.failModels?.includes(model)) return new Response("{}", { status: 503 });
    const content = behaviour.answer ? behaviour.answer(model, body) : "你好";
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
  }) as typeof fetch;
  return { calls, fetcher };
}

const material = { id: "m", title: "t", language: "fr", sentences: [{ id: "a", text: "Bonjour.", translation: "" }, { id: "b", text: "Merci.", translation: "" }] } as unknown as Material;

describe("free online AI", () => {
  it("translates a lesson's sentences together with the translation model, as numbered lines", async () => {
    const { calls, fetcher } = provider({ answer: (model) => (model.includes("Hunyuan") ? "1. 你好。\n2. 谢谢（或者说：多谢）。" : "{}") });
    const backend = new OnlineBackend({ siliconflow: ["sk-aaaaaaaaaaaaaaaaaaaa"], zhipu: [] }, fetcher);
    const result = await translateSentences(backend, "在线 AI", material, material.sentences);
    expect([...result]).toEqual([["a", "你好。"], ["b", "谢谢。"]]);
    expect(calls.map((call) => call.model)).toEqual(["tencent/Hunyuan-MT-7B"]);
    expect(String((calls[0].body.messages as { content: string }[])[0].content)).toContain("1. Bonjour.\n2. Merci.");
    expect(calls[0].url).toBe("https://api.siliconflow.cn/v1/chat/completions");
    expect(calls[0].body.response_format).toBeUndefined();
  });

  it("asks again one by one for lines that did not come back", async () => {
    const { calls, fetcher } = provider({ answer: (_model, body) => (String((body.messages as { content: string }[])[0].content).includes("1. ") ? "1. 你好。" : "谢谢。") });
    const backend = new OnlineBackend({ siliconflow: ["sk-aaaaaaaaaaaaaaaaaaaa"], zhipu: [] }, fetcher);
    expect(await backend.translateLines(["Bonjour.", "Merci."], "fr")).toEqual(["你好。", "谢谢。"]);
    expect(calls).toHaveLength(2);
  });

  it("reads numbered lines back and leaves out notes in brackets", () => {
    expect(numberedLines("1. 你好\n2、谢谢\n3) 再见", 3)).toEqual(["你好", "谢谢", "再见"]);
    expect(numberedLines("1. 你好\n3. 再见", 3)).toEqual(["你好", null, "再见"]);
    expect(numberedLines("你好\n谢谢", 2)).toEqual(["你好", "谢谢"]);
    expect(withoutNotes("这对我没意义（或者说：没用）。", "Ça ne me dit rien qui vaille.")).toBe("这对我没意义。");
    expect(withoutNotes("见第 3 页（附录）", "Voir page 3 (annexe)")).toBe("见第 3 页（附录）");
  });

  it("falls back to the other provider when the translation model fails", async () => {
    const { calls, fetcher } = provider({ failModels: ["tencent/Hunyuan-MT-7B"], answer: () => "1. 谢谢" });
    const backend = new OnlineBackend({ siliconflow: ["sk-aaaaaaaaaaaaaaaaaaaa"], zhipu: ["zhipu.bbbbbbbbbbbbbbbbbbbb"] }, fetcher);
    const [line] = await backend.translateLines(["Merci."], "fr");
    expect(line).toBe("谢谢");
    expect(calls.map((call) => call.model)).toEqual(["tencent/Hunyuan-MT-7B", "glm-4-flash"]);
    expect(calls.at(-1)!.url).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
    expect(calls.at(-1)!.key).toBe("zhipu.bbbbbbbbbbbbbbbbbbbb");
  });

  it("shares the work across keys, skips a busy key and stops using a refused one", async () => {
    const keys = ["sk-key1key1key1key1key1", "sk-key2key2key2key2key2", "sk-key3key3key3key3key3"];
    const { calls, fetcher } = provider({ badKeys: [keys[0]], busyKeys: [keys[1]], answer: () => "好" });
    const backend = new OnlineBackend({ siliconflow: keys, zhipu: [] }, fetcher);
    await backend.translateLines(["Oui.", "Non.", "Si."], "fr");
    const used = calls.filter((call) => call.model === "tencent/Hunyuan-MT-7B").map((call) => call.key);
    expect(used.filter((key) => key === keys[0])).toHaveLength(1);
    expect(used.filter((key) => key === keys[2]).length).toBeGreaterThanOrEqual(3);
  });

  it("asks general models for explanations as JSON, never the translation model, and labels the answer", async () => {
    const answer = '```json\n{"summary":"你好。","structure":"感叹词 Bonjour","grammarPoints":["问候语。"],"pitfalls":[],"examples":["Salut !（嗨！）"]}\n```';
    const { calls, fetcher } = provider({ answer: () => answer });
    const backend = new OnlineBackend({ siliconflow: ["sk-aaaaaaaaaaaaaaaaaaaa"], zhipu: ["zhipu.bbbbbbbbbbbbbbbbbbbb"] }, fetcher);
    const explanation = await explainSentence(backend, "在线 AI", material, material.sentences[0], null);
    expect(explanation.summary).toBe("你好。");
    expect(explanation.model).toBe("glm-4-flash");
    expect(calls.map((call) => call.model)).toEqual(["glm-4-flash"]);
    expect(calls[0].body).toMatchObject({ response_format: { type: "json_object" } });
    expect(String((calls[0].body.messages as { content: string }[])[0].content)).toContain("只返回一个 JSON 对象");
  });

  it("tells a whole key from half of one", () => {
    expect(looksComplete("siliconflow", "sk-abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(looksComplete("siliconflow", "abcdefghijklmnopqrstuvwxyz")).toBe(false);
    expect(looksComplete("zhipu", "9bb0123456789abcdef0123456789abc.AbCdEfGhIjKlMnOp")).toBe(true);
    // Copied only up to the dot: Zhipu refuses it.
    expect(looksComplete("zhipu", "9bb0123456789abcdef0123456789abc")).toBe(false);
  });

  it("reads keys pasted in any layout", () => {
    expect(cleanKeys(" sk-abcdefghijklmnopqrstu \n\nsk-abcdefghijklmnopqrstu, short\nf3a9c1d2e4b5.abcdefghij ")).toEqual(["sk-abcdefghijklmnopqrstu", "f3a9c1d2e4b5.abcdefghij"]);
    expect(jsonIn('好的：{"a":1} 完')).toBe('{"a":1}');
    expect(ROUTES.explain.some((route) => route.translationOnly)).toBe(false);
  });
});

describe("keys on this device", () => {
  let run = 0;
  beforeEach(() => {
    setDatabase(new OoFRDatabase(`oofr2-online-${(run += 1)}`));
    resetAiForTests();
  });

  it("uses online AI as soon as a key is saved, and never puts keys in backups", async () => {
    await refreshAi();
    expect(aiState().online).toBe(false);
    await saveKeys({ siliconflow: ["sk-secretsecretsecretsecret"], zhipu: [] });
    await refreshAi();
    expect(aiState()).toMatchObject({ phase: "ready", online: true });
    expect((await loadKeys()).siliconflow).toHaveLength(1);
    expect(JSON.stringify(await createBackup("test"))).not.toContain("secretsecret");
  });
});
