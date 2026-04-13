#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT/apps/backend"

OUT_NAME="lifescribe-backend"
uv run pyinstaller \
  --name "$OUT_NAME" \
  --onefile \
  --clean \
  --noconfirm \
  --console \
  src/lifescribe/api/main.py

echo "Binary at: $ROOT/apps/backend/dist/$OUT_NAME"
