// Clicked-word lookup: demo/local info, popover and detail dialogs, sentence explanation, Wiktionary fallback, translation checks.
// Part of the app: a classic script sharing the page's global scope with app.js.
// It is loaded before app.js (see index.html); everything here runs only after start-up.

function getDemoWordInfo(word, lesson) {
  const unitKey = normalizeLexicalUnit(word);
  const knownUnit = Object.entries(KNOWN_LEXICAL_UNITS).find(([key]) => normalizeLexicalUnit(key) === unitKey)?.[1];
  if (knownUnit) return {
    ...knownUnit,
    displayWord: isVerbPartOfSpeech(knownUnit.pos) ? knownUnit.lemma : word,
    spokenForm: canonicalCourseLookupSurface(word, lesson.language),
    forms: buildCourseWordForms(word, knownUnit.lemma, knownUnit.forms, lesson.language),
    source: "OoFR 开放词库"
  };

  const lookupSurface = canonicalCourseLookupSurface(word, lesson.language);
  const detectedUnit = (lesson.lexicalUnits || []).find((item) => [unitKey, normalizeLexicalUnit(lookupSurface)].includes(normalizeLexicalUnit(item.text)));
  const resolved = resolveWordInfo(detectedUnit?.lemma || lookupSurface);
  const localEntry = resolved.lexicon;
  if (detectedUnit || localEntry) {
    const lemma = detectedUnit?.lemma || localEntry?.word || resolved.lemma || word;
    const override = COURSE_WORD_OVERRIDES[normalizeWord(lemma)] || COURSE_WORD_OVERRIDES[foldWordKey(lemma)];
    const isInflected = normalizeLexicalUnit(lemma) !== unitKey;
    const pos = detectedUnit?.type === "expression" ? "固定表达" : isInflected ? `词形 / 省音 · ${override?.pos || "词条"}` : override?.pos || "开放词典词条";
    return {
      lemma: override?.lemma || lemma,
      displayWord: vocabularyDisplayWord(word, override?.lemma || lemma, pos, lesson.language),
      spokenForm: canonicalCourseLookupSurface(word, lesson.language),
      ipa: localEntry?.ipa || "音标待补充",
      pos,
      zh: override?.zh || localEntry?.zh || "本地词库暂无中文释义，可查询 Wiktionary",
      en: override?.en || localEntry?.zh || "Open Wiktionary lookup available",
      fr: override?.fr || localEntry?.zh || "Définition disponible dans le Wiktionnaire",
      forms: buildCourseWordForms(word, override?.lemma || lemma, "", lesson.language),
      source: "OoFR 开放词库"
    };
  }

  const normalized = normalizeWord(lookupSurface);
  const dictionary = lesson.language === "en" ? {
    practice: { lemma: "practice", ipa: "/ˈpræk.tɪs/", pos: "verb / noun", zh: "练习；实践", en: "to do something repeatedly to improve", forms: "practise (BrE) · practised · practising" },
    phrase: { lemma: "phrase", ipa: "/freɪz/", pos: "noun", zh: "短语；说法", en: "a group of words used together", forms: "phrases" },
    repeat: { lemma: "repeat", ipa: "/rɪˈpiːt/", pos: "verb", zh: "重复", en: "to say or do something again", forms: "repeats · repeated · repeating" },
    slowly: { lemma: "slowly", ipa: "/ˈsloʊ.li/", pos: "adverb", zh: "缓慢地", en: "at a low speed", forms: "slow · slower · slowest" }
  } : {
    bonjour: { lemma: "bonjour", ipa: "/bɔ̃.ʒuʁ/", pos: "interjection", zh: "你好；早安", en: "hello; good morning", forms: "常用问候表达" },
    pratiquer: { lemma: "pratiquer", ipa: "/pʁa.ti.ke/", pos: "verb", zh: "练习、从事（运动或活动）；从业、执业；实行、采用（方法）；信奉、履行（宗教）；开设、开出（通道或切口）；收取、实行（价格）", en: "to practise or engage in; to work as a profession; to apply a method; to observe a religion; to make an opening; to charge a price", forms: "je pratique · nous pratiquons · ils pratiquent" },
    répéter: { lemma: "répéter", ipa: "/ʁe.pe.te/", pos: "verb", zh: "重复；复述", en: "to repeat", forms: "je répète · nous répétons · ils répètent" },
    phrase: { lemma: "phrase", ipa: "/fʁaz/", pos: "noun", zh: "句子；短语", en: "sentence; phrase", forms: "une phrase · des phrases" }
  };
  const demo = dictionary[normalized];
  if (demo) return { ...demo, displayWord: vocabularyDisplayWord(word, demo.lemma, demo.pos, lesson.language), spokenForm: canonicalCourseLookupSurface(word, lesson.language), fr: demo.en, source: "OoFR 内置示例" };
  return {
    lemma: lookupSurface,
    displayWord: lookupSurface,
    spokenForm: lookupSurface,
    ipa: "音标待补充",
    pos: "词条",
    zh: "本地词库暂无释义，正在查询开放词典",
    en: "Looking up this entry in open Wiktionary",
    fr: "Recherche de cette entrée dans le Wiktionnaire",
    forms: buildCourseWordForms(word, lookupSurface, "", lesson.language),
    source: "Wiktionary"
  };
}

