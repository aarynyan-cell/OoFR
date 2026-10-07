(function attachOoFRLearningPackage(scope) {
  "use strict";

  const TYPE = "oofr.learning-package";
  const SCHEMA_VERSION = 1;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function sanitizeLesson(lesson) {
    const course = clone(lesson || {});
    course.turns = (course.turns || []).map((turn) => ({
      ...turn,
      aiExplanation: turn.aiExplanation ? { ...turn.aiExplanation, cacheSource: "learning-package" } : null,
      recording: { status: "none", durationMs: 0, mediaKey: "" }
    }));
    course.aiExplanations = course.turns
      .filter((turn) => turn.aiExplanation)
      .map((turn) => ({ turnId: turn.id, explanation: clone(turn.aiExplanation) }));
    return course;
  }

  function build({ appVersion, lesson, material = {}, dictionaryEntries = {}, phraseItems = [] }) {
    if (!lesson?.id || !lesson?.title || !Array.isArray(lesson.turns)) {
      throw new Error("当前课程数据不完整，无法导出学习包");
    }
    return {
      type: TYPE,
      schemaVersion: SCHEMA_VERSION,
      appVersion: String(appVersion || ""),
      exportedAt: new Date().toISOString(),
      material: {
        album: material.album ? clone(material.album) : null,
        tape: material.tape ? clone(material.tape) : null,
        entry: material.entry ? clone(material.entry) : null
      },
      course: sanitizeLesson(lesson),
      dictionaryEntries: clone(dictionaryEntries || {}),
      phraseItems: clone(phraseItems || [])
    };
  }

  function validate(value) {
    if (!value || value.type !== TYPE || Number(value.schemaVersion) !== SCHEMA_VERSION) {
      throw new Error("这不是 OoFR 1.0 学习包");
    }
    if (!value.course?.id || !value.course?.title || !Array.isArray(value.course.turns) || !value.course.turns.length) {
      throw new Error("学习包中没有可用课程");
    }
    return {
      ...clone(value),
      material: value.material && typeof value.material === "object" ? clone(value.material) : { album: null, tape: null, entry: null },
      dictionaryEntries: value.dictionaryEntries && typeof value.dictionaryEntries === "object" ? clone(value.dictionaryEntries) : {},
      phraseItems: Array.isArray(value.phraseItems) ? clone(value.phraseItems) : []
    };
  }

  const api = { TYPE, SCHEMA_VERSION, build, validate, sanitizeLesson };
  scope.OoFRLearningPackage = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
