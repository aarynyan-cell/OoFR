#!/usr/bin/env python3
"""Build OoFR's offline French/English dictionary packs.

The generated packs preserve accents in their primary keys.  Accent folding is
written only as a last-resort alias, so unrelated words such as ``ça``/``ca``
and ``à``/``a`` can never overwrite one another.

Sources:
  * Kaikki/Wiktionary French JSONL (definitions, IPA, audio and forms)
  * Morphalou 3.1 (French morphology)
  * FreeDict fra-zho and eng-zho (Chinese meanings)
  * ECDICT (broad English-Chinese meanings used as a semantic bridge)
  * Open English WordNet 2025 (English definitions and pronunciation)
"""

from __future__ import annotations

import argparse
import csv
import gzip
import html
import io
import json
import re
import struct
import sys
import unicodedata
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "dictionary"
LOCAL_CACHE = ROOT / ".lexicon-cache"
LEGACY_CACHE = ROOT / "MulTape" / ".lexicon-cache"
SHARD_COUNT = 128

VENDORED_OPENCC = LOCAL_CACHE / "python-opencc"
if VENDORED_OPENCC.exists():
    sys.path.insert(0, str(VENDORED_OPENCC))
try:
    from opencc import OpenCC  # type: ignore
    OPENCC = OpenCC("t2s")
except ImportError:
    OPENCC = None

TAG_RE = re.compile(r"<[^>]+>")
CJK_RE = re.compile(r"[\u3400-\u9fff][\u3400-\u9fff，、；（）()·\s-]*")
CHINESE_NODE_RE = re.compile(r">\s*([^<>]*[\u3400-\u9fff][^<>]*)\s*<")
FORM_GLOSS_RE = re.compile(
    r"\b(inflection of|form of|plural of|singular of|conjugation of|declension of|"
    r"participle of|comparative form of|superlative form of|alternative form of|"
    r"alternative spelling of)\b",
    re.I,
)

POS_LABELS = {
    "verb": "verb",
    "noun": "noun",
    "adj": "adjective",
    "adjective": "adjective",
    "adv": "adverb",
    "adverb": "adverb",
    "pron": "pronoun",
    "pronoun": "pronoun",
    "prep": "preposition",
    "preposition": "preposition",
    "conj": "conjunction",
    "conjunction": "conjunction",
    "det": "determiner",
    "determiner": "determiner",
    "article": "article",
    "interj": "interjection",
    "interjection": "interjection",
    "num": "numeral",
    "name": "proper noun",
    "proper_noun": "proper noun",
    "phrase": "phrase",
}

MORPHALOU_POS = {
    "Verbe": "verb",
    "Nom commun": "noun",
    "Nom propre": "proper noun",
    "Adjectif qualificatif": "adjective",
    "Adverbe": "adverb",
    "Pronom": "pronoun",
    "Préposition": "preposition",
    "Conjonction": "conjunction",
    "Déterminant": "determiner",
    "Interjection": "interjection",
}

