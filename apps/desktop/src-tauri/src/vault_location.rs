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
//!
//! This module also performs relocation (`relocate`), which copies a vault's
//! data files to a new directory and then repoints. Writing the pointer is the
//! single atomic commit point: everything before it is reversible and leaves
//! the old location authoritative, and nothing after it can lose data. No step
//! may be reordered across that line.

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

fn temp_pointer_path(final_path: &Path) -> PathBuf {
    let mut name = final_path.as_os_str().to_owned();
    name.push(format!(".tmp-{}", uuid::Uuid::new_v4()));
    PathBuf::from(name)
}

/// Write the pointer atomically (temp + rename), so a crash mid-write can
/// never leave a truncated pointer behind. The temp filename embeds a fresh
/// UUID so concurrent calls (e.g. from `relocate`) never race on a shared
/// path.
pub fn write_location(config_dir: &Path, vault_dir: &Path) -> VaultResult<()> {
    fs::create_dir_all(config_dir).map_err(|e| VaultError::FileOperation(e.to_string()))?;
    let pointer = LocationPointer {
        // `to_string_lossy` can lose data for a path containing unpaired
        // UTF-16 surrogates, but JSON requires valid UTF-8 and paths handed
        // to us via a folder-picker dialog are always well-formed, so the
        // lossy conversion never actually loses anything in practice.
        vault_dir: vault_dir.to_string_lossy().into_owned(),
    };
    let bytes =
        serde_json::to_vec_pretty(&pointer).map_err(|e| VaultError::FileOperation(e.to_string()))?;

    let final_path = pointer_path(config_dir);
    let tmp_path = temp_pointer_path(&final_path);

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
/// The caller is responsible for ensuring the vault is LOCKED, and for
/// serializing concurrent invocations — two overlapping relocations of the
/// same vault are not defended against here. This function never touches key
/// material: vault files are already encrypted at rest, so relocation needs no
/// master password.
///
/// `config_dir` is where the pointer lives, which is NOT necessarily
/// `from_dir` — it is passed in rather than guessed.
///
/// Only the known vault entries are ever created or removed. The source and
/// destination DIRECTORIES themselves are deliberately never removed: the
/// source may be `config_dir` (which still holds the pointer), and either may
/// hold unrelated user files that are none of this function's business.
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
    // Neither direction of nesting is workable: a destination inside the
    // source would be copied into itself, and a source inside the destination
    // means the rollback path would be reaching across the live vault. Both
    // are user mistakes with a clear fix, so they get their own error code
    // rather than being flattened into a generic storage failure.
    if to_canon.starts_with(&from_canon) || from_canon.starts_with(&to_canon) {
        return Err(VaultError::InvalidVaultLocation);
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
    //
    // Entries may be files OR directories: the attachments safety backup is a
    // directory, so each entry is dispatched on its own kind.
    let mut entry_names: Vec<String> = vec![
        VAULT_FILE_NAME.to_string(),
        format!("{VAULT_FILE_NAME}-wal"),
        format!("{VAULT_FILE_NAME}-shm"),
    ];
    if let Some(stash_name) = crate::draft_stash::draft_stash_path(&vault_file_in(&from_canon))
        .file_name()
        .and_then(|n| n.to_str())
    {
        entry_names.push(stash_name.to_string());
    }
    for name in crate::backup::safety_backup_names() {
        entry_names.push(name.to_string());
    }
    entry_names.push("attachments".to_string());

    if let Err(error) = copy_entries(&from_canon, &to_canon, &entry_names) {
        // Pre-commit: roll the destination back so a retry is not blocked by a
        // half-copied vault.sqlite3 tripping the VaultAlreadyExists precheck.
        remove_entries(&to_canon, &entry_names);
        return Err(error);
    }

    // VERIFY before committing: the destination database must genuinely open.
    let moved_vault = vault_file_in(&to_canon);
    let opens = crate::repository::VaultRepository::open_existing(&moved_vault)
        .and_then(|repository| repository.vault_header_exists())
        .unwrap_or(false);
    if !opens {
        // Nothing is committed yet. Roll back by removing ONLY the entries this
        // call wrote: `to_canon` is a user-picked folder that may hold unrelated
        // files, so `remove_dir_all(&to_canon)` would destroy user data.
        remove_entries(&to_canon, &entry_names);
        return Err(VaultError::CorruptVault);
    }

    // COMMIT POINT.
    //
    // The pointer stores the SIMPLIFIED path, not the verbatim `\\?\` form
    // `canonicalize` produces. `\\?\` works for `fs::*`, but it is what the
    // Settings screen shows and what an "open folder" shell call receives, and
    // Explorer rejects it — `\\?\UNC\server\share` most of all. It also makes a
    // plain PathBuf comparison against a folder-picker result spuriously
    // unequal. `simplified` returns the input unchanged when the path cannot be
    // safely de-prefixed, so correctness never depends on the strip succeeding.
    write_location(config_dir, dunce::simplified(&to_canon))?;

    // Past the commit point, failures are reported, not propagated.
    Ok(remove_entries(&from_canon, &entry_names))
}

/// Copy every named entry that exists from `from_dir` into `to_dir`.
///
/// Absence is the ONLY acceptable reason to skip an entry. `exists()` and
/// `is_dir()` collapse every metadata error into `false`, which would silently
/// skip an unreadable `attachments/` — and since verification only checks that
/// the database opens, the relocate would then commit and orphan every
/// attachment at the old path while reporting success. So the kind is
/// classified explicitly and anything other than not-found is an error.
fn copy_entries(from_dir: &Path, to_dir: &Path, entry_names: &[String]) -> VaultResult<()> {
    for name in entry_names {
        let source = from_dir.join(name);
        match fs::symlink_metadata(&source) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {} // absent: fine
            Err(e) => return Err(VaultError::FileOperation(e.to_string())),
            Ok(meta) if meta.is_dir() => copy_dir_recursive(&source, &to_dir.join(name))?,
            Ok(_) => {
                fs::copy(&source, to_dir.join(name))
                    .map_err(|e| VaultError::FileOperation(e.to_string()))?;
            }
        }
    }
    Ok(())
}

