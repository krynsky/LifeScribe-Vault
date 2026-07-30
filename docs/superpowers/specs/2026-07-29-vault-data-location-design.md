# Choosing and changing the vault data location — design

**Date:** 2026-07-29
**Status:** Approved (brainstorm)

## Problem

The vault's on-disk location is fixed at startup and cannot be changed:

```rust
// lib.rs
let app_data_dir = app.path().app_data_dir()?;
let vault_path = app_data_dir.join("vault.sqlite3");
```

Users cannot put the vault on an external drive, a synced folder they control,
or any volume other than the OS app-data directory. The only way to move a
vault today is backup → reinstall → restore.

The codebase is already shaped for this change: every artifact derives from
`session.vault_path`, so the entire footprint follows one variable.

| Artifact | Derived by |
|---|---|
| `vault.sqlite3` | `session.vault_path` |
| `attachments/` | `attachment_dir(vault_path)` — `attachments.rs` |
| draft stash | `draft_stash_path(vault_path)` — `draft_stash.rs` |
| restore marker, safety backups | `vault_path.parent()` — `backup.rs` |

## Goals

1. Onboarding lets the user choose where vault data is stored, defaulting to
   the current OS app-data directory.
2. Settings shows the current location and can move the vault to a new one.
3. A vault whose folder is unreachable at startup produces an explicit,
   recoverable screen — never a silent fallback that reads as data loss.
4. Choosing a folder that already holds a vault opens it rather than
   overwriting it.

## Non-goals (separate specs)

- Multiple vaults / a vault switcher. One vault per installation, as today.
- Syncing, or any awareness of cloud-backed folders beyond treating them as
  ordinary directories.
- Changing the backup/restore feature. It remains the supported path for
  copying a vault to a different machine.
- Per-artifact locations (e.g. attachments elsewhere than the database).

## Approach

### Two directories, named apart

`app_data_dir` currently plays two roles at once. The design separates them:

- **`config_dir`** — the OS app-data directory. Never moves. Holds exactly one
  new file, `vault-location.json`.
- **`vault_dir`** — holds the database, attachments, draft stash, restore
  marker and safety backups. Defaults to `config_dir`; relocatable.

The location pointer cannot live inside the vault — it is needed to find the
vault. It also cannot live in the vault directory for the same reason. Hence a
single small file in `config_dir`.

### Persistence: a pointer file

`config_dir/vault-location.json`, written atomically (temp + rename, mirroring
`write_atomically` in `attachments.rs`):

```json
{ "vaultDir": "D:\\Vaults\\LifeScribe" }
```

Absent or unparseable → fall back to `config_dir`. A corrupt pointer must never
panic; it degrades to the default exactly as an absent one does.

Rejected alternatives: `tauri-plugin-store` (a dependency and an async file
format to persist one string) and the Windows registry (platform-specific,
invisible to the user, awkward to test).

### Relocation: direct ciphertext copy

Vault files are already encrypted at rest, so moving them needs no key. This
yields two properties worth stating explicitly:

- Relocation never involves the master password, consistent with the
  CLAUDE.md rule against asking for it.
- Relocation operates on a **locked** vault.

Rejected alternative: reusing `create_backup` + `restore_backup`. Backups are
password-encrypted, so it would force a password prompt for what is a file
operation, re-encrypt everything needlessly, and route a routine action through
the restore path (which plants safety-backup markers).

`fs::rename` is unusable — it fails across volumes, and external drives are the
motivating case. Copy-then-delete throughout.

## Components

### New: `src-tauri/src/vault_location.rs`

The only module that knows the pointer exists.

| Function | Behavior |
|---|---|
| `pointer_path(config_dir)` | `config_dir/vault-location.json` |
| `read_location(config_dir)` | `Option<PathBuf>`; `None` when absent **or** unparseable |
| `write_location(config_dir, dir)` | atomic write |
| `resolve_vault_dir(config_dir)` | `read_location(..).unwrap_or(config_dir)` |
| `vault_file_in(dir)` | `dir/vault.sqlite3` |
| `relocate(from_dir, to_dir)` | copy → verify → commit → delete (below) |

### Changed: `VaultSession`

Gains `config_dir: PathBuf` so commands can reach the pointer.

### Changed: startup (`lib.rs`)

```rust
let config_dir = app.path().app_data_dir()?;
std::fs::create_dir_all(&config_dir)?;
let vault_dir = vault_location::resolve_vault_dir(&config_dir);
let vault_path = vault_location::vault_file_in(&vault_dir);
```

### New commands

Two commands, kept distinct because their risk profiles differ.

**`set_vault_location(dir) -> VaultStatusResponse`** — no data movement.
Creates `dir` if it does not exist, verifies it is writable by probing (write
then delete a temp file), writes the pointer, repoints `session.vault_path`,
and returns the usual status. **Refuses while unlocked** — satisfiable in both
call sites, since onboarding has no vault and the recovery screen precedes
unlock. Used by onboarding and by the unavailable-folder recovery screen.

Because it returns `vaultExists`, the "this folder already has a vault" branch
falls out of existing status handling rather than needing bespoke detection:
the frontend simply routes to the unlock screen.

**`relocate_vault(dir) -> RelocateResponse`** — moves data. Requires the vault
locked. Returns `{ vaultDir, originalsRemoved: bool }`.

### Changed: `VaultStatusResponse`

Gains `vaultDir: String` and `vaultDirAvailable: bool`, so the frontend can
distinguish a folder that is unreachable from one that is merely empty.