CURATED_FR = {
    "bonjour": {"zh": "你好；您好；早上好（白天见面时的问候）", "en": "hello; good morning; good day", "pos": "interjection", "ipa": "/bɔ̃.ʒuʁ/"},
    "ça": {"zh": "这；那；它（cela 的口语形式）", "en": "this; that; it (informal pronoun)", "pos": "pronoun", "ipa": "/sa/"},
    "cela": {"zh": "这；那；那个事物", "en": "that; it", "pos": "pronoun", "ipa": "/sə.la/"},
    "organiser": {"zh": "组织；安排；筹办", "en": "to organise; to arrange", "pos": "verb"},
    "pratiquer": {"zh": "练习、从事（运动或活动）；从业、执业；实行、采用（方法）；信奉、履行（宗教）；开设、开出（通道或切口）；收取、实行（价格）", "en": "to practise or engage in; to work as a profession; to apply a method; to observe a religion; to make an opening; to charge a price", "pos": "verb"},
    "espérer": {"zh": "希望；期望", "en": "to hope", "pos": "verb"},
    "appeler": {"zh": "叫；称呼；打电话给", "en": "to call", "pos": "verb"},
    "marcher": {"zh": "走；步行；行进；运转；运行；奏效；进展；踩踏", "en": "to walk; to move; to work or function; to progress; to step", "pos": "verb", "ipa": "/maʁ.ʃe/"},
    "marche": {"word": "marche", "zh": "行走；步态；路程；行军；行进；行驶；运转；进程；步骤；办法；游行；进行曲；台阶；踏板；足迹；边境地区", "en": "walking; gait; distance walked; march; movement; functioning; process; procedure; demonstration; march music; stair step; pedal; footprint; border region", "pos": "noun", "ipa": "/maʁʃ/"},
    "un peu": {"zh": "一点；有点；稍微", "en": "a little; a bit; slightly", "pos": "adverb", "ipa": "/œ̃ pø/"},
    "s'appeler": {"zh": "名叫；称为", "en": "to be called", "pos": "verb"},
    "à partir de": {"zh": "从……开始；自……起", "en": "starting from; as of", "pos": "phrase"},
    "avoir besoin de": {"zh": "需要", "en": "to need", "pos": "phrase"},
    "à": {"zh": "在；到；向；以（介词，具体含义随搭配变化）", "en": "at; to; in; with", "pos": "preposition", "ipa": "/a/"},
    "a": {"word": "a", "zh": "有；avoir 的第三人称单数现在时", "en": "has; third-person singular of avoir", "pos": "verb", "ipa": "/a/"},
    "est": {"zh": "是；être 的第三人称单数现在时", "en": "is; third-person singular of être", "pos": "verb", "ipa": "/ɛ/"},
    "où": {"zh": "哪里；在……的地方；在……的时候", "en": "where; when", "pos": "adverb", "ipa": "/u/"},
    "ou": {"zh": "或者；还是", "en": "or", "pos": "conjunction", "ipa": "/u/"},
    "de": {"zh": "从；的；关于（介词，具体含义随搭配变化）", "en": "of; from; about", "pos": "preposition", "ipa": "/də/"},
    "le": {"zh": "这个；该（阳性单数定冠词）", "en": "the (masculine singular)", "pos": "article", "ipa": "/lə/"},
    "la": {"zh": "这个；该（阴性单数定冠词）", "en": "the (feminine singular)", "pos": "article", "ipa": "/la/"},
    "les": {"zh": "这些；那些（复数定冠词）", "en": "the (plural)", "pos": "article", "ipa": "/le/"},
    "un": {"zh": "一；一个（阳性）", "en": "one; a; an (masculine)", "pos": "determiner", "ipa": "/œ̃/"},
    "une": {"zh": "一；一个（阴性）", "en": "one; a; an (feminine)", "pos": "determiner", "ipa": "/yn/"},
    "des": {"zh": "一些；若干；de + les 的缩合形式", "en": "some; of the", "pos": "determiner", "ipa": "/de/"},
    "et": {"zh": "和；以及", "en": "and", "pos": "conjunction", "ipa": "/e/"},
}


def normalize_key(value: str) -> str:
    value = unicodedata.normalize("NFC", str(value or "").strip().lower().replace("’", "'"))
    value = re.sub(r"\s+", " ", value)
    value = "".join(ch for ch in value if ch.isalnum() or unicodedata.category(ch).startswith("M") or ch in " '-")
    return value.strip(" '-")


def fold_key(value: str) -> str:
    value = unicodedata.normalize("NFD", normalize_key(value))
    return "".join(ch for ch in value if unicodedata.category(ch) != "Mn")


def shard_for(key: str) -> str:
    result = 0
    for char in key:
        result = ((result * 31) + ord(char)) & 0xFFFFFFFF
    return f"{result % SHARD_COUNT:02x}"


def compact_text(value: str, limit: int = 320) -> str:
    value = html.unescape(TAG_RE.sub(" ", str(value or "")))
    value = re.sub(r"\s+", " ", value).strip(" ;；,，")
    return value[:limit]


def simplify_chinese(value: str) -> str:
    value = str(value or "")
    return OPENCC.convert(value) if OPENCC else value


def unique_join(values: Iterable[str], limit: int = 4, max_chars: int = 320) -> str:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        value = compact_text(value)
        if not value or value.casefold() in seen:
            continue
        seen.add(value.casefold())
        output.append(value)
        if len(output) >= limit:
            break
    return "；".join(output)[:max_chars]


def clean_chinese(raw: str, limit: int = 6) -> str:
    source = html.unescape(str(raw or ""))
    nodes = CHINESE_NODE_RE.findall(source)
    if nodes:
        pieces = []
        for node in nodes:
            value = TAG_RE.sub(" ", node)
            value = re.sub(r"(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])", "", value)
            value = re.sub(r"\s+", " ", value).strip(" ;；,，()（）")
            if value and re.search(r"[\u3400-\u9fff]", value):
                pieces.append(value)
    else:
        text = TAG_RE.sub(" ", source)
        pieces = [re.sub(r"\s+", " ", piece).strip(" ;；,，()（）") for piece in CJK_RE.findall(text)]
    return simplify_chinese(unique_join(pieces, limit=limit, max_chars=240))


