// Offline dictionary lookup, ported from 1.0 (dictionary.js) so words resolve the
// same way: hand-reviewed words first (curated.json), then the exact headword,
// then inflected forms (voudrais → vouloir), then an unambiguous accent-free
// spelling (ecole → école). Data: one hashed shard per word, fetched on demand.
//
// Two fixes over 1.0: interjection look-alikes ("allez" → "come on!") give way
// to the verb when the word sits next to a subject ("allez-vous", "vous allez"),
// and a domain tag such as "[医]" is no longer shown as part of a meaning.

export type Language = "fr" | "en";

export interface DictEntry {
  key: string;
  language: Language;
  word: string;
  ipa: string;
  zhSenses: string[];
  enSenses: string[];
  posList: string[];
  audio: string;
  source: string;
}

export interface FormInfo {
  lemma: string;
  pos: string;
  features: string;
  ipa: string;
}

export interface MeaningGroup {
  pos: string;
  gender: string;
  senses: string[];
}

// Where the Chinese meanings come from, from most to least reliable:
// hand-reviewed, the local AI's translation of the Wiktionary senses, or 1.0's
// machine-matched column (often wrong, shown only as a hint).
export type MeaningSource = "curated" | "ai" | "machine" | "none";

export interface LookupResult extends DictEntry {
  surface: string;
  lemma: string;
  form?: FormInfo;
  formIpa?: string;
  isInflected: boolean;
  lookupKey: string;
  curated?: boolean;
  fuzzy?: boolean;
  meanings: MeaningGroup[];
  meaningSource: MeaningSource;
}

type Resolved = Omit<LookupResult, "meanings" | "meaningSource">;

export interface LookupOptions {
  context?: string;
  occurrence?: number;
}

type Row = [string, string?, string?, string?, string?, string?, string?];
type Shard = Record<string, unknown>;
export type FetchJson = (path: string) => Promise<unknown>;

const SHARD_COUNT = 128;

const POS_ALIASES: Record<string, string> = {
  v: "verb", vi: "verb", vt: "verb", verb: "verb", verbe: "verb",
  n: "noun", noun: "noun", nom: "noun",
  "proper noun": "proper noun", proper_noun: "proper noun",
  adj: "adjective", adjective: "adjective", adjectif: "adjective",
  adv: "adverb", adverb: "adverb", adverbe: "adverb",
  pron: "pronoun", pronoun: "pronoun", pronom: "pronoun",
  prep: "preposition", preposition: "preposition", "préposition": "preposition",
  conj: "conjunction", conjunction: "conjunction", conjonction: "conjunction",
  det: "determiner", determiner: "determiner", "déterminant": "determiner",
  art: "article", article: "article",
  int: "interjection", intj: "interjection", interj: "interjection", interjection: "interjection",
  num: "numeral", numeral: "numeral", phrase: "phrase",
  "locution adverbiale": "adverbial phrase", "locution nominale": "noun phrase",
  "verbe pronominal": "pronominal verb", "1re personne": "first person"
};

const POS_LABELS: Record<string, string> = {
  verb: "动词", noun: "名词", "proper noun": "专有名词", adjective: "形容词",
  adverb: "副词", pronoun: "代词", preposition: "介词", conjunction: "连词",
  determiner: "限定词", article: "冠词", interjection: "感叹词", numeral: "数词", phrase: "固定表达",
  "adverbial phrase": "副词短语", "noun phrase": "名词短语", "pronominal verb": "代词式动词", "first person": "第一人称"
};

const FEATURE_LABELS: Record<string, string> = {
  indicative: "直陈式", subjunctive: "虚拟式", conditional: "条件式", imperative: "命令式",
  infinitive: "不定式", participle: "分词", gerund: "副动词",
  present: "现在时", imperfect: "未完成过去时", future: "将来时", past: "过去", historic: "简单过去时", simplePast: "简单过去时",
  "first person": "第一人称", firstPerson: "第一人称", "second person": "第二人称", secondPerson: "第二人称",
  "third person": "第三人称", thirdPerson: "第三人称",
  singular: "单数", plural: "复数", masculine: "阳性", feminine: "阴性", reflexive: "自反", invariable: "不变"
};

