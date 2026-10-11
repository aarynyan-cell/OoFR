const test = require("node:test");
const assert = require("node:assert/strict");

const { loadApp } = require("./helpers/load-app.js");

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// A controllable stand-in for the browser's speech engine.
function createSpeechEngine({ pauseCancels = false } = {}) {
  const engine = {
    spoken: [],
    queue: [],
    paused: false,
    speaking: false,
    getVoices: () => [],
    speak(utterance) {
      engine.spoken.push(utterance.text);
      engine.queue.push(utterance);
      engine.speaking = true;
    },
    cancel() {
      const pending = engine.queue.splice(0);
      engine.speaking = false;
      pending.forEach((utterance) => setTimeout(() => utterance.onerror?.({ error: "canceled" }), 0));
    },
    pause() {
      engine.paused = true;
      if (pauseCancels) engine.cancel();
    },
    resume() { engine.paused = false; },
    finishCurrent() {
      const utterance = engine.queue.shift();
      engine.speaking = engine.queue.length > 0;
      utterance?.onend?.({});
    },
    failCurrent(error) {
      const utterance = engine.queue.shift();
      engine.speaking = engine.queue.length > 0;
      utterance?.onerror?.({ error });
    }
  };
  return engine;
}

function newPlayer(engine) {
  const app = loadApp({
    extra: { speechSynthesis: engine, SpeechSynthesisUtterance: function SpeechSynthesisUtterance(text) { this.text = text; } }
  });
  app.run(`
    renderMy = function () {}; queueSyncedSettings = function () {};
    state = createStarterState({});
    var __statuses = [];
    setStatus = function (message) { __statuses.push(message); };
    var __lesson = normalizeCourseLesson({ id: "L", title: "Lesson", turns: [
      { id: "t0", text: "Un." }, { id: "t1", text: "Deux." }, { id: "t2", text: "Trois." }
    ] });
    state.courseLessons = [__lesson];
    state.activeCourseId = "L";
    var __items = __lesson.turns.map((turn, index) => ({ text: turn.text, label: "第 " + (index + 1) + " 句", lang: "fr-FR", turnIndex: index }));
  `);
  return app;
}

test("a superseded run does not stop the new run's progress ticker", async () => {
  const engine = createSpeechEngine();
  const app = newPlayer(engine);
  app.run(`playItems(__items, { key: "course:L:all" })`);
  await wait();
  app.run(`playItems([__items[1]], { key: "course:L:turn:1" })`);
  await wait(10);
  assert.deepEqual(engine.spoken, ["Un.", "Deux."]);
  assert.equal(app.run("courseProgressTickerState && courseProgressTickerState.turnIndex"), 1);
  assert.equal(app.run("playback.status"), "playing");
  app.run("stopSpeech({ quiet: true })");
});

test("pause that the engine implements as cancel does not skip the sentence", async () => {
  const engine = createSpeechEngine({ pauseCancels: true });
  const app = newPlayer(engine);
  app.run(`playItems(__items, { key: "course:L:all" })`);
  await wait();
  app.run("pauseSpeech()");
  await wait(10);
  assert.equal(app.run("courseCurrentTurnIndex"), 0, "still on the first sentence");
  assert.deepEqual(engine.spoken, ["Un."], "nothing new is spoken while paused");

  app.run("resumeSpeech()");
  await wait(200);
  assert.deepEqual(engine.spoken, ["Un.", "Un."], "the paused sentence is said again after resume");
  engine.finishCurrent();
  await wait(10);
  assert.equal(app.run("courseCurrentTurnIndex"), 1);
  app.run("stopSpeech({ quiet: true })");
});

test("repeated speech errors stop the run instead of spinning", async () => {
  const engine = createSpeechEngine();
  engine.speak = function speak(utterance) {
    engine.spoken.push(utterance.text);
    setTimeout(() => utterance.onerror?.({ error: "synthesis-failed" }), 0);
  };
  const app = newPlayer(engine);
  app.run(`playItems(__items, { key: "course:L:single", loop: true })`);
  await wait(100);
  assert.ok(engine.spoken.length <= 3, `spoke ${engine.spoken.length} times`);
  assert.equal(app.run("playback.status"), "idle");
  assert.match(app.run("__statuses[__statuses.length - 1]"), /朗读/);
});

test("an interruption by the system ends the run instead of advancing", async () => {
  const engine = createSpeechEngine();
  const app = newPlayer(engine);
  app.run(`playItems(__items, { key: "course:L:all" })`);
  await wait();
  engine.failCurrent("interrupted");
  await wait(10);
  assert.equal(app.run("playback.status"), "idle");
  assert.deepEqual(engine.spoken, ["Un."]);
  assert.match(app.run("__statuses[__statuses.length - 1]"), /打断/);
});

