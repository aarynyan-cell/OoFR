# Third-Party Notices

OoFR includes a generated French-Chinese lexicon in `lexicon.js`.

## FreeDict fra-zho

- Source: FreeDict `French - Chinese`, version `2025.11.23`
- Download: `https://download.freedict.org/dictionaries/fra-zho/2025.11.23/freedict-fra-zho-2025.11.23.stardict.tar.xz`
- Upstream data: WikDict, Wiktionary, DBnary
- License: Creative Commons Attribution-ShareAlike 3.0 Unported
- Use in OoFR: French headwords, IPA when present, and Chinese definitions are transformed into the compact app lexicon.

## open-dict-data / ipa-dict

- Source: `open-dict-data/ipa-dict`, `data/fr_FR.txt`
- URL: `https://github.com/open-dict-data/ipa-dict`
- License: MIT
- Use in OoFR: French IPA pronunciations are used to fill entries that do not already include IPA.

## LEFFF

- Source: LEFFF 3.4 via `ClaudeCoulombe/FrenchLefffLemmatizer`
- URL: `https://github.com/ClaudeCoulombe/FrenchLefffLemmatizer`
- Resource: `french_lefff_lemmatizer/data/lefff-3.4.mlex`
- License: LGPL-LR, the Lesser General Public License For Linguistic Resources
- Use in OoFR: inflected French forms are transformed into a compact `form -> lemma` lookup so the wordbook can group forms such as `prend`, `prends`, and `prennent` under `prendre`.

The generated lexicon is intended as a lightweight learning aid. Users can edit individual wordbook entries inside OoFR when a pronunciation or definition needs correction.
