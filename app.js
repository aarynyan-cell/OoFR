const SAMPLE_TEXT = `Bonjour ! Je m'appelle Camille, et j'apprends le français tous les jours.
Aujourd'hui, je voudrais pratiquer les liaisons : les amis, vous avez, nous allons.
Est-ce que tu peux répéter cette phrase plus lentement ? Merci beaucoup.`;

const APP_STORAGE_KEY = "oofr.app.v1";
const SYNC_STORAGE_KEY = "oofr.sync.v1";
const LEGACY_STORAGE_KEY = "oofr.pronunciation.v1";
const WORD_PATTERN_SOURCE = String.raw`[\p{L}\p{M}]+(?:[’'\-][\p{L}\p{M}]+)*`;
const CHROME_DEFAULT_VOICE = "Google français";
const ELIDED_PREFIXES = new Set(["c", "d", "j", "l", "m", "n", "qu", "s", "t", "jusqu", "lorsqu", "puisqu"]);
const ALL_WORDBOOK_ID = "all";
const NEW_WORDBOOK_ID = "new";
const GOT_WORDBOOK_ID = "got";
const DIY_WORDBOOK_ID = "diy";
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
  feedback: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="2" d="M4 5h16v11H8l-4 4z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M8 9h8M8 13h5"/></svg>`,
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
  navButtons: Array.from(document.querySelectorAll("[data-view-target]")),
  views: {
    reader: document.querySelector("#readerView"),
    library: document.querySelector("#libraryView"),
    vocab: document.querySelector("#vocabView"),
    my: document.querySelector("#myView")
  },
  input: document.querySelector("#frenchInput"),
  activeEntryLine: document.querySelector("#activeEntryLine"),
  textStats: document.querySelector("#textStats"),
  playAllReader: document.querySelector("#playAllReader"),
  stopReader: document.querySelector("#stopReader"),
  saveEntryBtn: document.querySelector("#saveEntryBtn"),
  refreshBtn: document.querySelector("#refreshBtn"),
  sampleBtn: document.querySelector("#sampleBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  voiceSelect: document.querySelector("#voiceSelect"),
  rateControl: document.querySelector("#rateControl"),
  rateLabel: document.querySelector("#rateLabel"),
  repeatGroup: document.querySelector("#repeatGroup"),
  pauseControl: document.querySelector("#pauseControl"),
  pauseLabel: document.querySelector("#pauseLabel"),
  statusLine: document.querySelector("#statusLine"),
  sentenceList: document.querySelector("#sentenceList"),
  wordPanel: document.querySelector("#wordPanel"),
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
  exportBtn: document.querySelector("#exportBtn"),
  importBtn: document.querySelector("#importBtn"),
  importFile: document.querySelector("#importFile"),
  wordbookExportBtn: document.querySelector("#wordbookExportBtn"),
  wordbookImportBtn: document.querySelector("#wordbookImportBtn"),
  wordbookImportFile: document.querySelector("#wordbookImportFile"),
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
let frenchVoices = [];
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
  hydrateIcons();
  state = await loadAppState();
  await applySyncedSettings();
  bindEvents();
  ensureSelections();
  syncSettingsControls();
  loadVoices();
  renderAll();
  registerServiceWorker();

  if (canSpeak()) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
  } else {
    setStatus("当前浏览器不支持朗读");
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

  elements.sampleBtn.addEventListener("click", () => {
    stopSpeech();
    setCurrentText(SAMPLE_TEXT, null);
  });

  elements.clearBtn.addEventListener("click", () => {
    stopSpeech();
    setCurrentText("", null);
    elements.input.focus();
  });

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

  elements.voiceSelect.addEventListener("change", () => {
    state.settings.voice = elements.voiceSelect.value;
    state.settings.voiceLocked = true;
    persist();
  });

  elements.repeatGroup.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-repeat]");
    if (!button) return;
    state.settings.repeat = button.dataset.repeat;
    setRepeat(state.settings.repeat);
    persist();
  });

  elements.exportBtn.addEventListener("click", exportData);
  elements.importBtn.addEventListener("click", () => elements.importFile.click());
  elements.importFile.addEventListener("change", importData);
  elements.wordbookExportBtn.addEventListener("click", exportWordbooks);
  elements.wordbookImportBtn.addEventListener("click", () => elements.wordbookImportFile.click());
  elements.wordbookImportFile.addEventListener("change", importWordbooks);

  elements.wordPlayBtn.addEventListener("click", () => {
    if (!selectedWord) return;
    togglePlayback(
      [{ text: selectedWord.raw, element: selectedWord.element, label: selectedWord.raw, lang: "fr-FR", forceFrench: true }],
      { key: `word:${selectedWord.normalized}`, label: selectedWord.raw }
    );
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
    const item = ensureVocabularyItem(selectedWord.raw);
    openVocabDialog(item.id);
  });

  elements.wordDeleteBtn.addEventListener("click", () => {
    if (!selectedWord) return;
    const item = findVocabulary(selectedWord.raw);
    if (!item) return;
    deleteVocabulary(item.id);
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
    if (dialogSubmitHandler) {
      const values = collectDialogValues();
      const shouldClose = dialogSubmitHandler(values);
      if (shouldClose !== false) closeDialog();
    }
  });

  document.addEventListener("click", closeWordPanelOnOutsideClick);
  window.addEventListener("resize", positionWordPanel);
  window.addEventListener("scroll", positionWordPanel, { passive: true });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && selectedWord) {
      closeWordPanel();
    }
  });
}

function renderAll() {
  ensureSelections();
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
  renderPlaybackControls();
}

function renderView() {
  Object.entries(elements.views).forEach(([name, view]) => {
    if (!view) return;
    view.classList.toggle("is-active", state.ui.activeView === name);
  });

  elements.navButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.viewTarget === state.ui.activeView));
  });
}

function renderMy() {
  if (!elements.myStats) return;
  elements.myStats.textContent = `${state.albums.length} 专辑 · ${state.tapes.length} 磁带 · ${state.entries.length} 段落 · ${state.vocabulary.length} 词`;
}

function syncInput() {
  if (elements.input.value !== state.currentText) {
    elements.input.value = state.currentText;
  }
}

function renderActiveEntryLine() {
  const entry = getEntry(state.activeEntryId);
  if (!entry) {
    elements.activeEntryLine.textContent = "临时练习草稿";
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
    elements.sentenceList.append(emptyState("暂无文本"));
  } else {
    sentences.forEach((sentence, index) => {
      elements.sentenceList.append(createSentenceRow(sentence, index));
    });
  }

  const wordCount = countWords(text);
  elements.textStats.textContent = `${sentences.length} 句 · ${wordCount} 词`;
  elements.playAllReader.disabled = sentences.length === 0;

  if (selectedWord) {
    const replacement = Array.from(elements.sentenceList.querySelectorAll(".word-button"))
      .find((button) => button.dataset.word === selectedWord.raw);
    if (replacement) {
      selectedWord.element = replacement;
    }
  }

  renderPlaybackControls();
}

function createSentenceRow(sentence, index) {
  const row = el("div", "sentence-row");
  row.dataset.index = String(index);
  row.dataset.playbackKey = `sentence:${index}`;

  const playButton = el("button", "icon-button sentence-play play-trigger");
  playButton.type = "button";
  playButton.title = `播放第 ${index + 1} 句`;
  playButton.setAttribute("aria-label", `播放第 ${index + 1} 句`);
  playButton.dataset.playbackKey = row.dataset.playbackKey;
  playButton.innerHTML = icons.speaker;
  playButton.addEventListener("click", () => {
    const key = row.dataset.playbackKey;
    if (!isActivePlayback(key)) {
      recordPracticeIfEntry();
    }
    togglePlayback([{ text: sentence, element: row, label: `第 ${index + 1} 句` }], {
      key,
      label: `第 ${index + 1} 句`
    });
  });

  const text = el("p", "sentence-text");
  text.lang = "fr";
  appendClickableWords(text, sentence);

  const number = el("span", "sentence-number", String(index + 1).padStart(2, "0"));

  row.append(playButton, text, number);
  return row;
}

function appendClickableWords(container, sentence) {
  const pattern = wordPattern();
  let lastIndex = 0;
  let match = pattern.exec(sentence);

  while (match) {
    const word = match[0];
    const start = match.index;

    if (start > lastIndex) {
      container.append(document.createTextNode(sentence.slice(lastIndex, start)));
    }

    const button = el("button", "word-button play-trigger");
    const vocab = findVocabulary(word);
    button.type = "button";
    button.lang = "fr";
    button.textContent = word;
    button.title = `播放 ${word}`;
    button.dataset.word = word;
    if (vocab) {
      button.classList.add(vocab.status === "got" ? "vocab-got" : "vocab-new");
    }
    button.addEventListener("click", () => handleWordClick(word, button));

    container.append(button);
    lastIndex = pattern.lastIndex;
    match = pattern.exec(sentence);
  }

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
  const status = vocab ? (vocab.status === "got" ? "got" : "生词") : "未加入";
  const ipa = hint?.ipa || "音标待补充";
  const zh = hint?.zh || "释义待补充";
  const formLine = info.lemma !== info.normalized ? `${selectedWord.raw} → ${hint?.word || info.lemma}` : selectedWord.raw;

  elements.wordPanel.hidden = false;
  elements.wordPanelTitle.textContent = formLine;
  elements.wordPanelMeta.textContent = `${status} · ${ipa} · ${zh}`;
  elements.wordAddBtn.hidden = Boolean(vocab);
  elements.wordToggleBtn.hidden = !vocab;
  elements.wordEditBtn.hidden = !vocab;
  elements.wordDeleteBtn.hidden = !vocab;

  if (vocab) {
    elements.wordToggleBtn.querySelector("span").textContent = vocab.status === "got" ? "new" : "got";
  }

  renderWordPlayButton();
  window.requestAnimationFrame(positionWordPanel);
}

function handleWordClick(word, element) {
  selectedWord = { raw: word, normalized: normalizeWord(word), info: resolveWordInfo(word), element };
  renderWordPanel();
  playItems(
    [{ text: word, element, label: word, lang: "fr-FR", forceFrench: true }],
    { key: `word:${selectedWord.normalized}`, label: word }
  );
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
  const left = clamp(
    anchorRect.left + anchorRect.width / 2 - panelRect.width / 2,
    margin,
    window.innerWidth - panelRect.width - margin
  );
  let top = anchorRect.bottom + 10;

  if (top + panelRect.height > window.innerHeight - margin) {
    top = anchorRect.top - panelRect.height - 10;
  }

  top = clamp(top, margin, Math.max(margin, window.innerHeight - panelRect.height - margin));
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function resetWordPanelPosition() {
  elements.wordPanel.style.left = "";
  elements.wordPanel.style.top = "";
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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

  if (state.albums.length === 0) {
    elements.albumShelf.append(emptyState("还没有专辑"));
  } else {
    state.albums.forEach((album) => {
      elements.albumShelf.append(createAlbumCard(album));
    });
  }

  renderLibraryDetail();
}

function createAlbumCard(album) {
  const card = el("article", "album-card");
  card.style.background = `linear-gradient(135deg, ${album.coverColor}, rgba(18, 21, 20, 0.86))`;
  card.classList.toggle("is-selected", state.ui.selectedAlbumId === album.id);
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `选择专辑 ${album.title}`);
  card.addEventListener("click", (event) => {
    if (event.target.closest(".row-actions")) return;
    selectAlbum(album.id);
  });
  card.addEventListener("keydown", (event) => {
    if (event.target.closest(".row-actions")) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectAlbum(album.id);
    }
  });

  const button = el("button", "album-button");
  button.type = "button";
  button.addEventListener("click", () => {
    selectAlbum(album.id);
  });

  const title = el("h3", "", album.title);
  const description = el("p", "", album.description || " ");
  button.append(title, description);

  const meta = el("div", "album-meta");
  meta.append(el("span", "", `${getTapes(album.id).length} 磁带`));
  meta.append(el("span", "", `${getEntriesByAlbum(album.id).length} 段落`));

  const actions = el("div", "row-actions");
  actions.append(
    miniButton("编辑", () => openAlbumDialog(album.id)),
    miniButton("删除", () => deleteAlbum(album.id))
  );

  card.append(button, meta, actions);
  return card;
}

function selectAlbum(albumId) {
  state.ui.selectedAlbumId = albumId;
  const firstTape = getTapes(albumId)[0];
  state.ui.selectedTapeId = firstTape?.id || null;
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
  headerActions.append(
    button("磁带", "command-button primary", () => openTapeDialog(null, album.id), "plus"),
    button("编辑", "command-button", () => openAlbumDialog(album.id), "edit")
  );
  header.append(titleBox, headerActions);

  const tapes = getTapes(album.id);
  const tapeSection = el("section", "cassette-list");
  if (tapes.length === 0) {
    tapeSection.append(emptyState("还没有磁带"));
  } else {
    tapes.forEach((tape) => tapeSection.append(createTapeCard(tape)));
  }

  const entrySection = createEntrySection();
  elements.libraryDetail.append(header, tapeSection, entrySection);
}

function createTapeCard(tape) {
  const card = el("article", "cassette-card");
  card.classList.toggle("is-selected", state.ui.selectedTapeId === tape.id);

  const face = el("div", "cassette-face");
  const leftReel = el("div", "cassette-reel");
  const label = el("button", "cassette-label");
  label.type = "button";
  label.addEventListener("click", () => {
    state.ui.selectedTapeId = tape.id;
    persist();
    renderLibrary();
  });
  label.append(el("h3", "", tape.title), el("p", "", tape.description || `${getEntries(tape.id).length} 个段落`));
  const rightReel = el("div", "cassette-reel");
  face.append(leftReel, label, rightReel);

  const actions = el("div", "row-actions");
  actions.append(
    miniButton("编辑", () => openTapeDialog(tape.id)),
    miniButton("删除", () => deleteTape(tape.id))
  );

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
    wrap.append(emptyState("还没有段落"));
    return wrap;
  }

  entries.forEach((entry) => {
    const item = el("article", "entry-item");
    const titleRow = el("div", "item-title-row");
    titleRow.append(el("h3", "", entry.title), el("span", "badge", `${entry.practiceCount || 0} 次`));
    const preview = el("p", "entry-preview", entry.text);
    const meta = el("p", "", entry.lastPracticedAt ? `最近练习：${formatDate(entry.lastPracticedAt)}` : "尚未练习");
    const rowActions = el("div", "row-actions");
    rowActions.append(
      miniButton("打开", () => loadEntry(entry.id)),
      miniButton("编辑", () => openEntryDialog(entry.id)),
      miniButton("删除", () => deleteEntry(entry.id))
    );
    item.append(titleRow, preview, meta, rowActions);
    wrap.append(item);
  });

  return wrap;
}

function renderWordbooks() {
  elements.wordbookShelf.replaceChildren();
  const books = [...SYSTEM_WORDBOOKS, ...state.wordbooks];
  books.forEach((book) => {
    elements.wordbookShelf.append(createWordbookCard(book));
  });

  const selected = getWordbook(state.ui.selectedWordbookId);
  elements.selectedWordbookLine.textContent = selected
    ? `${selected.title} · ${vocabularyForWordbook(selected.id).length} 词`
    : `all · ${state.vocabulary.length} 词`;
}

function createWordbookCard(book) {
  const count = vocabularyForWordbook(book.id).length;
  const card = el("article", `wordbook-card${isSystemWordbook(book.id) ? " is-system" : ""}`);
  card.classList.toggle("is-selected", state.ui.selectedWordbookId === book.id);
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `选择单词本 ${book.title}`);

  const select = () => {
    state.ui.selectedWordbookId = book.id;
    persist();
    renderWordbooks();
    renderVocab();
  };
  card.addEventListener("click", (event) => {
    if (event.target.closest(".row-actions")) return;
    select();
  });
  card.addEventListener("keydown", (event) => {
    if (event.target.closest(".row-actions")) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
    }
  });

  const title = el("h3", "", book.title);
  const description = el("p", "", book.description || " ");
  const meta = el("span", "badge", `${count} 词`);
  card.append(title, description, meta);

  if (!isSystemWordbook(book.id)) {
    const actions = el("div", "row-actions");
    actions.append(
      miniButton("编辑", () => openWordbookDialog(book.id)),
      miniButton("删除", () => deleteWordbook(book.id))
    );
    card.append(actions);
  }

  return card;
}

function renderVocab() {
  const query = normalizeWord(elements.vocabSearch.value || "");
  const items = state.vocabulary
    .filter((item) => vocabularyMatchesWordbook(item, state.ui.selectedWordbookId))
    .filter((item) => {
      if (!query) return true;
      return normalizeWord(`${item.word} ${item.lemma || ""} ${item.ipa} ${item.zh} ${seenFormsText(item)} ${wordbookNamesText(item)}`).includes(query);
    })
    .sort((a, b) => a.word.localeCompare(b.word, "fr"));

  const selected = getWordbook(state.ui.selectedWordbookId);
  const gotCount = state.vocabulary.filter((item) => item.status === "got").length;
  elements.vocabStats.textContent = `${items.length} / ${state.vocabulary.length} 词 · ${gotCount} got`;
  elements.vocabList.replaceChildren();

  if (items.length === 0) {
    elements.vocabList.append(emptyState(selected ? `${selected.title} 里还没有单词` : "还没有单词"));
    return;
  }

  items.forEach((item) => {
    const card = el("article", `vocab-item status-${item.status}`);
    const body = el("div");
    const word = el("div", "vocab-word");
    word.append(el("strong", "", item.word), el("span", "", item.ipa || "音标待补充"), el("span", "badge", item.status));
    const forms = seenFormsText(item);
    const books = wordbookNamesText(item);
    body.append(word, el("p", "", item.zh || "释义待补充"));
    if (forms) {
      body.append(el("p", "", `见过：${forms}`));
    }
    if (books) {
      body.append(el("p", "", `词本：${books}`));
    }

    const actions = el("div", "row-actions");
    actions.append(
      miniButton("播放", () => togglePlayback(
        [{ text: item.word, element: card, label: item.word, forceFrench: true }],
        { key: `word:${item.normalized}`, label: item.word }
      )),
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
  const items = sentences.map((sentence, index) => ({
    text: sentence,
    element: rows[index],
    label: `第 ${index + 1} 句`
  }));
  if (items.length > 0 && !isActivePlayback("reader:all")) {
    recordPracticeIfEntry();
  }
  togglePlayback(items, { key: "reader:all", label: "全文" });
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
    setStatus("当前浏览器不支持朗读");
    return;
  }

  const token = ++runToken;
  const key = options.key || playbackKeyForItems(playableItems);
  const label = options.label || playableItems[0]?.label || "朗读";
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
        await speakOnce(item.text, token, item);
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
      setStatus("播放完成");
    }
  }
}

function playbackKeyForItems(items) {
  const first = items.find((item) => item?.text?.trim());
  return first ? `text:${normalizeWord(first.text).slice(0, 32)}:${items.length}` : "empty";
}

function isActivePlayback(key) {
  return playback.key === key && (playback.status === "playing" || playback.status === "paused");
}

function speakOnce(text, token, options = {}) {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = options.lang || "fr-FR";
    utterance.rate = Number(state.settings.rate);
    utterance.pitch = 1;

    const voice = options.forceFrench ? selectedFrenchVoice() : selectedVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || utterance.lang;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallbackTimer);
      resolve();
    };

    utterance.onend = finish;
    utterance.onerror = finish;

    const estimatedMs = Math.max(2400, (text.length * 95) / Math.max(0.5, utterance.rate) + 1600);
    let fallbackTimer = 0;
    const scheduleFallback = () => {
      fallbackTimer = window.setTimeout(() => {
        if (token !== runToken) {
          finish();
          return;
        }
        if (playback.status === "paused") {
          scheduleFallback();
          return;
        }
        finish();
      }, estimatedMs);
    };
    scheduleFallback();

    if (token === runToken) {
      window.speechSynthesis.speak(utterance);
    } else {
      finish();
    }
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
  if (canSpeak()) {
    window.speechSynthesis.cancel();
  }
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

  row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function clearActive() {
  if (!activeElement) return;
  activeElement.classList.remove("is-active");
  activeElement.closest?.(".sentence-row")?.classList.remove("is-active");
  activeElement = null;
}

function openSaveCurrentDialog() {
  const text = state.currentText.trim();
  if (!text) {
    setStatus("没有可保存的文本");
    return;
  }

  ensureLibraryForSave();
  const title = firstSentenceTitle(text);
  const tapeOptions = state.tapes.map((tape) => {
    const album = getAlbum(tape.albumId);
    return { value: tape.id, label: `${album?.title || "专辑"} / ${tape.title}` };
  });

  openDialog({
    title: "保存段落",
    submitText: "保存",
    fields: [
      { name: "title", label: "标题", type: "text", value: title, required: true },
      { name: "tapeId", label: "磁带", type: "select", value: state.ui.selectedTapeId || state.tapes[0]?.id, options: tapeOptions, required: true },
      { name: "notes", label: "备注", type: "textarea", value: "" }
    ],
    onSubmit(values) {
      const entry = createEntry(values.tapeId, values.title, text, values.notes);
      state.activeEntryId = entry.id;
      state.ui.selectedAlbumId = getTape(entry.tapeId)?.albumId || state.ui.selectedAlbumId;
      state.ui.selectedTapeId = entry.tapeId;
      persist();
      renderAll();
      setStatus("已保存到磁带");
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
        const tape = createTape(created.id, "第一盘磁带", "");
        state.ui.selectedTapeId = tape.id;
      }
      persist();
      renderLibrary();
    }
  });
}

function openTapeDialog(tapeId, albumId = state.ui.selectedAlbumId) {
  const tape = getTape(tapeId);
  const albumOptions = state.albums.map((album) => ({ value: album.id, label: album.title }));
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

function deleteWordbook(wordbookId) {
  const wordbook = state.wordbooks.find((item) => item.id === wordbookId);
  if (!wordbook || !window.confirm(`删除单词本「${wordbook.title}」？`)) return;
  state.wordbooks = state.wordbooks.filter((item) => item.id !== wordbookId);
  state.vocabulary.forEach((item) => {
    item.wordbookIds = (item.wordbookIds || []).filter((id) => id !== wordbookId);
  });
  if (state.ui.selectedWordbookId === wordbookId) {
    state.ui.selectedWordbookId = ALL_WORDBOOK_ID;
  }
  persist();
  renderWordbooks();
  renderVocab();
}

function openEntryDialog(entryId, tapeId = state.ui.selectedTapeId) {
  const entry = getEntry(entryId);
  openDialog({
    title: entry ? "编辑段落" : "新建段落",
    submitText: entry ? "更新" : "创建",
    fields: [
      { name: "title", label: "标题", type: "text", value: entry?.title || "", required: true },
      { name: "text", label: "法语文字", type: "textarea", value: entry?.text || "", required: true },
      { name: "notes", label: "备注", type: "textarea", value: entry?.notes || "" }
    ],
    onSubmit(values) {
      if (entry) {
        entry.title = values.title.trim();
        entry.text = values.text.trim();
        entry.notes = values.notes.trim();
        entry.updatedAt = nowIso();
        if (state.activeEntryId === entry.id) {
          setCurrentText(entry.text, entry.id, { skipPersist: true });
        }
      } else {
        createEntry(tapeId, values.title, values.text, values.notes);
      }
      persist();
      renderAll();
    }
  });
}

function openVocabDialog(vocabId) {
  const item = getVocabulary(vocabId);
  const seed = item || (selectedWord ? buildVocabularyItem(selectedWord.raw) : null);
  const currentWordbook = item?.wordbookIds?.[0] || selectedCustomWordbookId();
  const wordbookOptions = [
    { value: "", label: "不放入自定义单词本" },
    ...state.wordbooks.map((wordbook) => ({ value: wordbook.id, label: wordbook.title }))
  ];
  openDialog({
    title: item ? "编辑单词" : "新建单词",
    submitText: item ? "更新" : "创建",
    fields: [
      { name: "word", label: "法语词", type: "text", value: seed?.word || "", required: true },
      { name: "ipa", label: "音标", type: "text", value: seed?.ipa || "" },
      { name: "zh", label: "中文释义", type: "textarea", value: seed?.zh || "" },
      { name: "wordbookId", label: "自定义单词本", type: "select", value: currentWordbook, options: wordbookOptions },
      {
        name: "status",
        label: "状态",
        type: "select",
        value: seed?.status || "new",
        options: [
          { value: "new", label: "new" },
          { value: "got", label: "got" }
        ],
        required: true
      }
    ],
    onSubmit(values) {
      const info = resolveWordInfo(values.word);
      if (!info.lemma) return false;
      const wordbookIds = values.wordbookId ? [values.wordbookId] : [];

      const existing = state.vocabulary.find((word) => word.normalized === info.lemma && word.id !== item?.id);
      if (existing) {
        existing.word = values.word.trim();
        existing.lemma = info.lemma;
        existing.normalized = info.lemma;
        existing.ipa = values.ipa.trim();
        existing.zh = values.zh.trim();
        existing.status = values.status;
        existing.wordbookIds = wordbookIds;
        trackSeenForm(existing, values.word);
        existing.updatedAt = nowIso();
      } else if (item) {
        item.word = values.word.trim();
        item.lemma = info.lemma;
        item.normalized = info.lemma;
        item.ipa = values.ipa.trim();
        item.zh = values.zh.trim();
        item.status = values.status;
        item.wordbookIds = wordbookIds;
        trackSeenForm(item, values.word);
        item.updatedAt = nowIso();
      } else {
        state.vocabulary.push({
          id: makeId("word"),
          word: values.word.trim(),
          lemma: info.lemma,
          normalized: info.lemma,
          ipa: values.ipa.trim(),
          zh: values.zh.trim(),
          status: values.status,
          wordbookIds,
          seenForms: [{ form: values.word.trim(), normalized: normalizeWord(values.word), count: 1 }],
          createdAt: nowIso(),
          updatedAt: nowIso()
        });
      }
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
    const wrapper = el("label", "dialog-field");
    const label = el("span", "field-label", field.label);
    const input = createDialogInput(field);
    wrapper.append(label, input);
    elements.dialogBody.append(wrapper);
  });

  if (typeof elements.dialog.showModal === "function") {
    elements.dialog.showModal();
  } else {
    elements.dialog.setAttribute("open", "");
  }
}

function createDialogInput(field) {
  let input;
  if (field.type === "textarea") {
    input = document.createElement("textarea");
  } else if (field.type === "select") {
    input = document.createElement("select");
    (field.options || []).forEach((option) => {
      input.append(new Option(option.label, option.value));
    });
  } else if (field.type === "color") {
    const row = el("div", "color-row");
    input = document.createElement("input");
    input.type = "color";
    row.append(input, el("span", "micro-copy", " "));
    input.name = field.name;
    input.value = field.value || "#0a5f59";
    return row;
  } else {
    input = document.createElement("input");
    input.type = field.type || "text";
  }

  input.name = field.name;
  input.value = field.value || "";
  input.required = Boolean(field.required);
  if (input.tagName === "INPUT") {
    input.className = "text-input";
  }
  return input;
}

function collectDialogValues() {
  const formData = new FormData(elements.dialogForm);
  return Object.fromEntries(formData.entries());
}

function closeDialog() {
  dialogSubmitHandler = null;
  if (typeof elements.dialog.close === "function") {
    elements.dialog.close();
  } else {
    elements.dialog.removeAttribute("open");
  }
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

function createAlbum(title, description = "", coverColor = pickAlbumColor()) {
  const timestamp = nowIso();
  const album = {
    id: makeId("album"),
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
  if (state.ui.selectedAlbumId === albumId) {
    state.ui.selectedAlbumId = state.albums[0]?.id || null;
    state.ui.selectedTapeId = getTapes(state.ui.selectedAlbumId)[0]?.id || null;
  }
  if (state.activeEntryId && !getEntry(state.activeEntryId)) {
    state.activeEntryId = null;
  }
  persist();
  renderAll();
}

function deleteTape(tapeId) {
  const tape = getTape(tapeId);
  if (!tape || !window.confirm(`删除磁带「${tape.title}」？`)) return;
  state.tapes = state.tapes.filter((item) => item.id !== tapeId);
  state.entries = state.entries.filter((item) => item.tapeId !== tapeId);
  if (state.ui.selectedTapeId === tapeId) {
    state.ui.selectedTapeId = getTapes(state.ui.selectedAlbumId)[0]?.id || null;
  }
  if (state.activeEntryId && !getEntry(state.activeEntryId)) {
    state.activeEntryId = null;
  }
  persist();
  renderAll();
}

function deleteEntry(entryId) {
  const entry = getEntry(entryId);
  if (!entry || !window.confirm(`删除段落「${entry.title}」？`)) return;
  state.entries = state.entries.filter((item) => item.id !== entryId);
  if (state.activeEntryId === entryId) {
    state.activeEntryId = null;
  }
  persist();
  renderAll();
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

function addWordToVocabulary(rawWord) {
  const item = ensureVocabularyItem(rawWord);
  trackSeenForm(item, rawWord);
  const selectedBookId = selectedCustomWordbookId();
  if (selectedBookId) {
    addVocabularyToWordbook(item, selectedBookId);
  }
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
    word: hint?.word || rawWord.trim(),
    lemma: info.lemma,
    normalized: info.lemma,
    ipa: hint?.ipa || "",
    zh: hint?.zh || "",
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
  if (selectedWord && resolveWordInfo(selectedWord.raw).lemma === item.normalized) {
    selectedWord = null;
  }
  persist();
  renderWordbooks();
  renderVocab();
  renderSentences();
  renderWordPanel();
}

function findVocabulary(rawWord) {
  const info = resolveWordInfo(rawWord);
  return state.vocabulary.find((item) => item.normalized === info.lemma || item.lemma === info.lemma) || null;
}

function getVocabulary(vocabId) {
  return state.vocabulary.find((item) => item.id === vocabId) || null;
}

function getWordbook(wordbookId) {
  return SYSTEM_WORDBOOKS.find((book) => book.id === wordbookId)
    || state.wordbooks.find((book) => book.id === wordbookId)
    || null;
}

function isSystemWordbook(wordbookId) {
  return SYSTEM_WORDBOOKS.some((book) => book.id === wordbookId);
}

function isKnownWordbookId(wordbookId) {
  return isSystemWordbook(wordbookId) || state.wordbooks.some((book) => book.id === wordbookId);
}

function vocabularyForWordbook(wordbookId) {
  return state.vocabulary.filter((item) => vocabularyMatchesWordbook(item, wordbookId));
}

function vocabularyMatchesWordbook(item, wordbookId) {
  if (!wordbookId || wordbookId === ALL_WORDBOOK_ID) return true;
  if (wordbookId === NEW_WORDBOOK_ID) return item.status !== "got";
  if (wordbookId === GOT_WORDBOOK_ID) return item.status === "got";
  if (wordbookId === DIY_WORDBOOK_ID) return isDiyVocabulary(item);
  return Array.isArray(item.wordbookIds) && item.wordbookIds.includes(wordbookId);
}

function isDiyVocabulary(item) {
  return !String(item.ipa || "").trim() || !String(item.zh || "").trim();
}

function wordbookNamesText(item) {
  const names = [];
  if (isDiyVocabulary(item)) names.push("DIY");
  (item.wordbookIds || []).forEach((id) => {
    const book = state.wordbooks.find((wordbook) => wordbook.id === id);
    if (book) names.push(book.title);
  });
  return names.join("、");
}

function selectedCustomWordbookId() {
  const selected = state.ui.selectedWordbookId;
  return state.wordbooks.some((book) => book.id === selected) ? selected : "";
}

function lookupLexicon(rawWord) {
  const lexicon = window.OOFR_LEXICON || {};
  const normalized = normalizeWord(rawWord);
  const candidates = wordLookupCandidates(normalized);
  return candidates.map((candidate) => lexicon[candidate]).find(Boolean) || null;
}

function resolveWordInfo(rawWord) {
  const lexicon = window.OOFR_LEXICON || {};
  const forms = window.OOFR_FORM_LEMMAS || {};
  const normalized = normalizeWord(rawWord);
  const candidates = wordLookupCandidates(normalized);
  const direct = lexicon[normalized];
  const directHasMeaning = Boolean(direct?.zh);
  const mappedLemma = directHasMeaning ? "" : candidates.map((candidate) => forms[candidate]).find(Boolean);
  const fallbackLemma = directHasMeaning ? "" : candidates.map((candidate) => singularFallback(candidate, lexicon)).find(Boolean);
  const directCandidate = candidates.map((candidate) => lexicon[candidate] ? candidate : "").find(Boolean);
  const lemma = directHasMeaning
    ? normalized
    : mappedLemma || fallbackLemma || directCandidate || normalized;
  return {
    raw: rawWord,
    normalized,
    lemma,
    lexicon: lexicon[lemma] || direct || candidates.map((candidate) => lexicon[candidate]).find(Boolean) || null,
    formLexicon: direct || null
  };
}

function wordLookupCandidates(normalized) {
  const candidates = [];
  const add = (candidate) => {
    if (candidate && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  add(normalized);
  add(elidedCore(normalized));
  add(normalized.replace(/['-]/g, ""));
  add(normalized.replace(/['-]/g, "_"));
  normalized.split(/['-]/).filter(Boolean).reverse().forEach(add);
  return candidates;
}

function elidedCore(normalized) {
  const parts = normalized.split("'").filter(Boolean);
  if (parts.length < 2) return "";
  const prefix = parts[0];
  if (!ELIDED_PREFIXES.has(prefix)) return "";
  return parts.slice(1).join("'");
}

function singularFallback(normalized, lexicon) {
  if (normalized.length <= 3) return "";
  if (normalized.endsWith("aux") && lexicon[`${normalized.slice(0, -3)}al`]) {
    return `${normalized.slice(0, -3)}al`;
  }
  if (normalized.endsWith("x") && lexicon[normalized.slice(0, -1)]) {
    return normalized.slice(0, -1);
  }
  if (normalized.endsWith("s") && lexicon[normalized.slice(0, -1)]) {
    return normalized.slice(0, -1);
  }
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
  return String(word || "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[’]/g, "'")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zœæç'\-]/g, "")
    .replace(/^['-]+|['-]+$/g, "");
}

function splitSentences(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  if ("Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("fr", { granularity: "sentence" });
    return Array.from(segmenter.segment(normalized), (item) => item.segment.trim()).filter(Boolean);
  }

  return normalized.match(/[^.!?…]+[.!?…]*/g)?.map((item) => item.trim()).filter(Boolean) || [normalized];
}

function countWords(text) {
  return Array.from(text.matchAll(wordPattern())).length;
}

function wordPattern() {
  return new RegExp(WORD_PATTERN_SOURCE, "gu");
}

function ensureSelections() {
  if (state.ui.selectedAlbumId && !getAlbum(state.ui.selectedAlbumId)) {
    state.ui.selectedAlbumId = null;
  }

  if (!state.ui.selectedAlbumId && state.albums.length > 0) {
    state.ui.selectedAlbumId = state.albums[0].id;
  }

  if (state.ui.selectedTapeId && !getTape(state.ui.selectedTapeId)) {
    state.ui.selectedTapeId = null;
  }

  if (!state.ui.selectedTapeId && state.ui.selectedAlbumId) {
    state.ui.selectedTapeId = getTapes(state.ui.selectedAlbumId)[0]?.id || null;
  }

  const selectedTape = getTape(state.ui.selectedTapeId);
  if (selectedTape && selectedTape.albumId !== state.ui.selectedAlbumId) {
    state.ui.selectedTapeId = getTapes(state.ui.selectedAlbumId)[0]?.id || null;
  }

  if (!isKnownWordbookId(state.ui.selectedWordbookId)) {
    state.ui.selectedWordbookId = ALL_WORDBOOK_ID;
  }
}

function ensureLibraryForSave() {
  if (state.albums.length === 0) {
    const album = createAlbum("练习专辑", "临时保存的法语段落", "#0a5f59");
    const tape = createTape(album.id, "第一盘磁带", "");
    state.ui.selectedAlbumId = album.id;
    state.ui.selectedTapeId = tape.id;
  } else if (state.tapes.length === 0) {
    const albumId = state.ui.selectedAlbumId || state.albums[0].id;
    const tape = createTape(albumId, "第一盘磁带", "");
    state.ui.selectedAlbumId = albumId;
    state.ui.selectedTapeId = tape.id;
  }
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

function loadVoices() {
  if (!canSpeak()) {
    elements.voiceSelect.replaceChildren(new Option("不可用", ""));
    return;
  }

  allVoices = window.speechSynthesis.getVoices();
  frenchVoices = allVoices.filter((voice) => /^fr([-_]|$)/i.test(voice.lang));

  const currentValue = state.settings.voice || "";
  elements.voiceSelect.replaceChildren(new Option("系统默认（fr-FR）", ""));

  frenchVoices.forEach((voice) => {
    elements.voiceSelect.append(new Option(`${voice.name} · ${voice.lang}`, voice.name));
  });

  if (frenchVoices.some((voice) => voice.name === currentValue)) {
    elements.voiceSelect.value = currentValue;
  } else {
    const preferred = preferredDefaultVoice();
    elements.voiceSelect.value = preferred?.name || "";
    state.settings.voice = elements.voiceSelect.value;
    state.settings.voiceLocked = false;
    persist();
  }

  if (frenchVoices.length === 0) {
    setStatus("未找到法语声音，使用系统默认");
  }
}

function preferredDefaultVoice() {
  const chromeExact = frenchVoices.find((voice) => voice.name === CHROME_DEFAULT_VOICE && voice.lang.toLowerCase() === "fr-fr");
  if (chromeExact) return chromeExact;

  const chromeVoice = frenchVoices.find((voice) => /google/i.test(voice.name) && /^fr([-_]|$)/i.test(voice.lang));
  if (chromeVoice) return chromeVoice;

  return frenchVoices.find((voice) => voice.lang.toLowerCase() === "fr-fr") || frenchVoices[0] || null;
}

function selectedVoice() {
  const name = state.settings.voice;
  return frenchVoices.find((voice) => voice.name === name) || null;
}

function selectedFrenchVoice() {
  return selectedVoice() || preferredDefaultVoice() || frenchVoices.find((voice) => voice.lang.toLowerCase() === "fr-fr") || frenchVoices[0] || null;
}

function canSpeak() {
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
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
    elements.playAllReader.title = "暂停全文";
    elements.playAllReader.setAttribute("aria-label", "暂停全文");
  } else if (playback.key === key && playback.status === "paused") {
    setButtonContent(elements.playAllReader, "play", "继续");
    elements.playAllReader.title = "继续全文";
    elements.playAllReader.setAttribute("aria-label", "继续全文");
  } else {
    setButtonContent(elements.playAllReader, "play", "全文");
    elements.playAllReader.title = "播放全文";
    elements.playAllReader.setAttribute("aria-label", "播放全文");
  }

  elements.stopReader.disabled = playback.status === "idle";
}

function renderSentencePlayButtons() {
  elements.sentenceList.querySelectorAll(".sentence-play").forEach((button) => {
    const key = button.dataset.playbackKey;
    const row = button.closest(".sentence-row");
    const index = Number(row?.dataset.index || 0) + 1;
    if (playback.key === key && playback.status === "playing") {
      button.innerHTML = icons.pause;
      button.title = `暂停第 ${index} 句`;
      button.setAttribute("aria-label", `暂停第 ${index} 句`);
    } else if (playback.key === key && playback.status === "paused") {
      button.innerHTML = icons.play;
      button.title = `继续第 ${index} 句`;
      button.setAttribute("aria-label", `继续第 ${index} 句`);
    } else {
      button.innerHTML = icons.speaker;
      button.title = `播放第 ${index} 句`;
      button.setAttribute("aria-label", `播放第 ${index} 句`);
    }
  });
}

function renderWordPlayButton() {
  if (!selectedWord) {
    elements.wordPlayBtn.innerHTML = icons.speaker;
    return;
  }

  const key = `word:${selectedWord.normalized}`;
  if (playback.key === key && playback.status === "playing") {
    elements.wordPlayBtn.innerHTML = icons.pause;
    elements.wordPlayBtn.title = "暂停单词";
    elements.wordPlayBtn.setAttribute("aria-label", "暂停单词");
  } else if (playback.key === key && playback.status === "paused") {
    elements.wordPlayBtn.innerHTML = icons.play;
    elements.wordPlayBtn.title = "继续单词";
    elements.wordPlayBtn.setAttribute("aria-label", "继续单词");
  } else {
    elements.wordPlayBtn.innerHTML = icons.speaker;
    elements.wordPlayBtn.title = "播放单词";
    elements.wordPlayBtn.setAttribute("aria-label", "播放单词");
  }
}

function setButtonContent(button, iconName, label) {
  button.replaceChildren();
  button.insertAdjacentHTML("beforeend", icons[iconName] || "");
  button.append(el("span", "", label));
}

function setStatus(text) {
  elements.statusLine.textContent = text;
}

function exportData() {
  downloadJson(state, `oofr-backup-${new Date().toISOString().slice(0, 10)}.json`);
}

function exportWordbooks() {
  const payload = {
    type: "oofr.wordbooks.v1",
    exportedAt: nowIso(),
    wordbooks: state.wordbooks,
    vocabulary: state.vocabulary
  };
  downloadJson(payload, `oofr-wordbooks-${new Date().toISOString().slice(0, 10)}.json`);
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

function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const imported = JSON.parse(String(reader.result || "{}"));
      state = ensureStateShape(imported);
      selectedWord = null;
      syncSettingsControls();
      persist();
      renderAll();
      setStatus("导入完成");
    } catch {
      setStatus("导入失败");
    } finally {
      elements.importFile.value = "";
    }
  });
  reader.readAsText(file);
}

function importWordbooks(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const imported = JSON.parse(String(reader.result || "{}"));
      const incomingWordbooks = normalizeWordbookList(imported.wordbooks || []);
      const incomingVocabulary = Array.isArray(imported.vocabulary)
        ? normalizeVocabularyList(imported.vocabulary)
        : [];

      incomingWordbooks.forEach((wordbook) => {
        const existing = state.wordbooks.find((item) => item.id === wordbook.id);
        if (existing) {
          existing.title = wordbook.title;
          existing.description = wordbook.description;
          existing.updatedAt = nowIso();
        } else {
          state.wordbooks.push(wordbook);
        }
      });

      state.vocabulary = normalizeVocabularyList([...state.vocabulary, ...incomingVocabulary]);
      state.vocabulary.forEach((item) => {
        item.wordbookIds = validWordbookIds(item.wordbookIds);
      });
      ensureSelections();
      persist();
      renderWordbooks();
      renderVocab();
      renderSentences();
      setStatus("单词本导入完成");
    } catch {
      setStatus("单词本导入失败");
    } finally {
      elements.wordbookImportFile.value = "";
    }
  });
  reader.readAsText(file);
}

async function loadAppState() {
  const saved = await readJson(APP_STORAGE_KEY);
  if (saved) {
    return ensureStateShape(saved);
  }

  const legacy = await readJson(LEGACY_STORAGE_KEY);
  return createStarterState(legacy || {});
}

async function applySyncedSettings() {
  const synced = await storageDriver.getSync(SYNC_STORAGE_KEY);
  if (!synced?.settings) return;
  state.settings = {
    ...state.settings,
    ...synced.settings
  };
}

function ensureStateShape(raw) {
  const fallback = createStarterState({});
  const stateLike = raw && typeof raw === "object" ? raw : {};
  const next = {
    version: 1,
    currentText: String(stateLike.currentText || fallback.currentText),
    activeEntryId: stateLike.activeEntryId || null,
    ui: {
      activeView: ["reader", "library", "vocab", "my"].includes(stateLike.ui?.activeView) ? stateLike.ui.activeView : "reader",
      selectedAlbumId: stateLike.ui?.selectedAlbumId || null,
      selectedTapeId: stateLike.ui?.selectedTapeId || null,
      selectedWordbookId: stateLike.ui?.selectedWordbookId || ALL_WORDBOOK_ID
    },
    settings: {
      ...fallback.settings,
      ...(stateLike.settings || {})
    },
    albums: Array.isArray(stateLike.albums) ? stateLike.albums.map(normalizeAlbum).filter(Boolean) : [],
    tapes: Array.isArray(stateLike.tapes) ? stateLike.tapes.map(normalizeTape).filter(Boolean) : [],
    entries: Array.isArray(stateLike.entries) ? stateLike.entries.map(normalizeEntry).filter(Boolean) : [],
    wordbooks: Array.isArray(stateLike.wordbooks) ? normalizeWordbookList(stateLike.wordbooks) : [],
    vocabulary: Array.isArray(stateLike.vocabulary) ? normalizeVocabularyList(stateLike.vocabulary) : []
  };

  if (next.albums.length === 0) {
    return fallback;
  }

  next.tapes = next.tapes.filter((tape) => next.albums.some((album) => album.id === tape.albumId));
  next.entries = next.entries.filter((entry) => next.tapes.some((tape) => tape.id === entry.tapeId));
  next.vocabulary.forEach((item) => {
    item.wordbookIds = validWordbookIds(item.wordbookIds, next.wordbooks);
  });
  return next;
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
    voiceLocked: Boolean(legacy?.voice)
  };

  return {
    version: 1,
    currentText: legacyText,
    activeEntryId: null,
    ui: {
      activeView: "reader",
      selectedAlbumId: albumId,
      selectedTapeId: tapeId,
      selectedWordbookId: ALL_WORDBOOK_ID
    },
    settings,
    albums: [
      {
        id: albumId,
        title: "入门练习",
        description: "从 v0.0 延续来的第一张专辑",
        coverColor: "#0a5f59",
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
    vocabulary: []
  };
}

function normalizeAlbum(album) {
  if (!album?.id || !album?.title) return null;
  return {
    id: String(album.id),
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
  const byLemma = new Map();
  items.map(normalizeVocabulary).filter(Boolean).forEach((item) => {
    const existing = byLemma.get(item.normalized);
    if (!existing) {
      byLemma.set(item.normalized, item);
      return;
    }
    existing.status = existing.status === "got" || item.status === "got" ? "got" : "new";
    existing.ipa = existing.ipa || item.ipa;
    existing.zh = existing.zh || item.zh;
    existing.wordbookIds = mergeWordbookIds(existing.wordbookIds, item.wordbookIds);
    existing.seenForms = mergeSeenForms(existing.seenForms, item.seenForms);
    existing.updatedAt = item.updatedAt > existing.updatedAt ? item.updatedAt : existing.updatedAt;
  });
  return Array.from(byLemma.values());
}

function normalizeVocabulary(item) {
  if (!item?.word) return null;
  const info = resolveWordInfo(item.word);
  const normalized = info.lemma || item.lemma || item.normalized || normalizeWord(item.word);
  if (!normalized) return null;
  const hint = info.lexicon || lookupLexicon(item.word);
  const originalForm = normalizeWord(item.word);
  const seenForms = Array.isArray(item.seenForms)
    ? item.seenForms.map(normalizeSeenForm).filter(Boolean)
    : [{ form: String(item.word), normalized: originalForm, count: 1 }];
  return {
    id: item.id || makeId("word"),
    word: hint?.word || String(item.word),
    lemma: normalized,
    normalized,
    ipa: String(item.ipa || hint?.ipa || ""),
    zh: String(item.zh || hint?.zh || ""),
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

function persist() {
  renderMy();
  storageDriver.setLocal(APP_STORAGE_KEY, state).catch(() => {
    setStatus("保存失败");
  });
  queueSyncedSettings();
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
      voiceLocked: state.settings.voiceLocked
    };
    storageDriver.setSync(SYNC_STORAGE_KEY, {
      settings: syncedSettings,
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
        return new Promise((resolve) => {
          chromeApi.storage.local.get(key, (result) => resolve(result?.[key] || null));
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
  if (!("serviceWorker" in navigator)) return;
  if (!/^https?:$/.test(window.location.protocol)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
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
  if (iconName && icons[iconName]) {
    node.insertAdjacentHTML("afterbegin", icons[iconName]);
  }
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

function pickAlbumColor() {
  const colors = ["#0a5f59", "#b84533", "#356aa0", "#7b4f9f", "#237c4a", "#a35c18"];
  let count = 0;
  try {
    count = Array.isArray(state?.albums) ? state.albums.length : 0;
  } catch {
    count = 0;
  }
  return colors[count % colors.length];
}

function firstSentenceTitle(text) {
  const first = splitSentences(text)[0] || text;
  return first.replace(/\s+/g, " ").slice(0, 28) || "练习段落";
}

function makeId(prefix) {
  if (window.crypto?.randomUUID) {
    return `${prefix}_${window.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return "";
  }
}