function canonicalCourseLookupSurface(surface, language = "fr") {
  const value = String(surface || "").trim().replace(/[’]/g, "'");
  if (language !== "fr") return value;
  const elision = value.match(/^([dl])'([\p{L}\p{M}][\p{L}\p{M}'-]*)$/iu);
  return elision ? elision[2] : value;
}

function buildCourseWordForms(surface, lemma, existingForms = "", language = "fr") {
  const parts = [];
  const normalizedSurface = normalizeLexicalUnit(surface);
  const normalizedLemma = normalizeLexicalUnit(lemma);
  if (lemma) parts.push(`原型：${lemma}`);
  if (surface && normalizedSurface !== normalizedLemma && !normalizedSurface.includes(" ")) {
    const note = language === "fr" ? explainFrenchSurfaceForm(surface, lemma) : "当前词形是原型的变形";
    parts.push(`原文形式：${surface}${note ? `（${note}）` : ""}`);
  }
  if (existingForms) {
    const extras = existingForms.split(" · ").filter((item) => item && !/^原型[:：]|^原文形式[:：]/.test(item) && !parts.some((part) => normalizeLexicalUnit(part) === normalizeLexicalUnit(item)));
    parts.push(...extras);
  }
  return Array.from(new Set(parts)).join(" · ");
}

