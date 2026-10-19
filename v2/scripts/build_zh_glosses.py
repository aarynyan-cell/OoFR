#!/usr/bin/env python3
"""Chinese meanings for OoFR's French dictionary, translated by the local AI.

1.0's Chinese column was bridged through English-Chinese dictionaries, which
picked the wrong English homograph for many words (aller → "剩下；还有").
This script asks the local Ollama model to translate the clean English
Wiktionary senses (Kaikki) into short Simplified Chinese dictionary senses.
It only translates the senses it is given; it never invents meanings.

Steps:
  translate  - works through the most common words first, appending results
               to a JSONL progress file; safe to stop and run again. A word
               that came back missing a part of speech is asked once more.
  recover    - re-reads the logged answers that did not parse, with the
               current parser (no model needed).
  fill       - asks for each part of speech a word is still missing, one at
               a time (translate does this at the end of a run).
  pack       - writes dictionary/fr/zh-XX.json shards (same hashing as the
               other shards) and dictionary/zh-manifest.json.
  status     - progress in plain Chinese.

Usage (from the repository root):
  python3 v2/scripts/build_zh_glosses.py translate --limit 3000
  python3 v2/scripts/build_zh_glosses.py pack
Tests: python3 -m unittest discover -s v2/scripts -p "test_*.py"
"""

from __future__ import annotations

import argparse
import ast
import gzip
import json
import re
import subprocess
import sys
import time
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KAIKKI = [ROOT / ".lexicon-cache" / "kaikki-French.jsonl.gz", ROOT / "MulTape" / ".lexicon-cache" / "kaikki-French.jsonl.gz"]
LEXICON = ROOT / "lexicon.js"
PROGRESS = ROOT / ".lexicon-cache" / "zh-glosses.jsonl"
OUT_DIR = ROOT / "dictionary"
SHARD_COUNT = 128
PACK_EVERY = 1000
# qwen3.5:9b: accurate senses in the comparison with gemma3:4b (v2/docs/ai-model-choice.md)
# while using about 6 GB, so it can run in the background without slowing the Mac.
# gemma4:26b is as good but needs ~20 GB, too much for a 24 GB machine in use.
MODEL = "qwen3.5:9b"
OLLAMA = "http://127.0.0.1:11434/api/chat"

POS_NAMES = {
    "verb": "verb", "noun": "noun", "adj": "adjective", "adv": "adverb", "pron": "pronoun", "prep": "preposition",
    "conj": "conjunction", "det": "determiner", "article": "article", "intj": "interjection", "num": "numeral",
    "phrase": "phrase", "prep_phrase": "phrase", "contraction": "contraction", "particle": "particle"
}
SKIP_TAGS = {"form-of", "obsolete", "archaic", "rare", "misspelling", "abbreviation", "alt-of"}
FORM_GLOSS = re.compile(r"^(inflection of|form of|plural of|singular of|feminine of|masculine of|conjugation of|"
                        r"participle of|alternative form of|alternative spelling of|obsolete form of|feminine singular of|"
                        r"masculine plural of|feminine plural of|past participle of|present participle of|"
                        r"post-1990 spelling of|(?:first|second|third)-person\b)", re.I)
CJK = re.compile(r"[㐀-鿿]")
LATIN = re.compile(r"[A-Za-z]{2,}")

SYSTEM = (
    "你是严谨的法汉词典编辑。把给出的英文释义翻译成简洁、准确的简体中文词典释义，不要增加没有给出的意思。\n"
    "规则：每个英文义项翻成一条中文，顺序不变；每条 2 到 12 个汉字，近义词用顿号并列；"
    "不写拼音、英文、例句或解释；动词释义用动词，名词用名词，形容词通常以“的”结尾；"
    "地区或语域说明（如 Louisiana、slang、informal）用括号放在该条最后，例如“家伙（口语）”。\n"
    "按要求的 JSON 返回，写在一行里，不要换行和缩进：每个词一个对象，键是输入里的词性名，值是中文释义数组。"
)


def normalize_key(value: str) -> str:
    value = unicodedata.normalize("NFC", str(value or "").strip().lower().replace("’", "'"))
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r"[^\w'\- ]", "", value)
    return value.strip("'- ")


