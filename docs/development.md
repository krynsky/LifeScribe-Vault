# LifeScribe Vault — Development Documentation

Technical reference for contributors. The authoritative design record is
[docs/plans/2026-06-10-001-feat-lifescribe-vault-v2-rebuild-plan.md](plans/2026-06-10-001-feat-lifescribe-vault-v2-rebuild-plan.md);
feature specs and implementation plans live under [docs/superpowers/](superpowers/).
User-facing behavior is described in [docs/user-guide.md](user-guide.md).

## Stack

Tauri 2 · React 19 · TypeScript · Vite · Rust · SQLite (WAL) · Argon2id · XChaCha20-Poly1305.
Windows-first; the Rust crate compiles elsewhere but Windows-only features (clipboard hygiene) no-op.

## Commands

```powershell
npm install
npm run dev                    # live Tauri dev run (hot reload; packs served from source)
npm run build                  # Windows installers (MSI + NSIS)

npm run test                   # frontend: Vitest + RTL
npm run typecheck              # tsc --noEmit
npm run lint                   # eslint
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml

npm run pack-editor            # dev-only pack editor (see "Pack editor" below)
```

## Repository layout

```
apps/desktop/
  src/
    api/vaultApi.ts        # the ONLY bridge to Rust (typed invoke wrappers)
    domain/                # pure domain logic — no React, no IPC
      formModel.ts         #   FormPack / sections / groups / fields / conditions
      packValidation.ts    #   validatePack — single gate for untrusted pack JSON
      packMerge.ts         #   base pack + UserOverlay -> ResolvedSection[]
      packMigrations.ts    #   schemaVersion stepwise value migrations (on read)
      valuesStore.ts       #   records, archived answers, reconcile
      attachmentRefs.ts    #   attachment-ref bookkeeping (post-commit deletion diff)
      snapshot.ts          #   THE snapshot shape; normalize/build round-trip
      composePack.ts       #   base pack + FormModules + selections -> concrete pack
      readiness.ts         #   section status + readiness summary
      recoveryKit.ts       #   pointer-based Kit derivation + staleness fingerprint
      loadDefaultPack.ts   #   bundled-pack loading seam (resource -> static fallback)
    creator/               # pack editing logic shared by app + pack editor
      packEdits.ts         #   immutable pack mutations (add/remove/update/move)
      packAutoMigrate.ts   #   derive migration ops from breaking edits
      packExport.ts        #   structure-only export/import
      editorView.ts        #   provenance-annotated overlay view (pack editor)
      editorEdits.ts       #   route an edit to base or a module option (pack editor)
    forms/                 # FormRenderer + field controls + structure editor
      structure/           #   FieldList / FieldPropertyPanel / SectionStructureEditor
    routes/                # Dashboard, SectionPage, SetupScreen, LockedScreen,
                           # BackupPage, RecoveryKitPage, lockPolicy
  src-tauri/src/
    commands.rs            # session commands + Tauri wrappers; Mutex<VaultSession>
    crypto.rs              # Argon2id KDF, AEAD, key wrap, AAD construction
    repository.rs          # SQLite: vault header + generation-counted snapshots
    attachments.rs         # encrypt/decrypt/delete/sweep attachment files
    draft_stash.rs         # encrypted draft stash (lock flow)
    backup.rs              # .lsvbackup create/restore, safety backup, marker
    clipboard.rs           # Win32 clipboard hygiene (exclusion formats + auto-clear)
    pack_resources.rs      # bundled base pack read + dev write-back
    error.rs               # VaultError -> stable string error codes (IPC contract)
    tests/                 # integration tests against real SQLite (tempfile)
  src-tauri/resources/packs/
    default-pack.json             # the single bundled base pack (sections + FormModules)
  scripts/
    pack-backups/                 # gitignored, written by the pack editor backup
  pack-editor/             # dev-only Vite app for editing the bundled base pack
```

## Architecture laws

These invariants are load-bearing; changes that touch them need matching test changes.

1. **Envelope encryption.** An Argon2id-derived KEK wraps a random 32-byte data key;
   only the data key encrypts content. Every AEAD operation binds context via AAD:
   a frozen domain tag (`snapshot` / `attachment` / `draft` / `backup`), the vault id,
   and a record identity (e.g. `generation:7`). Blobs cannot be replayed across
   domains, vaults, or records. Keys live only in `Zeroizing` buffers, never cross
   IPC, and never appear in errors or logs. Key-holding types have no `Debug`.

