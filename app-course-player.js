// Course player: progress ticker, seek, per-sentence recording (IndexedDB) and recording export.
// Part of the app: a classic script sharing the page's global scope with app.js.
// It is loaded before app.js (see index.html); everything here runs only after start-up.

function renderCourseProgress(lesson) {
  const total = lesson.turns.length || 1;
  courseProgressRatio = clamp(courseProgressRatio || courseCurrentTurnIndex / total, 0, 1);
  if (!playback.status || playback.status === "idle") courseProgressRatio = clamp(courseCurrentTurnIndex / total, 0, 1);
  elements.coursePlaybackStatus.textContent = `第 ${courseCurrentTurnIndex + 1} / ${lesson.turns.length} 句 · ${lesson.turns.filter((turn) => turn.recording.status === "recorded").length} 句已录音`;
  elements.courseTimeline.max = "1000";
  elements.courseTimeline.value = String(Math.round(courseProgressRatio * 1000));
  const estimatedTotalSeconds = estimateCourseDurationSeconds(lesson.turns);
  elements.courseElapsed.textContent = formatSeconds(courseProgressRatio * estimatedTotalSeconds);
  elements.courseDuration.textContent = formatSeconds(estimatedTotalSeconds);
  renderCoursePlaybackButtons(lesson);
  const availableRates = Array.from(elements.courseRateSelect.options).map((option) => option.value);
  const preferredRate = String(state.settings.rate || "0.9");
  elements.courseRateSelect.value = availableRates.includes(preferredRate) ? preferredRate : "0.9";
  syncCourseRateButton();
}

function syncCourseRateButton() {
  if (!elements.courseRateButton) return;
  const label = `${elements.courseRateSelect.value}x`;
  elements.courseRateButton.textContent = label;
  elements.courseRateButton.setAttribute("aria-label", `语速 ${label}，点按切换`);
}

function renderCoursePlaybackButtons(lesson = getActiveCourseLesson()) {
  if (!lesson) return;
  const isPlaying = playback.status === "playing";
  const isPaused = playback.status === "paused";
  setButtonContent(elements.courseBottomPlayBtn, isPlaying ? "pause" : "play", isPlaying ? "暂停" : isPaused ? "继续" : "播放");
  elements.courseBottomPlayBtn.title = isPlaying ? "暂停" : isPaused ? "继续" : "播放";
  elements.courseBottomPlayBtn.setAttribute("aria-label", elements.courseBottomPlayBtn.title);
  syncCourseCustomMenu();
  renderCourseTurnPlayButtons();
}

function formatSeconds(seconds) {
  const rounded = Math.max(0, Math.round(Number(seconds) || 0));
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}

function estimateCourseTurnDurationMs(text, rate = Number(state?.settings?.rate || 0.9)) {
  return Math.max(2400, (String(text || "").length * 95) / Math.max(0.5, rate) + 1600);
}

// One sentence including its repeats and the gaps between them.
function estimateCourseTurnTotalMs(text) {
  const repeat = Math.max(1, getRepeat());
  return estimateCourseTurnDurationMs(text) * repeat + getPauseMs() * (repeat - 1);
}

function estimateCourseDurationSeconds(turns) {
  return turns.reduce((sum, turn) => sum + estimateCourseTurnTotalMs(turn.text) / 1000, 0);
}

function updateCourseProgressRatio(ratio, lesson) {
  courseProgressRatio = clamp(ratio, 0, 1);
  if (!lesson) return;
  const estimatedTotalSeconds = estimateCourseDurationSeconds(lesson.turns);
  elements.courseTimeline.value = String(Math.round(courseProgressRatio * 1000));
  elements.courseElapsed.textContent = formatSeconds(courseProgressRatio * estimatedTotalSeconds);
}

