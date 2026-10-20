import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AiBackend, type ChatBody, OLLAMA, localBackend, readPullStream } from "../src/ai/backend";
import { explainNow, planLesson, prepareMaterial, queueForTests, resetQueueForTests } from "../src/ai/enrich";
import { type FormLookup, type WordForm, factsText, sentenceFacts } from "../src/ai/grammar";
import { chooseModel, isAllowedModel } from "../src/ai/models";
import { aiState, progressText, refreshAi, resetAiForTests, setupAi } from "../src/ai/state";
import { explainSentence, translateSentences } from "../src/ai/tasks";
import { OoFRDatabase, db, setDatabase } from "../src/db/database";
import { applySentenceAi, createMaterial, createTape } from "../src/db/repo";
import type { Material } from "../src/db/types";

// The dictionary forms a few test sentences need.
const FORMS: Record<string, WordForm> = {
  avais: { lemma: "avoir", pos: "verb", features: "first person · imperfect · indicative · singular" },
  su: { lemma: "su", pos: "noun", features: "" },
  serais: { lemma: "être", pos: "verb", features: "conditional · first person · singular" },
  venu: { lemma: "venir", pos: "verb", features: "participle · past" },
  voudrais: { lemma: "vouloir", pos: "verb", features: "conditional · first person · singular" },
  levée: { lemma: "levée", pos: "noun", features: "" },
  parlé: { lemma: "parler", pos: "verb", features: "participle · past" },
  fatigué: { lemma: "fatigué", pos: "adjective", features: "" },
  pleuvait: { lemma: "pleuvoir", pos: "verb", features: "imperfect · indicative · singular · third person" },
  viennes: { lemma: "venir", pos: "verb", features: "present · second person · singular · subjunctive" },
  comment: { lemma: "comment", pos: "adverb", features: "" }
};
const lookup: FormLookup = async (word) => FORMS[word.replace(/^[a-z]+'/, "")] ?? null;
const facts = async (sentence: string) => factsText(await sentenceFacts(sentence, lookup));

describe("grammar facts given to the AI", () => {
  it("names compound tenses from the auxiliary, even when the dictionary misfiles the participle", async () => {
    const text = await facts("Si j'avais su, je ne serais pas venu.");
    expect(text).toContain("j'avais su：愈过去时（avoir 的未完成过去时 + savoir 的过去分词）");
    expect(text).toContain("serais pas venu：条件式过去时（être 的条件式现在时 + venir 的过去分词；venir 属于复合时态用 être 的动词");
    expect(text).toContain("ne … pas：否定结构");
    expect(text).toContain("si 条件句：si + 愈过去时");
    expect(text).toContain("不用虚拟式");
  });

  it("knows reflexive verbs from object pronouns", async () => {
    expect(await facts("Elle s'est levée tôt.")).toContain("s'est levée：代词式动词的复合过去时（être 的直陈式现在时 + lever 的过去分词");
    const parle = await facts("C'est le livre dont je t'ai parlé hier.");
    expect(parle).toContain("t'ai parlé：复合过去时（avoir 的直陈式现在时 + parler 的过去分词）");
    expect(parle).not.toContain("代词式");
    expect(await facts("Nous nous sommes levés tôt.")).toContain("代词式动词的复合过去时");
    expect(await facts("Vous nous avez vus.")).not.toContain("代词式");
  });

  it("recognises the passive and adjectival participles", async () => {
    expect(await facts("La maison a été construite en 1900.")).toContain("a été construite：被动语态的复合过去时（avoir 的直陈式现在时 + été + construire 的过去分词）");
    expect(await facts("Je suis fatigué.")).toContain("suis fatigué：être 的直陈式现在时 + fatiguer 的过去分词（过去分词作表语形容词，或被动语态）");
    expect(await facts("Elle est née à Paris.")).toContain("est née：复合过去时（être 的直陈式现在时 + naître 的过去分词");
  });

  it("marks inverted questions, single verb forms, expletive ne and si + imperfect", async () => {
    expect(await facts("Avez-vous déjà vu ce film ?")).toContain("Avez-vous déjà vu：复合过去时（avoir 的直陈式现在时 + voir 的过去分词）");
    expect(await facts("Comment allez-vous ?")).toContain("allez-vous：主谓倒装");
    expect(await facts("Je voudrais pratiquer.")).toContain("voudrais：vouloir 的条件式现在时 · 第一人称 · 单数");
    const expletive = await facts("Il faut que tu viennes avant qu'il ne soit trop tard.");
    expect(expletive).toContain("ne：赘词 ne");
    expect(expletive).toContain("soit：être 的虚拟式现在时");
    expect(await facts("S'il pleuvait, je resterais à la maison.")).toContain("si 条件句：si + 未完成过去时");
  });

  it("states nothing about words the dictionary does not know", async () => {
    expect(await facts("Bonjour tout le monde.")).toBe("");
  });
});

describe("models", () => {
  it("picks the standard model unless the computer has little memory", () => {
    expect(chooseModel(null).name).toBe("qwen3.5:9b");
    expect(chooseModel(24).name).toBe("qwen3.5:9b");
    expect(chooseModel(8).name).toBe("qwen3.5:4b");
    expect(chooseModel(4).name).toBe("qwen3.5:4b");
    expect(isAllowedModel("qwen3.5:9b")).toBe(true);
    expect(isAllowedModel("gemma4:26b")).toBe(false);
  });
});

function stream(lines: string[]): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(lines.join("\n"));
  // Split mid-line to check that partial lines are kept for the next chunk.
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, 20));
      controller.enqueue(bytes.slice(20));
      controller.close();
    }
  });
}

