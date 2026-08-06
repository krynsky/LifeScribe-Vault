# macOS Build Support (Unsigned, Apple Silicon) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Environment note:** Tasks 1-5 are code/doc changes verifiable on any machine (this plan was authored and is expected to be executed from a Windows checkout, same as the rest of the repo). Task 6 (producing and verifying an actual `.dmg`) requires a physical Mac and cannot be executed by an agent working from a Windows environment — it is written as a runbook for the user (or an agent with Mac access) to follow separately. Do not attempt to simulate or skip it; flag it as requiring the user's Mac when this plan reaches that point.

**Goal:** Make `apps/desktop` buildable as a `.dmg` on Apple Silicon macOS, with the existing release-check gate enforcing the same rigor on macOS artifacts it enforces on Windows today, and clear unsigned-build documentation.

**Architecture:** A new `tauri.macos.conf.json` platform-override file (auto-merged by the Tauri CLI on macOS) switches the bundle target from `nsis` to `dmg` without touching the Windows-only base config. `scripts/release-check.mjs` and `scripts/clean-release-artifacts.mjs` gain a `process.platform === "darwin"` branch each, so the existing Windows behavior is provably unchanged while the same checks now also apply on macOS. New `docs/release/macos-packaging.md` mirrors the Windows packaging doc's structure and adds a manual QA checklist. `README.md` gains macOS platform info and Gatekeeper messaging.

**Tech Stack:** Tauri 2, Node.js (plain `.mjs` scripts, no test framework — matching this repo's existing convention for release tooling), Rust `aarch64-apple-darwin` target.

**Spec:** `docs/superpowers/specs/2026-08-06-macos-build-support-design.md`

---

### Task 1: macOS platform config override

**Files:**
- Create: `apps/desktop/src-tauri/tauri.macos.conf.json`

- [ ] **Step 1: Create the platform override file**

Create `apps/desktop/src-tauri/tauri.macos.conf.json`:

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

- [ ] **Step 2: Verify the base config is untouched**

Run:

```powershell
git diff apps/desktop/src-tauri/tauri.conf.json
```

Expected: no output — this task creates a new file only, the base `tauri.conf.json` (with its Windows-only `"targets": ["nsis"]`) is not modified.

- [ ] **Step 3: Verify the new file is valid JSON**

Run:

```powershell
node -e "JSON.parse(require('fs').readFileSync('apps/desktop/src-tauri/tauri.macos.conf.json', 'utf-8')); console.log('valid JSON')"
```

Expected: `valid JSON` printed, no error.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/tauri.macos.conf.json
git commit -m "feat(release): add macOS platform config override for dmg target"
```

---

### Task 2: Platform-aware `release-check.mjs`

**Files:**
- Modify: `scripts/release-check.mjs`

**Context:** This script is the release gate run by `npm run build` (via `release:precheck` before building and `release:check` after). It currently hard-asserts Windows-only values. It needs to branch on `process.platform` so it enforces `["dmg"]` + the `.dmg` artifact on macOS and continues to enforce exactly what it enforces today on Windows — the Windows-path assertions must be provably unchanged.

The full current file:

```js
import { existsSync, readFileSync, readdirSync } from "node:fs";
const root = new URL("../", import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), "utf-8"));
const desktop = readJson("apps/desktop/package.json");
const tauri = readJson("apps/desktop/src-tauri/tauri.conf.json");
const lock = readJson("package-lock.json");
const cargo = readFileSync(new URL("apps/desktop/src-tauri/Cargo.toml", root), "utf-8");
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const versions = [desktop.version, tauri.version, cargoVersion, lock.packages?.["apps/desktop"]?.version];

const failures = [];
if (new Set(versions).size !== 1 || versions.some((value) => !value)) {
  failures.push(`Version mismatch: package, Tauri, Cargo, lock = ${versions.join(", ")}`);
}
if (tauri.identifier !== "com.lifescribe.vault.v2") {
  failures.push(`Frozen app identifier changed: ${tauri.identifier}`);
}
if (JSON.stringify(tauri.bundle?.targets) !== JSON.stringify(["nsis"])) {
  failures.push("The public release channel must remain the single tested NSIS target.");
}
if (existsSync(new URL("apps/desktop/package-lock.json", root))) {
  failures.push("Obsolete nested package-lock.json exists; use the workspace root lockfile only.");
}

