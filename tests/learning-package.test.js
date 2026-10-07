const test = require("node:test");
const assert = require("node:assert/strict");

const learningPackage = require("../learning-package.js");

function fixtureLesson() {
  return {
    id: "course_1",
    title: "Bonjour",
    language: "fr",
    explainLanguage: "zh",
    materialType: "文章",
    lexicalUnits: [{ text: "un peu", lemma: "un peu", type: "expression" }],
    practice: { completed: 2, correct: 1 },
    turns: [
      {
        id: "turn_1",
        text: "Je marche un peu.",
        translation: "我走一小会儿。",
        aiExplanation: {
          summary: "表示短时间步行。",
          structure: "主语 + 动词 + 程度表达",
          grammarPoints: ["marche 是 marcher 的变位。"],
          morphology: "marcher → je marche",
          pitfalls: [],
          examples: ["Je travaille un peu."],
          version: "2",
          language: "zh"
        },
        recording: { status: "recorded", durationMs: 900, mediaKey: "audio:1" }
      }
    ]
  };
}

test("round-trips cached learning content without device recordings", () => {
  const payload = learningPackage.build({
    appVersion: "1.0.0",
    lesson: fixtureLesson(),
    material: {
      album: { id: "album_1", title: "旅行" },
      tape: { id: "tape_1", albumId: "album_1", title: "步行" },
      entry: { id: "entry_1", tapeId: "tape_1", title: "Bonjour", text: "Je marche un peu." }
    },
    dictionaryEntries: { "3:fr:marcher:verb": { lemma: "marcher", senses: ["走路"] } },
    phraseItems: [{ id: "phrase_1", text: "un peu", sourceLessonId: "course_1" }]
  });
  const restored = learningPackage.validate(JSON.parse(JSON.stringify(payload)));

  assert.equal(restored.type, "oofr.learning-package");
  assert.equal(restored.schemaVersion, 1);
  assert.equal(restored.appVersion, "1.0.0");
  assert.equal(restored.course.turns[0].translation, "我走一小会儿。");
  assert.equal(restored.course.turns[0].aiExplanation.summary, "表示短时间步行。");
  assert.equal(restored.course.turns[0].aiExplanation.cacheSource, "learning-package");
  assert.deepEqual(restored.course.lexicalUnits, fixtureLesson().lexicalUnits);
  assert.equal(restored.course.turns[0].recording.status, "none");
  assert.equal(restored.course.turns[0].recording.mediaKey, "");
  assert.equal(restored.course.aiExplanations.length, 1);
  assert.equal(restored.dictionaryEntries["3:fr:marcher:verb"].senses[0], "走路");
  assert.equal(restored.phraseItems.length, 1);
});

test("rejects unrelated or empty JSON files", () => {
  assert.throws(() => learningPackage.validate({}), /不是 OoFR/);
  assert.throws(() => learningPackage.validate({ type: learningPackage.TYPE, schemaVersion: 1, course: {} }), /没有可用课程/);
});
