const test = require("node:test");
const assert = require("node:assert/strict");

const { loadApp } = require("./helpers/load-app.js");

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const json = (value) => JSON.parse(JSON.stringify(value));

// A scripted Ollama: /api/tags lists one model; /api/chat is answered by `onChat`.
function fakeOllama(onChat) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === "/api/tags") {
      return new Response(JSON.stringify({ models: [{ name: "gemma3:4b", size: 3000 }] }), { status: 200 });
    }
    const body = JSON.parse(options.body);
    const items = (() => {
      const text = body.messages.at(-1).content;
      const marker = text.indexOf("ITEMS:\n");
      return marker >= 0 ? JSON.parse(text.slice(marker + 7)) : [];
    })();
    calls.push({ url, body, items, signal: options.signal });
    // Like a real fetch, reject as soon as the caller aborts.
    const aborted = new Promise((resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
    const content = await Promise.race([Promise.resolve().then(() => onChat({ body, items, signal: options.signal, index: calls.length - 1 })), aborted]);
    return new Response(JSON.stringify({ message: { content: JSON.stringify(content) } }), { status: 200 });
  };
  return { fetch, calls };
}

function newApp(onChat, { lessonTurns = 3, translations = false, hostname = "127.0.0.1", protocol = "http:" } = {}) {
  const ollama = fakeOllama(onChat);
  const app = loadApp({ hostname, protocol, extra: { fetch: ollama.fetch } });
  app.context.__turnCount = lessonTurns;
  app.context.__withTranslations = translations;
  app.run(`
    renderMy = function () {}; queueSyncedSettings = function () {}; renderCoursePlayer = function () {};
    state = createStarterState({});
    var __statuses = []; setStatus = function (message) { __statuses.push(message); };
    function __makeLesson() {
      return normalizeCourseLesson({ id: "L", title: "Lesson", language: "fr", explainLanguage: "zh", turns:
        Array.from({ length: __turnCount }, (_, index) => ({ id: "t" + index, text: "Phrase numéro " + index + ".", translation: __withTranslations ? "译文 " + index : "" })) });
    }
    state.courseLessons = [__makeLesson()];
    state.activeCourseId = "L";
    courseActiveLessonId = "L";
  `);
  return { app, ollama };
}

const translate = ({ items }) => ({ translations: items.map((item) => ({ id: item.id, text: `译：${item.text}` })) });

const explanation = (id) => ({
  id, summary: "这句话表达一个简单的意思，用于练习。", structure: "主语加动词再加宾语的基本句式。",
  grammarPoints: ["注意动词的变位形式。"], morphology: "本句无需特别词形说明", pitfalls: ["不要漏掉冠词。"], examples: ["Un autre exemple."]
});

test("translations are written to the lesson as it is now, even if the lesson object was replaced meanwhile", async () => {
  let releaseChat;
  const gate = new Promise((resolve) => { releaseChat = resolve; });
  const { app } = newApp(async (request) => { await gate; return translate(request); });
  const run = app.run(`generateCourseTranslations(state.courseLessons[0])`);
  await wait(20);
  // The learner edits/re-opens the course: a new object with the same sentence ids.
  app.run(`state.courseLessons.splice(0, 1, __makeLesson())`);
  releaseChat();
  await run;
  assert.deepEqual(json(app.run("state.courseLessons[0].turns.map((turn) => turn.translation)")), ["译：Phrase numéro 0.", "译：Phrase numéro 1.", "译：Phrase numéro 2."]);
});

test("deleting a lesson cancels its running AI request and leaves no pending marks", async () => {
  let seenSignal;
  const { app } = newApp(({ signal }) => { seenSignal = signal; return new Promise(() => {}); });
  const run = app.run(`generateCourseTranslations(state.courseLessons[0])`);
  await wait(20);
  app.run(`removeLessons(["L"])`);
  await run;
  assert.equal(seenSignal.aborted, true);
  assert.equal(app.run("courseTranslationPendingIds.size"), 0);
  assert.equal(app.run("state.courseLessons.length"), 0);
});

test("an unreachable AI stops background work instead of trying every sentence", async () => {
  const { app, ollama } = newApp(() => { throw new TypeError("Failed to fetch"); }, { lessonTurns: 20 });
  await app.run(`generateCourseTranslations(state.courseLessons[0])`);
  assert.equal(ollama.calls.length, 1, "one failed request, then the pause is respected");
  assert.equal(app.run("aiTemporarilyDown()"), true);
  assert.equal(app.run("courseTranslationErrorIds.size"), 20, "all sentences offer a retry");
  assert.equal(app.run("courseTranslationPendingIds.size"), 0);
});

