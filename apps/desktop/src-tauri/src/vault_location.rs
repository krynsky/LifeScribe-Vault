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

    for name in &entry_names {
        let source = from_canon.join(name);
        if source.is_dir() {
            copy_dir_recursive(&source, &to_canon.join(name))?;
        } else if source.exists() {
            fs::copy(&source, to_canon.join(name))
                .map_err(|e| VaultError::FileOperation(e.to_string()))?;
        }
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
    for name in &entry_names {
        let source = from_canon.join(name);
        let removed = if source.is_dir() {
            fs::remove_dir_all(&source).is_ok()
        } else if source.exists() {
            fs::remove_file(&source).is_ok()
        } else {
            true
        };
        if !removed {
            originals_removed = false;
        }
    }

    Ok(originals_removed)
}

/// Recursively copy a directory. Used for `attachments/` and the attachments
/// safety backup, both flat today; recursion keeps it correct if that changes.
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