/// Remove every named entry from `dir`, returning whether all of them are gone.
///
/// Never propagates: it serves both the pre-commit rollback (where the original
/// error is what matters) and the post-commit cleanup (where the move has
/// already succeeded and a leftover is a report, not a failure). A metadata
/// error is counted as NOT removed — assuming otherwise would under-report
/// leftovers to the user.
pub(crate) fn remove_entries(dir: &Path, entry_names: &[String]) -> bool {
    let mut all_removed = true;
    for name in entry_names {
        let target = dir.join(name);
        let removed = match fs::symlink_metadata(&target) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => true, // already gone
            Err(_) => false,
            Ok(meta) if meta.is_dir() => fs::remove_dir_all(&target).is_ok(),
            Ok(_) => fs::remove_file(&target).is_ok(),
        };
        if !removed {
            all_removed = false;
        }
    }
    all_removed
}

/// Recursively copy a directory. Used for `attachments/` and the attachments
/// safety backup, both flat today; recursion keeps it correct if that changes.
fn copy_dir_recursive(source: &Path, destination: &Path) -> VaultResult<()> {
    fs::create_dir_all(destination).map_err(|e| VaultError::FileOperation(e.to_string()))?;
    let entries = fs::read_dir(source).map_err(|e| VaultError::FileOperation(e.to_string()))?;
    for entry in entries {
        let entry = entry.map_err(|e| VaultError::FileOperation(e.to_string()))?;
        let path = entry.path();
        let target = destination.join(entry.file_name());
        // `file_type` does NOT follow symlinks, unlike `path().is_dir()`. That
        // matters: a directory symlink would otherwise copy its target's
        // contents (possibly from outside the vault entirely), and a symlink
        // cycle would recurse until the stack is exhausted. The vault never
        // creates links, so anything here is foreign and is skipped.
        let file_type = entry
            .file_type()
            .map_err(|e| VaultError::FileOperation(e.to_string()))?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else {
            fs::copy(&path, &target).map_err(|e| VaultError::FileOperation(e.to_string()))?;
        }
    }
    Ok(())
}