def cache_path(name: str) -> Path:
    for directory in (LOCAL_CACHE, LEGACY_CACHE):
        candidate = directory / name
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"Missing source cache: {name}")


def read_stardict_rows(directory: Path) -> Iterable[tuple[str, str]]:
    idx_path = next(directory.rglob("*.idx.gz"), None)
    dict_path = next(directory.rglob("*.dict"), None) or next(directory.rglob("*.dict.dz"), None)
    if not idx_path or not dict_path:
        raise FileNotFoundError(f"No Stardict data under {directory}")
    index = gzip.decompress(idx_path.read_bytes())
    data = gzip.decompress(dict_path.read_bytes()) if dict_path.name.endswith(".dz") else dict_path.read_bytes()
    offset = 0
    while offset < len(index):
        end = index.index(b"\0", offset)
        word = index[offset:end].decode("utf-8")
        data_offset, data_size = struct.unpack(">II", index[end + 1 : end + 9])
        offset = end + 9
        yield word, data[data_offset : data_offset + data_size].decode("utf-8", errors="replace")


def freedict_pos(raw: str) -> str:
    text = TAG_RE.sub(" ", raw).lower()
    for token, label in POS_LABELS.items():
        if re.search(rf"\b{re.escape(token)}\b", text):
            return label
    return ""


def load_freedict(pair: str) -> tuple[dict[str, str], dict[tuple[str, str], str]]:
    directory = cache_path(f"freedict-{pair}")
    generic: dict[str, str] = {}
    by_pos: dict[tuple[str, str], str] = {}
    for word, raw in read_stardict_rows(directory):
        key = normalize_key(word)
        meaning = clean_chinese(raw)
        if not key or not meaning:
            continue
        generic[key] = unique_join([generic.get(key, ""), meaning], limit=8, max_chars=240)
        pos = freedict_pos(raw)
        if pos:
            by_pos[(key, pos)] = unique_join([by_pos.get((key, pos), ""), meaning], limit=8, max_chars=240)
    return generic, by_pos


ECDICT_POS = {
    "n": "noun",
    "v": "verb",
    "vi": "verb",
    "vt": "verb",
    "adj": "adjective",
    "adv": "adverb",
    "prep": "preposition",
    "pron": "pronoun",
    "conj": "conjunction",
    "num": "numeral",
    "art": "article",
    "int": "interjection",
}


def clean_ecdict_line(value: str) -> tuple[str, str]:
    value = simplify_chinese(compact_text(value, 500))
    match = re.match(r"^(n|v|vi|vt|adj|adv|prep|pron|conj|num|art|int)\.\s*", value, re.I)
    pos = ECDICT_POS.get(match.group(1).lower(), "") if match else ""
    if match:
        value = value[match.end():]
    value = re.sub(r"^\[(?:网络|网路)\]\s*", "", value)
    value = re.sub(r"\s*,\s*", "；", value)
    return value.strip(" ；,，"), pos


def load_ecdict() -> tuple[dict[str, str], dict[tuple[str, str], str]]:
    path = cache_path("ecdict.csv")
    generic: dict[str, str] = {}
    by_pos: dict[tuple[str, str], str] = {}
    with path.open("r", encoding="utf-8", newline="") as source:
        for row in csv.DictReader(source):
            key = normalize_key(row.get("word") or "")
            if not key:
                continue
            values: list[str] = []
            for raw_line in str(row.get("translation") or "").splitlines():
                value, pos = clean_ecdict_line(raw_line)
                if not value or raw_line.lstrip().startswith(("[网络]", "[网路]")):
                    continue
                values.append(value)
                if pos:
                    by_pos[(key, pos)] = unique_join([by_pos.get((key, pos), ""), value], limit=12, max_chars=360)
            meaning = unique_join(values, limit=12, max_chars=360)
            if meaning:
                generic[key] = unique_join([generic.get(key, ""), meaning], limit=12, max_chars=360)
    return generic, by_pos


def normalize_pos(value: str) -> str:
    return POS_LABELS.get(str(value or "").lower(), str(value or "").replace("_", " "))


