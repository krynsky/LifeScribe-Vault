# Vault Data Location Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user choose where vault data files live during onboarding, and move them to a new folder from Settings.

**Architecture:** A pointer file in the OS app-data directory (`config_dir`) records the vault directory (`vault_dir`); startup resolves it, falling back to `config_dir`. Because every vault artifact already derives from `session.vault_path`, the whole footprint follows one variable. Relocation copies ciphertext directly — no master password, vault locked — and writing the pointer is the single atomic commit point.

**Tech Stack:** Rust (Tauri 2, rusqlite, serde, tempfile), React 19 + TypeScript (Vitest + RTL), `@tauri-apps/plugin-dialog` for the folder picker.

**Spec:** `docs/superpowers/specs/2026-07-29-vault-data-location-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src-tauri/src/vault_location.rs` | **new** — the only module that knows the pointer file exists: read/write/resolve, and `relocate` |
| `src-tauri/src/tests/vault_location_tests.rs` | **new** — integration tests for the above |
| `src-tauri/src/lib.rs` | resolve `vault_dir` at startup; register module + new commands + test module |
| `src-tauri/src/commands.rs` | `VaultSession.config_dir`; `VaultStatusResponse` fields; `set_vault_location`, `relocate_vault` |
| `src-tauri/src/backup.rs` | expose safety-backup file names for the moved set |
| `src/api/vaultApi.ts` | `setVaultLocation`, `relocateVault`, extended `VaultStatusResponse` |
| `src/routes/SetupScreen.tsx` | folder choice becomes step 1 |
| `src/routes/settings/VaultLocation.tsx` | **new** — current path + Change, sibling to `VaultOptions` |
| `src/routes/SettingsPage.tsx` | render the new section |
| `src/routes/VaultUnavailableScreen.tsx` | **new** — Retry / Choose folder |
| `src/App.tsx` | `vault-unavailable` screen state |
| `docs/user-guide.md` | "Where your vault is stored" |

**Two conventions this plan preserves:**

1. `VaultSession::new(vault_path)` keeps its single-argument signature, deriving `config_dir` from the vault file's parent — exactly today's relationship. This avoids churning all 9 existing call sites. A second constructor `with_config_dir` is used by real startup and by location tests.
2. Rust tests live in `src/tests/` and must be registered in `lib.rs`'s `mod tests` block.

---

## Task 1: Pointer file — read, write, resolve

**Files:**
- Create: `apps/desktop/src-tauri/src/vault_location.rs`
- Create: `apps/desktop/src-tauri/src/tests/vault_location_tests.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (register both modules)

- [ ] **Step 1: Register the new modules**

In `apps/desktop/src-tauri/src/lib.rs`, add to the module list at the top (keep alphabetical order):

```rust
pub mod repository;
pub mod vault_location;
```

And inside `mod tests` at the bottom:

```rust
    #[path = "vault_location_tests.rs"]
    mod vault_location_tests;
```

- [ ] **Step 2: Write the failing tests**

Create `apps/desktop/src-tauri/src/tests/vault_location_tests.rs`:

```rust
//! Vault location pointer + relocation tests, against real files via `tempfile`.

use std::fs;

use tempfile::tempdir;

use crate::vault_location::{
    read_location, resolve_vault_dir, vault_file_in, write_location,
};

#[test]
fn resolve_falls_back_to_config_dir_when_no_pointer_exists() {
    let dir = tempdir().unwrap();
    assert_eq!(resolve_vault_dir(dir.path()), dir.path().to_path_buf());
}

#[test]
fn pointer_round_trips() {
    let config = tempdir().unwrap();
    let target = tempdir().unwrap();

    write_location(config.path(), target.path()).unwrap();

    assert_eq!(read_location(config.path()), Some(target.path().to_path_buf()));
    assert_eq!(resolve_vault_dir(config.path()), target.path().to_path_buf());
}

#[test]
fn corrupt_pointer_degrades_to_the_default_without_panicking() {
    let config = tempdir().unwrap();
    fs::write(config.path().join("vault-location.json"), b"{ this is not json").unwrap();

    assert_eq!(read_location(config.path()), None);
    assert_eq!(resolve_vault_dir(config.path()), config.path().to_path_buf());
}

#[test]
fn pointer_with_wrong_shape_degrades_to_the_default() {
    let config = tempdir().unwrap();
    // Valid JSON, missing the vaultDir key.
    fs::write(config.path().join("vault-location.json"), br#"{"other":1}"#).unwrap();

    assert_eq!(read_location(config.path()), None);
}

#[test]
fn vault_file_in_appends_the_database_name() {
    let dir = tempdir().unwrap();
    assert_eq!(vault_file_in(dir.path()), dir.path().join("vault.sqlite3"));
}
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml vault_location
```

Expected: FAIL — `unresolved import crate::vault_location` / `file not found for module`.

- [ ] **Step 4: Implement the pointer module**

Create `apps/desktop/src-tauri/src/vault_location.rs`:

```rust
//! Where the vault's data files live.
//!
//! Two directories, deliberately named apart:
//! - `config_dir` — the OS app-data directory. Never moves. Holds only the
//!   location pointer.
//! - `vault_dir` — holds the database, attachments, draft stash, restore
//!   marker and safety backups. Defaults to `config_dir`; relocatable.
//!
//! The pointer cannot live inside the vault (it is needed to find the vault),
//! so it lives in `config_dir`. A missing OR unparseable pointer degrades to
//! the default directory — never a panic, never a hard failure.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{VaultError, VaultResult};

/// The vault database file name within `vault_dir`.
pub const VAULT_FILE_NAME: &str = "vault.sqlite3";

const POINTER_FILE_NAME: &str = "vault-location.json";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocationPointer {
    vault_dir: String,
}

/// Path of the pointer file inside `config_dir`.
pub fn pointer_path(config_dir: &Path) -> PathBuf {
    config_dir.join(POINTER_FILE_NAME)
}

/// The vault database path within `vault_dir`.
pub fn vault_file_in(vault_dir: &Path) -> PathBuf {
    vault_dir.join(VAULT_FILE_NAME)
}

/// Read the recorded vault directory. `None` when the pointer is absent,
/// unreadable, or unparseable — all three degrade identically by design.
pub fn read_location(config_dir: &Path) -> Option<PathBuf> {
    let bytes = fs::read(pointer_path(config_dir)).ok()?;
    let pointer: LocationPointer = serde_json::from_slice(&bytes).ok()?;
    if pointer.vault_dir.is_empty() {
        return None;
    }
    Some(PathBuf::from(pointer.vault_dir))
}

/// Write the pointer atomically (temp + rename), so a crash mid-write can
/// never leave a truncated pointer behind.
pub fn write_location(config_dir: &Path, vault_dir: &Path) -> VaultResult<()> {
    fs::create_dir_all(config_dir).map_err(|e| VaultError::FileOperation(e.to_string()))?;
    let pointer = LocationPointer {
        vault_dir: vault_dir.to_string_lossy().into_owned(),
    };
    let bytes =
        serde_json::to_vec_pretty(&pointer).map_err(|e| VaultError::FileOperation(e.to_string()))?;

    let final_path = pointer_path(config_dir);
    let mut tmp_name = final_path.as_os_str().to_owned();
    tmp_name.push(".tmp");
    let tmp_path = PathBuf::from(tmp_name);

    fs::write(&tmp_path, &bytes).map_err(|e| VaultError::FileOperation(e.to_string()))?;
    fs::rename(&tmp_path, &final_path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        VaultError::FileOperation(e.to_string())
    })
}

