const test = require("node:test");
const assert = require("node:assert/strict");

const { loadApp } = require("./helpers/load-app.js");

function newApp() {
  const app = loadApp();
  app.run(`
    renderMy = function () {}; queueSyncedSettings = function () {}; renderAll = function () {};
    syncSettingsControls = function () {}; setCourseStage = function () {};
    state = createStarterState({});
    var __released = [];
    deleteRecordingBlob = async function (key) { __released.push(key); };
    var __confirms = [];
    window.confirm = function (message) { __confirms.push(message); return true; };
  `);
  return app;
}

const json = (value) => JSON.parse(JSON.stringify(value));
const turn = (id, text, extra = {}) => ({
  id, text, translation: "", aiExplanation: null,
  recording: { status: "none", durationMs: 0, mediaKey: "" }, ...extra
});
const recorded = (key) => ({ status: "recorded", durationMs: 900, mediaKey: key });

test("repeated sentences keep their own recording and translation", () => {
  const app = newApp();
  app.context.__old = [
    turn("t1", "Oui.", { translation: "是（第一次）", recording: recorded("rec:1") }),
    turn("t2", "Non.", { translation: "不" }),
    turn("t3", "Oui.", { translation: "是（第二次）", recording: recorded("rec:3") })
  ];
  app.context.__new = [turn("n1", "Oui."), turn("n2", "Non."), turn("n3", "Oui.")];
  const result = json(app.run("carryOverTurns(__old, __new)"));
  assert.deepEqual(result.turns.map((t) => [t.id, t.translation, t.recording.mediaKey]), [
    ["t1", "是（第一次）", "rec:1"],
    ["t2", "不", ""],
    ["t3", "是（第二次）", "rec:3"]
  ]);
  assert.deepEqual(result.dropped, []);
});

test("a typo fix keeps translation and recording; a rewritten sentence drops its recording", () => {
  const app = newApp();
  app.context.__old = [
    turn("t1", "Je voudrais un cafe, s'il vous plait.", { translation: "我想要一杯咖啡。", recording: recorded("rec:1"), aiExplanation: { summary: "old" } }),
    turn("t2", "Il fait très beau aujourd'hui.", { translation: "今天天气很好。", recording: recorded("rec:2") })
  ];
  app.context.__new = [
    turn("n1", "Je voudrais un café, s'il vous plaît."),
    turn("n2", "Nous allons au cinéma demain soir avec des amis.")
  ];
  const result = json(app.run("carryOverTurns(__old, __new)"));
  assert.equal(result.turns[0].id, "t1");
  assert.equal(result.turns[0].translation, "我想要一杯咖啡。");
  assert.equal(result.turns[0].recording.mediaKey, "rec:1");
  assert.equal(result.turns[0].aiExplanation, null, "an edited sentence must not keep an explanation written for the old text");
  assert.equal(result.turns[1].recording.mediaKey, "");
  assert.deepEqual(result.dropped.map((t) => t.recording.mediaKey), ["rec:2"]);
});

test("translations are not carried over when the explanation language changed", () => {
  const app = newApp();
  app.context.__old = [turn("t1", "Bonjour.", { translation: "你好", recording: recorded("rec:1") })];
  app.context.__new = [turn("n1", "Bonjour.", { translation: "Translation pending" })];
  const result = json(app.run("carryOverTurns(__old, __new, { translations: false, explanations: false })"));
  assert.equal(result.turns[0].translation, "Translation pending");
  assert.equal(result.turns[0].recording.mediaKey, "rec:1", "recordings still belong to the sentence");
});

test("reopening a course keeps its explanation language, translations and recordings", () => {
  const app = newApp();
  app.run(`
    state.entries = [{ id: "e1", tapeId: "t", title: "Hello", text: "Hello there.\\nHow are you?", notes: "", language: "en", materialType: "文章", courseLessonId: "lesson_e1", practiceCount: 0, createdAt: "x", updatedAt: "x" }];
    state.courseLessons = [normalizeCourseLesson({ id: "lesson_e1", title: "Hello", language: "en", explainLanguage: "en", materialType: "文章", turns: [
      { id: "a", text: "Hello there.", translation: "Hi!", recording: { status: "recorded", mediaKey: "rec:a" } },
      { id: "b", text: "How are you?", translation: "How are you doing?" }
    ] })];
  `);
  const lesson = json(app.run("syncCourseFromEntry(state.entries[0])"));
  assert.equal(lesson.explainLanguage, "en");
  assert.deepEqual(lesson.turns.map((t) => t.translation), ["Hi!", "How are you doing?"]);
  assert.equal(lesson.turns[0].recording.mediaKey, "rec:a");
});

