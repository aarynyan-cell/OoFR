#!/usr/bin/env python3
"""Chinese meanings for OoFR's French dictionary, translated by the local AI.

1.0's Chinese column was bridged through English-Chinese dictionaries, which
picked the wrong English homograph for many words (aller → "剩下；还有").
This script asks the local Ollama model to translate the clean English
Wiktionary senses (Kaikki) into short Simplified Chinese dictionary senses.
It only translates the senses it is given; it never invents meanings.

Two steps:
  translate  - works through the most common words first, appending results
               to a JSONL progress file; safe to stop and run again.
  pack       - writes dictionary/fr/zh-XX.json shards (same hashing as the
               other shards) and dictionary/zh-manifest.json.

Usage (from the repository root):
  python3 v2/scripts/build_zh_glosses.py translate --limit 3000
  python3 v2/scripts/build_zh_glosses.py pack
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
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
# gemma4:26b gave the best Chinese senses in a comparison with gemma3:4b and gpt-oss:20b;
# a 4k context keeps it fast enough on a 24 GB Mac (about 2 s per word).
MODEL = "gemma4:26b"
OLLAMA = "http://127.0.0.1:11434/api/chat"

POS_NAMES = {
    "verb": "verb", "noun": "noun", "adj": "adjective", "adv": "adverb", "pron": "pronoun", "prep": "preposition",
    "conj": "conjunction", "det": "determiner", "article": "article", "intj": "interjection", "num": "numeral",
    "phrase": "phrase", "prep_phrase": "phrase", "contraction": "contraction", "particle": "particle"
}
SKIP_TAGS = {"form-of", "obsolete", "archaic", "rare", "misspelling", "abbreviation", "alt-of"}
FORM_GLOSS = re.compile(r"^(inflection of|form of|plural of|singular of|feminine of|masculine of|conjugation of|"
                        r"participle of|alternative form of|alternative spelling of|obsolete form of|feminine singular of|"
                        r"masculine plural of|feminine plural of)\b", re.I)
CJK = re.compile(r"[㐀-鿿]")
LATIN = re.compile(r"[A-Za-z]{2,}")

SYSTEM = (
    "你是严谨的法汉词典编辑。把给出的英文释义翻译成简洁、准确的简体中文词典释义，不要增加没有给出的意思。\n"
    "规则：每个英文义项对应一条中文，顺序不变，条目之间用“；”分隔；每条 2 到 12 个汉字，近义词用顿号并列；"
    "不写拼音、英文、例句或解释；动词释义用动词，名词用名词，形容词通常以“的”结尾；"
    "地区或语域说明（如 Louisiana、slang、informal）用括号放在该条最后，例如“家伙（口语）”。\n"
    "输出格式：每个词先写一行词本身，然后每个词性一行“词性: 中文；中文”，词性名照抄输入；词与词之间空一行。只输出这些内容。"
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


def load_words() -> dict[str, dict]:
    """Word → {word, groups: [{pos, gender, senses}], score} from Kaikki."""
    words: dict[str, dict] = {}
    with gzip.open(kaikki_path(), "rt", encoding="utf-8") as source:
        for line in source:
            entry = json.loads(line)
            pos = POS_NAMES.get(entry.get("pos", ""))
            word = entry.get("word", "")
            if not pos or not word or entry.get("lang_code") != "fr":
                continue
            senses, gender = [], ""
            for sense in entry.get("senses", []):
                tags = set(sense.get("tags", []))
                gloss = (sense.get("glosses") or [""])[0].strip()
                if not gloss or tags & SKIP_TAGS or FORM_GLOSS.match(gloss):
                    continue
                if not gender:
                    gender = "masculine" if "masculine" in tags else "feminine" if "feminine" in tags else ""
                regional = [tag for tag in sense.get("tags", []) if tag in {"Louisiana", "Quebec", "Belgium", "Switzerland", "slang", "informal", "colloquial", "vulgar", "familiar", "figuratively", "dated"}]
                senses.append(gloss + (f" ({', '.join(regional)})" if regional else ""))
            if not senses:
                continue
            key = normalize_key(word)
            record = words.setdefault(key, {"word": word, "groups": [], "score": 0.0})
            if any(group["pos"] == pos for group in record["groups"]):
                continue
            # Four senses per part of speech, each trimmed: shorter prompts translate much faster.
            senses = [re.sub(r"\s+", " ", sense)[:90] for sense in senses[:4]]
            record["groups"].append({"pos": pos, "gender": gender if pos == "noun" else "", "senses": senses})
            # Rough commonness among the frequent lemmas (no frequency list is kept locally):
            # short words with several senses, a recorded pronunciation and many derived
            # words come first; hyphenated and long words later.
            audio = any(sound.get("audio") or sound.get("mp3_url") for sound in entry.get("sounds", []))
            record["score"] += min(len(senses), 5) + 3 * audio + min(len(entry.get("derived", [])), 30) / 6
            if "-" in word or len(word) > 11:
                record["score"] -= 4
    return words


def ask(batch: list[dict]) -> str:
    payload = [{"word": item["word"], "groups": [{"pos": group["pos"], "senses": group["senses"]} for group in item["groups"]]} for item in batch]
    body = {
        # This Mac's Ollama keeps a model loaded for 30 minutes by default; let it go
        # two minutes after the last batch so it never sits in memory unused.
        "model": MODEL, "stream": False, "think": False, "keep_alive": "2m", "options": {"temperature": 0.1, "num_ctx": 4096},
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
    }
    request = urllib.request.Request(OLLAMA, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=900) as response:
        result = json.loads(response.read())
    ask.timing = f"prompt {result.get('prompt_eval_count', 0)} tok/{result.get('prompt_eval_duration', 0) / 1e9:.0f}s, answer {result.get('eval_count', 0)} tok/{result.get('eval_duration', 0) / 1e9:.0f}s"
    return result["message"]["content"]


def parse(answer: str, batch: list[dict]) -> dict[str, list[dict]]:
    """Reads the model's lines back and keeps only well-formed senses.
    A line that names one of the words starts that word; "pos: …" lines follow
    (blank lines in between are tolerated)."""
    expected = {normalize_key(item["word"]): item for item in batch}
    results: dict[str, list[dict]] = {}
    current = None
    for raw in answer.splitlines():
        line = raw.strip().strip("*").strip()
        if not line:
            continue
        match = re.match(r"^([a-z ]+)\s*[:：]\s*(.+)$", line)
        if match and current and match.group(1).strip() in {group["pos"] for group in current["groups"]}:
            source = next(group for group in current["groups"] if group["pos"] == match.group(1).strip())
            senses = [sense.strip(" ，,。.") for sense in re.split(r"[；;]", match.group(2)) if sense.strip()]
            senses = [sense for sense in senses if CJK.search(sense) and not LATIN.search(sense) and len(sense) <= 24]
            if senses:
                results.setdefault(normalize_key(current["word"]), []).append({"pos": source["pos"], "gender": source["gender"], "zh": senses[: len(source["senses"]) + 1]})
            continue
        current = expected.get(normalize_key(line), current if match else None)
    return results


def translate(limit: int, batch_size: int) -> None:
    done = set()
    if PROGRESS.exists():
        done = {json.loads(line)["key"] for line in PROGRESS.read_text(encoding="utf-8").splitlines() if line.strip()}
    frequent = lexicon_keys()
    words = load_words()
    singles = sorted((key for key in words if key in frequent and key not in done and " " not in key), key=lambda key: -words[key]["score"])
    # Then fixed expressions made only of frequent words ("bien sûr", "tout à l'heure").
    phrases = sorted(
        (key for key in words if " " in key and key not in done and all(part.split("'")[-1] in frequent for part in key.split(" "))),
        key=lambda key: -words[key]["score"],
    )
    queue = (singles + phrases)[:limit]
    print(f"{len(done)} done, {len(queue)} to translate with {MODEL}", flush=True)
    PROGRESS.parent.mkdir(parents=True, exist_ok=True)
    started = time.time()
    with PROGRESS.open("a", encoding="utf-8") as out:
        for index in range(0, len(queue), batch_size):
            batch = [words[key] for key in queue[index:index + batch_size]]
            try:
                results = parse(ask(batch), batch)
            except Exception as error:  # Ollama restarted, timeout: retry this batch once later
                print(f"batch {index}: {error}", flush=True)
                time.sleep(10)
                continue
            stamp = datetime.now(timezone.utc).isoformat()
            for key, groups in results.items():
                out.write(json.dumps({"key": key, "word": words[key]["word"], "groups": groups, "model": MODEL, "at": stamp}, ensure_ascii=False) + "\n")
            out.flush()
            finished = index + len(batch)
            rate = (time.time() - started) / finished
            print(f"{finished}/{len(queue)} · {len(results)}/{len(batch)} ok · {rate:.1f}s/word · ~{rate * (len(queue) - finished) / 3600:.1f}h left · {getattr(ask, 'timing', '')}", flush=True)


def pack() -> None:
    shards: dict[str, dict] = {}
    model = MODEL
    count = 0
    for line in PROGRESS.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        model = record.get("model", model)
        shards.setdefault(shard_for(record["key"]), {})[record["key"]] = record["groups"]
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("step", choices=["translate", "pack"])
    parser.add_argument("--limit", type=int, default=30000)
    parser.add_argument("--batch", type=int, default=10)
    args = parser.parse_args()
    if args.step == "translate":
        translate(args.limit, args.batch)
    else:
        pack()


if __name__ == "__main__":
    main()
