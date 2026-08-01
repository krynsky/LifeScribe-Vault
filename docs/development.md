# LifeScribe Vault — Development Documentation

Technical reference for contributors. User-facing behavior is described in
[docs/user-guide.md](user-guide.md); pack authoring is in
[docs/creator-mode.md](creator-mode.md).

> **Which documents are authoritative.** This file, [CLAUDE.md](../CLAUDE.md),
> the user guide, and the source tree describe how the app works *now*.
> Everything under [docs/plans/](plans/) and [docs/superpowers/](superpowers/) is
> a dated design record — what was decided at that time, kept for rationale.
> Several of those records describe systems that have since been removed (most
> notably the composable form-module system, deleted 2026-07-30). Read them for
> *why*, never for *what is true today*. Where they conflict with this file or
> the code, they are wrong.

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
npm run typecheck:pack-editor  # the pack editor has its own tsconfig
npm run lint:pack-editor       #   and its own eslint config
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml

npm run pack-editor            # dev-only pack editor (see "Pack editor" below)
```

All six gates must pass before a change is complete. The pack editor's two are
easy to forget — it is excluded from the main `tsconfig`/`eslint` runs because
it is a separate app that never ships.

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
      sectionValidation.ts #   per-section field validation
      attachmentRefs.ts    #   attachment-ref bookkeeping (post-commit deletion diff)
      snapshot.ts          #   THE snapshot shape; normalize/build round-trip
      draft.ts             #   draft-stash shape
      readiness.ts         #   section status + readiness summary
      recoveryKit.ts       #   pointer-based Kit derivation + staleness fingerprint
      loadDefaultPack.ts   #   bundled-pack loading seam (resource -> static fallback)
    creator/               # pack editing logic shared by app + pack editor
      packEdits.ts         #   immutable pack mutations (add/remove/update/move)
      packAutoMigrate.ts   #   derive migration ops from breaking edits
      packExport.ts        #   structure-only export/import
    forms/                 # FormRenderer + field controls + structure editor
      structure/           #   FieldList / FieldPropertyPanel / fieldOps
    routes/                # Dashboard, SectionPage, SetupScreen, LockedScreen,
                           # SettingsPage, BackupPage, RecoveryKitPage,
                           # VaultUnavailableScreen, lockPolicy
  src-tauri/src/
    commands.rs            # session commands + Tauri wrappers; Mutex<VaultSession>
    crypto.rs              # Argon2id KDF, AEAD, key wrap, AAD construction
    repository.rs          # SQLite: vault header + generation-counted snapshots
    attachments.rs         # encrypt/decrypt/delete/sweep attachment files
    vault_location.rs      # pointer file, resolve_vault_dir, relocation
    draft_stash.rs         # encrypted draft stash (lock flow)
    backup.rs              # .lsvbackup create/restore, safety backup, marker
    clipboard.rs           # Win32 clipboard hygiene (exclusion formats + auto-clear)
    pack_resources.rs      # bundled base pack read + dev write-back
    error.rs               # VaultError -> stable string error codes (IPC contract)
    tests/                 # integration tests against real SQLite (tempfile)
  src-tauri/resources/packs/
    default-pack.json      # the single bundled base pack
  scripts/pack-backups/    # gitignored, written by the pack editor backup
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

8. **Credential keys never reach the Recovery Kit.** See
   [Recovery Kit](#recovery-kit) — this one is enforced in two places on purpose.

9. **The bundled pack ships read-only to end users.** The standalone Pack Editor
   (`npm run pack-editor`) is a separate dev app, never part of the shipped bundle.
   `write_default_pack` is compiled in but inert in production — it writes to the
   compile-time `CARGO_MANIFEST_DIR` source path, which is absent on an install, so
   it cannot mutate the shipped resource. The in-app Form Editor is a shipped user
   feature that edits only the user's own `customPack`, never the bundled pack.

## Data flows

### Startup → vault location

The vault directory is not fixed. A pointer file in the app config dir names the
folder holding `vault.db` and the `attachments/` tree; `resolve_vault_dir` reads
it, falling back to the default app-data folder when absent
(`src-tauri/src/vault_location.rs`). If the pointed-at folder can't be reached —
an external drive that isn't connected — the app shows `VaultUnavailableScreen`
rather than silently starting a fresh vault at the default path.

`relocate` moves a vault between folders: copy to the destination, verify, write
the pointer (the commit point), then remove the known files from the source. It
removes only the entries it knows it created and guards against operating on an
ancestor of the destination — an earlier version used `remove_dir_all` on the
destination and destroyed unrelated user files.

### Unlock → load pipeline (Dashboard)

```
loadVaultSnapshot (Rust: newest decryptable generation)
  → normalizeSnapshot(raw, ownerNameHint)   # once per load
  → resolveBasePack(parsed)                 # customPack ?? bundled base pack
  → buildLoadedVault:
      mergePackWithOverlay      # pack + UserOverlay -> ResolvedSection[]
      applyKeyRenames           # values follow renamed colliding custom fields
      migrateVaultValues        # stepwise schemaVersion migrations (in memory)
      reconcileSectionValues    # orphaned values -> archived answers
  → take draft stash FIRST (corrupt stashes surface, never vanish)
  → orphan sweep with saved-value ids + draft-referenced ids
