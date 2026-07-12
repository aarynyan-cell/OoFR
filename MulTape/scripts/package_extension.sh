#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="$ROOT/release"
ZIP_PATH="$RELEASE_DIR/multape-extension.zip"

mkdir -p "$RELEASE_DIR"
rm -f "$ZIP_PATH"

cd "$ROOT"
zip -r "$ZIP_PATH" \
  index.html styles.css manifest.json manifest.webmanifest sw.js extension-service-worker.js \
  app lexicons icons \
  -x "lexicons/*.json.tmp" "release/*" ".lexicon-cache/*"

echo "Wrote $ZIP_PATH"
