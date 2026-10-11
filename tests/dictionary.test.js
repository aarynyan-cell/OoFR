const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

async function loadDictionaryRuntime() {
  const root = path.resolve(__dirname, "..");
  const window = {};
  const context = vm.createContext({
    window,
    console,
    fetch: async (url) => {
      const filePath = path.resolve(root, String(url).replace(/^\.\//, "").replace(/\?.*$/, ""));
      try {
        const payload = await fs.readFile(filePath, "utf8");
        return { ok: true, status: 200, json: async () => JSON.parse(payload) };
      } catch {
        return { ok: false, status: 404, json: async () => ({}) };
      }
    }
  });
  const source = await fs.readFile(path.join(root, "dictionary.js"), "utf8");
  vm.runInContext(source, context, { filename: "dictionary.js" });
  await window.OOFR_DICTIONARY.ready();
  return window.OOFR_DICTIONARY;
}

test("keeps accent-distinct French words separate", async () => {
  const dictionary = await loadDictionaryRuntime();
  const caPronoun = await dictionary.lookup("ça", "fr");
  const cela = await dictionary.lookup("cela", "fr");
  const acronym = await dictionary.lookup("ca", "fr");
  const accentedA = await dictionary.lookup("à", "fr");
  const verbA = await dictionary.lookup("a", "fr");
  const where = await dictionary.lookup("où", "fr");
  const or = await dictionary.lookup("ou", "fr");

  assert.equal(caPronoun.word, "ça");
  assert.equal(caPronoun.ipa, "/sa/");
  assert.equal(cela.word, "cela");
  assert.equal(cela.ipa, "/sə.la/");
  assert.equal(acronym.word, "CA");
  assert.equal(accentedA.pos, "preposition");
  assert.equal(verbA.pos, "verb");
  assert.equal(where.word, "où");
  assert.equal(or.word, "ou");
});

test("resolves French inflections and elisions without AI", async () => {
  const dictionary = await loadDictionaryRuntime();
  const organise = await dictionary.lookup("organise", "fr");
  const elidedOrganiser = await dictionary.lookup("d’organiser", "fr");
  const espere = await dictionary.lookup("j’espère", "fr");
  const appelle = await dictionary.lookup("appelle", "fr");

  assert.equal(organise.lemma, "organiser");
  assert.equal(organise.isInflected, true);
  assert.equal(elidedOrganiser.lemma, "organiser");
  assert.equal(espere.lemma, "espérer");
  assert.equal(espere.formIpa, "/ɛs.pɛʁ/");
  assert.equal(appelle.lemma, "appeler");
});

test("uses sentence context to disambiguate French noun and verb homographs", async () => {
  const dictionary = await loadDictionaryRuntime();
  const verb = await dictionary.lookup("marche", "fr", { context: "Mon téléphone marche bien." });
  const noun = await dictionary.lookup("marche", "fr", { context: "La marche est agréable." });

  assert.equal(verb.lemma, "marcher");
  assert.equal(verb.isInflected, true);
  assert.match(verb.zh, /运转/);
  assert.equal(noun.lemma, "marche");
  assert.equal(noun.isInflected, false);
  assert.match(noun.zh, /步态/);
});

test("serves fixed expressions and English entries locally", async () => {
  const dictionary = await loadDictionaryRuntime();
  const phrase = await dictionary.lookup("à partir de", "fr");
  const little = await dictionary.lookup("un peu", "fr");
  const practice = await dictionary.lookup("practice", "en");

  assert.equal(phrase.pos, "phrase");
  assert.match(phrase.zh, /开始/);
  assert.match(little.zh, /稍微/);
  assert.match(practice.zh, /练习/);
  assert.match(practice.pos, /verb/);
});

test("normalizes dictionary text into one stable display format", async () => {
  const dictionary = await loadDictionaryRuntime();
  const practice = await dictionary.lookup("practice", "en");

  assert.doesNotMatch(practice.zh, /\\n|\uFFFD/);
  assert.equal(dictionary.cleanText("cafÃ© â€™ \uFFFD"), "café ’");
  assert.equal(dictionary.formatPartOfSpeech("noun；verb", "zh"), "名词 / 动词");
  assert.equal(
    dictionary.formatMeaning("练习；练习；实践\\nv. 实行", { language: "zh", limit: 4, numbered: true }),
    "1. 练习\n2. 实践\n3. 实行"
  );
  assert.equal(dictionary.formatSource("Kaikki/Wiktionary；Kaikki/Wiktionary · 本地词典"), "Kaikki/Wiktionary");
  assert.deepEqual(Array.from(dictionary.senseList("行；行军；行", "zh", 6)), ["行", "行军"]);
});

test("keeps curated common-word meanings broad without AI invention", async () => {
  const dictionary = await loadDictionaryRuntime();
  const practice = await dictionary.lookup("pratiquer", "fr");

  assert.match(practice.zh, /从业/);
  assert.match(practice.zh, /宗教/);
  assert.match(practice.zh, /价格/);
  assert.match(practice.source, /OoFR 校订/);
});

test("finds accented headwords from unaccented spelling when the match is unambiguous", async () => {
  const dictionary = await loadDictionaryRuntime();
  for (const [typed, headword] of [["ecole", "école"], ["francais", "français"], ["tres", "très"], ["deja", "déjà"], ["cafe", "café"]]) {
    const entry = await dictionary.lookup(typed, "fr");
    assert.equal(entry?.word, headword, typed);
  }
  // Collisions stay separate: "a" and "à" are different words.
  assert.equal((await dictionary.lookup("a", "fr")).word, "a");
  assert.equal((await dictionary.lookup("à", "fr")).word, "à");
});

test("very common function words come from the reviewed layer, not from look-alike English entries", async () => {
  const dictionary = await loadDictionaryRuntime();
  for (const word of ["il", "ne", "se", "ce", "au", "du", "on", "y", "en", "que", "je", "nous"]) {
    const entry = await dictionary.lookup(word, "fr");
    assert.equal(entry.curated, true, word);
    assert.doesNotMatch(entry.zh, /缩写|信息论|害病|\[计\]/, word);
    assert.match(entry.source, /校订/);
  }
  const il = await dictionary.lookup("il", "fr");
  assert.equal(il.word, "il");
  assert.equal(il.pos, "pronoun");
  assert.match((await dictionary.lookup("au", "fr")).zh, /à \+ le/);
});

test("English function words and contractions are present and never become acronyms", async () => {
  const dictionary = await loadDictionaryRuntime();
  for (const word of ["the", "to", "and", "you", "of", "is", "was", "his", "its", "has", "does", "don't", "it's", "I'm", "they're"]) {
    const entry = await dictionary.lookup(word, "en");
    assert.ok(entry, word);
    assert.doesNotMatch(entry.word, /^(I|hi|IT|HA|DO)$/, `${word} resolved to ${entry.word}`);
  }
  assert.equal((await dictionary.lookup("is", "en")).word, "is");
  assert.equal((await dictionary.lookup("his", "en")).word, "his");
  // Generic stripping must not land on a two-letter stem or an acronym.
  const gas = await dictionary.lookup("gas", "en");
  assert.notEqual(gas?.word, "GA");
});

test("the learner's context decides noun or verb for each occurrence of a homograph", async () => {
  const dictionary = await loadDictionaryRuntime();
  const kind = (entry) => (entry.isInflected && entry.form?.pos === "verb" ? "verb" : "noun");
  const sentence = "La marche est longue mais mon téléphone marche bien.";
  assert.equal(kind(await dictionary.lookup("marche", "fr", { context: sentence, occurrence: 0 })), "noun");
  assert.equal(kind(await dictionary.lookup("marche", "fr", { context: sentence, occurrence: 1 })), "verb");
  for (const [word, context, expected] of [
    ["marche", "Une longue marche.", "noun"],
    ["visite", "Sa dernière visite était courte.", "noun"],
    ["coupe", "Cette belle coupe est chère.", "noun"],
    ["visite", "Je la visite.", "verb"],
    ["coupe", "Je le coupe.", "verb"],
    ["voyages", "Les voyages forment la jeunesse.", "noun"],
    ["portes", "Les portes sont fermées.", "noun"]
  ]) {
    assert.equal(kind(await dictionary.lookup(word, "fr", { context })), expected, `${word}: ${context}`);
  }
});

test("a failed shard download is retried on the next lookup instead of being remembered", async () => {
  const root = path.resolve(__dirname, "..");
  let failShards = true;
  const window = {};
  const context = vm.createContext({
    window,
    console,
    fetch: async (url) => {
      if (failShards && /\/entries-|\/forms-|\/aliases-/.test(String(url))) throw new TypeError("network down");
      const filePath = path.resolve(root, String(url).replace(/^\.\//, "").replace(/\?.*$/, ""));
      try {
        return { ok: true, status: 200, json: async () => JSON.parse(await fs.readFile(filePath, "utf8")) };
      } catch {
        return { ok: false, status: 404, json: async () => ({}) };
      }
    }
  });
  vm.runInContext(await fs.readFile(path.join(root, "dictionary.js"), "utf8"), context, { filename: "dictionary.js" });
  const dictionary = window.OOFR_DICTIONARY;
  assert.equal(await dictionary.lookup("maison", "fr"), null, "offline: not found");
  failShards = false;
  assert.equal((await dictionary.lookup("maison", "fr"))?.word, "maison", "online again: found");
});

test("only the debris of a decoded no-break space is removed, real capital Â is kept", async () => {
  const dictionary = await loadDictionaryRuntime();
  assert.equal(dictionary.cleanText("Âge d'or"), "Âge d'or");
  assert.equal(dictionary.cleanText("prix\u00c2\u00a0: 5"), "prix\u00a0: 5");
});