const FEATURE_ORDER = ["indicative", "subjunctive", "conditional", "imperative", "infinitive", "participle", "gerund", "present", "imperfect", "future", "past", "historic", "simplePast"];

const MOJIBAKE: [string, string][] = [
  ["â€™", "’"], ["â€˜", "‘"], ["â€œ", "“"], ["â€", "”"], ["â€“", "–"], ["â€”", "—"],
  ["Å“", "œ"], ["Å’", "Œ"], ["Ã§", "ç"], ["Ã©", "é"], ["Ã¨", "è"], ["Ãª", "ê"],
  ["Ã«", "ë"], ["Ã ", "à"], ["Ã¢", "â"], ["Ã´", "ô"], ["Ã¹", "ù"], ["Ã»", "û"],
  ["Ã®", "î"], ["Ã¯", "ï"]
];

export function cleanText(value: unknown): string {
  let output = String(value ?? "")
    .replace(/\\n|\\r/g, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
  MOJIBAKE.forEach(([broken, fixed]) => {
    output = output.replaceAll(broken, fixed);
  });
  output = output.replace(/Â(?=[\s «»°])/g, "");
  return output
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F�]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

export function normalizeIpa(value: unknown): string {
  const cleaned = cleanText(value).replace(/^(?:IPA|API|音标)\s*[:：]?\s*/i, "");
  if (!cleaned) return "";
  const match = cleaned.match(/\/([^/\n]{1,100})\//) || cleaned.match(/\[([^\]\n]{1,100})\]/);
  const core = cleanText(match ? match[1] : cleaned).replace(/^[/[]|[\]/]$/g, "").trim();
  return core ? `/${core}/` : "";
}

export function canonicalPosList(value: unknown): string[] {
  const output: string[] = [];
  cleanText(value)
    .split(/\s*(?:[；;,|]|\s\/\s|·)\s*/)
    .map((part) => part.trim().toLocaleLowerCase())
    .filter(Boolean)
    .forEach((part) => {
      const canonical = POS_ALIASES[part] || part;
      if (!output.includes(canonical)) output.push(canonical);
    });
  return output;
}

export function posLabel(posList: string[]): string {
  return posList.map((part) => POS_LABELS[part] || part).join(" / ") || "词语";
}

// "conditional · first person · singular" → "条件式 · 第一人称 · 单数"; unknown
// tokens (pronunciation debris in the source data) are left out.
export function featuresLabel(features: string): string {
  const tokens = features.split(/\s*·\s*/).filter((token) => FEATURE_LABELS[token]);
  tokens.sort((a, b) => {
    const left = FEATURE_ORDER.indexOf(a);
    const right = FEATURE_ORDER.indexOf(b);
    return (left < 0 ? 99 : left) - (right < 0 ? 99 : right);
  });
  return [...new Set(tokens.map((token) => FEATURE_LABELS[token]))].join(" · ");
}

function cleanSense(value: string, language: "zh" | "en"): string {
  const output = cleanText(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/!?\[[^\]]*image[^\]]*\]\([^)]*\)/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/^\[[^\]]{1,4}\]\s*/u, "")
    .replace(/^[（(]?(?:法|英|网络|网路)[）)]?\s*/u, "")
    .replace(/^(?:n|v|vi|vt|adj|adv|prep|pron|conj|num|art|int|intj|interj|a)\.\s*/i, "")
    .replace(/\(\s*[^()㐀-鿿]+\s*\)/gu, "")
    .replace(/（\s*[^（）㐀-鿿]+\s*）/gu, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,，、;；:：.。·•—-]+|[\s,，、;；:：·•—-]+$/g, "")
    .trim();
  if (!output) return "";
  if (/(?:国际音标|音标|发音|读音|词源|源自|继承自|同音词|近音词|参考|参见)/.test(output)) return "";
  if (language === "zh") {
    if (!/[㐀-鿿]/u.test(output)) return "";
    if (/[A-Za-z]{3,}\s*的(?:复数|单数|变位|过去|现在)形式/u.test(output)) return "";
  }
  return output;
}

