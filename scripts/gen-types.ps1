$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $PSCommandPath
$root = Resolve-Path (Join-Path $here "..")
Push-Location (Join-Path $root "apps/backend")
try {
    $schema = uv run python -c "import json; from lifescribe.api.app import create_app; print(json.dumps(create_app(auth_token='x').openapi(), indent=2))"
    $schema | Out-File -Encoding utf8 (Join-Path $root "packages/shared-types/openapi.json")
} finally {
    Pop-Location
}
Push-Location $root
npx --yes openapi-typescript "packages/shared-types/openapi.json" -o "packages/shared-types/src/generated.ts"
Pop-Location
