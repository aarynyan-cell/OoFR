const SAMPLE_TEXT = `Bonjour ! Je m'appelle Camille, et j'apprends le français tous les jours.
Aujourd'hui, je voudrais pratiquer les liaisons : les amis, vous avez, nous allons.
Est-ce que tu peux répéter cette phrase plus lentement ? Merci beaucoup.`;

const STORAGE_KEY = "oofr.pronunciation.v1";
const WORD_PATTERN_SOURCE = String.raw`[\p{L}\p{M}]+(?:[’'\-][\p{L}\p{M}]+)*`;

const icons = {
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.14v13.72c0 .74.82 1.18 1.44.78l10.08-6.86a.93.93 0 0 0 0-1.56L9.44 4.36A.94.94 0 0 0 8 5.14Z"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="12" height="12" x="6" y="6" rx="2" fill="currentColor"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 11a8.1 8.1 0 0 0-14.4-4.8L4 8m0 0V4m0 4h4m-4 5a8.1 8.1 0 0 0 14.4 4.8L20 16m0 0v4m0-4h-4"/></svg>`,
  spark: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 2 1.9 5.7L20 10l-6.1 2.3L12 18l-1.9-5.7L4 10l6.1-2.3L12 2Zm7 12 1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3ZM5 15l.8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8L5 15Z"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7h16m-10 4v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>`,
  speaker: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9.2v5.6c0 .66.54 1.2 1.2 1.2H8l5.1 4.1c.78.62 1.9.07 1.9-.93V4.83c0-1-1.12-1.55-1.9-.93L8 8H5.2C4.54 8 4 8.54 4 9.2Zm13.4-1.4a1 1 0 0 0 0 1.4 4 4 0 0 1 0 5.6 1 1 0 0 0 1.4 1.4 6 6 0 0 0 0-8.4 1 1 0 0 0-1.4 0Z"/></svg>`
};

const elements = {
  input: document.querySelector("#frenchInput"),
  textStats: document.querySelector("#textStats"),
  refreshBtn: document.querySelector("#refreshBtn"),
  sampleBtn: document.querySelector("#sampleBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  voiceSelect: document.querySelector("#voiceSelect"),
  rateControl: document.querySelector("#rateControl"),
  rateLabel: document.querySelector("#rateLabel"),
  repeatGroup: document.querySelector("#repeatGroup"),
  pauseControl: document.querySelector("#pauseControl"),
  pauseLabel: document.querySelector("#pauseLabel"),
  sentenceList: document.querySelector("#sentenceList"),
  statusLine: document.querySelector("#statusLine"),
  playAllButtons: [document.querySelector("#playAllTop"), document.querySelector("#playAllReader")],
  stopButtons: [document.querySelector("#stopTop"), document.querySelector("#stopReader")]
};

let frenchVoices = [];
let allVoices = [];
let sentences = [];
let activeElement = null;
let runToken = 0;
let renderTimer = 0;

hydrateIcons();
restoreState();
bindEvents();
loadVoices();
renderSentences();

if (canSpeak()) {
  window.speechSynthesis.onvoiceschanged = loadVoices;
} else {
  setStatus("当前浏览器不支持朗读");
}

function hydrateIcons() {
  document.querySelectorAll("[data-icon]").forEach((button) => {
    const name = button.dataset.icon;
    if (icons[name]) {
      button.insertAdjacentHTML("afterbegin", icons[name]);
    }
  });
}

function restoreState() {
  const saved = readSavedState();
  elements.input.value = saved.text || SAMPLE_TEXT;
  elements.rateControl.value = saved.rate || "0.85";
  elements.pauseControl.value = saved.pause || "0.4";
  setRepeat(saved.repeat || "1");
  updateLabels();
}

function bindEvents() {
  elements.input.addEventListener("input", () => {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(renderSentences, 120);
  });

  elements.refreshBtn.addEventListener("click", renderSentences);

  elements.sampleBtn.addEventListener("click", () => {
    stopSpeech();
    elements.input.value = SAMPLE_TEXT;
    renderSentences();
  });

  elements.clearBtn.addEventListener("click", () => {
    stopSpeech();
    elements.input.value = "";
    renderSentences();
    elements.input.focus();
  });

  elements.rateControl.addEventListener("input", () => {
    updateLabels();
    saveState();
  });

  elements.pauseControl.addEventListener("input", () => {
    updateLabels();
    saveState();
  });

  elements.voiceSelect.addEventListener("change", saveState);

  elements.repeatGroup.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-repeat]");
    if (!button) return;
    setRepeat(button.dataset.repeat);
    saveState();
  });

  elements.playAllButtons.forEach((button) => {
    button.addEventListener("click", playAllSentences);
  });

  elements.stopButtons.forEach((button) => {
    button.addEventListener("click", stopSpeech);
  });
}