2. **The snapshot is opaque to Rust.** `serde_json::Value` passthrough — never mirror
   it in a Rust struct (v1's mirrored struct silently stripped fields). The frontend
   mirrors the same law: unknown top-level fields round-trip through
   `ParsedSnapshot.extra`.

3. **Generation-counted CAS saves.** `save_snapshot` compares against the caller's
   base generation; stale base → `SnapshotConflict`, never blind-overwrite. The
   newest + 3 previous generations are retained. Load returns the newest generation
   that decrypts (`recovered: true` when it fell back); a save from a recovered
   session supersedes newer undecryptable generations instead of conflicting forever.

4. **Form definitions are data, not code.** No custom JS, remote scripts, webhooks,
   or expression strings — declarative conditional objects only. All pack JSON
   (bundled or imported) is untrusted input; `validatePack` is the single gate.

5. **Field-level user data is never silently dropped.** Definition changes that
   orphan a value (field removed/retyped, cardinality reduced, group removed) turn
   it into an **archived answer** with its original label and a reason. The same
   law extends to attachments: ciphertext files are deleted only *after* the save
   that drops their reference commits (`domain/attachmentRefs.ts`); never-committed
   files are cleaned by the unlock-time orphan sweep.

6. **Migrations are pure, deterministic, idempotent.** They run in memory at load
   (migrate-on-read); results persist only through the normal save path. Records
   stamped newer than the app's range refuse read-write with a specific error.

7. **Protected system keys stay stable** unless all dependent save/status/recovery
   mappings migrate in the same change. Protected fields cannot be removed and
   `readinessRule.requiredKeys` may only reference protected fields.

8. **The bundled pack ships read-only to end users.** The standalone Pack Editor
   (`npm run pack-editor`) is a separate dev app, never part of the shipped bundle.
   `write_default_pack` is compiled in but inert in production — it writes to the
   compile-time `CARGO_MANIFEST_DIR` source path, which is absent on an install, so
   it cannot mutate the shipped resource. The in-app Form Editor is a shipped user
   feature that edits only the user's own `customPack`, never the bundled pack.

## Data flows

### Unlock → load pipeline (Dashboard)

```
loadVaultSnapshot (Rust: newest decryptable generation)
  → normalizeSnapshot(raw, ownerNameHint, formModeHint)   # once per load; migrates
                                                          #   legacy formMode -> moduleSelections
  → resolveBasePack(parsed)        # base = customPack ?? bundled base pack, then
      composePack(base, base.modules, profile.moduleSelections)  # module options add/remove
                                                                 #   fields & sections
  → buildLoadedVault:
      mergePackWithOverlay         # composed pack + UserOverlay -> ResolvedSection[]
      applyKeyRenames              # values follow renamed colliding custom fields
      migrateVaultValues           # stepwise schemaVersion migrations (in memory)
      reconcileSectionValues       # orphaned values -> archived answers
  → take draft stash FIRST (corrupt stashes surface, never vanish)
  → orphan sweep with saved-value ids + draft-referenced ids
```

The sweep must run *after* the draft restore: a file attached but never saved
before locking is referenced only by the draft.

### Save pipeline

`persist()` in Dashboard is the single CAS save path: assemble snapshot →
`save_vault_snapshot(base_generation)` → on success, delete attachment files the
previous saved values referenced but the new ones don't (`droppedAttachmentIds`),
adopt the new generation, purge the draft stash. `SnapshotConflict` surfaces a
per-section conflict flow (save again onto fresh data / discard). Everything that
commits a snapshot — section saves, N/A, mark-reviewed, Kit save, pack save, mode
switch — goes through `persist` so the lock flow can await the in-flight save.

### Lock flow

In-flight save completes → dirty working values stashed encrypted
(`stash_draft`, AAD-bound to vault id + loaded generation) → `lock_vault` drops
(zeroizes) the data key. Auto-lock fires after 15 minutes of inactivity
(`routes/lockPolicy.ts`).

### Snapshot shape

Defined once, in [snapshot.ts](../apps/desktop/src/domain/snapshot.ts):
`snapshotFormat`, `schemaVersion`, `profile` (`ownerName`, `reviewCadenceMonths`,
`moduleSelections`, legacy `formMode`, advisory `basePackId`), `values`, `sectionMeta`,
optional `overlay`, `kitMeta`, `customPack`, plus preserved unknown fields.
`moduleSelections` (one option id per `FormModule`) is the privacy posture, migrated
from a legacy `formMode` on read when absent. `basePackId` is re-stamped from the
loaded pack on every save so a future multi-template registry can key off it without a
snapshot migration (template family = `basePackId`, posture = `moduleSelections`).

## Form pack system

### One base pack, composable modules

The app ships a **single base pack** (`default-pack.json`). Optional feature fields
and whole sections are declared on it as **`FormModule`s** — each an onboarding
question with mutually-exclusive options that add/remove fields and sections. At load,
`composePack(base, base.modules, profile.moduleSelections)` resolves the base plus the
chosen option per module into one concrete pack. `moduleSelections` is the privacy
posture: e.g. the `secrets` module's `on` option adds the credential fields (`addFields`
/ `kitAdditions`), `off` keeps the vault locations-only.

`profile.formMode` (`hint` | `credential`) is retained only as a **legacy** posture; on
read, an absent `moduleSelections` is migrated from it (`credential` → `secrets: on`,
otherwise `off`). The setup screen and the mode switch still present the secrets posture
as a choice; switching clears `customPack` (with a confirmation warning) and relies on
reconcile to archive orphaned values. Legacy `customPack`s predate modules
(`base.modules` undefined), so `composePack` is a no-op for them — they already baked in
their mode's fields.