const bundle = new URL("apps/desktop/src-tauri/target/release/bundle/nsis", root);
const prebuild = process.argv.includes("--prebuild");
if (!prebuild) {
  const expected = `LifeScribe Vault 2_${desktop.version}_x64-setup.exe`;
  if (!existsSync(bundle)) {
    failures.push("NSIS output directory is missing; run the release build first.");
  } else {
    const artifacts = readdirSync(bundle);
    if (!artifacts.includes(expected)) failures.push(`Expected installer is missing: ${expected}`);
    const unexpected = artifacts.filter((name) => name !== expected);
    if (unexpected.length > 0) failures.push(`Unexpected NSIS artifacts: ${unexpected.join(", ")}`);
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log(
  `Release ${prebuild ? "manifest" : "artifact"} contract OK: LifeScribe Vault ${desktop.version}, NSIS, ${tauri.identifier}`,
);
```

- [ ] **Step 1: Replace the file with the platform-branched version**

```js
import { existsSync, readFileSync, readdirSync } from "node:fs";
const root = new URL("../", import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), "utf-8"));
const desktop = readJson("apps/desktop/package.json");
const tauri = readJson("apps/desktop/src-tauri/tauri.conf.json");
const lock = readJson("package-lock.json");
const cargo = readFileSync(new URL("apps/desktop/src-tauri/Cargo.toml", root), "utf-8");
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const versions = [desktop.version, tauri.version, cargoVersion, lock.packages?.["apps/desktop"]?.version];

const isMac = process.platform === "darwin";
const macConfigPath = "apps/desktop/src-tauri/tauri.macos.conf.json";
const macConfig = isMac && existsSync(new URL(macConfigPath, root)) ? readJson(macConfigPath) : {};
// On macOS the bundle target override lives in the platform config file
// (auto-merged by the Tauri CLI at build time), not the base tauri.conf.json
// — read the effective value the same way the CLI would resolve it.
const effectiveTargets = isMac ? macConfig.bundle?.targets : tauri.bundle?.targets;
const expectedTargets = isMac ? ["dmg"] : ["nsis"];
const targetLabel = expectedTargets[0].toUpperCase();

const failures = [];
if (new Set(versions).size !== 1 || versions.some((value) => !value)) {
  failures.push(`Version mismatch: package, Tauri, Cargo, lock = ${versions.join(", ")}`);
}
if (tauri.identifier !== "com.lifescribe.vault.v2") {
  failures.push(`Frozen app identifier changed: ${tauri.identifier}`);
}
if (JSON.stringify(effectiveTargets) !== JSON.stringify(expectedTargets)) {
  failures.push(`The public release channel must remain the single tested ${targetLabel} target.`);
}
if (existsSync(new URL("apps/desktop/package-lock.json", root))) {
  failures.push("Obsolete nested package-lock.json exists; use the workspace root lockfile only.");
}

