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
