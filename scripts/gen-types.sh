#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT/apps/backend"

uv run python -c "
import json
from lifescribe.api.app import create_app
print(json.dumps(create_app(auth_token='x').openapi(), indent=2))
" > "$ROOT/packages/shared-types/openapi.json"

cd "$ROOT"
npx --yes openapi-typescript "packages/shared-types/openapi.json" \
  -o "packages/shared-types/src/generated.ts"

echo "Regenerated packages/shared-types/src/generated.ts"