function renderSentences() {
  const text = elements.input.value.trim();
  sentences = splitSentences(text);
  elements.sentenceList.replaceChildren();

  if (sentences.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "暂无文本";
    elements.sentenceList.append(empty);
  } else {
    sentences.forEach((sentence, index) => {
      elements.sentenceList.append(createSentenceRow(sentence, index));
    });
  }

  const wordCount = countWords(text);
  elements.textStats.textContent = `${sentences.length} 句 · ${wordCount} 词`;
  setPlayButtonsEnabled(sentences.length > 0);
  saveState();
}

function createSentenceRow(sentence, index) {
  const row = document.createElement("div");
  row.className = "sentence-row";
  row.dataset.index = String(index);

  const playButton = document.createElement("button");
  playButton.type = "button";
  playButton.className = "icon-button sentence-play play-trigger";
  playButton.title = `播放第 ${index + 1} 句`;
  playButton.setAttribute("aria-label", `播放第 ${index + 1} 句`);
  playButton.innerHTML = icons.speaker;
  playButton.addEventListener("click", () => {
    playItems([{ text: sentence, element: row, label: `第 ${index + 1} 句` }]);
  });

  const text = document.createElement("p");
  text.className = "sentence-text";
  text.lang = "fr";
  appendClickableWords(text, sentence);

  const number = document.createElement("span");
  number.className = "sentence-number";
  number.textContent = String(index + 1).padStart(2, "0");

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

    const button = document.createElement("button");
    button.type = "button";
    button.className = "word-button play-trigger";
    button.lang = "fr";
    button.textContent = word;
    button.title = `播放 ${word}`;
    button.addEventListener("click", () => {
      playItems([{ text: word, element: button, label: word }]);
    });

    container.append(button);
    lastIndex = pattern.lastIndex;
    match = pattern.exec(sentence);
  }

  if (lastIndex < sentence.length) {
    container.append(document.createTextNode(sentence.slice(lastIndex)));
  }
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

async function playAllSentences() {
  const rows = Array.from(elements.sentenceList.querySelectorAll(".sentence-row"));
  const items = sentences.map((sentence, index) => ({
    text: sentence,
    element: rows[index],
    label: `第 ${index + 1} 句`
  }));
  await playItems(items);
}

async function playItems(items) {
  const playableItems = items.filter((item) => item.text.trim());
  if (playableItems.length === 0) return;

  if (!canSpeak()) {
    setStatus("当前浏览器不支持朗读");
    return;
  }

  const token = ++runToken;
  window.speechSynthesis.cancel();
  clearActive();
  setBusy(true);

  try {
    for (const item of playableItems) {
      if (token !== runToken) break;
      markActive(item.element);
      setStatus(`正在播放：${item.label}`);

      const repeat = getRepeat();
      for (let index = 0; index < repeat; index += 1) {
        if (token !== runToken) break;
        await speakOnce(item.text, token);
        if (token !== runToken || index >= repeat - 1) break;
        await pause(getPauseMs(), token);
      }
    }
  } finally {
    if (token === runToken) {
      clearActive();
      setBusy(false);
      setStatus("播放完成");
    }
  }
}

