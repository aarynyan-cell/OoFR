#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-4174}"
while lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

URL="http://localhost:${PORT}/"

echo "Starting MulTape..."
echo "URL: $URL"
echo
echo "Keep this Terminal window open while using MulTape."
echo "Press Ctrl+C or close this window to stop the local server."
echo

open "$URL" >/dev/null 2>&1 || true
python3 -m http.server "$PORT"