describe("talking to Ollama", () => {
  it("reads download progress and errors", async () => {
    const seen: number[] = [];
    await readPullStream(stream(['{"status":"pulling manifest"}', '{"status":"pulling a1","completed":5,"total":10}', '{"status":"success"}']), (progress) => seen.push(progress.completed));
    expect(seen).toEqual([0, 5, 0]);
    await expect(readPullStream(stream(['{"error":"no space left"}']), () => undefined)).rejects.toThrow("no space left");
    expect(progressText({ text: "pulling a1", completed: 2 ** 30, total: 6.6 * 2 ** 30 })).toBe("1.0 / 6.6 GB");
    expect(progressText({ text: "verifying sha256 digest", completed: 0, total: 0 })).toBe("正在校验");
  });

  it("asks Ollama on the loopback address only, without thinking, and frees memory soon", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (url.endsWith("/api/version")) return new Response('{"version":"0.33.1"}');
      if (url.endsWith("/api/tags")) return new Response('{"models":[{"name":"qwen3.5:9b"}]}');
      return new Response('{"message":{"content":"{\\"translations\\":[{\\"id\\":0,\\"zh\\":\\"你好\\"},{\\"id\\":1,\\"zh\\":\\"hello\\"}]}"}}');
    }) as typeof fetch;
    const backend = localBackend(fetcher);
    expect(await backend.version()).toBe("0.33.1");
    expect(await backend.models()).toEqual(["qwen3.5:9b"]);
    const material = { title: "t", language: "fr", sentences: [{ id: "a", text: "Bonjour." }, { id: "b", text: "Salut." }] } as Material;
    const result = await translateSentences(backend, "qwen3.5:9b", material, material.sentences);
    // A translation with no Chinese in it is not kept.
    expect([...result]).toEqual([["a", "你好"]]);
    expect(calls.every(([url]) => url.startsWith(OLLAMA))).toBe(true);
    const body = JSON.parse(String(calls.at(-1)![1]!.body)) as ChatBody;
    expect(body).toMatchObject({ think: false, keep_alive: "3m", stream: false });
    expect(body.format).toMatchObject({ properties: { translations: { minItems: 2, maxItems: 2 } } });
  });

  it("says when Ollama does not answer", async () => {
    const backend = localBackend((async () => {
      throw new TypeError("Load failed");
    }) as typeof fetch);
    expect(await backend.version()).toBeNull();
  });
});

