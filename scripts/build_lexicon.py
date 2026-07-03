#!/usr/bin/env python3
"""Build the compact OoFR French-Chinese lexicon.

The generated file intentionally contains only the app-ready fields:
normalized lookup key, display word, IPA, and Chinese meaning.
"""

from __future__ import annotations

import gzip
import html
import csv
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
LEFFF_URL = (
    "https://raw.githubusercontent.com/ClaudeCoulombe/FrenchLefffLemmatizer/master/"
    "french_lefff_lemmatizer/data/lefff-3.4.mlex"
)
LEXIQUE_URL = "http://www.lexique.org/databases/Lexique383/Lexique383.tsv"
LEXIQUE_ENTRY_LIMIT = 28000

WORD_RE = re.compile(r"^[A-Za-zÀ-ÖØ-öø-ÿŒœÆæÇç'’-]+$")
IPA_RE = re.compile(r"/\s*([^/]{1,100})\s*/")
TAG_RE = re.compile(r"<[^>]+>")
CJK_RE = re.compile(r"[\u3400-\u9fff][\u3400-\u9fff，、；（）()·\s-]*")
LEXIQUE_PHON_MAP = {
    "@": "ɑ̃",
    "1": "œ̃",
    "2": "ø",
    "5": "ɛ̃",
    "9": "œ",
    "§": "ɔ̃",
    "°": "ə",
    "A": "ɑ",
    "E": "ɛ",
    "G": "ŋ",
    "H": "ɥ",
    "N": "ɲ",
    "O": "ɔ",
    "R": "ʁ",
    "S": "ʃ",
    "Z": "ʒ",
}

MANUAL_ENTRIES = [
    ("à", "/a/", "到；在；向"),
    ("ai", "/e/", "有；助动词 avoir 的变位"),
    ("aime", "/ɛm/", "喜欢；爱"),
    ("aller", "/a.le/", "去；将要"),
    ("apprendre", "/a.pʁɑ̃dʁ/", "学习"),
    ("apprends", "/a.pʁɑ̃/", "我/你学习"),
    ("aujourd'hui", "/o.ʒuʁ.dɥi/", "今天"),
    ("avoir", "/a.vwaʁ/", "有；助动词"),
    ("avez", "/a.ve/", "你们有；您有"),
    ("bonjour", "/bɔ̃.ʒuʁ/", "你好；早上好"),
    ("ce", "/sə/", "这；这个"),
    ("cette", "/sɛt/", "这个；这位"),
    ("choisir", "/ʃwa.ziʁ/", "选择；挑选"),
    ("est", "/ɛ/", "是"),
    ("et", "/e/", "和"),
    ("français", "/fʁɑ̃.sɛ/", "法语；法国的"),
    ("faire", "/fɛʁ/", "做；制造"),
    ("je", "/ʒə/", "我"),
    ("jour", "/ʒuʁ/", "天；日；白天"),
    ("lentement", "/lɑ̃t.mɑ̃/", "慢慢地"),
    ("les", "/le/", "这些；那些；定冠词复数"),
    ("liaison", "/ljɛ.zɔ̃/", "联诵；联系"),
    ("liaisons", "/ljɛ.zɔ̃/", "联诵，复数"),
    ("merci", "/mɛʁ.si/", "谢谢"),
    ("nous", "/nu/", "我们"),
    ("phrase", "/fʁaz/", "句子"),
    ("plus", "/plys/ 或 /ply/", "更多；不再，读音随语境变化"),
    ("peux", "/pø/", "能够；可以"),
    ("pouvoir", "/pu.vwaʁ/", "能够；可以"),
    ("pour", "/puʁ/", "为了；给；对于"),
    ("prendre", "/pʁɑ̃dʁ/", "拿；取；乘；吃"),
    ("pratiquer", "/pʁa.ti.ke/", "练习；实践"),
    ("quel", "/kɛl/", "哪个；什么样的"),
    ("rencontre", "/ʁɑ̃.kɔ̃tʁ/", "相遇；会面；比赛"),
    ("rencontrer", "/ʁɑ̃.kɔ̃.tʁe/", "遇见；见面；碰到"),
    ("répéter", "/ʁe.pe.te/", "重复"),
    ("s'appelle", "/sa.pɛl/", "叫作"),
    ("texte", "/tɛkst/", "文本"),
    ("tous", "/tu/ 或 /tus/", "所有，读音随语境变化"),
    ("tu", "/ty/", "你"),
    ("voudrais", "/vu.dʁɛ/", "我想要，条件式"),
    ("vouloir", "/vu.lwaʁ/", "想要；愿意"),
    ("vous", "/vu/", "你们；您"),
    ("être", "/ɛtʁ/", "是；存在"),
]