def shard_for(key: str) -> str:
    value = 0
    for char in key:
        value = (value * 31 + ord(char)) & 0xFFFFFFFF
    return format(value % SHARD_COUNT, "02x")


def kaikki_path() -> Path:
    for path in KAIKKI:
        if path.exists():
            return path
    sys.exit("kaikki-French.jsonl.gz not found in .lexicon-cache")


def lexicon_keys() -> set[str]:
    """The ~28 000 most frequent lemmas (Lexique 3.83, films + books) kept by 1.0's lexicon."""
    text = LEXICON.read_text(encoding="utf-8")
    words = set()
    for chunk in re.findall(r'"((?:[^"\\]|\\.)*)"', text):
        for line in chunk.encode().decode("unicode_escape").encode("latin-1").decode("utf-8", "ignore").split("\n"):
            parts = line.split("\t")
            if len(parts) >= 2 and parts[1]:
                words.add(normalize_key(parts[1]))
    return words


def form_lemmas() -> dict[str, str]:
    """Inflected form → dictionary form, from the dictionary's forms shards (est → être)."""
    lemmas: dict[str, str] = {}
    for path in sorted((OUT_DIR / "fr").glob("forms-*.json")):
        for form, row in json.loads(path.read_text(encoding="utf-8")).items():
            if row and row[0]:
                lemmas[form] = normalize_key(row[0])
    return lemmas


TOKEN = re.compile(r"[a-zàâäçéèêëîïôöûùüÿœæ]+(?:['’-][a-zàâäçéèêëîïôöûùüÿœæ]+)*")
ELISION = re.compile(r"^(?:c|d|j|l|m|n|qu|s|t|jusqu|lorsqu|puisqu)'")


def load_words() -> dict[str, dict]:
    """Word → {word, groups: [{pos, gender, senses}], score} from Kaikki.
    The score is how often the word (any of its forms) appears in the example
    sentences across the whole French Wiktionary: a local stand-in for a
    frequency list, since none is kept in the repository."""
    words: dict[str, dict] = {}
    counts: dict[str, int] = {}
    lemmas = form_lemmas()
    with gzip.open(kaikki_path(), "rt", encoding="utf-8") as source:
        for line in source:
            entry = json.loads(line)
            for sense in entry.get("senses", []):
                for example in sense.get("examples", []):
                    for token in TOKEN.findall(str(example.get("text", "")).lower().replace("’", "'")):
                        token = ELISION.sub("", token)
                        counts[token] = counts.get(token, 0) + 1
                        lemma = lemmas.get(token)
                        if lemma and lemma != token:
                            counts[lemma] = counts.get(lemma, 0) + 1
            pos = POS_NAMES.get(entry.get("pos", ""))
            word = entry.get("word", "")
            if not pos or not word or entry.get("lang_code") != "fr" or word[:1].isupper():
                continue
            senses, gender = [], ""
            for sense in entry.get("senses", []):
                tags = set(sense.get("tags", []))
                gloss = re.sub(r"\.\s*\d{3,4},.*$", "", (sense.get("glosses") or [""])[0]).strip()
                if not gloss or tags & SKIP_TAGS or FORM_GLOSS.match(gloss):
                    continue
                if not gender:
                    gender = "masculine" if "masculine" in tags else "feminine" if "feminine" in tags else ""
                regional = [tag for tag in sense.get("tags", []) if tag in {"Louisiana", "Quebec", "Belgium", "Switzerland", "slang", "informal", "colloquial", "vulgar", "familiar", "figuratively", "dated"}]
                senses.append(gloss + (f" ({', '.join(regional)})" if regional else ""))
            if not senses:
                continue
            key = normalize_key(word)
            record = words.setdefault(key, {"word": word, "groups": [], "score": 0})
            gender = gender if pos == "noun" else ""
            # Four senses per group, each trimmed: shorter prompts translate much faster.
            senses = [re.sub(r"\s+", " ", sense)[:90] for sense in senses[:4]]
            # Wiktionary lists homographs separately: le tour (turn) and la tour (tower)
            # stay two groups told apart by gender; same-gender entries are merged.
            existing = next((group for group in record["groups"] if group["pos"] == pos and group["gender"] == gender), None)
            if existing:
                existing["senses"] = (existing["senses"] + [sense for sense in senses if sense not in existing["senses"]])[:6]
            else:
                record["groups"].append({"pos": pos, "gender": gender, "senses": senses})
    for key, record in words.items():
        # An expression is as common as its rarest word.
        record["score"] = min(counts.get(ELISION.sub("", part), 0) for part in key.split(" "))
        # "synonym of lâchage" tells the model nothing about lâchage; give it lâchage's meaning.
        for group in record["groups"]:
            group["senses"] = [synonym_sense(sense, group["pos"], words) for sense in group["senses"]]
    return words


