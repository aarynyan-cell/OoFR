// Local AI: runtime (browser / desktop bridge), client settings, background translation and explanations.
// Part of the app: a classic script sharing the page's global scope with app.js.
// It is loaded before app.js (see index.html); everything here runs only after start-up.

function systemExplainLanguage() {
  const language = state?.settings?.systemLanguage || "zh";
  return ["zh", "en", "fr"].includes(language) ? language : "zh";
}

function isDesktopRuntime() {
  return Boolean(globalThis.OoFRDesktopAi?.isDesktop?.());
}

function isHostedOnlineRuntime() {
  if (isDesktopRuntime()) return false;
  return /^https?:$/.test(window.location.protocol)
    && !["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname);
}

function localAiRuntimeEnabled() {
  return isDesktopRuntime() || !isHostedOnlineRuntime();
}

async function initializeRuntimeAi() {
  if (isDesktopRuntime()) {
    await initializeDesktopAi();
    return;
  }
  if (isHostedOnlineRuntime()) {
    elements.localAiEndpointInput.disabled = true;
    elements.localAiModelInput.disabled = true;
    elements.localAiTestBtn.disabled = true;
    elements.localAiStatus.textContent = "在线 AI 暂未开放；可在 macOS 版生成后导入学习包";
    return;
  }
  void testLocalAiConnection({ probe: false });
}

let desktopAiLastStatus = null;
let desktopAiProgressUnlisten = null;

async function initializeDesktopAi() {
  elements.localAiEndpointInput.disabled = true;
  elements.localAiStatus.textContent = "正在启动本地 AI…";
  if (!desktopAiProgressUnlisten) {
    desktopAiProgressUnlisten = await globalThis.OoFRDesktopAi.listenProgress(updateDesktopAiProgress);
  }
  try {
    desktopAiLastStatus = await globalThis.OoFRDesktopAi.status();
    if (desktopAiLastStatus.runtimeInstalled && !desktopAiLastStatus.serverRunning) {
      await globalThis.OoFRDesktopAi.start();
      desktopAiLastStatus = await globalThis.OoFRDesktopAi.status();
    }
    const modelReady = (desktopAiLastStatus.models || []).some((item) => (item.name || item.model) === DESKTOP_AI_MODEL);
    if (!desktopAiLastStatus.runtimeInstalled || !modelReady) {
      showDesktopAiSetup(desktopAiLastStatus);
      return;
    }
    if (!desktopAiLastStatus.serverRunning) await globalThis.OoFRDesktopAi.start();
    state.settings.localAiModel = DESKTOP_AI_MODEL;
    elements.localAiModelInput.value = DESKTOP_AI_MODEL;
    persist();
    await testLocalAiConnection({ probe: true });
  } catch (error) {
    elements.localAiStatus.textContent = error?.message || "本地 AI 启动失败";
    showDesktopAiSetup(desktopAiLastStatus, error?.message);
  }
}

function showDesktopAiSetup(status = {}, errorMessage = "") {
  if (!elements.desktopAiSetupDialog) return;
  const freeGb = status.availableBytes ? (status.availableBytes / 1073741824).toFixed(1) : "未知";
  elements.desktopAiSetupStatus.textContent = errorMessage || (status.runtimeInstalled ? "需要下载 gemma3:4b" : "需要安装 Ollama 运行时和 gemma3:4b");
  elements.desktopAiSetupDetail.textContent = `可用空间：${freeGb} GB。首次安装约需下载 3.5GB，完成后可以一键启动。`;
  elements.desktopAiInstallBtn.disabled = !elements.desktopAiTermsCheck.checked;
  if (!elements.desktopAiSetupDialog.open) elements.desktopAiSetupDialog.showModal();
}

function updateDesktopAiProgress(progress = {}) {
  const percent = Math.max(0, Math.min(100, Number(progress.percent || 0)));
  elements.desktopAiSetupProgress.style.width = `${percent}%`;
  elements.desktopAiProgressTrack?.setAttribute("aria-valuenow", String(Math.round(percent)));
  elements.desktopAiSetupStatus.textContent = progress.message || progress.stage || "正在准备本地 AI…";
  if (progress.total) {
    const completedGb = (Number(progress.completed || 0) / 1073741824).toFixed(2);
    const totalGb = (Number(progress.total) / 1073741824).toFixed(2);
    elements.desktopAiSetupDetail.textContent = `${completedGb} / ${totalGb} GB`;
  }
}

async function installDesktopAi() {
  if (!elements.desktopAiTermsCheck.checked) return;
  elements.desktopAiInstallBtn.disabled = true;
  elements.desktopAiCancelBtn.disabled = false;
  try {
    let status = await globalThis.OoFRDesktopAi.status();
    if (Number(status.availableBytes || 0) < 6 * 1073741824) throw new Error("至少需要 6GB 可用空间才能安装本地 AI");
    if (!status.runtimeInstalled) await globalThis.OoFRDesktopAi.installRuntime();
    await globalThis.OoFRDesktopAi.start();
    status = await globalThis.OoFRDesktopAi.status();
    if (!(status.models || []).some((item) => (item.name || item.model) === DESKTOP_AI_MODEL)) {
      await globalThis.OoFRDesktopAi.pullModel(DESKTOP_AI_MODEL);
    }
    state.settings.localAiModel = DESKTOP_AI_MODEL;
    elements.localAiModelInput.value = DESKTOP_AI_MODEL;
    persist();
    updateDesktopAiProgress({ percent: 100, message: "本地 AI 已准备好" });
    await testLocalAiConnection({ probe: true });
    scheduleActiveLessonEnrichment();
    window.setTimeout(() => elements.desktopAiSetupDialog?.close(), 500);
  } catch (error) {
    elements.desktopAiSetupStatus.textContent = error?.message || "本地 AI 安装失败，请重试";
    elements.desktopAiInstallBtn.disabled = false;
  }
}

async function cancelDesktopAiSetup() {
  try { await globalThis.OoFRDesktopAi?.cancelSetup?.(); } catch { /* The setup may already have ended. */ }
  elements.desktopAiSetupStatus.textContent = "已取消；可以稍后重新安装";
  elements.desktopAiInstallBtn.disabled = !elements.desktopAiTermsCheck.checked;
}

// `interactive` is false for the automatic check at startup, which must never
// pop up a question.
function saveLocalAiSettings({ interactive = true } = {}) {
  const previousKey = `${state.settings.localAiEndpoint}|${state.settings.localAiModel}`;
  if (!isDesktopRuntime()) {
    const entered = String(elements.localAiEndpointInput.value || "http://127.0.0.1:11434").trim().replace(/\/$/, "");
    if (interactive && entered !== state.settings.localAiEndpoint && !isLoopbackEndpoint(entered) && entered !== approvedAiEndpoint) {
      const approved = window.confirm(`这个地址不在本机：\n${entered}\n\n选用后，素材分析、翻译和讲解用到的文本会发送到这个地址，不再只在本机处理。只有你信任并自己管理那台服务器时才继续。`);
      if (!approved) {
        elements.localAiEndpointInput.value = state.settings.localAiEndpoint;
        elements.localAiStatus.textContent = "已保留原来的地址";
        return;
      }
      approvedAiEndpoint = entered;
      void storageDriver.setLocal(AI_ENDPOINT_APPROVAL_KEY, entered).catch(() => {});
    }
    state.settings.localAiEndpoint = entered;
  }
  state.settings.localAiModel = String(elements.localAiModelInput.value || "auto").trim() || "auto";
  if (previousKey !== `${state.settings.localAiEndpoint}|${state.settings.localAiModel}`) {
    localAiClient = null;
    localAiClientKey = "";
    aiDownUntil = 0;
    abortAiWork();
  }
  persist();
  const remoteNotApproved = !isDesktopRuntime() && effectiveLocalAiEndpoint() !== state.settings.localAiEndpoint;
  elements.localAiStatus.textContent = remoteNotApproved
    ? "该地址不在本机且未经确认，已改用本机 127.0.0.1:11434；点“检测本地 AI”可确认使用"
    : "设置已保存，尚未检测";
}

function findLiveLesson(lessonId) {
  return state?.courseLessons.find((item) => item.id === lessonId) || null;
}

function aiSignalFor(lessonId) {
  let controller = aiAbortControllers.get(lessonId);
  if (!controller || controller.signal.aborted) {
    controller = new AbortController();
    aiAbortControllers.set(lessonId, controller);
  }
  return controller.signal;
}

// Cancels in-flight AI requests for some lessons (or all of them).
function abortAiWork(lessonIds = null) {
  [...(lessonIds || aiAbortControllers.keys())].forEach((id) => {
    aiAbortControllers.get(id)?.abort();
    aiAbortControllers.delete(id);
  });
}

function noteAiFailure(error) {
  if (error?.code === "timeout" || error?.code === "unreachable") aiDownUntil = Date.now() + AI_DOWN_COOLDOWN_MS;
}

function isAiAbort(error) {
  return error?.code === "aborted";
}

function aiTemporarilyDown() {
  return Date.now() < aiDownUntil;
}

function isLoopbackEndpoint(value) {
  try {
    const host = new URL(String(value)).hostname.replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

// The address requests really go to: the saved one if it is this machine or was
// approved here, otherwise the default local Ollama address.
function effectiveLocalAiEndpoint() {
  const fallback = globalThis.OoFROllama?.DEFAULT_ENDPOINT || "http://127.0.0.1:11434";
  if (isDesktopRuntime()) return fallback;
  const wanted = String(state.settings.localAiEndpoint || "").trim().replace(/\/$/, "");
  return wanted && (isLoopbackEndpoint(wanted) || wanted === approvedAiEndpoint) ? wanted : fallback;
}

async function loadAiEndpointApproval() {
  try {
    approvedAiEndpoint = String((await storageDriver.getLocal(AI_ENDPOINT_APPROVAL_KEY)) || "");
  } catch {
    approvedAiEndpoint = "";
  }
}

// `force` is for actions the learner asked for (test connection, "AI 讲解"):
// they should try even while background work is paused.
function createLocalAiClient(timeoutMs = 30000, { force = false } = {}) {
  if (!localAiRuntimeEnabled()) throw new Error("在线 AI 暂未开放；请在 macOS 版生成后导入学习包");
  if (!globalThis.OoFROllama?.Client) throw new Error("Ollama client unavailable");
  if (!force && aiTemporarilyDown()) {
    throw new globalThis.OoFROllama.OllamaError("unreachable", "本机 AI 暂时没有响应，稍后会自动重试");
  }
  const endpoint = effectiveLocalAiEndpoint();
  const key = `${endpoint}|${state.settings.localAiModel}`;
  if (!localAiClient || localAiClientKey !== key) {
    localAiClient = new globalThis.OoFROllama.Client({
      endpoint,
      model: state.settings.localAiModel,
      timeoutMs,
      keepAlive: "30m"
    });
    localAiClientKey = key;
  }
  localAiClient.timeoutMs = timeoutMs;
  return localAiClient;
}

function describeLocalAiError(error) {
  return globalThis.OoFROllama?.describeError?.(error) || "无法连接本机 Ollama";
}

async function testLocalAiConnection(options = {}) {
  if (!localAiRuntimeEnabled()) {
    elements.localAiStatus.textContent = "在线 AI 暂未开放；可在 macOS 版生成后导入学习包";
    return;
  }
  const shouldProbe = options?.probe !== false;
  // Only a click on the test button may ask about a remote address.
  saveLocalAiSettings({ interactive: options?.probe !== false });
  elements.localAiStatus.textContent = "正在检测…";
  try {
    const client = createLocalAiClient(6000, { force: true });
    const models = await client.listModels();
    const sortedModels = [...models].sort((left, right) => (left.size || Number.MAX_SAFE_INTEGER) - (right.size || Number.MAX_SAFE_INTEGER));
    if (elements.localAiModelOptions) {
      elements.localAiModelOptions.replaceChildren(
        new Option("自动选择体积较小的模型（推荐）", "auto"),
        ...sortedModels.map((item) => new Option(item.name, item.name))
      );
    }
    if (!models.length) throw new globalThis.OoFROllama.OllamaError("no-models", "Ollama 已连接，但还没有安装模型");
    const wanted = state.settings.localAiModel;
    const installed = models.find((item) => item.name === wanted || item.name.startsWith(`${wanted}:`));
    const automatic = !wanted || wanted === "auto";
    if (!automatic && !installed) throw new globalThis.OoFROllama.OllamaError("model-not-found", `尚未安装模型 ${wanted}`, { models });
    const selected = automatic ? sortedModels[0].name : installed.name;
    elements.localAiModelInput.value = automatic ? "auto" : selected;
    if (shouldProbe) {
      const probe = await client.chatJson({
        model: selected,
        prompt: "Return a JSON object with ok=true and no other fields.",
        schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
        timeoutMs: 30000,
        options: { num_predict: 24 }
      });
      if (probe.data?.ok !== true) throw new Error("模型未通过结构化输出测试");
    }
    lastLocalAiError = null;
    aiDownUntil = 0;
    elements.localAiStatus.textContent = automatic
      ? `${shouldProbe ? "已连接并完成推理" : "已连接"} · 自动使用 ${selected}`
      : `${shouldProbe ? "已连接并完成推理" : "已连接"} · ${selected}`;
  } catch (error) {
    lastLocalAiError = error;
    elements.localAiStatus.textContent = describeLocalAiError(error);
  }
}

function generateCourseTranslations(lesson, options = {}) {
  if (!localAiRuntimeEnabled()) {
    setStatus("在线版会显示学习包中的缓存；缺少的译文需要在 macOS 版生成");
    return Promise.resolve();
  }
  const existingRun = courseTranslationRuns.get(lesson.id);
  // A run is already going: run again afterwards, so a retry for other sentences
  // (or newly added ones) is not silently dropped.
  if (existingRun) return existingRun.then(() => generateCourseTranslations(lesson, options));
  const run = runCourseTranslationGeneration(lesson.id, options).finally(() => {
    if (courseTranslationRuns.get(lesson.id) === run) courseTranslationRuns.delete(lesson.id);
  });
  courseTranslationRuns.set(lesson.id, run);
  return run;
}

function scheduleActiveLessonEnrichment() {
  const activeLesson = getActiveCourseLesson();
  if (activeLesson && activeLesson.id !== "demo_lesson") scheduleCourseBackgroundEnrichment(activeLesson);
}

function scheduleCourseBackgroundEnrichment(lesson) {
  if (!lesson?.id || !localAiRuntimeEnabled()) return;
  window.setTimeout(() => {
    if (courseEnrichmentRuns.has(lesson.id)) {
      // The lesson may have been replaced or extended since that run began: go again afterwards.
      courseEnrichmentRerun.add(lesson.id);
      return;
    }
    const run = courseEnrichmentQueue
      .catch(() => undefined)
      .then(() => runCourseBackgroundEnrichment(lesson.id))
      .catch((error) => console.error("OoFR background AI run failed", error))
      .finally(() => {
        if (courseEnrichmentRuns.get(lesson.id) === run) courseEnrichmentRuns.delete(lesson.id);
        if (courseEnrichmentRerun.delete(lesson.id) && findLiveLesson(lesson.id)) scheduleCourseBackgroundEnrichment({ id: lesson.id });
      });
    courseEnrichmentQueue = run;
    courseEnrichmentRuns.set(lesson.id, run);
  }, 300);
}

function courseAiSignature(lesson) {
  const source = [
    AI_CONTENT_VERSION,
    state.settings.localAiEndpoint,
    state.settings.localAiModel,
    lesson.language,
    lesson.explainLanguage,
    ...lesson.turns.map((turn) => turn.text)
  ].join("\u241f");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function mergeCourseLexicalUnits(lesson, additions) {
  const rawExisting = Array.isArray(lesson.lexicalUnits) ? lesson.lexicalUnits : [];
  const existing = rawExisting.filter((item) => isValidCourseLexicalUnit(item, lesson));
  const byKey = new Map(existing.map((item) => [normalizeLexicalUnit(item.text), item]));
  let changed = existing.length !== rawExisting.length;
  (additions || []).forEach((item) => {
    const text = String(item?.text || "").trim();
    const key = normalizeLexicalUnit(text);
    if (!key || !isValidCourseLexicalUnit(item, lesson) || byKey.has(key)) return;
    byKey.set(key, {
      text,
      lemma: String(item?.lemma || text).trim(),
      type: String(item?.type || "expression").trim(),
      verified: item?.verified === "dictionary" ? "dictionary" : ""
    });
    changed = true;
  });
  if (changed) lesson.lexicalUnits = [...byKey.values()];
  return changed;
}

function isValidCourseLexicalUnit(item, lesson) {
  const text = String(item?.text || "").trim();
  const key = normalizeLexicalUnit(text);
  if (!key || text.length > 64 || /[.!?。！？]/u.test(text)) return false;
  const occurs = lesson.turns.some((turn) => normalizeLexicalUnit(turn.text).includes(key));
  if (!occurs) return false;
  const known = Object.keys(KNOWN_LEXICAL_UNITS).some((unit) => normalizeLexicalUnit(unit) === key);
  if (known) return true;
  const words = text.match(/[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu) || [];
  if (words.length < 2 || words.length > 6) return false;
  if (lesson.turns.some((turn) => normalizeLexicalUnit(turn.text) === key)) return false;
  return item?.verified === "dictionary";
}

async function verifyAiCourseLexicalUnits(items, lesson) {
  const output = [];
  for (const item of items || []) {
    const text = String(item?.text || "").trim();
    const key = normalizeLexicalUnit(text);
    const candidate = { ...item, text };
    const known = Object.keys(KNOWN_LEXICAL_UNITS).some((unit) => normalizeLexicalUnit(unit) === key);
    if (known) {
      output.push(candidate);
      continue;
    }
    if (!window.OOFR_DICTIONARY?.lookup) continue;
    try {
      const entry = await window.OOFR_DICTIONARY.lookup(text, lesson.language);
      const exactPhrase = entry
        && !entry.isInflected
        && normalizeLexicalUnit(entry.lookupKey || entry.word) === key
        && normalizeLexicalUnit(entry.word) === key;
      if (exactPhrase) output.push({ ...candidate, verified: "dictionary" });
    } catch {
      // An unavailable shard must not turn an arbitrary adjacent word group
      // into a fixed expression.
    }
  }
  return output;
}

function detectKnownCourseLexicalUnits(lesson) {
  return Object.entries(KNOWN_LEXICAL_UNITS)
    .filter(([text]) => lesson.turns.some((turn) => normalizeLexicalUnit(turn.text).includes(normalizeLexicalUnit(text))))
    .map(([text, info]) => ({ text, lemma: info.lemma || text, type: "expression" }));
}

// Works on the lesson as it is *now*: the lesson object can be replaced while
// the AI is busy (editing, re-opening, importing), so it is looked up again
// after every await and results are written by turn id.
async function runCourseBackgroundEnrichment(lessonId) {
  let lesson = findLiveLesson(lessonId);
  if (!lesson) return;
  let changed = mergeCourseLexicalUnits(lesson, detectKnownCourseLexicalUnits(lesson));
  if (changed) {
    lesson.updatedAt = nowIso();
    persist();
    if (courseActiveLessonId === lessonId) renderCoursePlayer();
  }

  if (lesson.turns.some(translationNeedsGeneration)) await generateCourseTranslations(lesson);
  lesson = findLiveLesson(lessonId);
  if (!lesson) return;

  const signature = courseAiSignature(lesson);
  const pending = lesson.turns.filter((turn) => aiExplanationNeedsGeneration(turn.aiExplanation, lesson));
  if (!pending.length && lesson.aiPreparedSignature === signature) return;

  let completed = true;
  for (let offset = 0; offset < pending.length; offset += 6) {
    // If the learner opened another course while this job was busy, yield the
    // expensive explanation phase to the currently visible material.
    if (courseActiveLessonId && courseActiveLessonId !== lessonId) return;
    if (aiTemporarilyDown()) {
      completed = false;
      break;
    }
    const chunk = pending.slice(offset, offset + 6);
    const enrichment = await loadCourseBatchEnrichment(lesson, chunk);
    lesson = findLiveLesson(lessonId);
    if (!lesson) return;
    if (!enrichment) {
      // One bad batch must not block the rest, unless the AI itself is unreachable.
      completed = false;
      if (aiTemporarilyDown() || isAiAbort(lastLocalAiError)) break;
      continue;
    }
    const byId = new Map((enrichment.explanations || []).map((item) => [String(item.id || ""), item]));
    chunk.forEach((oldTurn) => {
      const turn = lesson.turns.find((item) => item.id === oldTurn.id);
      const explanation = byId.get(oldTurn.id);
      if (!turn || !explanation || !aiExplanationNeedsGeneration(turn.aiExplanation, lesson)) return;
      const normalized = normalizeAiExplanation(explanation, enrichment.model, lesson.explainLanguage);
      if (!explanationLanguageMatches(normalized, lesson.explainLanguage)) {
        completed = false;
        return;
      }
      turn.aiExplanation = normalized;
      changed = true;
    });
    if (mergeCourseLexicalUnits(lesson, enrichment.lexicalUnits)) changed = true;
    if (changed) {
      lesson.updatedAt = nowIso();
      persist();
      if (courseActiveLessonId === lessonId) renderCoursePlayer();
      changed = false;
    }
  }

  lesson = findLiveLesson(lessonId);
  if (lesson && completed && lesson.turns.every((turn) => !aiExplanationNeedsGeneration(turn.aiExplanation, lesson))) {
    lesson.aiPreparedSignature = courseAiSignature(lesson);
    lesson.aiPreparedAt = nowIso();
    lesson.updatedAt = nowIso();
    persist();
    if (courseActiveLessonId === lessonId && elements.coursePlaybackStatus) {
      elements.coursePlaybackStatus.textContent = "本机 AI 已在后台准备好译文、固定表达与逐句讲解";
    }
  }
}

function normalizeAiExplanation(value, model, explainLanguage = "zh") {
  return {
    summary: String(value?.summary || ""),
    structure: String(value?.structure || ""),
    grammarPoints: localAiStringList(value?.grammarPoints),
    morphology: String(value?.morphology || ""),
    pitfalls: localAiStringList(value?.pitfalls),
    examples: localAiStringList(value?.examples),
    model: String(model || value?.model || state.settings.localAiModel),
    language: explainLanguage,
    version: AI_CONTENT_VERSION,
    generatedAt: value?.generatedAt || nowIso()
  };
}

function explanationLanguageMatches(value, language = "zh") {
  if (!value) return false;
  const text = [
    value.summary,
    value.structure,
    ...localAiStringList(value.grammarPoints),
    value.morphology,
    ...localAiStringList(value.pitfalls)
  ].join(" ");
  if (language === "zh") return (text.match(/[\u3400-\u9fff]/gu) || []).length >= 6;
  if (language === "fr") return /[A-Za-zÀ-ÿ]{3,}/u.test(text);
  return /[A-Za-z]{3,}/u.test(text);
}

function aiExplanationNeedsGeneration(value, lesson) {
  return !value
    || value.version !== AI_CONTENT_VERSION
    || value.language !== lesson.explainLanguage
    || !explanationLanguageMatches(value, lesson.explainLanguage);
}

function courseExplanationSystemInstruction(language) {
  if (language === "zh") {
    return "你是面向中文母语者的语言教师。JSON 中的所有解释文字必须只用简体中文；待学语言的原句、单词和例句可以保留原语言。不要附加英文翻译或汉语拼音。不确定的词源或形态不要猜测，直接写“本句无需特别词形说明”。";
  }
  if (language === "fr") return "Rédige toutes les explications en français. Ne devine jamais une étymologie ou une morphologie incertaine.";
  return "Write every explanation in English. Never invent uncertain etymology or morphology.";
}

async function loadCourseBatchEnrichment(lesson, turns) {
  if (!turns.length) return { explanations: [], lexicalUnits: [], model: state.settings.localAiModel };
  const explanationProperties = {
    id: { type: "string" },
    summary: { type: "string" },
    structure: { type: "string" },
    grammarPoints: { type: "array", items: { type: "string" } },
    morphology: { type: "string" },
    pitfalls: { type: "array", items: { type: "string" } },
    examples: { type: "array", items: { type: "string" } }
  };
  const schema = {
    type: "object",
    properties: {
      explanations: {
        type: "array",
        items: { type: "object", properties: explanationProperties, required: Object.keys(explanationProperties) }
      },
      lexicalUnits: {
        type: "array",
        items: {
          type: "object",
          properties: { text: { type: "string" }, lemma: { type: "string" }, type: { type: "string" } },
          required: ["text", "lemma", "type"]
        }
      }
    },
    required: ["explanations", "lexicalUnits"]
  };
  const explainNames = { zh: "Simplified Chinese only, without English glosses or pinyin", en: "English", fr: "French" };
  const items = turns.map((turn) => ({ id: turn.id, text: turn.text, translation: turn.translation || "" }));
  const prompt = `Prepare these ${lesson.language === "en" ? "English" : "French"} course sentences for later study. Write explanations in ${explainNames[lesson.explainLanguage] || "Simplified Chinese"}. For every id, return a concise meaning, sentence skeleton, important grammar, morphology or conjugation, likely pitfalls, and one useful substitution example. Also identify multi-word fixed expressions, collocations, phrasal units, and elided/pronominal units that learners should click and learn as a whole. Preserve the exact surface text for each lexical unit (for example "un peu" rather than separate "un" and "peu"). Do not include arbitrary adjacent words. Return only the required JSON.\n\nITEMS:\n${JSON.stringify(items)}`;
  try {
    const response = await createLocalAiClient(180000).chatJson({
      system: courseExplanationSystemInstruction(lesson.explainLanguage),
      prompt,
      schema,
      timeoutMs: 180000,
      signal: aiSignalFor(lesson.id),
      options: { num_predict: 1800 }
    });
    lastLocalAiError = null;
    const explanations = (response.data?.explanations || []).filter((item) => {
      const normalized = normalizeAiExplanation(item, response.model, lesson.explainLanguage);
      return explanationLanguageMatches(normalized, lesson.explainLanguage);
    });
    if (explanations.length !== turns.length) throw new Error("逐句讲解未按设定语言返回");
    const lexicalUnits = await verifyAiCourseLexicalUnits(response.data?.lexicalUnits || [], lesson);
    return { ...response.data, explanations, lexicalUnits, model: response.model };
  } catch (error) {
    lastLocalAiError = error;
    noteAiFailure(error);
    return null;
  }
}

const TRANSLATION_CHUNK_SIZE = 8;

async function runCourseTranslationGeneration(lessonId, { turnIds = null } = {}) {
  let lesson = findLiveLesson(lessonId);
  if (!lesson) return;
  let changed = false;
  const pendingTurns = [];
  const requestedIds = turnIds ? new Set(turnIds.map(String)) : null;
  for (const turn of lesson.turns) {
    if (requestedIds && !requestedIds.has(turn.id)) continue;
    const localTranslation = getLocalTranslation(turn.text, lesson.language, lesson.explainLanguage);
    if (localTranslation) {
      if (turn.translation !== localTranslation) {
        turn.translation = localTranslation;
        changed = true;
      }
      continue;
    }
    if (!requestedIds && !translationNeedsGeneration(turn)) continue;
    pendingTurns.push(turn);
  }

  if (!pendingTurns.length) {
    if (changed) {
      lesson.updatedAt = nowIso();
      persist();
      renderCoursePlayer();
    }
    setStatus("译文已就绪");
    return;
  }

  pendingTurns.forEach((turn) => {
    courseTranslationPendingIds.add(turn.id);
    courseTranslationErrorIds.delete(turn.id);
  });
  renderCoursePlayer();
  setStatus(`本机 AI 正在生成 ${pendingTurns.length} 句译文…`);

  const signal = aiSignalFor(lessonId);
  try {
    // Small batches: a long lesson in one request is cut off by the model's output limit.
    for (let offset = 0; offset < pendingTurns.length; offset += TRANSLATION_CHUNK_SIZE) {
      lesson = findLiveLesson(lessonId);
      if (!lesson || signal.aborted) break;
      const chunk = pendingTurns.slice(offset, offset + TRANSLATION_CHUNK_SIZE);
      const aiTranslations = await translateCourseTurnsWithLocalAi(chunk, lesson, signal);
      lesson = findLiveLesson(lessonId);
      if (!lesson || signal.aborted) break;
      for (const turn of chunk) {
        let translation = aiTranslations.get(turn.id) || "";
        // Sentence-by-sentence retry only while the AI is answering at all.
        if (!translation && !aiTemporarilyDown() && !signal.aborted) {
          translation = await translateText(turn.text, lesson.language, lesson.explainLanguage, signal);
          lesson = findLiveLesson(lessonId);
          if (!lesson) break;
        }
        const target = lesson.turns.find((item) => item.id === turn.id);
        if (translation && target) {
          target.translation = translation;
          changed = true;
          courseTranslationErrorIds.delete(turn.id);
        } else if (!translation) {
          courseTranslationErrorIds.add(turn.id);
        }
        courseTranslationPendingIds.delete(turn.id);
      }
      if (courseActiveLessonId === lessonId) renderCoursePlayer();
    }
  } finally {
    pendingTurns.forEach((turn) => courseTranslationPendingIds.delete(turn.id));
  }

  lesson = findLiveLesson(lessonId);
  if (changed && lesson) {
    lesson.updatedAt = nowIso();
    persist();
  }
  if (courseActiveLessonId === lessonId) renderCoursePlayer();
  if (!lesson || signal.aborted) return;
  const failedCount = pendingTurns.filter((turn) => courseTranslationErrorIds.has(turn.id)).length;
  if (failedCount) {
    setStatus(`已生成 ${pendingTurns.length - failedCount}/${pendingTurns.length} 句译文；失败句可单独重试。`);
  } else {
    setStatus("译文已生成");
  }
}

function translationNeedsGeneration(turn) {
  const value = String(turn?.translation || "").trim();
  return !value || /待补充|待校对|生成失败|pending|needs review/i.test(value) || isSuspiciousTranslation(turn.text, value);
}

async function translateCourseTurnsWithLocalAi(turns, lesson, signal) {
  const translations = new Map();
  if (!turns.length || lesson.language === lesson.explainLanguage) return translations;
  const targetNames = { zh: "Simplified Chinese", en: "English", fr: "French" };
  const schema = {
    type: "object",
    properties: {
      translations: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string" }, text: { type: "string" } },
          required: ["id", "text"]
        }
      }
    },
    required: ["translations"]
  };
  const source = lesson.language === "en" ? "English" : "French";
  const target = targetNames[lesson.explainLanguage] || "Simplified Chinese";
  const material = turns.map((turn) => ({ id: turn.id, text: turn.text }));
  const prompt = `Translate every item from ${source} to ${target} for a language-learning course. Preserve names, tone and meaning. Do not explain, omit, merge or add information. Keep each id unchanged. Return only the required JSON.\n\nITEMS:\n${JSON.stringify(material)}`;
  try {
    const response = await createLocalAiClient(150000).chatJson({ prompt, schema, timeoutMs: 150000, signal, options: { num_predict: 1200 } });
    const knownIds = new Set(turns.map((turn) => turn.id));
    (response.data?.translations || []).forEach((item) => {
      const id = String(item?.id || "");
      const text = String(item?.text || "").trim();
      if (knownIds.has(id) && text && !isSuspiciousTranslation(turns.find((turn) => turn.id === id)?.text, text)) {
        translations.set(id, text);
      }
    });
    lastLocalAiError = null;
  } catch (error) {
    lastLocalAiError = error;
    noteAiFailure(error);
  }
  return translations;
}
