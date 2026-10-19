// Facts about a sentence that OoFR can state for certain (from the dictionary and
// a few fixed rules), given to the AI so its explanation does not guess tenses.
// The comparison of models showed both getting compound tenses wrong when left
// to themselves ("serais venu" called a subjunctive).

import { featuresLabel } from "../dict/dictionary";
import { tokenize, lookupText } from "../text/tokens";

export interface WordForm {
  lemma: string;
  pos: string;
  // Kaikki's tags, "conditional · first person · singular"; "" or "inflected form" when unknown.
  features: string;
}

export type FormLookup = (word: string, context: string, occurrence: number) => Promise<WordForm | null>;

type Mood = "present" | "imperfect" | "future" | "conditional" | "subjunctive" | "simplePast" | "subjunctiveImperfect" | "infinitive" | "participle";

function table(forms: Record<Mood, string>): Map<string, Mood> {
  const map = new Map<string, Mood>();
  for (const [mood, list] of Object.entries(forms) as [Mood, string][]) list.split(" ").forEach((form) => map.set(form, mood));
  return map;
}

// The two auxiliaries, conjugated in full: the dictionary data misses some forms ("ai").
const AVOIR = table({
  present: "ai as a avons avez ont", imperfect: "avais avait avions aviez avaient", future: "aurai auras aura aurons aurez auront",
  conditional: "aurais aurait aurions auriez auraient", subjunctive: "aie aies ait ayons ayez aient", simplePast: "eus eut eûmes eûtes eurent",
  subjunctiveImperfect: "eusse eusses eût eussions eussiez eussent", infinitive: "avoir", participle: "ayant"
});
const ETRE = table({
  present: "suis es est sommes êtes sont", imperfect: "étais était étions étiez étaient", future: "serai seras sera serons serez seront",
  conditional: "serais serait serions seriez seraient", subjunctive: "sois soit soyons soyez soient", simplePast: "fus fut fûmes fûtes furent",
  subjunctiveImperfect: "fusse fusses fût fussions fussiez fussent", infinitive: "être", participle: "étant"
});

const AUX_TENSE: Record<Mood, string> = {
  present: "直陈式现在时", imperfect: "未完成过去时", future: "简单将来时", conditional: "条件式现在时", subjunctive: "虚拟式现在时",
  simplePast: "简单过去时", subjunctiveImperfect: "虚拟式未完成过去时", infinitive: "不定式", participle: "现在分词"
};
const COMPOUND: Record<Mood, string> = {
  present: "复合过去时", imperfect: "愈过去时", future: "先将来时", conditional: "条件式过去时", subjunctive: "虚拟式过去时",
  simplePast: "先过去时", subjunctiveImperfect: "虚拟式愈过去时", infinitive: "过去不定式", participle: "复合过去分词"
};

