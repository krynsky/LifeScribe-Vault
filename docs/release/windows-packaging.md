# Windows Packaging — LifeScribe Vault v2

This document covers how to produce, verify, and distribute the end-user Windows installers.

## Prerequisites

- Rust toolchain (`rustup show` — stable, `x86_64-pc-windows-msvc` target installed)
- Node.js ≥ 20 and npm
- [Tauri CLI](https://tauri.app/start/prerequisites/) v2 (`cargo tauri --version`)
- WiX Toolset v3 on PATH (for MSI): `choco install wixtoolset` or from https://wixtoolset.org
- NSIS on PATH (for NSIS installer): `choco install nsis` or from https://nsis.sourceforge.io

Verify toolchain:
```powershell
rustup show
node --version
cargo tauri --version
candle --version   # WiX
makensis /VERSION  # NSIS
```

## Building installers

Both targets (MSI and NSIS) are produced by a single command. Run from the repo root:

```powershell
npm run build
```

This runs:
1. `npm run build` (Vite frontend build — `VITE_CREATOR_MODE` unset, so creator module is excluded)
2. `cargo tauri bundle` (Tauri 2 bundles the Rust binary + frontend + pack resource)

Output directory: `apps/desktop/src-tauri/target/release/bundle/`

| Subdirectory | Artifact |
|---|---|
| `msi/` | `LifeScribe Vault_0.2.0_x64_en-US.msi` (per-machine, Windows Installer) |
| `nsis/` | `LifeScribe Vault_0.2.0_x64-setup.exe` (NSIS installer, per-machine) |

### Confirming creator module is excluded

The end-user build must not include `CreatorModePage` or the `write_default_pack` Tauri command:

```powershell
# Rust binary — write_default_pack must not be present
strings apps/desktop/src-tauri/target/release/lifescribe-vault-v2.exe | Select-String "write_default_pack"
# Expected: no output

# Frontend bundle — creator directory must not appear in the JS output
Get-ChildItem apps/desktop/dist/assets/*.js | Select-String "CreatorModePage"
# Expected: no output
```

### Confirming pack resource is bundled

```powershell
# Unpack the MSI with lessmsi or msiexec /a to inspect
# OR check the NSIS installer with 7-Zip:
# The default-pack.json should appear under resources/packs/
```

## Signing (optional — for distribution)

Code-signing is not required for personal/local use but eliminates SmartScreen warnings for distributed builds.

1. Obtain a code-signing certificate (e.g. from DigiCert or Sectigo).
2. Add to `tauri.conf.json` `bundle.windows.certificateThumbprint` (the certificate's SHA-1 thumbprint from certmgr.msc).
3. Set `bundle.windows.timestampUrl` to a TSA endpoint (e.g. `http://timestamp.sectigo.com`).
4. Re-run `npm run build`.

Without signing: SmartScreen shows an "Unknown publisher" warning on first run. Users click "More info → Run anyway".

## Version bump procedure

Before a release build, update the version in **both**:

1. `apps/desktop/src-tauri/Cargo.toml` → `[package] version = "X.Y.Z"`
2. `apps/desktop/src-tauri/tauri.conf.json` → `"version": "X.Y.Z"`

Then rebuild. The installer filename and Windows Add/Remove Programs entry both reflect the version from `tauri.conf.json`.

## Clean rebuild

If the bundle output looks stale:

```powershell
Remove-Item -Recurse -Force apps/desktop/src-tauri/target/release/bundle
npm run build
```

## Post-build checklist

- [ ] Installer filename matches the version in `tauri.conf.json`
- [ ] MSI and NSIS both present in their respective subdirectories
- [ ] `strings` / bundle grep confirms no `write_default_pack` or `CreatorModePage` in the release binary/JS
- [ ] Installer runs on a clean Windows profile without additional prerequisites (WebView2 skip mode is set)
- [ ] App launches, shows the setup wizard, and vault directory is `%APPDATA%\com.lifescribe.vault.v2\`
- [ ] Run the [v2 acceptance checklist](../testing/v2-acceptance.md) before distributing
