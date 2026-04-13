#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

mode="${1:-full}"

case "$mode" in
  full)
    cd "$ROOT/apps/desktop"
    npm run tauri:dev
    ;;
  backend-only)
    cd "$ROOT/apps/backend"
    uv run lifescribe-backend --host 127.0.0.1 --port 0 --auth-token devtoken
    ;;
  frontend-only)
    cd "$ROOT/apps/desktop"
    npm run dev
    ;;
  *)
    echo "Usage: $0 [full|backend-only|frontend-only]" >&2
    exit 1
    ;;
esac
