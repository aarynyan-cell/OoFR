import {
  LANGUAGES,
  NATIVE_LANGUAGE_IDS,
  STUDY_LANGUAGE_IDS,
  activePair,
  isCjkLanguage,
  languageName
} from "./languages.js";
import { createTranslator, supportedUiLanguage } from "./i18n.js";
import {
  deleteLexiconPackage,
  downloadLexiconPackage,
  emptyLexicon,
  loadInstalledLexicon,
  loadLexiconManifest
} from "./lexicon-store.js";

const APP_STORAGE_KEY = "multape.app.v1";
const SYNC_STORAGE_KEY = "multape.sync.v1";
const ALL_WORDBOOK_ID = "all";
const NEW_WORDBOOK_ID = "new";
const GOT_WORDBOOK_ID = "got";
const DIY_WORDBOOK_ID = "diy";
const WORD_PATTERN_SOURCE = String.raw`[\p{L}\p{M}]+(?:[’'\-][\p{L}\p{M}]+)*`;
const ELIDED_PREFIXES = new Set(["c", "d", "j", "l", "m", "n", "qu", "s", "t", "jusqu", "lorsqu", "puisqu"]);
const VOICE_SCAN_ATTEMPTS = 14;

const SYSTEM_WORDBOOKS = [
  { id: ALL_WORDBOOK_ID, title: "all", description: "全部单词" },
  { id: NEW_WORDBOOK_ID, title: "new", description: "还没 got 的词" },
  { id: GOT_WORDBOOK_ID, title: "got", description: "已经掌握的词" },
  { id: DIY_WORDBOOK_ID, title: "DIY", description: "待补音标或释义" }
];