/// The vault directory in effect: the pointer when usable, else `config_dir`.
pub fn resolve_vault_dir(config_dir: &Path) -> PathBuf {
    read_location(config_dir).unwrap_or_else(|| config_dir.to_path_buf())
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml vault_location
```

Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/vault_location.rs apps/desktop/src-tauri/src/tests/vault_location_tests.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(vault-location): pointer file read/write/resolve

A missing or unparseable pointer degrades to the default directory rather
than failing, so a corrupt file can never lock the user out of their vault."
```

---

## Task 2: Relocation — copy, verify, commit, delete

**Files:**
- Modify: `apps/desktop/src-tauri/src/backup.rs` (expose safety-backup names)
- Modify: `apps/desktop/src-tauri/src/vault_location.rs`
- Modify: `apps/desktop/src-tauri/src/tests/vault_location_tests.rs`

- [ ] **Step 1: Expose the safety-backup file names**

In `apps/desktop/src-tauri/src/backup.rs`, find the existing constants near line 42 (`RESTORE_MARKER_NAME`, `SAFETY_BACKUP_DB_NAME`, `SAFETY_BACKUP_ATT_NAME`) and add this function immediately after them:

```rust
/// Transient restore artifacts that live in the vault directory. Exposed so
/// relocation can carry them rather than stranding them at the old path.
pub fn safety_backup_names() -> [&'static str; 2] {
    [SAFETY_BACKUP_DB_NAME, SAFETY_BACKUP_ATT_NAME]
}
```

- [ ] **Step 2: Write the failing tests**

Append to `apps/desktop/src-tauri/src/tests/vault_location_tests.rs`. Also extend the import at the top of the file to:

```rust
use crate::vault_location::{
    read_location, relocate, resolve_vault_dir, vault_file_in, write_location,
};
```

Then append:

```rust
use crate::commands::{create_vault_at_path, VaultSession};
use crate::error::{command_error_code, VaultError};

const PASSWORD: &str = "test-master-password-relocate";

/// A real vault at `dir`, with one attachment file so the attachments
/// directory is genuinely populated.
fn seed_vault(dir: &std::path::Path) {
    let vault_path = vault_file_in(dir);
    let mut session = VaultSession::new(vault_path.clone());
    create_vault_at_path(&vault_path, &mut session, PASSWORD, "Owner").unwrap();

    let att_dir = crate::attachments::attachment_dir(&vault_path);
    fs::create_dir_all(&att_dir).unwrap();
    fs::write(att_dir.join("abc-123.bin"), b"ciphertext-blob").unwrap();
}

#[test]
fn relocate_moves_the_database_and_attachments_and_the_result_opens() {
    let from = tempdir().unwrap();
    let to = tempdir().unwrap();
    seed_vault(from.path());

    let originals_removed = relocate(from.path(), from.path(), &to.path().join("moved")).unwrap();

    let moved_dir = to.path().join("moved");
    assert!(originals_removed, "originals should be removable in a temp dir");
    assert!(vault_file_in(&moved_dir).exists(), "database must exist at the destination");
    assert!(
        moved_dir.join("attachments").join("abc-123.bin").exists(),
        "attachments must come along",
    );
    assert!(!vault_file_in(from.path()).exists(), "original database must be gone");

    // The moved database must actually open.
    let repo = crate::repository::VaultRepository::open_existing(&vault_file_in(&moved_dir)).unwrap();
    assert!(repo.vault_header_exists().unwrap());
}

#[test]
fn relocate_to_the_same_directory_is_a_no_op_success() {
    let from = tempdir().unwrap();
    seed_vault(from.path());

    assert!(relocate(from.path(), from.path(), from.path()).unwrap());
    assert!(vault_file_in(from.path()).exists(), "vault must be untouched");
}

#[test]
fn relocate_rejects_a_destination_nested_inside_the_source() {
    let from = tempdir().unwrap();
    seed_vault(from.path());

    let nested = from.path().join("inner");
    let error = relocate(from.path(), from.path(), &nested).unwrap_err();

    assert_eq!(command_error_code(error), "StorageError");
    assert!(vault_file_in(from.path()).exists(), "source must be untouched");
}

#[test]
fn relocate_rejects_a_destination_that_already_holds_a_vault() {
    let from = tempdir().unwrap();
    let to = tempdir().unwrap();
    seed_vault(from.path());
    seed_vault(to.path());

    let error = relocate(from.path(), from.path(), to.path()).unwrap_err();

    assert_eq!(command_error_code(error), "VaultAlreadyExists");
    assert!(vault_file_in(from.path()).exists(), "source must be untouched");
}

#[test]
fn relocate_refuses_while_a_restore_is_in_progress() {
    let from = tempdir().unwrap();
    let to = tempdir().unwrap();
    seed_vault(from.path());
    // The marker name is what `restore_in_progress` looks for.
    fs::write(from.path().join(".restore-in-progress"), b"{}").unwrap();

    let error = relocate(from.path(), from.path(), &to.path().join("moved")).unwrap_err();

    assert_eq!(command_error_code(error), "RestoreConflict");
    assert!(vault_file_in(from.path()).exists(), "source must be untouched");
}

#[test]
fn relocate_does_not_move_the_pointer_file_when_config_and_vault_dirs_coincide() {
    // The default configuration: vault_dir == config_dir, so the source
    // directory CONTAINS vault-location.json. Dragging it along would leave a
    // stale pointer at the destination.
    let from = tempdir().unwrap();
    let to = tempdir().unwrap();
    seed_vault(from.path());
    write_location(from.path(), from.path()).unwrap();

    relocate(from.path(), from.path(), &to.path().join("moved")).unwrap();

    assert!(
        !to.path().join("moved").join("vault-location.json").exists(),
        "the pointer must never be copied to the destination",
    );
}

#[test]
fn moved_database_still_contains_no_plaintext() {
    let from = tempdir().unwrap();
    let to = tempdir().unwrap();
    seed_vault(from.path());

    relocate(from.path(), from.path(), &to.path().join("moved")).unwrap();

    let bytes = fs::read(vault_file_in(&to.path().join("moved"))).unwrap();
    let haystack = String::from_utf8_lossy(&bytes);
    assert!(!haystack.contains(PASSWORD), "password must never appear in the file");
    assert!(!haystack.contains("Owner"), "owner name must never appear in the file");
}
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml vault_location
```

Expected: FAIL — `cannot find function relocate in ...`.

- [ ] **Step 4: Implement relocation**

Append to `apps/desktop/src-tauri/src/vault_location.rs`:

```rust
/// Move a vault's data files from `from_dir` to `to_dir`.
///
/// Sequence: validate -> copy -> VERIFY -> write pointer -> delete originals.
/// Writing the pointer is the single atomic commit point, which makes every
/// crash window safe:
/// - before it: pointer names the old folder, originals untouched, the
///   destination holds an ignorable orphan;
/// - after it: data is verified present at the destination, and leftover
///   originals are an orphan rather than a loss.
///
/// `fs::rename` is deliberately NOT used: it fails across volumes, and
/// external drives are the motivating case. Copy-then-delete throughout.
///
/// Returns whether the originals were removed. `false` is not an error — the
/// move is already committed and the caller should tell the user the old copy
/// remains.
///
/// The caller is responsible for ensuring the vault is LOCKED. This function
/// never touches key material: vault files are already encrypted at rest, so
/// relocation needs no master password.
///
/// `config_dir` is where the pointer lives, which is NOT necessarily
/// `from_dir` — it is passed in rather than guessed.
pub fn relocate(config_dir: &Path, from_dir: &Path, to_dir: &Path) -> VaultResult<bool> {
    if crate::backup::restore_in_progress(from_dir) {
        return Err(VaultError::RestoreConflict);
    }

    fs::create_dir_all(to_dir).map_err(|e| VaultError::FileOperation(e.to_string()))?;

    // Canonicalize only after both exist, so nesting/equality comparisons are
    // done on real paths rather than on lexical ones.
    let from_canon =
        fs::canonicalize(from_dir).map_err(|e| VaultError::FileOperation(e.to_string()))?;
    let to_canon =
        fs::canonicalize(to_dir).map_err(|e| VaultError::FileOperation(e.to_string()))?;

    if from_canon == to_canon {
        return Ok(true); // No-op, not an error.
    }
    if to_canon.starts_with(&from_canon) {
        return Err(VaultError::FileOperation(
            "The new folder is inside the current vault folder.".to_string(),
        ));
    }
    if vault_file_in(&to_canon).exists() {
        return Err(VaultError::VaultAlreadyExists);
    }

    // An EXPLICIT list, never a directory sweep: in the default configuration
    // `from_dir` also contains vault-location.json, and copying that would
    // leave a stale pointer at the destination.
    //
    // The -wal / -shm sidecars matter: SQLite may hold committed data in the
    // write-ahead log, so copying the database alone can silently lose writes.
    let mut file_names: Vec<String> = vec![
        VAULT_FILE_NAME.to_string(),
        format!("{VAULT_FILE_NAME}-wal"),
        format!("{VAULT_FILE_NAME}-shm"),
    ];
    if let Some(stash_name) = crate::draft_stash::draft_stash_path(&vault_file_in(&from_canon))
        .file_name()
        .and_then(|n| n.to_str())
    {
        file_names.push(stash_name.to_string());
    }
    for name in crate::backup::safety_backup_names() {
        file_names.push(name.to_string());
    }

    for name in &file_names {
        let source = from_canon.join(name);
        if source.exists() {
            fs::copy(&source, to_canon.join(name))
                .map_err(|e| VaultError::FileOperation(e.to_string()))?;
        }
    }

    let source_attachments = from_canon.join("attachments");
    if source_attachments.is_dir() {
        copy_dir_recursive(&source_attachments, &to_canon.join("attachments"))?;
    }

    // VERIFY before committing: the destination database must genuinely open.
    let moved_vault = vault_file_in(&to_canon);
    let opens = crate::repository::VaultRepository::open_existing(&moved_vault)
        .and_then(|repository| repository.vault_header_exists())
        .unwrap_or(false);
    if !opens {
        // Nothing is committed yet — leave the source untouched and clean up.
        let _ = fs::remove_dir_all(&to_canon);
        return Err(VaultError::CorruptVault);
    }

    // COMMIT POINT.
    write_location(config_dir, &to_canon)?;

    // Past the commit point, failures are reported, not propagated.
    let mut originals_removed = true;
    for name in &file_names {
        let source = from_canon.join(name);
        if source.exists() && fs::remove_file(&source).is_err() {
            originals_removed = false;
        }
    }
    if source_attachments.is_dir() && fs::remove_dir_all(&source_attachments).is_err() {
        originals_removed = false;
    }

    Ok(originals_removed)
}

/// Recursively copy a directory. Used only for `attachments/`, which is flat
/// today; recursion keeps it correct if that ever changes.
fn copy_dir_recursive(source: &Path, destination: &Path) -> VaultResult<()> {
    fs::create_dir_all(destination).map_err(|e| VaultError::FileOperation(e.to_string()))?;
    let entries = fs::read_dir(source).map_err(|e| VaultError::FileOperation(e.to_string()))?;
    for entry in entries {
        let entry = entry.map_err(|e| VaultError::FileOperation(e.to_string()))?;
        let target = destination.join(entry.file_name());
        if entry.path().is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)
                .map_err(|e| VaultError::FileOperation(e.to_string()))?;
        }
    }
    Ok(())
}
```

The tests pass `from.path()` as `config_dir`, which is the default configuration — the case `relocate_does_not_move_the_pointer_file_when_config_and_vault_dirs_coincide` exercises directly.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml vault_location
```

Expected: PASS — 12 tests.

- [ ] **Step 6: Run the whole Rust suite for regressions**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Expected: PASS — 78 existing + 12 new.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src-tauri/src/vault_location.rs apps/desktop/src-tauri/src/tests/vault_location_tests.rs apps/desktop/src-tauri/src/backup.rs
git commit -m "feat(vault-location): relocate a vault by copying ciphertext

Writing the pointer is the single atomic commit point, so no crash window
leaves the pointer naming an unverified folder. The moved set is an explicit
list, never a directory sweep -- in the default configuration the source also
contains the pointer file, and the SQLite -wal/-shm sidecars must travel with
the database or committed writes are lost."
```

---

## Task 3: Session `config_dir` and startup wiring

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands.rs:42-70`
- Modify: `apps/desktop/src-tauri/src/lib.rs:17-25`

- [ ] **Step 1: Write the failing test**

Append to `apps/desktop/src-tauri/src/tests/vault_location_tests.rs`:

```rust
#[test]
fn session_derives_config_dir_from_the_vault_parent_by_default() {
    let dir = tempdir().unwrap();
    let session = VaultSession::new(vault_file_in(dir.path()));
    assert_eq!(session.config_dir, dir.path().to_path_buf());
}

#[test]
fn session_accepts_an_explicit_config_dir_distinct_from_the_vault_dir() {
    let config = tempdir().unwrap();
    let vault = tempdir().unwrap();
    let session =
        VaultSession::with_config_dir(vault_file_in(vault.path()), config.path().to_path_buf());

    assert_eq!(session.config_dir, config.path().to_path_buf());
    assert_eq!(session.vault_path, vault_file_in(vault.path()));
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml session_derives_config_dir
```

Expected: FAIL — `no field config_dir on type VaultSession`.

- [ ] **Step 3: Add the field and second constructor**

In `apps/desktop/src-tauri/src/commands.rs`, add the field to `VaultSession` after `external_temp_dirs`:

```rust
    /// Where the location pointer lives. Distinct from the vault directory:
    /// the pointer is needed to FIND the vault, so it cannot live inside it.
    pub config_dir: PathBuf,
```

Replace `impl VaultSession`'s `new` and add `with_config_dir`:

```rust
impl VaultSession {
    /// `config_dir` defaults to the vault file's parent — the relationship
    /// that held before the location was configurable. Existing callers and
    /// tests keep working unchanged.
    pub fn new(vault_path: PathBuf) -> Self {
        let config_dir = vault_path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));
        Self::with_config_dir(vault_path, config_dir)
    }

    /// Used by real startup, where the pointer lives in the OS app-data
    /// directory and the vault may live anywhere.
    pub fn with_config_dir(vault_path: PathBuf, config_dir: PathBuf) -> Self {
        Self {
            vault_path,
            key: None,
            vault_id: None,
            loaded_generation: 0,
            recovered: false,
            external_temp_dirs: Vec::new(),
            config_dir,
        }
    }

    pub fn is_unlocked(&self) -> bool {
        self.key.is_some()
    }
}
```

- [ ] **Step 4: Resolve the vault directory at startup**

In `apps/desktop/src-tauri/src/lib.rs`, replace the body of `.setup(...)`:

```rust
        .setup(|app| {
            let config_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&config_dir)?;
            let vault_dir = vault_location::resolve_vault_dir(&config_dir);
            let vault_path = vault_location::vault_file_in(&vault_dir);
            app.manage(commands::SharedVaultSession::new(
                commands::VaultSession::with_config_dir(vault_path, config_dir),
            ));
            Ok(())
        })