function startCourseProgressTicker(turnIndex, text, lesson, initialElapsedMs = 0) {
  stopCourseProgressTicker();
  if (!lesson?.turns?.length) return;
  const itemDuration = estimateCourseTurnTotalMs(text);
  courseProgressTickerState = {
    turnIndex,
    text,
    lessonId: lesson.id,
    itemDuration,
    elapsedMs: Math.max(0, initialElapsedMs),
    startedAt: Date.now()
  };
  courseProgressTimer = window.setInterval(() => {
    if (!courseProgressTickerState) return;
    const elapsed = courseProgressTickerState.elapsedMs + Date.now() - courseProgressTickerState.startedAt;
    const withinTurn = clamp(elapsed / itemDuration, 0, 0.99);
    updateCourseProgressRatio((turnIndex + withinTurn) / lesson.turns.length, lesson);
  }, 80);
}

function stopCourseProgressTicker() {
  if (courseProgressTimer) window.clearInterval(courseProgressTimer);
  courseProgressTimer = 0;
  courseProgressTickerState = null;
}

function pauseCourseProgressTicker() {
  if (!courseProgressTickerState) return;
  courseProgressTickerState.elapsedMs += Date.now() - courseProgressTickerState.startedAt;
  if (courseProgressTimer) window.clearInterval(courseProgressTimer);
  courseProgressTimer = 0;
}

function resumeCourseProgressTicker() {
  const stateSnapshot = courseProgressTickerState;
  const lesson = getActiveCourseLesson();
  if (!stateSnapshot || !lesson) return;
  startCourseProgressTicker(stateSnapshot.turnIndex, stateSnapshot.text, lesson, stateSnapshot.elapsedMs);
}

function moveCourseTurn(delta) {
  const lesson = getActiveCourseLesson();
  if (!lesson) return;
  courseCurrentTurnIndex = Math.min(Math.max(0, courseCurrentTurnIndex + delta), lesson.turns.length - 1);
  courseRunFinished = false;
  courseProgressRatio = courseCurrentTurnIndex / Math.max(1, lesson.turns.length);
  renderCoursePlayer();
  document.querySelector(turnRowSelector(lesson.turns[courseCurrentTurnIndex]?.id))?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
}

function seekCourseBy(delta) {
  const wasPlaying = playback.status === "playing";
  const wasPaused = playback.status === "paused";
  stopSpeech();
  moveCourseTurn(delta);
  const lesson = getActiveCourseLesson();
  if (wasPlaying && lesson) {
    courseProgressRatio = courseCurrentTurnIndex / Math.max(1, lesson.turns.length);
    playCourseSelection({ startFromCurrent: true });
  } else if (wasPaused && lesson) {
    renderCoursePlayer();
  }
}

function playCourseSelection(options = {}) {
  const lesson = getActiveCourseLesson();
  if (!lesson) return;
  const turns = getCourseVisibleTurns(lesson);
  const rows = Array.from(elements.courseTranscriptList.querySelectorAll(".course-turn-row"));
  let items = turns.map((turn, index) => ({ text: turn.text, element: rows[index], label: `第 ${lesson.turns.indexOf(turn) + 1} 句`, lang: lesson.language === "en" ? "en-US" : "fr-FR", turnIndex: lesson.turns.indexOf(turn) }));
  // The click handlers pass the click event here; only an explicit boolean counts.
  // Starting from the sentence the learner moved to is the default, unless the
  // previous run reached the end (then play from the top).
  const requested = typeof options.startFromCurrent === "boolean" ? options.startFromCurrent : null;
  const startFromCurrent = requested ?? (playback.status === "idle" && !courseRunFinished && courseCurrentTurnIndex > 0);
  if (startFromCurrent) {
    const startIndex = items.findIndex((item) => item.turnIndex >= courseCurrentTurnIndex);
    if (startIndex >= 0) items = items.slice(startIndex);
  }
  if (!items.length) return;
  courseRunFinished = false;
  elements.coursePlaybackStatus.textContent = `正在播放${courseModeLabel(courseMode)}…`;
  togglePlayback(items, {
    key: `course:${lesson.id}:${courseMode}:${elements.courseSpeakerSelect.value}:${courseSegmentStart}-${courseSegmentEnd}`,
    label: lesson.title,
    loop: courseMode === "single" || courseMode === "loop",
    transport: true
  });
}

