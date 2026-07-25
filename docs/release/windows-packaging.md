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
1. `npm run build` (Vite frontend build)
2. `cargo tauri bundle` (Tauri 2 bundles the Rust binary + frontend + pack resource)

Output directory: `apps/desktop/src-tauri/target/release/bundle/`

| Subdirectory | Artifact |
|---|---|
| `msi/` | `LifeScribe Vault_0.2.0_x64_en-US.msi` (per-machine, Windows Installer) |
| `nsis/` | `LifeScribe Vault_0.2.0_x64-setup.exe` (NSIS installer, per-machine) |

### Pack-authoring surface in the release build

The standalone Pack Editor (`npm run pack-editor`) is a **separate Vite app** and is
never part of the shipped bundle. The `write_default_pack` Tauri command *is* compiled
into the release binary but is **inert in production**: it resolves its target via the
compile-time `CARGO_MANIFEST_DIR` path, which does not exist on an end-user install, so
it returns a `FileOperation` error and cannot mutate the shipped pack. There is no
`CreatorModePage` or `VITE_CREATOR_MODE` — the old compile-time creator mode was
retired. No build-time exclusion step is required; see the "bundled pack ships
read-only to end users" architecture law in [development.md](../development.md).

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
- [ ] Pack-authoring surface confirmed inert: the standalone pack-editor app is not part of the bundle, and `write_default_pack` targets only a dev-only path (see "Pack-authoring surface in the release build")
- [ ] Installer runs on a clean Windows profile without additional prerequisites (WebView2 skip mode is set)
- [ ] App launches, shows the setup wizard, and vault directory is `%APPDATA%\com.lifescribe.vault.v2\`
- [ ] Run the [v2 acceptance checklist](../testing/v2-acceptance.md) before distributing