test("deleting a material removes its recordings but keeps the saved phrase cards", async () => {
  const app = newApp();
  app.run(`
    state.entries = [{ id: "e1", tapeId: "t1", title: "Voyage", text: "Bonjour.", courseLessonId: "lesson_1" }];
    state.courseLessons = [normalizeCourseLesson({ id: "lesson_1", title: "Voyage", turns: [{ id: "a", text: "Bonjour.", recording: { status: "recorded", mediaKey: "rec:a" } }] })];
    state.phraseItems = [normalizePhraseItem({ id: "p1", text: "Bonjour.", sourceLessonId: "lesson_1", status: "got", practiceCount: 4 })];
    getEntry = function () { return state.entries[0]; };
  `);
  app.run("deleteEntry('e1')");
  assert.equal(app.run("state.entries.length"), 0);
  assert.equal(app.run("state.courseLessons.length"), 0);
  assert.equal(app.run("state.phraseItems.length"), 1, "phrase cards carry learning progress");
  assert.equal(app.run("state.phraseItems[0].sourceLessonId"), "");
  assert.equal(app.run("state.phraseItems[0].practiceCount"), 4);
  assert.match(app.run("__confirms[0]"), /1 句录音会一并删除/);
  assert.match(app.run("__confirms[0]"), /1 条已收藏的词句卡会保留/);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(json(app.run("__released")), ["rec:a"]);
});

test("recordings are only deleted after a successful save and never while still referenced", async () => {
  const app = newApp();
  app.run(`
    state.courseLessons = [normalizeCourseLesson({ id: "l", title: "L", turns: [{ id: "x", text: "Salut.", recording: { status: "recorded", mediaKey: "rec:keep" } }] })];
    queueRecordingRelease(["rec:keep", "rec:gone"]);
  `);
  app.run("flushRecordingRelease()");
  assert.deepEqual(json(app.run("__released")), ["rec:gone"]);

  // Nothing is released while a save is failing.
  const failing = loadApp({ quotaChars: 10 });
  failing.run(`renderMy = function () {}; queueSyncedSettings = function () {}; state = createStarterState({}); var __released = []; deleteRecordingBlob = async function (key) { __released.push(key); }; queueRecordingRelease(["rec:x"]); persist();`);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(json(failing.run("__released")), []);
});

test("a learning package without usable sentences never replaces a local lesson", () => {
  const app = newApp();
  app.run(`state.courseLessons = [normalizeCourseLesson({ id: "course_1", title: "Local", turns: [{ id: "a", text: "Salut." }] })];`);
  const pkg = { type: "oofr.learning-package", schemaVersion: 1, course: { id: "course_1", title: "Remote", turns: [{ id: "a", text: "   " }] } };
  app.context.__pkg = pkg;
  assert.throws(() => app.run("applyLearningPackage(__pkg, 'update')"), /没有可学习的句子/);
  assert.equal(app.run("state.courseLessons[0].title"), "Local");
});

test("updating from a package keeps local recordings, album, tape and entry history", () => {
  const app = newApp();
  app.run(`
    state.albums = [{ id: "album_1", title: "我的旅行", description: "本地描述", coverColor: "#123456", courseLessonId: "", createdAt: "x", updatedAt: "x" }];
    state.tapes = [{ id: "tape_1", albumId: "album_1", title: "本地磁带", description: "", createdAt: "x", updatedAt: "x" }];
    state.entries = [{ id: "entry_1", tapeId: "tape_1", title: "Local title", text: "Salut.", notes: "我的备注", language: "fr", materialType: "文章", courseLessonId: "course_1", practiceCount: 7, lastPracticedAt: "2026-10-01", createdAt: "x", updatedAt: "x" }];
    state.courseLessons = [normalizeCourseLesson({ id: "course_1", title: "Local", turns: [{ id: "a", text: "Salut.", translation: "", recording: { status: "recorded", mediaKey: "rec:a" } }] })];
  `);
  app.context.__pkg = {
    type: "oofr.learning-package", schemaVersion: 1,
    material: {
      album: { id: "album_1", title: "桌面端的旅行", coverColor: "#abcdef" },
      tape: { id: "tape_1", albumId: "album_1", title: "桌面磁带" },
      entry: { id: "entry_1", title: "Remote title", text: "Salut.", notes: "桌面备注", practiceCount: 0 }
    },
    course: { id: "course_1", title: "Remote", language: "fr", materialType: "文章", turns: [{ id: "a", text: "Salut.", translation: "你好", aiExplanation: { summary: "打招呼" } }] }
  };
  app.run("applyLearningPackage(__pkg, 'update')");
  const state = json(app.run("state"));
  assert.equal(state.albums[0].title, "我的旅行");
  assert.equal(state.albums[0].coverColor, "#123456");
  assert.equal(state.tapes[0].title, "本地磁带");
  assert.equal(state.entries[0].notes, "我的备注");
  assert.equal(state.entries[0].practiceCount, 7);
  assert.equal(state.entries[0].title, "Remote title", "the package's text and title update the material");
  const lesson = state.courseLessons.find((item) => item.id === "course_1");
  assert.equal(lesson.turns[0].translation, "你好");
  assert.equal(lesson.turns[0].aiExplanation.summary, "打招呼");
  assert.equal(lesson.turns[0].recording.mediaKey, "rec:a");
});

