// Speech playback engine: queue, pause/resume/stop, highlight and the speech-synthesis quirks.
// Part of the app: a classic script sharing the page's global scope with app.js.
// It is loaded before app.js (see index.html); everything here runs only after start-up.

function togglePlayback(items, options = {}) {
  const key = options.key || playbackKeyForItems(items);
  // Only the transport control (bottom play button, or the button of the sentence
  // being played) pauses/resumes whatever course audio is running. Every other
  // start replaces it, so the UI never claims one sentence while another plays.
  const sameRun = playback.key === key
    || (options.transport && key.startsWith("course:") && playback.key.startsWith("course:"));
  if (sameRun && playback.status === "playing") {
    pauseSpeech();
    return;
  }
  if (sameRun && playback.status === "paused") {
    resumeSpeech();
    return;
  }
  playItems(items, { ...options, key });
}

const SPEECH_ERROR_MESSAGES = {
  "not-allowed": "浏览器要求先点一次播放按钮才能朗读，请再点一次",
  "audio-busy": "扬声器正被其他应用占用，朗读失败",
  "audio-hardware": "找不到可用的扬声器，朗读失败",
  "voice-unavailable": "当前设备没有可用的朗读声音",
  "language-unavailable": "当前设备没有这种语言的朗读声音"
};

async function playItems(items, options = {}) {
  const playableItems = items.filter((item) => item?.text?.trim());
  if (playableItems.length === 0) return;

  if (!canSpeak()) {
    setStatus("当前浏览器不支持朗读");
    return;
  }

  const token = ++runToken;
  const key = options.key || playbackKeyForItems(playableItems);
  const label = options.label || playableItems[0]?.label || "朗读";
  window.speechSynthesis.cancel();
  // Some engines stay paused after cancel(), which would silence the new run.
  if (window.speechSynthesis.paused) window.speechSynthesis.resume();
  stopCourseRecordingAudio();
  clearActive();
  playback = { status: "playing", key, label, token };
  setBusy(true);
  renderPlaybackControls();

  let abortMessage = "";
  let speechFailures = 0;
  try {
    run: do {
      for (const item of playableItems) {
        if (token !== runToken) break run;
        const turnIndex = Number(item.turnIndex);
        const isCourseTurn = Number.isInteger(turnIndex);
        // Rows are rebuilt by re-renders, so look the row up each time.
        const row = isCourseTurn ? (findCourseTurnRow(turnIndex) || item.element) : item.element;
        if (isCourseTurn) {
          courseCurrentTurnIndex = turnIndex;
          courseProgressRatio = turnIndex / Math.max(1, getActiveCourseLesson()?.turns.length || 1);
          renderCourseProgress(getActiveCourseLesson() || { turns: [] });
        }
        markActive(row);
        if (isCourseTurn) markCourseTurnActive(turnIndex, row);
        playback.label = item.label || label;
        renderPlaybackControls();
        setStatus(`正在播放：${item.label}`, { toast: false });

        const repeat = getRepeat();
        const courseLesson = isCourseTurn ? getActiveCourseLesson() : null;
        if (courseLesson) startCourseProgressTicker(turnIndex, item.text, courseLesson);
        for (let index = 0; index < repeat; index += 1) {
          if (token !== runToken) break run;
          const outcome = await speakItem(item, token);
          if (token !== runToken) break run;
          if (outcome.status === "cancelled") {
            abortMessage = "朗读被系统打断，已停止";
            break run;
          }
          if (outcome.status === "error") {
            speechFailures += 1;
            if (speechFailures >= 3) {
              abortMessage = SPEECH_ERROR_MESSAGES[outcome.error] || "朗读连续失败，已停止";
              break run;
            }
          } else {
            speechFailures = 0;
          }
          if (index >= repeat - 1) break;
          await pause(getPauseMs(), token);
        }
        if (token === runToken && courseLesson) {
          stopCourseProgressTicker();
          updateCourseProgressRatio((turnIndex + 1) / courseLesson.turns.length, courseLesson);
        }
      }
    } while (options.loop && token === runToken);
    if (token === runToken && !abortMessage && options.transport) courseRunFinished = true;
  } finally {
    // A superseded run must leave the new run's ticker and highlight alone.
    if (token === runToken) {
      stopCourseProgressTicker();
      clearActive();
      setBusy(false);
      playback = { status: "idle", key: "", label: "", token: 0 };
      renderPlaybackControls();
      setStatus(abortMessage || "播放完成", { toast: Boolean(abortMessage) });
    }
  }
}

// Speaks one sentence. Engines that implement pause() as cancel() (Chrome on
// Android, some iOS versions) end the utterance early; when that happens while
// the learner has paused, wait for resume and say the sentence again.
async function speakItem(item, token) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const outcome = await speakOnce(item.text, token, item);
    if (token !== runToken) return outcome;
    if (outcome.status !== "ended" && playback.status === "paused") {
      await waitWhilePaused(token);
      if (token !== runToken) return outcome;
      continue;
    }
    return outcome;
  }
  return { status: "error", error: "retry-limit" };
}

function waitWhilePaused(token) {
  return new Promise((resolve) => {
    const check = () => {
      if (token !== runToken || playback.status !== "paused") resolve();
      else window.setTimeout(check, 120);
    };
    check();
  });
}