function speakOnce(text, token) {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fr-FR";
    utterance.rate = Number(elements.rateControl.value);
    utterance.pitch = 1;

    const voice = selectedVoice();
    if (voice) {
      utterance.voice = voice;
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

    const estimatedMs = Math.max(2500, (text.length * 95) / Math.max(0.5, utterance.rate) + 1800);
    const fallbackTimer = window.setTimeout(finish, estimatedMs);

    if (token === runToken) {
      window.speechSynthesis.speak(utterance);
    } else {
      finish();
    }
  });
}

function stopSpeech() {
  runToken += 1;
  if (canSpeak()) {
    window.speechSynthesis.cancel();
  }
  clearActive();
  setBusy(false);
  setStatus("已停止");
}

function pause(milliseconds, token) {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      if (token === runToken) resolve();
      else resolve();
    }, milliseconds);
  });
}

function markActive(element) {
  clearActive();
  activeElement = element;
  activeElement.classList.add("is-active");

  const row = element.closest(".sentence-row");
  if (row && row !== element) {
    row.classList.add("is-active");
  }

  row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function clearActive() {
  if (!activeElement) return;
  activeElement.classList.remove("is-active");
  activeElement.closest(".sentence-row")?.classList.remove("is-active");
  activeElement = null;
}

function loadVoices() {
  if (!canSpeak()) {
    elements.voiceSelect.replaceChildren(new Option("不可用", ""));
    return;
  }

  const saved = readSavedState();
  allVoices = window.speechSynthesis.getVoices();
  frenchVoices = allVoices.filter((voice) => /^fr([-_]|$)/i.test(voice.lang));

  const currentValue = elements.voiceSelect.value || saved.voice || "";
  elements.voiceSelect.replaceChildren(new Option("系统默认（fr-FR）", ""));

  frenchVoices.forEach((voice) => {
    const option = new Option(`${voice.name} · ${voice.lang}`, voice.name);
    elements.voiceSelect.append(option);
  });

  if (frenchVoices.some((voice) => voice.name === currentValue)) {
    elements.voiceSelect.value = currentValue;
  } else {
    const preferred = frenchVoices.find((voice) => voice.lang.toLowerCase() === "fr-fr") || frenchVoices[0];
    elements.voiceSelect.value = preferred?.name || "";
  }

  if (frenchVoices.length === 0) {
    setStatus("未找到法语声音，使用系统默认");
  }
}

function selectedVoice() {
  const name = elements.voiceSelect.value;
  return frenchVoices.find((voice) => voice.name === name) || null;
}

function canSpeak() {
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

function setBusy(isBusy) {
  document.querySelectorAll(".play-trigger").forEach((button) => {
    button.disabled = isBusy;
  });
}

function setPlayButtonsEnabled(isEnabled) {
  elements.playAllButtons.forEach((button) => {
    button.disabled = !isEnabled;
  });
}

function setRepeat(value) {
  elements.repeatGroup.querySelectorAll("button[data-repeat]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.repeat === value));
  });
}

function getRepeat() {
  const selected = elements.repeatGroup.querySelector('button[data-repeat][aria-pressed="true"]');
  return Number(selected?.dataset.repeat || "1");
}

function getPauseMs() {
  return Number(elements.pauseControl.value) * 1000;
}

function updateLabels() {
  elements.rateLabel.textContent = `${Number(elements.rateControl.value).toFixed(2)}x`;
  elements.pauseLabel.textContent = `${Number(elements.pauseControl.value).toFixed(1)}s`;
}

function setStatus(text) {
  elements.statusLine.textContent = text;
}

function readSavedState() {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveState() {
  const selectedRepeat = elements.repeatGroup.querySelector('button[data-repeat][aria-pressed="true"]');
  const state = {
    text: elements.input.value,
    rate: elements.rateControl.value,
    pause: elements.pauseControl.value,
    repeat: selectedRepeat?.dataset.repeat || "1",
    voice: elements.voiceSelect.value
  };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Local storage can be unavailable in private or restricted browsing modes.
  }
}