export function senseList(value: unknown, language: "zh" | "en" = "zh", limit = 12): string[] {
  const output: string[] = [];
  const keys = new Set<string>();
  for (const candidate of cleanText(value).split(/\s*(?:\n+|；|;|•|\s+·\s+)\s*/)) {
    const sense = cleanSense(candidate, language);
    if (!sense) continue;
    const key = sense.toLocaleLowerCase().replace(/[\s,，、.。()（）]/g, "");
    if (!key || keys.has(key)) continue;
    keys.add(key);
    output.push(sense);
    if (output.length >= limit) break;
  }
  return output;
}

function formatSource(value: unknown): string {
  const parts = cleanText(value)
    .split(/\s*(?:；|;|·|\n)\s*/)
    .map((part) => part.replace(/^来源[:：]\s*/, "").trim())
    .filter(Boolean)
    .filter((part) => !/^本地词典$/.test(part));
  return [...new Set(parts)].join("、") || "OoFR 离线开放词典";
}

export function normalize(value: string): string {
  return String(value || "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[’]/g, "'")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{M}\p{N}'\- ]/gu, "")
    .replace(/^['\- ]+|['\- ]+$/g, "");
}

export function fold(value: string): string {
  return normalize(value).normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function shardFor(key: string): string {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  return (hash % SHARD_COUNT).toString(16).padStart(2, "0");
}

function unpackEntry(row: Row | undefined | null, key: string, language: Language): DictEntry | null {
  if (!row) return null;
  return {
    key,
    language,
    word: cleanText(row[0]) || key,
    ipa: normalizeIpa(row[1]),
    zhSenses: senseList(row[2], "zh", 24),
    enSenses: senseList(row[3], "en", 20),
    posList: canonicalPosList(row[4]),
    audio: cleanText(row[5]),
    source: formatSource(row[6])
  };
}

const NOUN_MARKERS = new Set(["un", "une", "le", "la", "les", "des", "du", "ce", "cet", "cette", "ces", "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses", "notre", "nos", "votre", "vos", "leur", "leurs", "en", "à", "au", "aux"]);
const SUBJECT_MARKERS = new Set(["je", "j'", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "ça", "cela", "ce", "qui"]);
const OBJECT_CLITICS = new Set(["le", "la", "les", "l'", "me", "m'", "te", "t'", "lui", "leur", "nous", "vous", "se", "s'", "en", "y"]);
// Subject-verb inversion: "allez-vous", "va-t-il".
function isInverted(context: string, key: string): boolean {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}])${escaped}-(t-)?(je|tu|il|elle|on|nous|vous|ils|elles)(?![\\p{L}])`, "iu").test(context.replace(/[’]/g, "'"));
}

function contextTokens(value: string): string[] {
  return String(value || "").toLocaleLowerCase().replace(/[’]/g, "'").normalize("NFC").match(/[\p{L}\p{M}]+(?:'[\p{L}\p{M}]+)?/gu) || [];
}

function indexInContext(tokens: string[], key: string, occurrence = 0): number {
  const matches: number[] = [];
  tokens.forEach((token, position) => {
    if (normalize(token) === key) matches.push(position);
  });
  if (!matches.length) return -1;
  return matches[Math.min(Math.max(0, Number(occurrence) || 0), matches.length - 1)];
}

function frenchElision(value: string): string {
  const match = value.match(/^(c|d|j|l|m|n|qu|s|t|jusqu|lorsqu|puisqu)'(.+)$/u);
  return match ? match[2] : "";
}

function englishCandidates(key: string): string[] {
  const candidates: string[] = [];
  const add = (value: string) => {
    const normalized = normalize(value);
    if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
  };
  if (key.endsWith("ies")) add(`${key.slice(0, -3)}y`);
  for (const suffix of ["ing", "ed"]) {
    if (!key.endsWith(suffix)) continue;
    const stem = key.slice(0, -suffix.length);
    add(stem);
    add(`${stem}e`);
    if (stem.length > 2 && stem.at(-1) === stem.at(-2)) add(stem.slice(0, -1));
  }
  if (key.endsWith("es")) add(key.slice(0, -2));
  if (key.endsWith("s")) add(key.slice(0, -1));
  return candidates.filter((candidate) => candidate.length >= 3);
}

export class Dictionary {
  private shards = new Map<string, Promise<Shard>>();
  private curated: Promise<Record<string, Record<string, Record<string, string>>>> | null = null;

  constructor(private readonly fetchJson: FetchJson) {}

  private loadCurated() {
    if (!this.curated) {
      this.curated = this.fetchJson("curated.json")
        .then((value) => (value && typeof value === "object" ? (value as Record<string, Record<string, Record<string, string>>>) : {}))
        .catch(() => {
          this.curated = null;
          return {};
        });
    }
    return this.curated;
  }

  private loadShard(language: Language, kind: "entries" | "forms" | "aliases" | "zh", key: string): Promise<Shard> {
    const cacheKey = `${language}:${kind}:${shardFor(key)}`;
    let pending = this.shards.get(cacheKey);
    if (!pending) {
      pending = this.fetchJson(`${language}/${kind}-${shardFor(key)}.json`)
        .then((value) => (value && typeof value === "object" ? (value as Shard) : {}))
        .catch(() => {
          // Forget a failed shard so the next lookup tries again (e.g. back online).
          this.shards.delete(cacheKey);
          return {};
        });
      this.shards.set(cacheKey, pending);
    }
    return pending;
  }

  private async curatedEntry(key: string, language: Language): Promise<DictEntry | null> {
    const table = (await this.loadCurated())[language];
    const row = table && Object.prototype.hasOwnProperty.call(table, key) ? (table[key] as unknown as Record<string, string>) : null;
    if (!row) return null;
    return unpackEntry([row.word || key, row.ipa, row.zh, row.en, row.pos, "", "OoFR 校订"], key, language);
  }

  private async exactEntry(key: string, language: Language): Promise<DictEntry | null> {
    const rows = await this.loadShard(language, "entries", key);
    return unpackEntry(rows[key] as Row | undefined, key, language);
  }

  // The dictionary form a word was traced back to (voudrais → vouloir): the
  // hand-reviewed entry when there is one, so common verbs read correctly.
  private async headword(key: string, language: Language): Promise<(DictEntry & { curated?: boolean }) | null> {
    const curated = await this.curatedEntry(normalize(key), language);
    return curated ? { ...curated, curated: true } : this.exactEntry(key, language);
  }

  private async formInfo(key: string, language: Language): Promise<FormInfo | null> {
    if (language !== "fr") return null;
    const row = (await this.loadShard(language, "forms", key))[key] as string[] | undefined;
    return row ? { lemma: row[0], pos: row[1] || "", features: row[2] || "", ipa: row[3] || "" } : null;
  }

  private async previousWordPos(tokens: string[], index: number): Promise<string[]> {
    const previous = index > 0 ? normalize(tokens[index - 1]) : "";
    if (!previous) return [];
    const entry = await this.exactEntry(previous, "fr");
    const form = await this.formInfo(previous, "fr");
    return [...(entry?.posList || []), ...(form?.pos ? [form.pos] : [])];
  }

  private contextSuggestsNoun(tokens: string[], index: number, previousPos: string[]): boolean {
    const previous = tokens[index - 1] || "";
    const twoBack = tokens[index - 2] || "";
    if (OBJECT_CLITICS.has(previous) && SUBJECT_MARKERS.has(twoBack)) return false;
    if (NOUN_MARKERS.has(previous) || (previous === "de" && twoBack === "pas")) return true;
    return NOUN_MARKERS.has(twoBack) && previousPos.includes("adjective");
  }

  private async preferVerbForm(surface: string, direct: DictEntry, form: FormInfo | null, options: LookupOptions): Promise<boolean> {
    if (!form?.lemma || form.pos !== "verb" || !options.context) return false;
    const parts = new Set(direct.posList);
    // An adverb is read as itself: "comment" is "how", not a form of the archaic "commer".
    if (parts.has("verb") || [...parts].some((part) => ["pronoun", "preposition", "conjunction", "determiner", "article", "adverb"].includes(part))) return false;
    if (![...parts].some((part) => ["noun", "proper noun", "adjective", "interjection"].includes(part))) return false;
    const key = normalize(surface);
    const tokens = contextTokens(options.context);
    const index = indexInContext(tokens, key, options.occurrence);
    if (index < 0) return false;
    const previous = tokens[index - 1] || "";
    const twoBack = tokens[index - 2] || "";
    if (isInverted(options.context, key)) return true;
    if (OBJECT_CLITICS.has(previous) && SUBJECT_MARKERS.has(twoBack)) return true;
    if (this.contextSuggestsNoun(tokens, index, await this.previousWordPos(tokens, index))) return false;
    if (SUBJECT_MARKERS.has(previous)) return true;
    if (parts.has("interjection") && !parts.has("noun") && !parts.has("adjective")) return false;
    return String(surface).trim() === String(surface).trim().toLocaleLowerCase();
  }

  async lookup(surface: string, language: Language = "fr", options: LookupOptions = {}): Promise<LookupResult | null> {
    const resolved = await this.resolve(surface, language, options);
    return resolved ? this.withMeanings(resolved, language) : null;
  }

  private async withMeanings(result: Resolved, language: Language): Promise<LookupResult> {
    if (result.curated) {
      return { ...result, meanings: [{ pos: posLabel(result.posList), gender: "", senses: result.zhSenses }], meaningSource: "curated" };
    }
    const rows = language === "fr" ? ((await this.loadShard(language, "zh", normalize(result.lemma)))[normalize(result.lemma)] as { pos: string; gender: string; zh: string[] }[] | undefined) : undefined;
    if (rows?.length) {
      return { ...result, meanings: rows.map((row) => ({ pos: posLabel(canonicalPosList(row.pos)), gender: row.gender, senses: row.zh })), meaningSource: "ai" };
    }
    if (result.zhSenses.length) {
      return { ...result, meanings: [{ pos: posLabel(result.posList), gender: "", senses: result.zhSenses }], meaningSource: "machine" };
    }
    return { ...result, meanings: [], meaningSource: "none" };
  }

  private expressionKeys: Promise<Set<string>> | null = null;

  private loadExpressions(): Promise<Set<string>> {
    if (!this.expressionKeys) {
      this.expressionKeys = this.fetchJson("fr/expressions.json")
        .then((value) => new Set(Array.isArray(value) ? value.map(String) : []))
        .catch(() => {
          this.expressionKeys = null;
          return new Set<string>();
        });
    }
    return this.expressionKeys;
  }

  // A fixed expression the tapped word belongs to ("bien sûr", "tout à l'heure",
  // "s'il vous plaît"): the longest one in the sentence that the dictionary knows.
  // Only expressions listed in expressions.json are fetched, so a tap costs at most one shard.
  async findExpression(words: string[], index: number, language: Language = "fr"): Promise<LookupResult | null> {
    if (language !== "fr" || index < 0 || index >= words.length) return null;
    const known = await this.loadExpressions();
    const curatedTable = (await this.loadCurated())[language] ?? {};
    for (let size = Math.min(5, words.length); size >= 2; size -= 1) {
      for (let start = Math.max(0, index - size + 1); start <= index && start + size <= words.length; start += 1) {
        const phrase = words.slice(start, start + size).join(" ");
        const key = normalize(phrase);
        if (!known.has(key) && !Object.prototype.hasOwnProperty.call(curatedTable, key)) continue;
        const entry = await this.headword(key, language);
        if (entry) return this.withMeanings({ ...entry, surface: phrase, lemma: entry.word, isInflected: false, lookupKey: key }, language);
      }
    }
    return null;
  }

  private async resolve(surface: string, language: Language, options: LookupOptions): Promise<Resolved | null> {
    const originalKey = normalize(surface);
    if (!originalKey) return null;
    const core = language === "fr" ? frenchElision(originalKey) : "";
    const candidates = [originalKey, core].filter(Boolean);
    const base = { surface: String(surface) };

    for (const key of candidates) {
      const curated = await this.curatedEntry(key, language);
      if (curated) return { ...curated, ...base, lemma: curated.word, isInflected: false, lookupKey: key, curated: true };
      const direct = await this.exactEntry(key, language);
      if (!direct) continue;
      if (language === "fr") {
        const form = await this.formInfo(key, language);
        if (form && (await this.preferVerbForm(surface, direct, form, options))) {
          const lemmaEntry = await this.headword(form.lemma, language);
          if (lemmaEntry) return { ...lemmaEntry, ...base, lemma: lemmaEntry.word, form, formIpa: form.ipa || direct.ipa, isInflected: true, lookupKey: key };
        }
      }
      return { ...direct, ...base, lemma: direct.word, isInflected: false, lookupKey: key };
    }

    for (const key of candidates) {
      const form = await this.formInfo(key, language);
      if (!form?.lemma) continue;
      if (language === "fr" && form.pos === "verb" && options.context) {
        // "Les voyages" is the plural noun, not a form of voyager.
        const tokens = contextTokens(options.context);
        const index = indexInContext(tokens, key, options.occurrence);
        const singular = key.replace(/[sx]$/, "");
        if (index >= 0 && singular !== key && this.contextSuggestsNoun(tokens, index, await this.previousWordPos(tokens, index))) {
          const noun = await this.exactEntry(singular, language);
          if (noun?.posList.includes("noun")) {
            return { ...noun, ...base, lemma: noun.word, form: { lemma: noun.word, pos: "noun", features: "plural", ipa: "" }, formIpa: noun.ipa, isInflected: true, lookupKey: key };
          }
        }
      }
      const lemmaEntry = await this.headword(form.lemma, language);
      if (lemmaEntry) return { ...lemmaEntry, ...base, lemma: lemmaEntry.word, form, formIpa: form.ipa, isInflected: true, lookupKey: key };
    }

    if (language === "en") {
      for (const candidate of englishCandidates(originalKey)) {
        const entry = await this.exactEntry(candidate, language);
        if (entry && /^[A-Z0-9.]{1,4}$/.test(entry.word) && !/^[A-Z0-9.]{1,4}$/.test(String(surface).trim())) continue;
        if (entry) return { ...entry, ...base, lemma: entry.word, isInflected: true, lookupKey: candidate };
      }
    }

    // "ecole" finds "école" only when exactly one accented headword matches (never a/à, ca/ça).
    const folded = fold(originalKey);
    if (folded) {
      const keys = ((await this.loadShard(language, "aliases", folded))[folded] as string[] | undefined) || [];
      if (keys.length === 1) {
        const entry = await this.exactEntry(keys[0], language);
        if (entry) return { ...entry, ...base, lemma: entry.word, isInflected: false, lookupKey: keys[0], fuzzy: true };
      }
    }
    return null;
  }
}

// The app's dictionary: files under ./dictionary next to index.html. The
// service worker keeps every shard that was fetched, so looked-up words keep
// working offline; the version in the address keeps those copies current.
export const dictionary = new Dictionary(async (path) => {
  const response = await fetch(`./dictionary/${path}?v=${encodeURIComponent(__DICTIONARY_VERSION__)}`);
  // A shard that does not exist (no AI meanings in it yet) is simply empty.
  if (response.status === 404) return {};
  if (!response.ok) throw new Error(`Dictionary ${path}: ${response.status}`);
  return response.json();
});