```

- [ ] **Step 5: Run the full Rust suite**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Expected: PASS — all tests, including the 9 untouched `VaultSession::new` call sites.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/commands.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/tests/vault_location_tests.rs
git commit -m "feat(vault-location): resolve the vault directory at startup

VaultSession::new keeps its single-argument form, deriving config_dir from the
vault parent exactly as before, so all 9 existing call sites are untouched."
```

---

## Task 4: Status reports the vault directory and its availability

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands.rs:79-84,122-127`
- Modify: `apps/desktop/src-tauri/src/tests/vault_location_tests.rs`

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/src-tauri/src/tests/vault_location_tests.rs`:

```rust
use crate::commands::get_status_for_session;

#[test]
fn status_reports_the_vault_directory_and_marks_it_available() {
    let dir = tempdir().unwrap();
    let session = VaultSession::new(vault_file_in(dir.path()));

    let status = get_status_for_session(&session);

    assert_eq!(status.vault_dir, dir.path().to_string_lossy());
    assert!(status.vault_dir_available, "an existing directory is available");
}

#[test]
fn status_marks_a_missing_vault_directory_unavailable() {
    let dir = tempdir().unwrap();
    let missing = dir.path().join("unplugged-drive");
    let session = VaultSession::new(vault_file_in(&missing));

    let status = get_status_for_session(&session);

    assert!(!status.vault_dir_available, "a missing directory is unavailable");
    assert!(!status.vault_exists, "and it certainly holds no vault");
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml status_reports_the_vault_directory
```