test("pronouncing a word stops the lesson instead of letting it run on", async () => {
  const engine = createSpeechEngine();
  const app = newPlayer(engine);
  app.run(`elements.courseRateSelect = { value: "0.9", options: [] };`);
  app.run(`playItems(__items, { key: "course:L:all" })`);
  await wait();
  app.run(`speakCourseWord("mot", __lesson)`);
  await wait(10);
  assert.equal(app.run("playback.status"), "idle");
  assert.deepEqual(engine.spoken, ["Un.", "mot"], "the lesson did not advance to the next sentence");
});

test("only the transport controls pause a running course; other sentence buttons start their sentence", async () => {
  const engine = createSpeechEngine();
  const app = newPlayer(engine);
  app.run(`playItems(__items, { key: "course:L:all", transport: true })`);
  await wait();
  // The button of another sentence replaces the run.
  app.run(`playCourseTurn(__lesson, 2)`);
  await wait(10);
  assert.equal(app.run("playback.key"), "course:L:turn:2");
  assert.equal(app.run("playback.status"), "playing");
  assert.equal(engine.spoken.at(-1), "Trois.");
  // The button of the sentence being played pauses it.
  app.run(`playCourseTurn(__lesson, 2)`);
  assert.equal(app.run("playback.status"), "paused");
  app.run("stopSpeech({ quiet: true })");
});

test("play starts from the sentence the learner moved to, and from the top after a finished run", async () => {
  const engine = createSpeechEngine();
  const app = newPlayer(engine);
  app.run("courseCurrentTurnIndex = 2; courseRunFinished = false;");
  app.run("playCourseSelection({ type: 'click' })"); // a click event, not an explicit option
  await wait();
  assert.deepEqual(engine.spoken, ["Trois."]);
  app.run("stopSpeech({ quiet: true })");

  app.run("courseCurrentTurnIndex = 2; courseRunFinished = true;");
  app.run("playCourseSelection({ type: 'click' })");
  await wait();
  assert.equal(engine.spoken.at(-1), "Un.");
  app.run("stopSpeech({ quiet: true })");
});

test("changing the playback mode stops the running course", async () => {
  const engine = createSpeechEngine();
  const app = newPlayer(engine);
  app.run(`playItems(__items, { key: "course:L:all" })`);
  await wait();
  app.run("stopCoursePlaybackForSettingChange()");
  assert.equal(app.run("playback.status"), "idle");
});

// ---------------------------------------------------------------- recording

function newRecorder({ mediaRecorderFails = false } = {}) {
  const tracks = [];
  const streams = [];
  class FakeRecorder {
    constructor(stream) {
      if (mediaRecorderFails) throw new Error("unsupported mime type");
      this.stream = stream;
      this.state = "inactive";
      this.mimeType = "audio/mp4";
      this.listeners = {};
    }
    static isTypeSupported() { return true; }
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
    emit(type, event = {}) { (this.listeners[type] || []).forEach((handler) => handler(event)); }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      this.emit("dataavailable", { data: new Blob(["audio-bytes"]) });
      this.emit("stop");
    }
  }
  const app = loadApp({ extra: { MediaRecorder: FakeRecorder } });
  let release;
  app.context.navigator.mediaDevices = {
    getUserMedia: () => new Promise((resolve) => {
      release = () => {
        const stream = { getTracks: () => [{ stop: () => tracks.push("stopped") }] };
        streams.push(stream);
        resolve(stream);
      };
    })
  };
  app.run(`
    renderMy = function () {}; queueSyncedSettings = function () {}; renderCoursePlayer = function () {}; renderCourseTranscript = function () {};
    state = createStarterState({});
    var __statuses = []; setStatus = function (message) { __statuses.push(message); };
    var __saved = []; saveRecordingBlob = async function (key) { __saved.push(key); };
    var __released = []; deleteRecordingBlob = async function (key) { __released.push(key); };
    var __lesson = normalizeCourseLesson({ id: "L", title: "Lesson", turns: [{ id: "t0", text: "Un.", speakerLabel: "A" }] });
    state.courseLessons = [__lesson]; state.activeCourseId = "L";
  `);
  return { app, tracks, streams, release: () => release() };
}

test("a second click while the microphone prompt is open cannot start a second recorder", async () => {
  const { app, release, streams } = newRecorder();
  const first = app.run(`startCourseRecording(__lesson, "t0")`);
  app.run(`startCourseRecording(__lesson, "t0")`);
  assert.match(app.run("__statuses.at(-1)"), /请先停止当前录音/);
  release();
  await first;
  assert.equal(streams.length, 1);
  assert.equal(app.run("courseRecordingSession.turnId"), "t0");
  assert.equal(app.run("__lesson.turns[0].recording.status"), "none", "the saved turn is not flipped to 'recording'");
});

