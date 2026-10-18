"use strict";

// Builds tests/fixtures/v1-state.json with the real 1.0 code (loaded through the
// 1.0 test harness), so the migration tests run against data 1.0 actually writes.
// Run from v2/: node scripts/make-v1-fixture.cjs
const fs = require("node:fs");
const path = require("node:path");
const { loadApp } = require("../../tests/helpers/load-app.js");

const app = loadApp();
const json = app.run(`
  state = ensureStateShape(createStarterState({}));

  // A learner's own tape: the first entry turns into a lesson (1.0 does that when
  // an album has none yet); the second entry is added later and stays a plain entry.
  const travel = createAlbum("旅行用语", "出门在外", "#7CC1B6");
  const travelTape = createTape(travel.id, "默认分轨");
  createEntry(travelTape.id, "在咖啡馆点单", "A: Bonjour, je voudrais un café, s'il vous plaît.\\nB: Bien sûr. Sur place ou à emporter ?", "", { materialType: "情景对话" });
  createEntry(travelTape.id, "问路", "Excusez-moi, où est la gare ? C'est tout droit, puis à gauche.", "记住 tout droit", { materialType: "笔记" });

  // The demo lesson: a recorded sentence and a cached AI explanation.
  const demo = state.courseLessons.find((lesson) => lesson.id === "demo_lesson");
  demo.turns[2].recording = { status: "recorded", durationMs: 2300, mediaKey: "rec_demo_turn_3", mimeType: "audio/mp4", size: 4 };
  demo.turns[2].aiExplanation = {
    summary: "委婉地说想做某事",
    structure: "Je + voudrais + 动词原形",
    grammarPoints: ["vouloir 的条件式表示礼貌"],
    morphology: "",
    pitfalls: ["voudrais 后面不加 de"],
    examples: ["Je voudrais apprendre l'italien."],
    model: "gemma3:4b",
    language: "zh",
    version: "2",
    cacheSource: "desktop",
    generatedAt: "2026-10-01T10:00:00.000Z"
  };

  // An imported learning package: a lesson no tape points to.
  state.courseLessons.push(normalizeCourseLesson({
    id: "course_imported",
    title: "导入的课程",
    materialType: "文章",
    turns: [{ id: "t1", text: "Paris est une belle ville.", translation: "巴黎是一座美丽的城市。" }]
  }));

  // Words and a custom wordbook.
  state.wordbooks.push({ id: "wordbook_food", title: "吃饭", description: "", createdAt: nowIso(), updatedAt: nowIso() });
  state.vocabulary.push({
    id: "word_cafe", word: "café", surface: "café", lemma: "café", normalized: "café", partOfSpeech: "noun", language: "fr",
    ipa: "/ka.fe/", zh: "咖啡", en: "", status: "new", wordbookIds: ["wordbook_food", "all"],
    seenForms: [{ form: "café", normalized: "café", count: 2 }], createdAt: nowIso(), updatedAt: nowIso()
  });
  state.vocabulary.push({
    id: "word_pratiquer", word: "pratiquer", surface: "pratiquer", lemma: "pratiquer", normalized: "pratiquer", partOfSpeech: "verb",
    language: "fr", ipa: "", zh: "", en: "", status: "got", wordbookIds: [], seenForms: [], createdAt: nowIso(), updatedAt: nowIso()
  });
  state.settings.rate = "0.75";
  state.settings.pause = "1.2";
  state.settings.repeat = "2";
  state.settings.voice = "Thomas|fr-FR";
  state.settings.voiceLocked = true;
  state.study.streak = 4;
  state.study.lastStudyDate = "2026-10-17";

  JSON.stringify(ensureStateShape(JSON.parse(JSON.stringify(state))), null, 2);
`);

const out = path.join(__dirname, "../tests/fixtures/v1-state.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${json}\n`);
console.log(`wrote ${path.relative(process.cwd(), out)}`);