Expected: FAIL — `no field vault_dir on type VaultStatusResponse`.

- [ ] **Step 3: Extend the response**

In `apps/desktop/src-tauri/src/commands.rs`, replace `VaultStatusResponse`:

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatusResponse {
    pub unlocked: bool,
    pub vault_exists: bool,
    /// The directory holding the vault's data files.
    pub vault_dir: String,
    /// False when that directory cannot be reached (unplugged drive, deleted
    /// or renamed folder). Distinguishes "unreachable" from "present but
    /// empty" — conflating them would send a user with an intact vault to
    /// first-run setup.
    pub vault_dir_available: bool,
}
```

And replace `get_status_for_session`:

```rust
pub fn get_status_for_session(session: &VaultSession) -> VaultStatusResponse {
    let vault_dir = session
        .vault_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_default();
    VaultStatusResponse {
        unlocked: session.is_unlocked(),
        vault_exists: vault_header_exists_at_path(&session.vault_path),
        vault_dir: vault_dir.to_string_lossy().into_owned(),
        vault_dir_available: vault_dir.is_dir(),
    }
}
```

- [ ] **Step 4: Run the full Rust suite**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/commands.rs apps/desktop/src-tauri/src/tests/vault_location_tests.rs
git commit -m "feat(vault-location): report vault directory and availability in status

vaultDirAvailable separates an unreachable folder from an empty one; silently
treating the former as the latter would show first-run setup to a user whose
vault is intact but whose drive is unplugged."
```

---

## Task 5: `set_vault_location` command

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands.rs` (after `lock_vault`)
- Modify: `apps/desktop/src-tauri/src/lib.rs` (register the command)
- Modify: `apps/desktop/src-tauri/src/tests/vault_location_tests.rs`

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/src-tauri/src/tests/vault_location_tests.rs`:

```rust
use crate::commands::set_vault_location_for_session;

#[test]
fn set_location_creates_the_directory_writes_the_pointer_and_repoints_the_session() {
    let config = tempdir().unwrap();
    let target_root = tempdir().unwrap();
    let target = target_root.path().join("new-home");
    let mut session =
        VaultSession::with_config_dir(vault_file_in(config.path()), config.path().to_path_buf());

    let status = set_vault_location_for_session(&mut session, &target).unwrap();

    assert!(target.is_dir(), "the directory is created when absent");
    assert_eq!(read_location(config.path()), Some(target.clone()));
    assert_eq!(session.vault_path, vault_file_in(&target));
    assert!(!status.vault_exists, "an empty folder holds no vault");
    assert!(status.vault_dir_available);
}

#[test]
fn set_location_reports_an_existing_vault_so_the_ui_can_offer_unlock() {
    let config = tempdir().unwrap();
    let target = tempdir().unwrap();
    seed_vault(target.path());
    let mut session =
        VaultSession::with_config_dir(vault_file_in(config.path()), config.path().to_path_buf());

    let status = set_vault_location_for_session(&mut session, target.path()).unwrap();

    assert!(status.vault_exists, "the caller routes to unlock on this");
    assert!(!status.unlocked);
}

#[test]
fn set_location_refuses_while_unlocked() {
    let config = tempdir().unwrap();
    let target = tempdir().unwrap();
    let vault_path = vault_file_in(config.path());
    let mut session =
        VaultSession::with_config_dir(vault_path.clone(), config.path().to_path_buf());
    create_vault_at_path(&vault_path, &mut session, PASSWORD, "Owner").unwrap();
    assert!(session.is_unlocked(), "create leaves the session unlocked");

    let error = set_vault_location_for_session(&mut session, target.path()).unwrap_err();

    assert_eq!(command_error_code(error), "VaultLocked");
    assert_eq!(session.vault_path, vault_path, "session must not be repointed");
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml set_location
```

Expected: FAIL — `cannot find function set_vault_location_for_session`.

- [ ] **Step 3: Implement the core and the command**

In `apps/desktop/src-tauri/src/commands.rs`, add after the `lock_vault` command:

```rust
/// Point the session at a different vault directory WITHOUT moving any data.
///
/// Refuses while unlocked — satisfiable at both call sites, since onboarding
/// has no vault yet and the unavailable-folder recovery screen precedes
/// unlock. The returned status carries `vault_exists`, so the caller can route
/// to the unlock screen when the chosen folder already holds a vault; that
/// makes accidental overwrite structurally impossible.
pub fn set_vault_location_for_session(
    session: &mut VaultSession,
    dir: &Path,
) -> VaultResult<VaultStatusResponse> {
    if session.is_unlocked() {
        return Err(VaultError::Locked);
    }
    std::fs::create_dir_all(dir).map_err(|e| VaultError::FileOperation(e.to_string()))?;

    // Probe writability rather than trusting the path: a read-only or
    // disconnected location must fail here, not at the first save.
    let probe = dir.join(".lifescribe-write-probe");
    std::fs::write(&probe, b"probe").map_err(|e| VaultError::FileOperation(e.to_string()))?;
    let _ = std::fs::remove_file(&probe);

    let config_dir = session.config_dir.clone();
    crate::vault_location::write_location(&config_dir, dir)?;
    session.vault_path = crate::vault_location::vault_file_in(dir);
    Ok(get_status_for_session(session))
}

#[tauri::command]
pub fn set_vault_location(
    dir: String,
    session: State<'_, SharedVaultSession>,
) -> Result<VaultStatusResponse, String> {
    let mut session = lock_state(&session)?;
    set_vault_location_for_session(&mut session, Path::new(&dir)).map_err(command_error_code)
}
```

- [ ] **Step 4: Register the command**

In `apps/desktop/src-tauri/src/lib.rs`, add to `tauri::generate_handler!` after `commands::lock_vault,`:

```rust
            commands::set_vault_location,
```

- [ ] **Step 5: Run the full Rust suite**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/commands.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/tests/vault_location_tests.rs
git commit -m "feat(vault-location): set_vault_location command

Returns the usual status, so 'this folder already holds a vault' routes to
unlock through existing status handling rather than bespoke detection."
```

---

## Task 6: `relocate_vault` command

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/tests/vault_location_tests.rs`

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/src-tauri/src/tests/vault_location_tests.rs`:

```rust
use crate::commands::relocate_vault_for_session;

