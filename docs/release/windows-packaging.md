# Windows packaging and upgrades

LifeScribe Vault has one public Windows release channel: the per-machine NSIS
installer. A single channel keeps clean installs and in-place upgrades on the
same tested path.

## Build

Prerequisites are Node.js 20 or later, stable Rust with the
`x86_64-pc-windows-msvc` target, Tauri CLI 2, and NSIS.

From the repository root:

```powershell
npm install
npm run build
```

The root build command clears prior installers, checks the manifest contract,
builds the NSIS installer, and then refuses to pass unless the exact versioned
installer is present and is the only NSIS artifact.

The distributable is written to
`apps/desktop/src-tauri/target/release/bundle/nsis/` as
`LifeScribe Vault_<version>_x64-setup.exe`.

The standalone Pack Editor is a development-only Vite app and is not bundled.
The default form pack is bundled as a read-only resource.

## Version and identity contract

Update the same version in:

1. `apps/desktop/package.json`
2. `apps/desktop/src-tauri/Cargo.toml`
3. `apps/desktop/src-tauri/tauri.conf.json`

Then run `npm install --package-lock-only` from the repository root. The release
check verifies all manifests and the workspace lock agree, rejects stale bundle
artifacts, enforces NSIS as the only target, and freezes the application
identifier as `com.lifescribe.vault.v2`. Changing that identifier would create
a second app-data identity and strand existing vault-location metadata.

## Upgrade policy

Updates are complete NSIS installers. Install the new version over the previous
one; do not uninstall first. Vault data is outside the install directory and
must remain untouched. Version 1.0 has no automatic updater, so each release
announcement must link the complete signed installer.

Before distribution, test both paths on clean Windows profiles:

- a first install with a newly created vault;
- an in-place install over the previous released NSIS build with a populated
  vault, attachments, custom forms, a non-default vault location, and a backup.

After upgrading, unlock, open attachments, edit and save a form, restart, and
restore the pre-upgrade backup. Run the full
[acceptance checklist](../testing/v2-acceptance.md) as well.

## Signing

Sign and timestamp the installer before public distribution to avoid an
Unknown Publisher warning. Keep certificate material outside the repository.