function playCourseTurn(lesson, index) {
  // The button of the sentence being played pauses/resumes it; any other
  // sentence's button starts that sentence.
  const isCurrentRun = playback.status !== "idle" && playback.key.startsWith(`course:${lesson.id}:`) && index === courseCurrentTurnIndex;
  courseCurrentTurnIndex = index;
  courseRunFinished = false;
  courseProgressRatio = index / Math.max(1, lesson.turns.length);
  if (!isCurrentRun) renderCoursePlayer();
  const row = findCourseTurnRow(index);
  elements.coursePlaybackStatus.textContent = `正在播放第 ${index + 1} 句…`;
  togglePlayback([{ text: lesson.turns[index].text, element: row, label: `第 ${index + 1} 句`, lang: lesson.language === "en" ? "en-US" : "fr-FR", turnIndex: index }], { key: `course:${lesson.id}:turn:${index}`, label: `第 ${index + 1} 句`, transport: isCurrentRun });
}

function stopCourseRecordingAudio() {
  if (courseRecordingAudio) {
    courseRecordingAudio.pause();
    courseRecordingAudio = null;
  }
  courseRecordingUrls.forEach((url) => URL.revokeObjectURL(url));
  courseRecordingUrls.clear();
}

function playCourseRecording(turn) {
  if (!turn.recording?.mediaKey) {
    setStatus("这句只有演示状态，还没有真实音频文件");
    return;
  }
  void readRecordingBlob(turn.recording.mediaKey).then((blob) => {
    if (!blob) {
      setStatus("找不到本地录音文件，可能是清理浏览器数据后丢失");
      return;
    }
    // One sound at a time: the lesson voice and any earlier recording stop first.
    if (playback.status !== "idle") stopSpeech({ quiet: true });
    stopCourseRecordingAudio();
    const url = URL.createObjectURL(blob);
    courseRecordingUrls.set(turn.recording.mediaKey, url);
    const audio = new Audio(url);
    courseRecordingAudio = audio;
    audio.onended = () => {
      elements.coursePlaybackStatus.textContent = `我的录音播放完成 · ${formatCourseDuration(turn.recording.durationMs)}`;
      if (courseRecordingAudio === audio) stopCourseRecordingAudio();
    };
    audio.onerror = () => setStatus("这条录音无法播放，可以删除后重录");
    elements.coursePlaybackStatus.textContent = `正在播放我的录音：${turn.speakerLabel}`;
    audio.play().catch((error) => {
      setStatus(error?.name === "NotAllowedError" ? "浏览器阻止了音频自动播放，请再次点击播放" : "这条录音无法播放，可以删除后重录");
    });
  });
}

async function startCourseRecording(lesson, turnId) {
  const turn = lesson.turns.find((item) => item.id === turnId);
  if (!turn) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setStatus("当前浏览器不支持录音，请使用新版 Chrome、Edge 或 Safari");
    return;
  }
  if (courseRecordingSession || courseRecordingStarting) {
    setStatus("请先停止当前录音");
    return;
  }
  courseRecordingStarting = true;
  // The lesson voice must not be picked up by the microphone.
  stopSpeech({ quiet: true });
  stopCourseRecordingAudio();
  let stream = null;
  try {
    elements.coursePlaybackStatus.textContent = "正在请求麦克风权限…";
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    const recorder = new MediaRecorder(stream, pickRecorderOptions());
    const session = { lessonId: lesson.id, turnId, stream, recorder, chunks: [], startedAt: Date.now() };
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) session.chunks.push(event.data);
    });
    recorder.addEventListener("stop", () => void finishCourseRecording(session));
    recorder.addEventListener("error", (event) => void finishCourseRecording(session, event.error || new Error("recorder error")));
    recorder.start(250);
    courseRecordingSession = session;
    elements.coursePlaybackStatus.textContent = `本机麦克风录音中：${turn.speakerLabel} · 点击停止完成`;
    renderCourseTranscript(lesson);
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    courseRecordingSession = null;
    setStatus(error?.name === "NotAllowedError" ? "麦克风权限被拒绝，录音功能未启动" : "无法启动麦克风录音");
    renderCoursePlayer();
  } finally {
    courseRecordingStarting = false;
  }
}