#[test]
fn relocate_command_moves_the_vault_and_repoints_the_session() {
    let home = tempdir().unwrap();
    let target_root = tempdir().unwrap();
    let target = target_root.path().join("moved");
    seed_vault(home.path());
    let mut session =
        VaultSession::with_config_dir(vault_file_in(home.path()), home.path().to_path_buf());

    let response = relocate_vault_for_session(&mut session, &target).unwrap();

    assert_eq!(response.vault_dir, target.to_string_lossy());
    assert!(response.originals_removed);
    assert_eq!(session.vault_path, vault_file_in(&target));
    assert_eq!(read_location(home.path()), Some(target.clone()));
    assert!(vault_file_in(&target).exists());
}

#[test]
fn relocate_command_refuses_while_unlocked() {
    let home = tempdir().unwrap();
    let target = tempdir().unwrap();
    let vault_path = vault_file_in(home.path());
    let mut session =
        VaultSession::with_config_dir(vault_path.clone(), home.path().to_path_buf());
    create_vault_at_path(&vault_path, &mut session, PASSWORD, "Owner").unwrap();

    let error = relocate_vault_for_session(&mut session, target.path()).unwrap_err();

    assert_eq!(command_error_code(error), "VaultLocked");
    assert_eq!(session.vault_path, vault_path, "session must not be repointed");
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml relocate_command
```

Expected: FAIL — `cannot find function relocate_vault_for_session`.

- [ ] **Step 3: Implement the response type, core, and command**

In `apps/desktop/src-tauri/src/commands.rs`, add the response type next to the other response structs:

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelocateResponse {
    pub vault_dir: String,
    /// False when the old copies could not be deleted (Windows may hold files
    /// open). Not an error: the move is already committed. The UI states that
    /// the originals remain, rather than silently leaving a second copy of
    /// vault data behind.
    pub originals_removed: bool,
}
```

And add after `set_vault_location`:

```rust
/// Move the vault's data files to `dir` and repoint the session.
///
/// Requires a LOCKED vault: copying a database with a save in flight is not
/// worth the risk, and the caller (Settings) locks first. Because vault files
/// are encrypted at rest, this never needs the master password.
pub fn relocate_vault_for_session(
    session: &mut VaultSession,
    dir: &Path,
) -> VaultResult<RelocateResponse> {
    if session.is_unlocked() {
        return Err(VaultError::Locked);
    }
    let from_dir = session
        .vault_path
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| VaultError::FileOperation("vault path has no parent".to_string()))?;
    let config_dir = session.config_dir.clone();

    let originals_removed = crate::vault_location::relocate(&config_dir, &from_dir, dir)?;
    session.vault_path = crate::vault_location::vault_file_in(dir);

    Ok(RelocateResponse {
        vault_dir: dir.to_string_lossy().into_owned(),
        originals_removed,
    })
}

#[tauri::command]
pub fn relocate_vault(
    dir: String,
    session: State<'_, SharedVaultSession>,
) -> Result<RelocateResponse, String> {
    let mut session = lock_state(&session)?;
    relocate_vault_for_session(&mut session, Path::new(&dir)).map_err(command_error_code)
}
```

- [ ] **Step 4: Register the command**

In `apps/desktop/src-tauri/src/lib.rs`, add after `commands::set_vault_location,`:

```rust
            commands::relocate_vault,
```

- [ ] **Step 5: Run the full Rust suite**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/commands.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/tests/vault_location_tests.rs
git commit -m "feat(vault-location): relocate_vault command

Requires a locked vault so no save can be in flight during the copy; because
vault files are encrypted at rest, relocation never needs the master password."
```

---

## Task 7: Frontend API bindings

**Files:**
- Modify: `apps/desktop/src/api/vaultApi.ts:19-22` and end of file

- [ ] **Step 1: Extend the status type and add the two functions**

In `apps/desktop/src/api/vaultApi.ts`, replace `VaultStatusResponse`:

```ts
export interface VaultStatusResponse {
  unlocked: boolean;
  vaultExists: boolean;
  /** Directory holding the vault's data files. */
  vaultDir: string;
  /**
   * False when that directory cannot be reached (unplugged drive, deleted or
   * renamed folder). Distinguishes "unreachable" from "present but empty" —
   * the app must not send a user with an intact vault to first-run setup.
   */
  vaultDirAvailable: boolean;
}
```

Add at the end of the file:

```ts
export interface RelocateResponse {
  vaultDir: string;
  /**
   * False when the old copies could not be removed. Not a failure — the move
   * is committed — but the UI must say the originals remain.
   */
  originalsRemoved: boolean;
}

/**
 * Point the app at a different vault directory without moving data. Rejects
 * with "VaultLocked" while unlocked. The returned status carries `vaultExists`,
 * so a folder that already holds a vault routes to the unlock screen.
 */
export function setVaultLocation(dir: string): Promise<VaultStatusResponse> {
  return invoke("set_vault_location", { dir });
}

/** Move the vault's data files. Requires a locked vault. */
export function relocateVault(dir: string): Promise<RelocateResponse> {
  return invoke("relocate_vault", { dir });
}
```

- [ ] **Step 2: Typecheck to find every test fixture that must grow the new fields**

```bash
npm --prefix apps/desktop run typecheck
```

Expected: FAIL, listing each `VaultStatusResponse` literal in tests missing `vaultDir` / `vaultDirAvailable`.

- [ ] **Step 3: Fix each reported fixture**

For every location the typecheck names, add the two fields. For example, a fixture that reads:

```ts
mocked.getVaultStatus.mockResolvedValue({ unlocked: false, vaultExists: true });
```

becomes:

```ts
mocked.getVaultStatus.mockResolvedValue({
  unlocked: false,
  vaultExists: true,
  vaultDir: "C:\\Users\\test\\AppData\\Roaming\\LifeScribe",
  vaultDirAvailable: true,
});
```

- [ ] **Step 4: Verify typecheck and tests pass**

```bash
npm --prefix apps/desktop run typecheck && npm --prefix apps/desktop run test
```

Expected: typecheck clean; all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(vault-location): frontend API bindings for location and relocation"
```

---

## Task 8: Setup wizard — folder choice as step 1

**Files:**
- Modify: `apps/desktop/src/routes/SetupScreen.tsx`
- Modify: `apps/desktop/src/routes/SetupScreen.test.tsx`
- Modify: `apps/desktop/src/App.tsx`

**Step numbering changes.** Today: step 0 = name/password, steps 1..N = modules. After this task: step 0 = folder, step 1 = name/password, steps 2..N+1 = modules. So `lastStep` becomes `modules.length + 1` and `currentModule` becomes `modules[step - 2]`.

The folder step comes first so an existing vault is detected **before** the user types and confirms a 15-character password.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/src/routes/SetupScreen.test.tsx` currently mocks neither the dialog plugin nor `vaultApi`, so both must be added. Insert directly below the existing imports, and add `vaultApi` to the import list:

```tsx
import * as vaultApi from "../api/vaultApi";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../api/vaultApi", () => ({
  getVaultStatus: vi.fn(),
  setVaultLocation: vi.fn(),
}));
const mocked = vi.mocked(vaultApi);

beforeEach(() => {
  mocked.getVaultStatus.mockResolvedValue({
    unlocked: false,
    vaultExists: false,
    vaultDir: "C:\\Users\\test\\AppData\\Roaming\\LifeScribe",
    vaultDirAvailable: true,
  });
});
```

Add `beforeEach` to the `vitest` import. Note the existing password constant in this file is `PW` — the helper below uses it.

Then add:

```tsx
it("opens on the folder step showing the default location", async () => {
  render(<SetupScreen onCreate={vi.fn()} onVaultFound={vi.fn()} />);

  expect(await screen.findByText(/where your vault is stored/i)).toBeInTheDocument();
  expect(screen.getByText(/C:\\Users\\test\\AppData/)).toBeInTheDocument();
  // Name/password belong to the NEXT step.
  expect(screen.queryByLabelText("Master password")).not.toBeInTheDocument();
});

