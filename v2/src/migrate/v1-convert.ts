// Converts an OoFR 1.0 saved state (the "oofr.app.v1" value, or a 1.0 backup
// file) into 2.0 records. Pure function: it never touches storage, so it can be
// tested on any input and run as often as needed.
//
// 1.0 model: albums (shown as "磁带") → tapes (hidden middle layer) → entries
// (素材), plus courseLessons holding the sentences ("turns"). An entry points to
// its lesson with courseLessonId; very old albums were converted into one lesson
// `course_<albumId>` whose turn ids start with `<entryId>_turn_`.

import { DEFAULT_SETTINGS, DEFAULT_STUDY, TAPE_COLORS, nowIso } from "../db/defaults";
import type {
  Card,
  CardStatus,
  DictionaryEntry,
  Explanation,
  Language,
  LexicalUnit,
  Material,
  Sentence,
  Settings,
  StudyStats,
  Tape,
  Wordbook
} from "../db/types";
import { MATERIAL_TYPES, type MaterialType, inferMaterialType, normalizeWord, splitSentences } from "../text/split";

export interface V1Bundle {
  tapes: Tape[];
  materials: Material[];
  cards: Card[];
  wordbooks: Wordbook[];
  dictionary: DictionaryEntry[];
  settings: Partial<Settings>;
  study: Partial<StudyStats>;
  // Keys in 1.0's "oofr-audio" database that sentences refer to.
  recordingKeys: string[];
}

export const UNSORTED_TAPE_ID = "v1_unsorted";
const SYSTEM_WORDBOOK_IDS = new Set(["all", "new", "got", "diy"]);
const NARRATION_TYPES = new Set(["文章", "笔记", "歌词"]);
const LEARNING_PACKAGE_TYPE = "oofr.learning-package";

type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : fallback);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const objects = (value: unknown): Raw[] => list(value).filter(isObject);
const id = (value: unknown): string => str(value).trim().slice(0, 200);
const stamp = (value: unknown): string => (str(value) && !Number.isNaN(Date.parse(str(value))) ? str(value) : nowIso());
const optionalStamp = (value: unknown): string | null => (str(value) && !Number.isNaN(Date.parse(str(value))) ? str(value) : null);
const count = (value: unknown): number => Math.max(0, Math.floor(Number(value) || 0));
const language = (value: unknown): Language => (value === "en" ? "en" : "fr");

export function looksLikeV1State(raw: unknown): raw is Raw {
  return isObject(raw) && raw.type !== LEARNING_PACKAGE_TYPE && Array.isArray(raw.albums);
}