MANUAL_LEMMAS = {
    "ai": "avoir",
    "aie": "avoir",
    "aies": "avoir",
    "ait": "avoir",
    "as": "avoir",
    "a": "avoir",
    "avons": "avoir",
    "avez": "avoir",
    "ont": "avoir",
    "avais": "avoir",
    "avait": "avoir",
    "avaient": "avoir",
    "aurai": "avoir",
    "aura": "avoir",
    "auras": "avoir",
    "aurez": "avoir",
    "auront": "avoir",
    "suis": "être",
    "es": "être",
    "est": "être",
    "sommes": "être",
    "êtes": "être",
    "sont": "être",
    "étais": "être",
    "était": "être",
    "étaient": "être",
    "serai": "être",
    "sera": "être",
    "seras": "être",
    "seront": "être",
    "vais": "aller",
    "vas": "aller",
    "va": "aller",
    "allons": "aller",
    "allez": "aller",
    "vont": "aller",
    "irai": "aller",
    "ira": "aller",
    "iront": "aller",
    "fais": "faire",
    "fait": "faire",
    "faisons": "faire",
    "faites": "faire",
    "font": "faire",
    "ferai": "faire",
    "fera": "faire",
    "dis": "dire",
    "dit": "dire",
    "disons": "dire",
    "dites": "dire",
    "disent": "dire",
    "vois": "voir",
    "voit": "voir",
    "voyons": "voir",
    "voyez": "voir",
    "voient": "voir",
    "veux": "vouloir",
    "veut": "vouloir",
    "voulons": "vouloir",
    "voulez": "vouloir",
    "veulent": "vouloir",
    "voudrais": "vouloir",
    "peux": "pouvoir",
    "peut": "pouvoir",
    "pouvons": "pouvoir",
    "pouvez": "pouvoir",
    "peuvent": "pouvoir",
    "pourrais": "pouvoir",
    "prends": "prendre",
    "prend": "prendre",
    "prenons": "prendre",
    "prenez": "prendre",
    "prennent": "prendre",
    "pris": "prendre",
    "prise": "prendre",
    "prises": "prendre",
    "quelle": "quel",
    "quelles": "quel",
    "quels": "quel",
    "jours": "jour",
    "amie": "ami",
    "amis": "ami",
    "amies": "ami",
    "française": "français",
    "françaises": "français",
}


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


def parse_float(value: str) -> float:
    try:
        return float(value or 0)
    except ValueError:
        return 0.0


def lexique_phon_to_ipa(raw: str) -> str:
    value = (raw or "").strip()
    if not value:
        return ""
    converted = "".join(LEXIQUE_PHON_MAP.get(ch, ch) for ch in value)
    return f"/{converted}/"


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


def parse_lexique(path: Path) -> tuple[dict[str, dict[str, object]], dict[str, str]]:
    entries: dict[str, dict[str, object]] = {}
    form_lemma_scores: dict[str, tuple[str, float]] = {}

    with path.open("r", encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file, delimiter="\t")
        for row in reader:
            form = html.unescape(row.get("ortho", ""))
            lemma = html.unescape(row.get("lemme", ""))
            if not form or not lemma or not WORD_RE.match(form) or not WORD_RE.match(lemma):
                continue

            form_key = normalize_word(form)
            lemma_key = normalize_word(lemma)
            if not form_key or not lemma_key or len(form_key) > 36 or len(lemma_key) > 36:
                continue

            frequency = parse_float(row.get("freqfilms2", "")) + parse_float(row.get("freqlivres", ""))
            ipa = lexique_phon_to_ipa(row.get("phon", ""))

            if form_key != lemma_key:
                current = form_lemma_scores.get(form_key)
                if not current or frequency > current[1]:
                    form_lemma_scores[form_key] = (lemma_key, frequency)

            if row.get("islem") != "1":
                continue

            current_entry = entries.get(form_key)
            if current_entry and float(current_entry.get("frequency", 0)) >= frequency:
                continue

            entries[form_key] = {
                "word": form,
                "ipa": ipa,
                "zh": "",
                "frequency": frequency,
            }

    form_lemmas = {form: lemma for form, (lemma, _score) in form_lemma_scores.items()}
    return entries, form_lemmas


def parse_lefff(path: Path, entries: dict[str, dict[str, str]]) -> dict[str, str]:
    form_lemmas: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        form, _tag, lemma = parts[:3]
        form_key = normalize_word(html.unescape(form))
        lemma_key = normalize_word(html.unescape(lemma))
        if not form_key or not lemma_key or form_key == lemma_key:
            continue
        if lemma_key not in entries:
            continue
        if len(form_key) > 36 or len(lemma_key) > 36:
            continue
        form_lemmas.setdefault(form_key, lemma_key)

    return form_lemmas