function fakeBackend(answer: unknown): AiBackend & { bodies: ChatBody[] } {
  const bodies: ChatBody[] = [];
  return {
    kind: "local",
    bodies,
    version: async () => "test",
    models: async () => ["qwen3.5:9b"],
    chat: async (body) => {
      bodies.push(body);
      return JSON.stringify(answer);
    },
    pull: async () => undefined
  };
}

describe("sentence explanations", () => {
  it("keeps the dictionary's word forms and drops the model thinking aloud", async () => {
    const backend = fakeBackend({
      summary: "如果我早知道，我就不会来了。",
      structure: "从句 si j'avais su + 主句 je ne serais pas venu",
      grammarPoints: ["愈过去时表示过去的假设。", "venir 不用 être？等等，词典事实给的是 être", "x".repeat(160)],
      pitfalls: [],
      examples: ["Si tu avais su, tu serais venu.（如果你早知道，你就会来。）"]
    });
    const material = { title: "t", language: "fr", sentences: [{ id: "a", text: "Si j'avais su, je ne serais pas venu.", translation: "" }] } as unknown as Material;
    const known = await sentenceFacts(material.sentences[0].text, lookup);
    const explanation = await explainSentence(backend, "qwen3.5:9b", material, material.sentences[0], known);
    expect(explanation.grammarPoints).toEqual(["愈过去时表示过去的假设。"]);
    expect(explanation.morphology).toContain("j'avais su：愈过去时");
    expect(explanation).toMatchObject({ model: "qwen3.5:9b", source: "local-ai", language: "zh" });
    expect(backend.bodies[0].messages[1].content).toContain("词典确定的事实");
    expect(backend.bodies[0].messages[1].content).toContain("serais pas venu：条件式过去时");
  });
});

describe("storing what the AI wrote", () => {
  let run = 0;
  beforeEach(() => {
    setDatabase(new OoFRDatabase(`oofr2-ai-${(run += 1)}`));
  });

  it("fills only empty translations, never the learner's own, and skips edited sentences", async () => {
    const tape = await createTape("测试");
    const material = await createMaterial({ title: "t", tapeId: tape.id, text: "Bonjour. Salut. Merci." });
    const [first, second, third] = material.sentences;
    await db.materials.update(material.id, { sentences: [{ ...first, translation: "我自己的译文" }, second, third] });
    const changed = await applySentenceAi(material.id, [
      { sentenceId: first.id, text: first.text, translation: "你好" },
      { sentenceId: second.id, text: second.text, translation: "嗨" },
      { sentenceId: third.id, text: "Merci beaucoup.", translation: "非常感谢" }
    ]);
    const stored = (await db.materials.get(material.id))!;
    expect(changed).toBe(1);
    expect(stored.sentences.map((sentence) => [sentence.translation, sentence.translationSource])).toEqual([
      ["我自己的译文", undefined],
      ["嗨", "ai"],
      ["", undefined]
    ]);
  });
});

