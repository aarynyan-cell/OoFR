# Third-Party Notices

OoFR 法语磁带 uses the open data, software and voice models below. The offline dictionary in `dictionary/` (used by the app in `v2/`) and the 1.0 lexicon in `lexicon.js` are generated from the dictionary sources.

# Dictionary data

## FreeDict fra-zho

- Source: FreeDict `French - Chinese`, version `2025.11.23`
- Download: `https://download.freedict.org/dictionaries/fra-zho/2025.11.23/freedict-fra-zho-2025.11.23.stardict.tar.xz`
- Upstream data: WikDict, Wiktionary, DBnary
- License: Creative Commons Attribution-ShareAlike 3.0 Unported
- Use in OoFR 法语磁带: French headwords, IPA when present, and Chinese definitions are transformed into the compact app lexicon.

## open-dict-data / ipa-dict

- Source: `open-dict-data/ipa-dict`, `data/fr_FR.txt`
- URL: `https://github.com/open-dict-data/ipa-dict`
- License: MIT
- Use in OoFR 法语磁带: French IPA pronunciations are used to fill entries that do not already include IPA.

## Lexique 3.83

- Source: Lexique 3.83, Boris New and Christophe Pallier
- URL: `http://www.lexique.org/databases/Lexique383/Lexique383.tsv`
- License: Creative Commons Attribution-ShareAlike
- Use in OoFR 法语磁带: a compact subset of French word forms, lemmas, frequencies, and phonological forms is merged into the generated lexicon so common inflections such as `choisit` can be grouped under `choisir`.

## LEFFF

- Source: LEFFF 3.4 via `ClaudeCoulombe/FrenchLefffLemmatizer`
- URL: `https://github.com/ClaudeCoulombe/FrenchLefffLemmatizer`
- Resource: `french_lefff_lemmatizer/data/lefff-3.4.mlex`
- License: LGPL-LR, the Lesser General Public License For Linguistic Resources
- Use in OoFR 法语磁带: inflected French forms are transformed into a compact `form -> lemma` lookup so the wordbook can group forms such as `prend`, `prends`, and `prennent` under `prendre`.

The generated lexicon is intended as a lightweight learning aid. Users can edit individual wordbook entries inside OoFR 法语磁带 when a pronunciation or definition needs correction.

## Kaikki / Wiktionary

- Source: Kaikki machine-readable extraction of French Wiktionary
- URL: `https://kaikki.org/dictionary/French/`
- Upstream licensing: Wiktionary content is available under CC BY-SA and GFDL; individual media files retain their Wikimedia Commons licenses.
- Use in OoFR 法语磁带: French headwords, parts of speech, definitions, IPA, audio links, fixed expressions and inflection relations in the sharded offline dictionary.

## Morphalou 3.1

- Source: ATILF-CNRS Morphalou 3.1
- URL: `https://www.ortolang.fr/market/lexicons/morphalou`
- License: LGPL-LR (Lesser General Public License for Linguistic Resources)
- Use in OoFR 法语磁带: deterministic French form-to-lemma and grammatical-feature mappings.

## Open English WordNet 2025

- Source: Open English WordNet 2025
- URL: `https://en-word.net/`
- License: Creative Commons Attribution 4.0 International
- Use in OoFR 法语磁带: English headwords, parts of speech, pronunciations and definitions.

## ECDICT

- Source: ECDICT free English-Chinese dictionary database
- URL: `https://github.com/skywind3000/ECDICT`
- License: MIT
- Use in OoFR 法语磁带: broader Simplified Chinese meanings for English entries and a supplementary semantic bridge for French definitions. OoFR keeps a small reviewed override layer for cross-language homographs that cannot be translated safely by headword alone.

## CC-CEDICT (MulTape, Chinese)

- Source: https://www.mdbg.net/chinese/dictionary?page=cedict
- Use: Chinese words with pinyin and English meanings (`dictionary/zh/`, built by `v2/scripts/build_cjk_dictionary.py`).
- License: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0). © MDBG and the CC-CEDICT contributors.