function playbackKeyForItems(items) {
  const first = items.find((item) => item?.text?.trim());
  return first ? `text:${normalizeWord(first.text).slice(0, 32)}:${items.length}` : "empty";
}

function isActivePlayback(key) {
  return playback.key === key && (playback.status === "playing" || playback.status === "paused");
}

// Chrome can garbage-collect a speaking utterance and then never fire its events.
let currentUtterance = null;

// Resolves { status: "ended" | "cancelled" | "error", error }.
// "cancelled" means the engine dropped the utterance (interruption, or the
// stop of a superseded run); the caller decides what that means.
function speakOnce(text, token, options = {}) {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = options.lang || "fr-FR";
    utterance.rate = Number(state.settings.rate);
    utterance.pitch = 1;

    const voice = options.forceFrench ? selectedFrenchVoice() : selectedVoiceForLanguage(utterance.lang);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || utterance.lang;
    }

    let settled = false;
    let fallbackTimer = 0;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallbackTimer);
      if (currentUtterance === utterance) currentUtterance = null;
      resolve(result);
    };

    utterance.onend = () => finish({ status: "ended" });
    utterance.onerror = (event) => {
      const reason = String(event?.error || "");
      finish({ status: reason === "canceled" || reason === "interrupted" ? "cancelled" : "error", error: reason });
    };

    const estimatedMs = Math.max(2400, (text.length * 95) / Math.max(0.5, utterance.rate) + 1600);
    let extendedOnce = false;
    const scheduleFallback = (delay = estimatedMs) => {
      fallbackTimer = window.setTimeout(() => {
        if (token !== runToken) {
          finish({ status: "cancelled" });
          return;
        }
        if (playback.status === "paused") {
          scheduleFallback();
          return;
        }
        // The engine never reported the end (Chrome silently stops long
        // utterances). Give it a moment, then cancel so the next sentence is
        // not queued behind a stuck one.
        if (window.speechSynthesis.speaking) {
          if (!extendedOnce) {
            extendedOnce = true;
            scheduleFallback(3000);
            return;
          }
          window.speechSynthesis.cancel();
        }
        finish({ status: "ended" });
      }, delay);
    };
    scheduleFallback();

    if (token === runToken) {
      currentUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    } else {
      finish({ status: "cancelled" });
    }
  });
}

function pauseSpeech() {
  if (!canSpeak() || playback.status !== "playing") return;
  window.speechSynthesis.pause();
  pauseCourseProgressTicker();
  playback.status = "paused";
  renderPlaybackControls();
  setStatus(`已暂停：${playback.label}`, { toast: false });
}

function resumeSpeech() {
  if (!canSpeak() || playback.status !== "paused") return;
  playback.status = "playing";
  window.speechSynthesis.resume();
  resumeCourseProgressTicker();
  renderPlaybackControls();
  setStatus(`继续播放：${playback.label}`, { toast: false });
}

function stopSpeech({ quiet = false } = {}) {
  runToken += 1;
  if (canSpeak()) {
    window.speechSynthesis.cancel();
  }
  currentUtterance = null;
  stopCourseProgressTicker();
  clearActive();
  setBusy(false);
  playback = { status: "idle", key: "", label: "", token: 0 };
  renderPlaybackControls();
  if (!quiet) setStatus("已停止", { toast: false });
}

function pause(milliseconds, token) {
  return new Promise((resolve) => {
    let remaining = milliseconds;
    let lastTick = Date.now();
    const tick = () => {
      if (token !== runToken) {
        resolve();
        return;
      }
      if (playback.status === "paused") {
        lastTick = Date.now();
        window.setTimeout(tick, 120);
        return;
      }

      const now = Date.now();
      remaining -= now - lastTick;
      lastTick = now;
      if (remaining <= 0) {
        resolve();
        return;
      }
      window.setTimeout(tick, Math.min(120, remaining));
    };
    tick();
  });
}

function markActive(element) {
  clearActive();
  if (!element) return;
  activeElement = element;
  activeElement.classList.add("is-active");

  const row = element.closest?.(".sentence-row");
  if (row && row !== element) {
    row.classList.add("is-active");
  }

  row?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
}

function scrollBehavior() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth";
}

function findCourseTurnRow(turnIndex) {
  const turn = getActiveCourseLesson()?.turns[turnIndex];
  return turn ? elements.courseTranscriptList?.querySelector(turnRowSelector(turn.id)) || null : null;
}

function markCourseTurnActive(turnIndex, element) {
  elements.courseTranscriptList?.querySelectorAll(".course-turn-row").forEach((row) => {
    row.classList.remove("is-playing");
    row.classList.toggle("is-current", Number(row.querySelector(".course-turn-number")?.textContent || 0) === turnIndex + 1);
  });
  const row = findCourseTurnRow(turnIndex) || element?.closest?.(".course-turn-row");
  row?.classList.add("is-playing");
  row?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
}

function clearActive() {
  if (!activeElement) return;
  activeElement.classList.remove("is-active");
  activeElement.closest?.(".sentence-row")?.classList.remove("is-active");
  activeElement.closest?.(".course-turn-row")?.classList.remove("is-playing");
  activeElement = null;
}
