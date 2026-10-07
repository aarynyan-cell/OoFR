#!/bin/zsh
set -e

OOFR_DIR="${0:A:h}"
OOFR_URL="http://127.0.0.1:4173/"

if ! curl -fsS --max-time 2 "http://127.0.0.1:11434/api/version" >/dev/null 2>&1; then
  if command -v ollama >/dev/null 2>&1; then
    nohup ollama serve >/tmp/oofr-ollama.log 2>&1 &
  fi
fi

if ! curl -fsS --max-time 2 "$OOFR_URL" >/dev/null 2>&1; then
  nohup python3 -m http.server 4173 --bind 127.0.0.1 --directory "$OOFR_DIR" >/tmp/oofr-http-server.log 2>&1 &
  for _ in {1..20}; do
    curl -fsS --max-time 1 "$OOFR_URL" >/dev/null 2>&1 && break
    sleep 0.1
  done
fi

open "$OOFR_URL"
