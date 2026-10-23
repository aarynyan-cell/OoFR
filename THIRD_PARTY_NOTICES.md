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

# Speech

## Piper voices

- Source: `rhasspy/piper-voices` v1.0.0 on Hugging Face (`https://huggingface.co/rhasspy/piper-voices`)
- `fr_FR-siwis-medium`: trained on the SIWIS French Speech Synthesis Database (University of Edinburgh, `https://datashare.is.ed.ac.uk/handle/10283/2353`), Creative Commons Attribution 4.0
- `fr_FR-tom-medium`: dataset `https://git.bksp.space/Tjiho/French-tts-model-piper`, GNU AGPL v3
- Use in OoFR 法语磁带: the phone's own voices. They are not bundled: a learner who taps “下载” downloads them from Hugging Face to their device.

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
