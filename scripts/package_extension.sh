#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/release"
OUT_FILE="$OUT_DIR/oofr-french-tape-extension.zip"

mkdir -p "$OUT_DIR"
rm -f "$OUT_FILE"

cd "$ROOT_DIR"
zip -qr "$OUT_FILE" \
  manifest.json \
  extension-service-worker.js \
  index.html \
  styles.css \
  app.js \
  lexicon.js \
  manifest.webmanifest \
  sw.js \
  icons \
  -x "*.DS_Store"

echo "$OUT_FILE"