describe("the AI work queue", () => {
  let run = 0;
  const requests: string[] = [];
  beforeEach(async () => {
    setDatabase(new OoFRDatabase(`oofr2-queue-${(run += 1)}`));
    resetAiForTests();
    resetQueueForTests();
    requests.length = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (!String(url).startsWith(OLLAMA)) throw new TypeError("offline");
      requests.push(String(url).replace(OLLAMA, ""));
      if (String(url).endsWith("/api/version")) return new Response('{"version":"0.33.1"}');
      if (String(url).endsWith("/api/tags")) return new Response('{"models":[{"name":"qwen3.5:9b"}]}');
      const body = JSON.parse(String(init?.body)) as ChatBody;
      const answer = body.format && JSON.stringify(body.format).includes("translations")
        ? { translations: [{ id: 0, zh: "你好。" }, { id: 1, zh: "谢谢。" }] }
        : { summary: "你好。", structure: "感叹词 Bonjour", grammarPoints: ["问候语。"], pitfalls: [], examples: ["Salut !（嗨！）"] };
      return new Response(JSON.stringify({ message: { content: JSON.stringify(answer) } }));
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("finds a running Ollama with the model and prepares an open lesson", async () => {
    await refreshAi();
    expect(aiState().phase).toBe("ready");
    const tape = await createTape("测试");
    const material = await createMaterial({ title: "t", tapeId: tape.id, text: "Bonjour. Merci." });
    planLesson(material, 0);
    await vi.waitFor(async () => {
      const stored = (await db.materials.get(material.id))!;
      expect(stored.sentences.map((sentence) => sentence.translation)).toEqual(["你好。", "谢谢。"]);
      expect(stored.sentences.every((sentence) => sentence.explanation?.summary === "你好。")).toBe(true);
    });
    expect(requests.filter((path) => path === "/api/chat")).toHaveLength(3);
  });

  it("asks to download the model when it is missing, and downloads it in one click", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).endsWith("/api/version")) return new Response('{"version":"0.33.1"}');
      if (String(url).endsWith("/api/tags")) return new Response(requests.includes("pulled") ? '{"models":[{"name":"qwen3.5:9b"}]}' : '{"models":[]}');
      if (String(url).endsWith("/api/pull")) {
        requests.push("pulled");
        return new Response(stream(['{"status":"pulling a1","completed":10,"total":10}', '{"status":"success"}']));
      }
      throw new TypeError("unexpected");
    });
    await refreshAi();
    expect(aiState().phase).toBe("needs-model");
    await setupAi();
    expect(aiState()).toMatchObject({ phase: "ready", error: "" });
  });

  it("waits while the AI is not available, then runs a requested explanation", async () => {
    const tape = await createTape("测试");
    const material = await createMaterial({ title: "t", tapeId: tape.id, text: "Bonjour." });
    explainNow(material, material.sentences[0]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await db.materials.get(material.id))!.sentences[0].explanation).toBeNull();
    await refreshAi();
    await vi.waitFor(async () => expect((await db.materials.get(material.id))!.sentences[0].explanation?.summary).toBe("你好。"));
  });
});