```

The sweep must run *after* the draft restore: a file attached but never saved
before locking is referenced only by the draft. The sweep also verifies
ownership before deleting — it decrypts each candidate against the current
vault's key and skips what doesn't belong, because attachment directories from
different vaults can interleave. Without that check, unlocking one vault deleted
another's attachments.

### Save pipeline

`persist()` in Dashboard is the single CAS save path: assemble snapshot →
`save_vault_snapshot(base_generation)` → on success, delete attachment files the
previous saved values referenced but the new ones don't (`droppedAttachmentIds`),
adopt the new generation, purge the draft stash. `SnapshotConflict` surfaces a
per-section conflict flow (save again onto fresh data / discard). Everything that
commits a snapshot — section saves, N/A, mark-reviewed, Kit save, pack save —
goes through `persist` so the lock flow can await the in-flight save.

### Lock flow

In-flight save completes → dirty working values stashed encrypted
(`stash_draft`, AAD-bound to vault id + loaded generation) → `lock_vault` drops
(zeroizes) the data key. Auto-lock fires after 15 minutes of inactivity
(`routes/lockPolicy.ts`).

Anything that locks as a side effect (moving the vault, for instance) must go
through the same path — calling the raw `lockVault` IPC skips the draft stash
and silently discards unsaved work.

### Snapshot shape

Defined once, in [snapshot.ts](../apps/desktop/src/domain/snapshot.ts):
`snapshotFormat`, `schemaVersion`, `profile` (`ownerName`, `reviewCadenceMonths`,
advisory `basePackId`), `values`, `sectionMeta`, optional `overlay`, `kitMeta`,
`customPack`, plus preserved unknown top-level fields. `basePackId` is re-stamped
from the loaded pack on every save so a future multi-template registry can key
off it without a snapshot migration.

Note the asymmetry: unknown **top-level** keys round-trip through `extra`, but
`profile` is rebuilt from a fixed field list, so unrecognized keys nested inside
it are dropped on the next save.

## Form pack system

The app ships a **single base pack** (`default-pack.json`) — a data-only
definition of sections, groups, fields, readiness rules, and Recovery Kit
mappings. It is used as authored: `resolveBasePack` returns the user's
`customPack` when they have one, otherwise the bundled pack. There is no
composition step and no build-time assembly.

Every field is either **protected** (structural — cannot be removed, may appear
in `readinessRule.requiredKeys`) or ordinary and optional. Fields that used to
be gated behind a setup question — the password-manager master password, the
device PIN, the document attachment — are now permanently present and optional.
The user simply leaves them blank if they don't want them.

> **Historical note.** Until 2026-07-30 optional fields and sections were declared
> as `FormModule`s and composed into the pack at load from `profile.moduleSelections`.
> That system is gone: no `composePack`, no `modules` array, no `moduleSelections`
> or `formMode` in the profile. Documents describing it are historical.

### Record references (`recordRef`)

A `recordRef` field stores **another section record's id** and renders as a
picker of that section's records. `domain/recordReferences.ts` owns the model.

```jsonc
{
  "systemKey": "backupDevice",
  "type": "recordRef",
  "reference": {
    "sectionKey": "devices",              // which section supplies the records
    "displayFields": [                    // how to label each one
      { "systemKey": "deviceName" },
      { "systemKey": "accountNumber", "format": "last4" }
    ],
    "separator": " — "
  }
}
```

Design rules, all enforced by `validatePack`:

- **The stored value is the record id, never the label.** Labels are recomputed
  on every render, so renaming a device updates every reference to it. Two
  records may share a display label without colliding.
- **No self-reference**, and **no `recordRef` as a display field** — labels
  compose from plain values only, so label resolution is depth-1 and cannot
  cycle.
- **Display fields must exist** in the target section.
- **No credential display fields** — see [Recovery Kit](#recovery-kit).
- `recordRef` and `options` are mutually exclusive, in both directions.

**Referential integrity.** `findRecordReferenceUsages` scans every section for
inbound references before a record is deleted; `RecordDeleteConfirmation`
**blocks** the delete and lists what points at the record, rather than
cascading or orphaning. A reference whose target disappears anyway (e.g. from an
older snapshot) is not destroyed: `resolveRecordReference` surfaces it as
`unavailableValue`, and `valueConformsToField` treats any non-empty string as
conforming so reconcile never archives it out from under the user.

**`format: "last4"` is cosmetic, not a security control.** It shortens a
displayed value to `•••• 1234` for readability in a picker. The full value
remains in the vault and still prints in full wherever it is mapped into the
Kit directly. Do not use it as masking.

### Editing surfaces

- **In-app Form Editor** (runtime sidebar toggle): edits the *user's* pack,
  stored as `customPack` inside their encrypted snapshot. Master-detail UI
  (`FieldList` + `FieldPropertyPanel`); saves run `deriveAutoMigration` (breaking
  edits emit migration ops + schemaVersion bump) and go through the normal CAS
  save.
- **Pack editor** (`npm run pack-editor`): dev-only Vite app editing the
  *bundled* base pack. See below.
- **Structure-only export/import** (`creator/packExport.ts`): packs contain
  structure only — never personal field values, never `custom.*` overlay keys.

### Validation and safety rails

`validatePack` rejects packs whose `kitMapping.entries[].fields` or
`readinessRule.requiredKeys` reference unknown systemKeys; `removeField` in
`packEdits.ts` prunes both alongside the field so deletes stay saveable.
`FieldList` deletability: `!lockedKeys.has(systemKey) && !field.protected`; the
in-app structure editor passes no locked keys (`NO_LOCKED_KEYS`), so only
protected fields are undeletable.

**Designating a section's readiness anchor is a Pack Editor UI control, not a
hand-edit.** `setFieldReadinessRequired` in `packEdits.ts` is the single toggle
behind the field panel's "Required for section readiness" checkbox — it keeps
`protected`, `required`, and membership in `readinessRule.requiredKeys` in sync
for one field, without disturbing a section's other readiness fields (Digital
Executors requires two; Platform Legacy Tools requires the identifying field of
each record). Before this existed, changing which field anchored a section's
readiness meant editing the JSON directly, which is exactly how Backups &
Storage ended up with its anchor on the wrong field after a restructure.

**`customPack` is not validated on save or on read.** `handleSavePack` persists
it directly and `resolveBasePack` returns it as-authored. Anything that must
hold for *every* pack the app renders cannot rely on `validatePack` alone.

## Recovery Kit

The Kit (`domain/recoveryKit.ts`) is a **printable** document for the user's
family. It is pointer-based: it emits only the systemKeys each section's
`kitMapping` names, and it applies **no redaction of its own** — nothing is
hidden by field name or type. What it emits is *display*, not the stored value
verbatim: a `select` field resolves to its option's **label** (an orphaned
value with no matching option falls back to printing itself, rather than
disappearing), a `file` field contributes its **filename**, not its contents or
its stored attachment id, and a `recordRef` contributes the **composed label**
of the record it points at, never the internal record id (an unresolvable
reference prints "Unavailable saved record").

### Credential exclusion, and the two routes it has to cover

Credential keys (`passwordManagerMasterPassword`, `devicePin`) may never appear
on the Kit. There are **two distinct ways a record's values reach the printed
page**, and missing either one defeats the guarantee:

1. **The section's own `kitMapping`** — `entry.fields` naming keys in the
   section being rendered.
2. **A `recordRef`'s `reference.displayFields`** — reaching *sideways* into the
   source section a reference points at, to compose that record's label. The
   `kitMapping` filter cannot see this route: the mapped key is the innocuous
   reference field, and the credential is read during label composition.

Each route is gated at both ends:

| | Authoring gate (`validatePack`) | Consumption gate |
|---|---|---|
| `kitMapping` | rejects a mapping naming a credential | `buildRecoveryKit` filters `entry.fields` |
| `displayFields` | rejects a reference displaying one | `recordReferenceLabel` filters display parts |

The consumption gates are the load-bearing half, because validation never runs
on the pack the Kit actually renders from (see above). Keep both halves: the
authoring gate gives a diagnosable error message, the consumption gate
guarantees the printed page. `computeKitFingerprint` delegates to
`buildRecoveryKit`, so it inherits the filter;
`recordReferenceSourceFields` applies the same exclusion so the authoring UI
never *offers* a credential as a display field in the first place.

**If you add a third way to compose display text from another record's values,
it needs its own gate.** That is the lesson the `recordRef` work taught: the
original exclusion was written when `kitMapping` was the only route, and the
new field type quietly opened a second one.

The exclusion matches literal systemKeys. If credential fields ever multiply, or
if the editor gains the ability to rename or duplicate a field into a kit
mapping, replace it with a flag on the field definition.

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
  reference. Sweep skips files younger than 120 s, no-ops while a restore marker
  exists, and verifies vault ownership before deleting.
  `open_attachment_external` is the only sanctioned plaintext-to-disk path and
  must stay behind explicit UI confirmation; it decrypts into a session-owned
  temp dir that is purged on lock, because the OS launcher returns before the
  external app has necessarily read the file.
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

## Pack editor (dev tool)

For the end-to-end workflow — branch, back up, edit, migrations, gates, ship —
see [docs/creator-mode.md](creator-mode.md). What follows is the mechanism.

`npm run pack-editor` starts a Vite app (port 1430) for editing the bundled base
pack — its sections, groups, and fields. A left rail lists sections (drag to
reorder, click to select, rename inline); the right pane edits the selected
field, or the section itself when no field is selected. **Design**, **Preview**,
and **JSON** tabs show the working pack.

A dev-server plugin (`pack-editor/save-plugin.mjs`) exposes:

- `GET  /__pack` — reads `default-pack.json` from disk and returns `{ pack }`.
- `POST /__pack` — writes the edited pack straight back to `default-pack.json`
  (2-space JSON, trailing newline).
- `POST /__pack/backup` — copies the pack source into
  `scripts/pack-backups/<timestamp>/` (gitignored). Wired to the "Back up packs"
  button; it copies the on-disk original, never unsaved editor state.

Saving validates with the same `validatePack` gate the app uses. In dev builds
the app reads packs from the source `resources/` dir, so pack-editor saves
hot-reload into `npm run dev`.

The editor calls `creator/packEdits` and `forms/structure/fieldOps` directly.
An earlier indirection layer (`editorView` / `editorEdits`) that routed edits to
a base pack or a module option was deleted with the module system.

## Testing conventions

- **Frontend**: Vitest + RTL, colocated `*.test.ts(x)`. `vaultApi` is mocked —
  Tauri `invoke` is never hit in tests. `loadDefaultPack` falls back to the
  statically imported bundled pack when invoke is unavailable, so pack-driven
  tests exercise the real definitions. Filter runs by filename:
  `npm run test -- packEdits`.
- **Rust**: integration tests in `src/tests/` with `tempfile` against real
  SQLite. Assert ciphertext (no plaintext in DB files or attachment files).
- **Form changes**: before claiming a form change complete, test both the
  definition/editor side and the entry form that should reflect it.
- **Safety properties get mutation-tested.** A test that asserts a guard is
  worthless if it passes with the guard removed. Disable the guard, confirm
  exactly the intended test fails, restore. This caught a Recovery Kit test that
  only ever exercised an already-compliant pack.
- Restore any spy on a global (`getBoundingClientRect`, timers) — an unrestored
  spy in one test file poisons every file that runs after it.
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

## Known gaps

Real, deliberately unfixed, and worth knowing before you touch nearby code:

- `customPack` is validated at neither save nor read.
- **No UI path exists to create, rename, or remove a group within a section.**
  `addGroup` in `packEdits.ts` is never called by the Pack Editor, there is no
  `removeGroup` at all, and a group's title renders as a static heading. Every
  section in the shipped pack currently has exactly one group — Platform
  Legacy Tools was the only exception, restructured to match the rest rather
  than exercising this gap — but the moment a section legitimately needs more
  than one group again, this has to be authored by hand-editing the JSON, the
  same way the readiness anchor did before it got a UI control.
- Attachments from different vaults share one directory tree, so the sweep must
  check ownership per file. A per-vault `attachments/<vault_id>/` subdirectory
  would remove the class of bug; `create_backup` also scoops both vaults' blobs.
- The repo has two vitest installs; `src/test/setup.ts` calls
  `expect.extend(matchers)` to work around it.
- `pack-editor/OverlayDesign.tsx` is a misnomer — there is no overlay. Renaming
  it is a mechanical follow-up.
- The Documents section offers three overlapping ways to reference one document
  (physical location, digital location, attachment).

## Release

See [docs/release/windows-packaging.md](release/windows-packaging.md) for the
build and packaging process, and [docs/testing/v2-acceptance.md](testing/v2-acceptance.md)
for the acceptance checklist.
