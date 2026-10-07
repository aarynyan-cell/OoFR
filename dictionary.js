(function initOoFRDictionary(global) {
  "use strict";

  const BASE_URL = "./dictionary";
  const PACK_VERSION = String(global.OOFR_VERSION || "1.0.0");
  const SHARD_COUNT = 128;
  const manifestPromise = fetch(`${BASE_URL}/manifest.json?v=${PACK_VERSION}`, { cache: "no-cache" }).then((response) => {
    if (!response.ok) throw new Error(`Dictionary manifest ${response.status}`);
    return response.json();
  });
  const shardCache = new Map();

  const POS_ALIASES = {
    v: "verb", vi: "verb", vt: "verb", verb: "verb", verbe: "verb",
    n: "noun", noun: "noun", nom: "noun",
    "proper noun": "proper noun", "proper_noun": "proper noun",
    adj: "adjective", adjective: "adjective", adjectif: "adjective",
    adv: "adverb", adverb: "adverb", adverbe: "adverb",
    pron: "pronoun", pronoun: "pronoun", pronom: "pronoun",
    prep: "preposition", preposition: "preposition", "préposition": "preposition",
    conj: "conjunction", conjunction: "conjunction", "conjonction": "conjunction",
    det: "determiner", determiner: "determiner", "déterminant": "determiner",
    art: "article", article: "article",
    int: "interjection", intj: "interjection", interj: "interjection", interjection: "interjection",
    num: "numeral", numeral: "numeral", phrase: "phrase",
    "locution adverbiale": "adverbial phrase", "locution nominale": "noun phrase",
    "verbe pronominal": "pronominal verb", "1re personne": "first person"
  };

  const POS_LABELS = {
    zh: {
      verb: "动词", noun: "名词", "proper noun": "专有名词", adjective: "形容词",
      adverb: "副词", pronoun: "代词", preposition: "介词", conjunction: "连词",
      determiner: "限定词", article: "冠词", interjection: "感叹词", numeral: "数词", phrase: "固定表达",
      "adverbial phrase": "副词短语", "noun phrase": "名词短语", "pronominal verb": "代词式动词", "first person": "第一人称"
    },
    en: {
      verb: "verb", noun: "noun", "proper noun": "proper noun", adjective: "adjective",
      adverb: "adverb", pronoun: "pronoun", preposition: "preposition", conjunction: "conjunction",
      determiner: "determiner", article: "article", interjection: "interjection", numeral: "numeral", phrase: "fixed expression",
      "adverbial phrase": "adverbial phrase", "noun phrase": "noun phrase", "pronominal verb": "pronominal verb", "first person": "first person"
    },
    fr: {
      verb: "verbe", noun: "nom", "proper noun": "nom propre", adjective: "adjectif",
      adverb: "adverbe", pronoun: "pronom", preposition: "préposition", conjunction: "conjonction",
      determiner: "déterminant", article: "article", interjection: "interjection", numeral: "numéral", phrase: "locution",
      "adverbial phrase": "locution adverbiale", "noun phrase": "locution nominale", "pronominal verb": "verbe pronominal", "first person": "première personne"
    }
  };

  const MOJIBAKE_REPLACEMENTS = new Map([
    ["â€™", "’"], ["â€˜", "‘"], ["â€œ", "“"], ["â€", "”"], ["â€“", "–"], ["â€”", "—"],
    ["Å“", "œ"], ["Å’", "Œ"], ["Ã§", "ç"], ["Ã©", "é"], ["Ã¨", "è"], ["Ãª", "ê"],
    ["Ã«", "ë"], ["Ã ", "à"], ["Ã¢", "â"], ["Ã´", "ô"], ["Ã¹", "ù"], ["Ã»", "û"],
    ["Ã®", "î"], ["Ã¯", "ï"], ["Â", ""]
  ]);

  function cleanText(value) {
    let output = String(value || "")
      .replace(/\\n|\\r/g, "\n")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
    MOJIBAKE_REPLACEMENTS.forEach((replacement, broken) => { output = output.replaceAll(broken, replacement); });
    return output
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .trim();
  }

  function normalizeIpa(value) {
    const cleaned = cleanText(value).replace(/^(?:IPA|API|音标)\s*[:：]?\s*/i, "");
    if (!cleaned) return "";
    const match = cleaned.match(/\/([^/\n]{1,100})\//) || cleaned.match(/\[([^\]\n]{1,100})\]/);
    const core = cleanText(match ? match[1] : cleaned).replace(/^[/[]|[\]/]$/g, "").trim();
    return core ? `/${core}/` : "";
  }

  function canonicalPosList(value) {
    const output = [];
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

  function formatPartOfSpeech(value, language = "zh") {
    const labels = POS_LABELS[language] || POS_LABELS.zh;
    const parts = canonicalPosList(value).map((part) => labels[part] || part);
    return parts.join(" / ") || (language === "zh" ? "词语" : language === "fr" ? "mot ou locution" : "word or expression");
  }

  function cleanSense(value, language) {
    let output = cleanText(value)
      .replace(/<[^>]*>/g, " ")
      .replace(/!?\[[^\]]*image[^\]]*\]\([^)]*\)/gi, " ")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/^[（(]?(?:法|英|网络|网路)[）)]?\s*/u, "")
      .replace(/^(?:n|v|vi|vt|adj|adv|prep|pron|conj|num|art|int|intj|interj)\.\s*/i, "")
      .replace(/\(\s*[^()\u3400-\u9fff]+\s*\)/gu, "")
      .replace(/（\s*[^（）\u3400-\u9fff]+\s*）/gu, "")
      .replace(/\s+/g, " ")
      .replace(/^[\s,，、;；:：.。·•—-]+|[\s,，、;；:：·•—-]+$/g, "")
      .trim();
    if (!output) return "";
    if (/(?:国际音标|音标|发音|读音|词源|源自|继承自|同音词|近音词|参考|参见)/.test(output)) return "";
    if (language === "zh") {
      if (!/[\u3400-\u9fff]/u.test(output)) return "";
      if (/[A-Za-z]{3,}\s*的(?:复数|单数|变位|过去|现在)形式/u.test(output)) return "";
    }
    return output;
  }

  function senseList(value, language = "zh", limit = 12) {
    const candidates = cleanText(value).split(/\s*(?:\n+|；|;|•|\s+·\s+)\s*/);
    const output = [];
    const keys = new Set();
    for (const candidate of candidates) {
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

  function formatMeaning(value, { language = "zh", limit = 6, numbered = true } = {}) {
    const senses = senseList(value, language, limit);
    if (!senses.length) return language === "zh" ? "暂无简中释义" : language === "fr" ? "Définition à compléter" : "Meaning unavailable";
    if (!numbered || senses.length === 1) return senses.join(language === "zh" ? "；" : "; ");
    return senses.map((sense, index) => `${index + 1}. ${sense}`).join("\n");
  }

  function formatSource(value) {
    const parts = cleanText(value)
      .split(/\s*(?:；|;|·|\n)\s*/)
      .map((part) => part.replace(/^来源[:：]\s*/, "").trim())
      .filter(Boolean)
      .filter((part) => !/^本地词典$/.test(part));
    return Array.from(new Set(parts)).join("、") || "OoFR 离线开放词典";
  }

  function normalize(value) {
    return String(value || "")
      .trim()
      .toLocaleLowerCase()
      .replace(/[’]/g, "'")
      .normalize("NFC")
      .replace(/\s+/g, " ")
      .replace(/[^\p{L}\p{M}\p{N}'\- ]/gu, "")
      .replace(/^['\- ]+|['\- ]+$/g, "");
  }

  function fold(value) {
    return normalize(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function shardFor(key) {
    let hash = 0;
    for (let index = 0; index < key.length; index += 1) {
      hash = ((hash * 31) + key.charCodeAt(index)) >>> 0;
    }
    return (hash % SHARD_COUNT).toString(16).padStart(2, "0");
  }

  async function loadShard(language, kind, key) {
    const shard = shardFor(key);
    const cacheKey = `${language}:${kind}:${shard}`;
    if (!shardCache.has(cacheKey)) {
      const promise = fetch(`${BASE_URL}/${language}/${kind}-${shard}.json?v=${PACK_VERSION}`, { cache: "no-cache" })
        .then((response) => {
          if (!response.ok) throw new Error(`Dictionary shard ${response.status}`);
          return response.json();
        })
        .catch(() => ({}));
      shardCache.set(cacheKey, promise);
    }
    return shardCache.get(cacheKey);
  }

  function unpackEntry(row, key, language) {
    if (!row) return null;
    const zhSenses = senseList(row[2], "zh", 24);
    const enSenses = senseList(row[3], "en", 20);
    const posList = canonicalPosList(row[4]);
    return {
      key,
      language,
      word: cleanText(row[0]) || key,
      ipa: normalizeIpa(row[1]),
      zh: zhSenses.join("；"),
      en: enSenses.join("; "),
      zhSenses,
      enSenses,
      pos: posList.join("；"),
      posList,
      audio: cleanText(row[5]),
      source: formatSource(row[6])
    };
  }

  const FRENCH_NOUN_MARKERS = new Set([
    "un", "une", "le", "la", "les", "des", "du", "ce", "cet", "cette", "ces",
    "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses", "notre", "nos",
    "votre", "vos", "leur", "leurs", "en", "à", "au", "aux"
  ]);

  const FRENCH_SUBJECT_MARKERS = new Set([
    "je", "j'", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "ça", "cela", "ce", "qui"
  ]);

  function contextTokens(value) {
    return String(value || "")
      .toLocaleLowerCase()
      .replace(/[’]/g, "'")
      .normalize("NFC")
      .match(/[\p{L}\p{M}]+(?:'[\p{L}\p{M}]+)?/gu) || [];
  }

  function shouldPreferFrenchForm(surface, direct, form, context) {
    if (!form?.lemma || form.pos !== "verb" || !context) return false;
    const directParts = new Set(String(direct?.pos || "").split(/[；;,]/).map((item) => item.trim()));
    if (directParts.has("verb") || [...directParts].some((item) => ["pronoun", "preposition", "conjunction", "determiner", "article"].includes(item))) {
      return false;
    }
    if (![...directParts].some((item) => ["noun", "proper noun", "adjective"].includes(item))) return false;
    const key = normalize(surface);
    const tokens = contextTokens(context);
    const index = tokens.findIndex((token) => normalize(token) === key);
    if (index < 0) return false;
    const previous = tokens[index - 1] || "";
    if (FRENCH_NOUN_MARKERS.has(previous) || (previous === "de" && tokens[index - 2] === "pas")) return false;
    if (FRENCH_SUBJECT_MARKERS.has(previous)) return true;
    // A lower-case noun/verb homograph without a determiner is much more often
    // the finite verb in running text (e.g. “mon téléphone marche bien”).
    return String(surface).trim() === String(surface).trim().toLocaleLowerCase();
  }

  async function exactEntry(key, language) {
    const rows = await loadShard(language, "entries", key);
    return unpackEntry(rows[key], key, language);
  }

  async function formInfo(key, language) {
    if (language !== "fr") return null;
    const rows = await loadShard(language, "forms", key);
    const row = rows[key];
    return row ? { lemma: row[0], pos: row[1] || "", features: row[2] || "", ipa: row[3] || "" } : null;
  }

  function frenchElision(value) {
    const match = value.match(/^(c|d|j|l|m|n|qu|s|t|jusqu|lorsqu|puisqu)'(.+)$/u);
    return match ? match[2] : "";
  }

  function englishCandidates(key) {
    const candidates = [];
    const add = (value) => {
      value = normalize(value);
      if (value && !candidates.includes(value)) candidates.push(value);
    };
    if (key.endsWith("ies")) add(`${key.slice(0, -3)}y`);
    if (key.endsWith("ing")) {
      const stem = key.slice(0, -3);
      add(stem);
      add(`${stem}e`);
      if (stem.length > 2 && stem.at(-1) === stem.at(-2)) add(stem.slice(0, -1));
    }
    if (key.endsWith("ed")) {
      const stem = key.slice(0, -2);
      add(stem);
      add(`${stem}e`);
      if (stem.length > 2 && stem.at(-1) === stem.at(-2)) add(stem.slice(0, -1));
    }
    if (key.endsWith("es")) add(key.slice(0, -2));
    if (key.endsWith("s")) add(key.slice(0, -1));
    return candidates;
  }

  async function lookup(surface, language = "fr", options = {}) {
    await manifestPromise;
    const originalKey = normalize(surface);
    if (!originalKey) return null;
    const core = language === "fr" ? frenchElision(originalKey) : "";
    const candidates = [originalKey, core].filter(Boolean);

    for (const key of candidates) {
      const direct = await exactEntry(key, language);
      if (!direct) continue;
      if (language === "fr") {
        const form = await formInfo(key, language);
        if (shouldPreferFrenchForm(surface, direct, form, options.context)) {
          const lemmaEntry = await exactEntry(form.lemma, language);
          if (lemmaEntry) {
            return {
              ...lemmaEntry,
              surface: String(surface),
              lemma: lemmaEntry.word,
              form,
              formIpa: form.ipa || direct.ipa,
              isInflected: true,
              lookupKey: key,
              contextualSelection: true,
              homograph: direct
            };
          }
        }
      }
      return { ...direct, surface: String(surface), lemma: direct.word, isInflected: false, lookupKey: key };
    }

    for (const key of candidates) {
      const form = await formInfo(key, language);
      if (!form?.lemma) continue;
      const lemmaEntry = await exactEntry(form.lemma, language);
      if (lemmaEntry) {
        return {
          ...lemmaEntry,
          surface: String(surface),
          lemma: lemmaEntry.word,
          form,
          formIpa: form.ipa,
          isInflected: true,
          lookupKey: key
        };
      }
    }

    if (language === "en") {
      for (const candidate of englishCandidates(originalKey)) {
        const entry = await exactEntry(candidate, language);
        if (entry) return { ...entry, surface: String(surface), lemma: entry.word, isInflected: true, lookupKey: candidate };
      }
    }

    const folded = fold(originalKey);
    if (folded && folded !== originalKey) {
      const aliases = await loadShard(language, "aliases", folded);
      const exactKeys = aliases[folded] || [];
      // Never guess between collisions such as a/à or ca/ça.
      if (exactKeys.length === 1) {
        const entry = await exactEntry(exactKeys[0], language);
        if (entry) return { ...entry, surface: String(surface), lemma: entry.word, isInflected: false, lookupKey: exactKeys[0], fuzzy: true };
      }
    }
    return null;
  }

  async function preload(words, language = "fr") {
    const keys = Array.from(new Set((words || []).map(normalize).filter(Boolean)));
    await Promise.all(keys.flatMap((key) => [loadShard(language, "entries", key), language === "fr" ? loadShard(language, "forms", key) : null].filter(Boolean)));
  }

  global.OOFR_DICTIONARY = {
    ready: () => manifestPromise,
    lookup,
    preload,
    normalize,
    fold,
    shardFor,
    cleanText,
    senseList,
    formatMeaning,
    formatPartOfSpeech,
    formatSource,
    normalizeIpa
  };
})(window);