it("choosing a folder that already holds a vault hands off to unlock", async () => {
  const { open } = await import("@tauri-apps/plugin-dialog");
  vi.mocked(open).mockResolvedValue("D:\\Vaults\\Existing");
  mocked.setVaultLocation.mockResolvedValue({
    unlocked: false,
    vaultExists: true,
    vaultDir: "D:\\Vaults\\Existing",
    vaultDirAvailable: true,
  });
  const onVaultFound = vi.fn();

  render(<SetupScreen onCreate={vi.fn()} onVaultFound={onVaultFound} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /change folder/i }));

  await waitFor(() => expect(onVaultFound).toHaveBeenCalledTimes(1));
});

it("choosing an empty folder advances to name and password", async () => {
  const { open } = await import("@tauri-apps/plugin-dialog");
  vi.mocked(open).mockResolvedValue("D:\\Vaults\\Fresh");
  mocked.setVaultLocation.mockResolvedValue({
    unlocked: false,
    vaultExists: false,
    vaultDir: "D:\\Vaults\\Fresh",
    vaultDirAvailable: true,
  });

  render(<SetupScreen onCreate={vi.fn()} onVaultFound={vi.fn()} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /change folder/i }));
  await screen.findByText("D:\\Vaults\\Fresh");
  await user.click(screen.getByRole("button", { name: "Next" }));

  expect(await screen.findByLabelText("Master password")).toBeInTheDocument();
});
```

Update the existing `completeStepOne` helper to click through the new first step before filling name/password:

```tsx
async function completeStepOne(user: ReturnType<typeof userEvent.setup>) {
  // Folder step: accept the default.
  await user.click(await screen.findByRole("button", { name: "Next" }));
  // Identity step.
  await user.type(screen.getByLabelText("Your name"), "Dana");
  await user.type(screen.getByLabelText("Master password"), PW);
  await user.type(screen.getByLabelText("Confirm master password"), PW);
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Next" }));
}
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm --prefix apps/desktop run test -- SetupScreen
```

Expected: FAIL — the folder step does not render.

- [ ] **Step 3: Implement the folder step**

In `apps/desktop/src/routes/SetupScreen.tsx`, add imports:

```tsx
import { open as openFolderPicker } from "@tauri-apps/plugin-dialog";
import { getVaultStatus, setVaultLocation } from "../api/vaultApi";
```

Extend the props:

```tsx
export interface SetupScreenProps {
  onCreate: (masterPassword: string, ownerName: string, moduleSelections: Record<string, string>) => Promise<void>;
  /** The chosen folder already holds a vault — hand off to the unlock screen. */
  onVaultFound: () => void;
}
```

Add state inside the component:

```tsx
  const [vaultDir, setVaultDir] = useState("");
  const [locationError, setLocationError] = useState("");
```

Load the current default on mount:

```tsx
  useEffect(() => {
    let isCurrent = true;
    getVaultStatus()
      .then((status) => { if (isCurrent) setVaultDir(status.vaultDir); })
      .catch(() => { /* the step still renders; Change folder remains usable */ });
    return () => { isCurrent = false; };
  }, []);
```

Add the picker handler:

```tsx
  async function handleChooseFolder() {
    setLocationError("");
    const chosen = await openFolderPicker({ directory: true, multiple: false });
    if (!chosen || typeof chosen !== "string") return;
    try {
      const status = await setVaultLocation(chosen);
      setVaultDir(status.vaultDir);
      // A folder that already holds a vault is opened, never overwritten.
      if (status.vaultExists) onVaultFound();
    } catch {
      setLocationError("That folder can't be used. Pick one you can write to.");
    }
  }
```

Renumber the step machine:

```tsx
  const lastStep = modules.length + 1;
  const currentModule: FormModule | undefined = step > 1 ? modules[step - 2] : undefined;
```

Update `goNext` so validation runs on the identity step (now step 1):

```tsx
  function goNext() {
    setError("");
    if (step === 1 && !validateIdentity()) return;
    setStep((s) => Math.min(s + 1, lastStep));
  }
```

Update `handleCreate`'s guard to send the user back to the identity step:

```tsx
    if (!validateIdentity()) { setStep(1); return; }
```

Update the progress dots to `modules.length + 2` entries:

```tsx
        <ol className="setup-steps" aria-label={`Step ${step + 1} of ${modules.length + 2}`}>
          {Array.from({ length: modules.length + 2 }, (_, i) => (
            <li key={i} className={i === step ? "setup-steps__dot setup-steps__dot--current" : "setup-steps__dot"} />
          ))}
        </ol>
```

Render the folder step, and shift the identity block from `step === 0` to `step === 1`:

```tsx
        {step === 0 ? (
          <div className="vault-form">
            <h2 className="setup-location__heading">Where your vault is stored</h2>
            <p className="setup-location__lede">
              Your encrypted vault lives in this folder. The default is fine for
              most people — choose another to keep it on an external drive or a
              folder you back up yourself.
            </p>
            <p className="setup-location__path">{vaultDir || "Loading…"}</p>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void handleChooseFolder()}
            >
              Change folder
            </button>
            {locationError ? <p className="form-error" role="alert">{locationError}</p> : null}
          </div>
        ) : step === 1 ? (
```

The existing identity markup follows unchanged, and the module branch's `) : currentModule ? (` stays as it is.

Also disable the acknowledgment guard on the Create button for the new numbering — replace `step === 0 && !acknowledgedNoRecovery` with:

```tsx
              disabled={isSubmitting || Boolean(composeError)}
```

(The identity step is no longer the final step in any configuration, so the acknowledgment is already enforced by `validateIdentity` in `goNext`.)

- [ ] **Step 4: Pass the new prop from App.tsx**

In `apps/desktop/src/App.tsx`, update the setup render:

```tsx
  if (screen === "setup") {
    return <SetupScreen onCreate={handleCreate} onVaultFound={() => setScreen("locked")} />;
  }
```

- [ ] **Step 5: Add the styles**

In `apps/desktop/src/App.css`, append:

```css
/* --- Setup: vault location step -------------------------------------------- */

.setup-location__heading {
  margin: 0;
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
}

.setup-location__lede {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-ink-secondary);
  line-height: var(--leading-base);
}

.setup-location__path {
  margin: 0;
  padding: var(--space-3);
  background: var(--color-surface-sunken);
  border-radius: var(--radius-md);
  font-family: var(--font-mono, monospace);
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
}
```

- [ ] **Step 6: Run the tests**

```bash
npm --prefix apps/desktop run test -- SetupScreen
```

Expected: PASS — including the pre-existing wizard tests via the updated helper.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(onboarding): choose the vault folder as step 1

Placed before name/password so a folder that already holds a vault hands off
to unlock before the user types and confirms a 15-character password."
```

---

## Task 9: Settings — Vault location section

**Files:**
- Create: `apps/desktop/src/routes/settings/VaultLocation.tsx`
- Create: `apps/desktop/src/routes/settings/VaultLocation.test.tsx`
- Modify: `apps/desktop/src/routes/SettingsPage.tsx`
- Modify: `apps/desktop/src/routes/Dashboard.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/routes/settings/VaultLocation.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VaultLocation } from "./VaultLocation";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

describe("VaultLocation", () => {
  it("shows the current vault directory", () => {
    render(<VaultLocation vaultDir="D:\\Vaults\\Mine" onRelocate={vi.fn()} />);
    expect(screen.getByText("D:\\Vaults\\Mine")).toBeInTheDocument();
  });

  it("warns that the vault will lock, and relocates only after confirming", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValue("E:\\NewHome");
    const onRelocate = vi.fn().mockResolvedValue(undefined);

    render(<VaultLocation vaultDir="D:\\Vaults\\Mine" onRelocate={onRelocate} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /move vault/i }));

    // Confirmation states the cost before anything happens.
    expect(await screen.findByText(/will lock/i)).toBeInTheDocument();
    expect(onRelocate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^move and lock$/i }));
    expect(onRelocate).toHaveBeenCalledWith("E:\\NewHome");
  });

  it("cancelling the confirmation does not relocate", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValue("E:\\NewHome");
    const onRelocate = vi.fn();

    render(<VaultLocation vaultDir="D:\\Vaults\\Mine" onRelocate={onRelocate} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /move vault/i }));
    await user.click(await screen.findByRole("button", { name: /cancel/i }));

    expect(onRelocate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm --prefix apps/desktop run test -- VaultLocation
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the section**

Create `apps/desktop/src/routes/settings/VaultLocation.tsx`:

```tsx
import { useState } from "react";
import { open as openFolderPicker } from "@tauri-apps/plugin-dialog";