describe("pairing a phone with the Mac", () => {
  const fp = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, "0").toUpperCase()).join(":");
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const good = { v: 1, ips: ["172.20.10.4"], host: "MacBook-Air.local", port: 47800, fp, code: "0123456789abcdef01234567" };

  it("reads the QR code as a link or as the bare payload, and refuses anything odd", async () => {
    const { parsePairing } = await import("../src/ai/paired");
    expect(parsePairing(`https://aarynyan-cell.github.io/OoFR/#/pair/${encode(good)}`)).toEqual({ ips: ["172.20.10.4"], host: "MacBook-Air.local", port: 47800, fp, code: good.code });
    expect(parsePairing(encode(good))?.port).toBe(47800);
    for (const bad of [{ ...good, v: 2 }, { ...good, ips: [], host: "" }, { ...good, port: 70000 }, { ...good, fp: "nope" }, { ...good, code: "" }, { ...good, host: "evil.com", ips: [] }]) {
      expect(parsePairing(encode(bad))).toBeNull();
    }
    expect(parsePairing("not a code")).toBeNull();
    // Addresses that are not plain IPv4 never reach the session description.
    expect(parsePairing(encode({ ...good, ips: ["1.2.3.4 typ host\r\na=x", "10.0.0.2"] }))?.ips).toEqual(["10.0.0.2"]);
  });

  it("writes the Mac's side of the session from the QR code", async () => {
    const { answerFor } = await import("../src/ai/paired");
    const local = "v=0\r\na=ice-ufrag:Dkhu\r\na=ice-pwd:abcdefghijklmnopqrstuvwx\r\na=mid:0\r\n";
    const answer = answerFor({ ips: ["172.20.10.4", "192.168.1.5"], host: "", port: 47800, fp }, local);
    expect(answer).toContain("a=ice-lite");
    expect(answer).toContain("a=ice-ufrag:oofr+v1/abcdefghijklmnopqrstuvwx\r\n");
    expect(answer).toContain("a=ice-pwd:oofr+v1/abcdefghijklmnopqrstuvwx\r\n");
    expect(answer).toContain(`a=fingerprint:sha-256 ${fp}`);
    expect(answer).toContain("a=setup:passive");
    expect(answer).toContain("a=candidate:1 1 udp 2130706431 172.20.10.4 47800 typ host");
    expect(answer).toContain("a=candidate:2 1 udp 2130706430 192.168.1.5 47800 typ host");
    expect(answer.match(/a=candidate:/g)).toHaveLength(2);
  });

  it("also looks for the Mac on its usual port, after the one from the QR code", async () => {
    const { answerFor } = await import("../src/ai/paired");
    const local = "v=0\r\na=ice-ufrag:Dkhu\r\na=ice-pwd:abcdefghijklmnopqrstuvwx\r\na=mid:0\r\n";
    const answer = answerFor({ ips: ["192.168.1.28"], host: "", port: 63590, fp }, local);
    expect(answer).toContain("m=application 63590 ");
    expect(answer).toContain("a=candidate:1 1 udp 2130706431 192.168.1.28 63590 typ host");
    expect(answer).toContain("a=candidate:2 1 udp 2130706430 192.168.1.28 47800 typ host");
    expect(answer).toContain(`a=fingerprint:sha-256 ${fp}`);
  });

  it("keeps the phone's pairing key out of backups", async () => {
    setDatabase(new OoFRDatabase(`oofr2-pairing-${Date.now()}`));
    const { savePairing } = await import("../src/ai/paired");
    const { createBackup } = await import("../src/backup/backup");
    await savePairing({ ips: ["10.0.0.2"], host: "", port: 47800, fp, key: "secret" });
    const backup = await createBackup("test");
    expect(JSON.stringify(backup)).not.toContain("secret");
  });
});

describe("the order the AI works in", () => {
  let run = 0;
  beforeEach(() => {
    setDatabase(new OoFRDatabase(`oofr2-order-${(run += 1)}`));
    // The AI is not ready, so jobs stay queued and their order can be read.
    resetAiForTests();
    resetQueueForTests();
  });

  it("does the tapped sentence first, then the open lesson from where the learner is, then other lessons", async () => {
    const tape = await createTape("测试");
    const open = await createMaterial({ title: "open", tapeId: tape.id, text: "Un. Deux. Trois. Quatre." });
    const other = await createMaterial({ title: "other", tapeId: tape.id, text: "Cinq. Six." });
    const [one, two, three, four] = open.sentences.map((sentence) => sentence.id);
    prepareMaterial(other);
    planLesson(open, 2);
    expect(queueForTests()).toEqual([
      `translate:${open.id}:`,
      `explain:${open.id}:${three}`,
      `explain:${open.id}:${four}`,
      `explain:${open.id}:${one}`,
      `explain:${open.id}:${two}`,
      `translate:${other.id}:`
    ]);
    explainNow(open, open.sentences[1]);
    expect(queueForTests()[0]).toBe(`explain:${open.id}:${two}`);
    // Moving to another sentence puts it next in the lesson's turn.
    planLesson(open, 3);
    expect(queueForTests().slice(0, 3)).toEqual([`explain:${open.id}:${two}`, `translate:${open.id}:`, `explain:${open.id}:${four}`]);
  });
});
