#!/usr/bin/env python3
"""Build MulTape lexicon packages.

The builder is intentionally source-driven and does not hand-maintain small
sample tables. By default it applies no entry limit: every usable headword,
Chinese translation, IPA value, and inflected form found in the configured
sources is considered for the generated package.
"""

from __future__ import annotations

import argparse
import gzip
import html
import json
import re
import shutil
import struct
import tarfile
import tempfile
import time
import unicodedata
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "lexicons"
DEFAULT_CACHE_DIR = ROOT / ".lexicon-cache"
MANIFEST_PATH = OUT_DIR / "manifest.json"
USER_AGENT = "MulTape lexicon builder/1.0"

CHUNK_SIZE = 1024 * 1024
LEXICON_CHUNK_TARGET_BYTES = 2 * 1024 * 1024
TAG_RE = re.compile(r"<[^>]+>")
CJK_RE = re.compile(r"[\u3400-\u9fff][\u3400-\u9fff，、；（）()·\s-]*")
IPA_RE = re.compile(r"/\s*([^/]{1,120})\s*/")
FREEDICT_ARCHIVE_RE = re.compile(r'href="([^"]*stardict[^"]*\.tar\.xz)"')
FORM_SKIP_TAGS = {
    "table-tags",
    "inflection-template",
    "no-table-tags",
    "romanization",
    "canonical",
    "class",
    "error-unrecognized-form"
}
FORM_GLOSS_RE = re.compile(
    r"\b("
    r"inflection of|form of|plural of|singular of|conjugation of|declension of|"
    r"participle of|comparative form of|superlative form of|alternative form of|"
    r"alternative spelling of|obsolete spelling of"
    r")\b",
    re.I,
)
ENGLISH_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "chiefly", "for", "from", "in",
    "into", "is", "it", "its", "of", "on", "or", "one", "someone", "something", "that",
    "the", "their", "to", "used", "with", "without", "usually", "especially", "person",
    "thing", "place", "obsolete", "slang", "colloquial", "informal", "formal", "plural",
    "singular", "masculine", "feminine", "neuter"
}


@dataclass(frozen=True)
class PackConfig:
    pair: str
    source_language: str
    target_language: str
    kaikki_name: str
    freedict_pair: str | None = None
    english_freedict_pair: str | None = None
    ipa_code: str | None = None
    extra_sources: tuple[str, ...] = field(default_factory=tuple)