// Runs when a recorder stops (button, lesson switch, page hide) or fails.
async function finishCourseRecording(session, failure = null) {
  // A recorder error is followed by a stop event; handle the session once.
  if (session.finished) return;
  session.finished = true;
  if (courseRecordingSession === session) courseRecordingSession = null;
  session.stream.getTracks().forEach((track) => track.stop());
  // The lesson may have been edited or deleted meanwhile: look the turn up again.
  const lesson = state.courseLessons.find((item) => item.id === session.lessonId);
  const turn = lesson?.turns.find((item) => item.id === session.turnId);
  try {
    if (failure) throw failure;
    if (!turn) {
      setStatus("这句已不在课程里，录音没有保存");
      return;
    }
    const blob = new Blob(session.chunks, { type: session.recorder.mimeType || "audio/webm" });
    if (!blob.size) throw new Error("empty recording");
    const mediaKey = `recording:${lesson.id}:${session.turnId}:${Date.now()}`;
    await saveRecordingBlob(mediaKey, blob);
    const replacedKey = turn.recording?.mediaKey;
    turn.recording = {
      status: "recorded",
      durationMs: Math.max(100, Date.now() - session.startedAt),
      mediaKey,
      mimeType: blob.type,
      size: blob.size
    };
    queueRecordingRelease([replacedKey]);
    persist();
    elements.coursePlaybackStatus.textContent = `已保存第 ${lesson.turns.indexOf(turn) + 1} 句真实录音`;
  } catch (error) {
    // The earlier take (if any) is untouched; nothing half-saved is referenced.
    console.error("OoFR recording was not saved", error);
    setStatus("录音保存失败，设备空间可能不足；之前的录音没有受影响");
  }
  renderCoursePlayer();
}

function stopCourseRecording(lesson, turnId) {
  if (!courseRecordingSession || courseRecordingSession.turnId !== turnId) return;
  stopCourseRecordingSession();
  elements.coursePlaybackStatus.textContent = "正在保存录音…";
}

// Ends the active recording (the take recorded so far is kept).
function stopCourseRecordingSession() {
  const session = courseRecordingSession;
  if (!session) return;
  if (session.recorder.state !== "inactive") session.recorder.stop();
  else void finishCourseRecording(session);
}

async function deleteCourseRecording(lesson, turnId) {
  const turn = lesson.turns.find((item) => item.id === turnId);
  if (!turn) return;
  if (courseRecordingSession?.turnId === turnId) stopCourseRecordingSession();
  queueRecordingRelease([turn.recording.mediaKey]);
  turn.recording = { status: "none", durationMs: 0, mediaKey: "", mimeType: "", size: 0 };
  persist();
  elements.coursePlaybackStatus.textContent = "已删除这句录音，播放时会回退到 TTS";
  renderCoursePlayer();
}

function pickRecorderOptions() {
  const candidates = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
  const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported?.(candidate));
  return mimeType ? { mimeType } : {};
}

function openAudioDb() {
  if (audioDbPromise) return audioDbPromise;
  if (!window.indexedDB) return Promise.reject(new Error("IndexedDB unavailable"));
  audioDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open("oofr-audio", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("recordings");
    request.onsuccess = () => {
      const db = request.result;
      // Browsers (iOS in particular) may close idle connections; reopen next time.
      db.onclose = () => { audioDbPromise = null; };
      db.onversionchange = () => { db.close(); audioDbPromise = null; };
      resolve(db);
    };
    request.onerror = () => {
      audioDbPromise = null;
      reject(request.error);
    };
  });
  return audioDbPromise;
}

async function saveRecordingBlob(key, blob) {
  const db = await openAudioDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("recordings", "readwrite");
    transaction.objectStore("recordings").put(blob, key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("recording save aborted"));
  });
}

