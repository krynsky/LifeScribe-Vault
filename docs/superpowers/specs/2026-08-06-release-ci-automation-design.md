# Automated release builds via GitHub Actions — design

**Date:** 2026-08-06
**Status:** Approved (brainstorm)

## Problem

Cutting a release today requires manually running `npm run build` on a
Windows machine and separately on a physical Mac, transferring the resulting
`.dmg` between machines, and manually running `gh release create` with both
installers attached — the exact sequence this session just did by hand for
`v1.0.0`. Every future release repeats that same manual, cross-machine
process, including physically moving a file from a Mac to whatever machine
runs the `gh` command.

## Goals

1. Pushing a version tag builds both installers (Windows NSIS, macOS DMG)
   automatically, without requiring access to a physical Mac.
2. The same verification rigor that `npm run build` already enforces locally
   (six-gate check — precheck, build, tidy, artifact contract) runs in CI on
   both platforms; a broken build fails loudly instead of silently producing
   a bad or partial release.
3. A successful build results in a draft GitHub Release with both installers
   attached, ready for a human to review notes and publish — not published
   automatically.
4. The tag pushed and the app's actual version (as recorded in
   `package.json`/`Cargo.toml`/`tauri.conf.json`) are verified to agree
   before a release is created, closing a gap that exists today (nothing
   currently checks the two against each other).

## Non-goals

- Automatic publishing (no draft step) — explicitly rejected in favor of a
  human review gate before anything goes public.
- Code signing / notarization on either platform — unrelated, already
  explicitly declined for both Windows and macOS in prior decisions this
  project has made.
- Any change to the local `npm run build` pipeline itself (`scripts/release-check.mjs`,
  `scripts/tidy-release-artifacts.mjs`, `scripts/clean-release-artifacts.mjs`)
  — CI reuses it as-is, doesn't modify or duplicate its logic.
- Linux builds, or any target beyond the two already supported (Windows x64,
  macOS Apple Silicon).
- Auto-generated changelog content beyond GitHub's own `--generate-notes`
  baseline — a human edits the draft's notes before publishing regardless.

## Approach

### Trigger

`on: push: tags: ['v*']` in a new workflow file,
`.github/workflows/release.yml`. Pushing a tag like `v1.0.1` is the one
action that starts the entire pipeline — matches the existing convention of
bumping the three version-contract files before tagging a release.

### Three jobs

**`build-windows`** (runs on `windows-latest`):
1. Checkout the tagged commit.
2. Install Node.js 20+ and stable Rust (MSVC toolchain, the default on
   `windows-latest`).
3. `npm install`.
4. `npm run build` — this already runs the full six-gate-equivalent sequence
   (`release:clean` → `release:precheck` → `tauri build` → `release:tidy` →
   `release:check`), so no separate test/lint step is needed in the
   workflow; it's already baked into the existing build script. A failure at
   any stage fails the job.
5. Upload
   `apps/desktop/src-tauri/target/release/bundle/nsis/LifeScribe Vault_<version>_x64-setup.exe`
   as a workflow artifact (`actions/upload-artifact`).

**`build-macos`** (runs on `macos-latest`, which GitHub's hosted runners now
provision on Apple Silicon by default — matches the project's
`aarch64-apple-darwin`-only target with no extra runner configuration
needed):
1. Checkout the tagged commit.
2. Install Node.js 20+, stable Rust with `rustup target add aarch64-apple-darwin`,
   and confirm Xcode Command Line Tools (preinstalled on GitHub's macOS
   runner image).
3. `npm install`.
4. `npm run build` — same script, same six-gate sequence, this time
   exercising the macOS/`dmg` branch of `release-check.mjs` and
   `tidy-release-artifacts.mjs` for real, in CI, on every release from now
   on (today it's only been exercised by hand, twice).
5. Upload
   `apps/desktop/src-tauri/target/release/bundle/dmg/LifeScribe Vault_<version>_aarch64.dmg`
   as a workflow artifact.

**`publish`** (runs after both build jobs succeed — `needs: [build-windows, build-macos]`):
1. Download both artifacts.
2. Extract the version from the pushed tag (`v1.0.1` → `1.0.1`) and compare
   it against `apps/desktop/package.json`'s `version` field (already the
   single source of truth `release-check.mjs` derives its own consistency
   checks from). If they don't match, fail the job with a clear message
   rather than creating a release under the wrong version — this is the new
   tag/version consistency gate that doesn't exist today.
3. Run `gh release create <tag> --draft --generate-notes` with both
   installer files attached, authenticated via the workflow's built-in
   `GITHUB_TOKEN` (no personal access token or secret to manage).

### Failure isolation

If either build job fails, `publish` never runs (`needs:` dependency) — no
draft release is created, no partial upload with only one platform's
installer. The failure surfaces on the Actions tab exactly like any other CI
failure; nothing reaches GitHub's Releases page.

### What changes for you at release time

Version bump (`package.json`, `Cargo.toml`, `tauri.conf.json`) → commit →
`git tag v1.0.1 && git push origin v1.0.1`. CI builds both installers,
verifies the tag matches, and leaves a draft release with both attached and
baseline auto-generated notes. You review/edit the notes and click Publish —
same manual judgment call as today, minus the manual building and file
transfer.

## Summary of decisions

| Question | Decision |
|---|---|
| Trigger | Push a version tag (`v*`) |
| Publishing mechanism | `gh` CLI directly, not a third-party Action — no extra dependency to pin/trust, same tool used manually this session |
| Draft vs. published | Draft — human reviews and publishes manually |
| Verification | Full `npm run build` (six-gate equivalent) runs on both platforms before any release is created |
| New gap closed | Tag version vs. `package.json` version now verified to match before publishing |