const bundleDir = isMac ? "dmg" : "nsis";
const bundle = new URL(`apps/desktop/src-tauri/target/release/bundle/${bundleDir}`, root);
const prebuild = process.argv.includes("--prebuild");
if (!prebuild) {
  const expected = isMac
    ? `LifeScribe Vault 2_${desktop.version}_aarch64.dmg`
    : `LifeScribe Vault 2_${desktop.version}_x64-setup.exe`;
  if (!existsSync(bundle)) {
    failures.push(`${targetLabel} output directory is missing; run the release build first.`);
  } else {
    const artifacts = readdirSync(bundle);
    if (!artifacts.includes(expected)) failures.push(`Expected installer is missing: ${expected}`);
    const unexpected = artifacts.filter((name) => name !== expected);
    if (unexpected.length > 0) failures.push(`Unexpected ${targetLabel} artifacts: ${unexpected.join(", ")}`);
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log(
  `Release ${prebuild ? "manifest" : "artifact"} contract OK: LifeScribe Vault ${desktop.version}, ${targetLabel}, ${tauri.identifier}`,
);
```

- [ ] **Step 2: Regression-verify Windows behavior is unchanged**

This step runs on the current (Windows) machine and proves the Windows path of the new branching logic behaves identically to before. Run from the repo root:

```powershell
node scripts/release-check.mjs --prebuild
```

Expected: prints `Release manifest contract OK: LifeScribe Vault 1.0.0, NSIS, com.lifescribe.vault.v2` (or the current version number) with exit code 0 — same output shape as before this change, confirming `isMac` is `false` on Windows and the Windows branch (`expectedTargets = ["nsis"]`, `bundleDir = "nsis"`, exe filename) is taken.

- [ ] **Step 3: Regression-verify the full artifact check**

If a prior NSIS build exists at `apps/desktop/src-tauri/target/release/bundle/nsis/`, also run:

```powershell
node scripts/release-check.mjs
```

Expected: same pass/fail behavior as before this change (either passes if a valid installer is present, or fails with the same failure messages it would have failed with previously — e.g. missing installer). If no prior build exists, skip this step; it's exercised by the full `npm run build` in Task 6 instead.

- [ ] **Step 4: Commit**

```bash
git add scripts/release-check.mjs
git commit -m "feat(release): make release-check.mjs platform-aware (dmg on macOS)"
```

---

### Task 3: Platform-aware `clean-release-artifacts.mjs`

**Files:**
- Modify: `scripts/clean-release-artifacts.mjs`

**Context:** `npm run build` calls this before building, to remove stale artifacts so the release-check's "no unexpected artifacts" assertion is meaningful. It currently only cleans `msi` and `nsis` subdirectories. On macOS it should also clean a stale `dmg` directory; the log message should reflect the actual target cleaned rather than hardcoding "NSIS".

The full current file:

```js
import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = resolve(repository, "apps/desktop/src-tauri/target/release/bundle");
const version = JSON.parse(
  readFileSync(resolve(repository, "apps/desktop/package.json"), "utf-8"),
).version;

if (!bundle.startsWith(`${repository}${sep}`) || basename(bundle) !== "bundle") {
  throw new Error("Refusing to clean outside the release bundle directory.");
}

const msi = resolve(bundle, "msi");
if (existsSync(msi)) rmSync(msi, { recursive: true, force: true });
const nsis = resolve(bundle, "nsis");
if (existsSync(nsis)) rmSync(nsis, { recursive: true, force: true });
console.log(`Release artifacts cleaned for NSIS ${version}.`);
```

- [ ] **Step 1: Replace the file with the platform-aware version**

```js
import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = resolve(repository, "apps/desktop/src-tauri/target/release/bundle");
const version = JSON.parse(
  readFileSync(resolve(repository, "apps/desktop/package.json"), "utf-8"),
).version;

if (!bundle.startsWith(`${repository}${sep}`) || basename(bundle) !== "bundle") {
  throw new Error("Refusing to clean outside the release bundle directory.");
}

const msi = resolve(bundle, "msi");
if (existsSync(msi)) rmSync(msi, { recursive: true, force: true });
const nsis = resolve(bundle, "nsis");
if (existsSync(nsis)) rmSync(nsis, { recursive: true, force: true });
const dmg = resolve(bundle, "dmg");
if (existsSync(dmg)) rmSync(dmg, { recursive: true, force: true });

const target = process.platform === "darwin" ? "DMG" : "NSIS";
console.log(`Release artifacts cleaned for ${target} ${version}.`);
```

- [ ] **Step 2: Verify it still runs cleanly on Windows**

Run:

```powershell
node scripts/clean-release-artifacts.mjs
```

Expected: prints `Release artifacts cleaned for NSIS <version>.` (target label is `"NSIS"` since `process.platform` is `"win32"` here), exit code 0, no error — confirms the added `dmg` cleanup branch (which finds nothing to remove on Windows) doesn't break anything.

- [ ] **Step 3: Commit**

```bash
git add scripts/clean-release-artifacts.mjs
git commit -m "feat(release): also clean stale dmg artifacts, label cleanup output by platform"
```

---

### Task 4: `docs/release/macos-packaging.md`

**Files:**
- Create: `docs/release/macos-packaging.md`

**Context:** Mirrors `docs/release/windows-packaging.md`'s structure (Build, Version and identity contract, Upgrade policy) but for macOS specifics, and adds the manual QA checklist from the design spec. Unlike the Windows doc, this one states plainly that the build is unsigned — there is no "Signing" section to fill in, there's a "Gatekeeper" section instead.

- [ ] **Step 1: Create the doc**

Create `docs/release/macos-packaging.md`:

```markdown
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
```

- [ ] **Step 2: Verify the doc renders sensibly**

Read the file back and confirm there are no broken internal anchors or unclosed code fences:

```powershell
type docs\release\macos-packaging.md
```

Expected: full document prints without error; the three fenced code blocks (bash build commands, xattr command) are each properly opened and closed.

- [ ] **Step 3: Commit**

```bash
git add docs/release/macos-packaging.md
git commit -m "docs: add macOS packaging guide with unsigned-build QA checklist"
```

---

### Task 5: README macOS entry

**Files:**
- Modify: `README.md:7-9`

- [ ] **Step 1: Update the Platform line and add a macOS note**

Current `README.md` (lines 7-9):

```markdown
**Version:** 1.0.0
**Platform:** Windows (x64)  
**Status:** Active development
```

Change to:

```markdown
**Version:** 1.0.0
**Platform:** Windows (x64), macOS (Apple Silicon, unsigned)  
**Status:** Active development
```

- [ ] **Step 2: Add a short macOS note near the top, after the intro paragraph**

Current `README.md` (lines 5-9):

```markdown
A Windows-first local desktop app for building an encrypted digital legacy plan. Helps you document your digital executors, password-manager emergency access, devices, photos and videos, financial accounts and subscriptions, important documents, online accounts, platform legacy settings, and backups — plus a printable Recovery Kit — without putting any data on a server.

**Version:** 1.0.0
**Platform:** Windows (x64), macOS (Apple Silicon, unsigned)  
**Status:** Active development
```

Change to (adding one line after the Status line):

```markdown
A Windows-first local desktop app for building an encrypted digital legacy plan. Helps you document your digital executors, password-manager emergency access, devices, photos and videos, financial accounts and subscriptions, important documents, online accounts, platform legacy settings, and backups — plus a printable Recovery Kit — without putting any data on a server.

**Version:** 1.0.0
**Platform:** Windows (x64), macOS (Apple Silicon, unsigned)  
**Status:** Active development

> The macOS build is not code-signed or notarized (no Apple Developer account). macOS will warn "Apple could not verify this app" the first time you open it — right-click the app and choose **Open** to bypass this, once. See [macOS packaging](docs/release/macos-packaging.md#gatekeeper) for details.
```

- [ ] **Step 3: Verify the markdown renders sensibly**

```powershell
type README.md
```

Expected: the new blockquote line appears once, immediately after the Status line, with a working relative link to `docs/release/macos-packaging.md#gatekeeper`.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: note unsigned macOS build support in README"
```

---

### Task 6: First real macOS build and QA pass (requires a physical Mac)

**This task cannot be executed by an agent working from a Windows checkout.** It must be run by hand on an actual Apple Silicon Mac. If you're executing this plan with subagent-driven-development and reach this task, stop and hand it to the user rather than attempting to simulate it.

**Files:** none (verification only)

- [ ] **Step 1: Set up the Mac**

On the Mac, clone or pull the repo to the commit that includes Tasks 1-5, then:

```bash
xcode-select --install
rustup target add aarch64-apple-darwin
npm install
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: the command runs `release:clean` → `release:precheck` → `tauri build` → `release:check` and exits 0, printing `Release artifact contract OK: LifeScribe Vault <version>, DMG, com.lifescribe.vault.v2`. If it fails, read the failure message — Tasks 2-3's platform branching is what's being exercised for real here for the first time (Task 2/3's own verification steps only proved the Windows branch was unchanged, not that the macOS branch is correct — this is the first genuine test of the macOS branch).

- [ ] **Step 3: Locate the artifact**

```bash
ls "apps/desktop/src-tauri/target/release/bundle/dmg/"
```

Expected: exactly one file, `LifeScribe Vault 2_<version>_aarch64.dmg`.

- [ ] **Step 4: Run the manual QA checklist**

Open `docs/release/macos-packaging.md`, mount the `.dmg`, install the app (drag to Applications, or run in place), and work through every item in its "Manual QA checklist" section. Note any failures.

- [ ] **Step 5: Fix and re-verify, or report**

If anything in the checklist fails, that's a real bug to fix (in application code, not packaging) — file it or fix it as its own piece of work, not as an extension of this plan. If everything passes, the macOS build is ready to include in a release alongside the Windows installer.

---

## Summary

| Task | Produces |
|---|---|
| 1 | `tauri.macos.conf.json` platform override (dmg target) |
| 2 | `release-check.mjs` enforces the same rigor on macOS, Windows path proven unchanged |
| 3 | `clean-release-artifacts.mjs` also cleans stale dmg output, Windows path proven unchanged |
| 4 | `docs/release/macos-packaging.md` with build steps + manual QA checklist |
| 5 | `README.md` states macOS support and unsigned-build/Gatekeeper expectations |
| 6 | (Mac-only, manual) First real DMG built and QA-checked end to end |
