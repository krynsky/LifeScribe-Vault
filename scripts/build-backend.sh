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
  --hidden-import lifescribe.ingest.mime \
  --hidden-import lifescribe.ingest.extractors.registry \
  --hidden-import lifescribe.ingest.registry_default \
  --collect-all docling \
  --collect-all docling_core \
  --collect-all docling_parse \
  --collect-all docling_ibm_models \
  --copy-metadata docling-slim \
  src/lifescribe/api/main.py

DIST_DIR="$ROOT/apps/backend/dist"
rm -rf "$DIST_DIR/connectors"
cp -r "$ROOT/connectors" "$DIST_DIR/connectors"
find "$DIST_DIR/connectors" -type d -name "__pycache__" -exec rm -rf {} +

echo "Binary at: $DIST_DIR/$OUT_NAME"
echo "Connectors at: $DIST_DIR/connectors"
