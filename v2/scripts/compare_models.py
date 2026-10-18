#!/usr/bin/env python3
"""Runs the same OoFR AI tasks on a local Ollama model, to choose which model to use.

Tasks mirror what OoFR asks the model to do:
  glosses     - Chinese dictionary senses from English Wiktionary senses (build_zh_glosses.py format)
  explain     - a sentence explanation as JSON (1.0's explanation fields)
  translate   - French sentences into Chinese
  context     - what a word means in this particular sentence

Each model runs alone and is unloaded afterwards (keep_alive 0), so two big
models never sit in memory together. Results go to .lexicon-cache/compare-<model>.json.

Usage (from the repository root):
  python3 v2/scripts/compare_models.py run gemma3:4b
  python3 v2/scripts/compare_models.py show gemma3:4b qwen3.5:9b
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OLLAMA = "http://127.0.0.1:11434/api/chat"
spec = importlib.util.spec_from_file_location("glosses", Path(__file__).with_name("build_zh_glosses.py"))
glosses = importlib.util.module_from_spec(spec)
spec.loader.exec_module(glosses)

GLOSS_WORDS = ["aller", "être", "faire", "prendre", "mettre", "passer", "tenir", "temps", "coup", "pâte", "rouleau", "étaler",
               "français", "bon", "pouvoir", "droit", "plein", "marche", "tour", "livre", "avocat", "glace", "pièce", "rater"]

EXPLAIN = [
    "Je voudrais pratiquer le français pendant dix minutes.",
    "Nous avons utilisé un rouleau à pâtisserie pour étaler la pâte.",
    "Il faut que tu viennes avant qu'il ne soit trop tard.",
    "Si j'avais su, je ne serais pas venu.",
    "C'est le livre dont je t'ai parlé hier.",
    "Elle s'est levée tôt pour ne pas rater le train.",
]

TRANSLATE = [
    "Il pleut des cordes.",
    "Ça me fait plaisir de te voir.",
    "On se voit tout à l'heure ?",
    "Je n'en peux plus.",
    "Ce n'est pas la peine.",
    "Il a pris un coup de soleil.",
    "Nous avons utilisé un rouleau à pâtisserie pour étaler la pâte.",
    "Si j'avais su, je ne serais pas venu.",
    "Pouvez-vous répéter cette phrase plus lentement ?",
    "Elle s'est levée tôt pour ne pas rater le train.",
]

CONTEXT = [
    ("marche", "Mon téléphone ne marche plus."),
    ("glace", "Je voudrais une glace à la vanille."),
    ("glace", "Elle se regarde dans la glace."),
    ("livre", "Une livre de beurre, s'il vous plaît."),
    ("pièce", "Cet appartement a trois pièces."),
    ("avocat", "Mon avocat m'a conseillé d'attendre."),
    ("tour", "C'est ton tour de jouer."),
    ("rater", "J'ai raté le bus."),
]

ZH_SYSTEM = "你是面向中文母语者的法语教师。所有解释文字只用简体中文；法语原句、单词和例句保留法语。不要附加英文或拼音。不确定的内容不要猜。"


def chat(model: str, system: str, prompt: str, schema: dict | None = None) -> tuple[str, dict]:
    body = {
        "model": model, "stream": False, "think": False, "keep_alive": "2m",
        "options": {"temperature": 0.1, "num_ctx": 4096},
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
    }
    if schema:
        body["format"] = schema
    request = urllib.request.Request(OLLAMA, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    started = time.time()
    with urllib.request.urlopen(request, timeout=900) as response:
        result = json.loads(response.read())
    return result["message"]["content"], {"seconds": round(time.time() - started, 1), "tokens": result.get("eval_count", 0)}


def loaded_size(model: str) -> str:
    output = subprocess.run(["ollama", "ps"], capture_output=True, text=True).stdout
    for line in output.splitlines():
        if line.startswith(model):
            return " ".join(line.split()[2:5])
    return "?"


def run(model: str) -> None:
    results: dict = {"model": model}
    words = glosses.load_words()
    batch = [words[glosses.normalize_key(word)] for word in GLOSS_WORDS if glosses.normalize_key(word) in words]
    gloss_out, total, raw = {}, {"seconds": 0.0, "tokens": 0}, []
    glosses.MODEL = model
    for index in range(0, len(batch), 8):
        part = batch[index:index + 8]
        payload = [{"word": item["word"], "groups": [{"pos": group["pos"], "senses": group["senses"]} for group in item["groups"]]} for item in part]
        answer, timing = chat(model, glosses.SYSTEM, json.dumps(payload, ensure_ascii=False))
        gloss_out.update(glosses.parse(answer, part))
        raw.append(answer)
        total = {"seconds": total["seconds"] + timing["seconds"], "tokens": total["tokens"] + timing["tokens"]}
    results["glosses"] = {"timing": total, "parsed": len(gloss_out), "asked": len(batch), "output": gloss_out, "raw": raw,
                          "input": {item["word"]: item["groups"] for item in batch}}
    results["memory"] = loaded_size(model)

    explain_schema = {"type": "object", "properties": {key: {"type": "string"} for key in ("summary", "structure")} | {key: {"type": "array", "items": {"type": "string"}} for key in ("grammarPoints", "pitfalls", "examples")},
                      "required": ["summary", "structure", "grammarPoints", "pitfalls", "examples"]}
    explained = []
    for sentence in EXPLAIN:
        answer, timing = chat(model, ZH_SYSTEM, f"讲解这个法语句子：给出简洁的中文意思、句子骨架、重要语法点、易错点和一个可以替换练习的例句。只返回要求的 JSON。\n\n句子：{sentence}", explain_schema)
        try:
            data = json.loads(answer)
        except json.JSONDecodeError:
            data = {"invalid": answer}
        explained.append({"sentence": sentence, "timing": timing, "output": data})
    results["explain"] = explained

    translate_schema = {"type": "object", "properties": {"translations": {"type": "array", "items": {"type": "object", "properties": {"id": {"type": "integer"}, "zh": {"type": "string"}}, "required": ["id", "zh"]}}}, "required": ["translations"]}
    items = [{"id": index, "text": text} for index, text in enumerate(TRANSLATE)]
    answer, timing = chat(model, ZH_SYSTEM, f"把这些法语句子翻译成自然、准确的简体中文，习语按意思翻译。只返回要求的 JSON。\n\n{json.dumps(items, ensure_ascii=False)}", translate_schema)
    try:
        translations = {item["id"]: item["zh"] for item in json.loads(answer)["translations"]}
    except (json.JSONDecodeError, KeyError, TypeError):
        translations = {"invalid": answer}
    results["translate"] = {"timing": timing, "output": {TRANSLATE[key]: value for key, value in translations.items() if isinstance(key, int) and key < len(TRANSLATE)} or translations}

    context_schema = {"type": "object", "properties": {"meaning": {"type": "string"}, "note": {"type": "string"}}, "required": ["meaning", "note"]}
    contexts = []
    for word, sentence in CONTEXT:
        answer, timing = chat(model, ZH_SYSTEM, f"在下面这句话里，“{word}”是什么意思？meaning 写 2 到 8 个字的中文释义，note 用一句中文说明为什么。只返回要求的 JSON。\n\n句子：{sentence}", context_schema)
        try:
            data = json.loads(answer)
        except json.JSONDecodeError:
            data = {"invalid": answer}
        contexts.append({"word": word, "sentence": sentence, "timing": timing, "output": data})
    results["context"] = contexts

    # Free the memory straight away.
    urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:11434/api/generate", data=json.dumps({"model": model, "keep_alive": 0}).encode(), headers={"Content-Type": "application/json"}), timeout=60).read()
    out = ROOT / ".lexicon-cache" / f"compare-{model.replace(':', '_')}.json"
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    seconds = results["glosses"]["timing"]["seconds"] + sum(item["timing"]["seconds"] for item in explained) + timing["seconds"] + sum(item["timing"]["seconds"] for item in contexts)
    print(f"{model}: done in {seconds:.0f}s, loaded size {results['memory']}, glosses parsed {len(gloss_out)}/{len(batch)} → {out}")


def rerun_glosses(model: str) -> None:
    out = ROOT / ".lexicon-cache" / f"compare-{model.replace(':', '_')}.json"
    saved = json.loads(out.read_text(encoding="utf-8"))
    words = glosses.load_words()
    batch = [words[glosses.normalize_key(word)] for word in GLOSS_WORDS if glosses.normalize_key(word) in words]
    gloss_out, total, raw = {}, {"seconds": 0.0, "tokens": 0}, []
    for index in range(0, len(batch), 8):
        part = batch[index:index + 8]
        payload = [{"word": item["word"], "groups": [{"pos": group["pos"], "senses": group["senses"]} for group in item["groups"]]} for item in part]
        answer, timing = chat(model, glosses.SYSTEM, json.dumps(payload, ensure_ascii=False))
        gloss_out.update(glosses.parse(answer, part))
        raw.append(answer)
        total = {"seconds": total["seconds"] + timing["seconds"], "tokens": total["tokens"] + timing["tokens"]}
    saved["glosses"] = {"timing": total, "parsed": len(gloss_out), "asked": len(batch), "output": gloss_out, "raw": raw,
                        "input": {item["word"]: item["groups"] for item in batch}}
    urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:11434/api/generate", data=json.dumps({"model": model, "keep_alive": 0}).encode(), headers={"Content-Type": "application/json"}), timeout=60).read()
    out.write_text(json.dumps(saved, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{model}: glosses parsed {len(gloss_out)}/{len(batch)} in {total['seconds']:.0f}s")


def show(models: list[str]) -> None:
    data = [json.loads((ROOT / ".lexicon-cache" / f"compare-{model.replace(':', '_')}.json").read_text(encoding="utf-8")) for model in models]
    print("== memory / speed")
    for item in data:
        explain_seconds = sum(entry["timing"]["seconds"] for entry in item["explain"])
        print(f"{item['model']}: {item['memory']} · glosses {item['glosses']['timing']['seconds']:.0f}s for {item['glosses']['asked']} words · explain {explain_seconds:.0f}s for {len(item['explain'])} · translate {item['translate']['timing']['seconds']:.0f}s")
    print("\n== glosses")
    for word in data[0]["glosses"]["input"]:
        print(f"\n{word}: " + " | ".join(f"{group['pos']}: {'; '.join(group['senses'])}" for group in data[0]["glosses"]["input"][word]))
        for item in data:
            groups = item["glosses"]["output"].get(glosses.normalize_key(word), [])
            print(f"  {item['model']:<12} " + (" / ".join(f"{group['pos']}: {'；'.join(group['zh'])}" for group in groups) or "(missing)"))
    print("\n== translate")
    for sentence in TRANSLATE:
        print(f"\n{sentence}")
        for item in data:
            print(f"  {item['model']:<12} {item['translate']['output'].get(sentence, '(missing)')}")
    print("\n== context")
    for index, (word, sentence) in enumerate(CONTEXT):
        print(f"\n{word} — {sentence}")
        for item in data:
            output = item["context"][index]["output"]
            print(f"  {item['model']:<12} {output.get('meaning', output)} · {output.get('note', '')}")
    print("\n== explain")
    for index, sentence in enumerate(EXPLAIN):
        print(f"\n{sentence}")
        for item in data:
            print(f"  [{item['model']}] {json.dumps(item['explain'][index]['output'], ensure_ascii=False)}")


if __name__ == "__main__":
    if sys.argv[1] == "run":
        run(sys.argv[2])
    elif sys.argv[1] == "glosses":
        rerun_glosses(sys.argv[2])
    else:
        show(sys.argv[2:])
