const test = require("node:test");
const assert = require("node:assert/strict");

const { loadApp } = require("./helpers/load-app.js");

const APP_KEY = "oofr.app.v1";
const CORRUPT_KEY = "oofr.app.v1.corrupt";
const BACKUP_KEY = "oofr.app.v1.backup";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function savedStateWithoutAlbums(app) {
  return app.run(`(() => {
    const saved = JSON.parse(JSON.stringify(createStarterState({})));
    saved.albums = []; saved.tapes = []; saved.entries = [];
    saved.vocabulary = [{ id: "v1", word: "bonjour", surface: "bonjour", lemma: "bonjour", normalized: "bonjour", status: "got", ipa: "/bɔ̃.ʒuʁ/", zh: "你好", language: "fr", wordbookIds: [] }];
    saved.wordbooks = [{ id: "wb_mine", title: "我的词本" }];
    saved.settings.rate = "0.63";
    saved.settings.localAiModel = "gemma3:4b";
    saved.study.checkins = 4;
    return saved;
  })()`);
}

test("keeps vocabulary, wordbooks, study stats and settings when the last album was deleted", () => {
  const app = loadApp();
  const saved = savedStateWithoutAlbums(app);
  app.context.__saved = saved;
  const result = app.run(`(() => {
    const s = ensureStateShape(__saved);
    return { albums: s.albums.length, vocab: s.vocabulary.length, wordbooks: s.wordbooks.length, rate: s.settings.rate, model: s.settings.localAiModel, checkins: s.study.checkins };
  })()`);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { albums: 0, vocab: 1, wordbooks: 1, rate: "0.63", model: "gemma3:4b", checkins: 4 });
});

test("falls back to the starter state only when the data is not an OoFR state", () => {
  const app = loadApp();
  for (const raw of ["null", "[]", "{}", '{"vocabulary":[{"word":"x"}]}', '{"type":"oofr.learning-package"}']) {
    const albums = app.run(`ensureStateShape(${raw}).albums.length`);
    assert.equal(albums, 1, `starter album expected for ${raw}`);
  }
});

test("quarantines unreadable stored JSON instead of silently replacing it", async () => {
  const damaged = '{"version":1,"albums":[{"id":"a1","title":"我的磁带"}],"vocabulary":[{"id":"v1","word":"bon';
  const app = loadApp({ store: { [APP_KEY]: damaged } });
  app.run("renderMy = function () {};");
  const loaded = await app.run("loadAppState()");
  assert.equal(loaded.albums[0].title, "入门练习", "falls back to the starter lesson");
  assert.equal(app.localStorage.getItem(CORRUPT_KEY), damaged, "raw text is preserved");
  assert.equal(app.run("storageNotice && storageNotice.kind"), "unreadable");

  app.run("state = ensureStateShape(createStarterState({}));");
  app.run("persist()");
  await tick();
  assert.notEqual(app.localStorage.getItem(APP_KEY), damaged);
  assert.equal(app.localStorage.getItem(CORRUPT_KEY), damaged, "quarantined copy survives later saves");
});

test("persist saves before rendering and a render error cannot block the save", async () => {
  const app = loadApp();
  app.run("state = createStarterState({}); renderMy = function () { throw new Error('render failed'); }; queueSyncedSettings = function () {};");
  app.run("persist()");
  await tick();
  assert.ok(JSON.parse(app.localStorage.getItem(APP_KEY)).albums.length >= 1);
});

test("a failed save raises a lasting notice and clears it after the next successful save", async () => {
  const app = loadApp({ quotaChars: 500 });
  app.run("renderMy = function () {}; queueSyncedSettings = function () {}; state = createStarterState({});");
  app.run("persist()");
  await tick();
  assert.equal(app.run("storageNotice && storageNotice.kind"), "save-failed");
  assert.equal(app.localStorage.getItem(APP_KEY), null);

  app.localStorage.setItem = (key, value) => { app.localStorage.data[key] = String(value); };
  app.run("persist()");
  await tick();
  assert.equal(app.run("storageNotice"), null);
});

test("dictionary hydration fills missing meanings but never overwrites edited ones", async () => {
  const app = loadApp();
  app.run(`
    renderMy = function () {}; queueSyncedSettings = function () {};
    renderWordbooks = renderVocab = renderSentences = renderWordPanel = function () {};
    window.OOFR_DICTIONARY = {
      ready: async () => {},
      lookup: async (surface) => ({ word: surface, lemma: surface, pos: "noun", ipa: "/DICT/", zh: "词典释义", en: "dictionary sense", surface })
    };
    state = createStarterState({});
    state.vocabulary = normalizeVocabularyList([
      { id: "edited", word: "maison", surface: "maison", lemma: "maison", normalized: "maison", partOfSpeech: "noun", ipa: "/MY-IPA/", zh: "我自己的释义", status: "got", language: "fr" },
      { id: "empty", word: "jardin", surface: "jardin", lemma: "jardin", normalized: "jardin", partOfSpeech: "noun", ipa: "", zh: "", status: "new", language: "fr" }
    ]);
  `);
  await app.run("hydrateVocabularyFromStructuredDictionary()");
  const byId = JSON.parse(app.run("JSON.stringify(Object.fromEntries(state.vocabulary.map((item) => [item.id, { ipa: item.ipa, zh: item.zh }])))"));
  assert.deepEqual(byId.edited, { ipa: "/MY-IPA/", zh: "我自己的释义" });
  assert.deepEqual(byId.empty, { ipa: "/DICT/", zh: "词典释义" });
});

