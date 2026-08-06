# Release CI Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pushing a version tag (`v*`) automatically builds the Windows and macOS installers on GitHub-hosted runners and creates a draft GitHub Release with both attached, using the existing `npm run build` pipeline unmodified.

**Architecture:** One new workflow file, `.github/workflows/release.yml`, with three jobs: `build-windows` (runs on `windows-latest`), `build-macos` (runs on `macos-latest`, Apple Silicon by default), and `publish` (runs after both succeed, verifies the tag matches `package.json`'s version, then uses the `gh` CLI to create a draft release with both installers attached). No third-party release-publishing Action — `gh` is preinstalled on every GitHub-hosted runner and authenticates via the workflow's built-in `GITHUB_TOKEN`.

**Tech Stack:** GitHub Actions, `actions/checkout`, `actions/setup-node`, `dtolnay/rust-toolchain` (Rust toolchain setup — the de facto standard, minimal, single-purpose action), `actions/upload-artifact` / `actions/download-artifact`, `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-08-06-release-ci-automation-design.md`

---

### Task 1: Workflow skeleton + Windows build job

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create the workflow file with the trigger and the Windows build job**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - "v*"

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - uses: dtolnay/rust-toolchain@stable

      - name: Install dependencies
        run: npm install

      - name: Build
        run: npm run build

      - uses: actions/upload-artifact@v4
        with:
          name: windows-installer
          path: apps/desktop/src-tauri/target/release/bundle/nsis/*.exe
          if-no-files-found: error
```

- [ ] **Step 2: Verify YAML syntax**

Run from the repo root:

```powershell
npx -y js-yaml .github/workflows/release.yml
```

Expected: the parsed YAML is printed back out (re-serialized), no error. `npx -y` downloads the tiny `js-yaml` CLI on the fly for this one check — it's not added as a project dependency.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add release workflow with Windows build job"
```

---

### Task 2: macOS build job

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Add the macOS build job**

Current `.github/workflows/release.yml` ends with the `build-windows` job's `upload-artifact` step. Add a new top-level job immediately after it (same indentation level as `build-windows`):

```yaml
  build-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-darwin

      - name: Install dependencies
        run: npm install

      - name: Build
        run: npm run build

      - uses: actions/upload-artifact@v4
        with:
          name: macos-installer
          path: apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg
          if-no-files-found: error
```

The full file should now read:

```yaml
name: Release

on:
  push:
    tags:
      - "v*"

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - uses: dtolnay/rust-toolchain@stable

      - name: Install dependencies
        run: npm install

      - name: Build
        run: npm run build

      - uses: actions/upload-artifact@v4
        with:
          name: windows-installer
          path: apps/desktop/src-tauri/target/release/bundle/nsis/*.exe
          if-no-files-found: error

  build-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-darwin

      - name: Install dependencies
        run: npm install

      - name: Build
        run: npm run build

      - uses: actions/upload-artifact@v4
        with:
          name: macos-installer
          path: apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg
          if-no-files-found: error
```

- [ ] **Step 2: Verify YAML syntax**

```powershell
npx -y js-yaml .github/workflows/release.yml
```

Expected: parses without error, both `build-windows` and `build-macos` jobs appear in the re-serialized output.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add macOS build job to release workflow"
```

---

### Task 3: Publish job

**Files:**
- Modify: `.github/workflows/release.yml`

**Context:** This job downloads both installer artifacts, verifies the pushed tag's version matches `apps/desktop/package.json`'s version (a check that doesn't exist anywhere today — `release-check.mjs` verifies the version files agree with *each other*, but nothing today checks them against the git tag), and creates a draft GitHub Release with both installers attached via `gh release create`.

- [ ] **Step 1: Add the publish job**

Add a new top-level job after `build-macos` (same indentation level):

```yaml
  publish:
    needs: [build-windows, build-macos]
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - uses: actions/download-artifact@v4
        with:
          name: windows-installer
          path: dist/

      - uses: actions/download-artifact@v4
        with:
          name: macos-installer
          path: dist/

      - name: Verify tag matches package version
        shell: bash
        run: |
          TAG_VERSION="${GITHUB_REF_NAME#v}"
          PKG_VERSION=$(node -p "require('./apps/desktop/package.json').version")
          if [ "$TAG_VERSION" != "$PKG_VERSION" ]; then
            echo "Tag version ($TAG_VERSION) does not match package.json version ($PKG_VERSION)."
            exit 1
          fi
          echo "Tag version matches package.json ($PKG_VERSION)."

      - name: Create draft release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release create "${GITHUB_REF_NAME}" \
            dist/*.exe \
            dist/*.dmg \
            --draft \
            --generate-notes \
            --title "LifeScribe Vault ${GITHUB_REF_NAME#v}"
```

`permissions: contents: write` is required — without it the default `GITHUB_TOKEN` can't create releases.

- [ ] **Step 2: Verify YAML syntax**

```powershell
npx -y js-yaml .github/workflows/release.yml
```

Expected: parses without error, all three jobs (`build-windows`, `build-macos`, `publish`) appear in the re-serialized output, and `publish`'s `needs` field lists both build jobs.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add publish job with tag/version check and draft release creation"
```

---

### Task 4: Live end-to-end verification

**Files:** none (verification only)

**Context:** Nothing in Tasks 1-3 proves the workflow actually *runs* successfully — YAML syntax validity says nothing about whether `windows-latest` has everything Tauri's NSIS bundler needs, or whether `macos-latest`'s Apple-Silicon default actually builds a working `dmg`. This task pushes a real (but clearly-marked-as-test) tag, watches the workflow run on GitHub's infrastructure using the already-authenticated `gh` CLI, and cleans up afterward. This is fully executable without a physical Mac — GitHub's `macos-latest` runner is a cloud VM, not local hardware.

- [ ] **Step 1: Push a test tag**

From the repo root, on the commit that includes all three workflow jobs (i.e. after Task 3's commit):

```bash
git tag v1.0.1-citest1
git push origin v1.0.1-citest1
```

The `v1.0.1` portion must match `apps/desktop/package.json`'s current `version` field (`1.0.0` as of this plan being written — check `apps/desktop/package.json` at execution time and adjust the tag's numeric portion to match exactly, e.g. `v1.0.0-citest1` if the version hasn't changed). The `-citest1` pre-release suffix keeps this tag visibly distinct from a real release tag.

- [ ] **Step 2: Watch the workflow run**

```bash
gh run list --workflow=release.yml --limit=1
```

Copy the run ID from the output, then:

```bash
gh run watch <run-id>
```

Expected: this streams live status until the run finishes. Watch for `build-windows` and `build-macos` to both complete successfully, then `publish` to run after them.

- [ ] **Step 3: If a job fails, diagnose from the logs**

```bash
gh run view <run-id> --log-failed
```

Read the failed step's output. The most likely failure mode, per the design spec's own risk note: the Windows job's NSIS bundling step failing because `windows-latest` doesn't have `makensis` available and Tauri's bundler couldn't auto-fetch it. If that's what you see, add this step to `.github/workflows/release.yml`'s `build-windows` job, immediately before the `Build` step:

```yaml
      - name: Install NSIS
        run: choco install nsis -y
```

Commit that fix (`git commit -m "ci: install NSIS for Windows bundler"`), delete the failed test tag (Step 5 below), and re-run from Step 1 with a new suffix (e.g. `-citest2`).

If a different failure occurs, its exact cause depends on the live error — read the log output, fix the specific problem in `.github/workflows/release.yml`, commit, delete the tag, and retry with an incremented suffix. Don't guess at a fix without reading the actual failure output.

- [ ] **Step 4: Confirm the draft release**

Once the run succeeds end to end:

```bash
gh release view v1.0.1-citest1
```

Expected: `draft: true`, two assets attached (one `.exe`, one `.dmg`), both named per the `LifeScribe Vault_<version>_...` pattern with no stray files.

- [ ] **Step 5: Clean up the test tag and draft release**

```bash
gh release delete v1.0.1-citest1 --yes
git push origin --delete v1.0.1-citest1
git tag -d v1.0.1-citest1
```

Expected: the draft release and both the remote and local tag are gone. Verify with `gh release list` (the test release should not appear) and `git tag -l` (the test tag should not appear locally).

- [ ] **Step 6: Report the outcome**

Confirm in your final report: did the workflow succeed without needing the NSIS contingency fix, or was that fix needed? This determines whether Task 3's committed file is the final state or whether an additional commit from Step 3 above is also part of this plan's output.

---

## Summary

| Task | Produces |
|---|---|
| 1 | `.github/workflows/release.yml` with trigger + Windows build job, YAML-valid |
| 2 | macOS build job added, YAML-valid |
| 3 | Publish job added — tag/version check + draft release creation via `gh` |
| 4 | Live-verified on GitHub's actual runners via a throwaway test tag; any real failure fixed and committed; test artifacts cleaned up |