async function readRecordingBlob(key) {
  try {
    const db = await openAudioDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction("recordings", "readonly").objectStore("recordings").get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function deleteRecordingBlob(key) {
  if (!key) return;
  try {
    const db = await openAudioDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("recordings", "readwrite");
      transaction.objectStore("recordings").delete(key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("recording delete aborted"));
    });
  } catch {}
}

async function exportCourseRecordings() {
  const lesson = getActiveCourseLesson();
  if (!lesson) return;
  const recordedTurns = [];
  for (const turn of lesson.turns) {
    if (turn.recording?.status !== "recorded" || !turn.recording.mediaKey) continue;
    const blob = await readRecordingBlob(turn.recording.mediaKey);
    if (blob) recordedTurns.push({ turn, blob });
  }
  if (!recordedTurns.length) {
    setStatus("还没有真实录音可以导出");
    return;
  }
  try {
    setStatus("正在合并我的逐句录音…");
    const { wav, skipped } = await mergeRecordingBlobs(recordedTurns.map((item) => item.blob));
    const filename = `oofr-${slugifyFilePart(lesson.title)}-我的录音.wav`;
    const outcome = await shareOrDownloadAudio(wav, filename);
    if (outcome === "cancelled") setStatus("已取消分享");
    else setStatus(skipped ? `完整录音已准备好（有 ${skipped} 句录音无法解码，已跳过）` : "完整录音已准备好");
  } catch (error) {
    console.error("OoFR recording export failed", error);
    setStatus("浏览器无法合并这些录音，可逐句播放");
  }
}

async function mergeRecordingBlobs(blobs) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("AudioContext unavailable");
  const context = new AudioContextClass();
  const buffers = [];
  let skipped = 0;
  try {
    for (const blob of blobs) {
      try {
        buffers.push(await context.decodeAudioData(await blob.arrayBuffer()));
      } catch {
        skipped += 1;
      }
    }
  } finally {
    await context.close().catch(() => {});
  }
  if (!buffers.length) throw new Error("no recording could be decoded");
  const sampleRate = buffers[0].sampleRate;
  const channels = Math.max(...buffers.map((buffer) => buffer.numberOfChannels));
  const gapFrames = Math.round(sampleRate * 0.32);
  const totalFrames = buffers.reduce((sum, buffer) => sum + buffer.length, 0) + gapFrames * Math.max(0, buffers.length - 1);
  const offline = new OfflineAudioContext(channels, totalFrames, sampleRate);
  let offset = 0;
  buffers.forEach((buffer, index) => {
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start(offset / sampleRate);
    offset += buffer.length + (index < buffers.length - 1 ? gapFrames : 0);
  });
  const rendered = await offline.startRendering();
  return { wav: audioBufferToWav(rendered), skipped };
}

function audioBufferToWav(buffer) {
  const channels = buffer.numberOfChannels;
  const frameCount = buffer.length;
  const bytesPerSample = 2;
  const dataSize = frameCount * channels * bytesPerSample;
  const output = new ArrayBuffer(44 + dataSize);
  const view = new DataView(output);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sourceChannel = Math.min(channel, buffer.numberOfChannels - 1);
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(sourceChannel)[frame]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([output], { type: "audio/wav" });
}

function writeAscii(view, offset, text) {
  Array.from(text).forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
}

// Returns "shared", "cancelled" or "downloaded".
async function shareOrDownloadAudio(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ title: "OoFR 我的录音", files: [file] });
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
      // Share sheets need a fresh tap; after a long merge the browser may
      // refuse. Fall back to a normal download.
    }
  }
  downloadText(blob, filename, blob.type);
  return "downloaded";
}

function formatCourseDuration(milliseconds) {
  return `${(Number(milliseconds || 0) / 1000).toFixed(1)}s`;
}

// Changing mode / speaker / range while a course plays would leave the old run
// behind the new settings, so it stops (position is kept).
function stopCoursePlaybackForSettingChange() {
  if (playback.status !== "idle" && playback.key.startsWith("course:")) stopSpeech({ quiet: true });
}