## CFDICT (MulTape, Chinese)

- Source: https://chine.in/mandarin/dictionnaire/CFDICT/
- Use: French meanings of Chinese words (`dictionary/zh/`).
- License: Creative Commons BY-SA. © Chine Informations and the CFDICT contributors.

## JMdict (MulTape, Japanese)

- Source: https://www.edrdg.org/jmdict/j_jmdict.html
- Use: Japanese words with kana readings, parts of speech, English and French meanings (`dictionary/ja/`).
- License: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0), under the licence of the Electronic Dictionary Research and Development Group (https://www.edrdg.org/edrdg/licence.html). © EDRDG.

## Kaikki / Wiktionary (MulTape, Spanish and Korean)

- Source: Kaikki.org machine-readable extractions of the English Wiktionary (wiktextract, Tatu Ylonen): `https://kaikki.org/dictionary/Spanish/` and `https://kaikki.org/dictionary/Korean/`
- Use: Spanish and Korean headwords, parts of speech, English meanings, Spanish noun genders, Korean romanization and hanja, and the inflected-form → dictionary-word index from Wiktionary's conjugation and declension tables (`dictionary/es/`, `dictionary/ko/`, built by `v2/scripts/build_wiktionary_dictionary.py`). The Chinese meanings of common words in these files are an AI translation of the Wiktionary English meanings (`v2/scripts/build_es_ko_zh.py`).
- License: Wiktionary text is available under Creative Commons Attribution-ShareAlike (CC BY-SA 4.0) and the GNU Free Documentation License (GFDL). © Wiktionary contributors. The built files are shared under the same terms.

## FrequencyWords (MulTape, Spanish and Korean)

- Source: Hermit Dave, FrequencyWords (`https://github.com/hermitdave/FrequencyWords`), 2018 lists built from OpenSubtitles (`content/2018/es/es_50k.txt`, `content/2018/ko/ko_50k.txt`)
- Use: only to order things at build time: which reading of an ambiguous form comes first, and which common words get Chinese meanings. No list is shipped.
- License: content CC BY-SA 4.0 (code MIT). © Hermit Dave.

# Speech

## Piper voices

- Source: `rhasspy/piper-voices` v1.0.0 on Hugging Face (`https://huggingface.co/rhasspy/piper-voices`)
- `fr_FR-siwis-medium`: trained on the SIWIS French Speech Synthesis Database (University of Edinburgh, `https://datashare.is.ed.ac.uk/handle/10283/2353`), Creative Commons Attribution 4.0
- `fr_FR-tom-medium`: dataset `https://git.bksp.space/Tjiho/French-tts-model-piper`, GNU AGPL v3
- `en_US-ljspeech-medium` (shown as “Linda”): trained on the LJ Speech Dataset (`https://keithito.com/LJ-Speech-Dataset/`), public domain
- `en_US-joe-medium`: dataset `https://github.com/NabuCasa/voice-datasets`, CC0
- `es_ES-sharvard-medium` (female and male speakers): trained on the Sharvard corpus (University of Edinburgh, `https://datashare.ed.ac.uk/handle/10283/574`), Creative Commons Attribution 3.0
- `zh_CN-huayan-medium` was offered by MulTape until October 2026 and withdrawn (its dataset states no licence, and its espeak-ng input cannot tell the 1st tone from the 4th); devices that downloaded it delete it. Chinese now uses MeloTTS (below).
- Use in OoFR 法语磁带 and MulTape: the device's own natural voices (MulTape: French, English, Spanish, Chinese; Piper has no Japanese or Korean voices). They are not bundled: a learner who taps “下载” downloads them from Hugging Face to their device.

## MeloTTS (MulTape, Chinese voice “Melo”)

- Source: `https://github.com/myshell-ai/MeloTTS`, Copyright (c) 2024 MyShell.ai
- License: MIT (the LICENSE file shipped with the converted model, and the model's own metadata)
- Converted model: `csukuangfj/vits-melo-tts-zh_en` on Hugging Face (`https://huggingface.co/csukuangfj/vits-melo-tts-zh_en`), converted to ONNX by the sherpa-onnx project (`https://github.com/k2-fsa/sherpa-onnx`, Apache License 2.0); its `model.onnx`, `tokens.txt` and `lexicon.txt` are used
- Use in MulTape: the device's own natural Chinese voice (optional download). It reads the lesson's own pinyin (`v2/src/speech/zh/`), so polyphones, neutral tones and tone changes are said as written.

## Supertonic 3 (MulTape, Japanese and Korean voices “Supertonic F / M”)

- Source: `Supertone/supertonic-3` on Hugging Face, revision `3cadd1ee6394adea1bd021217a0e650ede09a323` (`https://huggingface.co/Supertone/supertonic-3`), Supertone Inc.
- License: BigScience OpenRAIL-M (the `LICENSE` file of that repository). Free, commercial use allowed, but with use-based restrictions (its paragraph 5 and Attachment A) that bind everyone who uses the model or a copy of it, among them: no unlawful use, no impersonating people without consent, no harassment or defamation, no harming minors, no medical advice, and content made with it must not be presented without saying it is machine-generated (Attachment A (e)). Anyone MulTape gives the model to must get a copy of the licence and be told of these restrictions.
- Modified copy: MulTape stores the large weights of its four ONNX models as int8 with per-channel scales (`v2/scripts/build_supertonic_int8.py`; the computation is unchanged), which brings the download from about 400 MB to about 103 MB. The changed files carry a notice saying so (in each model's metadata and in `NOTICE.md` next to them); `tts.json`, `unicode_indexer.json` and the voice styles are unchanged.
- Use in MulTape: the device's own natural Japanese and Korean voices (optional download). The copy is served next to the app (`voices/supertonic-3-int8/`, with `LICENSE` and `NOTICE.md`), and the app shows that these voices are AI-synthesised, the licence's restrictions and a link to the licence where they are offered. Japanese sentences with furigana are read from their kana (`v2/src/speech/ja/`).

## Piper

- Source: `https://github.com/rhasspy/piper`
- License: MIT
- Use in OoFR 法语磁带: the voice model format and the way text is turned into speech (`v2/src/speech/piper/`).

## ONNX Runtime Web

- Source: `onnxruntime-web` 1.30.0, `https://github.com/microsoft/onnxruntime`
- License: MIT
- Use in OoFR 法语磁带: runs the Piper voice models in the browser (WebAssembly).

## piper-wasm and eSpeak NG

- Source: `@diffusionstudio/piper-wasm` 1.0.0 (MIT, `https://github.com/diffusion-studio/piper-wasm`), a WebAssembly build of `piper-phonemize` with eSpeak NG
- eSpeak NG: `https://github.com/rhasspy/espeak-ng` (fork of `https://github.com/espeak-ng/espeak-ng`), GNU GPL v3; its data files are included in `piper_phonemize.data`
- Use in OoFR 法语磁带: turns French text into phonemes for the Piper voices. Served unchanged as `voice-engine/piper_phonemize.{js,wasm,data}`; the source and build steps are at the links above.

# AI

## Online AI services

- Groq, SiliconFlow (硅基流动), Zhipu (智谱) and Google Gemini are used only with the learner's own keys, under each provider's terms. No model is bundled.

## Ollama

- Source: Ollama runtime
- URL: `https://github.com/ollama/ollama`
- License: MIT
- Use in OoFR 法语磁带: optional local model runtime in the Mac app when no online key is set. The app downloads the official runtime only after the learner confirms, and binds it to `127.0.0.1`.

## Local models

- Models from the Ollama model library (for example `qwen3.5:9b` / `qwen3.5:4b`), under their own licenses, downloaded only after the learner confirms. Not bundled in this repository or installer.