### Frontend

| File | Change |
|---|---|
| `routes/SetupScreen.tsx` | location becomes step 1; name/password shifts to step 2; modules follow |
| `routes/settings/VaultLocation.tsx` | **new** — current path + Change, sibling to `VaultOptions` |
| `routes/SettingsPage.tsx` | renders the new section |
| `routes/VaultUnavailableScreen.tsx` | **new** — recorded path, Retry, Choose folder |
| `App.tsx` | new `vault-unavailable` screen state |
| `api/vaultApi.ts` | `setVaultLocation`, `relocateVault` (the current path arrives on `VaultStatusResponse`, so no separate getter) |
| `docs/user-guide.md` | "Where your vault is stored" section |

Folder picking follows the existing pattern in `BackupPage.tsx`:
`open({ directory: true, multiple: false })` from `@tauri-apps/plugin-dialog`.
The `dialog:default` capability is already granted; no capability change.

## Data flow

### Onboarding

Location is step 1 so that existing-vault detection fires **before** the user
invests in typing and confirming a 15-character password. The wizard shows the
default path with a Change button; choosing a folder calls
`set_vault_location`. If the response reports `vaultExists`, the app switches to
the unlock screen ("A vault already exists here — unlock it instead"), which
doubles as the moved-to-a-new-computer path and makes accidental overwrite
structurally impossible.

### Settings → relocate

Settings lives inside the Dashboard, which is by definition unlocked, so the
locked-vault requirement is a real cost rather than a free constraint:

1. User picks a folder and confirms.
2. App locks the vault — the existing lock path already flushes dirty drafts.
3. `relocate_vault` runs.
4. App lands on the locked screen: "Vault moved to `<path>` — unlock to
   continue."

One password re-entry on a rare action is the accepted trade for never copying
a database with a save in flight.

### The move sequence

```
validate → copy vault.sqlite3 → copy attachments/ → copy draft stash
         → VERIFY → write pointer  ← commit point → repoint session → delete originals
```

Verification opens the copied database with `VaultRepository::open_existing`
and reads its header. Writing the pointer is the single atomic commit point:

- **Crash before it** — pointer names the old folder, originals untouched, the
  new folder holds an ignorable orphan. Retry is clean.
- **Crash after it** — data is verified present at the new location; leftover
  originals are an orphan, not a loss.

There is no window in which the pointer names a folder whose contents have not
been verified.

## Error handling

### Relocation refusals

`relocate_vault` refuses when the destination:

| Condition | Reason |
|---|---|
| equals the source | no-op success, not an error |
| is **nested inside** the source | a recursive copy that would consume itself |
| already contains a vault | that is adoption, a different operation |
| is not writable | fail before touching anything |
| `restore_in_progress(from_dir)` | a half-restored vault is not a state worth moving |

### The pointer-file trap

In the default configuration `vault_dir == config_dir`, so the source folder
*contains `vault-location.json`*. A "copy the whole directory" implementation
would drag the pointer to the destination and leave a stale one behind.

The move therefore works from an **explicit list** of vault artifacts —
`vault.sqlite3`, `attachments/`, the draft stash, and any safety-backup files —
never a directory sweep. This has a dedicated test.

### Delete failure after commit

Windows can hold files open. By this point the move is committed, so this is
not an error: `relocate_vault` returns `originalsRemoved: false` and the UI
states plainly that the originals remain at the old path and may be deleted
manually. Silently leaving a second copy of vault data behind is not acceptable.

### Unreachable folder at startup

Two cases that must not be conflated:

- Folder unreachable → `vaultDirAvailable: false` → **unavailable screen**
  showing the recorded path, with **Retry** (reconnect the drive) and
  **Choose folder** (`set_vault_location`).
- Folder present but empty → ordinary first-run setup.

Falling back silently to the default folder is explicitly rejected: the user
would land on first-run setup and reasonably conclude their vault was lost.

## Testing

### Rust (integration, `tempfile` + real SQLite, per existing convention)

- pointer write/read round-trip
- fallback to `config_dir` when the pointer is absent
- fallback when the pointer is corrupt JSON — must not panic
- relocate moves database + attachments; the result opens and a snapshot reads back
- relocate rejects: same dir, nested dir, destination holding a vault, restore in progress
- verification failure leaves the originals intact
- **the pointer file is not moved when `config_dir == from_dir`**
- moved database contains no plaintext (matching existing ciphertext assertions)

### Frontend (Vitest + RTL, `vaultApi` mocked)

- wizard step 1 shows the default path; Change opens the picker
- choosing a folder reporting `vaultExists` routes to unlock
- Settings renders the current path
- confirm → relocate → locked screen
- relocate failure keeps the user in Settings with the error
- unavailable screen renders both Retry and Choose folder
- `originalsRemoved: false` surfaces the manual-deletion notice

## Risks / notes

- **Network and removable paths.** A UNC path or unplugged drive makes the
  vault unreachable; the unavailable screen is the designed response. No
  special-casing of path types.
- **The locked-vault requirement is visible.** Relocating from Settings forces
  a re-unlock. Deliberate, and stated in the UI before the user confirms.
- **Orphan copies.** Both the crash-after-commit case and a failed delete leave
  an encrypted copy at the old path. Ciphertext without the password, but the
  UI should say so rather than leave it unmentioned.
- **`config_dir` is assumed writable.** If the OS app-data directory cannot be
  written, the pointer cannot be stored and the location cannot be changed —
  the same assumption the app already makes today.