def apply_lexique_entries(
    entries: dict[str, dict[str, str]],
    lexique_entries: dict[str, dict[str, object]],
    ipa_map: dict[str, str],
) -> None:
    added = 0
    sorted_entries = sorted(
        lexique_entries.items(),
        key=lambda pair: float(pair[1].get("frequency", 0)),
        reverse=True,
    )
    for key, item in sorted_entries:
        existing = entries.get(key)
        ipa = ipa_map.get(key) or str(item.get("ipa", ""))

        if existing:
            if not existing.get("ipa") and ipa:
                existing["ipa"] = ipa
            continue

        if added >= LEXIQUE_ENTRY_LIMIT:
            continue

        entries[key] = {
            "word": str(item.get("word") or key),
            "ipa": ipa,
            "zh": "",
        }
        added += 1


def apply_manual_entries(entries: dict[str, dict[str, str]]) -> None:
    for word, ipa, zh in MANUAL_ENTRIES:
        key = normalize_word(word)
        existing = entries.get(key, {})
        entries[key] = {
            "word": existing.get("word") or word,
            "ipa": ipa or existing.get("ipa", ""),
            "zh": zh or existing.get("zh", ""),
        }


def apply_manual_lemmas(form_lemmas: dict[str, str], entries: dict[str, dict[str, str]]) -> None:
    for form, lemma in MANUAL_LEMMAS.items():
        form_key = normalize_word(form)
        lemma_key = normalize_word(lemma)
        if form_key and lemma_key and lemma_key in entries and form_key != lemma_key:
            form_lemmas[form_key] = lemma_key


def write_lexicon(entries: dict[str, dict[str, str]], form_lemmas: dict[str, str]) -> None:
    rows = [
        [key, item["word"], item.get("ipa", ""), item["zh"]]
        for key, item in sorted(entries.items(), key=lambda pair: pair[0])
    ]
    form_rows = [
        [form, lemma]
        for form, lemma in sorted(form_lemmas.items(), key=lambda pair: pair[0])
        if form != lemma and lemma in entries
    ]
    body = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    form_body = json.dumps(form_rows, ensure_ascii=False, separators=(",", ":"))
    content = (
        "/* Generated by scripts/build_lexicon.py.\n"
        "   Sources: FreeDict fra-zho 2025.11.23 (CC BY-SA 3.0), Lexique 3.83 (CC BY-SA), ipa-dict fr_FR (MIT), and LEFFF 3.4.\n"
        "   Do not edit this file by hand. */\n"
        f"window.OOFR_LEXICON_ROWS={body};\n"
        f"window.OOFR_FORM_LEMMA_ROWS={form_body};\n"
        "window.OOFR_LEXICON=Object.fromEntries(window.OOFR_LEXICON_ROWS.map(([key,word,ipa,zh])=>[key,{word,ipa,zh}]));\n"
        "window.OOFR_FORM_LEMMAS=Object.fromEntries(window.OOFR_FORM_LEMMA_ROWS);\n"
        "window.OOFR_LEXICON_META={version:'2025.11.23+lexique383+ipa-dict+lefff',entries:window.OOFR_LEXICON_ROWS.length,forms:window.OOFR_FORM_LEMMA_ROWS.length};\n"
    )
    OUT_FILE.write_text(content, encoding="utf-8")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="oofr-lexicon-") as tmp:
        work = Path(tmp)
        archive = work / "fra-zho.tar.xz"
        ipa_file = work / "fr_FR.txt"
        lefff_file = work / "lefff-3.4.mlex"
        lexique_file = work / "Lexique383.tsv"

        download(FREEDICT_URL, archive)
        with tarfile.open(archive) as tar:
            tar.extractall(work)
        download(IPA_URL, ipa_file)
        download(LEFFF_URL, lefff_file)
        download(LEXIQUE_URL, lexique_file)

        entries = parse_stardict(work)
        ipa_map = parse_ipa_file(ipa_file)
        for key, item in entries.items():
            if not item.get("ipa") and key in ipa_map:
                item["ipa"] = ipa_map[key]
        apply_manual_entries(entries)
        lexique_entries, lexique_form_lemmas = parse_lexique(lexique_file)
        apply_lexique_entries(entries, lexique_entries, ipa_map)
        form_lemmas = parse_lefff(lefff_file, entries)
        form_lemmas.update({form: lemma for form, lemma in lexique_form_lemmas.items() if lemma in entries})
        apply_manual_lemmas(form_lemmas, entries)
        write_lexicon(entries, form_lemmas)

    print(f"Wrote {OUT_FILE} with {len(entries)} entries and {len(form_lemmas)} form mappings")


if __name__ == "__main__":
    main()
