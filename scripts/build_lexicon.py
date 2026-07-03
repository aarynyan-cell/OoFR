#!/usr/bin/env python3
"""Build the compact OoFR French-Chinese lexicon.

The generated file intentionally contains only the app-ready fields:
normalized lookup key, display word, IPA, and Chinese meaning.
"""

from __future__ import annotations

import gzip
import html
import json
import re
import struct
import tarfile
import tempfile
import unicodedata
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT_FILE = ROOT / "lexicon.js"

FREEDICT_URL = (
    "https://download.freedict.org/dictionaries/fra-zho/2025.11.23/"
    "freedict-fra-zho-2025.11.23.stardict.tar.xz"
)
IPA_URL = "https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/fr_FR.txt"

WORD_RE = re.compile(r"^[A-Za-zÀ-ÖØ-öø-ÿŒœÆæÇç'’-]+$")
IPA_RE = re.compile(r"/\s*([^/]{1,100})\s*/")
TAG_RE = re.compile(r"<[^>]+>")
CJK_RE = re.compile(r"[\u3400-\u9fff][\u3400-\u9fff，、；（）()·\s-]*")

MANUAL_ENTRIES = [
    ("à", "/a/", "到；在；向"),
    ("ai", "/e/", "有；助动词 avoir 的变位"),
    ("aime", "/ɛm/", "喜欢；爱"),
    ("apprendre", "/a.pʁɑ̃dʁ/", "学习"),
    ("apprends", "/a.pʁɑ̃/", "我/你学习"),
    ("aujourd'hui", "/o.ʒuʁ.dɥi/", "今天"),
    ("avez", "/a.ve/", "你们有；您有"),
    ("bonjour", "/bɔ̃.ʒuʁ/", "你好；早上好"),
    ("ce", "/sə/", "这；这个"),
    ("cette", "/sɛt/", "这个；这位"),
    ("est", "/ɛ/", "是"),
    ("et", "/e/", "和"),
    ("français", "/fʁɑ̃.sɛ/", "法语；法国的"),
    ("je", "/ʒə/", "我"),
    ("lentement", "/lɑ̃t.mɑ̃/", "慢慢地"),
    ("les", "/le/", "这些；那些；定冠词复数"),
    ("liaison", "/ljɛ.zɔ̃/", "联诵；联系"),
    ("liaisons", "/ljɛ.zɔ̃/", "联诵，复数"),
    ("merci", "/mɛʁ.si/", "谢谢"),
    ("nous", "/nu/", "我们"),
    ("phrase", "/fʁaz/", "句子"),
    ("plus", "/plys/ 或 /ply/", "更多；不再，读音随语境变化"),
    ("peux", "/pø/", "能够；可以"),
    ("pratiquer", "/pʁa.ti.ke/", "练习；实践"),
    ("répéter", "/ʁe.pe.te/", "重复"),
    ("s'appelle", "/sa.pɛl/", "叫作"),
    ("texte", "/tɛkst/", "文本"),
    ("tous", "/tu/ 或 /tus/", "所有，读音随语境变化"),
    ("tu", "/ty/", "你"),
    ("voudrais", "/vu.dʁɛ/", "我想要，条件式"),
    ("vous", "/vu/", "你们；您"),
]


def download(url: str, target: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "OoFR lexicon builder"})
    with urllib.request.urlopen(request) as response:
        target.write_bytes(response.read())


def normalize_word(word: str) -> str:
    word = word.lower().replace("’", "'")
    decomposed = unicodedata.normalize("NFD", word)
    without_marks = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    cleaned = re.sub(r"[^a-zœæç'-]", "", without_marks)
    return cleaned.strip("'-")


def clean_definition(raw: str) -> str:
    text = html.unescape(TAG_RE.sub(" ", raw))
    text = re.sub(r"\s+", " ", text).strip()
    pieces = [" ".join(piece.split()) for piece in CJK_RE.findall(text)]
    pieces = [piece for piece in pieces if piece]
    return "；".join(dict.fromkeys(pieces))[:96]


def clean_ipa(raw: str) -> str:
    text = html.unescape(TAG_RE.sub(" ", raw))
    match = IPA_RE.search(text)
    if not match:
        return ""
    value = re.sub(r"\s+", " ", match.group(1)).strip()
    return f"/{value}/"


def parse_stardict(base_dir: Path) -> dict[str, dict[str, str]]:
    base = base_dir / "fra-zho"
    index = gzip.decompress((base / "fra-zho.idx.gz").read_bytes())
    dict_bytes = (base / "fra-zho.dict").read_bytes()

    entries: dict[str, dict[str, str]] = {}
    offset = 0
    while offset < len(index):
        end = index.index(b"\0", offset)
        word = index[offset:end].decode("utf-8")
        data_offset, data_size = struct.unpack(">II", index[end + 1 : end + 9])
        offset = end + 9

        if len(word) > 32 or any(ch.isdigit() for ch in word) or not WORD_RE.match(word):
            continue

        raw = dict_bytes[data_offset : data_offset + data_size].decode("utf-8", errors="replace")
        zh = clean_definition(raw)
        if not zh:
            continue

        key = normalize_word(word)
        if not key or key in entries:
            continue

        entries[key] = {
            "word": word,
            "ipa": clean_ipa(raw),
            "zh": zh,
        }

    return entries


def parse_ipa_file(path: Path) -> dict[str, str]:
    ipa: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if "\t" not in line:
            continue
        word, value = line.split("\t", 1)
        key = normalize_word(word)
        if key and key not in ipa:
            ipa[key] = value.strip()
    return ipa


def apply_manual_entries(entries: dict[str, dict[str, str]]) -> None:
    for word, ipa, zh in MANUAL_ENTRIES:
        key = normalize_word(word)
        existing = entries.get(key, {})
        entries[key] = {
            "word": existing.get("word") or word,
            "ipa": ipa or existing.get("ipa", ""),
            "zh": zh or existing.get("zh", ""),
        }


def write_lexicon(entries: dict[str, dict[str, str]]) -> None:
    rows = [
        [key, item["word"], item.get("ipa", ""), item["zh"]]
        for key, item in sorted(entries.items(), key=lambda pair: pair[0])
    ]
    body = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    content = (
        "/* Generated by scripts/build_lexicon.py.\n"
        "   Sources: FreeDict fra-zho 2025.11.23 (CC BY-SA 3.0) and ipa-dict fr_FR (MIT).\n"
        "   Do not edit this file by hand. */\n"
        f"window.OOFR_LEXICON_ROWS={body};\n"
        "window.OOFR_LEXICON=Object.fromEntries(window.OOFR_LEXICON_ROWS.map(([key,word,ipa,zh])=>[key,{word,ipa,zh}]));\n"
        "window.OOFR_LEXICON_META={version:'2025.11.23+ipa-dict',entries:window.OOFR_LEXICON_ROWS.length};\n"
    )
    OUT_FILE.write_text(content, encoding="utf-8")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="oofr-lexicon-") as tmp:
        work = Path(tmp)
        archive = work / "fra-zho.tar.xz"
        ipa_file = work / "fr_FR.txt"

        download(FREEDICT_URL, archive)
        with tarfile.open(archive) as tar:
            tar.extractall(work)
        download(IPA_URL, ipa_file)

        entries = parse_stardict(work)
        ipa_map = parse_ipa_file(ipa_file)
        for key, item in entries.items():
            if not item.get("ipa") and key in ipa_map:
                item["ipa"] = ipa_map[key]
        apply_manual_entries(entries)
        write_lexicon(entries)

    print(f"Wrote {OUT_FILE} with {len(entries)} entries")


if __name__ == "__main__":
    main()
