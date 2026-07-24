# Credential-Tooling Retirement (Plan 3c of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the now-unused legacy credential-generation tooling. Since the app composes at load (Plan 2) and the redesigned pack editor saves the base pack directly (Plan 3b-2), nothing in the running app or the editor uses this tooling any more — it is dead weight kept alive only by its own tests, one save-plugin import, and the Rust variant plumbing.

**Architecture:** Pure deletion + two small rewires (the dev save-plugin's `serializePack` source and its backup file list; the Rust `read_default_pack` command dropping its `variant` parameter). No app behavior changes — the single base pack is already the only pack loaded and saved.

**Tech Stack:** TypeScript, Rust (Tauri), Vitest, `cargo test`.

**Depends on:** Plan 3b-2 (PR #5) — the editor must already save the base pack without regenerating the credential pack. Execute this AFTER PR #5 merges; rebase this branch onto `main` first.

Source spec: `docs/superpowers/specs/2026-07-23-pack-editor-authoring-redesign-design.md` (§5). All commands from repo root.

**What is being retired (verified present on the branch this plan was written from):**
- Data: `apps/desktop/src-tauri/resources/packs/default-pack-credential.json`, `apps/desktop/scripts/credential-overlay.json`
- Tooling: `apps/desktop/scripts/build-credential-pack.mjs`, `apps/desktop/scripts/lib/credential-pack.mjs` (+ `credential-pack.d.mts`), `apps/desktop/scripts/lib/save-artifacts.mjs`, `apps/desktop/scripts/lib/derive-overlay.mjs`
- Tests: `apps/desktop/src/domain/credentialPack.test.ts`, `apps/desktop/src/domain/saveArtifacts.test.ts`, `apps/desktop/src/domain/deriveOverlay.test.ts`
- Rust: `CREDENTIAL_PACK_RESOURCE` + `pack_resource_for_variant` + the `variant` param of `read_default_pack` in `apps/desktop/src-tauri/src/pack_resources.rs`; its `variant_tests` and `apps/desktop/src-tauri/src/pack_resource_tests.rs`
- Config: `build:credential-pack` scripts in `apps/desktop/package.json` and root `package.json`; the credential resource entry in `apps/desktop/src-tauri/tauri.conf.json`
- Live consumers to rewire first: `apps/desktop/pack-editor/save-plugin.mjs` (imports `serializePack` from `credential-pack.mjs`; its backup copies the credential pack + overlay), `apps/desktop/src/api/vaultApi.ts` (`readDefaultPack` `variant` param), a stale comment in `apps/desktop/src/forms/structure/fieldOps.ts`.

---

## Task 1: Retire the JS/TS credential tooling

**Files:**
- Modify: `apps/desktop/pack-editor/save-plugin.mjs`, `apps/desktop/package.json`, root `package.json`, `apps/desktop/src/forms/structure/fieldOps.ts`
- Delete: `apps/desktop/scripts/build-credential-pack.mjs`, `apps/desktop/scripts/lib/credential-pack.mjs`, `apps/desktop/scripts/lib/credential-pack.d.mts`, `apps/desktop/scripts/lib/save-artifacts.mjs`, `apps/desktop/scripts/lib/derive-overlay.mjs`, `apps/desktop/scripts/credential-overlay.json`, `apps/desktop/src/domain/credentialPack.test.ts`, `apps/desktop/src/domain/saveArtifacts.test.ts`, `apps/desktop/src/domain/deriveOverlay.test.ts`

- [ ] **Step 1: Rewire the save-plugin off `credential-pack.mjs` FIRST** (so deleting it doesn't break the editor). In `apps/desktop/pack-editor/save-plugin.mjs`:
  - Replace `import { serializePack } from "../scripts/lib/credential-pack.mjs";` with an inline definition (it is exactly this):
    ```js
    /** Serialize a pack the way the resource file is stored (2-space, trailing LF). */
    const serializePack = (pack) => `${JSON.stringify(pack, null, 2)}\n`;
    ```
  - The backup endpoint (`backupPackFiles`) currently copies three files (`HINT_PATH`, `OVERLAY_PATH`, `PACK_PATH`). After this task the overlay and credential pack are gone, so change it to copy only `HINT_PATH` (`default-pack.json`). Remove the now-unused `OVERLAY_PATH` / `PACK_PATH` consts.
  - Confirm no other `credential`/`overlay` references remain in the file.

- [ ] **Step 2: Delete the tooling, scripts, data, and tests**

```bash
git rm apps/desktop/scripts/build-credential-pack.mjs \
       apps/desktop/scripts/lib/credential-pack.mjs \
       apps/desktop/scripts/lib/credential-pack.d.mts \
       apps/desktop/scripts/lib/save-artifacts.mjs \
       apps/desktop/scripts/lib/derive-overlay.mjs \
       apps/desktop/scripts/credential-overlay.json \
       apps/desktop/src/domain/credentialPack.test.ts \
       apps/desktop/src/domain/saveArtifacts.test.ts \
       apps/desktop/src/domain/deriveOverlay.test.ts
```

- [ ] **Step 3: Remove the npm scripts.** Delete `"build:credential-pack": "node scripts/build-credential-pack.mjs",` from `apps/desktop/package.json` and `"build:credential-pack": "npm --prefix apps/desktop run build:credential-pack",` from the root `package.json`.

- [ ] **Step 4: Fix the stale comment** in `apps/desktop/src/forms/structure/fieldOps.ts` (the JSDoc on `reorderFields` says the sequential-order invariant is "which deriveOverlay requires"). `deriveOverlay` no longer exists; reword to state the invariant plainly (array order == order-value order, which the overlay editor and `deriveOverlay`-free merge rely on) without naming the deleted function.

- [ ] **Step 5: Prove nothing live still references the deleted tooling.**

Run: `git grep -n "buildCredentialPack\|renderSaveArtifacts\|deriveOverlay\|credential-pack\|save-artifacts\|derive-overlay\|build:credential-pack\|credential-overlay" -- '*.ts' '*.tsx' '*.mjs' '*.json' ':!docs/**'`
Expected: no hits outside `docs/`. (The only remaining `default-pack-credential` references — the Rust resource + tauri.conf — are handled in Task 2.)

- [ ] **Step 6: Verify + commit**

```bash
npm --prefix apps/desktop run test
npm --prefix apps/desktop run typecheck
npm --prefix apps/desktop run lint
npm --prefix apps/desktop run typecheck:pack-editor
npm --prefix apps/desktop run lint:pack-editor
```
All green (the three deleted test files are gone; the editor's own save/backup tests still pass — check `pack-editor/save-plugin.test.mjs` covers backup, and update it if it asserted the old three-file copy).

```bash
git add -A
git commit -m "refactor(packs): retire JS credential-generation tooling (unused since compose-at-load)"
```

---

## Task 2: Retire the Rust variant plumbing + the credential resource

**Files:**
- Modify: `apps/desktop/src-tauri/src/pack_resources.rs`, `apps/desktop/src-tauri/src/lib.rs` (if it registers `pack_resource_tests`), `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src/api/vaultApi.ts`
- Delete: `apps/desktop/src-tauri/resources/packs/default-pack-credential.json`, `apps/desktop/src-tauri/src/pack_resource_tests.rs` (if it only tests the variant mapping)

- [ ] **Step 1: Simplify `read_default_pack`** in `apps/desktop/src-tauri/src/pack_resources.rs`:
  - Remove the `variant: String` parameter; the command always resolves the single base pack resource (`resources/packs/default-pack.json`).
  - Delete `pub const CREDENTIAL_PACK_RESOURCE` and the `pub fn pack_resource_for_variant`.
  - Introduce (or inline) a single `const DEFAULT_PACK_RESOURCE: &str = "resources/packs/default-pack.json";` and have `read_default_pack` read that directly.
  - Delete the `variant_tests` module in this file. Read the file first and adapt exactly — keep the resource-read/error behavior identical, only drop the variant dimension.

- [ ] **Step 2: Handle `pack_resource_tests.rs`.** `apps/desktop/src-tauri/src/lib.rs` conditionally includes `pack_resource_tests`. Read `pack_resource_tests.rs`: if it only tests `pack_resource_for_variant`/the variant mapping, `git rm` it and remove its `mod pack_resource_tests;` (and the `#[path=...]`) from `lib.rs`. If it also covers still-valid behavior (reading the default pack, write round-trip), keep the file but delete only the variant-specific tests and update the read call to the new no-variant signature.

- [ ] **Step 3: Drop the credential resource from the bundle.** In `apps/desktop/src-tauri/tauri.conf.json`, change the `resources` array from
  `["resources/packs/default-pack.json", "resources/packs/default-pack-credential.json"]`
  to `["resources/packs/default-pack.json"]`.

- [ ] **Step 4: Delete the credential pack resource**

```bash
git rm apps/desktop/src-tauri/resources/packs/default-pack-credential.json
```

- [ ] **Step 5: Update the frontend `readDefaultPack`.** In `apps/desktop/src/api/vaultApi.ts`, drop the `variant` parameter so it matches the new Rust command:
  ```ts
  export function readDefaultPack(): Promise<string> {
    return invoke("read_default_pack");
  }
  ```
  `loadDefaultPack.ts` already calls `readDefaultPack()` with no argument, so no caller changes are needed — confirm with a grep that nothing passes a variant.

- [ ] **Step 6: Verify + commit**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
npm --prefix apps/desktop run test
npm --prefix apps/desktop run typecheck
npm --prefix apps/desktop run lint
```
All green. Confirm `git grep -n "default-pack-credential\|pack_resource_for_variant\|CREDENTIAL_PACK_RESOURCE\|read_default_pack.*variant"` returns nothing outside `docs/`.

```bash
git add -A
git commit -m "refactor(packs): drop the read_default_pack variant + bundled credential pack"
```

---

## Self-Review

**Spec coverage (this plan = spec §5 retirement):** deletes the credential pack, overlay, `buildCredentialPack`/`deriveOverlay`/`renderSaveArtifacts` tooling, the `build:credential-pack` script, and the Rust `read_default_pack` variant plumbing — all listed. ✓

**Placeholder scan:** No TBD/TODO. The two "read the file and adapt" instructions (save-plugin backup shape, `pack_resource_tests.rs`) are bounded with explicit expected end-states, not placeholders.

**Ordering safety:** Task 1 Step 1 rewires the only live JS consumer (`save-plugin.mjs`) BEFORE Step 2 deletes `credential-pack.mjs`, so the build/tests never reference a deleted module. Task 2 changes the Rust command and the frontend signature together, and `loadDefaultPack` already passes no variant, so there is no window where the IPC contract is mismatched.

**Risk notes:**
- `serializePack` is inlined into `save-plugin.mjs` rather than left in a shared module — after `build-credential-pack.mjs` is gone, the save-plugin is its only consumer, so a shared module would be over-abstraction.
- `cargo test` must run for Task 2 (the main `npm test` won't catch a Rust break).
- Backup now copies a single file; update `pack-editor/save-plugin.test.mjs` if it asserted the three-file behavior.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-23-credential-tooling-retirement.md`. Execute AFTER PR #5 merges (rebase onto `main`). Two options:

1. **Subagent-Driven (recommended)** — one subagent per task, spec + code-quality review between tasks.
2. **Inline Execution** — batch with checkpoints.

This is the final plan of the composable-form-modules effort; after it merges, the app ships a single base pack composed with modules at load, authored through the overlay pack editor, with no credential-generation machinery remaining.