SYNONYM = re.compile(r"^(?:synonym of|alternative form of|variant of)\s+([^\s,;:()]+)", re.I)


def synonym_sense(sense: str, pos: str, words: dict[str, dict]) -> str:
    match = SYNONYM.match(sense)
    target = words.get(normalize_key(match.group(1))) if match else None
    group = next((group for group in (target or {}).get("groups", []) if group["pos"] == pos), None)
    if not group or SYNONYM.match(group["senses"][0]):
        return sense
    return f"{group['senses'][0]} ({sense[: match.end()]})"[:90]


def label(group: dict) -> str:
    """The part-of-speech name the model sees and copies back ("noun (feminine)" when a word has both genders)."""
    return f"{group['pos']} ({group['gender']})" if group.get("label_gender") else group["pos"]


def prepare(batch: list[dict]) -> list[dict]:
    for item in batch:
        nouns = [group for group in item["groups"] if group["pos"] == "noun"]
        for group in item["groups"]:
            group["label_gender"] = len(nouns) > 1 and group in nouns
    return batch


def schema(batch: list[dict]) -> dict:
    """The form the answer must fill (Ollama structured output): every word and every
    part of speech is required, so none is left out, and each list is capped at the
    number of English senses, so the model cannot repeat itself for pages."""
    prepare(batch)
    return {
        "type": "object",
        "properties": {item["word"]: {
            "type": "object",
            "properties": {label(group): {"type": "array", "items": {"type": "string", "minLength": 1, "maxLength": 24},
                                          "minItems": 1, "maxItems": len(group["senses"])} for group in item["groups"]},
            "required": [label(group) for group in item["groups"]],
        } for item in batch},
        "required": [item["word"] for item in batch],
    }


def ask(batch: list[dict]) -> str:
    prepare(batch)
    payload = [{"word": item["word"], "groups": [{"pos": label(group), "senses": group["senses"]} for group in item["groups"]]} for item in batch]
    body = {
        # This Mac's Ollama keeps a model loaded for 30 minutes by default; let it go
        # two minutes after the last batch so it never sits in memory unused.
        "model": MODEL, "stream": False, "think": False, "keep_alive": "2m", "format": schema(batch),
        # A batch needs a few hundred tokens; the cap stops a rambling answer early.
        "options": {"temperature": 0.1, "num_ctx": 4096, "num_predict": 200 * len(batch)},
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
    }
    request = urllib.request.Request(OLLAMA, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=900) as response:
        result = json.loads(response.read())
    ask.timing = f"prompt {result.get('prompt_eval_count', 0)} tok/{result.get('prompt_eval_duration', 0) / 1e9:.0f}s, answer {result.get('eval_count', 0)} tok/{result.get('eval_duration', 0) / 1e9:.0f}s"
    return result["message"]["content"]


def read_answer(answer: str, batch: list[dict]) -> dict[str, list[dict]]:
    """Reads a JSON answer (see schema()); older free-text answers go through parse()."""
    try:
        data = json.loads(answer)
    except json.JSONDecodeError:
        # Cut off by the length cap, or an answer from before the JSON form.
        return parse(answer, batch)
    results: dict[str, list[dict]] = {}
    for item in prepare(batch):
        found = data.get(item["word"]) if isinstance(data, dict) else None
        groups = []
        for group in item["groups"]:
            # One string sometimes holds several senses ("社区；邦联"): split them.
            senses = [clean_item(part) for sense in ((found or {}).get(label(group)) or []) if isinstance(sense, str)
                      for part in re.split(r"[；;]", sense)]
            senses = [sense for sense in dict.fromkeys(senses) if sense]
            if senses:
                groups.append({"pos": group["pos"], "gender": group["gender"], "zh": senses})
        if groups:
            results[normalize_key(item["word"])] = tidy(groups, item["groups"])
    return {key: groups for key, groups in results.items() if groups}


