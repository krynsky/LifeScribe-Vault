$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $PSCommandPath
$root = Resolve-Path (Join-Path $here "..")
Push-Location (Join-Path $root "apps/backend")
try {
    uv run pyinstaller --name lifescribe-backend --onefile --clean --noconfirm --console src/lifescribe/api/main.py
    Write-Host "Binary at: $root/apps/backend/dist/lifescribe-backend.exe"
} finally {
    Pop-Location
}