def english_bridge_candidates(gloss: str) -> list[str]:
    gloss = compact_text(gloss, 180)
    gloss = re.sub(r"^\([^)]*\)\s*", "", gloss)
    first = re.split(r"[.;:]", gloss, 1)[0].strip()
    candidates: list[str] = []

    def add(value: str) -> None:
        key = normalize_key(value)
        if key and key not in candidates:
            candidates.append(key)

    add(first)
    stripped = re.sub(r"^(?:to|a|an|the)\s+", "", first, flags=re.I)
    add(stripped)
    for part in re.split(r"\s*(?:,|/|\bor\b)\s*", stripped, flags=re.I):
        add(part)
    words = re.findall(r"[A-Za-z][A-Za-z'-]*", stripped)
    if words:
        # A leading verb/noun in a dictionary gloss is usually the semantic head.
        add(words[0])
        if len(words) >= 2:
            add(" ".join(words[:2]))
    return candidates


def bridge_chinese(glosses: list[str], pos: str, generic: dict[str, str], by_pos: dict[tuple[str, str], str]) -> str:
    meanings: list[str] = []
    stop = {"a", "an", "the", "to", "at", "in", "on", "of", "for", "from", "with", "and", "or"}
    for gloss in glosses[:6]:
        for candidate in english_bridge_candidates(gloss):
            if candidate in stop:
                continue
            meaning = by_pos.get((candidate, pos))
            if not meaning and (" " in candidate or len(candidate) > 2):
                meaning = generic.get(candidate)
            if meaning:
                meanings.append(meaning)
                break
    return unique_join(meanings, limit=6, max_chars=240)


def first_ipa(item: dict[str, Any]) -> str:
    for sound in item.get("sounds") or []:
        ipa = compact_text(sound.get("ipa") or "", 120)
        if ipa:
            return ipa if ipa.startswith(("/", "[")) else f"/{ipa}/"
    return ""


def first_audio(item: dict[str, Any]) -> str:
    for sound in item.get("sounds") or []:
        url = str(sound.get("mp3_url") or sound.get("ogg_url") or "")
        if url:
            return url
    return ""


def lexical_senses(item: dict[str, Any]) -> list[dict[str, Any]]:
    senses = item.get("senses") or []
    return [sense for sense in senses if not sense.get("form_of") and "form-of" not in set(sense.get("tags") or [])]


def sense_glosses(senses: list[dict[str, Any]]) -> list[str]:
    output: list[str] = []
    for sense in senses:
        for gloss in sense.get("glosses") or []:
            gloss = compact_text(gloss)
            if gloss and not FORM_GLOSS_RE.search(gloss):
                output.append(gloss)
    return output


def sense_chinese(senses: list[dict[str, Any]]) -> str:
    values: list[str] = []
    for sense in senses:
        for translation in sense.get("translations") or []:
            code = str(translation.get("lang_code") or "").lower()
            language = str(translation.get("lang") or "").lower()
            if code in {"zh", "cmn", "yue"} or "chinese" in language or "mandarin" in language:
                values.append(str(translation.get("word") or translation.get("roman") or ""))
    return simplify_chinese(unique_join(values, limit=8, max_chars=240))


def merge_entry(entries: dict[str, dict[str, Any]], key: str, incoming: dict[str, Any]) -> None:
    current = entries.setdefault(key, {"word": incoming.get("word") or key, "ipa": "", "zh": "", "en": "", "pos": "", "audio": "", "source": ""})
    for field in ("word", "ipa", "audio"):
        if not current.get(field) and incoming.get(field):
            current[field] = incoming[field]
    for field, limit in (("zh", 8), ("en", 4), ("pos", 4), ("source", 4)):
        current[field] = unique_join([current.get(field, ""), incoming.get(field, "")], limit=limit, max_chars=320)


def form_features(form: dict[str, Any]) -> str:
    tags = [str(tag).replace("-", " ") for tag in form.get("tags") or []]
    tags = [tag for tag in tags if tag not in {"table tags", "canonical", "no table tags", "inflection template"}]
    return " · ".join(tags[:6])