def clean_item(sense: str) -> str:
    """One sense from a JSON answer: parts with English left in are dropped ("谁、 whom" → "谁")."""
    parts = [part.strip() for part in re.split(r"[、，,]", sense)]
    kept = [part for part in parts if part and not LATIN.search(part)]
    sense = "、".join(kept).strip(" ；;。.")
    return sense if CJK.search(sense) and len(sense) <= 24 else ""


POS_ZH = {"动词": "verb", "名词": "noun", "形容词": "adjective", "副词": "adverb", "代词": "pronoun", "介词": "preposition",
          "连词": "conjunction", "感叹词": "interjection", "叹词": "interjection", "限定词": "determiner", "冠词": "article",
          "数词": "numeral", "短语": "phrase", "固定表达": "phrase"}


GENDER_ZH = {"阳": "masculine", "阳性": "masculine", "阴": "feminine", "阴性": "feminine"}

# Dictionary abbreviations some answers use instead of "pos:" ("n. 酱汁；调味汁").
ABBREVIATION = re.compile(r"^(n|nm|nf|v|vt|vi|a|adj|adv|prep|conj|pron|int|interj)\.\s*(?![:：])")
ABBREVIATION_POS = {"n": "noun", "nm": "noun (masculine)", "nf": "noun (feminine)", "v": "verb", "vt": "verb", "vi": "verb",
                    "a": "adjective", "adj": "adjective", "adv": "adverb", "prep": "preposition", "conj": "conjunction",
                    "pron": "pronoun", "int": "interjection", "interj": "interjection"}


def read_label(name: str) -> tuple[str, str]:
    """("名词（阴性）") → ("noun", "feminine"); ("noun (masculine)") → ("noun", "masculine"); ("动词") → ("verb", "")."""
    name = name.strip().strip("*").strip()
    match = re.match(r"^(.+?)\s*[（(]\s*(masculine|feminine|阳性|阴性|阳|阴)\s*[)）]$", name)
    if match:
        base, gender = match.group(1).strip(), match.group(2)
        return POS_ZH.get(base, base), GENDER_ZH.get(gender, gender)
    match = re.match(r"^(阳性|阴性)(名词)$", name)
    if match:
        return "noun", GENDER_ZH[match.group(1)]
    return POS_ZH.get(name, name), ""


def split_senses(text: str) -> list[str]:
    """Senses are separated by "；"; a model that used "、" between senses (and no "；") is read the same way."""
    parts = re.split(r"[；;]", text) if re.search(r"[；;]", text) else re.split(r"[、，,]", text)
    # Notes such as "（见同义词表：无套）" are not meanings.
    parts = [re.sub(r"[（(][^（）()]*[：:见][^（）()]*[)）]", "", part) for part in parts]
    senses = [sense.strip(" ，,。.") for sense in parts if sense.strip(" ，,。.")]
    return [sense for sense in senses if CJK.search(sense) and not LATIN.search(sense) and len(sense) <= 24]