// Verbs whose compound tenses take être.
const ETRE_VERBS = new Set("aller venir arriver partir entrer sortir monter descendre naître mourir rester tomber retourner devenir revenir rentrer parvenir intervenir survenir décéder apparaître repartir ressortir redescendre remonter".split(" "));
// Words that may stand between the auxiliary and the participle.
const BETWEEN = new Set("ne n pas plus jamais rien guère point bien déjà encore toujours souvent vraiment tout trop beaucoup mal peu enfin presque même aussi".split(" "));
const SUBJECT_AFTER = /^-(t-)?(je|tu|il|elle|on|nous|vous|ils|elles)$/i;
const REFLEXIVE_CLITIC = /^(?:me|te|se|nous|vous)$/i;
const SUBJECTS = new Set(["je", "j", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles"]);
const SUBJECT_FOR: Record<string, string> = { me: "je", te: "tu", nous: "nous", vous: "vous" };
// Irregular past participles (masculine singular) → infinitive. The dictionary
// often files these under another word ("su" as a noun, "vu" as a preposition).
const IRREGULAR: Record<string, string> = Object.fromEntries(
  ("été:être eu:avoir su:savoir pu:pouvoir dû:devoir vu:voir revu:revoir prévu:prévoir lu:lire relu:relire bu:boire cru:croire plu:plaire " +
    "mis:mettre remis:remettre permis:permettre promis:promettre admis:admettre pris:prendre appris:apprendre compris:comprendre surpris:surprendre repris:reprendre " +
    "fait:faire refait:refaire défait:défaire dit:dire interdit:interdire écrit:écrire décrit:décrire inscrit:inscrire né:naître mort:mourir " +
    "venu:venir devenu:devenir revenu:revenir parvenu:parvenir tenu:tenir obtenu:obtenir retenu:retenir soutenu:soutenir appartenu:appartenir " +
    "voulu:vouloir connu:connaître reconnu:reconnaître paru:paraître apparu:apparaître disparu:disparaître reçu:recevoir aperçu:apercevoir déçu:décevoir " +
    "vécu:vivre fallu:falloir valu:valoir couru:courir parcouru:parcourir assis:asseoir rendu:rendre attendu:attendre entendu:entendre perdu:perdre " +
    "vendu:vendre répondu:répondre descendu:descendre défendu:défendre battu:battre suivi:suivre poursuivi:poursuivre ri:rire souri:sourire fui:fuir " +
    "conclu:conclure inclus:inclure résolu:résoudre moulu:moudre cousu:coudre clos:clore").split(" ").map((pair) => pair.split(":"))
);

// Participle → infinitive, or null when the word is not a past participle.
function participleLemma(bare: string, form: WordForm | null): string | null {
  for (const base of new Set([bare, bare.replace(/e?s?$/u, ""), bare.replace(/s$/u, ""), bare.replace(/e$/u, "")])) {
    if (IRREGULAR[base]) return IRREGULAR[base];
  }
  if (form?.pos === "verb" && /participle/.test(form.features) && /past/.test(form.features)) return form.lemma.endsWith("é") ? `${form.lemma.slice(0, -1)}er` : form.lemma;
  const rules: [RegExp, string][] = [
    [/^(.+)é(?:e|s|es)?$/u, "$1er"],
    [/^(.+)uit(?:e|s|es)?$/u, "$1uire"],
    [/^(.+)([aeo]i)nt(?:e|s|es)?$/u, "$1$2ndre"],
    [/^(.+)ert(?:e|s|es)?$/u, "$1rir"]
  ];
  const rule = rules.find(([pattern]) => pattern.test(bare));
  if (rule) return bare.replace(rule[0], rule[1]);
  // -i / -u participles (fini, rendu) only when the dictionary agrees it is a verb form.
  if (form?.pos === "verb" && (!form.features || form.features === "inflected form") && /(?:i|ie|is|ies|u|ue|us|ues)$/u.test(bare)) return form.lemma;
  return null;
}

const ELISION = /^(c|d|j|l|m|n|qu|s|t|jusqu|lorsqu|puisqu)['’]/i;

interface Word {
  surface: string;
  // Lower case, elided article or pronoun removed ("s'est" → "est").
  bare: string;
  elided: string;
  occurrence: number;
}

function wordsOf(sentence: string): Word[] {
  return tokenize(sentence)
    .filter((token) => token.word)
    .map((token) => {
      const text = lookupText(token).toLocaleLowerCase("fr-FR").replace(/’/g, "'");
      const elided = text.match(ELISION)?.[1] ?? "";
      return { surface: token.text, bare: elided ? text.slice(elided.length + 1) : text, elided, occurrence: token.occurrence };
    });
}


export interface SentenceFacts {
  forms: string[];
  compounds: string[];
  // Inverted questions ("allez-vous"), which models like to call reflexive.
  inversions?: string[];
  // Negation, si-clauses: patterns models mislabel (expletive ne, "subjunctive" after si).
  patterns?: string[];
}

const NEGATION_PARTNERS = new Set(["pas", "jamais", "plus", "rien", "personne", "guère", "point", "aucun", "aucune", "nulle", "nul", "que"]);
// After these, a lone ne has no negative meaning.
const EXPLETIVE_AFTER = /(avant|moins|peur|crainte)\s+(que|qu['’])\s*\S*\s*n/i;

export async function sentenceFacts(sentence: string, lookup: FormLookup): Promise<SentenceFacts> {
  const words = wordsOf(sentence);
  const forms = await Promise.all(words.map((word) => lookup(word.elided ? `${word.elided}'${word.bare}` : word.bare, sentence, word.occurrence).catch(() => null)));
  const facts: SentenceFacts = { forms: [], compounds: [] };
  const used = new Set<number>();

  const skip = (from: number) => {
    let next = from;
    while (next < words.length && (BETWEEN.has(words[next].bare) || SUBJECT_AFTER.test(words[next].surface))) next += 1;
    return next;
  };
  // "Avez-vous déjà vu" keeps the hyphen of the inverted subject.
  const span = (from: number, to: number) =>
    words.slice(from, to + 1).reduce((out, item, offset) => out + (offset && !item.surface.startsWith("-") ? " " : "") + item.surface, "");
  // "se" is always reflexive; me/te/nous/vous only with the matching subject ("je me suis levé", not "je t'ai parlé").
  const isReflexive = (index: number) => {
    const word = words[index];
    const clitic = word.elided || (REFLEXIVE_CLITIC.test(words[index - 1]?.bare ?? "") && !words[index - 1].elided ? words[index - 1].bare : "");
    if (!clitic) return false;
    if (/^s(e)?$/.test(clitic)) return true;
    // The subject comes before the clitic (which may itself be "nous").
    const end = word.elided ? index : index - 1;
    const subject = words.slice(Math.max(0, end - 3), end).map((item) => item.bare).reverse().find((bare) => SUBJECTS.has(bare)) ?? "";
    return SUBJECT_FOR[clitic.replace(/^([mt])$/, "$1e")] === subject;
  };

  words.forEach((word, index) => {
    const mood = AVOIR.get(word.bare) ?? ETRE.get(word.bare);
    if (!mood || used.has(index)) return;
    const auxiliary = AVOIR.has(word.bare) ? "avoir" : "être";
    const next = skip(index + 1);
    const lemma = next < words.length ? participleLemma(words[next].bare, forms[next]) : null;
    if (!lemma) return;
    const reflexive = isReflexive(index);
    used.add(index).add(next);
    const tense = `${auxiliary} 的${AUX_TENSE[mood]}`;
    // "a été construite": the passive in a compound tense.
    if (lemma === "être") {
      const third = skip(next + 1);
      const passive = third < words.length ? participleLemma(words[third].bare, forms[third]) : null;
      if (passive) {
        used.add(third);
        facts.compounds.push(`${span(index, third)}：被动语态的${COMPOUND[mood]}（${tense} + été + ${passive} 的过去分词）`);
        return;
      }
    }
    if (auxiliary === "être" && !reflexive && !ETRE_VERBS.has(lemma)) {
      facts.compounds.push(`${span(index, next)}：être 的${AUX_TENSE[mood]} + ${lemma} 的过去分词（过去分词作表语形容词，或被动语态）`);
    } else {
      // Why the auxiliary is être: the model otherwise doubts it ("venir 不用 être？").
      const why =
        auxiliary !== "être" ? "" : reflexive ? "；代词式动词的复合时态都用 être，过去分词通常与主语性数配合" : `；${lemma} 属于复合时态用 être 的动词，过去分词与主语性数配合`;
      facts.compounds.push(`${span(index, next)}：${reflexive ? "代词式动词的" : ""}${COMPOUND[mood]}（${tense} + ${lemma} 的过去分词${why}）`);
    }
  });

  facts.patterns = [];
  words.forEach((word, index) => {
    if (word.bare !== "ne" && word.elided !== "n") return;
    const partner = words.slice(index + 1, index + 5).find((item) => NEGATION_PARTNERS.has(item.bare));
    if (partner) {
      facts.patterns!.push(`${word.elided ? "n'" : "ne"} … ${partner.surface}：否定结构（ne 和 ${partner.surface} 一起表示否定，这个 ne 不是赘词）`);
    } else if (EXPLETIVE_AFTER.test(sentence)) {
      facts.patterns!.push(`${word.elided ? "n'" : "ne"}：赘词 ne，出现在 avant que / à moins que / de peur que 之后，没有否定意思`);
    }
  });
  const si = words.findIndex((word) => word.bare === "si" || word.elided === "s" && /^(il|ils)$/.test(word.bare));
  if (si >= 0) {
    const after = words.slice(si + 1, si + 4);
    const pluperfect = facts.compounds.some((line) => /愈过去时/.test(line) && after.some((word) => line.startsWith(word.surface)));
    const imperfect = after.some((word) => /imperfect/.test(forms[words.indexOf(word)]?.features ?? "") || AVOIR.get(word.bare) === "imperfect" || ETRE.get(word.bare) === "imperfect");
    if (pluperfect) facts.patterns.push("si 条件句：si + 愈过去时，主句用条件式过去时，表示与过去事实相反的假设。法语这里用直陈式的愈过去时，不用虚拟式");
    else if (imperfect) facts.patterns.push("si 条件句：si + 未完成过去时，主句用条件式现在时，表示与现在事实相反或不太可能的假设。法语这里不用虚拟式");
  }

  facts.inversions = words.flatMap((word, index) => {
    const next = words[index + 1];
    return next && SUBJECT_AFTER.test(next.surface) && !word.surface.startsWith("-")
      ? [`${word.surface}${next.surface}：主谓倒装（动词在前、主语代词在后，用连字符相连），构成疑问句；不是代词式动词`]
      : [];
  });

  words.forEach((word, index) => {
    const form = forms[index];
    const mood = AVOIR.get(word.bare) ?? ETRE.get(word.bare);
    // avoir and être are known in full; other verbs need the dictionary's form.
    if (used.has(index) || (!mood && form?.pos !== "verb")) return;
    let label = mood ? AUX_TENSE[mood] : featuresLabel(form!.features);
    // The data writes "conditional" alone for the present conditional.
    if (/条件式/.test(label) && !/时/.test(label)) label = label.replace("条件式", "条件式现在时");
    if (!label) return;
    const lemma = mood ? (AVOIR.has(word.bare) ? "avoir" : "être") : form!.lemma;
    facts.forms.push(`${word.surface}：${lemma === word.bare ? "" : `${lemma} 的`}${label}`);
  });
  return facts;
}

export function factLines(facts: SentenceFacts): string[] {
  return [...facts.compounds, ...(facts.inversions ?? []), ...(facts.patterns ?? []), ...facts.forms];
}

export function factsText(facts: SentenceFacts): string {
  return factLines(facts).map((line) => `- ${line}`).join("\n");
}

// One name for each grammar term, so explanations stay consistent across sentences.
export const TERMS =
  "术语统一用：直陈式现在时、复合过去时（passé composé）、未完成过去时（imparfait）、愈过去时（plus-que-parfait）、简单将来时、" +
  "最近将来时（aller + 不定式）、先将来时、简单过去时、条件式现在时、条件式过去时、虚拟式现在时、虚拟式过去时、命令式、不定式、" +
  "过去分词、现在分词、副动词（gérondif）、代词式动词、被动语态、主谓倒装、关系代词、直接宾语、间接宾语、部分冠词、省音、联诵、赘词 ne。";
