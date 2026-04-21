$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $PSCommandPath
$root = Resolve-Path (Join-Path $here "..")
Push-Location (Join-Path $root "apps/backend")
try {
    uv run pyinstaller --name lifescribe-backend --onefile --clean --noconfirm --console `
        --hidden-import lifescribe.ingest.mime `
        --hidden-import lifescribe.ingest.extractors.registry `
        --hidden-import lifescribe.ingest.registry_default `
        src/lifescribe/api/main.py
    $distDir = Join-Path $root "apps/backend/dist"
    $distConnectors = Join-Path $distDir "connectors"
    if (Test-Path $distConnectors) { Remove-Item -Recurse -Force $distConnectors }
    Copy-Item -Recurse -Force (Join-Path $root "connectors") $distConnectors
    Get-ChildItem -Path $distConnectors -Recurse -Directory -Filter "__pycache__" |
        ForEach-Object { Remove-Item -Recurse -Force $_.FullName }
    Write-Host "Binary at: $distDir/lifescribe-backend.exe"
    Write-Host "Connectors at: $distConnectors"
} finally {
    Pop-Location
}