test("a recording is saved before the turn points at it, and the replaced take is queued for deletion", async () => {
  const { app, release } = newRecorder();
  app.run(`__lesson.turns[0].recording = { status: "recorded", durationMs: 500, mediaKey: "old:key" };`);
  const started = app.run(`startCourseRecording(__lesson, "t0")`);
  release();
  await started;
  app.run(`stopCourseRecording(__lesson, "t0")`);
  await wait(10);
  assert.equal(app.run("__lesson.turns[0].recording.status"), "recorded");
  assert.notEqual(app.run("__lesson.turns[0].recording.mediaKey"), "old:key");
  assert.equal(app.run("__saved.length"), 1);
  assert.deepEqual(JSON.parse(app.run("JSON.stringify(__released)")), ["old:key"], "the replaced take is deleted once the new state is saved");
  assert.equal(app.run("courseRecordingSession"), null);
});

test("a failed save keeps the earlier take and shows a message", async () => {
  const { app, release } = newRecorder();
  app.run(`__lesson.turns[0].recording = { status: "recorded", durationMs: 500, mediaKey: "old:key" };
           saveRecordingBlob = async function () { throw new Error("disk full"); };`);
  const started = app.run(`startCourseRecording(__lesson, "t0")`);
  release();
  await started;
  app.run(`stopCourseRecording(__lesson, "t0")`);
  await wait(10);
  assert.equal(app.run("__lesson.turns[0].recording.mediaKey"), "old:key");
  assert.equal(app.run("__lesson.turns[0].recording.status"), "recorded");
  assert.match(app.run("__statuses.at(-1)"), /保存失败/);
});

test("the microphone is released when the recorder cannot be created", async () => {
  const { app, release, tracks } = newRecorder({ mediaRecorderFails: true });
  const started = app.run(`startCourseRecording(__lesson, "t0")`);
  release();
  await started;
  assert.deepEqual(tracks, ["stopped"]);
  assert.equal(app.run("courseRecordingSession"), null);
  assert.equal(app.run("courseRecordingStarting"), false);
});

test("leaving the page stops the recording and keeps the take so far", async () => {
  const { app, release, tracks } = newRecorder();
  const started = app.run(`startCourseRecording(__lesson, "t0")`);
  release();
  await started;
  app.run("stopCourseRecordingSession()");
  await wait(10);
  assert.equal(app.run("__lesson.turns[0].recording.status"), "recorded");
  assert.deepEqual(tracks, ["stopped"]);
});

test("the repeat count and gap come from the saved settings (the player menu is their only control)", async () => {
  const engine = createSpeechEngine();
  const app = newPlayer(engine);
  app.run(`state.settings.repeat = "2"; state.settings.pause = "0";`);
  assert.equal(app.run("getRepeat()"), 2);
  app.run(`playItems([__items[0]], { key: "course:L:turn:0" })`);
  await wait();
  engine.finishCurrent();
  await wait(30);
  assert.deepEqual(engine.spoken, ["Un.", "Un."], "the sentence is said twice");
  engine.finishCurrent();
  await wait(10);
  assert.equal(app.run("playback.status"), "idle");

  app.run(`state.settings.repeat = "banana";`);
  assert.equal(app.run("getRepeat()"), 1, "a damaged value falls back to one");
});

test("the repeat and gap menus show the saved values, picking the nearest gap", () => {
  const app = newPlayer(createSpeechEngine());
  app.run(`
    elements.courseRepeatSelect = { value: "" };
    elements.coursePauseSelect = { value: "", options: ["0", "0.4", "0.8", "1.5"].map((value) => ({ value })) };
    state.settings.repeat = "3"; state.settings.pause = "0.7";
    syncCourseTimingControls();
  `);
  assert.equal(app.run("elements.courseRepeatSelect.value"), "3");
  assert.equal(app.run("elements.coursePauseSelect.value"), "0.8");
});

test("feedback messages appear as a toast, routine playback progress does not", () => {
  const app = loadApp();
  app.run(`elements.toast = { textContent: "", hidden: true }; elements.statusLine = { textContent: "" };`);
  app.run(`setStatus("完整数据导入完成");`);
  assert.equal(app.run("elements.toast.textContent"), "完整数据导入完成");
  assert.equal(app.run("elements.toast.hidden"), false);
  app.run(`elements.toast.hidden = true; elements.toast.textContent = ""; setStatus("正在播放：第 1 句", { toast: false });`);
  assert.equal(app.run("elements.toast.hidden"), true);
  assert.equal(app.run("elements.statusLine.textContent"), "正在播放：第 1 句", "the text is still recorded");
});