def build_french(eng_zh: dict[str, str], eng_zh_pos: dict[tuple[str, str], str]) -> tuple[dict[str, dict[str, Any]], dict[str, list[str]]]:
    direct_zh, _ = load_freedict("fra-zho")
    entries: dict[str, dict[str, Any]] = {}
    forms: dict[str, list[str]] = {}
    path = cache_path("kaikki-French.jsonl.gz")
    processed = 0
    with gzip.open(path, "rt", encoding="utf-8") as source:
        for line in source:
            if not line.strip():
                continue
            item = json.loads(line)
            word = str(item.get("word") or "").strip()
            key = normalize_key(word)
            if not key:
                continue
            pos = normalize_pos(item.get("pos") or "")
            senses = lexical_senses(item)
            glosses = sense_glosses(senses)
            if senses or not item.get("senses"):
                zh = unique_join([
                    sense_chinese(senses),
                    bridge_chinese(glosses, pos, eng_zh, eng_zh_pos),
                    direct_zh.get(key, ""),
                ], limit=12, max_chars=360)
                merge_entry(entries, key, {
                    "word": word,
                    "ipa": first_ipa(item),
                    "zh": zh,
                    "en": unique_join(glosses, limit=4, max_chars=320),
                    "pos": pos,
                    "audio": first_audio(item),
                    "source": "Kaikki/Wiktionary",
                })
            for form in item.get("forms") or []:
                form_key = normalize_key(form.get("form") or "")
                if form_key and form_key != key and len(form_key) <= 80:
                    forms.setdefault(form_key, [key, pos, form_features(form), compact_text(form.get("ipa") or "", 100)])
            for sense in item.get("senses") or []:
                for relation in sense.get("form_of") or []:
                    lemma = relation.get("word") if isinstance(relation, dict) else relation
                    lemma_key = normalize_key(lemma)
                    if lemma_key and lemma_key != key:
                        forms.setdefault(key, [lemma_key, pos, "inflected form", first_ipa(item)])
            processed += 1
            if processed % 100000 == 0:
                print(f"  Kaikki: {processed:,} rows, {len(entries):,} entries, {len(forms):,} forms", flush=True)

    for key, meaning in direct_zh.items():
        if key in entries:
            entries[key]["zh"] = unique_join([entries[key].get("zh", ""), meaning], limit=12, max_chars=360)

    merge_morphalou(forms)
    for word, fields in CURATED_FR.items():
        key = normalize_key(word)
        merge_entry(entries, key, {"word": word, "source": "OoFR 校订", **fields})
        # Curated values take precedence for these high-risk/common entries.
        for field in ("zh", "en", "pos", "ipa"):
            if fields.get(field):
                entries[key][field] = fields[field]
        if fields.get("word"):
            entries[key]["word"] = fields["word"]
    return entries, forms


def merge_morphalou(forms: dict[str, list[str]]) -> None:
    archive = cache_path("Morphalou3.1_formatCSV_toutEnUn.zip")
    with zipfile.ZipFile(archive) as zipped:
        csv_name = next(name for name in zipped.namelist() if name.endswith("Morphalou3.1_CSV.csv"))
        stream = io.TextIOWrapper(zipped.open(csv_name), encoding="utf-8", newline="")
        for _ in range(16):
            next(stream, None)
        reader = csv.reader(stream, delimiter=";")
        current_lemma = ""
        current_pos = ""
        merged = 0
        for row in reader:
            if len(row) < 18:
                continue
            if row[0].strip():
                current_lemma = normalize_key(row[0])
                current_pos = MORPHALOU_POS.get(row[2].strip(), normalize_pos(row[2].strip()))
            form_key = normalize_key(row[9])
            if not current_lemma or not form_key or form_key == current_lemma:
                continue
            features = " · ".join(value for value in [row[11], row[12], row[14], row[15], row[16]] if value and value != "-")
            if form_key not in forms:
                forms[form_key] = [current_lemma, current_pos, features, ""]
                merged += 1
        print(f"  Morphalou: added {merged:,} form mappings", flush=True)


def build_english(eng_zh: dict[str, str], eng_zh_pos: dict[tuple[str, str], str]) -> dict[str, dict[str, Any]]:
    archive = cache_path("english-wordnet-2025-json.zip")
    entries: dict[str, dict[str, Any]] = {}
    with zipfile.ZipFile(archive) as zipped:
        synsets: dict[str, dict[str, Any]] = {}
        for name in zipped.namelist():
            if name.startswith(("noun.", "verb.", "adj.", "adv.")) and name.endswith(".json"):
                synsets.update(json.loads(zipped.read(name)))
        for name in zipped.namelist():
            if not name.startswith("entries-") or not name.endswith(".json"):
                continue
            payload = json.loads(zipped.read(name))
            for word, pos_groups in payload.items():
                key = normalize_key(word)
                if not key:
                    continue
                for pos_code, group in pos_groups.items():
                    pos = {"n": "noun", "v": "verb", "a": "adjective", "s": "adjective", "r": "adverb"}.get(pos_code, pos_code)
                    definitions: list[str] = []
                    for sense in group.get("sense") or []:
                        synset = synsets.get(str(sense.get("synset") or ""), {})
                        definitions.extend(synset.get("definition") or [])
                    pronunciations = group.get("pronunciation") or []
                    ipa = compact_text(pronunciations[0].get("value") if pronunciations else "", 100)
                    if ipa and not ipa.startswith(("/", "[")):
                        ipa = f"/{ipa}/"
                    zh = eng_zh_pos.get((key, pos)) or eng_zh.get(key, "")
                    merge_entry(entries, key, {
                        "word": word,
                        "ipa": ipa,
                        "zh": zh,
                        "en": unique_join(definitions, limit=4, max_chars=320),
                        "pos": pos,
                        "source": "Open English WordNet 2025",
                    })
    return entries