test("a long lesson is translated in small batches", async () => {
  const { app, ollama } = newApp(translate, { lessonTurns: 20 });
  await app.run(`generateCourseTranslations(state.courseLessons[0])`);
  assert.deepEqual(ollama.calls.map((call) => call.items.length), [8, 8, 4]);
  assert.equal(app.run("state.courseLessons[0].turns.every((turn) => turn.translation.startsWith('译：'))"), true);
});

test("a retry requested while a run is going is not dropped", async () => {
  const { app } = newApp(async (request) => { await wait(15); return translate(request); }, { lessonTurns: 3 });
  app.run(`state.courseLessons[0].turns.forEach((turn) => { turn.translation = "旧译文"; })`);
  const first = app.run(`generateCourseTranslations(state.courseLessons[0], { turnIds: ["t0"] })`);
  await wait(5);
  const second = app.run(`generateCourseTranslations(state.courseLessons[0], { turnIds: ["t2"] })`);
  await Promise.all([first, second]);
  assert.deepEqual(json(app.run("state.courseLessons[0].turns.map((turn) => turn.translation)")), ["译：Phrase numéro 0.", "旧译文", "译：Phrase numéro 2."]);
});

test("one bad explanation batch does not block the batches after it", async () => {
  let batch = 0;
  const { app } = newApp(({ items }) => {
    batch += 1;
    if (batch === 1) return { explanations: [], lexicalUnits: [] }; // invalid: wrong count
    return { explanations: items.map((item) => explanation(item.id)), lexicalUnits: [] };
  }, { lessonTurns: 12, translations: true });
  await app.run(`runCourseBackgroundEnrichment("L")`);
  const explained = json(app.run("state.courseLessons[0].turns.map((turn) => Boolean(turn.aiExplanation))"));
  assert.deepEqual(explained.slice(0, 6), [false, false, false, false, false, false]);
  assert.deepEqual(explained.slice(6), [true, true, true, true, true, true]);
});

test("a lesson edited during a run is picked up by a follow-up run", async () => {
  const { app, ollama } = newApp(async ({ items }) => {
    await wait(20);
    return { explanations: items.map((item) => explanation(item.id)), lexicalUnits: [] };
  }, { lessonTurns: 2, translations: true });
  app.run(`courseEnrichmentQueue = Promise.resolve();`);
  app.run(`scheduleCourseBackgroundEnrichment({ id: "L" })`);
  await wait(330);
  // While the first run waits for the AI, a new sentence arrives and a second run is requested.
  app.run(`state.courseLessons[0].turns.push({ id: "t9", text: "Une nouvelle phrase.", translation: "新句子", aiExplanation: null, recording: { status: "none", durationMs: 0, mediaKey: "" }, speakerId: "narrator", speakerLabel: "旁白" })`);
  app.run(`scheduleCourseBackgroundEnrichment({ id: "L" })`);
  await wait(900);
  assert.equal(app.run("state.courseLessons[0].turns.every((turn) => Boolean(turn.aiExplanation))"), true);
  assert.ok(ollama.calls.length >= 2);
});

test("an Ollama address outside this machine is ignored until the user confirms it on this device", () => {
  const { app } = newApp(() => ({}));
  app.run(`state.settings.localAiEndpoint = "http://evil.example:11434"`);
  assert.equal(app.run("createLocalAiClient().endpoint"), "http://127.0.0.1:11434");
  assert.equal(app.run("effectiveLocalAiEndpoint()"), "http://127.0.0.1:11434");

  app.run(`approvedAiEndpoint = "http://evil.example:11434"; localAiClient = null;`);
  assert.equal(app.run("createLocalAiClient().endpoint"), "http://evil.example:11434");

  app.run(`state.settings.localAiEndpoint = "http://localhost:11434"; localAiClient = null;`);
  assert.equal(app.run("createLocalAiClient().endpoint"), "http://localhost:11434");
});

