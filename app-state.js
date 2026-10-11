// State shape, migrations, saving and the storage drivers (IndexedDB, localStorage, chrome.storage).
// Part of the app: a classic script sharing the page's global scope with app.js.
// It is loaded before app.js (see index.html); everything here runs only after start-up.

async function loadAppState() {
  let saved = null;
  try {
    saved = await storageDriver.getLocal(APP_STORAGE_KEY);
  } catch (error) {
    return recoverFromUnreadableStorage(error);
  }
  if (saved) {
    return ensureStateShape(saved);
  }

  const legacy = await readJson(LEGACY_STORAGE_KEY);
  return createStarterState(legacy || {});
}

// The stored state exists but cannot be read (damaged JSON, blocked storage).
// Show the starter lessons so the app still opens, but keep the original
// somewhere safe and tell the user, instead of overwriting it on the next save.
function recoverFromUnreadableStorage(error) {
  console.error("OoFR stored state is unreadable", error);
  const raw = typeof error?.rawValue === "string" ? error.rawValue : "";
  let setAside = false;
  if (raw) {
    try {
      window.localStorage.setItem(CORRUPT_STORAGE_KEY, raw);
      setAside = true;
    } catch {
      // Out of space: keep the original untouched by blocking saves instead.
      persistLocked = true;
    }
  }
  showStorageNotice({
    kind: "unreadable",
    message: setAside
      ? "本地学习数据无法读取，已先保留一份原始副本。当前显示的是示例课程；可以先下载原始数据再决定怎么处理。"
      : "本地学习数据无法读取。为避免覆盖，暂时不会保存新的修改；请先下载原始数据。",
    actions: [
      ...(raw ? [{ label: "下载原始数据", onClick: () => downloadText(raw, `oofr-unreadable-${dateStamp()}.json`) }] : []),
      ...(persistLocked ? [{ label: "放弃原数据，继续使用", onClick: () => { persistLocked = false; hideStorageNotice(); persist(); } }] : [])
    ]
  });
  return createStarterState({});
}

async function applySyncedSettings() {
  const synced = await storageDriver.getSync(SYNC_STORAGE_KEY);
  if (!synced?.settings) return;
  state.settings = {
    ...state.settings,
    ...synced.settings
  };
}

// A real OoFR state always carries an `albums` array (possibly empty after the
// user deleted every tape category). Anything else is not our data.
function looksLikeOoFRState(raw) {
  return Boolean(raw) && typeof raw === "object" && !Array.isArray(raw)
    && raw.type !== LEARNING_PACKAGE_TYPE && Array.isArray(raw.albums);
}

// Keeps only settings of the expected primitive type so a hand-edited or
// foreign backup cannot inject objects or NaN into playback/AI settings.
function sanitizeSettings(rawSettings, fallbackSettings) {
  const source = rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings) ? rawSettings : {};
  const settings = { ...fallbackSettings };
  Object.keys(fallbackSettings).forEach((key) => {
    const value = source[key];
    const expected = typeof fallbackSettings[key];
    if (expected === "boolean" && typeof value === "boolean") settings[key] = value;
    if (expected === "string" && (typeof value === "string" || (typeof value === "number" && Number.isFinite(value)))) {
      settings[key] = String(value);
    }
  });
  return settings;
}