def parse(answer: str, batch: list[dict]) -> dict[str, list[dict]]:
    """Reads the model's lines back and keeps only well-formed senses.
    Expected: a line with the word, then "pos: …" lines (blank lines tolerated).
    Also accepted: Chinese part-of-speech names ("动词：…") and "word: …" on one
    line for a word with a single part of speech."""
    expected = {normalize_key(item["word"]): item for item in batch}
    results: dict[str, list[dict]] = {}
    current = None

    def add(item: dict, pos: str, text: str) -> None:
        source = next((group for group in prepare([item])[0]["groups"] if label(group) == pos), None)
        senses = split_senses(text)
        done = results.get(normalize_key(item["word"]), [])
        if source and senses and not any(group["pos"] == source["pos"] and group["gender"] == source["gender"] for group in done):
            results.setdefault(normalize_key(item["word"]), []).append({"pos": source["pos"], "gender": source["gender"], "zh": senses[: len(source["senses"]) + 1]})

    for raw in answer.splitlines():
        line = raw.strip().strip("*").strip()
        if not line:
            continue
        line = ABBREVIATION.sub(lambda found: ABBREVIATION_POS[found.group(1)] + ": ", line)
        match = re.match(r"^([^:：]{1,40})\s*[:：]\s*(.+)$", line)
        name = match.group(1).strip().strip("*").strip() if match else ""
        pos, gender = read_label(name)
        if match and current:
            groups = prepare([current])[0]["groups"]
            filled = {(item["pos"], item["gender"]) for item in results.get(normalize_key(current["word"]), [])}
            # A plain "noun:" for a word with two noun groups fills the first one still empty.
            group = next((item for item in groups if label(item) == pos), None) or next(
                (item for item in groups if item["pos"] == pos and (not gender or item["gender"] == gender)
                 and (item["pos"], item["gender"]) not in filled), None)
            if group:
                add(current, label(group), match.group(2))
                continue
        word = expected.get(normalize_key(name)) if match else None
        if word and len(word["groups"]) == 1:
            add(word, label(word["groups"][0]), match.group(2))
            current = word
            continue
        current = expected.get(normalize_key(line), current if match else None)
    if not results:
        results = parse_without_words(answer, batch)
    return {key: tidy(groups, expected[key]["groups"]) for key, groups in results.items()}


def parse_without_words(answer: str, batch: list[dict]) -> dict[str, list[dict]]:
    """Some answers leave out the word lines and give one "pos: …" line per group,
    in order. Accepted only when every line's part of speech matches the group in
    that position, so a shifted answer is never assigned to the wrong word."""
    slots = [(item, group) for item in prepare(batch) for group in item["groups"]]
    lines = [ABBREVIATION.sub(lambda found: ABBREVIATION_POS[found.group(1)] + ": ", line.strip()) for line in answer.splitlines()]
    lines = [line for line in lines if re.match(r"^[^:：]{1,40}[:：]", line)]
    if len(lines) != len(slots):
        return {}
    results: dict[str, list[dict]] = {}
    for line, (item, group) in zip(lines, slots):
        name, text = re.split(r"[:：]", line, maxsplit=1)
        pos, gender = read_label(name)
        if pos != group["pos"] or (gender and gender != group["gender"]):
            return {}
        senses = split_senses(text)
        if senses:
            results.setdefault(normalize_key(item["word"]), []).append({"pos": group["pos"], "gender": group["gender"], "zh": senses[: len(group["senses"]) + 1]})
    return results


def missing_groups(record: dict, source: dict | None) -> list[dict]:
    """The word's Wiktionary groups the record has no Chinese for (la mort: noun)."""
    have = {(group["pos"], group["gender"]) for group in tidy(record["groups"], source["groups"] if source else None)}
    return [group for group in (source or {}).get("groups", []) if (group["pos"], group["gender"]) not in have]


def best_records(words: dict[str, dict]) -> dict[str, dict]:
    """One record per word: the one covering the most groups, the newest on a tie."""
    best: dict[str, dict] = {}
    if not PROGRESS.exists():
        return best
    for line in PROGRESS.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        old = best.get(record["key"])
        if old is None or len(missing_groups(record, words.get(record["key"]))) <= len(missing_groups(old, words.get(record["key"]))):
            best[record["key"]] = {**record, "retried": record.get("retried") or bool(old and old.get("retried")),
                                   "filled": record.get("filled") or bool(old and old.get("filled"))}
        else:
            old["retried"] = old.get("retried") or record.get("retried", False)
            old["filled"] = old.get("filled") or record.get("filled", False)
    return best


# The OoFR Mac app marks when the learner uses the AI; this job waits meanwhile.
APP_IN_USE = Path.home() / "Library" / "Application Support" / "OoFR" / "ai-in-use"
IN_USE_SECONDS = 120


def wait_while_app_in_use() -> None:
    told = False
    while APP_IN_USE.exists() and time.time() - APP_IN_USE.stat().st_mtime < IN_USE_SECONDS:
        if not told:
            print("OoFR is using the AI; waiting", flush=True)
            told = True
        time.sleep(15)