test("a malformed saved address cannot disable the AI, and imports cannot carry an approval", async () => {
  const { app } = newApp(() => ({}));
  app.run(`state.settings.localAiEndpoint = "localhost:11434"`);
  assert.doesNotThrow(() => app.run("createLocalAiClient()"));
  assert.equal(app.run("effectiveLocalAiEndpoint()"), "http://127.0.0.1:11434");

  const incoming = app.run(`JSON.stringify(Object.assign(createStarterState({}), { settings: Object.assign(createStarterState({}).settings, { localAiEndpoint: "http://evil.example:11434", localAiEndpointApproved: "http://evil.example:11434" }) }))`);
  app.run(`renderAll = function () {}; syncSettingsControls = function () {}; window.confirm = () => true;`);
  await app.run(`importBackupText(${JSON.stringify(incoming)})`);
  assert.equal(app.run("effectiveLocalAiEndpoint()"), "http://127.0.0.1:11434");
  assert.equal(app.run("'localAiEndpointApproved' in state.settings"), false);
});

test("the hosted web version never calls an AI, whatever the saved address", async () => {
  const { app, ollama } = newApp(() => ({}), { hostname: "someone.github.io", protocol: "https:" });
  app.run(`state.settings.localAiEndpoint = "http://127.0.0.1:11434"`);
  assert.throws(() => app.run("createLocalAiClient()"), /在线 AI 暂未开放/);
  await app.run(`generateCourseTranslations(state.courseLessons[0])`);
  assert.equal(ollama.calls.length, 0);
});

test("the model cannot change the learner's words through the analysis result", () => {
  const { app } = newApp(() => ({}));
  const text = "Bonjour tout le monde. Ça va bien ?";
  app.context.__text = text;
  const local = app.run("analyzeMaterialLocally(__text)");
  app.context.__local = local;
  const tampered = json(app.run(`mergeMaterialAnalysis(__local, { isDialogue: false, materialType: "文章", dialogueLines: [], sentenceText: "Salut le monde.\\nÇa va mal ?", corrections: [], lexicalUnits: [] })`));
  assert.equal(tampered.sentenceText, local.sentenceText, "rewritten text is not accepted as a line break suggestion");
  const kept = json(app.run(`mergeMaterialAnalysis(__local, { isDialogue: false, materialType: "文章", dialogueLines: [], sentenceText: "Bonjour tout le monde.\\nÇa va bien ?", corrections: [], lexicalUnits: [] })`));
  assert.equal(kept.sentenceText, "Bonjour tout le monde.\nÇa va bien ?");
});

test("an analysis result for a draft the learner has left is discarded", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { app } = newApp(async () => {
    await gate;
    return { title: "AI 标题", language: "fr", materialType: "文章", isDialogue: false, dialogueLines: [], sentenceText: "Bonjour.", correctedText: "Bonjour.", corrections: [], lexicalUnits: [] };
  });
  app.run(`
    var __draftA = { title: "", language: "fr", materialType: "文章", text: "Bonjour tout le monde.", explainLanguage: "zh" };
    courseDraft = __draftA;
    elements.courseMaterialInput = { value: "Bonjour tout le monde." };
    elements.courseTitleInput = { value: "" }; elements.courseLanguageSelect = { value: "fr" }; elements.courseMaterialTypeSelect = { value: "文章" };
    elements.courseAnalysisStatus = { textContent: "" };
    renderCourseMaterialAnalysis = function () {};
  `);
  const analysis = app.run(`analyzeCourseMaterial({ deep: true })`);
  await wait(20);
  app.run(`courseDraft = { title: "另一份", language: "fr", materialType: "文章", text: "Autre texte.", explainLanguage: "zh" }; elements.courseMaterialInput = { value: "Autre texte." };`);
  release();
  await analysis;
  assert.notEqual(app.run("courseMaterialAnalysis && courseMaterialAnalysis.source"), "ollama", "the AI result was not applied to the other draft");
});

test("long material skips the deep analysis instead of asking for an answer that cannot fit", async () => {
  const { app, ollama } = newApp(() => ({}));
  const longText = "Une phrase assez longue pour le test. ".repeat(80);
  app.context.__long = longText;
  app.run(`
    courseDraft = { title: "", language: "fr", materialType: "文章", text: __long, explainLanguage: "zh" };
    elements.courseMaterialInput = { value: __long };
    elements.courseTitleInput = { value: "" }; elements.courseLanguageSelect = { value: "fr" }; elements.courseMaterialTypeSelect = { value: "文章" };
    elements.courseAnalysisStatus = { textContent: "" };
    renderCourseMaterialAnalysis = function () {};
  `);
  await app.run(`analyzeCourseMaterial({ deep: true })`);
  assert.equal(ollama.calls.length, 0);
  assert.match(app.run("elements.courseAnalysisStatus.textContent"), /较长/);
});