function ensureStateShape(raw) {
  const fallback = createStarterState({});
  if (!looksLikeOoFRState(raw)) return fallback;
  const stateLike = raw;
  const next = {
    version: 1,
    currentText: String(stateLike.currentText || fallback.currentText),
    activeEntryId: stateLike.activeEntryId || null,
    ui: {
      activeView: "course",
      selectedAlbumId: stateLike.ui?.selectedAlbumId || null,
      selectedTapeId: stateLike.ui?.selectedTapeId || null,
      selectedWordbookId: stateLike.ui?.selectedWordbookId || ALL_WORDBOOK_ID
    },
    settings: sanitizeSettings(stateLike.settings, fallback.settings),
    albums: stateLike.albums.map(normalizeAlbum).filter(Boolean),
    tapes: Array.isArray(stateLike.tapes) ? stateLike.tapes.map(normalizeTape).filter(Boolean) : [],
    entries: Array.isArray(stateLike.entries) ? stateLike.entries.map(normalizeEntry).filter(Boolean) : [],
    wordbooks: Array.isArray(stateLike.wordbooks) ? normalizeWordbookList(stateLike.wordbooks) : [],
    vocabulary: Array.isArray(stateLike.vocabulary) ? normalizeVocabularyList(stateLike.vocabulary) : [],
    activeCourseId: stateLike.activeCourseId || fallback.activeCourseId,
    courseLessons: Array.isArray(stateLike.courseLessons)
      ? stateLike.courseLessons.map(normalizeCourseLesson).filter(Boolean)
      : fallback.courseLessons,
    phraseItems: Array.isArray(stateLike.phraseItems)
      ? stateLike.phraseItems.map(normalizePhraseItem).filter(Boolean)
      : fallback.phraseItems,
    dictionaryEntries: normalizeDictionaryEntryCache(stateLike.dictionaryEntries),
    study: normalizeStudyState(stateLike.study || fallback.study)
  };

  next.settings.systemLanguage = ["zh", "en", "fr"].includes(next.settings.systemLanguage) ? next.settings.systemLanguage : "zh";
  next.settings.localAiEndpoint = String(next.settings.localAiEndpoint || "http://127.0.0.1:11434").replace(/\/$/, "");
  next.settings.localAiModel = String(next.settings.localAiModel || "auto").trim() || "auto";

  next.phraseItems = next.phraseItems.filter((item) => item.id !== "demo_phrase_3" && item.text !== "I would like to practise for ten minutes.");

  next.tapes = next.tapes.filter((tape) => next.albums.some((album) => album.id === tape.albumId));
  next.entries = next.entries.filter((entry) => next.tapes.some((tape) => tape.id === entry.tapeId));
  next.vocabulary.forEach((item) => {
    item.wordbookIds = validWordbookIds(item.wordbookIds, next.wordbooks);
  });
  migrateLegacyAlbumsToCourses(next);
  return next;
}

function migrateLegacyAlbumsToCourses(next) {
  next.albums.forEach((album) => {
    if (album.courseLessonId) return;
    const albumTapeIds = next.tapes.filter((tape) => tape.albumId === album.id).map((tape) => tape.id);
    const entries = next.entries
      .filter((entry) => albumTapeIds.includes(entry.tapeId))
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    if (!entries.length) return;
    const turns = entries.flatMap((entry) => splitCourseTurns(entry.text).map((part, index) => ({
      id: `${entry.id}_turn_${index + 1}`,
      text: part.text,
      translation: "",
      speakerId: part.speakerId || "a",
      speakerLabel: part.speakerLabel || "默认说话人",
      recording: { status: "none", durationMs: 0, mediaKey: "" }
    })));
    if (!turns.length) return;
    const lesson = normalizeCourseLesson({
      id: `course_${album.id}`,
      title: album.title,
      language: "fr",
      explainLanguage: "zh",
      materialType: "磁带素材",
      description: `从「${album.title}」的 ${entries.length} 个自建段落转换而来`,
      turns,
      practice: { completed: 0, correct: 0 }
    });
    next.courseLessons.push(lesson);
    album.courseLessonId = lesson.id;
  });
}