test("dictionary hydration only looks up words that are still incomplete", async () => {
  const app = loadApp();
  app.run(`
    renderMy = function () {}; queueSyncedSettings = function () {};
    renderWordbooks = renderVocab = renderSentences = renderWordPanel = function () {};
    var __lookups = [];
    window.OOFR_DICTIONARY = { ready: async () => {}, lookup: async (surface) => { __lookups.push(surface); return null; } };
    state = createStarterState({});
    state.vocabulary = normalizeVocabularyList([
      { id: "done", word: "maison", surface: "maison", lemma: "maison", normalized: "maison", partOfSpeech: "noun", ipa: "/mɛ.zɔ̃/", zh: "房子", status: "got", language: "fr" },
      { id: "todo", word: "jardin", surface: "jardin", lemma: "jardin", normalized: "jardin", partOfSpeech: "noun", ipa: "", zh: "", status: "new", language: "fr" }
    ]);
  `);
  await app.run("hydrateVocabularyFromStructuredDictionary()");
  assert.deepEqual(JSON.parse(app.run("JSON.stringify(__lookups)")), ["jardin"]);
});

test("keeps a locked voice while the browser has not loaded its voice list yet", () => {
  const speechSynthesis = { getVoices: () => [], speaking: false };
  const app = loadApp({ extra: { speechSynthesis, SpeechSynthesisUtterance: function SpeechSynthesisUtterance() {} } });
  app.run("renderMy = function () {}; queueSyncedSettings = function () {};");
  app.run("state = createStarterState({}); state.settings.voice = 'Thomas|fr-FR'; state.settings.voiceLocked = true;");
  app.run("loadVoices()");
  assert.equal(app.run("state.settings.voice"), "Thomas|fr-FR");
  assert.equal(app.run("state.settings.voiceLocked"), true);

  // Once the list arrives and the voice really exists, it is still honoured.
  speechSynthesis.getVoices = () => [{ name: "Thomas", lang: "fr-FR", voiceURI: "Thomas|fr-FR" }];
  app.run("loadVoices()");
  assert.equal(app.run("state.settings.voice"), "Thomas|fr-FR");
  assert.equal(app.run("state.settings.voiceLocked"), true);
});

test("explanation cache label works for locally cached explanations", () => {
  const app = loadApp();
  app.run("state = createStarterState({});");
  const label = app.run("courseExplanationCacheLabel({ model: 'gemma3:4b' })");
  assert.match(label, /gemma3:4b/);
  assert.match(app.run("courseExplanationCacheLabel({ cacheSource: 'learning-package' })"), /学习包/);
});

test("dialog validation rejects whitespace-only required fields", () => {
  const app = loadApp();
  const bad = app.run(`validateRequiredDialogValues({ title: "   ", note: "x" }, ["title"])`);
  assert.equal(bad.ok, false);
  assert.equal(bad.field, "title");
  const good = app.run(`validateRequiredDialogValues({ title: "  Voyage  ", note: " x " }, ["title"])`);
  assert.equal(good.ok, true);
  assert.equal(good.values.title, "Voyage");
  assert.equal(good.values.note, " x ", "optional fields are left untouched");
});

test("importing a file that is not an OoFR backup is rejected and keeps current data", async () => {
  const app = loadApp();
  app.run("renderMy = function () {}; queueSyncedSettings = function () {}; renderAll = function () {}; syncSettingsControls = function () {};");
  app.run("state = createStarterState({}); state.vocabulary = normalizeVocabularyList([{ id: 'v', word: 'maison', surface: 'maison', status: 'got', language: 'fr' }]); window.confirm = () => true;");
  for (const text of ['{"type":"oofr.learning-package","schemaVersion":1}', "[]", "not json", '{"vocabulary":[]}']) {
    const outcome = await app.run(`importBackupText(${JSON.stringify(text)})`);
    assert.equal(outcome.imported, false, text);
  }
  assert.equal(app.run("state.vocabulary.length"), 1);
});

