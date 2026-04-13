$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $PSCommandPath
$root = Resolve-Path (Join-Path $here "..")
$mode = if ($args.Count -ge 1) { $args[0] } else { "full" }

switch ($mode) {
    "full" {
        Push-Location (Join-Path $root "apps/desktop")
        npm run tauri:dev
        Pop-Location
    }
    "backend-only" {
        Push-Location (Join-Path $root "apps/backend")
        uv run lifescribe-backend --host 127.0.0.1 --port 0 --auth-token devtoken
        Pop-Location
    }
    "frontend-only" {
        Push-Location (Join-Path $root "apps/desktop")
        npm run dev
        Pop-Location
    }
    default {
        Write-Error "Usage: dev.ps1 [full|backend-only|frontend-only]"
        exit 1
    }
}
