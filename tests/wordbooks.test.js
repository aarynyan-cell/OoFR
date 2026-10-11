const test = require("node:test");
const assert = require("node:assert/strict");

const { loadApp } = require("./helpers/load-app.js");

const json = (value) => JSON.parse(JSON.stringify(value));

function newApp() {
  const app = loadApp();
  app.run(`
    renderMy = function () {}; queueSyncedSettings = function () {};
    renderWordbooks = renderVocab = renderSentences = renderWordPanel = renderAll = function () {};
    state = createStarterState({});
    state.wordbooks = [{ id: "wb1", title: "旅行" }, { id: "wb2", title: "工作" }];
    var __confirms = []; window.confirm = (message) => { __confirms.push(message); return true; };
  `);
  return app;
}

const word = (id, text, extra = {}) => ({ id, word: text, surface: text, lemma: text, normalized: text, partOfSpeech: "noun", ipa: "/x/", zh: "释义", status: "new", language: "fr", wordbookIds: [], seenForms: [{ form: text, normalized: text, count: 1 }], ...extra });

test("importing the same wordbook again does not inflate how often a form was seen", () => {
  const app = newApp();
  app.run(`state.vocabulary = normalizeVocabularyList([${JSON.stringify(word("a", "maison", { seenForms: [{ form: "maison", normalized: "maison", count: 3 }] }))}]);`);
  const incoming = JSON.stringify([word("zz", "maison", { seenForms: [{ form: "maison", normalized: "maison", count: 3 }] })]);
  for (let round = 0; round < 3; round += 1) app.run(`mergeImportedVocabulary(${incoming}, "keep-local")`);
  assert.equal(app.run("state.vocabulary[0].seenForms[0].count"), 3);
  // Merging two entries of one word (not an import) still adds the counts up.
  assert.equal(app.run(`mergeSeenForms([{ form: "a", normalized: "a", count: 2 }], [{ form: "a", normalized: "a", count: 3 }])[0].count`), 5);
});

test("keeping local data also keeps a wordbook name the learner changed", () => {
  const app = newApp();
  app.run(`mergeImportedWordbooks([{ id: "wb1", title: "导入的名字", description: "导入的说明" }], "keep-local")`);
  assert.equal(app.run("state.wordbooks[0].title"), "旅行");
  app.run(`mergeImportedWordbooks([{ id: "wb1", title: "导入的名字", description: "导入的说明" }], "use-imported")`);
  assert.equal(app.run("state.wordbooks[0].title"), "导入的名字");
});

test("sentences set back to 'learning' stay in the new wordbook and out of the got wordbook", () => {
  const app = newApp();
  app.run(`state.phraseItems = [normalizePhraseItem({ id: "p1", text: "Bonjour.", status: "learning" }), normalizePhraseItem({ id: "p2", text: "Merci.", status: "got" })];`);
  assert.deepEqual(json(app.run(`phraseItemsForWordbook("new").map((item) => item.id)`)), ["p1"]);
  assert.deepEqual(json(app.run(`phraseItemsForWordbook("got").map((item) => item.id)`)), ["p2"]);
});

test("a saved word card can be marked and deleted like a sentence", () => {
  const app = newApp();
  app.run(`state.phraseItems = [normalizePhraseItem({ id: "w1", type: "word", text: "pratiquer", status: "got" })]; state.vocabulary = [];`);
  const row = json(app.run(`phrasebookItemsForSelected().find((item) => item.id === "w1")`));
  assert.equal(row.kind, "word");
  assert.equal(row.origin, "phrase");
  app.context.__row = row;
  app.run("togglePhrasebookItemStatus(__row)");
  assert.equal(app.run(`state.phraseItems[0].status`), "learning");
  app.run("deletePhrasebookItem(__row)");
  assert.equal(app.run("state.phraseItems.length"), 0);
  assert.match(app.run("__confirms[0]"), /删除单词「pratiquer」/);
});

test("entries of the vocabulary list still use the vocabulary actions", () => {
  const app = newApp();
  app.run(`state.vocabulary = normalizeVocabularyList([${JSON.stringify(word("v1", "maison"))}]); state.phraseItems = [];`);
  const row = json(app.run(`phrasebookItemsForSelected().find((item) => item.id === "v1")`));
  assert.equal(row.origin, "vocabulary");
  app.context.__row = row;
  app.run("togglePhrasebookItemStatus(__row)");
  assert.equal(app.run("state.vocabulary[0].status"), "got");
});

function openEditDialog(app, id) {
  app.run(`var __dialog = null; openDialog = function (config) { __dialog = config; }; openVocabDialog(${JSON.stringify(id)});`);
  return (values) => { app.context.__values = values; return app.run("__dialog.onSubmit(__values)"); };
}

test("editing a word's IPA keeps all the wordbooks it belongs to", () => {
  const app = newApp();
  app.run(`state.vocabulary = normalizeVocabularyList([${JSON.stringify(word("v1", "maison", { wordbookIds: ["wb1", "wb2"] }))}]);`);
  const submit = openEditDialog(app, "v1");
  submit({ word: "maison", ipa: "/mɛ.zɔ̃/", zh: "房子", wordbookId: "wb1", status: "new" });
  assert.deepEqual(json(app.run("state.vocabulary[0].wordbookIds")), ["wb1", "wb2"]);
  assert.equal(app.run("state.vocabulary[0].ipa"), "/mɛ.zɔ̃/");
  // Moving it out of the first wordbook leaves the second.
  const again = openEditDialog(app, "v1");
  again({ word: "maison", ipa: "/mɛ.zɔ̃/", zh: "房子", wordbookId: "", status: "new" });
  assert.deepEqual(json(app.run("state.vocabulary[0].wordbookIds")), ["wb2"]);
});

test("renaming a word onto another word merges them instead of overwriting the other", () => {
  const app = newApp();
  app.run(`state.vocabulary = normalizeVocabularyList([
    ${JSON.stringify(word("v1", "maison", { zh: "房子", wordbookIds: ["wb1"], status: "got" }))},
    ${JSON.stringify(word("v2", "maisons", { zh: "房子（复数）", wordbookIds: ["wb2"], status: "new" }))}
  ]);`);
  const submit = openEditDialog(app, "v2");
  submit({ word: "maison", ipa: "", zh: "", wordbookId: "wb2", status: "new" });
  assert.equal(app.run("state.vocabulary.length"), 1, "the two entries became one");
  const merged = json(app.run("state.vocabulary[0]"));
  assert.equal(merged.id, "v1");
  assert.equal(merged.zh, "房子", "the existing meaning is not blanked by an empty field");
  assert.equal(merged.status, "got", "progress is kept");
  assert.deepEqual(merged.wordbookIds.sort(), ["wb1", "wb2"]);
});

test("a learning package leaves out the learner's private notes and practice history", () => {
  const app = newApp();
  app.run(`
    state.entries = [{ id: "e1", tapeId: "t1", title: "T", text: "Salut.", notes: "我的私人备注", language: "fr", materialType: "文章", courseLessonId: "L1", practiceCount: 9, lastPracticedAt: "2026-10-01", createdAt: "x", updatedAt: "x" }];
    state.tapes = [{ id: "t1", albumId: "a1", title: "磁带" }];
  `);
  const material = json(app.run(`activeLearningPackageMaterial({ id: "L1" })`));
  assert.equal(material.entry.notes, "");
  assert.equal(material.entry.practiceCount, 0);
  assert.equal(material.entry.lastPracticedAt, null);
  assert.equal(app.run("state.entries[0].notes"), "我的私人备注", "the learner's own entry is untouched");
});