export function convertV1State(raw: unknown): V1Bundle {
  if (!looksLikeV1State(raw)) throw new Error("这不是 OoFR 1.0 的数据");

  const albums = objects(raw.albums).filter((album) => id(album.id) && str(album.title).trim());
  const albumIds = new Set(albums.map((album) => id(album.id)));
  const v1Tapes = objects(raw.tapes).filter((tape) => id(tape.id) && albumIds.has(id(tape.albumId)));
  const albumOfV1Tape = new Map(v1Tapes.map((tape) => [id(tape.id), id(tape.albumId)]));
  const entries = objects(raw.entries).filter((entry) => id(entry.id) && albumOfV1Tape.has(id(entry.tapeId)) && typeof entry.text === "string");
  const lessons = objects(raw.courseLessons).filter((lesson) => id(lesson.id) && str(lesson.title).trim());

  const tapes: Tape[] = albums.map((album, index) => ({
    id: id(album.id),
    title: str(album.title).trim(),
    description: str(album.description),
    color: /^#[0-9a-f]{3,8}$/i.test(str(album.coverColor)) ? str(album.coverColor) : TAPE_COLORS[index % TAPE_COLORS.length],
    order: index,
    createdAt: stamp(album.createdAt),
    updatedAt: stamp(album.updatedAt)
  }));

  // Very old albums without a lesson: 1.0 turns all their entries into one lesson
  // on load. Do the same here, in case the saved copy predates that step.
  const lessonIds = new Set(lessons.map((lesson) => id(lesson.id)));
  const lessonOfAlbum = new Map(albums.map((album) => [id(album.id), id(album.courseLessonId)]));
  albums.forEach((album) => {
    if (lessonOfAlbum.get(id(album.id)) || lessonIds.has(`course_${id(album.id)}`)) return;
    const albumEntries = entries
      .filter((entry) => albumOfV1Tape.get(id(entry.tapeId)) === id(album.id))
      .sort((a, b) => str(a.createdAt).localeCompare(str(b.createdAt)));
    const turns = albumEntries.flatMap((entry) => splitSentences(str(entry.text)).map((part, index) => ({
      id: `${id(entry.id)}_turn_${index + 1}`,
      text: part.text,
      speakerId: part.speakerId || "a",
      speakerLabel: part.speakerLabel || "默认说话人"
    })));
    if (!turns.length) return;
    const lessonId = `course_${id(album.id)}`;
    lessons.push({ id: lessonId, title: album.title, materialType: "", description: "", turns, createdAt: album.createdAt });
    lessonIds.add(lessonId);
    lessonOfAlbum.set(id(album.id), lessonId);
  });

  // Which tape each lesson belongs to.
  const tapeOfLesson = new Map<string, string>();
  const entryOfLesson = new Map<string, Raw>();
  entries.forEach((entry) => {
    const lessonId = id(entry.courseLessonId);
    if (!lessonId || !lessonIds.has(lessonId) || entryOfLesson.has(lessonId)) return;
    entryOfLesson.set(lessonId, entry);
    tapeOfLesson.set(lessonId, albumOfV1Tape.get(id(entry.tapeId)) || "");
  });
  albums.forEach((album) => {
    const lessonId = lessonOfAlbum.get(id(album.id)) || `course_${id(album.id)}`;
    if (lessonIds.has(lessonId) && !tapeOfLesson.get(lessonId)) tapeOfLesson.set(lessonId, id(album.id));
  });

  const materials: Material[] = [];
  const seenMaterialIds = new Set<string>();
  const turnIds = new Set<string>();
  let needsUnsortedTape = false;

  // A lesson 1.0 built from old entries carries their ids in its turn ids; when it
  // came from a single entry, that entry's title and notes describe it best.
  const entryInsideLesson = (lesson: Raw): Raw | undefined => {
    const turnIdList = objects(lesson.turns).map((turn) => id(turn.id));
    const covered = entries.filter((entry) => turnIdList.some((turnId) => turnId.startsWith(`${id(entry.id)}_turn_`)));
    return covered.length === 1 ? covered[0] : undefined;
  };

  lessons.forEach((lesson) => {
    const lessonId = id(lesson.id);
    if (seenMaterialIds.has(lessonId)) return;
    const sourceEntry = entryOfLesson.get(lessonId) ?? entryInsideLesson(lesson);
    const material = materialFromLesson(sourceEntry && !entryOfLesson.has(lessonId) ? { ...lesson, title: sourceEntry.title } : lesson, sourceEntry);
    if (!material.sentences.length) return;
    material.tapeId = tapeOfLesson.get(lessonId) || UNSORTED_TAPE_ID;
    if (material.tapeId === UNSORTED_TAPE_ID) needsUnsortedTape = true;
    material.sentences.forEach((sentence) => turnIds.add(sentence.id));
    materials.push(material);
    seenMaterialIds.add(lessonId);
  });

  // Entries no lesson covers yet (1.0 shows them as 素材 and builds the lesson when opened).
  entries.forEach((entry) => {
    const entryId = id(entry.id);
    const lessonId = id(entry.courseLessonId);
    if (lessonId && seenMaterialIds.has(lessonId)) return;
    if ([...turnIds].some((turnId) => turnId.startsWith(`${entryId}_turn_`))) return;
    if (seenMaterialIds.has(entryId)) return;
    const material = materialFromEntry(entry, albumOfV1Tape.get(id(entry.tapeId)) || UNSORTED_TAPE_ID);
    if (!material.sentences.length) return;
    materials.push(material);
    seenMaterialIds.add(entryId);
  });

  if (needsUnsortedTape) {
    tapes.push({
      id: UNSORTED_TAPE_ID,
      title: "其他素材",
      description: "1.0 里没有放进磁带的课程",
      color: TAPE_COLORS[tapes.length % TAPE_COLORS.length],
      order: tapes.length,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }

  const wordbooks = convertWordbooks(raw.wordbooks);
  const wordbookIds = new Set(wordbooks.map((wordbook) => wordbook.id));
  const cards = convertCards(raw, wordbookIds);
  const recordingKeys = [...new Set(materials.flatMap((material) => material.sentences.map((sentence) => sentence.recordingKey).filter(Boolean)))];

  return {
    tapes,
    materials,
    cards,
    wordbooks,
    dictionary: convertDictionary(raw.dictionaryEntries),
    settings: convertSettings(raw.settings),
    study: convertStudy(raw.study),
    recordingKeys
  };
}

function materialTypeOf(value: unknown, text: string): MaterialType {
  return MATERIAL_TYPES.includes(value as MaterialType) ? (value as MaterialType) : inferMaterialType(text);
}

function materialFromLesson(lesson: Raw, entry: Raw | undefined): Material {
  const turns = objects(lesson.turns);
  const text = turns.map((turn) => str(turn.text)).join("\n");
  // 1.0 stored narrator speakers for 文章/笔记/歌词 lessons itself. Lessons it built
  // from old entries say "磁带素材"; their speakers tell whether it is a dialogue.
  const declared = MATERIAL_TYPES.includes(lesson.materialType as MaterialType);
  const speakers = new Set(turns.map((turn) => str(turn.speakerLabel)).filter((label) => label && label !== "默认说话人"));
  const materialType = declared ? (lesson.materialType as MaterialType) : speakers.size >= 2 ? "情景对话" : materialTypeOf("", text);
  const narration = declared && NARRATION_TYPES.has(materialType);
  const usedIds = new Set<string>();
  const sentences: Sentence[] = turns
    .map((turn, index): Sentence => {
      const proposed = id(turn.id);
      const sentenceId = proposed && !usedIds.has(proposed) ? proposed : `${id(lesson.id)}_turn_${index + 1}`;
      usedIds.add(sentenceId);
      const recording = isObject(turn.recording) ? turn.recording : {};
      const mediaKey = str(recording.mediaKey);
      const recorded = recording.status === "recorded" && mediaKey && !mediaKey.startsWith("demo:");
      return {
        id: sentenceId,
        text: str(turn.text).trim(),
        translation: str(turn.translation).trim(),
        speakerId: narration ? "narrator" : str(turn.speakerId) || (index % 2 === 0 ? "a" : "b"),
        speakerLabel: narration ? "旁白" : str(turn.speakerLabel) || (index % 2 === 0 ? "A" : "B"),
        explanation: convertExplanation(turn.aiExplanation),
        recordingKey: recorded ? mediaKey : "",
        recordingMs: recorded ? count(recording.durationMs) : 0
      };
    })
    .filter((sentence) => sentence.text);
  const lexicalUnits: LexicalUnit[] = objects(lesson.lexicalUnits)
    .map((item) => ({
      text: str(item.text).trim(),
      lemma: (str(item.lemma) || str(item.text)).trim(),
      type: str(item.type, "expression").trim(),
      verified: item.verified === "dictionary" ? "dictionary" : ""
    }))
    .filter((item) => item.text && item.text.length <= 64)
    .slice(0, 200);
  return {
    id: id(lesson.id),
    tapeId: "",
    title: str(lesson.title).trim(),
    language: language(lesson.language),
    materialType,
    description: str(lesson.description),
    notes: entry ? str(entry.notes) : "",
    sentences,
    lexicalUnits,
    position: 0,
    finishedAt: null,
    studyCount: entry ? count(entry.practiceCount) : count(isObject(lesson.practice) ? lesson.practice.completed : 0),
    lastStudiedAt: entry ? optionalStamp(entry.lastPracticedAt) : null,
    createdAt: stamp(entry?.createdAt ?? lesson.createdAt),
    updatedAt: stamp(lesson.updatedAt ?? entry?.updatedAt)
  };
}

function materialFromEntry(entry: Raw, tapeId: string): Material {
  const text = str(entry.text);
  const materialType = materialTypeOf(entry.materialType, text);
  const narration = NARRATION_TYPES.has(materialType);
  const sentences: Sentence[] = splitSentences(text, materialType).map((part, index) => ({
    id: `${id(entry.id)}_turn_${index + 1}`,
    text: part.text,
    translation: "",
    speakerId: narration ? "narrator" : part.speakerId || "a",
    speakerLabel: narration ? "旁白" : part.speakerLabel || "A",
    explanation: null,
    recordingKey: "",
    recordingMs: 0
  }));
  return {
    id: id(entry.id),
    tapeId,
    title: str(entry.title).trim() || "未命名素材",
    language: language(entry.language),
    materialType,
    description: "",
    notes: str(entry.notes),
    sentences,
    lexicalUnits: [],
    position: 0,
    finishedAt: null,
    studyCount: count(entry.practiceCount),
    lastStudiedAt: optionalStamp(entry.lastPracticedAt),
    createdAt: stamp(entry.createdAt),
    updatedAt: stamp(entry.updatedAt)
  };
}

function convertExplanation(value: unknown): Explanation | null {
  if (!isObject(value)) return null;
  const strings = (items: unknown) => list(items).map((item) => str(item)).filter(Boolean);
  const explanation: Explanation = {
    summary: str(value.summary),
    structure: str(value.structure),
    grammarPoints: strings(value.grammarPoints),
    morphology: str(value.morphology),
    pitfalls: strings(value.pitfalls),
    examples: strings(value.examples),
    model: str(value.model),
    language: str(value.language),
    version: str(value.version),
    source: str(value.cacheSource) || "1.0",
    generatedAt: optionalStamp(value.generatedAt)
  };
  const hasContent = explanation.summary || explanation.structure || explanation.grammarPoints.length || explanation.pitfalls.length || explanation.examples.length;
  return hasContent ? explanation : null;
}

function convertWordbooks(value: unknown): Wordbook[] {
  const byId = new Map<string, Wordbook>();
  objects(value).forEach((item) => {
    const wordbookId = id(item.id);
    const title = str(item.title).trim();
    if (!wordbookId || !title || SYSTEM_WORDBOOK_IDS.has(wordbookId) || byId.has(wordbookId)) return;
    byId.set(wordbookId, {
      id: wordbookId,
      title,
      description: str(item.description),
      createdAt: stamp(item.createdAt),
      updatedAt: stamp(item.updatedAt)
    });
  });
  return [...byId.values()];
}

const STATUS_RANK: Record<CardStatus, number> = { new: 0, learning: 1, got: 2 };

function phraseKey(text: string): string {
  return text.toLocaleLowerCase("fr-FR").replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
}

function convertCards(raw: Raw, wordbookIds: Set<string>): Card[] {
  const cleanWordbooks = (value: unknown, single?: unknown) =>
    [...new Set([...list(value), ...(single ? [single] : [])].map((item) => id(item)).filter((item) => wordbookIds.has(item)))];
  const byKey = new Map<string, Card>();
  const add = (card: Card) => {
    const key = `${card.kind}:${card.normalized}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, card);
      return;
    }
    existing.status = STATUS_RANK[card.status] > STATUS_RANK[existing.status] ? card.status : existing.status;
    existing.translation ||= card.translation;
    existing.ipa ||= card.ipa;
    existing.lemma ||= card.lemma;
    existing.partOfSpeech ||= card.partOfSpeech;
    existing.sourceMaterialId ||= card.sourceMaterialId;
    existing.wordbookIds = [...new Set([...existing.wordbookIds, ...card.wordbookIds])];
    existing.seenForms = mergeSeenForms(existing.seenForms, card.seenForms);
    existing.practiceCount = Math.max(existing.practiceCount, card.practiceCount);
    existing.review ||= card.review;
  };

  objects(raw.phraseItems).forEach((item) => {
    const text = str(item.text).trim();
    if (!text) return;
    const kind = item.type === "word" ? "word" : "phrase";
    const status: CardStatus = item.status === "got" || item.status === "learning" ? item.status : "new";
    const due = optionalStamp(item.dueDate);
    add({
      id: id(item.id) || `v1_phrase_${byKey.size + 1}`,
      kind,
      text,
      normalized: kind === "word" ? normalizeWord(text) : phraseKey(text),
      lemma: kind === "word" ? normalizeWord(text) : "",
      translation: str(item.translation).trim(),
      ipa: "",
      partOfSpeech: "",
      language: language(item.language),
      status,
      wordbookIds: cleanWordbooks(item.wordbookIds),
      sourceMaterialId: id(item.sourceLessonId),
      sourceTitle: str(item.sourceTitle),
      seenForms: [],
      practiceCount: count(item.practiceCount),
      lastPracticedAt: optionalStamp(item.lastPracticedAt),
      review: due ? { due, stability: 0, difficulty: 0, reps: count(item.practiceCount), lapses: 0, lastReview: optionalStamp(item.lastPracticedAt) } : null,
      createdAt: stamp(item.createdAt),
      updatedAt: stamp(item.updatedAt)
    });
  });

  objects(raw.vocabulary).forEach((item) => {
    const word = str(item.word).trim();
    if (!word) return;
    const lemma = (str(item.lemma) || word).trim();
    const normalized = normalizeWord(str(item.normalized) || lemma);
    if (!normalized) return;
    add({
      id: id(item.id) || `v1_word_${byKey.size + 1}`,
      kind: "word",
      text: word,
      normalized,
      lemma,
      translation: str(item.zh).trim(),
      ipa: str(item.ipa),
      partOfSpeech: str(item.partOfSpeech) || str(item.pos),
      language: language(item.language),
      status: item.status === "got" ? "got" : "new",
      wordbookIds: cleanWordbooks(item.wordbookIds, item.wordbookId),
      sourceMaterialId: "",
      sourceTitle: "",
      seenForms: objects(item.seenForms)
        .map((entry) => ({ form: str(entry.form), normalized: normalizeWord(str(entry.normalized) || str(entry.form)), count: Math.max(1, count(entry.count)) }))
        .filter((entry) => entry.normalized),
      practiceCount: 0,
      lastPracticedAt: null,
      review: null,
      createdAt: stamp(item.createdAt),
      updatedAt: stamp(item.updatedAt)
    });
  });

  // Ids must stay unique even if 1.0 had two items with the same id.
  const usedIds = new Set<string>();
  return [...byKey.values()].map((card, index) => {
    if (usedIds.has(card.id)) card.id = `${card.id}_${index + 1}`;
    usedIds.add(card.id);
    return card;
  });
}

function mergeSeenForms(left: Card["seenForms"], right: Card["seenForms"]): Card["seenForms"] {
  const merged = new Map(left.map((entry) => [entry.normalized, { ...entry }]));
  right.forEach((entry) => {
    const current = merged.get(entry.normalized);
    if (current) current.count = Math.max(current.count, entry.count);
    else merged.set(entry.normalized, { ...entry });
  });
  return [...merged.values()];
}

function convertDictionary(value: unknown): DictionaryEntry[] {
  if (!isObject(value)) return [];
  return Object.entries(value)
    .filter(([key, item]) => key && isObject(item))
    .map(([key, item]) => {
      const entry = item as Raw;
      return {
        key: key.slice(0, 200),
        lemma: str(entry.lemma),
        partOfSpeech: str(entry.partOfSpeech),
        senses: list(entry.senses).map((sense) => str(sense)).filter(Boolean).slice(0, 20),
        contextMeaning: str(entry.contextMeaning),
        formNote: str(entry.formNote),
        usageNote: str(entry.usageNote),
        model: str(entry.model),
        version: str(entry.version),
        updatedAt: stamp(entry.updatedAt)
      };
    });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function convertSettings(value: unknown): Partial<Settings> {
  if (!isObject(value)) return {};
  const settings: Partial<Settings> = {};
  const rate = Number(value.rate);
  if (Number.isFinite(rate) && rate > 0) settings.rate = clamp(rate, 0.5, 1.5);
  const repeat = Number(value.repeat);
  if (Number.isFinite(repeat) && repeat >= 1) settings.repeat = clamp(Math.round(repeat), 1, 10);
  const pause = Number(value.pause);
  if (Number.isFinite(pause) && pause >= 0) settings.gapMs = Math.round(clamp(pause, 0, 10) * 1000);
  if (typeof value.voice === "string" && value.voice && value.voiceLocked !== false) settings.voice = value.voice;
  if (value.systemLanguage === "zh" || value.systemLanguage === "en" || value.systemLanguage === "fr") settings.systemLanguage = value.systemLanguage;
  return { ...pickDefined(settings, DEFAULT_SETTINGS) };
}

function convertStudy(value: unknown): Partial<StudyStats> {
  if (!isObject(value)) return {};
  return pickDefined({
    streak: count(value.streak),
    lastStudyDate: str(value.lastStudyDate) || null,
    dailyGoal: Math.max(1, count(value.dailyGoal) || DEFAULT_STUDY.dailyGoal),
    cardsReviewed: count(value.cardsReviewed),
    cardsKnown: count(value.cardsKnown)
  }, DEFAULT_STUDY);
}

function pickDefined<T extends object>(value: Partial<T>, shape: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => key in shape && item !== undefined)) as Partial<T>;
}
