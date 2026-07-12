# MulTape Publishing

MulTape is shipped as a static web app first. The same source directory also works as an unpacked Chromium extension for Chrome and Microsoft Edge.

## GitHub Pages / Mobile / Safari

Publish the repository with GitHub Pages using:

- Branch: `main`
- Folder: `/`
- App URL: `https://aarynyan-cell.github.io/OoFR/MulTape/`

The app uses relative paths, so it can live safely inside the `MulTape/` subfolder. Safari on iPhone and iPad should use the GitHub Pages URL, then Share -> Add to Home Screen. Chrome and Edge on Android can install it from the browser install prompt.

Safari compatibility here means the PWA/web-app path. A native Safari App Extension still needs an Xcode wrapper and Apple signing, so it is a separate packaging task if App Store distribution becomes necessary.

## Chrome / Microsoft Edge Extension

For local extension testing:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select the `MulTape/` folder.

To create a zip package:

```sh
cd MulTape
./scripts/package_extension.sh
```

The package is written to `MulTape/release/multape-extension.zip`. The zip includes `lexicons/*.json` so downloads work from inside the extension without a separate server.

## Lexicons

The app shell does not install lexicons by default. Users pick a language pair in My -> Languages, then click Download Lexicon. Downloaded lexicons are stored in IndexedDB on the current device.

Published lexicon packages are currently about 268 MB total. Do not commit `.lexicon-cache/`; it only contains build inputs and is ignored by Git.

## Quick Checks Before Publishing

```sh
node --check app/main.js
node --check app/languages.js
node --check app/i18n.js
node --check app/lexicon-store.js
python3 -m py_compile scripts/build_lexicons.py
python3 -m json.tool manifest.json >/dev/null
python3 -m json.tool manifest.webmanifest >/dev/null
python3 -m json.tool lexicons/manifest.json >/dev/null
```