def translate(limit: int, batch_size: int) -> None:
    frequent = lexicon_keys()
    words = load_words()
    records = best_records(words)
    # A word missing a part of speech (only "死的" for mort) is asked again, once a run.
    done = {key for key, record in records.items() if not missing_groups(record, words.get(key)) or record.get("retried")}
    # Hand-reviewed words always win in the app; no need to translate them.
    curated = set(json.loads((OUT_DIR / "curated.json").read_text(encoding="utf-8")).get("fr", {}))
    done |= {normalize_key(key) for key in curated}
    # Elided forms (n', m', s') are explained by the grammar notes, not translated here.
    singles = sorted((key for key in words if key in frequent and key not in done and " " not in key and not words[key]["word"].endswith("'")),
                     key=lambda key: -words[key]["score"])
    # Then fixed expressions made only of frequent words ("bien sûr", "tout à l'heure").
    phrases = sorted(
        (key for key in words if " " in key and key not in done and all(part.split("'")[-1] in frequent for part in key.split(" "))),
        key=lambda key: -words[key]["score"],
    )
    queue = (singles + phrases)[:limit]
    print(f"{len(done)} done, {len(queue)} to translate with {MODEL}", flush=True)
    PROGRESS.parent.mkdir(parents=True, exist_ok=True)
    started = time.time()
    missed: list[str] = []
    failures = PROGRESS.with_name("zh-glosses-failed.log")

    def run_batch(keys: list[str], out) -> dict:
        wait_while_app_in_use()
        batch = [words[key] for key in keys]
        try:
            answer = ask(batch)
        except Exception as error:  # Ollama restarted, timeout: these words are retried at the end
            print(f"batch {keys[0]}: {error}", flush=True)
            time.sleep(10)
            return {}
        results = read_answer(answer, batch)
        if len(results) < len(batch):
            with failures.open("a", encoding="utf-8") as log:
                log.write(f"--- {[key for key in keys if key not in results]}\n{answer}\n")
        stamp = datetime.now(timezone.utc).isoformat()
        for key, groups in results.items():
            record = {"key": key, "word": words[key]["word"], "groups": groups, "model": MODEL, "at": stamp}
            if key in records:
                record["retried"] = True
            out.write(json.dumps(record, ensure_ascii=False) + "\n")
        out.flush()
        return results

    with PROGRESS.open("a", encoding="utf-8") as out:
        for index in range(0, len(queue), batch_size):
            keys = queue[index:index + batch_size]
            results = run_batch(keys, out)
            missed += [key for key in keys if key not in results]
            finished = index + len(keys)
            # The app picks up new meanings as the run goes, not only at the end.
            if finished % PACK_EVERY < batch_size:
                pack(words)
            rate = (time.time() - started) / finished
            print(f"{finished}/{len(queue)} · {len(results)}/{len(keys)} ok · {rate:.1f}s/word · ~{rate * (len(queue) - finished) / 3600:.1f}h left · {getattr(ask, 'timing', '')}", flush=True)
        # Words that did not come back in a batch get a second try, two at a time.
        for index in range(0, len(missed), 2):
            results = run_batch(missed[index:index + 2], out)
            print(f"retry {index + 2}/{len(missed)} · {len(results)} ok", flush=True)
    fill(set(queue))
    pack()


def fill(only: set[str] | None = None) -> None:
    """Asks for each part of speech a record is still missing, one at a time.
    With several groups the model sometimes repeats itself on the first one and
    never reaches the next (même: "甚至" but no "相同的"); alone, it answers."""
    words = load_words()
    records = best_records(words)
    curated = {normalize_key(key) for key in json.loads((OUT_DIR / "curated.json").read_text(encoding="utf-8")).get("fr", {})}
    todo = [key for key, record in records.items() if (only is None or key in only) and key not in curated
            and not record.get("filled") and missing_groups(record, words.get(key))]
    filled = 0
    with PROGRESS.open("a", encoding="utf-8") as out:
        for key in todo:
            record = records[key]
            groups = tidy(record["groups"], words[key]["groups"])
            for group in missing_groups(record, words[key]):
                part = {"word": words[key]["word"], "groups": [group]}
                try:
                    answer = ask([part])
                except Exception as error:  # Ollama restarted, timeout: asked again next run
                    print(f"fill {key}: {error}", flush=True)
                    continue
                groups += read_answer(answer, [part]).get(key, [])
            order = [(group["pos"], group["gender"]) for group in words[key]["groups"]]
            groups.sort(key=lambda group: order.index((group["pos"], group["gender"])) if (group["pos"], group["gender"]) in order else len(order))
            out.write(json.dumps({**record, "groups": groups, "model": MODEL, "at": datetime.now(timezone.utc).isoformat(), "filled": True}, ensure_ascii=False) + "\n")
            out.flush()
            filled += not missing_groups({"groups": groups}, words[key])
    print(f"filled {filled}/{len(todo)} words missing a part of speech", flush=True)