test("a full import keeps a restorable copy of the previous data and sanitizes settings", async () => {
  const app = loadApp();
  app.run("renderMy = function () {}; queueSyncedSettings = function () {}; renderAll = function () {}; syncSettingsControls = function () {};");
  app.run("state = createStarterState({}); state.currentText = 'before import'; window.confirm = () => true;");
  const incoming = app.run(`(() => {
    const s = JSON.parse(JSON.stringify(createStarterState({})));
    s.currentText = "after import";
    s.settings.rate = { hostile: true };
    s.settings.voiceLocked = "yes";
    s.settings.extra = { nested: 1 };
    return JSON.stringify(s);
  })()`);
  const outcome = await app.run(`importBackupText(${JSON.stringify(incoming)})`);
  assert.equal(outcome.imported, true);
  assert.equal(app.run("state.currentText"), "after import");
  assert.equal(app.run("typeof state.settings.rate"), "string");
  assert.equal(app.run("typeof state.settings.voiceLocked"), "boolean");
  assert.equal(app.run("'extra' in state.settings"), false);
  assert.equal(JSON.parse(app.localStorage.getItem(BACKUP_KEY)).currentText, "before import");

  const restored = await app.run("restoreStateBackup()");
  assert.equal(restored, true);
  assert.equal(app.run("state.currentText"), "before import");
});

test("the Chrome/Edge extension storage driver keeps state and the import backup in chrome.storage", async () => {
  const bucket = {};
  const chrome = {
    runtime: {},
    storage: {
      local: {
        get: (key, done) => done({ [key]: bucket[key] }),
        set: (items, done) => { Object.assign(bucket, JSON.parse(JSON.stringify(items))); done(); }
      },
      sync: { get: (key, done) => done({}), set: (items, done) => done() }
    }
  };
  const app = loadApp({ protocol: "chrome-extension:", hostname: "abc", extra: { chrome } });
  app.run("renderMy = function () {}; queueSyncedSettings = function () {}; renderAll = function () {}; syncSettingsControls = function () {}; window.confirm = () => true;");
  app.run("state = createStarterState({}); state.currentText = 'extension data';");
  app.run("persist()");
  await tick();
  assert.equal(bucket[APP_KEY].currentText, "extension data");
  assert.equal(app.localStorage.getItem(APP_KEY), null, "extension must not use page localStorage");

  const loaded = await app.run("loadAppState()");
  assert.equal(loaded.currentText, "extension data");

  assert.equal(await app.run("storageDriver.hasLocal('oofr.app.v1.backup')"), false);
  const incoming = app.run("JSON.stringify(createStarterState({}))");
  assert.equal((await app.run(`importBackupText(${JSON.stringify(incoming)})`)).imported, true);
  assert.equal(await app.run("storageDriver.hasLocal('oofr.app.v1.backup')"), true);
  assert.equal(bucket[BACKUP_KEY].currentText, "extension data");
});

test("a save made in another window raises a notice, a save of our own does not", () => {
  const app = loadApp();
  app.run("renderMy = function () {}; queueSyncedSettings = function () {}; state = createStarterState({});");
  const other = (key) => app.run(`handleStorageEvent({ key: ${JSON.stringify(key)}, newValue: "{}", storageArea: window.localStorage })`);
  other("unrelated.key");
  assert.equal(app.run("storageNotice"), null);
  other(APP_KEY);
  assert.equal(app.run("storageNotice && storageNotice.kind"), "changed-elsewhere");

  // chrome.storage reports our own write too; only changes well after it count.
  app.run("hideStorageNotice(); lastOwnWriteAt = Date.now();");
  app.run(`handleExtensionStorageChange({ "oofr.app.v1": {} }, "local")`);
  assert.equal(app.run("storageNotice"), null);
  app.run("lastOwnWriteAt = Date.now() - 10000;");
  app.run(`handleExtensionStorageChange({ "oofr.app.v1": {} }, "local")`);
  assert.equal(app.run("storageNotice && storageNotice.kind"), "changed-elsewhere");
});

test("a legacy-lexicon load that teaches nothing does not save or repaint", () => {
  const app = loadApp();
  app.run(`
    renderMy = function () {}; queueSyncedSettings = function () {};
    window.OOFR_LEXICON = {}; window.OOFR_FORM_LEMMAS = {}; window.OOFR_LEXICON_META = { entries: 1 };
    state = createStarterState({});
    state.vocabulary = normalizeVocabularyList([{ id: "w", word: "maison", surface: "maison", lemma: "maison", normalized: "maison", partOfSpeech: "noun", ipa: "/mɛ.zɔ̃/", zh: "房子", status: "got", language: "fr", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]);
    var __saves = 0; var __paints = 0;
    persist = function () { __saves += 1; };
    renderWordbooks = renderVocab = renderSentences = renderWordPanel = function () { __paints += 1; };
    hydrateVocabularyFromLexicon();
  `);
  assert.equal(app.run("__saves"), 0);
  assert.equal(app.run("__paints"), 0);
});