const icons = {
  album: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M5 3h14v18H5z"/><path fill="none" stroke="currentColor" stroke-width="2" d="M9 7h6M9 17h6"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>`,
  book: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="2" d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 0-4-4z"/><path fill="none" stroke="currentColor" stroke-width="2" d="M5 4v16"/></svg>`,
  check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4" d="m5 12 4 4L19 6"/></svg>`,
  close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2.4" d="m6 6 12 12M18 6 6 18"/></svg>`,
  download: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="2" d="m4 16-.5 4 4-.5L19 8l-3.5-3.5z"/><path fill="none" stroke="currentColor" stroke-width="2" d="m14 6 4 4"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>`,
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.14v13.72c0 .74.82 1.18 1.44.78l10.08-6.86a.93.93 0 0 0 0-1.56L9.44 4.36A.94.94 0 0 0 8 5.14Z"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2.4" d="M12 5v14M5 12h14"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 11a8.1 8.1 0 0 0-14.4-4.8L4 8m0 0V4m0 4h4m-4 5a8.1 8.1 0 0 0 14.4 4.8L20 16m0 0v4m0-4h-4"/></svg>`,
  save: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="2" d="M5 4h12l2 2v14H5z"/><path fill="none" stroke="currentColor" stroke-width="2" d="M8 4v6h8V4M8 20v-6h8v6"/></svg>`,
  spark: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 2 1.9 5.7L20 10l-6.1 2.3L12 18l-1.9-5.7L4 10l6.1-2.3L12 2Zm7 12 1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z"/></svg>`,
  speaker: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9.2v5.6c0 .66.54 1.2 1.2 1.2H8l5.1 4.1c.78.62 1.9.07 1.9-.93V4.83c0-1-1.12-1.55-1.9-.93L8 8H5.2C4.54 8 4 8.54 4 9.2Zm13.4-1.4a1 1 0 0 0 0 1.4 4 4 0 0 1 0 5.6 1 1 0 0 0 1.4 1.4 6 6 0 0 0 0-8.4 1 1 0 0 0-1.4 0Z"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="12" height="12" x="6" y="6" rx="2" fill="currentColor"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7h16m-10 4v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>`,
  upload: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 21V9m0 0 4 4m-4-4-4 4M5 4h14"/></svg>`,
  user: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="2" d="M4 21a8 8 0 0 1 16 0"/></svg>`
};

const elements = {
  bootOverlay: document.querySelector("#bootOverlay"),
  bootStatus: document.querySelector("#bootStatus"),
  appTitle: document.querySelector("#appTitle"),
  appEyebrow: document.querySelector("#appEyebrow"),
  navButtons: Array.from(document.querySelectorAll("[data-view-target]")),
  views: {
    reader: document.querySelector("#readerView"),
    library: document.querySelector("#libraryView"),
    vocab: document.querySelector("#vocabView"),
    my: document.querySelector("#myView")
  },
  input: document.querySelector("#textInput"),
  textInputLabel: document.querySelector("#textInputLabel"),
  activeEntryLine: document.querySelector("#activeEntryLine"),
  textStats: document.querySelector("#textStats"),
  playAllReader: document.querySelector("#playAllReader"),
  stopReader: document.querySelector("#stopReader"),
  saveEntryBtn: document.querySelector("#saveEntryBtn"),
  refreshBtn: document.querySelector("#refreshBtn"),
  sampleBtn: document.querySelector("#sampleBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  audioSettingsToggle: document.querySelector("#audioSettingsToggle"),
  audioSettingsPanel: document.querySelector("#audioSettingsPanel"),
  studyVoiceSelect: document.querySelector("#studyVoiceSelect"),
  myStudyVoiceSelect: document.querySelector("#myStudyVoiceSelect"),
  nativeVoiceSelect: document.querySelector("#nativeVoiceSelect"),
  refreshVoicesBtn: document.querySelector("#refreshVoicesBtn"),
  myRefreshVoicesBtn: document.querySelector("#myRefreshVoicesBtn"),
  preferNaturalVoicesBtn: document.querySelector("#preferNaturalVoicesBtn"),
  studyVoiceLabel: document.querySelector("#studyVoiceLabel"),
  myStudyVoiceLabel: document.querySelector("#myStudyVoiceLabel"),
  myNativeVoiceLabel: document.querySelector("#myNativeVoiceLabel"),
  rateControl: document.querySelector("#rateControl"),
  rateLabel: document.querySelector("#rateLabel"),
  repeatGroup: document.querySelector("#repeatGroup"),
  pauseControl: document.querySelector("#pauseControl"),
  pauseLabel: document.querySelector("#pauseLabel"),
  statusLine: document.querySelector("#statusLine"),
  sentenceList: document.querySelector("#sentenceList"),
  wordPanel: document.querySelector("#wordPanel"),
  wordPanelEyebrow: document.querySelector("#wordPanelEyebrow"),
  wordPanelTitle: document.querySelector("#wordPanelTitle"),
  wordPanelMeta: document.querySelector("#wordPanelMeta"),
  wordPlayBtn: document.querySelector("#wordPlayBtn"),
  wordAddBtn: document.querySelector("#wordAddBtn"),
  wordToggleBtn: document.querySelector("#wordToggleBtn"),
  wordEditBtn: document.querySelector("#wordEditBtn"),
  wordDeleteBtn: document.querySelector("#wordDeleteBtn"),
  wordPanelCloseBtn: document.querySelector("#wordPanelCloseBtn"),
  newAlbumBtn: document.querySelector("#newAlbumBtn"),
  albumShelf: document.querySelector("#albumShelf"),
  libraryDetail: document.querySelector("#libraryDetail"),
  newVocabBtn: document.querySelector("#newVocabBtn"),
  newWordbookBtn: document.querySelector("#newWordbookBtn"),
  wordbookShelf: document.querySelector("#wordbookShelf"),
  selectedWordbookLine: document.querySelector("#selectedWordbookLine"),
  vocabSearch: document.querySelector("#vocabSearch"),
  vocabStats: document.querySelector("#vocabStats"),
  vocabList: document.querySelector("#vocabList"),
  nativeLanguageSelect: document.querySelector("#nativeLanguageSelect"),
  studyLanguageSelect: document.querySelector("#studyLanguageSelect"),
  languageHint: document.querySelector("#languageHint"),
  lexiconBadge: document.querySelector("#lexiconBadge"),
  lexiconDescription: document.querySelector("#lexiconDescription"),
  lexiconActionBtn: document.querySelector("#lexiconActionBtn"),
  lexiconDeleteBtn: document.querySelector("#lexiconDeleteBtn"),
  lexiconProgress: document.querySelector("#lexiconProgress"),
  exportBtn: document.querySelector("#exportBtn"),
  importBtn: document.querySelector("#importBtn"),
  importFile: document.querySelector("#importFile"),
  myStats: document.querySelector("#myStats"),
  dialog: document.querySelector("#appDialog"),
  dialogForm: document.querySelector("#dialogForm"),
  dialogTitle: document.querySelector("#dialogTitle"),
  dialogBody: document.querySelector("#dialogBody"),
  dialogSubmitBtn: document.querySelector("#dialogSubmitBtn"),
  dialogCloseBtn: document.querySelector("#dialogCloseBtn"),
  dialogCancelBtn: document.querySelector("#dialogCancelBtn")
};

const storageDriver = createStorageDriver();

let state = null;
let t = createTranslator("zh");
let lexiconManifest = { packages: [] };
let lexiconPackages = new Map();
let activeLexicon = emptyLexicon("fr-zh");
let allVoices = [];
let sentences = [];
let activeElement = null;
let selectedWord = null;
let runToken = 0;
let playback = { status: "idle", key: "", label: "", token: 0 };
let renderTimer = 0;
let dialogSubmitHandler = null;
let syncSettingsTimer = 0;

initApp();

async function initApp() {
  try {
    setBootStatus("正在装入界面...");
    hydrateIcons();
    state = await loadAppState();
    await applySyncedSettings();
    t = createTranslator(supportedUiLanguage(state.profile.nativeLanguage));
    bindEvents();

    setBootStatus("正在读取词库清单...");
    lexiconManifest = await loadLexiconManifest().catch(() => ({ packages: [] }));
    lexiconPackages = new Map((lexiconManifest.packages || []).map((item) => [item.pair, item]));

    populateLanguageSelectors();
    syncSettingsControls();
    await refreshVoices({ quiet: true });
    await loadActiveLexicon();
    ensureSelections();
    renderAll();
    registerServiceWorker();

    if (canSpeak()) {
      window.speechSynthesis.onvoiceschanged = () => {
        loadVoices();
        renderVoiceControls();
      };
    }
  } finally {
    window.setTimeout(() => {
      elements.bootOverlay?.classList.add("is-hidden");
    }, 140);
  }
}

function hydrateIcons() {
  document.querySelectorAll("[data-icon]").forEach((node) => {
    const name = node.dataset.icon;
    if (icons[name]) {
      node.insertAdjacentHTML("afterbegin", icons[name]);
    }
  });
}

function bindEvents() {
  elements.navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.ui.activeView = button.dataset.viewTarget;
      persist();
      renderView();
      if (state.ui.activeView === "my") renderMy();
    });
  });

  elements.input.addEventListener("input", () => {
    state.currentText = elements.input.value;
    state.activeEntryId = null;
    selectedWord = null;
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => {
      renderActiveEntryLine();
      renderSentences();
      renderWordPanel();
      persist();
    }, 100);
  });

  elements.playAllReader.addEventListener("click", toggleAllSentences);
  elements.stopReader.addEventListener("click", stopSpeech);
  elements.saveEntryBtn.addEventListener("click", openSaveCurrentDialog);
  elements.refreshBtn.addEventListener("click", renderSentences);
  elements.sampleBtn.addEventListener("click", () => setCurrentText(activeLanguage().sample, null));
  elements.clearBtn.addEventListener("click", () => {
    stopSpeech();
    setCurrentText("", null);
    elements.input.focus();
  });

  elements.audioSettingsToggle.addEventListener("click", () => setAudioSettingsOpen(elements.audioSettingsPanel.hidden));
  elements.rateControl.addEventListener("input", () => {
    state.settings.rate = elements.rateControl.value;
    updateLabels();
    persist();
  });
  elements.pauseControl.addEventListener("input", () => {
    state.settings.pause = elements.pauseControl.value;
    updateLabels();
    persist();
  });
  elements.repeatGroup.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-repeat]");
    if (!button) return;
    state.settings.repeat = button.dataset.repeat;
    setRepeat(state.settings.repeat);
    persist();
  });

  elements.studyVoiceSelect.addEventListener("change", () => setVoiceForLanguage(activeStudyLanguageId(), elements.studyVoiceSelect.value));
  elements.myStudyVoiceSelect.addEventListener("change", () => setVoiceForLanguage(activeStudyLanguageId(), elements.myStudyVoiceSelect.value));
  elements.nativeVoiceSelect.addEventListener("change", () => setVoiceForLanguage(activeNativeLanguageId(), elements.nativeVoiceSelect.value));
  elements.refreshVoicesBtn.addEventListener("click", () => refreshVoices());
  elements.myRefreshVoicesBtn.addEventListener("click", () => refreshVoices());
  elements.preferNaturalVoicesBtn.addEventListener("click", preferNaturalVoices);
  elements.nativeLanguageSelect.addEventListener("change", () => changeLanguagePair({ nativeLanguage: elements.nativeLanguageSelect.value }));
  elements.studyLanguageSelect.addEventListener("change", () => changeLanguagePair({ studyLanguage: elements.studyLanguageSelect.value }));

  elements.lexiconActionBtn.addEventListener("click", installActiveLexicon);
  elements.lexiconDeleteBtn.addEventListener("click", deleteActiveLexicon);
  elements.exportBtn.addEventListener("click", exportData);
  elements.importBtn.addEventListener("click", () => elements.importFile.click());
  elements.importFile.addEventListener("change", importData);

  elements.wordPlayBtn.addEventListener("click", () => {
    if (!selectedWord) return;
    togglePlayback([{ text: selectedWord.raw, element: selectedWord.element, label: selectedWord.raw }], {
      key: `word:${selectedWord.normalized}`,
      label: selectedWord.raw
    });
  });
  elements.wordAddBtn.addEventListener("click", () => {
    if (!selectedWord) return;
    addWordToVocabulary(selectedWord.raw);
    persist();
    renderWordbooks();
    renderVocab();
    renderSentences();
    renderWordPanel();
  });
  elements.wordToggleBtn.addEventListener("click", () => {
    if (!selectedWord) return;
    const item = ensureVocabularyItem(selectedWord.raw);
    trackSeenForm(item, selectedWord.raw);
    item.status = item.status === "got" ? "new" : "got";
    item.updatedAt = nowIso();
    persist();
    renderWordbooks();
    renderVocab();
    renderSentences();
    renderWordPanel();
  });
  elements.wordEditBtn.addEventListener("click", () => {
    if (!selectedWord) return;
    openVocabDialog(ensureVocabularyItem(selectedWord.raw).id);
  });
  elements.wordDeleteBtn.addEventListener("click", () => {
    if (!selectedWord) return;
    const item = findVocabulary(selectedWord.raw);
    if (item) deleteVocabulary(item.id);
  });
  elements.wordPanelCloseBtn.addEventListener("click", closeWordPanel);

  elements.newAlbumBtn.addEventListener("click", () => openAlbumDialog());
  elements.newVocabBtn.addEventListener("click", () => openVocabDialog());
  elements.newWordbookBtn.addEventListener("click", () => openWordbookDialog());
  elements.vocabSearch.addEventListener("input", renderVocab);
  elements.dialogCloseBtn.addEventListener("click", closeDialog);
  elements.dialogCancelBtn.addEventListener("click", closeDialog);
  elements.dialogForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!dialogSubmitHandler) return;
    const shouldClose = dialogSubmitHandler(collectDialogValues());
    if (shouldClose !== false) closeDialog();
  });

  document.addEventListener("click", closeWordPanelOnOutsideClick);
  window.addEventListener("resize", positionWordPanel);
  window.addEventListener("scroll", positionWordPanel, { passive: true });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && selectedWord) closeWordPanel();
  });
}

function renderAll() {
  renderChrome();
  renderView();
  syncInput();
  renderActiveEntryLine();
  updateLabels();
  setRepeat(state.settings.repeat);
  renderSentences();
  renderWordPanel();
  renderLibrary();
  renderWordbooks();
  renderVocab();
  renderMy();
  renderVoiceControls();
  renderLexiconPanel();
  renderPlaybackControls();
}

function renderChrome() {
  const uiLanguage = supportedUiLanguage(state.profile.nativeLanguage);
  t = createTranslator(uiLanguage);
  const studyName = languageName(activeStudyLanguageId(), uiLanguage);
  const nativeName = languageName(activeNativeLanguageId(), uiLanguage);
  document.documentElement.lang = LANGUAGES[activeNativeLanguageId()]?.locale || "en";
  elements.appTitle.textContent = t("app.title");
  elements.appEyebrow.textContent = `MulTape · ${studyName} ↔ ${nativeName}`;
  elements.textInputLabel.textContent = t("reader.textLabel", { language: studyName });
  elements.input.lang = activeLanguage().locale;
  elements.studyVoiceLabel.textContent = `${studyName}声音`;
  elements.myStudyVoiceLabel.textContent = `${studyName}声音`;
  elements.myNativeVoiceLabel.textContent = `${nativeName}声音`;
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
}

function renderView() {
  Object.entries(elements.views).forEach(([name, view]) => {
    view.classList.toggle("is-active", state.ui.activeView === name);
  });
  elements.navButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.viewTarget === state.ui.activeView));
  });
}

function renderMy() {
  const albums = activeAlbums();
  const tapeIds = activeTapes().map((tape) => tape.id);
  const entries = state.entries.filter((entry) => tapeIds.includes(entry.tapeId));
  const words = activeVocabulary();
  elements.myStats.textContent = t("my.stats", {
    albums: albums.length,
    tapes: activeTapes().length,
    entries: entries.length,
    words: words.length
  });
  renderLexiconPanel();
}

function renderActiveEntryLine() {
  const entry = getEntry(state.activeEntryId);
  if (!entry) {
    elements.activeEntryLine.textContent = t("reader.draft");
    return;
  }
  const tape = getTape(entry.tapeId);
  const album = getAlbum(tape?.albumId);
  const practiced = entry.practiceCount ? ` · 已练 ${entry.practiceCount} 次` : "";
  elements.activeEntryLine.textContent = `${album?.title || "专辑"} / ${tape?.title || "磁带"} / ${entry.title}${practiced}`;
}

function renderSentences() {
  const text = state.currentText.trim();
  sentences = splitSentences(text);
  elements.sentenceList.replaceChildren();

  if (sentences.length === 0) {
    elements.sentenceList.append(emptyState(t("reader.empty")));
  } else {
    sentences.forEach((sentence, index) => elements.sentenceList.append(createSentenceRow(sentence, index)));
  }

  elements.textStats.textContent = t("stats.text", {
    sentences: sentences.length,
    words: countWords(text)
  });
  elements.playAllReader.disabled = sentences.length === 0;
  renderPlaybackControls();
}

function createSentenceRow(sentence, index) {
  const row = el("div", "sentence-row");
  row.dataset.index = String(index);
  row.dataset.playbackKey = `sentence:${index}`;

  const playButton = el("button", "icon-button sentence-play play-trigger");
  playButton.type = "button";
  playButton.dataset.playbackKey = row.dataset.playbackKey;
  playButton.innerHTML = icons.speaker;
  playButton.addEventListener("click", () => {
    if (!isActivePlayback(row.dataset.playbackKey)) recordPracticeIfEntry();
    togglePlayback([{ text: sentence, element: row, label: `第 ${index + 1} 句` }], {
      key: row.dataset.playbackKey,
      label: `第 ${index + 1} 句`
    });
  });

  const text = el("p", "sentence-text");
  text.lang = activeLanguage().locale;
  appendClickableWords(text, sentence);

  const number = el("span", "sentence-number", String(index + 1).padStart(2, "0"));
  row.append(playButton, text, number);
  return row;
}

function appendClickableWords(container, sentence) {
  const tokens = tokenizeWithOffsets(sentence);
  let lastIndex = 0;
  tokens.forEach((token) => {
    if (token.index > lastIndex) {
      container.append(document.createTextNode(sentence.slice(lastIndex, token.index)));
    }
    const button = el("button", "word-button play-trigger");
    const vocab = findVocabulary(token.text);
    button.type = "button";
    button.lang = activeLanguage().locale;
    button.textContent = token.text;
    button.title = `播放 ${token.text}`;
    button.dataset.word = token.text;
    if (vocab) button.classList.add(vocab.status === "got" ? "vocab-got" : "vocab-new");
    button.addEventListener("click", () => handleWordClick(token.text, button));
    container.append(button);
    lastIndex = token.index + token.text.length;
  });
  if (lastIndex < sentence.length) {
    container.append(document.createTextNode(sentence.slice(lastIndex)));
  }
}

function renderWordPanel() {
  if (!selectedWord) {
    elements.wordPanel.hidden = true;
    elements.wordPanel.classList.remove("is-bottom-sheet");
    resetWordPanelPosition();
    return;
  }

  const info = selectedWord.info || resolveWordInfo(selectedWord.raw);
  const vocab = findVocabulary(selectedWord.raw);
  const hint = vocab || info.lexicon || lookupLexicon(selectedWord.raw);
  const status = vocab ? (vocab.status === "got" ? "got" : t("word.new")) : t("word.notAdded");
  const ipa = hint?.ipa || t("word.ipaMissing");
  const meaning = hint?.meaning || t("word.meaningMissing");
  const formLine = info.lemma !== info.normalized ? `${selectedWord.raw} → ${hint?.word || info.lemma}` : selectedWord.raw;
  const lexiconNote = activeLexicon.entriesCount ? "" : ` · ${t("word.lexiconMissing")}`;

  elements.wordPanel.hidden = false;
  elements.wordPanelEyebrow.textContent = languageName(activeStudyLanguageId(), activeNativeLanguageId());
  elements.wordPanelTitle.textContent = formLine;
  elements.wordPanelMeta.textContent = `${status} · ${ipa} · ${meaning}${lexiconNote}`;
  elements.wordAddBtn.hidden = Boolean(vocab);
  elements.wordToggleBtn.hidden = !vocab;
  elements.wordEditBtn.hidden = !vocab;
  elements.wordDeleteBtn.hidden = !vocab;
  if (vocab) elements.wordToggleBtn.querySelector("span").textContent = vocab.status === "got" ? "new" : "got";
  renderWordPlayButton();
  window.requestAnimationFrame(positionWordPanel);
}

function handleWordClick(word, element) {
  selectedWord = { raw: word, normalized: normalizeWord(word), info: resolveWordInfo(word), element };
  renderWordPanel();
  playItems([{ text: word, element, label: word }], { key: `word:${selectedWord.normalized}`, label: word });
}

function positionWordPanel() {
  if (!selectedWord || elements.wordPanel.hidden) return;
  const panel = elements.wordPanel;
  const anchor = selectedWord.element;
  const isMobile = window.matchMedia("(max-width: 620px)").matches;
  panel.classList.toggle("is-bottom-sheet", isMobile);
  if (isMobile) {
    resetWordPanelPosition();
    return;
  }
  if (!anchor || !document.body.contains(anchor)) return;
  const anchorRect = anchor.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const margin = 12;
  const left = clamp(anchorRect.left + anchorRect.width / 2 - panelRect.width / 2, margin, window.innerWidth - panelRect.width - margin);
  let top = anchorRect.bottom + 10;
  if (top + panelRect.height > window.innerHeight - margin) top = anchorRect.top - panelRect.height - 10;
  top = clamp(top, margin, Math.max(margin, window.innerHeight - panelRect.height - margin));
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function resetWordPanelPosition() {
  elements.wordPanel.style.left = "";
  elements.wordPanel.style.top = "";
}

function closeWordPanel() {
  selectedWord = null;
  renderWordPanel();
}

function closeWordPanelOnOutsideClick(event) {
  if (!selectedWord) return;
  const target = event.target;
  if (target.closest?.(".word-panel") || target.closest?.(".word-button")) return;
  closeWordPanel();
}

function renderLibrary() {
  ensureSelections();
  elements.albumShelf.replaceChildren();
  const albums = activeAlbums();
  if (albums.length === 0) {
    elements.albumShelf.append(emptyState(t("library.emptyAlbums")));
  } else {
    albums.forEach((album) => elements.albumShelf.append(createAlbumCard(album)));
  }
  renderLibraryDetail();
}

function createAlbumCard(album) {
  const card = el("article", "album-card");
  card.style.background = `linear-gradient(135deg, ${album.coverColor}, rgba(18, 21, 20, 0.86))`;
  card.classList.toggle("is-selected", state.ui.selectedAlbumId === album.id);
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.addEventListener("click", (event) => {
    if (!event.target.closest(".row-actions")) selectAlbum(album.id);
  });

  const buttonNode = el("button", "album-button");
  buttonNode.type = "button";
  buttonNode.addEventListener("click", () => selectAlbum(album.id));
  buttonNode.append(el("h3", "", album.title), el("p", "micro-copy", album.description || " "));
  const meta = el("div", "row-actions");
  meta.append(el("span", "badge", `${getTapes(album.id).length} 磁带`), el("span", "badge", `${getEntriesByAlbum(album.id).length} 段落`));
  const actions = el("div", "row-actions");
  actions.append(miniButton("编辑", () => openAlbumDialog(album.id)), miniButton("删除", () => deleteAlbum(album.id)));
  card.append(buttonNode, meta, actions);
  return card;
}

function selectAlbum(albumId) {
  state.ui.selectedAlbumId = albumId;
  state.ui.selectedTapeId = getTapes(albumId)[0]?.id || null;
  persist();
  renderLibrary();
}

function renderLibraryDetail() {
  elements.libraryDetail.replaceChildren();
  const album = getAlbum(state.ui.selectedAlbumId);
  if (!album) {
    elements.libraryDetail.append(emptyState("选择或新建一个专辑"));
    return;
  }

  const header = el("div", "detail-header");
  const titleBox = el("div");
  titleBox.append(el("p", "eyebrow", "Album"), el("h2", "", album.title), el("p", "micro-copy", album.description || " "));
  const headerActions = el("div", "row-actions");
  headerActions.append(button("磁带", "command-button primary", () => openTapeDialog(null, album.id), "plus"), button("编辑", "command-button", () => openAlbumDialog(album.id), "edit"));
  header.append(titleBox, headerActions);

  const tapeSection = el("section", "cassette-list");
  const tapes = getTapes(album.id);
  if (tapes.length === 0) tapeSection.append(emptyState(t("library.emptyTapes")));
  else tapes.forEach((tape) => tapeSection.append(createTapeCard(tape)));

  elements.libraryDetail.append(header, tapeSection, createEntrySection());
}

function createTapeCard(tape) {
  const card = el("article", "cassette-card");
  card.classList.toggle("is-selected", state.ui.selectedTapeId === tape.id);
  const face = el("div", "cassette-face");
  const label = el("button", "cassette-label");
  label.type = "button";
  label.addEventListener("click", () => {
    state.ui.selectedTapeId = tape.id;
    persist();
    renderLibrary();
  });
  label.append(el("h3", "", tape.title), el("p", "micro-copy", tape.description || `${getEntries(tape.id).length} 个段落`));
  face.append(el("div", "cassette-reel"), label, el("div", "cassette-reel"));
  const actions = el("div", "row-actions");
  actions.append(miniButton("编辑", () => openTapeDialog(tape.id)), miniButton("删除", () => deleteTape(tape.id)));
  card.append(face, actions);
  return card;
}

function createEntrySection() {
  const wrap = el("section", "entry-list");
  const tape = getTape(state.ui.selectedTapeId);
  if (!tape) {
    wrap.append(emptyState("选择或新建一盘磁带"));
    return wrap;
  }
  const header = el("div", "detail-header");
  const titleBox = el("div");
  titleBox.append(el("p", "eyebrow", "Cassette"), el("h2", "", tape.title), el("p", "micro-copy", tape.description || " "));
  const actions = el("div", "row-actions");
  actions.append(button("段落", "command-button primary", () => openEntryDialog(null, tape.id), "plus"));
  header.append(titleBox, actions);
  wrap.append(header);

  const entries = getEntries(tape.id);
  if (entries.length === 0) {
    wrap.append(emptyState(t("library.emptyEntries")));
    return wrap;
  }

  entries.forEach((entry) => {
    const item = el("article", "entry-item");
    const titleRow = el("div", "panel-title-row compact");
    titleRow.append(el("h3", "", entry.title), el("span", "badge", `${entry.practiceCount || 0} 次`));
    const preview = el("p", "entry-preview", entry.text);
    const meta = el("p", "micro-copy", entry.lastPracticedAt ? `最近练习：${formatDate(entry.lastPracticedAt)}` : "尚未练习");
    const rowActions = el("div", "row-actions");
    rowActions.append(miniButton("打开", () => loadEntry(entry.id)), miniButton("编辑", () => openEntryDialog(entry.id)), miniButton("删除", () => deleteEntry(entry.id)));
    item.append(titleRow, preview, meta, rowActions);
    wrap.append(item);
  });
  return wrap;
}

function renderWordbooks() {
  elements.wordbookShelf.replaceChildren();
  [...SYSTEM_WORDBOOKS, ...activeWordbooks()].forEach((book) => elements.wordbookShelf.append(createWordbookCard(book)));
  const selected = getWordbook(state.ui.selectedWordbookId);
  const count = vocabularyForWordbook(state.ui.selectedWordbookId).length;
  elements.selectedWordbookLine.textContent = t("vocab.selected", { title: selected?.title || "all", count });
}

function createWordbookCard(book) {
  const count = vocabularyForWordbook(book.id).length;
  const card = el("article", `wordbook-card${isSystemWordbook(book.id) ? " is-system" : ""}`);
  card.classList.toggle("is-selected", state.ui.selectedWordbookId === book.id);
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  const select = () => {
    state.ui.selectedWordbookId = book.id;
    persist();
    renderWordbooks();
    renderVocab();
  };
  card.addEventListener("click", (event) => {
    if (!event.target.closest(".row-actions")) select();
  });
  card.append(el("h3", "", book.title), el("p", "micro-copy", book.description || " "), el("span", "badge", `${count} 词`));
  if (!isSystemWordbook(book.id)) {
    const actions = el("div", "row-actions");
    actions.append(miniButton("编辑", () => openWordbookDialog(book.id)), miniButton("删除", () => deleteWordbook(book.id)));
    card.append(actions);
  }
  return card;
}

function renderVocab() {
  const query = normalizeSearch(elements.vocabSearch.value || "");
  const items = activeVocabulary()
    .filter((item) => vocabularyMatchesWordbook(item, state.ui.selectedWordbookId))
    .filter((item) => !query || normalizeSearch(`${item.word} ${item.lemma || ""} ${item.ipa} ${item.meaning} ${seenFormsText(item)} ${wordbookNamesText(item)}`).includes(query))
    .sort((a, b) => a.word.localeCompare(b.word, activeLanguage().locale));

  const gotCount = activeVocabulary().filter((item) => item.status === "got").length;
  elements.vocabStats.textContent = `${items.length} / ${activeVocabulary().length} 词 · ${gotCount} got`;
  elements.vocabList.replaceChildren();
  if (items.length === 0) {
    elements.vocabList.append(emptyState(t("vocab.empty")));
    return;
  }

  items.forEach((item) => {
    const card = el("article", `vocab-item status-${item.status}`);
    const body = el("div");
    const word = el("div", "vocab-word");
    word.append(el("strong", "", item.word), el("span", "", item.ipa || t("word.ipaMissing")), el("span", "badge", item.status));
    body.append(word, el("p", "", item.meaning || t("word.meaningMissing")));
    const forms = seenFormsText(item);
    const books = wordbookNamesText(item);
    if (forms) body.append(el("p", "micro-copy", `见过：${forms}`));
    if (books) body.append(el("p", "micro-copy", `词本：${books}`));
    const actions = el("div", "row-actions");
    actions.append(
      miniButton("播放", () => togglePlayback([{ text: item.word, element: card, label: item.word }], { key: `word:${item.normalized}`, label: item.word })),
      miniButton(item.status === "got" ? "new" : "got", () => toggleVocabularyStatus(item.id)),
      miniButton("编辑", () => openVocabDialog(item.id)),
      miniButton("删除", () => deleteVocabulary(item.id))
    );
    card.append(body, actions);
    elements.vocabList.append(card);
  });
}

function toggleAllSentences() {
  const rows = Array.from(elements.sentenceList.querySelectorAll(".sentence-row"));
  const items = sentences.map((sentence, index) => ({ text: sentence, element: rows[index], label: `第 ${index + 1} 句` }));
  if (items.length > 0 && !isActivePlayback("reader:all")) recordPracticeIfEntry();
  togglePlayback(items, { key: "reader:all", label: t("reader.playAll") });
}

function togglePlayback(items, options = {}) {
  const key = options.key || playbackKeyForItems(items);
  if (playback.key === key && playback.status === "playing") {
    pauseSpeech();
    return;
  }
  if (playback.key === key && playback.status === "paused") {
    resumeSpeech();
    return;
  }
  playItems(items, { ...options, key });
}

async function playItems(items, options = {}) {
  const playableItems = items.filter((item) => item?.text?.trim());
  if (playableItems.length === 0) return;
  if (!canSpeak()) {
    setStatus(t("reader.unsupported"));
    return;
  }

  const token = ++runToken;
  const key = options.key || playbackKeyForItems(playableItems);
  const label = options.label || playableItems[0]?.label || t("reader.title");
  window.speechSynthesis.cancel();
  clearActive();
  playback = { status: "playing", key, label, token };
  setBusy(true);
  renderPlaybackControls();

  try {
    for (const item of playableItems) {
      if (token !== runToken) break;
      markActive(item.element);
      playback.label = item.label || label;
      renderPlaybackControls();
      setStatus(`正在播放：${item.label}`);
      const repeat = getRepeat();
      for (let index = 0; index < repeat; index += 1) {
        if (token !== runToken) break;
        await speakOnce(item.text, token, activeStudyLanguageId());
        if (token !== runToken || index >= repeat - 1) break;
        await pause(getPauseMs(), token);
      }
    }
  } finally {
    if (token === runToken) {
      clearActive();
      setBusy(false);
      playback = { status: "idle", key: "", label: "", token: 0 };
      renderPlaybackControls();
      setStatus(t("reader.done"));
    }
  }
}

function speakOnce(text, token, languageId) {
  return new Promise((resolve) => {
    const language = LANGUAGES[languageId] || activeLanguage();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language.locale;
    utterance.rate = Number(state.settings.rate);
    utterance.pitch = 1;
    const voice = selectedVoice(languageId);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || utterance.lang;
    }
    let settled = false;
    let fallbackTimer = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallbackTimer);
      resolve();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    const estimatedMs = Math.max(2200, (text.length * 95) / Math.max(0.5, utterance.rate) + 1500);
    const scheduleFallback = () => {
      fallbackTimer = window.setTimeout(() => {
        if (token !== runToken) return finish();
        if (playback.status === "paused") return scheduleFallback();
        finish();
      }, estimatedMs);
    };
    scheduleFallback();
    if (token === runToken) window.speechSynthesis.speak(utterance);
    else finish();
  });
}

function pauseSpeech() {
  if (!canSpeak() || playback.status !== "playing") return;
  window.speechSynthesis.pause();
  playback.status = "paused";
  renderPlaybackControls();
  setStatus(`已暂停：${playback.label}`);
}

function resumeSpeech() {
  if (!canSpeak() || playback.status !== "paused") return;
  playback.status = "playing";
  window.speechSynthesis.resume();
  renderPlaybackControls();
  setStatus(`继续播放：${playback.label}`);
}

function stopSpeech() {
  runToken += 1;
  if (canSpeak()) window.speechSynthesis.cancel();
  clearActive();
  setBusy(false);
  playback = { status: "idle", key: "", label: "", token: 0 };
  renderPlaybackControls();
  setStatus("已停止");
}

function pause(milliseconds, token) {
  return new Promise((resolve) => {
    let remaining = milliseconds;
    let lastTick = Date.now();
    const tick = () => {
      if (token !== runToken) return resolve();
      if (playback.status === "paused") {
        lastTick = Date.now();
        window.setTimeout(tick, 120);
        return;
      }
      const now = Date.now();
      remaining -= now - lastTick;
      lastTick = now;
      if (remaining <= 0) return resolve();
      window.setTimeout(tick, Math.min(120, remaining));
    };
    tick();
  });
}

function openSaveCurrentDialog() {
  const text = state.currentText.trim();
  if (!text) {
    setStatus("没有可保存的文本");
    return;
  }
  ensureLibraryForSave();
  const tapeOptions = activeTapes().map((tape) => ({ value: tape.id, label: `${getAlbum(tape.albumId)?.title || "专辑"} / ${tape.title}` }));
  openDialog({
    title: "保存段落",
    submitText: "保存",
    fields: [
      { name: "title", label: "标题", type: "text", value: firstSentenceTitle(text), required: true },
      { name: "tapeId", label: "磁带", type: "select", value: state.ui.selectedTapeId || activeTapes()[0]?.id, options: tapeOptions, required: true },
      { name: "notes", label: "备注", type: "textarea", value: "" }
    ],
    onSubmit(values) {
      const entry = createEntry(values.tapeId, values.title, text, values.notes);
      state.activeEntryId = entry.id;
      state.ui.selectedAlbumId = getTape(entry.tapeId)?.albumId || state.ui.selectedAlbumId;
      state.ui.selectedTapeId = entry.tapeId;
      persist();
      renderAll();
      setStatus(t("library.saved"));
    }
  });
}

function openAlbumDialog(albumId) {
  const album = getAlbum(albumId);
  openDialog({
    title: album ? "编辑专辑" : "新建专辑",
    submitText: album ? "更新" : "创建",
    fields: [
      { name: "title", label: "标题", type: "text", value: album?.title || "", required: true },
      { name: "description", label: "描述", type: "textarea", value: album?.description || "" },
      { name: "coverColor", label: "封面色", type: "color", value: album?.coverColor || pickAlbumColor() }
    ],
    onSubmit(values) {
      if (album) {
        album.title = values.title.trim();
        album.description = values.description.trim();
        album.coverColor = values.coverColor;
        album.updatedAt = nowIso();
      } else {
        const created = createAlbum(values.title, values.description, values.coverColor);
        state.ui.selectedAlbumId = created.id;
        state.ui.selectedTapeId = createTape(created.id, t("library.defaultTape"), "").id;
      }
      persist();
      renderLibrary();
      renderMy();
    }
  });
}

function openTapeDialog(tapeId, albumId = state.ui.selectedAlbumId) {
  const tape = getTape(tapeId);
  const albumOptions = activeAlbums().map((album) => ({ value: album.id, label: album.title }));
  openDialog({
    title: tape ? "编辑磁带" : "新建磁带",
    submitText: tape ? "更新" : "创建",
    fields: [
      { name: "albumId", label: "专辑", type: "select", value: tape?.albumId || albumId, options: albumOptions, required: true },
      { name: "title", label: "标题", type: "text", value: tape?.title || "", required: true },
      { name: "description", label: "描述", type: "textarea", value: tape?.description || "" }
    ],
    onSubmit(values) {
      if (tape) {
        tape.albumId = values.albumId;
        tape.title = values.title.trim();
        tape.description = values.description.trim();
        tape.updatedAt = nowIso();
        state.ui.selectedAlbumId = values.albumId;
        state.ui.selectedTapeId = tape.id;
      } else {
        const created = createTape(values.albumId, values.title, values.description);
        state.ui.selectedAlbumId = values.albumId;
        state.ui.selectedTapeId = created.id;
      }
      persist();
      renderLibrary();
      renderMy();
    }
  });
}

function openEntryDialog(entryId, tapeId = state.ui.selectedTapeId) {
  const entry = getEntry(entryId);
  openDialog({
    title: entry ? "编辑段落" : "新建段落",
    submitText: entry ? "更新" : "创建",
    fields: [
      { name: "title", label: "标题", type: "text", value: entry?.title || "", required: true },
      { name: "text", label: elements.textInputLabel.textContent, type: "textarea", value: entry?.text || "", required: true },
      { name: "notes", label: "备注", type: "textarea", value: entry?.notes || "" }
    ],
    onSubmit(values) {
      if (entry) {
        entry.title = values.title.trim();
        entry.text = values.text.trim();
        entry.notes = values.notes.trim();
        entry.updatedAt = nowIso();
        if (state.activeEntryId === entry.id) setCurrentText(entry.text, entry.id, { skipPersist: true });
      } else {
        createEntry(tapeId, values.title, values.text, values.notes);
      }
      persist();
      renderAll();
    }
  });
}

function openWordbookDialog(wordbookId) {
  const wordbook = state.wordbooks.find((item) => item.id === wordbookId);
  openDialog({
    title: wordbook ? "编辑单词本" : "新建单词本",
    submitText: wordbook ? "更新" : "创建",
    fields: [
      { name: "title", label: "名称", type: "text", value: wordbook?.title || "", required: true },
      { name: "description", label: "描述", type: "textarea", value: wordbook?.description || "" }
    ],
    onSubmit(values) {
      if (wordbook) {
        wordbook.title = values.title.trim();
        wordbook.description = values.description.trim();
        wordbook.updatedAt = nowIso();
      } else {
        const created = createWordbook(values.title, values.description);
        state.ui.selectedWordbookId = created.id;
      }
      persist();
      renderWordbooks();
      renderVocab();
    }
  });
}

function openVocabDialog(vocabId) {
  const item = getVocabulary(vocabId);
  const seed = item || (selectedWord ? buildVocabularyItem(selectedWord.raw) : null);
  const currentWordbook = item?.wordbookIds?.[0] || selectedCustomWordbookId();
  const wordbookOptions = [{ value: "", label: "不放入自定义单词本" }, ...activeWordbooks().map((wordbook) => ({ value: wordbook.id, label: wordbook.title }))];
  openDialog({
    title: item ? "编辑单词" : "新建单词",
    submitText: item ? "更新" : "创建",
    fields: [
      { name: "word", label: `${languageName(activeStudyLanguageId(), activeNativeLanguageId())}词`, type: "text", value: seed?.word || "", required: true },
      { name: "ipa", label: "音标", type: "text", value: seed?.ipa || "" },
      { name: "meaning", label: `${languageName(activeNativeLanguageId(), activeNativeLanguageId())}释义`, type: "textarea", value: seed?.meaning || "" },
      { name: "wordbookId", label: "自定义单词本", type: "select", value: currentWordbook, options: wordbookOptions },
      { name: "status", label: "状态", type: "select", value: seed?.status || "new", options: [{ value: "new", label: "new" }, { value: "got", label: "got" }], required: true }
    ],
    onSubmit(values) {
      const info = resolveWordInfo(values.word);
      if (!info.lemma) return false;
      const wordbookIds = values.wordbookId ? [values.wordbookId] : [];
      const existing = activeVocabulary().find((word) => word.normalized === info.lemma && word.id !== item?.id);
      const target = existing || item || {
        id: makeId("word"),
        language: activeStudyLanguageId(),
        nativeLanguage: activeNativeLanguageId(),
        createdAt: nowIso()
      };
      target.word = values.word.trim();
      target.lemma = info.lemma;
      target.normalized = info.lemma;
      target.ipa = values.ipa.trim();
      target.meaning = values.meaning.trim();
      target.status = values.status === "got" ? "got" : "new";
      target.wordbookIds = wordbookIds;
      target.updatedAt = nowIso();
      trackSeenForm(target, values.word);
      if (!existing && !item) state.vocabulary.push(target);
      persist();
      renderWordbooks();
      renderVocab();
      renderSentences();
      renderWordPanel();
    }
  });
}

function openDialog({ title, submitText, fields, onSubmit }) {
  elements.dialogTitle.textContent = title;
  elements.dialogSubmitBtn.textContent = submitText;
  elements.dialogBody.replaceChildren();
  dialogSubmitHandler = onSubmit;
  fields.forEach((field) => {
    if (field.type === "static") {
      elements.dialogBody.append(el("p", "micro-copy", field.value || ""));
      return;
    }
    const wrapper = el("label", "dialog-field");
    wrapper.append(el("span", "field-label", field.label), createDialogInput(field));
    elements.dialogBody.append(wrapper);
  });
  if (typeof elements.dialog.showModal === "function") elements.dialog.showModal();
  else elements.dialog.setAttribute("open", "");
}

function createDialogInput(field) {
  if (field.type === "select") {
    const input = document.createElement("select");
    input.name = field.name;
    (field.options || []).forEach((option) => input.append(new Option(option.label, option.value)));
    input.value = field.value || "";
    input.required = Boolean(field.required);
    return input;
  }
  if (field.type === "textarea") {
    const input = document.createElement("textarea");
    input.name = field.name;
    input.value = field.value || "";
    input.required = Boolean(field.required);
    return input;
  }
  const input = document.createElement("input");
  input.type = field.type || "text";
  input.name = field.name;
  input.value = field.value || "";
  input.required = Boolean(field.required);
  input.className = "text-input";
  return input;
}

function collectDialogValues() {
  return Object.fromEntries(new FormData(elements.dialogForm).entries());
}

function closeDialog() {
  dialogSubmitHandler = null;
  if (typeof elements.dialog.close === "function") elements.dialog.close();
  else elements.dialog.removeAttribute("open");
}

function setAudioSettingsOpen(isOpen) {
  elements.audioSettingsPanel.hidden = !isOpen;
  elements.audioSettingsToggle.setAttribute("aria-expanded", String(isOpen));
  elements.audioSettingsToggle.classList.toggle("is-active", isOpen);
}

async function changeLanguagePair(next) {
  stopSpeech();
  const oldStudy = activeStudyLanguageId();
  state.profile = { ...state.profile, ...next };
  if (state.profile.nativeLanguage === state.profile.studyLanguage) {
    state.profile.studyLanguage = STUDY_LANGUAGE_IDS.find((id) => id !== state.profile.nativeLanguage) || "fr";
  }
  selectedWord = null;
  if (!state.currentText.trim() || state.currentText === LANGUAGES[oldStudy]?.sample) {
    state.currentText = activeLanguage().sample;
  }
  ensureSelections();
  populateLanguageSelectors();
  t = createTranslator(supportedUiLanguage(state.profile.nativeLanguage));
  await loadActiveLexicon();
  persist();
  renderAll();
}

function populateLanguageSelectors() {
  const ui = supportedUiLanguage(state.profile.nativeLanguage);
  fillSelect(elements.nativeLanguageSelect, NATIVE_LANGUAGE_IDS, ui);
  fillSelect(elements.studyLanguageSelect, STUDY_LANGUAGE_IDS, ui);
  elements.nativeLanguageSelect.value = state.profile.nativeLanguage;
  elements.studyLanguageSelect.value = state.profile.studyLanguage;
}

function fillSelect(select, languageIds, uiLanguageId) {
  select.replaceChildren();
  languageIds.forEach((languageId) => {
    select.append(new Option(languageName(languageId, uiLanguageId), languageId));
  });
}

async function loadActiveLexicon() {
  const pair = currentPair();
  activeLexicon = emptyLexicon(pair);
  try {
    const installed = await loadInstalledLexicon(pair);
    if (installed) {
      activeLexicon = installed;
    state.installedLexicons[pair] = {
      pair,
      entriesCount: installed.entriesCount,
      formsCount: installed.formsCount,
      installedAt: state.installedLexicons[pair]?.installedAt || nowIso(),
      version: installed.meta?.version || "",
      packageBuiltAt: installed.meta?.builtAt || state.installedLexicons[pair]?.packageBuiltAt || "",
      packageBytes: state.installedLexicons[pair]?.packageBytes || 0
    };
      setStatus(t("lexicon.loaded", { count: installed.entriesCount }));
    }
  } catch {
    delete state.installedLexicons[pair];
  }
}

async function installActiveLexicon() {
  const pair = currentPair();
  const packageInfo = lexiconPackages.get(pair);
  if (!packageInfo) {
    setStatus(t("lexicon.noPackage"));
    return;
  }
  elements.lexiconProgress.hidden = false;
  elements.lexiconProgress.value = 2;
  elements.lexiconActionBtn.disabled = true;
  elements.lexiconBadge.textContent = t("lexicon.downloading");
  try {
    activeLexicon = await downloadLexiconPackage(packageInfo, (progress) => {
      elements.lexiconProgress.value = progress;
      elements.lexiconDescription.textContent = `${progress}%`;
    });
    state.installedLexicons[pair] = {
      pair,
      entriesCount: activeLexicon.entriesCount,
      formsCount: activeLexicon.formsCount,
      version: activeLexicon.meta?.version || "",
      packageBuiltAt: packageInfo.builtAt || activeLexicon.meta?.builtAt || "",
      packageBytes: packageInfo.bytes || 0,
      installedAt: nowIso()
    };
    persist();
    setStatus(t("lexicon.loaded", { count: activeLexicon.entriesCount }));
  } catch {
    setStatus(t("lexicon.failed"));
  } finally {
    elements.lexiconProgress.hidden = true;
    elements.lexiconActionBtn.disabled = false;
    renderAll();
  }
}

async function deleteActiveLexicon() {
  const pair = currentPair();
  await deleteLexiconPackage(pair);
  delete state.installedLexicons[pair];
  activeLexicon = emptyLexicon(pair);
  persist();
  renderAll();
  setStatus(t("lexicon.deleted"));
}

function renderLexiconPanel() {
  const pair = currentPair();
  const packageInfo = lexiconPackages.get(pair);
  const installed = state.installedLexicons[pair];
  const studyName = languageName(activeStudyLanguageId(), activeNativeLanguageId());
  const nativeName = languageName(activeNativeLanguageId(), activeNativeLanguageId());
  elements.lexiconDeleteBtn.disabled = !installed;
  if (installed) {
    const isStale = isInstalledLexiconStale(installed, packageInfo);
    elements.lexiconBadge.textContent = isStale ? t("lexicon.updateAvailable") : t("lexicon.installed");
    elements.lexiconActionBtn.disabled = false;
    elements.lexiconActionBtn.querySelector("span").textContent = isStale ? t("lexicon.update") : "重新下载";
    const staleText = isStale ? ` · ${t("lexicon.outdated")}` : "";
    elements.lexiconDescription.textContent = `${studyName} → ${nativeName} · ${installed.entriesCount || 0} 词条 · ${installed.formsCount || 0} 词形${staleText}`;
    return;
  }
  elements.lexiconActionBtn.querySelector("span").textContent = t("lexicon.download");
  if (!packageInfo) {
    elements.lexiconBadge.textContent = t("lexicon.unavailable");
    elements.lexiconActionBtn.disabled = true;
    elements.lexiconDescription.textContent = `还没有 ${studyName} → ${nativeName} 的词库配置。`;
    return;
  }
  elements.lexiconBadge.textContent = packageInfo.status === "ready" ? t("lexicon.notInstalled") : t("lexicon.unavailable");
  elements.lexiconActionBtn.disabled = packageInfo.status !== "ready";
  elements.lexiconDescription.textContent = packageInfo.status === "ready"
    ? `${studyName} → ${nativeName}，默认不下载，点击后安装到本机。`
    : `${studyName} → ${nativeName} 词库需先运行 scripts/build_lexicons.py 生成；发布前不能留在这个状态。`;
}

function isInstalledLexiconStale(installed, packageInfo) {
  if (!installed || !packageInfo || packageInfo.status !== "ready") return false;
  if (!installed.packageBuiltAt) return true;
  if (packageInfo.builtAt && installed.packageBuiltAt !== packageInfo.builtAt) return true;
  if (packageInfo.entries && Number(installed.entriesCount || 0) !== Number(packageInfo.entries)) return true;
  if (packageInfo.forms && Number(installed.formsCount || 0) !== Number(packageInfo.forms)) return true;
  return false;
}

function renderVoiceControls() {
  fillVoiceSelect(elements.studyVoiceSelect, activeStudyLanguageId());
  fillVoiceSelect(elements.myStudyVoiceSelect, activeStudyLanguageId());
  fillVoiceSelect(elements.nativeVoiceSelect, activeNativeLanguageId());
}

function fillVoiceSelect(select, languageId) {
  if (!canSpeak()) {
    select.replaceChildren(new Option("不可用", ""));
    return;
  }
  const language = LANGUAGES[languageId];
  const voices = voicesForLanguage(languageId).sort((a, b) => voiceScore(b, languageId) - voiceScore(a, languageId));
  const current = state.voices[languageId]?.key || state.voices[languageId]?.name || "";
  select.replaceChildren(new Option(`系统默认（${language.locale}）`, ""));
  voices.forEach((voice) => {
    const label = `${voice.name} · ${voice.lang || "unknown"}${isLikelyNaturalVoice(voice) ? " · 推荐" : ""}`;
    select.append(new Option(label, voiceKey(voice)));
  });
  const currentVoice = voices.find((voice) => voiceKey(voice) === current) || voices.find((voice) => voice.name === current);
  if (currentVoice) {
    select.value = voiceKey(currentVoice);
    if (state.voices[languageId]?.key !== voiceKey(currentVoice)) {
      state.voices[languageId] = {
        ...state.voices[languageId],
        key: voiceKey(currentVoice),
        name: currentVoice.name,
        lang: currentVoice.lang || ""
      };
    }
  } else {
    const preferred = preferredDefaultVoice(languageId);
    select.value = preferred ? voiceKey(preferred) : "";
    if (!state.voices[languageId]?.locked) {
      state.voices[languageId] = { key: select.value, name: preferred?.name || "", lang: preferred?.lang || "", locked: false };
    }
  }
}

function loadVoices() {
  allVoices = canSpeak() ? window.speechSynthesis.getVoices() : [];
}

async function refreshVoices(options = {}) {
  if (!canSpeak()) {
    renderVoiceControls();
    return;
  }
  for (let attempt = 0; attempt < VOICE_SCAN_ATTEMPTS; attempt += 1) {
    loadVoices();
    if (allVoices.length > 0) break;
    await wait(180);
  }
  renderVoiceControls();
  if (!options.quiet) {
    const studyCount = voicesForLanguage(activeStudyLanguageId()).length;
    const nativeCount = voicesForLanguage(activeNativeLanguageId()).length;
    setStatus(`已刷新语音：学习语言 ${studyCount} 个，母语 ${nativeCount} 个`);
  }
}

function voicesForLanguage(languageId) {
  const localePrefix = LANGUAGES[languageId]?.locale.split("-")[0] || languageId;
  return allVoices.filter((voice) => matchesVoiceLanguage(voice, languageId));
}

function matchesVoiceLanguage(voice, languageId) {
  const language = LANGUAGES[languageId];
  const localePrefix = language?.locale.split("-")[0] || languageId;
  if (new RegExp(`^${localePrefix}([-_]|$)`, "i").test(voice.lang || "")) return true;
  const haystack = `${voice.name || ""} ${voice.voiceURI || ""} ${voice.lang || ""}`.toLowerCase();
  return (language?.voiceAliases || []).some((alias) => haystack.includes(String(alias).toLowerCase()));
}

function preferredDefaultVoice(languageId) {
  const voices = voicesForLanguage(languageId);
  const preferredNames = LANGUAGES[languageId]?.defaultVoices || [];
  for (const preferred of preferredNames) {
    const voice = voices.find((item) => item.name.toLowerCase() === preferred.toLowerCase())
      || voices.find((item) => item.name.toLowerCase().includes(preferred.toLowerCase()));
    if (voice) return voice;
  }
  const locale = LANGUAGES[languageId]?.locale.toLowerCase();
  return voices
    .slice()
    .sort((a, b) => voiceScore(b, languageId) - voiceScore(a, languageId))
    .find((voice) => (voice.lang || "").toLowerCase() === locale)
    || voices.slice().sort((a, b) => voiceScore(b, languageId) - voiceScore(a, languageId))[0]
    || null;
}

function selectedVoice(languageId) {
  const saved = state.voices[languageId] || {};
  return voicesForLanguage(languageId).find((voice) => voiceKey(voice) === saved.key)
    || voicesForLanguage(languageId).find((voice) => voice.name === saved.name)
    || preferredDefaultVoice(languageId);
}

function setVoiceForLanguage(languageId, key) {
  const voice = voicesForLanguage(languageId).find((item) => voiceKey(item) === key);
  state.voices[languageId] = { key, name: voice?.name || key || "", lang: voice?.lang || "", locked: Boolean(key) };
  persist();
  renderVoiceControls();
}

function preferNaturalVoices() {
  [activeStudyLanguageId(), activeNativeLanguageId()].forEach((languageId) => {
    const voice = preferredDefaultVoice(languageId);
    state.voices[languageId] = {
      key: voice ? voiceKey(voice) : "",
      name: voice?.name || "",
      lang: voice?.lang || "",
      locked: false
    };
  });
  persist();
  renderVoiceControls();
  setStatus("已切换为推荐自然语音");
}

function voiceKey(voice) {
  return `${voice.name || ""}|||${voice.lang || ""}`;
}

function voiceScore(voice, languageId) {
  const name = String(voice.name || "").toLowerCase();
  const uri = String(voice.voiceURI || "").toLowerCase();
  const text = `${name} ${uri}`;
  const preferred = LANGUAGES[languageId]?.defaultVoices || [];
  let score = 0;
  preferred.forEach((needle, index) => {
    if (name === needle.toLowerCase()) score += 180 - index;
    else if (name.includes(needle.toLowerCase())) score += 120 - index;
  });
  if (/online/.test(text)) score += 60;
  if (/natural|neural/.test(text)) score += 80;
  if (/microsoft/.test(text)) score += 24;
  if (/google/.test(text)) score += 18;
  if (/compact|eloquence|novelty/.test(text)) score -= 60;
  if (voice.localService === false) score += 6;
  return score;
}

function isLikelyNaturalVoice(voice) {
  const text = `${voice.name || ""} ${voice.voiceURI || ""}`.toLowerCase();
  return /natural|neural|online/.test(text);
}

function addWordToVocabulary(rawWord) {
  const item = ensureVocabularyItem(rawWord);
  trackSeenForm(item, rawWord);
  const selectedBookId = selectedCustomWordbookId();
  if (selectedBookId) addVocabularyToWordbook(item, selectedBookId);
  return item;
}

function ensureVocabularyItem(rawWord) {
  const existing = findVocabulary(rawWord);
  if (existing) return existing;
  const item = buildVocabularyItem(rawWord);
  state.vocabulary.push(item);
  return item;
}

function buildVocabularyItem(rawWord) {
  const info = resolveWordInfo(rawWord);
  const hint = info.lexicon || lookupLexicon(rawWord);
  return {
    id: makeId("word"),
    language: activeStudyLanguageId(),
    nativeLanguage: activeNativeLanguageId(),
    word: hint?.word || rawWord.trim(),
    lemma: info.lemma,
    normalized: info.lemma,
    ipa: hint?.ipa || "",
    meaning: hint?.meaning || "",
    status: "new",
    wordbookIds: selectedCustomWordbookId() ? [selectedCustomWordbookId()] : [],
    seenForms: [{ form: rawWord.trim(), normalized: info.normalized, count: 1 }],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function addVocabularyToWordbook(item, wordbookId) {
  if (!wordbookId) return;
  if (!Array.isArray(item.wordbookIds)) item.wordbookIds = [];
  if (!item.wordbookIds.includes(wordbookId)) {
    item.wordbookIds.push(wordbookId);
    item.updatedAt = nowIso();
  }
}

function toggleVocabularyStatus(vocabId) {
  const item = getVocabulary(vocabId);
  if (!item) return;
  item.status = item.status === "got" ? "new" : "got";
  item.updatedAt = nowIso();
  persist();
  renderWordbooks();
  renderVocab();
  renderSentences();
  renderWordPanel();
}

function deleteVocabulary(vocabId) {
  const item = getVocabulary(vocabId);
  if (!item || !window.confirm(`删除单词「${item.word}」？`)) return;
  state.vocabulary = state.vocabulary.filter((word) => word.id !== vocabId);
  if (selectedWord && resolveWordInfo(selectedWord.raw).lemma === item.normalized) selectedWord = null;
  persist();
  renderWordbooks();
  renderVocab();
  renderSentences();
  renderWordPanel();
}

function findVocabulary(rawWord) {
  const info = resolveWordInfo(rawWord);
  return activeVocabulary().find((item) => item.normalized === info.lemma || item.lemma === info.lemma) || null;
}

function getVocabulary(vocabId) {
  return state.vocabulary.find((item) => item.id === vocabId) || null;
}

function lookupLexicon(rawWord) {
  const normalized = normalizeWord(rawWord);
  const candidates = wordLookupCandidates(normalized);
  return candidates.map((candidate) => activeLexicon.entries[candidate]).find(Boolean) || null;
}

function resolveWordInfo(rawWord) {
  const normalized = normalizeWord(rawWord);
  const candidates = wordLookupCandidates(normalized);
  const direct = activeLexicon.entries[normalized];
  const directHasMeaning = Boolean(direct?.meaning);
  const mappedLemma = directHasMeaning ? "" : candidates.map((candidate) => activeLexicon.forms[candidate]).find(Boolean);
  const fallbackLemma = directHasMeaning ? "" : candidates.map((candidate) => singularFallback(candidate)).find(Boolean);
  const directCandidate = candidates.map((candidate) => activeLexicon.entries[candidate] ? candidate : "").find(Boolean);
  const lemma = directHasMeaning ? normalized : mappedLemma || fallbackLemma || directCandidate || normalized;
  return {
    raw: rawWord,
    normalized,
    lemma,
    lexicon: activeLexicon.entries[lemma] || direct || candidates.map((candidate) => activeLexicon.entries[candidate]).find(Boolean) || null,
    formLexicon: direct || null
  };
}

function wordLookupCandidates(normalized) {
  const candidates = [];
  const add = (candidate) => {
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  };
  add(normalized);
  add(elidedCore(normalized));
  if (!isCjkLanguage(activeStudyLanguageId())) {
    add(normalized.replace(/['-]/g, ""));
    add(normalized.replace(/['-]/g, "_"));
    normalized.split(/['-]/).filter(Boolean).reverse().forEach(add);
  }
  return candidates;
}

function elidedCore(normalized) {
  if (activeStudyLanguageId() !== "fr") return "";
  const parts = normalized.split("'").filter(Boolean);
  if (parts.length < 2) return "";
  if (!ELIDED_PREFIXES.has(parts[0])) return "";
  return parts.slice(1).join("'");
}

function singularFallback(normalized) {
  if (isCjkLanguage(activeStudyLanguageId()) || normalized.length <= 3) return "";
  if (normalized.endsWith("aux") && activeLexicon.entries[`${normalized.slice(0, -3)}al`]) return `${normalized.slice(0, -3)}al`;
  if (normalized.endsWith("x") && activeLexicon.entries[normalized.slice(0, -1)]) return normalized.slice(0, -1);
  if (normalized.endsWith("s") && activeLexicon.entries[normalized.slice(0, -1)]) return normalized.slice(0, -1);
  return "";
}

function trackSeenForm(item, rawWord) {
  const normalized = normalizeWord(rawWord);
  if (!normalized) return;
  if (!Array.isArray(item.seenForms)) item.seenForms = [];
  const existing = item.seenForms.find((entry) => entry.normalized === normalized);
  if (existing) {
    existing.count = Number(existing.count || 0) + 1;
    existing.form = rawWord.trim() || existing.form;
  } else {
    item.seenForms.push({ form: rawWord.trim(), normalized, count: 1 });
  }
  item.updatedAt = nowIso();
}

function seenFormsText(item) {
  if (!Array.isArray(item.seenForms)) return "";
  return item.seenForms
    .filter((entry) => entry.normalized && entry.normalized !== item.normalized)
    .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
    .slice(0, 6)
    .map((entry) => `${entry.form || entry.normalized}${entry.count > 1 ? `×${entry.count}` : ""}`)
    .join("、");
}

function normalizeWord(word) {
  return normalizeWordForLanguage(word, activeStudyLanguageId());
}

function normalizeWordForLanguage(word, languageId) {
  const language = LANGUAGES[languageId] || LANGUAGES.fr;
  const value = String(word || "").toLocaleLowerCase(language.locale).replace(/[’]/g, "'");
  if (isCjkLanguage(languageId)) {
    return value.normalize("NFKC").replace(/[^\p{L}\p{N}ー々〆ヶ가-힣ぁ-んァ-ン一-龯]/gu, "");
  }
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}'-]/gu, "")
    .replace(/^['-]+|['-]+$/g, "");
}

function normalizeSearch(value) {
  return String(value || "")
    .toLocaleLowerCase(activeLanguage().locale)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function tokenizeWithOffsets(text) {
  if (isCjkLanguage(activeStudyLanguageId()) && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(activeLanguage().locale, { granularity: "word" });
    return Array.from(segmenter.segment(text))
      .filter((segment) => segment.isWordLike && normalizeWord(segment.segment))
      .map((segment) => ({ text: segment.segment, index: segment.index }));
  }
  const pattern = isCjkLanguage(activeStudyLanguageId())
    ? /[\p{L}\p{N}ー々〆ヶ가-힣ぁ-んァ-ン一-龯]+/gu
    : new RegExp(WORD_PATTERN_SOURCE, "gu");
  return Array.from(text.matchAll(pattern)).map((match) => ({ text: match[0], index: match.index }));
}

function splitSentences(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) return [];
      if (!isCjkLanguage(activeStudyLanguageId())) return [trimmed];
      return trimmed.match(/[^。！？!?]+[。！？!?]?/g)?.map((item) => item.trim()).filter(Boolean) || [trimmed];
    });
}

function countWords(text) {
  return tokenizeWithOffsets(String(text || "")).length;
}

function getWordbook(wordbookId) {
  return SYSTEM_WORDBOOKS.find((book) => book.id === wordbookId) || activeWordbooks().find((book) => book.id === wordbookId) || null;
}

function isSystemWordbook(wordbookId) {
  return SYSTEM_WORDBOOKS.some((book) => book.id === wordbookId);
}

function isKnownWordbookId(wordbookId) {
  return isSystemWordbook(wordbookId) || activeWordbooks().some((book) => book.id === wordbookId);
}

function vocabularyForWordbook(wordbookId) {
  return activeVocabulary().filter((item) => vocabularyMatchesWordbook(item, wordbookId));
}

function vocabularyMatchesWordbook(item, wordbookId) {
  if (!wordbookId || wordbookId === ALL_WORDBOOK_ID) return true;
  if (wordbookId === NEW_WORDBOOK_ID) return item.status !== "got";
  if (wordbookId === GOT_WORDBOOK_ID) return item.status === "got";
  if (wordbookId === DIY_WORDBOOK_ID) return isDiyVocabulary(item);
  return Array.isArray(item.wordbookIds) && item.wordbookIds.includes(wordbookId);
}

function isDiyVocabulary(item) {
  return !String(item.ipa || "").trim() || !String(item.meaning || "").trim();
}

function wordbookNamesText(item) {
  const names = [];
  if (isDiyVocabulary(item)) names.push("DIY");
  (item.wordbookIds || []).forEach((id) => {
    const book = activeWordbooks().find((wordbook) => wordbook.id === id);
    if (book) names.push(book.title);
  });
  return names.join("、");
}

function selectedCustomWordbookId() {
  const selected = state.ui.selectedWordbookId;
  return activeWordbooks().some((book) => book.id === selected) ? selected : "";
}

function activeStudyLanguageId() {
  return state.profile.studyLanguage || "fr";
}

function activeNativeLanguageId() {
  return state.profile.nativeLanguage || "zh";
}

function activeLanguage() {
  return LANGUAGES[activeStudyLanguageId()] || LANGUAGES.fr;
}

function currentPair() {
  return activePair(activeStudyLanguageId(), activeNativeLanguageId());
}

function activeAlbums() {
  return state.albums.filter((album) => album.language === activeStudyLanguageId());
}

function activeTapes() {
  const albumIds = new Set(activeAlbums().map((album) => album.id));
  return state.tapes.filter((tape) => albumIds.has(tape.albumId));
}

function activeVocabulary() {
  return state.vocabulary.filter((item) => item.language === activeStudyLanguageId() && item.nativeLanguage === activeNativeLanguageId());
}

function activeWordbooks() {
  return state.wordbooks.filter((item) => item.language === activeStudyLanguageId() && item.nativeLanguage === activeNativeLanguageId());
}

function createAlbum(title, description = "", coverColor = pickAlbumColor()) {
  const timestamp = nowIso();
  const album = {
    id: makeId("album"),
    language: activeStudyLanguageId(),
    title: title.trim(),
    description: description.trim(),
    coverColor,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  state.albums.push(album);
  return album;
}

function createTape(albumId, title, description = "") {
  const timestamp = nowIso();
  const tape = {
    id: makeId("tape"),
    albumId,
    title: title.trim(),
    description: description.trim(),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  state.tapes.push(tape);
  return tape;
}

function createEntry(tapeId, title, text, notes = "") {
  const timestamp = nowIso();
  const entry = {
    id: makeId("entry"),
    tapeId,
    title: title.trim(),
    text: text.trim(),
    notes: notes.trim(),
    practiceCount: 0,
    lastPracticedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  state.entries.push(entry);
  return entry;
}

function createWordbook(title, description = "") {
  const timestamp = nowIso();
  const wordbook = {
    id: makeId("wordbook"),
    language: activeStudyLanguageId(),
    nativeLanguage: activeNativeLanguageId(),
    title: title.trim(),
    description: description.trim(),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  state.wordbooks.push(wordbook);
  return wordbook;
}

function deleteAlbum(albumId) {
  const album = getAlbum(albumId);
  if (!album || !window.confirm(`删除专辑「${album.title}」？`)) return;
  const tapeIds = getTapes(albumId).map((tape) => tape.id);
  state.albums = state.albums.filter((item) => item.id !== albumId);
  state.tapes = state.tapes.filter((item) => item.albumId !== albumId);
  state.entries = state.entries.filter((item) => !tapeIds.includes(item.tapeId));
  ensureSelections();
  persist();
  renderAll();
}

function deleteTape(tapeId) {
  const tape = getTape(tapeId);
  if (!tape || !window.confirm(`删除磁带「${tape.title}」？`)) return;
  state.tapes = state.tapes.filter((item) => item.id !== tapeId);
  state.entries = state.entries.filter((item) => item.tapeId !== tapeId);
  ensureSelections();
  persist();
  renderAll();
}

function deleteEntry(entryId) {
  const entry = getEntry(entryId);
  if (!entry || !window.confirm(`删除段落「${entry.title}」？`)) return;
  state.entries = state.entries.filter((item) => item.id !== entryId);
  if (state.activeEntryId === entryId) state.activeEntryId = null;
  persist();
  renderAll();
}

function deleteWordbook(wordbookId) {
  const wordbook = state.wordbooks.find((item) => item.id === wordbookId);
  if (!wordbook || !window.confirm(`删除单词本「${wordbook.title}」？`)) return;
  state.wordbooks = state.wordbooks.filter((item) => item.id !== wordbookId);
  state.vocabulary.forEach((item) => {
    item.wordbookIds = (item.wordbookIds || []).filter((id) => id !== wordbookId);
  });
  if (state.ui.selectedWordbookId === wordbookId) state.ui.selectedWordbookId = ALL_WORDBOOK_ID;
  persist();
  renderWordbooks();
  renderVocab();
}

function getAlbum(albumId) {
  return state.albums.find((album) => album.id === albumId) || null;
}

function getTape(tapeId) {
  return state.tapes.find((tape) => tape.id === tapeId) || null;
}

function getEntry(entryId) {
  return state.entries.find((entry) => entry.id === entryId) || null;
}

function getTapes(albumId) {
  return state.tapes.filter((tape) => tape.albumId === albumId);
}

function getEntries(tapeId) {
  return state.entries.filter((entry) => entry.tapeId === tapeId);
}

function getEntriesByAlbum(albumId) {
  const tapeIds = getTapes(albumId).map((tape) => tape.id);
  return state.entries.filter((entry) => tapeIds.includes(entry.tapeId));
}

function loadEntry(entryId) {
  const entry = getEntry(entryId);
  if (!entry) return;
  const tape = getTape(entry.tapeId);
  state.ui.selectedTapeId = entry.tapeId;
  state.ui.selectedAlbumId = tape?.albumId || state.ui.selectedAlbumId;
  state.ui.activeView = "reader";
  setCurrentText(entry.text, entry.id, { skipPersist: true });
  persist();
  renderAll();
  setStatus(`已打开：${entry.title}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setCurrentText(text, entryId, options = {}) {
  state.currentText = text;
  state.activeEntryId = entryId;
  selectedWord = null;
  syncInput();
  renderActiveEntryLine();
  renderSentences();
  renderWordPanel();
  if (!options.skipPersist) persist();
}

function recordPracticeIfEntry() {
  const entry = getEntry(state.activeEntryId);
  if (!entry) return;
  entry.practiceCount = Number(entry.practiceCount || 0) + 1;
  entry.lastPracticedAt = nowIso();
  entry.updatedAt = nowIso();
  persist();
  renderActiveEntryLine();
  renderLibrary();
}

function ensureSelections() {
  if (!activeAlbums().some((album) => album.id === state.ui.selectedAlbumId)) state.ui.selectedAlbumId = activeAlbums()[0]?.id || null;
  if (!state.ui.selectedAlbumId) ensureLibraryForSave();
  if (!getTape(state.ui.selectedTapeId) || getTape(state.ui.selectedTapeId)?.albumId !== state.ui.selectedAlbumId) {
    state.ui.selectedTapeId = getTapes(state.ui.selectedAlbumId)[0]?.id || null;
  }
  if (!isKnownWordbookId(state.ui.selectedWordbookId)) state.ui.selectedWordbookId = ALL_WORDBOOK_ID;
}

function ensureLibraryForSave() {
  if (activeAlbums().length === 0) {
    const language = languageName(activeStudyLanguageId(), activeNativeLanguageId());
    const album = createAlbum(t("library.defaultAlbum", { language }), t("library.defaultAlbumDescription", { language }), "#0a6b61");
    const tape = createTape(album.id, t("library.defaultTape"), "");
    state.ui.selectedAlbumId = album.id;
    state.ui.selectedTapeId = tape.id;
  } else if (activeTapes().length === 0) {
    const albumId = state.ui.selectedAlbumId || activeAlbums()[0].id;
    const tape = createTape(albumId, t("library.defaultTape"), "");
    state.ui.selectedAlbumId = albumId;
    state.ui.selectedTapeId = tape.id;
  }
}

function syncInput() {
  if (elements.input.value !== state.currentText) elements.input.value = state.currentText;
}

function syncSettingsControls() {
  elements.rateControl.value = state.settings.rate;
  elements.pauseControl.value = state.settings.pause;
  setRepeat(state.settings.repeat);
}

function updateLabels() {
  elements.rateLabel.textContent = `${Number(state.settings.rate).toFixed(2)}x`;
  elements.pauseLabel.textContent = `${Number(state.settings.pause).toFixed(1)}s`;
}

function setRepeat(value) {
  elements.repeatGroup.querySelectorAll("button[data-repeat]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.repeat === value));
  });
}

