# macOS build support (unsigned, Apple Silicon) — design

**Date:** 2026-08-06
**Status:** Approved (brainstorm)

## Problem

LifeScribe Vault ships today as a Windows-only NSIS installer. `tauri.conf.json`
hard-codes `"targets": ["nsis"]`, and `scripts/release-check.mjs` (the release
gate) hard-asserts that exact target list and a Windows `.exe` artifact name —
so there is currently no path to producing a macOS build at all, let alone a
verified one.

The app's own code is nearly platform-agnostic already: a repo-wide search
found exactly one Windows-specific line
(`#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` in
`main.rs`, which is inert — not an error — on other platforms), no hardcoded
path-separator assumptions in the frontend, and `app_data_dir()` (used for the
vault's default location) already resolves correctly per-OS via Tauri's path
plugin. `icon.icns` already exists in `apps/desktop/src-tauri/icons/`. The gap
is entirely in packaging and release tooling, not application logic.

## Goals

1. `apps/desktop` builds a working `.app` bundle and `.dmg` on macOS (Apple
   Silicon / arm64), from the existing codebase, unchanged.
2. `scripts/release-check.mjs` enforces the same rigor on macOS artifacts that
   it enforces on Windows today — right identifier, right version consistency
   across the four sources of truth, right single artifact present, no stray
   files — extended to be platform-aware, not replaced or weakened for either
   platform.
3. Docs clearly state the macOS build is unsigned and explain the Gatekeeper
   workaround for anyone downloading it.

## Non-goals

- Code signing / notarization. Explicitly declined (no Apple Developer
  account) — revisit only as a separate future decision if that changes.
- Intel (`x86_64-apple-darwin`) support. Apple Silicon (`aarch64-apple-darwin`)
  only.
- CI/GitHub Actions automation of the macOS build. Building happens locally on
  a Mac you already have; automating that pipeline is a separate, later
  decision.
- Any change to Windows packaging, `release-check.mjs`'s behavior when run on
  Windows, or the NSIS pipeline. The existing Windows release gate's
  assertions must continue to hold exactly as they do today.

## Approach

### Platform config split

Add `apps/desktop/src-tauri/tauri.macos.conf.json`:

```json
{
  "bundle": {
    "targets": ["dmg"],
    "macOS": {
      "minimumSystemVersion": "11.0"
    }
  }
}
```

Tauri 2's CLI auto-detects and merges `tauri.<platform>.conf.json` on top of
the base `tauri.conf.json` at build time, keyed off the host OS — no CLI flag
needed, no build script change to invoke it. The base config's
`"targets": ["nsis"]` is untouched and still applies as-is on Windows; on
macOS this file's `bundle.targets` overrides it to `["dmg"]`. Every other base
config value — `identifier`, `icon` (already lists `icon.icns`),
`productName`, window sizing, CSP — is already platform-agnostic and applies
unchanged on both platforms; none of it is duplicated into the macOS file.

`minimumSystemVersion: "11.0"` (Big Sur) is a reasonable floor: old enough to
cover effectively all Apple Silicon Macs, since Apple Silicon itself launched
with Big Sur.

### `release-check.mjs`: platform-aware, not platform-split

The script currently hard-asserts (paraphrased):

```js
if (JSON.stringify(tauri.bundle?.targets) !== JSON.stringify(["nsis"])) {
  failures.push("The public release channel must remain the single tested NSIS target.");
}
// ...
const expected = `LifeScribe Vault 2_${desktop.version}_x64-setup.exe`;
// ... checks apps/desktop/src-tauri/target/release/bundle/nsis for exactly that file
```

This becomes platform-branched, reading the **merged** config (base +
platform override) rather than only the base file, since on macOS the
override lives in `tauri.macos.conf.json`, not `tauri.conf.json`:

```js
const isMac = process.platform === "darwin";
const platformConfigPath = isMac
  ? "apps/desktop/src-tauri/tauri.macos.conf.json"
  : null;
const platformConfig = platformConfigPath && existsSync(new URL(platformConfigPath, root))
  ? readJson(platformConfigPath)
  : {};
const effectiveTargets = platformConfig.bundle?.targets ?? tauri.bundle?.targets;

const expectedTargets = isMac ? ["dmg"] : ["nsis"];
if (JSON.stringify(effectiveTargets) !== JSON.stringify(expectedTargets)) {
  failures.push(
    `The public release channel must remain the single tested ${expectedTargets[0].toUpperCase()} target.`,
  );
}
```

And the artifact check branches similarly — on macOS, look in
`apps/desktop/src-tauri/target/release/bundle/dmg/` for
`LifeScribe Vault 2_${desktop.version}_aarch64.dmg` (Tauri's DMG naming
convention) instead of the NSIS `.exe` path/name. Both branches keep the same
"exactly one expected artifact, no unexpected artifacts" enforcement the
Windows path has today — the rigor doesn't change per platform, only the
expected filename/directory does.

This is a single script with an `isMac` branch, not two scripts. The
version-consistency check (four sources of truth: `package.json`,
`tauri.conf.json`, `Cargo.toml`, lockfile) and the frozen-identifier check are
platform-independent and need no branching at all.

### Docs: a new, separate macOS packaging doc

`docs/release/windows-packaging.md` is Windows-specific by name and content
(prerequisites, `x86_64-pc-windows-msvc` target, NSIS specifics). Rather than
adding conditionals to that doc, add a new
`docs/release/macos-packaging.md` mirroring its structure — prerequisites,
build command, verification, known caveats — so each doc stays a
copy-pasteable, unconditional set of steps for its own platform.

Prerequisites section covers: Xcode Command Line Tools, the
`aarch64-apple-darwin` Rust target (`rustup target add aarch64-apple-darwin`),
and the Tauri CLI (already a shared cross-platform dependency, no new
install).

### README: unsigned-build messaging

Wherever `README.md` currently points people to the Windows installer, add a
macOS entry stating plainly: this build is unsigned, macOS will show "Apple
could not verify this app," and the fix is right-click → Open (or
`xattr -d com.apple.quarantine <path-to-app>` on the `.app`) the first time
only, after which it opens normally. Stated directly, same tone as the rest of
the README — not apologetic, not buried in a caveats section.