EMBEDDED_POS = re.compile(r"^((?:阳性|阴性)?(?:" + "|".join(sorted(POS_ZH, key=len, reverse=True)) + r")(?:\s*[（(]\s*(?:阳性|阴性|阳|阴)\s*[)）])?)\s*[:：]\s*")


POS_NAME_ZH = {"noun": "名词", "verb": "动词", "adjective": "形容词", "adverb": "副词", "pronoun": "代词", "preposition": "介词",
               "conjunction": "连词", "interjection": "感叹词"}


def clean_sense(sense: str) -> str:
    """One sense in house style: full-width brackets, no notes about the dictionary
    itself, a register note at the end ("（口语）熬夜" → "熬夜（口语）"), no repeats,
    and an abbreviation or "(f.)" in front turned into a part-of-speech label that
    tidy() can read ("n. (f.) 损坏" → "名词（阴性）：损坏")."""
    sense = re.sub(r"\s*\(([^()]*)\)", r"（\1）", sense.strip())
    sense = re.sub(r"（(?:各种含义|[^（）]*见[^（）]*)）", "", sense)
    gender = ""
    abbreviation = ABBREVIATION.match(sense)
    if abbreviation:
        pos = ABBREVIATION_POS[abbreviation.group(1)]
        gender = {"noun (masculine)": "阳性", "noun (feminine)": "阴性"}.get(pos, "")
        sense, base = sense[abbreviation.end():], POS_NAME_ZH.get(pos.split(" ")[0], "")
    else:
        base = ""
    marker = re.match(r"^（([mf])\.）\s*", sense) or re.match(r"^([mf])\.\s*", sense)
    if marker:
        sense, base, gender = sense[marker.end():], base or "名词", "阳性" if marker.group(1) == "m" else "阴性"
    trailing = re.search(r"（(阳性|阴性)）$", sense)
    if base == "名词" and trailing and not gender:
        sense, gender = sense[: trailing.start()], trailing.group(1)
    register = re.match(r"^（([^（）]{1,8})）\s*(.+)$", sense)
    if register:
        sense = f"{register.group(2)}（{register.group(1)}）"
    items = [item for item in sense.split("、") if item]
    sense = "、".join(dict.fromkeys(items))
    if base:
        sense = f"{base}{f'（{gender}）' if gender else ''}：{sense}"
    return sense


def tidy(groups: list[dict], sources: list[dict] | None = None) -> list[dict]:
    """Repairs answers where the model put two parts of speech on one line
    ("笑；名词：笑声"): senses after "名词：" move to the noun group, created from
    the word's Wiktionary groups (for its gender) when the answer had none.
    Also drops empty brackets and repeated senses."""
    out = [{**group, "zh": []} for group in groups]
    for index, group in enumerate(groups):
        target = out[index]
        for sense in group["zh"]:
            sense = clean_sense(sense)
            match = EMBEDDED_POS.match(sense)
            if match:
                pos, gender = read_label(match.group(1))
                fits = lambda item: item["pos"] == pos and (not gender or item.get("gender") == gender)
                target = next((item for item in out if fits(item)), None)
                if target is None:
                    source = next((item for item in sources or [] if fits(item)), None)
                    if source:
                        target = {"pos": pos, "gender": source.get("gender", ""), "zh": []}
                        out.append(target)
                sense = sense[match.end():]
                if target is None:
                    continue
            sense = re.sub(r"[（(]\s*[)）]", "", sense).strip(" ，,；;")
            # "的" alone is what is left of an answer that had nothing to say.
            if sense and sense not in target["zh"] and re.sub(r"[的地之]", "", sense):
                target["zh"].append(sense)
    return [group for group in out if group["zh"]]


