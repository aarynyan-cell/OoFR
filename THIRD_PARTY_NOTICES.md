# Third-Party Notices

OoFR 法语磁带 includes a generated French-Chinese lexicon in `lexicon.js`.

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

## Ollama

- Source: Ollama runtime
- URL: `https://github.com/ollama/ollama`
- License: MIT
- Use in OoFR 法语磁带: optional local model runtime for the macOS desktop test build. OoFR downloads the official macOS runtime only after user confirmation and binds it to `127.0.0.1`.

## Gemma 3

- Model: `gemma3:4b`, distributed through the Ollama model library
- URL: `https://ollama.com/library/gemma3:4b`
- Terms: Google Gemma Terms of Use and Prohibited Use Policy shown by the desktop installer before download
- Use in OoFR 法语磁带: optional local generation of translations, material analysis and sentence explanations. The model is not bundled in this repository or installer.