function getRepeat() {
  const selected = elements.repeatGroup.querySelector('button[data-repeat][aria-pressed="true"]');
  return Number(selected?.dataset.repeat || state.settings.repeat || "1");
}

function getPauseMs() {
  return Number(state.settings.pause) * 1000;
}

function playbackKeyForItems(items) {
  const first = items.find((item) => item?.text?.trim());
  return first ? `text:${normalizeWord(first.text).slice(0, 32)}:${items.length}` : "empty";
}

function isActivePlayback(key) {
  return playback.key === key && (playback.status === "playing" || playback.status === "paused");
}

function markActive(element) {
  clearActive();
  if (!element) return;
  activeElement = element;
  activeElement.classList.add("is-active");
  activeElement.closest?.(".sentence-row")?.classList.add("is-active");
  activeElement.closest?.(".sentence-row")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function clearActive() {
  if (!activeElement) return;
  activeElement.classList.remove("is-active");
  activeElement.closest?.(".sentence-row")?.classList.remove("is-active");
  activeElement = null;
}

function setBusy(isBusy) {
  document.body.classList.toggle("is-playing", isBusy);
}

function renderPlaybackControls() {
  renderReaderPlayButton();
  renderSentencePlayButtons();
  renderWordPlayButton();
}

function renderReaderPlayButton() {
  const key = "reader:all";
  if (playback.key === key && playback.status === "playing") {
    setButtonContent(elements.playAllReader, "pause", "暂停");
  } else if (playback.key === key && playback.status === "paused") {
    setButtonContent(elements.playAllReader, "play", "继续");
  } else {
    setButtonContent(elements.playAllReader, "play", t("reader.playAll"));
  }
  elements.stopReader.disabled = playback.status === "idle";
}

function renderSentencePlayButtons() {
  elements.sentenceList.querySelectorAll(".sentence-play").forEach((button) => {
    const key = button.dataset.playbackKey;
    if (playback.key === key && playback.status === "playing") button.innerHTML = icons.pause;
    else if (playback.key === key && playback.status === "paused") button.innerHTML = icons.play;
    else button.innerHTML = icons.speaker;
  });
}

function renderWordPlayButton() {
  if (!selectedWord) {
    elements.wordPlayBtn.innerHTML = icons.speaker;
    return;
  }
  const key = `word:${selectedWord.normalized}`;
  if (playback.key === key && playback.status === "playing") elements.wordPlayBtn.innerHTML = icons.pause;
  else if (playback.key === key && playback.status === "paused") elements.wordPlayBtn.innerHTML = icons.play;
  else elements.wordPlayBtn.innerHTML = icons.speaker;
}

function setButtonContent(buttonNode, iconName, label) {
  buttonNode.replaceChildren();
  buttonNode.insertAdjacentHTML("beforeend", icons[iconName] || "");
  buttonNode.append(el("span", "", label));
}

function canSpeak() {
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

function setStatus(text) {
  elements.statusLine.textContent = text;
}

function setBootStatus(text) {
  if (elements.bootStatus) elements.bootStatus.textContent = text;
}

function exportData() {
  downloadJson(state, `multape-backup-${dateStamp()}.json`);
}

function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const imported = JSON.parse(String(reader.result || "{}"));
      state = ensureStateShape(imported);
      selectedWord = null;
      t = createTranslator(supportedUiLanguage(state.profile.nativeLanguage));
      populateLanguageSelectors();
      syncSettingsControls();
      loadActiveLexicon().finally(() => {
        persist();
        renderAll();
        setStatus(t("backup.imported"));
      });
    } catch {
      setStatus(t("backup.failed"));
    } finally {
      elements.importFile.value = "";
    }
  });
  reader.readAsText(file);
}