### Editing surfaces

- **In-app Form Editor** (runtime sidebar toggle): edits the *user's* pack, stored
  as `customPack` inside their encrypted snapshot. Master-detail UI
  (`FieldList` + `FieldPropertyPanel`); saves run `deriveAutoMigration` (breaking
  edits emit migration ops + schemaVersion bump) and go through the normal
  validated CAS save.
- **Pack editor** (`npm run pack-editor`): dev-only Vite app editing the *bundled*
  base pack and its modules. See below.
- **Structure-only export/import** (`creator/packExport.ts`): packs contain
  structure only — never personal field values, never `custom.*` overlay keys.

### Validation and safety rails

`validatePack` rejects packs whose `kitMapping.entries[].fields` or
`readinessRule.requiredKeys` reference unknown systemKeys; `removeField` in
`packEdits.ts` prunes both alongside the field so deletes stay saveable.
`FieldList` deletability: `!lockedKeys.has(systemKey) && !field.protected`; the in-app
structure editor passes no locked keys (`NO_LOCKED_KEYS`), so only protected fields are
undeletable.

## Pack editor (dev tool)

`npm run pack-editor` starts a Vite app (port 1430) for editing the bundled base pack —
its sections, fields, and `FormModule`s — through an **overlay editor**: the base form
with any mix of module options toggled into view, and one active editing target that
edits route to (base, or a specific module option). A dev-server plugin
(`pack-editor/save-plugin.mjs`) exposes:

- `GET  /__pack` — reads `default-pack.json` from disk and returns `{ pack }`.
- `POST /__pack` — writes the edited base pack (with its modules) straight back to
  `default-pack.json` (2-space JSON, trailing newline).
- `POST /__pack/backup` — copies the pack source into
  `scripts/pack-backups/<timestamp>/` (gitignored). Wired to the "Back up packs"
  button; it copies the on-disk original, never unsaved editor state.

Saving validates with the same `validatePack` gate the app uses. In dev builds the app
reads packs from the source `resources/` dir, so pack-editor saves hot-reload into
`npm run dev`.

## Rust layer notes

- **Session**: one `Mutex<VaultSession>` holds the vault path, the unwrapped data
  key (`Zeroizing`), vault id, loaded generation, and recovered flag. Commands are
  thin wrappers over testable `*_for_session` / `*_at_path` cores. Errors map to
  frozen string codes (`error.rs`) — the IPC contract.
- **Vault creation is atomic**: staged at a sibling temp path, WAL-checkpointed,
  renamed into place. Failed unlocks sleep 750 ms in the wrapper (throttle);
  wrong password and tampered KDF metadata are indistinguishable by design.
- **Attachments**: ciphertext written atomically (temp + fsync + rename) *before*
  the snapshot references it; a crash leaves a sweepable orphan, never a dangling
  reference. Sweep skips files younger than 120 s and no-ops while a restore
  marker exists. `open_attachment_external` is the only sanctioned
  plaintext-to-disk path and must stay behind explicit UI confirmation.
- **Backups**: self-contained `.lsvbackup` — fresh Argon2id params + a wrapped
  copy of the vault data key, payload AEAD-encrypted (its `version` field is
  inside the authenticated region). Restore: safety backup → marker → atomic
  swap; marker + safety backup auto-clear on the next successful unlock.
  Attachment names from a payload must be single plain path components
  (`is_safe_file_component`) — fail closed on anything else.
- **Clipboard hygiene**: `copy_vault_value` sets Windows exclusion formats
  (no Win+V history, no cloud clipboard, no monitor processing) and auto-clears
  after 45 s (clamped 1–600) only if the clipboard still holds our value.
  `navigator.clipboard.writeText` is banned for vault values.

## Testing conventions

- **Frontend**: Vitest + RTL, colocated `*.test.ts(x)`. `vaultApi` is mocked —
  Tauri `invoke` is never hit in tests. `loadDefaultPack` falls back to the
  statically imported bundled packs when invoke is unavailable, so pack-driven
  tests exercise the real definitions. Filter runs by filename:
  `npm run test -- packEdits`.
- **Rust**: integration tests in `src/tests/` with `tempfile` against real
  SQLite. Assert ciphertext (no plaintext in DB files or attachment files).
- **Form changes**: before claiming a form change complete, test both the
  definition/editor side and the entry form that should reflect it.
- The PowerShell working directory in tooling is often `apps/desktop` — run
  `npm run <script>` without `--prefix apps/desktop` there (prefixing doubles
  the path).

## Sensitive-data rules for contributors

- Never ask a user for a real master password; never request plaintext vault
  content unless they explicitly volunteer it.
- No new plaintext export paths except behind explicit user confirmation.
- Exported packs: structure only — never personal values, never `custom.*` keys.
- No cloud sync, telemetry, death detection, or remote release services without
  a new product decision.

## Release

See [docs/release/windows-packaging.md](release/windows-packaging.md) for the
build and packaging process, and [docs/testing/v2-acceptance.md](testing/v2-acceptance.md)
for the acceptance checklist.