function explainFrenchSurfaceForm(surface, lemma) {
  const normalized = normalizeLexicalUnit(surface);
  if (/^d['’]/.test(normalized)) return `d’ 是介词 de 在元音前的省音；${surface} = de + ${lemma}`;
  if (/^l['’]/.test(normalized)) return `l’ 是定冠词 le 或 la 在元音前的省音；后接 ${lemma}`;
  if (/^j['’]espere$/.test(normalized)) return `J’ 是 Je 在元音前的省音；espère 是 ${lemma} 的第一人称单数变位`;
  if (/^j['’]apprends$/.test(normalized)) return `J’ 是 Je 在元音前的省音；apprends 是 ${lemma} 的第一人称单数变位`;
  if (/^m['’]appelle$/.test(normalized)) return `m’ 是 me 在元音前的省音；appelle 来自代词式动词 ${lemma}`;
  if (/^j['’]/.test(normalized)) return `J’ 是 Je 在元音或哑音 h 前的省音；当前词形是 ${lemma} 的变位`;
  if (/^m['’]/.test(normalized)) return `m’ 是 me 在元音或哑音 h 前的省音；当前词形来自 ${lemma}`;
  return normalized !== normalizeLexicalUnit(lemma) ? `这是 ${lemma} 的变位或词形变化` : "";
}

function normalizeLexicalUnit(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("fr-FR")
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, "");
}

function courseLexicalUnitPattern(lesson) {
  const units = [
    ...Object.keys(KNOWN_LEXICAL_UNITS),
    // Only multi-word units are fixed expressions; a stray one-word "unit"
    // (e.g. "e") would otherwise split ordinary words.
    ...((lesson?.lexicalUnits || []).map((item) => item.text).filter((text) => (String(text || "").match(/[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu) || []).length >= 2))
  ]
    .map((item) => String(item || "").trim())
    // Imported or AI-made units are untrusted: cap length and count so the
    // pattern can always be compiled.
    .filter((item) => item && item.length <= 64)
    .slice(0, 200)
    .sort((a, b) => b.length - a.length)
    .map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/['’]/g, "['’]"));
  const wordSource = `[\\p{L}\\p{M}]+(?:['’\\-][\\p{L}\\p{M}]+)*`;
  // A unit only counts when it ends at a word boundary ("un peu" must not match inside "un peuple").
  return new RegExp(units.length ? `(?:(?:${units.join("|")})(?![\\p{L}\\p{M}]))|${wordSource}` : wordSource, "giu");
}

function wordMeaningForSystem(info) {
  const language = systemExplainLanguage();
  const value = language === "fr"
    ? info.fr || info.en || info.zh || "Définition en attente"
    : language === "en"
      ? info.en || info.fr || info.zh || "Meaning pending"
      : info.zh || "暂无简中释义";
  return formatDictionaryMeaning(value, language, 10, true);
}

function dictionaryUiLanguage() {
  const language = systemExplainLanguage();
  return ["zh", "en", "fr"].includes(language) ? language : "zh";
}

function formatDictionaryMeaning(value, language = dictionaryUiLanguage(), limit = 6, numbered = true) {
  if (window.OOFR_DICTIONARY?.formatMeaning) {
    return window.OOFR_DICTIONARY.formatMeaning(value, { language, limit, numbered });
  }
  const parts = String(value || "")
    .replace(/\\n/g, "\n")
    .replace(/[\u0000-\u001f\u007f\ufffd]/g, " ")
    .split(/\s*(?:\n+|；|;|•|\s+·\s+)\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, limit);
  if (!parts.length) return language === "zh" ? "暂无简中释义" : "Meaning unavailable";
  if (!numbered || parts.length === 1) return parts.join(language === "zh" ? "；" : "; ");
  return parts.map((part, index) => `${index + 1}. ${part}`).join("\n");
}

function formatDictionaryPartOfSpeech(value) {
  return window.OOFR_DICTIONARY?.formatPartOfSpeech
    ? window.OOFR_DICTIONARY.formatPartOfSpeech(value, dictionaryUiLanguage())
    : String(value || "词语");
}

function formatDictionarySource(value) {
  const source = window.OOFR_DICTIONARY?.formatSource
    ? window.OOFR_DICTIONARY.formatSource(value)
    : String(value || "OoFR 离线开放词典");
  return source || "OoFR 离线开放词典";
}

function showCourseWordInfo(word, lesson, anchor = null) {
  const info = getDemoWordInfo(word, lesson);
  selectedCourseWord = { word, lesson, anchor, info };
  renderCourseWordPopover(info);
  elements.courseWordPopover.hidden = false;
  positionCourseWordPopover();
  playSelectedCourseWord();
  void loadExternalWordInfo(word, lesson, anchor);
}

function renderCourseWordPopover(info) {
  if (!selectedCourseWord) return;
  const lesson = selectedCourseWord.lesson;
  const favorite = Boolean(findVocabulary(selectedCourseWord.word, info));
  elements.coursePopoverWord.textContent = info.displayWord || info.lemma || selectedCourseWord.word;
  elements.coursePopoverMeta.textContent = `${formatDictionaryPartOfSpeech(info.pos)} · ${lesson.language === "en" ? "English" : "Français"}`;
  elements.coursePopoverPronunciation.textContent = info.ipa || "音标待补充";
  const spokenForm = courseWordSpokenForm(info, selectedCourseWord.word);
  elements.coursePopoverWordPlayBtn.title = `播放词条：${spokenForm}`;
  elements.coursePopoverWordPlayBtn.setAttribute("aria-label", `播放词条：${spokenForm}`);
  elements.coursePopoverMeaning.textContent = wordMeaningForSystem(info);
  elements.coursePopoverForms.textContent = info.forms || `原型：${info.lemma || selectedCourseWord.word}`;
  if (elements.coursePopoverSource) elements.coursePopoverSource.textContent = `来源：${formatDictionarySource(info.source)}`;
  setButtonContent(elements.courseWordFavoriteBtn, favorite ? "check" : "heart", favorite ? "已收藏" : "收藏");
  elements.courseWordFavoriteBtn.title = favorite ? "已收藏" : "收藏词语";
  elements.courseWordFavoriteBtn.setAttribute("aria-label", favorite ? "已收藏" : "收藏词语");
  elements.courseWordFavoriteBtn.classList.toggle("is-active", favorite);
}

function positionCourseWordPopover() {
  if (!selectedCourseWord || elements.courseWordPopover.hidden) return;
  const anchor = selectedCourseWord.anchor;
  const panel = elements.courseWordPopover;
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const margin = 12;
  let left = rect.left + rect.width / 2 - panelRect.width / 2;
  let top = rect.bottom + 12;
  if (top + panelRect.height > window.innerHeight - margin) top = rect.top - panelRect.height - 12;
  panel.style.left = `${clamp(left, margin, Math.max(margin, window.innerWidth - panelRect.width - margin))}px`;
  panel.style.top = `${clamp(top, margin, Math.max(margin, window.innerHeight - panelRect.height - margin))}px`;
}

function closeCourseWordPopover() {
  selectedCourseWord = null;
  elements.courseWordPopover.hidden = true;
}

function toggleCourseWordFavorite(event) {
  event?.stopPropagation();
  if (!selectedCourseWord) return;
  const existing = findVocabulary(selectedCourseWord.word, selectedCourseWord.info);
  if (!existing) {
    addWordToVocabulary(selectedCourseWord.word, selectedCourseWord.info);
    setStatus(`已收藏：${selectedCourseWord.word}`);
  } else {
    state.vocabulary = state.vocabulary.filter((word) => word.id !== existing.id);
    setStatus(`已取消收藏：${existing.word}`);
  }
  persist();
  renderWordbooks();
  renderVocab();
  renderCourseWordPopover(selectedCourseWord.info);
}

function toggleCoursePhraseFavorite(turn, lesson) {
  const existing = state.phraseItems.find((item) => item.sourceLessonId === lesson.id && item.text === turn.text);
  if (existing) {
    state.phraseItems = state.phraseItems.filter((item) => item.id !== existing.id);
    persist();
    renderWordbooks();
    renderVocab();
    renderCourseTranscript(lesson);
    elements.coursePlaybackStatus.textContent = "已取消收藏这句话";
    return;
  }
  state.phraseItems.push(normalizePhraseItem({
    id: makeId("phrase"),
    type: "phrase",
    text: turn.text,
    translation: turn.translation,
    sourceLessonId: lesson.id,
    sourceTitle: lesson.title,
    language: lesson.language,
    status: "new",
    wordbookIds: []
  }));
  persist();
  renderWordbooks();
  renderVocab();
  renderCourseTranscript(lesson);
  elements.coursePlaybackStatus.textContent = "句子已收藏到词句本";
}

function openCourseWordDetail() {
  if (!selectedCourseWord || !elements.courseWordDetailDialog) return;
  const runId = ++courseWordDetailRunId;
  const selection = selectedCourseWord;
  renderCourseWordDetail(selection.info, selection);
  elements.courseWordDetailStatus.textContent = "正在读取本地开放词典…";
  if (!elements.courseWordDetailDialog.open) elements.courseWordDetailDialog.showModal();
  void (async () => {
    const external = await loadExternalWordInfo(selection.word, selection.lesson, selection.anchor);
    if (runId !== courseWordDetailRunId || !elements.courseWordDetailDialog.open) return;
    const info = external || selection.info;
    selection.info = info;
    renderCourseWordDetail(info, selection);
    if (selectedCourseWord === selection) renderCourseWordPopover(info);
    elements.courseWordDetailStatus.textContent = external
      ? "本地开放词典已就绪。词义不使用生成式 AI，避免补写或混淆义项。"
      : "本地词典暂无这一词条，已保留课程中的基础信息。";
  })();
}

function closeCourseWordDetail() {
  courseWordDetailRunId += 1;
  if (elements.courseWordDetailDialog?.open) elements.courseWordDetailDialog.close();
}

async function openCourseSentenceDetail(lesson, turnIndex) {
  const turn = lesson?.turns?.[turnIndex];
  if (!turn || !elements.courseSentenceDetailDialog) return;
  const runId = ++courseSentenceDetailRunId;
  elements.courseSentenceDetailTitle.textContent = `第 ${turnIndex + 1} 句讲解`;
  elements.courseSentenceDetailMeta.textContent = turn.text;
  elements.courseSentenceDetailBody.replaceChildren();
  if (!elements.courseSentenceDetailDialog.open) elements.courseSentenceDetailDialog.showModal();
  if (!aiExplanationNeedsGeneration(turn.aiExplanation, lesson)) {
    renderCourseSentenceExplanation(turn.aiExplanation);
    elements.courseSentenceDetailStatus.textContent = courseExplanationCacheLabel(turn.aiExplanation);
    return;
  }
  if (!localAiRuntimeEnabled()) {
    appendCourseWordDetailSection(elements.courseSentenceDetailBody, "桌面端生成", "这句话还没有缓存讲解。请在 macOS 版打开课程并等待后台生成，再导出学习包到手机。");
    elements.courseSentenceDetailStatus.textContent = "在线 AI 暂未开放；当前不会上传素材或消耗 token";
    return;
  }
  elements.courseSentenceDetailStatus.textContent = "正在请本机 AI 结合前后文分析语法…";
  const explanation = await loadCourseSentenceExplanation(lesson, turnIndex);
  // Keep the result even if the dialog was closed meanwhile: the work is done.
  const liveLesson = findLiveLesson(lesson.id);
  const liveTurn = liveLesson?.turns.find((item) => item.id === turn.id);
  if (explanation && liveTurn && aiExplanationNeedsGeneration(liveTurn.aiExplanation, liveLesson)) {
    liveTurn.aiExplanation = explanation;
    liveLesson.updatedAt = nowIso();
    persist();
  }
  if (runId !== courseSentenceDetailRunId || !elements.courseSentenceDetailDialog.open) return;
  if (!explanation) {
    elements.courseSentenceDetailStatus.textContent = describeLocalAiError(lastLocalAiError);
    return;
  }
  renderCourseSentenceExplanation(explanation);
  elements.courseSentenceDetailStatus.textContent = `本机开源 AI（${explanation.model}）· 已缓存到当前课程`;
}

function courseExplanationCacheLabel(explanation) {
  const model = String(explanation?.model || "").trim();
  if (explanation?.cacheSource === "learning-package" || isHostedOnlineRuntime()) {
    return `学习包中的 AI 缓存${model ? ` · ${model}` : ""} · 可离线查看`;
  }
  return `本机开源 AI（${model || state.settings.localAiModel}）· 已缓存到当前课程`;
}

function closeCourseSentenceDetail() {
  courseSentenceDetailRunId += 1;
  if (elements.courseSentenceDetailDialog?.open) elements.courseSentenceDetailDialog.close();
}

function renderCourseSentenceExplanation(explanation) {
  elements.courseSentenceDetailBody.replaceChildren();
  appendCourseWordDetailSection(elements.courseSentenceDetailBody, "句意", explanation.summary);
  appendCourseWordDetailSection(elements.courseSentenceDetailBody, "句式骨架", explanation.structure);
  appendCourseWordDetailSection(elements.courseSentenceDetailBody, "语法点", localAiStringList(explanation.grammarPoints).join("\n"));
  appendCourseWordDetailSection(elements.courseSentenceDetailBody, "词形变化", explanation.morphology);
  appendCourseWordDetailSection(elements.courseSentenceDetailBody, "易错点", localAiStringList(explanation.pitfalls).join("\n"));
  appendCourseWordDetailSection(elements.courseSentenceDetailBody, "替换例句", localAiStringList(explanation.examples).join("\n"));
}

function localAiStringList(value) {
  return (Array.isArray(value) ? value : value ? [value] : []).map(String).filter(Boolean);
}

async function loadCourseSentenceExplanation(lesson, turnIndex) {
  const turn = lesson.turns[turnIndex];
  const schema = {
    type: "object",
    properties: {
      summary: { type: "string" },
      structure: { type: "string" },
      grammarPoints: { type: "array", items: { type: "string" } },
      morphology: { type: "string" },
      pitfalls: { type: "array", items: { type: "string" } },
      examples: { type: "array", items: { type: "string" } }
    },
    required: ["summary", "structure", "grammarPoints", "morphology", "pitfalls", "examples"]
  };
  const explainNames = { zh: "Simplified Chinese only, without English glosses or pinyin", en: "English", fr: "French" };
  const context = {
    previous: lesson.turns[turnIndex - 1]?.text || "",
    current: turn.text,
    next: lesson.turns[turnIndex + 1]?.text || ""
  };
  const prompt = `Explain the CURRENT ${lesson.language === "en" ? "English" : "French"} sentence for a language learner. Write explanations in ${explainNames[lesson.explainLanguage] || "Simplified Chinese"}. Use the surrounding sentences only to resolve context. Explain the sentence skeleton, grammar, conjugation or morphology, likely mistakes, and give 2 useful substitution examples. Be accurate and concise. Return only the required JSON.\n\nCONTEXT:\n${JSON.stringify(context)}`;
  try {
    // The learner asked for this one, so it tries even while background work is paused.
    const response = await createLocalAiClient(120000, { force: true }).chatJson({
      system: courseExplanationSystemInstruction(lesson.explainLanguage),
      prompt,
      schema,
      timeoutMs: 120000,
      signal: aiSignalFor(lesson.id),
      options: { num_predict: 900 }
    });
    const normalized = normalizeAiExplanation(response.data, response.model, lesson.explainLanguage);
    if (!explanationLanguageMatches(normalized, lesson.explainLanguage)) throw new Error("逐句讲解未按设定语言返回");
    lastLocalAiError = null;
    return normalized;
  } catch (error) {
    lastLocalAiError = error;
    noteAiFailure(error);
    return null;
  }
}

function renderCourseWordDetail(info, selection = selectedCourseWord) {
  if (!selection || !elements.courseWordDetailBody) return;
  const meaning = formatDictionaryMeaning(info.zh || "暂无简中释义", "zh", 20, true);
  const sentence = selectedCourseWordSentence(selection);
  elements.courseWordDetailTitle.textContent = info.displayWord || info.lemma || selection.word;
  elements.courseWordDetailMeta.textContent = `${formatDictionaryPartOfSpeech(info.pos)} · 原文形式：${selection.word}`;
  elements.courseWordDetailBody.replaceChildren();
  appendCourseWordDetailSection(elements.courseWordDetailBody, "简中释义", meaning);
  appendCourseWordDetailSection(elements.courseWordDetailBody, "词形与省音", info.forms || buildCourseWordForms(selection.word, info.lemma, "", selection.lesson.language));
  appendCourseWordDetailSection(elements.courseWordDetailBody, "特殊用法与语法", info.aiUsageNote || courseWordGrammarExplanation(selection.word, info));
  if (info.contextMeaning) appendCourseWordDetailSection(elements.courseWordDetailBody, "当前语境义", info.contextMeaning);
  if (sentence) appendCourseWordDetailSection(elements.courseWordDetailBody, "当前句中的作用", sentence);
  const dictionaryNotes = cleanDictionaryDetailNotes(info.dictionaryDetails);
  if (dictionaryNotes && (systemExplainLanguage() !== "zh" || /[\u3400-\u9fff]/u.test(dictionaryNotes))) {
    appendCourseWordDetailSection(elements.courseWordDetailBody, "开放词典补充", dictionaryNotes);
  }
  appendCourseWordDetailSection(elements.courseWordDetailBody, "来源", formatDictionarySource(info.source));
}

function appendCourseWordDetailSection(container, title, content) {
  if (!content) return;
  const section = el("section", "course-word-detail-section");
  section.append(el("h4", "", title), el("p", "", content));
  container.append(section);
}

function selectedCourseWordSentence(selection) {
  const turn = selectedCourseWordTurn(selection);
  return turn ? `${turn.text}${turn.translation ? `\n${turn.translation}` : ""}` : "";
}

function selectedCourseWordTurn(selection) {
  const turnId = selection.anchor?.closest?.("[data-turn-id]")?.dataset?.turnId;
  const byAnchor = selection.lesson.turns.find((item) => item.id === turnId);
  if (byAnchor) return byAnchor;
  // Whole words only: "est" must not match inside "restaurant".
  const wanted = normalizeLexicalUnit(selection.word);
  if (!wanted) return undefined;
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{M}])${escaped}(?:$|[^\\p{L}\\p{M}])`, "u");
  return selection.lesson.turns.find((item) => pattern.test(normalizeLexicalUnit(item.text)));
}

function courseWordGrammarExplanation(surface, info) {
  const normalized = normalizeLexicalUnit(surface);
  const lemma = String(info.lemma || surface);
  if (/^d['’]/.test(normalized)) return `d’ 是介词 de 在元音前的省音。${surface} 可还原为 de + ${lemma}；这里的 ${lemma} 是动词原形。`;
  if (/^l['’]/.test(normalized)) return `l’ 是定冠词 le 或 la 在元音前的省音，具体阴阳性要由名词 ${lemma} 判断。`;
  if (/^j['’]/.test(normalized)) return `J’ 是主语代词 Je 在元音或哑音 h 前的省音；后面的词形是 ${lemma} 的变位。`;
  if (/^m['’]/.test(normalized)) return `m’ 是代词 me 在元音或哑音 h 前的省音；当前表达来自 ${lemma}。`;
  if (normalizeWord(lemma) === "organiser") return "organiser 是规则 -er 动词，常表示“组织、安排、筹办”。常见结构：organiser une visite（安排参观）、organiser une réunion（组织会议）；s’organiser 表示“安排好自己、做好规划”。";
  if (normalizeWord(lemma) === "espérer") return "espérer 可接名词或动词不定式；espérer que 后通常接陈述式。词干在部分现在时变位中会出现 é → è 的变化，例如 j’espère。";
  return info.pos === "固定表达" ? "这是一个需要整体理解和记忆的固定表达，不建议逐词直译。" : `当前词条以 ${lemma} 为原型；详细词形关系见上方说明。`;
}

function cleanDictionaryDetailNotes(value) {
  return toSimplifiedDictionaryChinese(value)
    .replace(/\/[^/\n]{1,100}\//g, " ")
    .replace(/(?:国际音标|音标|发音|读音)(?:\([^)]*\))?\s*[:：]?\s*/gi, "")
    .split(/\s*·\s*|\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/同音词|近音词/.test(part))
    .slice(0, 4)
    .join(" · ");
}

function playSelectedCourseWord() {
  if (!selectedCourseWord) return;
  const { word, lesson, info } = selectedCourseWord;
  const spokenForm = courseWordSpokenForm(info, word);
  if (info.audio) {
    const audio = new Audio(info.audio);
    audio.play().catch(() => speakCourseWord(spokenForm, lesson));
    return;
  }
  speakCourseWord(spokenForm, lesson);
}

function courseWordSpokenForm(info, surface) {
  return String(info?.spokenForm || canonicalCourseLookupSurface(surface, info?.language || "fr") || info?.displayWord || info?.lemma || "").trim();
}

function speakCourseWord(word, lesson) {
  if (!canSpeak()) return;
  // Pronouncing a word ends the running lesson audio (its position is kept).
  if (playback.status !== "idle") stopSpeech({ quiet: true });
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = lesson.language === "en" ? "en-US" : "fr-FR";
  utterance.rate = Number(elements.courseRateSelect.value || 0.9);
  const voice = selectedVoiceForLanguage(utterance.lang);
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

async function loadExternalWordInfo(word, lesson, anchor = null) {
  const context = selectedCourseWordTurn({ word, lesson, anchor })?.text || "";
  const occurrence = Number(anchor?.dataset?.occurrence || 0);
  // Results are applied only if the learner is still looking at this very word:
  // the same word in another sentence has its own request.
  const selection = selectedCourseWord;
  const key = `${systemExplainLanguage()}:${lesson.language}:${normalizeLexicalUnit(word)}:${normalizeLexicalUnit(context)}:${occurrence}`;
  if (dictionaryCache.has(key)) {
    const info = { ...getDemoWordInfo(word, lesson), ...dictionaryCache.get(key) };
    if (selectedCourseWord === selection) {
      selectedCourseWord.info = info;
      renderCourseWordPopover(info);
    }
    return info;
  }
  const base = getDemoWordInfo(word, lesson);
  if (window.OOFR_DICTIONARY?.lookup) {
    try {
      const local = await window.OOFR_DICTIONARY.lookup(word, lesson.language, { context, occurrence });
      if (local) {
        const knownUnit = Object.keys(KNOWN_LEXICAL_UNITS).some((unit) => normalizeLexicalUnit(unit) === normalizeLexicalUnit(word));
        const lemma = knownUnit ? base.lemma : (local.lemma || local.word || base.lemma);
        const override = COURSE_WORD_OVERRIDES[normalizeWord(lemma)] || COURSE_WORD_OVERRIDES[foldWordKey(lemma)];
        const pos = knownUnit ? base.pos : (override?.pos || local.pos || base.pos);
        const surface = canonicalCourseLookupSurface(word, lesson.language);
        const formDescription = local.form?.features ? `词形：${local.form.features}` : "";
        const info = {
          ...base,
          lemma,
          displayWord: vocabularyDisplayWord(word, lemma, pos, lesson.language),
          spokenForm: surface,
          ipa: local.formIpa || local.ipa || base.ipa,
          pos,
          zh: knownUnit ? base.zh : (override?.zh || local.zh || base.zh || "暂无简中释义"),
          en: override?.en || local.en || base.en,
          fr: override?.fr || base.fr || local.en,
          audio: local.isInflected ? "" : local.audio,
          forms: buildCourseWordForms(word, lemma, [formDescription, base.forms].filter(Boolean).join(" · "), lesson.language),
          dictionaryDetails: local.en,
          source: `${local.source || "OoFR 离线开放词典"}${override ? " · OoFR 校订" : ""} · 本地词典`,
          language: lesson.language,
          partOfSpeech: pos
        };
        dictionaryCache.set(key, info);
        if (selectedCourseWord === selection) {
          selectedCourseWord.info = info;
          renderCourseWordPopover(info);
        }
        return info;
      }
    } catch {
      // The compact legacy lexicon and online fallback remain available.
    }
  }
  try {
    const title = base.lemma || word;
    const preferredWiki = systemExplainLanguage();
    const wikiOrder = Array.from(new Set([preferredWiki, lesson.language, "en", "fr"]));
    let lookup = null;
    for (const wikiLanguage of wikiOrder) {
      try {
        lookup = await fetchWiktionaryExtract(title, wikiLanguage, lesson.language);
        // Page titles are case-sensitive; sentence-initial words are capitalised.
        if (!lookup?.extract && title !== title.toLocaleLowerCase()) {
          lookup = await fetchWiktionaryExtract(title.toLocaleLowerCase(), wikiLanguage, lesson.language);
        }
      } catch {
        lookup = null; // this wiki is unreachable: try the next one
      }
      if (lookup?.extract) break;
    }
    if (!lookup?.extract) throw new Error("Wiktionary entry unavailable");
    const info = { ...base, source: `${lookup.wikiName} · 开放词典` };
    const formattedExtract = formatWiktionaryDefinition(lookup.extract, base);
    info.dictionaryDetails = formattedExtract;
    if (lookup.language === "zh") {
      info.zh = mergeDictionaryDefinition(extractChineseDictionaryMeaning(formattedExtract), base.zh);
    } else {
      info[lookup.language] = formattedExtract;
    }
    dictionaryCache.set(key, info);
    if (selectedCourseWord === selection) {
      selectedCourseWord.info = info;
      renderCourseWordPopover(selectedCourseWord.info);
    }
    return info;
  } catch {
    // Neither the local dictionary nor Wiktionary has it: say so instead of
    // leaving "looking up…" on screen.
    if (selectedCourseWord === selection && selectedCourseWord) {
      const notFound = { ...base, zh: "没有找到这个词的释义", en: "No entry found", fr: "Aucune entrée trouvée", source: "未找到" };
      selectedCourseWord.info = notFound;
      renderCourseWordPopover(notFound);
    }
    return null;
  }
}

// Heading names of the learner's language in each Wiktionary edition. A page can
// open with another language's section (en.wiktionary "pain" starts with English).
const WIKTIONARY_LANGUAGE_HEADINGS = {
  en: { fr: ["French"], en: ["English"] },
  fr: { fr: ["Français"], en: ["Anglais"] },
  zh: { fr: ["法语", "法語"], en: ["英语", "英語"] }
};
const wiktionaryInflight = new Map();

function fetchWiktionaryExtract(title, language, lessonLanguage = "fr") {
  const key = `${language}:${lessonLanguage}:${title}`;
  if (!wiktionaryInflight.has(key)) {
    const request = fetchWiktionaryExtractUncached(title, language, lessonLanguage).finally(() => wiktionaryInflight.delete(key));
    wiktionaryInflight.set(key, request);
  }
  return wiktionaryInflight.get(key);
}

async function fetchWiktionaryExtractUncached(title, language, lessonLanguage) {
  const wikiLanguage = ["zh", "en", "fr"].includes(language) ? language : "en";
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    redirects: "1",
    prop: "extracts",
    explaintext: "1",
    exchars: "650",
    titles: title
  });
  if (wikiLanguage === "zh") params.set("variant", "zh-cn");
  const response = await fetch(`https://${wikiLanguage}.wiktionary.org/w/api.php?${params}`, { signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error(`Wiktionary ${response.status}`);
  const payload = await response.json();
  const page = Object.values(payload?.query?.pages || {}).find((item) => !item.missing);
  const rawExtract = String(page?.extract || "");
  const headings = [...rawExtract.matchAll(/^=+\s*(.+?)\s*=+\s*$/gm)].map((match) => match[1]);
  const wanted = WIKTIONARY_LANGUAGE_HEADINGS[wikiLanguage]?.[lessonLanguage] || [];
  if (headings.length && wanted.length && !headings.some((heading) => wanted.some((name) => heading.includes(name)))) return null;
  const extract = cleanWiktionaryExtract(rawExtract);
  if (!extract) return null;
  return { extract, language: wikiLanguage, wikiName: wikiLanguage === "fr" ? "Wiktionnaire" : wikiLanguage === "zh" ? "维基词典" : "Wiktionary" };
}

function cleanWiktionaryExtract(value) {
  const lines = String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^=+.+?=+$/.test(line))
    .filter((line) => !/^(étymologie|prononciation|traductions?|synonymes?|antonymes?|dérivés?|references?|références?)\s*:?$/i.test(line));
  const concise = lines.slice(0, 4).join(" · ").replace(/\s+/g, " ").trim();
  return concise.length > 320 ? `${concise.slice(0, 320).replace(/\s+\S*$/, "")}…` : concise;
}

function formatWiktionaryDefinition(value, info) {
  const lemma = normalizeLexicalUnit(info?.lemma);
  const ipa = String(info?.ipa || "").replace(/^\/|\/$/g, "");
  const segments = toSimplifiedDictionaryChinese(value)
    .split(/\s*·\s*|\n+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !/^(国际音标|发音|读音)(?:\([^)]*\))?\s*[:：]?/i.test(segment))
    .filter((segment) => !ipa || !segment.includes(ipa))
    .filter((segment) => normalizeLexicalUnit(segment) !== lemma);
  return segments.join(" · ").replace(/\s+/g, " ").trim();
}

function extractChineseDictionaryMeaning(value) {
  const segments = toSimplifiedDictionaryChinese(value)
    .replace(/\/[^/\n]{1,100}\//g, " ")
    .split(/\s*·\s*|\n+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !/源自|继承自|词源|国际音标|发音|读音|同音词|近音词|参考|参见/.test(segment))
    .filter((segment) => /[\u3400-\u9fff]/u.test(segment));
  return conciseChineseDictionaryMeaning(segments.slice(0, 2).join("；"));
}

function conciseChineseDictionaryMeaning(value) {
  const simplified = toSimplifiedDictionaryChinese(value)
    .replace(/\/[^/\n]{1,100}\//g, " ")
    .replace(/(?:国际音标|音标|发音|读音)(?:\([^)]*\))?\s*[:：]?\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (window.OOFR_DICTIONARY?.senseList) {
    const senses = window.OOFR_DICTIONARY.senseList(simplified, "zh", 12);
    return senses.join("；") || "释义待补充";
  }
  const useful = simplified
    .split(/\s*(?:；|;|·|\n+)\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/源自|继承自|词源|同音词|近音词/.test(part));
  return useful.slice(0, 12).join("；") || "释义待补充";
}

function mergeDictionaryDefinition(external, local) {
  const cleanExternal = String(external || "").trim();
  const cleanLocal = String(local || "").trim();
  const localIsPlaceholder = !cleanLocal || /暂无|查询|待补充/.test(cleanLocal);
  if (!cleanExternal) return conciseChineseDictionaryMeaning(cleanLocal);
  if (localIsPlaceholder) return conciseChineseDictionaryMeaning(cleanExternal);
  return conciseChineseDictionaryMeaning(cleanLocal);
}

function toSimplifiedDictionaryChinese(value) {
  const phrases = [
    ["源自古法語", "源自古法语"], ["繼承自拉丁語", "继承自拉丁语"],
    ["國際音標", "国际音标"], ["不及物，及物", "不及物、及物"],
    ["傳統拼寫", "传统拼写"], ["詞源", "词源"], ["動詞", "动词"],
    ["名詞", "名词"], ["形容詞", "形容词"], ["副詞", "副词"]
  ];
  const characters = {
    "語": "语", "繼": "继", "國": "国", "際": "际", "標": "标", "幫": "帮", "詞": "词", "義": "义",
    "學": "学", "為": "为", "與": "与", "動": "动", "態": "态", "體": "体", "時": "时", "發": "发",
    "後": "后", "這": "这", "個": "个", "們": "们", "會": "会", "來": "来", "說": "说", "寫": "写",
    "讀": "读", "聲": "声", "簡": "简", "複": "复", "數": "数", "單": "单", "處": "处", "實": "实",
    "應": "应", "見": "见", "稱": "称", "類": "类", "變": "变", "終": "终", "開": "开", "關": "关",
    "連": "连", "線": "线", "釋": "释", "羅": "罗", "歐": "欧", "舊": "旧", "書": "书", "號": "号"
  };
  let result = String(value || "");
  phrases.forEach(([traditional, simplified]) => { result = result.replaceAll(traditional, simplified); });
  return Array.from(result, (character) => characters[character] || character).join("");
}

async function translateText(text, sourceLanguage, targetLanguage, signal = undefined) {
  if (!String(text || "").trim()) return "";
  if (sourceLanguage === targetLanguage) return text;
  const localTranslation = getLocalTranslation(text, sourceLanguage, targetLanguage);
  if (localTranslation) return localTranslation;
  const key = `${sourceLanguage}:${targetLanguage}:${text}`;
  if (translationCache.has(key)) return translationCache.get(key);
  const schema = {
    type: "object",
    properties: { translation: { type: "string" } },
    required: ["translation"]
  };
  const targetNames = { zh: "Simplified Chinese", "zh-CN": "Simplified Chinese", en: "English", fr: "French" };
  const source = sourceLanguage === "en" ? "English" : "French";
  const target = targetNames[targetLanguage] || "Simplified Chinese";
  try {
    const response = await createLocalAiClient(90000).chatJson({
      prompt: `Translate from ${source} to ${target}. Preserve meaning and tone. Return only the required JSON.\n\nTEXT:\n${text}`,
      schema,
      timeoutMs: 90000,
      signal,
      options: { num_predict: 500 }
    });
    const result = String(response.data?.translation || "").trim();
    if (!result || isSuspiciousTranslation(text, result)) throw new Error("low-confidence translation");
    translationCache.set(key, result);
    lastLocalAiError = null;
    return result;
  } catch (error) {
    lastLocalAiError = error;
    noteAiFailure(error);
    return "";
  }
}

function translationPhraseKey(text) {
  return String(text || "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[’]/g, "'")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.!?。！？]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getLocalTranslation(text, sourceLanguage, targetLanguage) {
  const target = targetLanguage === "zh-CN" ? "zh" : targetLanguage;
  return LOCAL_TRANSLATIONS[`${sourceLanguage}:${target}:${translationPhraseKey(text)}`] || "";
}

function applyKnownLocalTranslations(lesson) {
  let changed = false;
  lesson.turns.forEach((turn) => {
    const translation = getLocalTranslation(turn.text, lesson.language, lesson.explainLanguage);
    if (translation && turn.translation !== translation) {
      turn.translation = translation;
      changed = true;
    }
  });
  return changed;
}

function isSuspiciousTranslation(source, translation) {
  const original = String(source || "").trim();
  const result = String(translation || "").trim();
  if (!result) return true;
  if (!/[()（）]/.test(original) && /^[（(].+[，,].+[）)]$/.test(result)) return true;
  // Markdown headings / hashtags are only a problem when the model added them.
  if (/#/.test(result) && !/#/.test(original)) return true;
  return false;
}