function downloadJson(data, filename) {
  const payload = JSON.stringify(data, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function loadAppState() {
  const saved = await readJson(APP_STORAGE_KEY);
  return saved ? ensureStateShape(saved) : createStarterState();
}

async function applySyncedSettings() {
  const synced = await storageDriver.getSync(SYNC_STORAGE_KEY);
  if (!synced?.settings) return;
  state.settings = { ...state.settings, ...synced.settings };
}

function ensureStateShape(raw) {
  const fallback = createStarterState();
  const stateLike = raw && typeof raw === "object" ? raw : {};
  const profile = {
    nativeLanguage: LANGUAGES[stateLike.profile?.nativeLanguage] ? stateLike.profile.nativeLanguage : "zh",
    studyLanguage: STUDY_LANGUAGE_IDS.includes(stateLike.profile?.studyLanguage) ? stateLike.profile.studyLanguage : "fr"
  };
  const next = {
    version: 1,
    profile,
    currentText: String(stateLike.currentText || LANGUAGES[profile.studyLanguage].sample),
    activeEntryId: stateLike.activeEntryId || null,
    ui: {
      activeView: ["reader", "library", "vocab", "my"].includes(stateLike.ui?.activeView) ? stateLike.ui.activeView : "reader",
      selectedAlbumId: stateLike.ui?.selectedAlbumId || null,
      selectedTapeId: stateLike.ui?.selectedTapeId || null,
      selectedWordbookId: stateLike.ui?.selectedWordbookId || ALL_WORDBOOK_ID
    },
    settings: {
      rate: stateLike.settings?.rate || fallback.settings.rate,
      pause: stateLike.settings?.pause || fallback.settings.pause,
      repeat: stateLike.settings?.repeat || fallback.settings.repeat
    },
    voices: normalizeVoiceMap(stateLike.voices || {}),
    installedLexicons: stateLike.installedLexicons && typeof stateLike.installedLexicons === "object" ? stateLike.installedLexicons : {},
    albums: Array.isArray(stateLike.albums) ? stateLike.albums.map(normalizeAlbum).filter(Boolean) : fallback.albums,
    tapes: Array.isArray(stateLike.tapes) ? stateLike.tapes.map(normalizeTape).filter(Boolean) : fallback.tapes,
    entries: Array.isArray(stateLike.entries) ? stateLike.entries.map(normalizeEntry).filter(Boolean) : fallback.entries,
    wordbooks: Array.isArray(stateLike.wordbooks) ? stateLike.wordbooks.map(normalizeWordbook).filter(Boolean) : [],
    vocabulary: Array.isArray(stateLike.vocabulary) ? normalizeVocabularyList(stateLike.vocabulary) : []
  };
  next.tapes = next.tapes.filter((tape) => next.albums.some((album) => album.id === tape.albumId));
  next.entries = next.entries.filter((entry) => next.tapes.some((tape) => tape.id === entry.tapeId));
  return next;
}

function createStarterState() {
  const timestamp = nowIso();
  const albumId = makeId("album");
  const tapeId = makeId("tape");
  const entryId = makeId("entry");
  const language = LANGUAGES.fr;
  return {
    version: 1,
    profile: {
      nativeLanguage: "zh",
      studyLanguage: "fr"
    },
    currentText: language.sample,
    activeEntryId: null,
    ui: {
      activeView: "reader",
      selectedAlbumId: albumId,
      selectedTapeId: tapeId,
      selectedWordbookId: ALL_WORDBOOK_ID
    },
    settings: {
      rate: "0.85",
      pause: "0.4",
      repeat: "1"
    },
    voices: {},
    installedLexicons: {},
    albums: [{
      id: albumId,
      language: "fr",
      title: "法语练习",
      description: "从这里开始保存外语段落",
      coverColor: "#0a6b61",
      createdAt: timestamp,
      updatedAt: timestamp
    }],
    tapes: [{
      id: tapeId,
      albumId,
      title: "第一盘磁带",
      description: "常用句子和朗读练习",
      createdAt: timestamp,
      updatedAt: timestamp
    }],
    entries: [{
      id: entryId,
      tapeId,
      title: "示例段落",
      text: language.sample,
      notes: "",
      practiceCount: 0,
      lastPracticedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    }],
    wordbooks: [],
    vocabulary: []
  };
}

function normalizeVoiceMap(raw) {
  return Object.fromEntries(Object.entries(raw || {}).map(([languageId, value]) => [
    languageId,
    {
      key: String(value?.key || value?.name || ""),
      name: String(value?.name || ""),
      lang: String(value?.lang || ""),
      locked: Boolean(value?.locked)
    }
  ]));
}

function normalizeAlbum(album) {
  if (!album?.id || !album?.title) return null;
  return {
    id: String(album.id),
    language: STUDY_LANGUAGE_IDS.includes(album.language) ? album.language : "fr",
    title: String(album.title),
    description: String(album.description || ""),
    coverColor: album.coverColor || pickAlbumColor(),
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
    practiceCount: Number(entry.practiceCount || 0),
    lastPracticedAt: entry.lastPracticedAt || null,
    createdAt: entry.createdAt || nowIso(),
    updatedAt: entry.updatedAt || nowIso()
  };
}

function normalizeWordbook(wordbook) {
  if (!wordbook?.title || isSystemWordbook(wordbook.id)) return null;
  return {
    id: wordbook.id ? String(wordbook.id) : makeId("wordbook"),
    language: STUDY_LANGUAGE_IDS.includes(wordbook.language) ? wordbook.language : "fr",
    nativeLanguage: LANGUAGES[wordbook.nativeLanguage] ? wordbook.nativeLanguage : "zh",
    title: String(wordbook.title).trim(),
    description: String(wordbook.description || ""),
    createdAt: wordbook.createdAt || nowIso(),
    updatedAt: wordbook.updatedAt || nowIso()
  };
}

function normalizeVocabularyList(items) {
  const byLemma = new Map();
  items.map(normalizeVocabulary).filter(Boolean).forEach((item) => {
    const key = `${item.language}:${item.nativeLanguage}:${item.normalized}`;
    const existing = byLemma.get(key);
    if (!existing) {
      byLemma.set(key, item);
      return;
    }
    existing.status = existing.status === "got" || item.status === "got" ? "got" : "new";
    existing.ipa = existing.ipa || item.ipa;
    existing.meaning = existing.meaning || item.meaning;
    existing.wordbookIds = mergeWordbookIds(existing.wordbookIds, item.wordbookIds);
    existing.seenForms = mergeSeenForms(existing.seenForms, item.seenForms);
    existing.updatedAt = item.updatedAt > existing.updatedAt ? item.updatedAt : existing.updatedAt;
  });
  return Array.from(byLemma.values());
}

function normalizeVocabulary(item) {
  if (!item?.word) return null;
  const language = STUDY_LANGUAGE_IDS.includes(item.language) ? item.language : "fr";
  const nativeLanguage = LANGUAGES[item.nativeLanguage] ? item.nativeLanguage : "zh";
  const normalized = String(item.lemma || item.normalized || normalizeWordForLanguage(item.word, language));
  if (!normalized) return null;
  const originalForm = normalizeWordForLanguage(item.word, language);
  const seenForms = Array.isArray(item.seenForms)
    ? item.seenForms.map((entry) => normalizeSeenForm(entry, language)).filter(Boolean)
    : [{ form: String(item.word), normalized: originalForm, count: 1 }];
  return {
    id: item.id || makeId("word"),
    language,
    nativeLanguage,
    word: String(item.word),
    lemma: normalized,
    normalized,
    ipa: String(item.ipa || ""),
    meaning: String(item.meaning || item.zh || ""),
    status: item.status === "got" ? "got" : "new",
    wordbookIds: cleanWordbookIds([...(Array.isArray(item.wordbookIds) ? item.wordbookIds : []), ...(item.wordbookId ? [item.wordbookId] : [])]),
    seenForms,
    createdAt: item.createdAt || nowIso(),
    updatedAt: item.updatedAt || nowIso()
  };
}

function normalizeSeenForm(entry, languageId = activeStudyLanguageId()) {
  if (!entry) return null;
  const form = String(entry.form || entry.word || entry.normalized || "");
  const normalized = normalizeWordForLanguage(entry.normalized || form, languageId);
  if (!normalized) return null;
  return { form, normalized, count: Math.max(1, Number(entry.count || 1)) };
}

function cleanWordbookIds(ids = []) {
  return Array.from(new Set(ids.map(String).filter(Boolean).filter((id) => !isSystemWordbook(id))));
}

function mergeWordbookIds(left = [], right = []) {
  return Array.from(new Set([...left, ...right].filter(Boolean).map(String)));
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
      merged.set(normalized, { form: entry.form || normalized, normalized, count: Math.max(1, Number(entry.count || 1)) });
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

function persist() {
  renderMy();
  storageDriver.setLocal(APP_STORAGE_KEY, state).catch(() => setStatus("保存失败"));
  queueSyncedSettings();
}

function queueSyncedSettings() {
  if (!storageDriver.canSync) return;
  window.clearTimeout(syncSettingsTimer);
  syncSettingsTimer = window.setTimeout(() => {
    storageDriver.setSync(SYNC_STORAGE_KEY, {
      settings: state.settings,
      voices: state.voices,
      profile: state.profile,
      updatedAt: nowIso()
    }).catch(() => {});
  }, 800);
}

function createStorageDriver() {
  const chromeApi = globalThis.chrome;
  const hasChromeStorage = Boolean(chromeApi?.storage?.local);
  const isExtensionPage = window.location.protocol === "chrome-extension:";
  if (hasChromeStorage && isExtensionPage) {
    return {
      canSync: Boolean(chromeApi.storage.sync),
      async getLocal(key) {
        return new Promise((resolve) => chromeApi.storage.local.get(key, (result) => resolve(result?.[key] || null)));
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
        return new Promise((resolve) => chromeApi.storage.sync.get(key, (result) => resolve(result?.[key] || null)));
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
  return {
    canSync: false,
    async getLocal(key) {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
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

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(window.location.protocol)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((registration) => registration.update()).catch(() => {
      setStatus("离线缓存未启用");
    });
  });
}

function el(tagName, className = "", text = "") {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(label, className, onClick, iconName) {
  const node = el("button", className);
  node.type = "button";
  if (iconName && icons[iconName]) node.insertAdjacentHTML("afterbegin", icons[iconName]);
  node.append(el("span", "", label));
  node.addEventListener("click", onClick);
  return node;
}

function miniButton(label, onClick) {
  const node = el("button", "mini-button", label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

function emptyState(text) {
  return el("div", "empty-state", text);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function pickAlbumColor() {
  const colors = ["#0a6b61", "#b84533", "#356aa0", "#237c4a", "#8a5a16", "#6f5aa8"];
  return colors[(state?.albums?.length || 0) % colors.length];
}

function firstSentenceTitle(text) {
  const first = splitSentences(text)[0] || text;
  return first.replace(/\s+/g, " ").slice(0, 32) || "练习段落";
}

function makeId(prefix) {
  if (window.crypto?.randomUUID) return `${prefix}_${window.crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat(activeNativeLanguageId() === "zh" ? "zh-CN" : LANGUAGES[activeNativeLanguageId()]?.locale || "en", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return "";
  }
}