### Testing: no new automated coverage, a manual QA checklist

The app's Rust and TypeScript logic doesn't branch on OS, and the existing
544 frontend + 132 Rust tests already run cross-platform as-is — no test
changes are needed for this work, and none would meaningfully catch
packaging-specific issues anyway.

What's needed instead is a **manual QA checklist**, run once per macOS
release by hand (not automated), covering exactly what automated tests can't:

- Does the unsigned `.app` actually launch after the Gatekeeper bypass?
- Does the vault directory land in the macOS-conventional location
  (`~/Library/Application Support/com.lifescribe.vault.v2`, via
  `app_data_dir()`)?
- Do native file-open/save dialogs (used for attachments, backup/restore,
  vault relocation) behave correctly?
- Does window sizing and native chrome (traffic-light buttons, title bar)
  look right at the configured min/default dimensions?
- Does Cmd+Q and the default macOS app menu behave sanely (quits cleanly,
  no orphaned process)?

This checklist lives as a section in `docs/release/macos-packaging.md`
alongside the build steps, not as a separate document.

## Summary of decisions

| Question | Decision |
|---|---|
| Signing/notarization | Declined — ship unsigned, document the Gatekeeper workaround |
| Build environment | Local, on your existing Mac — no CI automation in this phase |
| Architecture | Apple Silicon (`aarch64-apple-darwin`) only |
| Config mechanism | Tauri's auto-merged `tauri.macos.conf.json` platform override |
| Release-check | One script, platform-branched — same rigor on both platforms |
| Docs | New `docs/release/macos-packaging.md`, mirrors the Windows doc's structure |
| Testing | No new automated tests; a manual QA checklist in the packaging doc |