function createStarterState(legacy) {
  const timestamp = nowIso();
  const albumId = makeId("album");
  const tapeId = makeId("tape");
  const entryId = makeId("entry");
  const legacyText = legacy?.text || SAMPLE_TEXT;
  const settings = {
    rate: legacy?.rate || "0.85",
    pause: legacy?.pause || "0.4",
    repeat: legacy?.repeat || "1",
    voice: legacy?.voice || "",
    voiceLocked: Boolean(legacy?.voice),
    systemLanguage: "zh",
    localAiEndpoint: "http://127.0.0.1:11434",
    localAiModel: "auto"
  };

  return {
    version: 1,
    currentText: legacyText,
    activeEntryId: null,
    ui: {
      activeView: "course",
      selectedAlbumId: albumId,
      selectedTapeId: tapeId,
      selectedWordbookId: ALL_WORDBOOK_ID
    },
    settings,
    albums: [
      {
        id: albumId,
        title: "入门练习",
        description: "从 v0.0 延续来的第一盘磁带",
        coverColor: "#0a5f59",
        courseLessonId: "demo_lesson",
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    tapes: [
      {
        id: tapeId,
        albumId,
        title: "发音母带",
        description: "常用句子和联诵练习",
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    entries: [
      {
        id: entryId,
        tapeId,
        title: "示例段落",
        text: legacyText,
        notes: "",
        practiceCount: 0,
        lastPracticedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    wordbooks: [],
    vocabulary: [],
    activeCourseId: "demo_lesson",
    courseLessons: [createDemoCourseLesson()],
    phraseItems: createDemoPhraseItems(),
    dictionaryEntries: {},
    study: normalizeStudyState({})
  };
}

function normalizeDictionaryEntryCache(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value)
    .filter(([key, item]) => key && item && typeof item === "object")
    .sort((left, right) => String(right[1].updatedAt || "").localeCompare(String(left[1].updatedAt || "")))
    .slice(0, 800)
    .map(([key, item]) => [String(key), {
      version: String(item.version || ""),
      lemma: String(item.lemma || ""),
      partOfSpeech: String(item.partOfSpeech || ""),
      senses: (Array.isArray(item.senses) ? item.senses : []).map(String).filter(Boolean).slice(0, 20),
      contextMeaning: String(item.contextMeaning || ""),
      formNote: String(item.formNote || ""),
      usageNote: String(item.usageNote || ""),
      model: String(item.model || ""),
      updatedAt: item.updatedAt || nowIso()
    }]);
  return Object.fromEntries(entries);
}

function normalizeStudyState(study) {
  const source = study && typeof study === "object" ? study : {};
  return {
    cardsReviewed: Math.max(0, Number(source.cardsReviewed || 0)),
    cardsKnown: Math.max(0, Number(source.cardsKnown || 0)),
    checkins: Math.max(0, Number(source.checkins || 0)),
    streak: Math.max(0, Number(source.streak || 0)),
    lastStudyDate: source.lastStudyDate || null,
    dailyGoal: Math.max(1, Number(source.dailyGoal || 3)),
    achievements: Array.isArray(source.achievements) ? [...new Set(source.achievements.map(String))] : []
  };
}

function normalizeAlbum(album) {
  if (!album?.id || !album?.title) return null;
  return {
    id: String(album.id),
    title: String(album.title),
    description: String(album.description || ""),
    // Only plain hex colours: the value ends up in a CSS custom property.
    coverColor: /^#[0-9a-f]{3,8}$/i.test(String(album.coverColor || "")) ? String(album.coverColor) : pickAlbumColor(),
    courseLessonId: album.courseLessonId ? String(album.courseLessonId) : "",
    createdAt: album.createdAt || nowIso(),
    updatedAt: album.updatedAt || nowIso()
  };
}

function normalizeTape(tape) {
  if (!tape?.id || !tape?.albumId || !tape?.title) return null;
  return {
    id: String(tape.id),
    albumId: String(tape.albumId),
    title: String(tape.title),
    description: String(tape.description || ""),
    createdAt: tape.createdAt || nowIso(),
    updatedAt: tape.updatedAt || nowIso()
  };
}

function normalizeEntry(entry) {
  if (!entry?.id || !entry?.tapeId || !entry?.title || typeof entry.text !== "string") return null;
  return {
    id: String(entry.id),
    tapeId: String(entry.tapeId),
    title: String(entry.title),
    text: String(entry.text),
    notes: String(entry.notes || ""),
    language: entry.language === "en" ? "en" : "fr",
    materialType: ["情景对话", "文章", "歌词", "笔记", "自定义文本"].includes(entry.materialType) ? entry.materialType : inferStoredMaterialType(entry.text),
    courseLessonId: entry.courseLessonId ? String(entry.courseLessonId) : "",
    practiceCount: Number(entry.practiceCount || 0),
    lastPracticedAt: entry.lastPracticedAt || null,
    createdAt: entry.createdAt || nowIso(),
    updatedAt: entry.updatedAt || nowIso()
  };
}

function normalizeWordbookList(items) {
  const byId = new Map();
  items.map(normalizeWordbook).filter(Boolean).forEach((wordbook) => {
    if (!byId.has(wordbook.id)) {
      byId.set(wordbook.id, wordbook);
    }
  });
  return Array.from(byId.values());
}

function normalizeWordbook(wordbook) {
  if (!wordbook?.title || isSystemWordbook(wordbook.id)) return null;
  return {
    id: wordbook.id ? String(wordbook.id) : makeId("wordbook"),
    title: String(wordbook.title).trim(),
    description: String(wordbook.description || ""),
    createdAt: wordbook.createdAt || nowIso(),
    updatedAt: wordbook.updatedAt || nowIso()
  };
}

function normalizeVocabularyList(items) {
  const byIdentity = new Map();
  items.map(normalizeVocabulary).filter(Boolean).forEach((item) => {
    const existing = byIdentity.get(item.normalized);
    if (!existing) {
      byIdentity.set(item.normalized, item);
      return;
    }
    existing.status = existing.status === "got" || item.status === "got" ? "got" : "new";
    existing.ipa = existing.ipa || item.ipa;
    existing.zh = existing.zh || item.zh;
    existing.wordbookIds = mergeWordbookIds(existing.wordbookIds, item.wordbookIds);
    existing.seenForms = mergeSeenForms(existing.seenForms, item.seenForms);
    existing.updatedAt = item.updatedAt > existing.updatedAt ? item.updatedAt : existing.updatedAt;
  });
  return Array.from(byIdentity.values());
}

function normalizeVocabulary(item) {
  if (!item?.word) return null;
  const language = item.language === "en" ? "en" : "fr";
  const surface = preferredVocabularySurface(item);
  const info = resolveWordInfo(surface);
  const hint = info.lexicon || lookupLexicon(surface);
  const lemma = item.lemma || hint?.word || info.lemma || surface;
  const partOfSpeech = String(item.partOfSpeech || item.pos || "");
  const presentation = vocabularyPresentation(surface, { lemma, pos: partOfSpeech }, language);
  if (!presentation.identity) return null;
  const originalForm = normalizeWord(surface);
  const seenForms = Array.isArray(item.seenForms)
    ? item.seenForms.map(normalizeSeenForm).filter(Boolean)
    : [{ form: surface, normalized: originalForm, count: 1 }];
  return {
    id: item.id || makeId("word"),
    word: presentation.displayWord,
    surface: presentation.surface,
    lemma: presentation.lemma,
    normalized: presentation.identity,
    partOfSpeech,
    language,
    ipa: String(item.ipa || hint?.ipa || ""),
    zh: String(item.zh || hint?.zh || ""),
    en: String(item.en || ""),
    status: item.status === "got" ? "got" : "new",
    wordbookIds: cleanWordbookIds([
      ...(Array.isArray(item.wordbookIds) ? item.wordbookIds : []),
      ...(item.wordbookId ? [item.wordbookId] : [])
    ]),
    seenForms,
    createdAt: item.createdAt || nowIso(),
    updatedAt: item.updatedAt || nowIso()
  };
}

function preferredVocabularySurface(item) {
  if (String(item?.surface || "").trim()) return String(item.surface).trim();
  const seen = (Array.isArray(item?.seenForms) ? item.seenForms : [])
    .filter((entry) => String(entry?.form || "").trim())
    .sort((left, right) => Number(right.count || 0) - Number(left.count || 0));
  const recordedSurface = seen.find((entry) => normalizeWord(entry.form) !== normalizeWord(item.word));
  return String(recordedSurface?.form || seen[0]?.form || item?.word || "").trim();
}

function validWordbookIds(ids = [], wordbooks = state?.wordbooks || []) {
  const valid = new Set(wordbooks.map((wordbook) => wordbook.id));
  return cleanWordbookIds(ids).filter((id) => valid.has(id));
}

function cleanWordbookIds(ids = []) {
  return Array.from(new Set(ids.map(String).filter(Boolean).filter((id) => !isSystemWordbook(id))));
}

function mergeWordbookIds(left = [], right = []) {
  return Array.from(new Set([...left, ...right].filter(Boolean).map(String)));
}

function normalizeSeenForm(entry) {
  if (!entry) return null;
  const form = String(entry.form || entry.word || entry.normalized || "");
  const normalized = normalizeWord(entry.normalized || form);
  if (!normalized) return null;
  return {
    form,
    normalized,
    count: Math.max(1, Number(entry.count || 1))
  };
}

function mergeSeenForms(left = [], right = []) {
  const merged = new Map();
  [...left, ...right].forEach((entry) => {
    const normalized = normalizeWord(entry.normalized || entry.form);
    if (!normalized) return;
    const current = merged.get(normalized);
    if (current) {
      current.count += Math.max(1, Number(entry.count || 1));
      current.form = entry.form || current.form;
    } else {
      merged.set(normalized, {
        form: entry.form || normalized,
        normalized,
        count: Math.max(1, Number(entry.count || 1))
      });
    }
  });
  return Array.from(merged.values());
}

async function readJson(key) {
  try {
    return await storageDriver.getLocal(key);
  } catch {
    return null;
  }
}

function persist({ skipCloud = false } = {}) {
  if (!state) return;
  // Save before any rendering so a UI error can never cost the user a save.
  if (persistLocked) {
    setStatus("原数据尚未处理，修改暂未保存");
  } else {
    let pending;
    lastOwnWriteAt = Date.now();
    try {
      pending = storageDriver.setLocal(APP_STORAGE_KEY, state);
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(() => {
      clearSaveFailureNotice();
      flushRecordingRelease();
    }, handleSaveFailure);
  }
  try {
    renderMy();
  } catch (error) {
    console.error("OoFR could not refresh the profile page", error);
  }
  queueSyncedSettings();
  if (CLOUD_SYNC_ENABLED && !skipCloud) {
    writeCloudLocalMeta({ lastLocalChangeAt: new Date().toISOString() });
    queueCloudSync();
  }
}

// The whole state lives under one key, so two open windows would overwrite each
// other's changes. When another window saved, say so and offer a reload.
function handleExternalStateChange() {
  showStorageNotice({
    kind: "changed-elsewhere",
    message: "这份数据刚刚在另一个窗口里被修改。继续在这里编辑可能会覆盖那边的修改，建议先刷新页面。",
    actions: [{ label: "刷新页面", onClick: () => window.location.reload() }]
  });
}

function handleStorageEvent(event) {
  if (event.key === APP_STORAGE_KEY && event.newValue !== null && event.storageArea === window.localStorage) {
    handleExternalStateChange();
  }
}

function handleExtensionStorageChange(changes, area) {
  // The extension's own writes also arrive here, just after we made them.
  if (area === "local" && changes?.[APP_STORAGE_KEY] && Date.now() - lastOwnWriteAt > 3000) handleExternalStateChange();
}

function handleSaveFailure(error) {
  console.error("OoFR could not save", error);
  setStatus("保存失败");
  const full = error?.name === "QuotaExceededError" || /quota/i.test(String(error?.message || ""));
  showStorageNotice({
    kind: "save-failed",
    message: full
      ? "设备存储空间不足，最近的修改没有保存。请先导出完整数据备份，再清理一些素材或录音。"
      : "最近的修改没有保存成功。请先导出完整数据备份，避免关闭页面后丢失。",
    actions: [{ label: "导出备份", onClick: exportData }]
  });
}

function clearSaveFailureNotice() {
  if (storageNotice?.kind === "save-failed") hideStorageNotice();
}

// A lasting banner (unlike the one-line status text, nothing overwrites it).
function showStorageNotice({ kind, message, actions = [] }) {
  storageNotice = { kind, message };
  if (typeof document.createElement !== "function" || !document.body) return;
  if (!storageNoticeElement) {
    storageNoticeElement = el("div", "storage-notice");
    storageNoticeElement.setAttribute("role", "alert");
    document.body.append(storageNoticeElement);
  }
  const buttons = actions.map((action) => miniButton(action.label, action.onClick));
  // While saving is blocked the notice must stay until the user decides.
  if (!persistLocked) buttons.push(miniButton("知道了", hideStorageNotice));
  const actionRow = el("div", "storage-notice-actions");
  actionRow.append(...buttons);
  storageNoticeElement.replaceChildren(el("p", "", message), actionRow);
  storageNoticeElement.hidden = false;
}

function hideStorageNotice() {
  storageNotice = null;
  if (storageNoticeElement) storageNoticeElement.hidden = true;
}

function queueSyncedSettings() {
  if (!storageDriver.canSync) return;
  window.clearTimeout(syncSettingsTimer);
  syncSettingsTimer = window.setTimeout(() => {
    const syncedSettings = {
      rate: state.settings.rate,
      pause: state.settings.pause,
      repeat: state.settings.repeat,
      voice: state.settings.voice,
      voiceLocked: state.settings.voiceLocked,
      systemLanguage: state.settings.systemLanguage,
      localAiEndpoint: state.settings.localAiEndpoint,
      localAiModel: state.settings.localAiModel
    };
    storageDriver.setSync(SYNC_STORAGE_KEY, {
      settings: syncedSettings,
      updatedAt: nowIso()
    }).catch(() => {});
  }, 800);
}

// Where the state is kept:
//  - extension page: chrome.storage.local (no practical size limit with unlimitedStorage)
//  - every other page (iPhone/Safari, desktop browsers, the Mac app): IndexedDB, with
//    localStorage as the fallback and as the source for the one-time move
function createStorageDriver() {
  const chromeApi = globalThis.chrome;
  const hasChromeStorage = Boolean(chromeApi?.storage?.local);
  const isExtensionPage = window.location.protocol === "chrome-extension:";

  if (hasChromeStorage && isExtensionPage) {
    return {
      canSync: Boolean(chromeApi.storage.sync),
      async getLocal(key) {
        return new Promise((resolve) => {
          chromeApi.storage.local.get(key, (result) => resolve(result?.[key] || null));
        });
      },
      async getRaw(key) {
        const value = await this.getLocal(key);
        return value ? JSON.stringify(value) : "";
      },
      async hasLocal(key) {
        return new Promise((resolve) => {
          chromeApi.storage.local.get(key, (result) => resolve(Boolean(result?.[key])));
        });
      },
      async setLocal(key, value) {
        return new Promise((resolve, reject) => {
          chromeApi.storage.local.set({ [key]: value }, () => {
            const error = chromeApi.runtime?.lastError;
            if (error) reject(error);
            else resolve();
          });
        });
      },
      async getSync(key) {
        if (!chromeApi.storage.sync) return null;
        return new Promise((resolve) => {
          chromeApi.storage.sync.get(key, (result) => resolve(result?.[key] || null));
        });
      },
      async setSync(key, value) {
        if (!chromeApi.storage.sync) return;
        return new Promise((resolve, reject) => {
          chromeApi.storage.sync.set({ [key]: value }, () => {
            const error = chromeApi.runtime?.lastError;
            if (error) reject(error);
            else resolve();
          });
        });
      }
    };
  }

  const local = createLocalStorageDriver();
  return window.indexedDB ? createIndexedDbStateDriver(local) : local;
}

function createLocalStorageDriver() {
  return {
    canSync: false,
    async getLocal(key) {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch (error) {
        error.rawValue = raw;
        throw error;
      }
    },
    async getRaw(key) {
      return window.localStorage.getItem(key) || "";
    },
    async hasLocal(key) {
      return window.localStorage.getItem(key) !== null;
    },
    async setLocal(key, value) {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    async getSync() {
      return null;
    },
    async setSync() {}
  };
}

// localStorage holds only about 5 MB per site (less on iOS), which a library with
// AI explanations can outgrow; IndexedDB has no such ceiling.
//  - The first start after the upgrade copies the localStorage state over; the
//    old copy is left untouched as a safety net and is not used afterwards.
//  - If IndexedDB cannot be opened (private mode, an iOS bug), the session runs on
//    localStorage and leaves a marker, so the next start knows that copy is newer.
//  - A failed IndexedDB write is reported (no silent second copy), like a full localStorage.
function createIndexedDbStateDriver(legacy) {
  let dbPromise = null;
  let unavailable = false;
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("oofr-state") : null;

  function open() {
    if (unavailable) return Promise.reject(new Error("IndexedDB unavailable"));
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("IndexedDB open timed out")), STATE_DB_OPEN_TIMEOUT_MS);
        let request;
        try {
          request = indexedDB.open(STATE_DB_NAME, 1);
        } catch (error) {
          window.clearTimeout(timer);
          reject(error);
          return;
        }
        request.onupgradeneeded = () => request.result.createObjectStore(STATE_DB_STORE);
        request.onsuccess = () => {
          window.clearTimeout(timer);
          const db = request.result;
          // Browsers may close idle connections or upgrade the database: reopen on demand.
          db.onclose = () => { dbPromise = null; };
          db.onversionchange = () => { db.close(); dbPromise = null; };
          resolve(db);
        };
        request.onerror = () => {
          window.clearTimeout(timer);
          reject(request.error);
        };
      }).catch((error) => {
        dbPromise = null;
        unavailable = true;
        console.warn("OoFR: IndexedDB is not available, using localStorage", error);
        throw error;
      });
    }
    return dbPromise;
  }

  function request(db, mode, run) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STATE_DB_STORE, mode);
      const pending = run(transaction.objectStore(STATE_DB_STORE));
      transaction.oncomplete = () => resolve(pending?.result);
      transaction.onerror = () => reject(transaction.error || pending?.error);
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
  }

  const readRecord = (db, key) => request(db, "readonly", (store) => store.get(key));
  const writeRecord = (db, key, value) => request(db, "readwrite", (store) => store.put({ savedAt: nowIso(), json: JSON.stringify(value) }, key));

  function parseRecord(record) {
    try {
      return JSON.parse(record.json);
    } catch (error) {
      error.rawValue = String(record.json || "");
      throw error;
    }
  }

  function legacyIsNewer(record) {
    try {
      const marker = window.localStorage.getItem(LEGACY_NEWER_KEY);
      return Boolean(marker) && (!record?.savedAt || marker > record.savedAt);
    } catch {
      return false;
    }
  }

  return {
    canSync: false,
    async getLocal(key) {
      let db;
      try {
        db = await open();
      } catch {
        return legacy.getLocal(key);
      }
      const record = await readRecord(db, key);
      const legacyNewer = key === APP_STORAGE_KEY && legacyIsNewer(record);
      if (record && !legacyNewer) return parseRecord(record);
      // Nothing in IndexedDB yet (first start after the upgrade), or the old copy
      // is newer: bring it over. A failed copy only means we try again next time.
      const value = await legacy.getLocal(key);
      if (value == null) return record ? parseRecord(record) : null;
      try {
        await writeRecord(db, key, value);
        if (legacyNewer) window.localStorage.removeItem(LEGACY_NEWER_KEY);
      } catch (error) {
        console.warn("OoFR: could not copy the saved data into IndexedDB", error);
      }
      return value;
    },
    async getRaw(key) {
      try {
        const record = await readRecord(await open(), key);
        if (record && !legacyIsNewer(record)) return String(record.json || "");
      } catch {
        // fall through to the localStorage copy
      }
      return legacy.getRaw(key);
    },
    async hasLocal(key) {
      try {
        if (await readRecord(await open(), key)) return true;
      } catch {
        // fall through
      }
      return legacy.hasLocal(key);
    },
    async setLocal(key, value) {
      let db;
      try {
        db = await open();
      } catch {
        await legacy.setLocal(key, value);
        try { window.localStorage.setItem(LEGACY_NEWER_KEY, nowIso()); } catch { /* best effort */ }
        return;
      }
      await writeRecord(db, key, value);
      if (key === APP_STORAGE_KEY) channel?.postMessage("saved");
    },
    // Other windows (which share this database) tell us when they saved.
    onExternalChange(callback) {
      if (channel) channel.onmessage = () => callback();
    },
    async getSync() {
      return null;
    },
    async setSync() {}
  };
}
