#!/usr/bin/env bash
# Starts the Python API (port 8000) and the Next.js app (port 3000). Ctrl+C stops both.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

if ! command -v uv >/dev/null; then echo "uv is required: https://docs.astral.sh/uv/" >&2; exit 1; fi
[ -d "$ROOT/backend/.venv" ] || (cd "$ROOT/backend" && uv sync)
[ -d "$ROOT/frontend/node_modules" ] || (cd "$ROOT/frontend" && npm install)

trap 'kill 0' EXIT INT TERM
(cd "$ROOT/backend" && uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir app) &
(cd "$ROOT/frontend" && npx next dev -H 127.0.0.1 -p 3000) &
echo "Spend Analyser: http://localhost:3000   (API docs: http://localhost:8000/docs)"
wait