def write_sharded(kind: str, language: str, rows: dict[str, Any]) -> dict[str, Any]:
    directory = OUT_DIR / language
    buckets: dict[str, dict[str, Any]] = defaultdict(dict)
    for key, value in rows.items():
        buckets[shard_for(key)][key] = value
    files: list[dict[str, Any]] = []
    for shard in (f"{index:02x}" for index in range(SHARD_COUNT)):
        path = directory / f"{kind}-{shard}.json"
        payload = buckets.get(shard, {})
        path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        files.append({"shard": shard, "file": f"{language}/{path.name}", "count": len(payload), "bytes": path.stat().st_size})
    return {"count": len(rows), "files": files}


def compact_entry(item: dict[str, Any]) -> list[str]:
    values = [str(item.get(field) or "") for field in ("word", "ipa", "zh", "en", "pos", "audio", "source")]
    values[2] = simplify_chinese(values[2])
    return values


def build_aliases(entries: dict[str, Any]) -> dict[str, list[str]]:
    aliases: dict[str, list[str]] = defaultdict(list)
    for key in entries:
        folded = fold_key(key)
        if folded and folded != key and key not in aliases[folded]:
            aliases[folded].append(key)
    return dict(aliases)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--language", choices=["all", "fr", "en"], default="all")
    args = parser.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    freedict_zh, freedict_zh_pos = load_freedict("eng-zho")
    ecdict_zh, ecdict_zh_pos = load_ecdict()
    eng_zh = dict(freedict_zh)
    eng_zh_pos = dict(freedict_zh_pos)
    for key, meaning in ecdict_zh.items():
        eng_zh[key] = unique_join([meaning, eng_zh.get(key, "")], limit=12, max_chars=360)
    for key, meaning in ecdict_zh_pos.items():
        eng_zh_pos[key] = unique_join([meaning, eng_zh_pos.get(key, "")], limit=12, max_chars=360)
    manifest: dict[str, Any] = {
        "type": "oofr.dictionary.v3",
        "version": datetime.now(timezone.utc).strftime("%Y.%m.%d"),
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "shards": SHARD_COUNT,
        "languages": {},
    }
    if args.language in {"all", "fr"}:
        print("Building French dictionary…", flush=True)
        entries, forms = build_french(eng_zh, eng_zh_pos)
        (OUT_DIR / "fr").mkdir(parents=True, exist_ok=True)
        manifest["languages"]["fr"] = {
            "entries": write_sharded("entries", "fr", {key: compact_entry(value) for key, value in entries.items()}),
            "forms": write_sharded("forms", "fr", forms),
            "aliases": write_sharded("aliases", "fr", build_aliases(entries)),
            "sources": ["Kaikki/Wiktionary", "Morphalou 3.1", "FreeDict fra-zho", "FreeDict eng-zho", "ECDICT"],
        }
        print(f"  French complete: {len(entries):,} entries, {len(forms):,} forms", flush=True)
    if args.language in {"all", "en"}:
        print("Building English dictionary…", flush=True)
        entries = build_english(eng_zh, eng_zh_pos)
        (OUT_DIR / "en").mkdir(parents=True, exist_ok=True)
        manifest["languages"]["en"] = {
            "entries": write_sharded("entries", "en", {key: compact_entry(value) for key, value in entries.items()}),
            "forms": {"count": 0, "files": []},
            "aliases": write_sharded("aliases", "en", build_aliases(entries)),
            "sources": ["Open English WordNet 2025", "FreeDict eng-zho", "ECDICT"],
        }
        print(f"  English complete: {len(entries):,} entries", flush=True)
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT_DIR / 'manifest.json'}", flush=True)


if __name__ == "__main__":
    main()