export interface VaultLocationProps {
  vaultDir: string;
  /** Locks the vault, moves the data, and lands on the locked screen. */
  onRelocate: (dir: string) => Promise<void>;
}

/**
 * Settings section showing where vault data lives, with a move action.
 *
 * Moving requires a locked vault (no save may be in flight during the copy),
 * so the confirmation states that cost up front rather than surprising the
 * user with a password prompt afterwards.
 */
export function VaultLocation({ vaultDir, onRelocate }: VaultLocationProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleChoose() {
    const chosen = await openFolderPicker({ directory: true, multiple: false });
    if (!chosen || typeof chosen !== "string") return;
    setPending(chosen);
  }

  async function handleConfirm() {
    if (!pending) return;
    setBusy(true);
    try {
      await onRelocate(pending);
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Vault location</h2>
      <p className="settings-section__lede">
        Your encrypted vault and its attachments live here.
      </p>
      <p className="setup-location__path">{vaultDir}</p>

      {pending ? (
        <div className="module-panel__confirm" role="alert">
          <p>
            Move your vault to <strong>{pending}</strong>? This will lock the
            vault, so you'll enter your master password again afterwards.
            Nothing is deleted from the old folder until the move is verified.
          </p>
          <div className="module-panel__confirm-actions">
            <button
              type="button"
              className="button button--ghost button--small"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button--primary button--small"
              disabled={busy}
              onClick={() => void handleConfirm()}
            >
              {busy ? "Moving…" : "Move and lock"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="button button--secondary"
          onClick={() => void handleChoose()}
        >
          Move vault…
        </button>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Render it in SettingsPage**

In `apps/desktop/src/routes/SettingsPage.tsx`, extend the props and render the section:

```tsx
export interface SettingsPageProps {
  selections: Record<string, string>;
  onApply: (next: Record<string, string>) => Promise<void>;
  vaultDir: string;
  onRelocate: (dir: string) => Promise<void>;
}
```

```tsx
export function SettingsPage({ selections, onApply, vaultDir, onRelocate }: SettingsPageProps) {
```

and after `<VaultOptions ... />`:

```tsx
      <VaultLocation vaultDir={vaultDir} onRelocate={onRelocate} />
```

with the import:

```tsx
import { VaultLocation } from "./settings/VaultLocation";
```

- [ ] **Step 5: Wire the Dashboard handler**

In `apps/desktop/src/routes/Dashboard.tsx`, add to the imports:

```tsx
import { getVaultStatus, lockVault, relocateVault } from "../api/vaultApi";
```

(Merge with the existing `vaultApi` import rather than duplicating it; keep any names already imported.)

Add state for the directory, loaded alongside the vault:

```tsx
  const [vaultDir, setVaultDir] = useState("");

  useEffect(() => {
    let isCurrent = true;
    getVaultStatus()
      .then((status) => { if (isCurrent) setVaultDir(status.vaultDir); })
      .catch(() => { /* Settings shows an empty path; Move vault still works */ });
    return () => { isCurrent = false; };
  }, [loadKey]);
```

Add the handler next to `applyModuleSelections`:

```tsx
  /**
   * Move the vault's data files. Relocation requires a locked vault, so this
   * locks first (the existing lock path flushes dirty drafts), then moves,
   * then leaves the user on the locked screen.
   *
   * When the old copies could not be deleted the move still succeeded, so
   * this is a notice rather than an error — but it must be said, not swallowed:
   * a second copy of vault data is left on disk.
   */
  async function handleRelocate(dir: string): Promise<void> {
    setSaveError("");
    try {
      await lockVault();
      const result = await relocateVault(dir);
      onLocked(
        result.originalsRemoved
          ? `Your vault now lives in ${result.vaultDir}.`
          : `Your vault now lives in ${result.vaultDir}. The old copies could not be removed automatically — you can delete them yourself.`,
      );
    } catch {
      setSaveError("The vault could not be moved. Nothing has been changed.");
    }
  }
```

Widen the `onLocked` prop in `DashboardProps` so the notice can travel:

```tsx
  onLocked: (notice?: string) => void;
```

Existing `onLocked()` calls elsewhere in Dashboard stay valid — the parameter is optional.

Pass both to the Settings render site:

```tsx
        <SettingsPage
          selections={loaded.vault.profile.moduleSelections}
          onApply={async (next) => { await applyModuleSelections(next); }}
          vaultDir={vaultDir}
          onRelocate={handleRelocate}
        />
```

- [ ] **Step 6: Render the notice on the locked screen**

In `apps/desktop/src/App.tsx`, hold the notice and clear it once the user unlocks:

```tsx
  const [lockNotice, setLockNotice] = useState("");
```

Update the Dashboard render site to accept it:

```tsx
  return (
    <Dashboard
      ownerNameHint={ownerNameHint}
      moduleSelectionsHint={moduleSelectionsHint}
      onLocked={(notice) => {
        setLockNotice(notice ?? "");
        setScreen("locked");
      }}
    />
  );
```

And clear it on a successful unlock, so it never outlives the move it describes:

```tsx
  async function handleUnlock(masterPassword: string) {
    const status = await unlockVault(masterPassword);
    setLockNotice("");
    setScreen(screenFromStatus(status));
  }
```

Pass it through:

```tsx
  if (screen === "locked") {
    return <LockedScreen onUnlock={handleUnlock} notice={lockNotice} />;
  }
```

In `apps/desktop/src/routes/LockedScreen.tsx`, add the optional prop to `LockedScreenProps`:

```tsx
  /** One-off message explaining why the vault locked (e.g. after a move). */
  notice?: string;
```

Accept it in the signature (`{ onUnlock, notice }`) and render it above the password field, inside the existing panel:

```tsx
        {notice ? <p className="vault-panel__lede" role="status">{notice}</p> : null}
```

- [ ] **Step 7: Test the notice**

Add to `apps/desktop/src/routes/settings/VaultLocation.test.tsx` — nothing new is needed there; instead add to `apps/desktop/src/routes/LockedScreen.test.tsx`:

```tsx
it("shows a notice explaining why the vault locked", () => {
  render(
    <LockedScreen
      onUnlock={vi.fn()}
      notice="Your vault now lives in E:\\NewHome. The old copies could not be removed automatically — you can delete them yourself."
    />,
  );

  expect(screen.getByRole("status")).toHaveTextContent(/old copies could not be removed/i);
});

it("renders no notice region when there is nothing to say", () => {
  render(<LockedScreen onUnlock={vi.fn()} />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
```

- [ ] **Step 8: Add the section styles**

In `apps/desktop/src/App.css`, append (skip any rule that already exists):

```css
.settings-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-items: flex-start;
  padding: var(--space-5) 0;
  border-top: 1px solid var(--color-border);
}

.settings-section__title {
  margin: 0;
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
}

.settings-section__lede {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-ink-secondary);
}
```

- [ ] **Step 9: Run the tests**

```bash
npm --prefix apps/desktop run test && npm --prefix apps/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(settings): vault location section with a move action

The confirmation states the re-unlock cost before the move rather than
surprising the user with a password prompt afterwards."
```

---

## Task 10: Unavailable-folder recovery screen

**Files:**
- Create: `apps/desktop/src/routes/VaultUnavailableScreen.tsx`
- Create: `apps/desktop/src/routes/VaultUnavailableScreen.test.tsx`
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/routes/VaultUnavailableScreen.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VaultUnavailableScreen } from "./VaultUnavailableScreen";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

describe("VaultUnavailableScreen", () => {
  it("names the folder it cannot reach and never suggests the vault is gone", () => {
    render(<VaultUnavailableScreen vaultDir="E:\\Vault" onRetry={vi.fn()} onRelocated={vi.fn()} />);

    expect(screen.getByText("E:\\Vault")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /choose folder/i })).toBeInTheDocument();
  });

  it("Retry re-checks status", async () => {
    const onRetry = vi.fn();
    render(<VaultUnavailableScreen vaultDir="E:\\Vault" onRetry={onRetry} onRelocated={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm --prefix apps/desktop run test -- VaultUnavailableScreen
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the screen**

Create `apps/desktop/src/routes/VaultUnavailableScreen.tsx`:

```tsx
import { useState } from "react";
import { open as openFolderPicker } from "@tauri-apps/plugin-dialog";
import { setVaultLocation } from "../api/vaultApi";

export interface VaultUnavailableScreenProps {
  vaultDir: string;
  onRetry: () => void;
  onRelocated: () => void;
}

/**
 * Shown when the recorded vault folder cannot be reached — an unplugged drive,
 * or a folder renamed or deleted outside the app.
 *
 * Deliberately NOT a silent fallback to the default folder: that would land
 * the user on first-run setup and read as total data loss when the vault is
 * in fact intact.
 */
export function VaultUnavailableScreen({ vaultDir, onRetry, onRelocated }: VaultUnavailableScreenProps) {
  const [error, setError] = useState("");

  async function handleChoose() {
    setError("");
    const chosen = await openFolderPicker({ directory: true, multiple: false });
    if (!chosen || typeof chosen !== "string") return;
    try {
      await setVaultLocation(chosen);
      onRelocated();
    } catch {
      setError("That folder can't be used. Pick one you can write to.");
    }
  }

  return (
    <main className="centered-screen">
      <section className="vault-panel" aria-labelledby="vault-unavailable-title">
        <p className="vault-panel__eyebrow">LifeScribe Vault</p>
        <h1 className="vault-panel__title" id="vault-unavailable-title">
          Your vault folder can't be reached
        </h1>
        <p className="vault-panel__lede">
          Your vault is stored here, but this location isn't available right
          now. If it's on an external drive, reconnect it and retry. Nothing
          has been changed or deleted.
        </p>
        <p className="setup-location__path">{vaultDir}</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="setup-nav">
          <button type="button" className="button button--primary" onClick={onRetry}>
            Retry
          </button>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void handleChoose()}
          >
            Choose folder…
          </button>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Wire it into App.tsx**

In `apps/desktop/src/App.tsx`:

```tsx
import { VaultUnavailableScreen } from "./routes/VaultUnavailableScreen";
```

Extend the screen union:

```tsx
type AppScreen = "loading" | "setup" | "locked" | "dashboard" | "status-error" | "vault-unavailable";
```

Add directory state:

```tsx
  const [vaultDir, setVaultDir] = useState("");
```

Route on availability — an unreachable folder takes precedence over every other state:

```tsx
function screenFromStatus(status: VaultStatusResponse): AppScreen {
  if (!status.vaultDirAvailable) {
    return "vault-unavailable";
  }
  if (status.unlocked) {
    return "dashboard";
  }
  return status.vaultExists ? "locked" : "setup";
}
```

Record the directory wherever status is read — in the mount effect and in `handleRetryStatus`:

```tsx
        const status = await getVaultStatus();
        if (isCurrent) {
          setVaultDir(status.vaultDir);
          setScreen(screenFromStatus(status));
        }
```

Render it before the `setup` branch:

```tsx
  if (screen === "vault-unavailable") {
    return (
      <VaultUnavailableScreen
        vaultDir={vaultDir}
        onRetry={() => void handleRetryStatus()}
        onRelocated={() => void handleRetryStatus()}
      />
    );
  }
```

- [ ] **Step 5: Run the full frontend suite**

```bash
npm --prefix apps/desktop run test && npm --prefix apps/desktop run typecheck && npm --prefix apps/desktop run lint
```

Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(vault-location): recovery screen for an unreachable vault folder

Takes precedence over every other status: falling back to the default folder
would show first-run setup to a user whose vault is intact but disconnected."
```

---

## Task 11: User guide

**Files:**
- Modify: `docs/user-guide.md`

- [ ] **Step 1: Add the section**

In `docs/user-guide.md`, insert after the "Backups" section and before "Changing What the Vault Stores":

```markdown
---

## Where Your Vault Is Stored

During setup you choose the folder that holds your vault. The default is a
private application folder on this computer, which is right for most people.
You might choose your own folder to keep the vault on an external drive, or in
a folder you already back up.

Whatever you choose holds everything: the encrypted vault file and all
encrypted attachments.

### Changing the folder later

**Settings → Vault location → Move vault…**

Choosing a new folder **locks the vault**, so you'll enter your master password
again afterwards. This is deliberate: it guarantees nothing is being written
while your files are copied.

The move is careful about ordering. Your files are copied to the new folder and
checked there first; only once that succeeds does the app start using the new
location and remove the old copies. If the app closes partway through, one
complete copy always remains.

If the old copies can't be removed — usually because another program has a file
open — the app tells you where they are so you can delete them yourself.

### If the folder isn't available

If your vault is on an external drive and you open the app without it
connected, you'll see "Your vault folder can't be reached", showing the folder
it's looking for. Reconnect the drive and choose **Retry**, or use **Choose
folder** if you've moved the vault yourself.

**Nothing is deleted in this state**, and the app will not create a new empty
vault behind your back.

### Moving to a new computer

Choosing a folder that already contains a LifeScribe vault opens that vault
rather than replacing it — during setup you'll be offered the unlock screen
instead. Restoring from a backup remains the recommended path for moving to a
new machine.
```

- [ ] **Step 2: Verify the surrounding structure still reads correctly**

Confirm the new section sits between "Backups" and "Changing What the Vault Stores", and that both neighbouring `---` separators are intact.

- [ ] **Step 3: Commit**

```bash
git add docs/user-guide.md
git commit -m "docs: how to choose and change where the vault is stored"
```

---

## Final Verification

- [ ] **Run everything**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
npm --prefix apps/desktop run test
npm --prefix apps/desktop run typecheck
npm --prefix apps/desktop run lint
```

Expected: all green.

- [ ] **Manual check in the running app** (`npm run dev`)

The test suite mocks `vaultApi`, so IPC wiring and the real folder picker are never exercised. These require the running app:

1. Fresh setup shows the folder step first, with the default path.
2. **Change folder** opens the OS picker and the chosen path appears.
3. Picking a folder that already holds a vault switches to the unlock screen.
4. Settings shows the current path; **Move vault…** warns about locking.
5. After a move: the locked screen appears, the new folder holds
   `vault.sqlite3` and `attachments/`, the old folder does not, and
   `vault-location.json` is in the app-data folder and names the new path.
6. Unlock and confirm the data is intact.
7. Rename the vault folder outside the app, relaunch, and confirm the
   unavailable screen appears with both actions. Rename it back and confirm
   **Retry** recovers.