PACKS: dict[str, PackConfig] = {
    "fr-zh": PackConfig(
      pair="fr-zh",
      source_language="fr",
      target_language="zh",
      kaikki_name="French",
      freedict_pair="fra-zho",
      ipa_code="fr_FR",
    ),
    "de-zh": PackConfig("de-zh", "de", "zh", "German"),
    "sv-zh": PackConfig("sv-zh", "sv", "zh", "Swedish", freedict_pair="swe-zho", ipa_code="sv"),
    "es-zh": PackConfig("es-zh", "es", "zh", "Spanish", ipa_code="es_ES"),
    "it-zh": PackConfig("it-zh", "it", "zh", "Italian"),
    "ja-zh": PackConfig("ja-zh", "ja", "zh", "Japanese", ipa_code="ja"),
    "ko-zh": PackConfig("ko-zh", "ko", "zh", "Korean", ipa_code="ko"),
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Build MulTape lexicon package JSON files.")
    parser.add_argument("--pair", choices=["all", *PACKS.keys()], default="all")
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    parser.add_argument("--refresh", action="store_true", help="Redownload upstream source files.")
    parser.add_argument("--max-entries", type=int, default=0, help="Debug only: stop after this many Kaikki rows.")
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    selected = PACKS.values() if args.pair == "all" else [PACKS[args.pair]]

    manifest = load_manifest()
    for config in selected:
        print(f"Building {config.pair} from full configured sources", flush=True)
        package = build_package(config, args.cache_dir, args.refresh, args.max_entries)
        artifacts = write_package(config, package)
        update_manifest_package(manifest, config, package, artifacts)
        print(
            f"  wrote {config.pair}: "
            f"{len(package['entries'])} entries, {len(package['forms'])} forms"
            ,
            flush=True
        )
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build_package(config: PackConfig, cache_dir: Path, refresh: bool, max_entries: int) -> dict[str, Any]:
    entries: dict[str, dict[str, str]] = {}
    forms: dict[str, str] = {}
    sources: list[str] = []

    english_zh_map = load_english_zh_map(cache_dir, refresh)
    if english_zh_map:
        sources.append("FreeDict eng-zho bridge")

    ipa_map = load_ipa_map(config, cache_dir, refresh)
    if ipa_map:
        sources.append(f"open-dict-data ipa-dict {config.ipa_code}")

    kaikki_path = download_kaikki(config, cache_dir, refresh)
    sources.append(f"Kaikki {config.kaikki_name} Wiktionary dump")
    parse_kaikki(config, kaikki_path, entries, forms, ipa_map, english_zh_map, max_entries=max_entries)

    if config.freedict_pair:
        try:
            freedict_dir = download_freedict(config.freedict_pair, cache_dir, refresh)
            merge_freedict(config, freedict_dir, entries)
            sources.append(f"FreeDict {config.freedict_pair}")
        except Exception as error:
            print(f"  warning: FreeDict {config.freedict_pair} skipped: {error}")

    if config.english_freedict_pair:
        try:
            bridge_dir = download_freedict(config.english_freedict_pair, cache_dir, refresh)
            merge_english_bridge(config, bridge_dir, entries, english_zh_map)
            sources.append(f"FreeDict {config.english_freedict_pair} via eng-zho")
        except Exception as error:
            print(f"  warning: FreeDict {config.english_freedict_pair} bridge skipped: {error}", flush=True)

    sources.extend(config.extra_sources)
    entry_rows = [
        [key, item.get("word", key), item.get("ipa", ""), item.get("meaning", ""), item.get("pos", "")]
        for key, item in sorted(entries.items())
    ]
    form_rows = [[form, lemma] for form, lemma in sorted(forms.items()) if form != lemma and lemma in entries]

    return {
        "type": "multape.lexicon.v1",
        "pair": config.pair,
        "sourceLanguage": config.source_language,
        "targetLanguage": config.target_language,
        "version": datetime.now(timezone.utc).strftime("%Y.%m.%d"),
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "sources": sources,
        "entries": entry_rows,
        "forms": form_rows,
    }


def parse_kaikki(
    config: PackConfig,
    path: Path,
    entries: dict[str, dict[str, str]],
    forms: dict[str, str],
    ipa_map: dict[str, str],
    english_zh_map: dict[str, str],
    max_entries: int = 0,
) -> None:
    processed = 0
    with gzip.open(path, "rt", encoding="utf-8") as file:
        for line in file:
            if not line.strip():
                continue
            processed += 1
            if max_entries and processed > max_entries:
                break
            item = json.loads(line)
            word = str(item.get("word") or "").strip()
            key = normalize_word(word, config.source_language)
            if not key:
                continue
            ipa = first_ipa(item.get("sounds") or []) or ipa_map.get(key, "")
            meaning = chinese_translations(item) or translate_english_glosses(item, english_zh_map)
            pos = str(item.get("pos") or "")
            merge_entry(entries, key, word, ipa, meaning, pos)
            for form in extract_forms(item, config.source_language):
                form_key = normalize_word(form, config.source_language)
                if form_key and form_key != key:
                    forms.setdefault(form_key, key)
            for lemma in extract_form_of_targets(item):
                lemma_key = normalize_word(lemma, config.source_language)
                if lemma_key and lemma_key != key:
                    forms.setdefault(key, lemma_key)
            for redirect in extract_redirect_targets(item):
                redirect_key = normalize_word(redirect, config.source_language)
                if redirect_key and redirect_key != key:
                    forms.setdefault(key, redirect_key)
            if processed % 100000 == 0:
                print(f"  Kaikki rows: {processed:,}; entries: {len(entries):,}; forms: {len(forms):,}", flush=True)


def merge_freedict(config: PackConfig, freedict_dir: Path, entries: dict[str, dict[str, str]]) -> None:
    merged = 0
    for word, raw in read_freedict_rows(freedict_dir):
        meaning = clean_chinese(raw, max_pieces=4)
        if not meaning:
            continue
        key = normalize_word(word, config.source_language)
        if not key:
            continue
        merge_entry(entries, key, word, clean_ipa(raw), meaning, "")
        merged += 1
    print(f"  FreeDict merged {merged:,} translated rows", flush=True)


def merge_english_bridge(
    config: PackConfig,
    freedict_dir: Path,
    entries: dict[str, dict[str, str]],
    english_zh_map: dict[str, str],
) -> None:
    merged = 0
    for word, raw in read_freedict_rows(freedict_dir):
        key = normalize_word(word, config.source_language)
        if not key:
            continue
        meaning = translate_english_text(raw, english_zh_map)
        if not meaning:
            continue
        current = entries.get(key)
        if current:
            before = current.get("meaning", "")
            current["meaning"] = merge_meanings(before, meaning)
            merged += int(current["meaning"] != before)
        else:
            merge_entry(entries, key, word, clean_ipa(raw), meaning, "")
            merged += 1
    print(f"  English bridge merged {merged:,} translated rows", flush=True)


def read_freedict_rows(freedict_dir: Path) -> list[tuple[str, str]]:
    idx_path = next(freedict_dir.rglob("*.idx.gz"), None)
    dict_path = next(freedict_dir.rglob("*.dict"), None) or next(freedict_dir.rglob("*.dict.dz"), None)
    if not idx_path or not dict_path:
        raise FileNotFoundError("FreeDict Stardict .idx.gz/.dict files not found")

    index = gzip.decompress(idx_path.read_bytes())
    dict_bytes = gzip.decompress(dict_path.read_bytes()) if dict_path.name.endswith(".dz") else dict_path.read_bytes()
    offset = 0
    rows: list[tuple[str, str]] = []
    while offset < len(index):
        end = index.index(b"\0", offset)
        word = index[offset:end].decode("utf-8")
        data_offset, data_size = struct.unpack(">II", index[end + 1 : end + 9])
        offset = end + 9
        raw = dict_bytes[data_offset : data_offset + data_size].decode("utf-8", errors="replace")
        rows.append((word, raw))
    return rows


def merge_entry(
    entries: dict[str, dict[str, str]],
    key: str,
    word: str,
    ipa: str,
    meaning: str,
    pos: str,
) -> None:
    current = entries.get(key)
    if not current:
        entries[key] = {"word": word, "ipa": ipa, "meaning": meaning, "pos": pos}
        return
    current["word"] = current.get("word") or word
    current["ipa"] = current.get("ipa") or ipa
    current["pos"] = current.get("pos") or pos
    current["meaning"] = merge_meanings(current.get("meaning", ""), meaning)


def chinese_translations(item: dict[str, Any]) -> str:
    pieces: list[str] = []
    for sense in item.get("senses") or []:
        for translation in sense.get("translations") or []:
            lang_code = str(translation.get("lang_code") or "").lower()
            lang = str(translation.get("lang") or "").lower()
            if lang_code not in {"zh", "cmn", "yue"} and "chinese" not in lang and "mandarin" not in lang:
                continue
            text = translation.get("word") or translation.get("roman") or ""
            if text:
                pieces.append(str(text))
    return clean_meaning("；".join(pieces), max_pieces=8)


def load_english_zh_map(cache_dir: Path, refresh: bool) -> dict[str, str]:
    try:
        freedict_dir = download_freedict("eng-zho", cache_dir, refresh)
    except Exception as error:
        print(f"  warning: FreeDict eng-zho bridge skipped: {error}", flush=True)
        return {}

    mapping: dict[str, str] = {}
    for word, raw in read_freedict_rows(freedict_dir):
        meaning = clean_chinese(raw)
        if not meaning:
            continue
        for key in english_keys(word):
            if key:
                mapping[key] = merge_meanings(mapping.get(key, ""), meaning)
    print(f"  English-Chinese bridge loaded {len(mapping):,} keys", flush=True)
    return mapping


def translate_english_glosses(item: dict[str, Any], english_zh_map: dict[str, str]) -> str:
    if not english_zh_map:
        return ""
    pieces: list[str] = []
    for sense in item.get("senses") or []:
        if sense.get("form_of"):
            continue
        if "form-of" in set(sense.get("tags") or []):
            continue
        for gloss in sense.get("glosses") or []:
            if FORM_GLOSS_RE.search(str(gloss)):
                continue
            translated = translate_english_text(str(gloss), english_zh_map)
            if translated:
                pieces.append(translated)
    return clean_meaning("；".join(pieces))


def extract_form_of_targets(item: dict[str, Any]) -> list[str]:
    targets: list[str] = []
    for sense in item.get("senses") or []:
        for form_of in sense.get("form_of") or []:
            word = form_of.get("word") if isinstance(form_of, dict) else form_of
            if word:
                targets.append(str(word))
    return targets


def extract_redirect_targets(item: dict[str, Any]) -> list[str]:
    targets: list[str] = []
    for redirect in item.get("redirects") or []:
        if redirect:
            targets.append(str(redirect))
    for sense in item.get("senses") or []:
        for alt_of in sense.get("alt_of") or []:
            word = alt_of.get("word") if isinstance(alt_of, dict) else alt_of
            if word:
                targets.append(str(word))
    return targets


def translate_english_text(raw: str, english_zh_map: dict[str, str]) -> str:
    if not english_zh_map:
        return ""
    text = html.unescape(TAG_RE.sub(" ", str(raw or "")))
    if FORM_GLOSS_RE.search(text):
        return ""
    text = re.sub(r"/[^/]{1,120}/", " ", text)
    text = re.sub(r"\([^)]{0,120}\)", " ", text)
    text = re.sub(r"\b(noun|verb|adjective|adverb|pronoun|preposition|conjunction|interjection|suffix|prefix)\b", " ", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip()
    candidates = english_translation_candidates(text)
    pieces: list[str] = []
    for candidate in candidates:
        meaning = english_zh_map.get(candidate)
        if meaning:
            for piece in split_meaning(meaning):
                if piece not in pieces:
                    pieces.append(piece)
                if len(pieces) >= 6:
                    return clean_meaning("；".join(pieces), max_pieces=6)
    return clean_meaning("；".join(pieces), max_pieces=6)


def english_translation_candidates(text: str) -> list[str]:
    candidates: list[str] = []

    def add(value: str) -> None:
        normalized = normalize_english(value)
        if normalized and normalized not in candidates:
            candidates.append(normalized)

    short = re.split(r"[.;:。；：]", text)[0]
    for piece in re.split(r"[,，/]|\\bor\\b|\\band\\b", short, flags=re.I):
        piece = re.sub(r"^(to|a|an|the|one who|someone who|something that)\s+", "", piece.strip(), flags=re.I)
        add(piece)

    words = [
        word
        for word in re.findall(r"[A-Za-z][A-Za-z'-]*", short.lower())
        if word not in ENGLISH_STOPWORDS and len(word) > 1
    ]
    for size in (3, 2, 1):
        for index in range(0, max(0, len(words) - size + 1)):
            add(" ".join(words[index:index + size]))
    return candidates


def english_keys(word: str) -> list[str]:
    keys = [normalize_english(word)]
    if "-" in word:
        keys.append(normalize_english(word.replace("-", " ")))
    return [key for key in dict.fromkeys(keys) if key]


def normalize_english(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", str(value or "").lower().replace("’", "'"))
    without_marks = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    normalized = re.sub(r"[^a-z0-9' -]", " ", without_marks)
    return re.sub(r"\s+", " ", normalized).strip(" '-")


def extract_forms(item: dict[str, Any], language_id: str) -> list[str]:
    forms: list[str] = []
    for form_item in item.get("forms") or []:
        tags = set(form_item.get("tags") or [])
        if tags & FORM_SKIP_TAGS:
            continue
        form = str(form_item.get("form") or "").strip()
        if not form or form in {"-", "—", "no-table-tags"}:
            continue
        if len(form) > 64:
            continue
        normalized = normalize_word(form, language_id)
        if normalized:
            forms.append(form)
    return forms


def first_ipa(sounds: list[dict[str, Any]]) -> str:
    for sound in sounds:
        value = str(sound.get("ipa") or "").strip()
        if value:
            return value if value.startswith("/") else f"/{value}/"
    return ""


def clean_ipa(raw: str) -> str:
    text = html.unescape(TAG_RE.sub(" ", raw))
    match = IPA_RE.search(text)
    if not match:
        return ""
    value = re.sub(r"\s+", " ", match.group(1)).strip()
    return f"/{value}/"


def clean_chinese(raw: str, max_pieces: int = 0) -> str:
    text = html.unescape(TAG_RE.sub(" ", raw))
    pieces = [" ".join(piece.split()) for piece in CJK_RE.findall(text)]
    unique = list(dict.fromkeys(piece for piece in pieces if piece))
    if max_pieces:
        unique = unique[:max_pieces]
    return clean_meaning("；".join(unique))


def clean_meaning(raw: str, max_pieces: int = 0) -> str:
    pieces = []
    seen = set()
    for piece in split_meaning(raw):
        value = re.sub(r"\s+", " ", piece).strip(" ;；,，")
        if not value or value in seen:
            continue
        seen.add(value)
        pieces.append(value)
        if max_pieces and len(pieces) >= max_pieces:
            break
    return "；".join(pieces)[:240]


def split_meaning(raw: str) -> list[str]:
    return re.split(r"[;；]\s*", str(raw or ""))


def merge_meanings(left: str, right: str) -> str:
    return clean_meaning(";".join(value for value in [left, right] if value), max_pieces=6)


def normalize_word(word: str, language_id: str) -> str:
    value = str(word or "").lower().replace("’", "'")
    if language_id in {"ja", "ko", "zh"}:
        return re.sub(r"[^\wー々〆ヶ가-힣ぁ-んァ-ン一-龯]", "", unicodedata.normalize("NFKC", value))
    decomposed = unicodedata.normalize("NFD", value)
    without_marks = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^\w'-]", "", without_marks, flags=re.UNICODE).strip("'-_")


def load_ipa_map(config: PackConfig, cache_dir: Path, refresh: bool) -> dict[str, str]:
    if not config.ipa_code:
        return {}
    target = cache_dir / f"ipa-{config.ipa_code}.txt"
    url = f"https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/{config.ipa_code}.txt"
    download(url, target, refresh=refresh)
    ipa: dict[str, str] = {}
    for line in target.read_text(encoding="utf-8").splitlines():
        if "\t" not in line:
            continue
        word, value = line.split("\t", 1)
        key = normalize_word(word, config.source_language)
        if key and key not in ipa:
            ipa[key] = value.strip()
    return ipa


def download_kaikki(config: PackConfig, cache_dir: Path, refresh: bool) -> Path:
    filename = f"kaikki-{config.kaikki_name}.jsonl.gz"
    target = cache_dir / filename
    url = f"https://kaikki.org/dictionary/{config.kaikki_name}/kaikki.org-dictionary-{config.kaikki_name}.jsonl.gz"
    if target.exists() and not refresh and not is_valid_gzip(target):
        print(f"  cached {target.name} is incomplete; redownloading", flush=True)
        target.unlink()
    download(url, target, refresh=refresh)
    return target


def is_valid_gzip(path: Path) -> bool:
    try:
        with gzip.open(path, "rb") as file:
            while file.read(CHUNK_SIZE):
                pass
        return True
    except Exception:
        return False


def download_freedict(pair: str, cache_dir: Path, refresh: bool) -> Path:
    target_dir = cache_dir / f"freedict-{pair}"
    has_stardict = (
        target_dir.exists()
        and next(target_dir.rglob("*.idx.gz"), None) is not None
        and next(target_dir.rglob("*.dict"), None) is not None
    )
    if has_stardict and not refresh:
        return target_dir
    if target_dir.exists():
        shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    index_url = f"https://download.freedict.org/dictionaries/{pair}/"
    index = fetch_text(index_url)
    archives = FREEDICT_ARCHIVE_RE.findall(index)
    if not archives:
        version_dirs = sorted(set(
            href.strip("/")
            for href in re.findall(r'href="([^"?][^"]*/)"', index)
            if not href.startswith("/") and href != "../"
        ))
        for version in reversed(version_dirs):
            version_url = f"{index_url}{version}/"
            version_index = fetch_text(version_url)
            archives = [f"{version}/{name}" for name in FREEDICT_ARCHIVE_RE.findall(version_index)]
            if archives:
                break
    if not archives:
        raise FileNotFoundError(f"No Stardict archive found at {index_url}")
    archive_name = sorted(archives)[-1]
    archive_url = index_url + archive_name
    archive_path = cache_dir / archive_name.replace("/", "-")
    download(archive_url, archive_path, refresh=refresh)
    with tarfile.open(archive_path) as tar:
        safe_extract(tar, target_dir)
    return target_dir


def safe_extract(tar: tarfile.TarFile, target_dir: Path) -> None:
    base = target_dir.resolve()
    for member in tar.getmembers():
        member_path = (target_dir / member.name).resolve()
        if base not in [member_path, *member_path.parents]:
            raise RuntimeError(f"Unsafe path in archive: {member.name}")
    tar.extractall(target_dir)


def download(url: str, target: Path, refresh: bool = False) -> None:
    if target.exists() and not refresh:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            download_once(url, target, attempt)
            return
        except Exception as error:
            last_error = error
            print(f"  download failed ({attempt}/3): {error}", flush=True)
            time.sleep(2 * attempt)
    if last_error:
        raise last_error


def download_once(url: str, target: Path, attempt: int = 1) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=300) as response, tempfile.NamedTemporaryFile(delete=False) as tmp:
        total = int(response.headers.get("content-length") or 0)
        loaded = 0
        next_report = 5 * CHUNK_SIZE
        if total:
            suffix = f" attempt {attempt}" if attempt > 1 else ""
            print(f"  downloading {target.name}: {total / (1024 * 1024):.1f} MB{suffix}", flush=True)
        else:
            print(f"  downloading {target.name}", flush=True)
        while True:
            chunk = response.read(CHUNK_SIZE)
            if not chunk:
                break
            tmp.write(chunk)
            loaded += len(chunk)
            if loaded >= next_report:
                if total:
                    print(f"    {loaded / (1024 * 1024):.1f}/{total / (1024 * 1024):.1f} MB", flush=True)
                else:
                    print(f"    {loaded / (1024 * 1024):.1f} MB", flush=True)
                next_report += 5 * CHUNK_SIZE
        tmp_path = Path(tmp.name)
    tmp_path.replace(target)


def fetch_text(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request) as response:
        return response.read().decode("utf-8", errors="replace")


def write_package(config: PackConfig, package: dict[str, Any]) -> dict[str, Any]:
    return write_chunked_package(config, package)


def write_chunked_package(config: PackConfig, package: dict[str, Any]) -> dict[str, Any]:
    target_dir = OUT_DIR / config.pair
    if target_dir.exists():
        shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    meta = {key: value for key, value in package.items() if key not in {"entries", "forms"}}
    meta_path = target_dir / "meta.json"
    write_json_text(meta_path, meta)
    entry_chunks = write_row_chunks(target_dir, "entries", package["entries"])
    form_chunks = write_row_chunks(target_dir, "forms", package["forms"])
    total_bytes = meta_path.stat().st_size + sum(item["bytes"] for item in entry_chunks + form_chunks)
    return {
        "bytes": total_bytes,
        "chunks": {
            "meta": {
                "file": f"{config.pair}/meta.json",
                "bytes": meta_path.stat().st_size,
            },
            "entries": entry_chunks,
            "forms": form_chunks,
        },
    }


def write_row_chunks(target_dir: Path, kind: str, rows: list[list[str]]) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    current: list[str] = []
    current_bytes = 2

    def flush() -> None:
        nonlocal current, current_bytes
        if not current:
            return
        index = len(chunks)
        filename = f"{kind}-{index:04d}.json"
        path = target_dir / filename
        text = "[" + ",".join(current) + "]"
        path.write_text(text, encoding="utf-8")
        chunks.append({
            "file": f"{target_dir.name}/{filename}",
            "count": len(current),
            "bytes": path.stat().st_size,
        })
        current = []
        current_bytes = 2

    for row in rows:
        row_text = json.dumps(row, ensure_ascii=False, separators=(",", ":"))
        row_bytes = len(row_text.encode("utf-8")) + (1 if current else 0)
        if current and current_bytes + row_bytes > LEXICON_CHUNK_TARGET_BYTES:
            flush()
        current.append(row_text)
        current_bytes += row_bytes
    flush()
    return chunks


def write_json_text(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def load_manifest() -> dict[str, Any]:
    if MANIFEST_PATH.exists():
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    return {
        "type": "multape.lexicon-manifest.v1",
        "version": "1.0.1-alpha",
        "updatedAt": "",
        "notes": "Generated chunked packages from scripts/build_lexicons.py.",
        "packages": [],
    }


def update_manifest_package(
    manifest: dict[str, Any],
    config: PackConfig,
    package: dict[str, Any],
    artifacts: dict[str, Any],
) -> None:
    manifest["updatedAt"] = datetime.now(timezone.utc).date().isoformat()
    packages = manifest.setdefault("packages", [])
    existing = next((item for item in packages if item.get("pair") == config.pair), None)
    if not existing:
        existing = {"pair": config.pair}
        packages.append(existing)
    existing.update({
        "pair": config.pair,
        "sourceLanguage": config.source_language,
        "targetLanguage": config.target_language,
        "format": "chunks-v1",
        "status": "ready",
        "entries": len(package["entries"]),
        "forms": len(package["forms"]),
        "bytes": artifacts["bytes"],
        "builtAt": package["builtAt"],
        "sources": package["sources"],
        "chunks": artifacts["chunks"],
    })
    existing.pop("file", None)


if __name__ == "__main__":
    main()
