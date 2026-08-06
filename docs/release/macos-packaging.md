# macOS packaging (unsigned, Apple Silicon)

LifeScribe Vault's macOS build is a `.dmg` containing the app bundle, built
for Apple Silicon (`aarch64-apple-darwin`) only. It is **not code-signed or
notarized** — see [Gatekeeper](#gatekeeper) below for what that means for
anyone installing it.

## Build

Prerequisites: Node.js 20 or later, stable Rust with the
`aarch64-apple-darwin` target (`rustup target add aarch64-apple-darwin`),
Xcode Command Line Tools (`xcode-select --install`), and Tauri CLI 2 (already
a workspace dependency — no separate install).

From the repository root, on the Mac:

```bash
npm install
npm run build
```

The root build command clears prior installers (including any stale `.dmg`),
checks the manifest contract, builds the DMG, and then refuses to pass unless
the exact versioned DMG is present and is the only artifact in the `dmg`
output directory. On macOS this automatically picks up
`apps/desktop/src-tauri/tauri.macos.conf.json`, which overrides the bundle
target to `dmg` — the base `tauri.conf.json` (targeting NSIS) is unchanged and
still applies on Windows.

The distributable is written to
`apps/desktop/src-tauri/target/release/bundle/dmg/` as
`LifeScribe Vault 2_<version>_aarch64.dmg`.

The standalone Pack Editor is a development-only Vite app and is not bundled.
The default form pack is bundled as a read-only resource — identical to the
Windows build.

## Version and identity contract

Same three files as the Windows build:

1. `apps/desktop/package.json`
2. `apps/desktop/src-tauri/Cargo.toml`
3. `apps/desktop/src-tauri/tauri.conf.json`

Then run `npm install --package-lock-only` from the repository root. The
release check verifies all manifests and the workspace lock agree, rejects
stale bundle artifacts, enforces DMG as the only macOS target, and freezes the
application identifier as `com.lifescribe.vault.v2` — same identifier as
Windows, since it's the same app.

## Gatekeeper

This build is not signed with an Apple Developer certificate and is not
notarized. The first time someone opens it, macOS will show "Apple could not
verify this app is free of malware." This is expected, not a bug. To open it:

- Right-click (or Control-click) the app in Finder and choose **Open**, then
  confirm in the dialog that appears. This only needs to be done once — after
  that, the app opens normally.
- Alternatively, from Terminal: `xattr -d com.apple.quarantine "/path/to/LifeScribe Vault 2.app"`

## Manual QA checklist

Run through this by hand once per macOS release — there is no automated test
coverage for packaging concerns, since the app's own test suite (544 frontend
+ 132 Rust tests) is already platform-agnostic and runs identically on macOS
without needing packaging-specific changes.

- [ ] The unsigned `.app` launches after the Gatekeeper right-click-Open bypass.
- [ ] A freshly created vault's data lands in
      `~/Library/Application Support/com.lifescribe.vault.v2/` (or wherever
      Settings → Vault location reports it).
- [ ] File-open/save dialogs work correctly for: attaching a document,
      exporting the Recovery Kit PDF, creating a backup, restoring a backup,
      relocating the vault to a different folder.
- [ ] Window sizing looks right at launch (matches the configured
      1440x1000 default / 1220x760 minimum) and native chrome (traffic-light
      buttons, title bar) renders normally.
- [ ] Cmd+Q quits the app cleanly with no orphaned process left running
      (check Activity Monitor if unsure).