def pack(words: dict[str, dict] | None = None) -> None:
    words = words or load_words()
    shards: dict[str, dict] = {}
    model = MODEL
    count = 0
    for record in best_records(words).values():
        model = record.get("model", model)
        groups = tidy(record["groups"], words.get(record["key"], {}).get("groups"))
        if groups:
            shards.setdefault(shard_for(record["key"]), {})[record["key"]] = groups
    for shard, rows in shards.items():
        (OUT_DIR / "fr" / f"zh-{shard}.json").write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        count += len(rows)
    version = datetime.now(timezone.utc).strftime("%Y.%m.%d.%H%M")
    manifest = {"type": "oofr.dictionary.zh", "version": version, "model": model, "source": "Kaikki/Wiktionary English senses, translated by the local AI", "entries": count, "shards": sorted(shards)}
    (OUT_DIR / "zh-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"packed {count} words into {len(shards)} shards, version {version}")
    # The fixed expressions the dictionary knows ("bien sûr", "s'il vous plaît"), so the
    # app fetches a shard only for expressions that exist.
    expressions = set()
    for path in sorted((OUT_DIR / "fr").glob("entries-*.json")):
        expressions.update(key for key in json.loads(path.read_text(encoding="utf-8")) if " " in key and len(key) <= 40)
    (OUT_DIR / "fr" / "expressions.json").write_text(json.dumps(sorted(expressions), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"listed {len(expressions)} expressions")


def recover() -> None:
    """Re-reads the answers logged for words that did not come back, with the
    current parser, so a parser fix recovers them without asking the model again."""
    failures = PROGRESS.with_name("zh-glosses-failed.log")
    if not failures.exists():
        return
    words = load_words()
    done = {key for key, record in best_records(words).items() if not missing_groups(record, words.get(key))}
    recovered = 0
    chunks = re.split(r"^--- (\[.*\])$", failures.read_text(encoding="utf-8"), flags=re.M)
    with PROGRESS.open("a", encoding="utf-8") as out:
        for header, answer in zip(chunks[1::2], chunks[2::2]):
            keys = [key for key in ast.literal_eval(header) if key in words and key not in done]
            if not keys:
                continue
            results = read_answer(answer, [words[key] for key in keys])
            stamp = datetime.now(timezone.utc).isoformat()
            for key, groups in results.items():
                out.write(json.dumps({"key": key, "word": words[key]["word"], "groups": groups, "model": MODEL, "at": stamp, "recovered": True}, ensure_ascii=False) + "\n")
                done.add(key)
                recovered += 1
    print(f"recovered {recovered} words from logged answers")


def status() -> None:
    """Progress in plain words, for the owner."""
    log = PROGRESS.with_name("zh-glosses.log")
    lines = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    done = len({json.loads(line)["key"] for line in PROGRESS.read_text(encoding="utf-8").splitlines() if line.strip()}) if PROGRESS.exists() else 0
    running = subprocess.run(["pgrep", "-f", "build_zh_glosses.py translate"], capture_output=True).returncode == 0
    last = next((line for line in reversed(lines) if re.match(r"^\d+/\d+ ", line)), "")
    match = re.match(r"^(\d+)/(\d+) .*~([\d.]+)h left", last)
    print(f"词典中文释义：已翻译 {done} 个词。")
    if match:
        current, total, hours = int(match.group(1)), int(match.group(2)), float(match.group(3))
        print(f"本轮进度 {current}/{total}（{current * 100 // total}%），预计还要约 {hours:.1f} 小时。")
    print("后台任务正在运行。" if running else "后台任务没有在运行。")
    if running and APP_IN_USE.exists() and time.time() - APP_IN_USE.stat().st_mtime < IN_USE_SECONDS:
        print("你正在用 OoFR 的 AI，词典翻译暂时让路，空闲约 2 分钟后自动继续。")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("step", choices=["translate", "recover", "fill", "pack", "status"])
    parser.add_argument("--limit", type=int, default=30000)
    parser.add_argument("--batch", type=int, default=10)
    args = parser.parse_args()
    if args.step == "translate":
        translate(args.limit, args.batch)
    elif args.step == "status":
        status()
    elif args.step == "recover":
        recover()
    elif args.step == "fill":
        fill()
    else:
        pack()


if __name__ == "__main__":
    main()