test("a package without an album joins the open album instead of replacing it", () => {
  const app = newApp();
  const before = json(app.run("state.albums.map((album) => ({ id: album.id, title: album.title }))"));
  app.context.__pkg = {
    type: "oofr.learning-package", schemaVersion: 1,
    material: { entry: { id: "entry_new", title: "From phone", text: "Bonjour." } },
    course: { id: "course_new", title: "From phone", turns: [{ id: "a", text: "Bonjour." }] }
  };
  app.run("applyLearningPackage(__pkg, 'update')");
  const after = json(app.run("state.albums.map((album) => ({ id: album.id, title: album.title }))"));
  assert.deepEqual(after, before);
  assert.equal(app.run("state.entries.some((entry) => entry.id === 'entry_new')"), true);
});

test("ids from a package that could break selectors are replaced", () => {
  const app = newApp();
  app.context.__pkg = {
    type: "oofr.learning-package", schemaVersion: 1,
    course: { id: "course_x", title: "X", turns: [{ id: 'bad"]id', text: "Salut." }, { id: "ok_1", text: "Merci." }] }
  };
  app.run("applyLearningPackage(__pkg, 'update')");
  const ids = json(app.run("state.courseLessons.find((l) => l.id === 'course_x').turns.map((t) => t.id)"));
  assert.match(ids[0], /^course_x_turn_1$/);
  assert.equal(ids[1], "ok_1");
  assert.equal(app.run(`turnRowSelector('a"b')`), '[data-turn-id="a\\"b"]');
});

test("fixed expressions only match whole words and ignore one-word or oversized units", () => {
  const app = newApp();
  const tokens = (text, units = []) => {
    app.context.__lesson = { lexicalUnits: units.map((unit) => ({ text: unit })) };
    app.context.__text = text;
    return json(app.run("__text.match(courseLexicalUnitPattern(__lesson))"));
  };
  assert.deepEqual(tokens("un peuple"), ["un", "peuple"]);
  assert.deepEqual(tokens("Je parle un peu."), ["Je", "parle", "un peu"]);
  assert.deepEqual(tokens("e-mail end", ["e"]), ["e-mail", "end"], "a one-word unit must not split words");
  assert.deepEqual(tokens("Il y a de quoi", ["il y a"]), ["Il y a", "de", "quoi"]);
  assert.doesNotThrow(() => tokens("texte", ["mot ".repeat(40000)]));
});

test("translations containing # are accepted when the source has one too", () => {
  const app = newApp();
  assert.equal(app.run(`isSuspiciousTranslation("C# est un langage.", "C# 是一门语言。")`), false);
  assert.equal(app.run(`isSuspiciousTranslation("Payment pending", "付款待处理")`), false);
  assert.equal(app.run(`isSuspiciousTranslation("Bonjour", "## 你好")`), true);
});

test("album cover colours from files must be plain hex values", () => {
  const app = newApp();
  assert.equal(app.run(`normalizeAlbum({ id: "a", title: "A", coverColor: "#0a5f59" }).coverColor`), "#0a5f59");
  assert.match(app.run(`normalizeAlbum({ id: "a", title: "A", coverColor: "url(https://evil.example/x.png)" }).coverColor`), /^#[0-9a-f]{3,8}$/i);
});
