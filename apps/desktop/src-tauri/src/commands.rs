//! Session commands: vault create / unlock / lock / status and opaque
//! snapshot save / load.
//!
//! Pattern carried from v1: a testable `*_for_session` / `*_at_path` core
//! plus thin `#[tauri::command]` wrappers that hold the `Mutex<VaultSession>`
//! and map `VaultError` to the stable string error codes in `error.rs`.
//!
//! Invariants owned here:
//! - The snapshot is opaque `serde_json::Value` end to end — there is no
//!   mirrored Rust struct, so unknown fields can never be stripped (the v1
//!   field-stripping bug is structurally impossible).
//! - Keys never cross IPC. The session holds the unwrapped data key as
//!   `Zeroizing<[u8; KEY_LEN]>`; locking drops (and thereby zeroizes) it.
//!   The master password is wrapped in `Zeroizing<String>` at the command
//!   boundary and dropped right after the wrap/unwrap call.
//! - Vault creation is atomic: the new vault is staged at a sibling temp
//!   path and renamed into place only once fully initialized, so a crash
//!   can never leave a half-initialized vault file at the real path.
//! - A failed unlock attempt is followed by a small fixed delay (in the
//!   command wrapper only — never on success, never in the testable core).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;
use zeroize::Zeroizing;

use crate::crypto::{
    generate_data_key, unwrap_data_key, wrap_data_key, KeyDerivationMetadata, KEY_LEN,
    WRAP_FORMAT_VERSION,
};
use crate::error::{command_error_code, VaultError, VaultResult};
use crate::repository::{VaultHeader, VaultRepository};

/// Fixed delay applied after a FAILED unlock attempt (wrapper layer only).
const FAILED_UNLOCK_DELAY: std::time::Duration = std::time::Duration::from_millis(750);

/// Per-app vault session. No `Debug` derive — the session holds the raw
/// data key while unlocked.
pub struct VaultSession {
    pub vault_path: PathBuf,
    pub key: Option<Zeroizing<[u8; KEY_LEN]>>,
    pub vault_id: Option<String>,
    /// Generation the session last loaded or saved; U5's draft stash binds
    /// its AAD to this value, and the next save uses it as the CAS base.
    pub loaded_generation: u64,
    /// True when the last load fell back past an undecryptable newer
    /// generation; the next save supersedes those generations (repository
    /// CAS semantics) instead of conflicting forever.
    pub recovered: bool,
}

impl VaultSession {
    pub fn new(vault_path: PathBuf) -> Self {
        Self {
            vault_path,
            key: None,
            vault_id: None,
            loaded_generation: 0,
            recovered: false,
        }
    }

    pub fn is_unlocked(&self) -> bool {
        self.key.is_some()
    }
}

pub type SharedVaultSession = Mutex<VaultSession>;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatusResponse {
    pub unlocked: bool,
    pub vault_exists: bool,
}

/// No `Debug` derive — carries the master password.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVaultRequest {
    pub master_password: String,
    /// Accepted for the setup flow but never persisted by Rust (plaintext
    /// or otherwise) — the frontend stores it inside the first encrypted
    /// snapshot, which Rust treats as opaque.
    pub owner_name: String,
}

/// No `Debug` derive — carries the master password.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockVaultRequest {
    pub master_password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSnapshotResponse {
    pub generation: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadSnapshotResponse {
    pub snapshot: Value,
    pub generation: u64,
    pub recovered: bool,
}

// ---------------------------------------------------------------------------
// Testable core
// ---------------------------------------------------------------------------

pub fn get_status_for_session(session: &VaultSession) -> VaultStatusResponse {
    VaultStatusResponse {
        unlocked: session.is_unlocked(),
        vault_exists: vault_header_exists_at_path(&session.vault_path),
    }
}

/// Stage a brand-new vault database at `stage_path`: schema, fresh data key
/// wrapped under the Argon2id KEK, header row, WAL checkpointed so the file
/// is self-contained. Returns the data key + vault id for the new session.
///
/// Public (in-crate) so the atomicity test can simulate a crash between
/// staging and the rename in `create_vault_at_path`.
pub fn stage_vault(
    stage_path: &Path,
    master_password: &str,
) -> VaultResult<(Zeroizing<[u8; KEY_LEN]>, String)> {
    let repository = VaultRepository::create_new(stage_path)?;
    repository.initialize()?;

    let kdf = KeyDerivationMetadata::new();
    let data_key = generate_data_key();
    let wrapped_data_key = wrap_data_key(master_password, &kdf, WRAP_FORMAT_VERSION, &data_key)?;
    let vault_id = uuid::Uuid::new_v4().to_string();

    repository.create_vault_header(&VaultHeader {
        kdf,
        wrap_format_version: WRAP_FORMAT_VERSION,
        vault_id: vault_id.clone(),
        wrapped_data_key,
    })?;
    repository.checkpoint_truncate()?;
    drop(repository);

    Ok((data_key, vault_id))
}

pub fn create_vault_at_path(
    vault_path: &Path,
    session: &mut VaultSession,
    master_password: &str,
    owner_name: &str,
) -> VaultResult<VaultStatusResponse> {
    // Accepted but intentionally not persisted here (see CreateVaultRequest).
    let _ = owner_name;

    ensure_parent_dir(vault_path)?;

    if vault_path.exists() {
        let repository = VaultRepository::open_existing(vault_path)?;
        return if repository.vault_header_exists()? {
            Err(VaultError::VaultAlreadyExists)
        } else {
            Err(VaultError::CorruptVault)
        };
    }

    // Atomic creation: fully initialize at a staging path, then rename.
    let stage_path = staging_path(vault_path);
    match stage_vault(&stage_path, master_password) {
        Ok((data_key, vault_id)) => {
            if let Err(error) = std::fs::rename(&stage_path, vault_path) {
                cleanup_staging(&stage_path);
                return Err(VaultError::FileOperation(error.to_string()));
            }
            session.key = Some(data_key);
            session.vault_id = Some(vault_id);
            session.loaded_generation = 0;
            session.recovered = false;
            Ok(get_status_for_session(session))
        }
        Err(error) => {
            cleanup_staging(&stage_path);
            Err(error)
        }
    }
}

pub fn unlock_vault_at_path(
    vault_path: &Path,
    session: &mut VaultSession,
    master_password: &str,
) -> VaultResult<VaultStatusResponse> {
    lock_session_state(session);

    let repository = VaultRepository::open_existing(vault_path)?;
    let header = repository.load_vault_header().map_err(|error| match error {
        VaultError::NotFound => VaultError::VaultNotInitialized,
        error => error,
    })?;

    let data_key = unwrap_data_key(
        master_password,
        &header.kdf,
        header.wrap_format_version,
        &header.wrapped_data_key,
    )
    .map_err(|error| match error {
        // Wrong password and tampered KDF metadata / wrap version are
        // indistinguishable by design (AEAD failure): surface the
        // "wrong password — there is no reset" contract.
        VaultError::DecryptionFailed => VaultError::InvalidMasterPassword,
        error => error,
    })?;

    session.vault_path = vault_path.to_path_buf();
    session.key = Some(data_key);
    session.vault_id = Some(header.vault_id);
    session.loaded_generation = 0;
    session.recovered = false;
    Ok(get_status_for_session(session))
}

pub fn lock_session(session: &mut VaultSession) -> VaultResult<VaultStatusResponse> {
    lock_session_state(session);
    Ok(get_status_for_session(session))
}

/// Opaque snapshot save: compare-and-swap against `base_generation`.
/// Returns the new generation, which the session adopts as its base.
pub fn save_vault_snapshot_for_session(
    session: &mut VaultSession,
    snapshot: &Value,
    base_generation: u64,
) -> VaultResult<SaveSnapshotResponse> {
    if session.key.is_none() || session.vault_id.is_none() {
        return Err(VaultError::Locked);
    }
    let snapshot_json = serde_json::to_vec(snapshot).map_err(|_| VaultError::EncryptionFailed)?;

    let mut repository = VaultRepository::open_existing(&session.vault_path)?;
    let generation = {
        let key = session.key.as_ref().expect("checked above");
        let vault_id = session.vault_id.as_deref().expect("checked above");
        repository.save_snapshot(&snapshot_json, base_generation, key, vault_id)?
    };

    session.loaded_generation = generation;
    session.recovered = false;
    Ok(SaveSnapshotResponse { generation })
}

/// Opaque snapshot load: newest generation that decrypts, with a `recovered`
/// flag when older generations were fallen back to. The session records the
/// loaded generation (CAS base for the next save) and the recovered flag.
pub fn load_vault_snapshot_for_session(
    session: &mut VaultSession,
) -> VaultResult<LoadSnapshotResponse> {
    if session.key.is_none() || session.vault_id.is_none() {
        return Err(VaultError::Locked);
    }

    let repository = VaultRepository::open_existing(&session.vault_path)?;
    let load = {
        let key = session.key.as_ref().expect("checked above");
        let vault_id = session.vault_id.as_deref().expect("checked above");
        repository.load_snapshot(key, vault_id)?
    };

    let snapshot: Value =
        serde_json::from_slice(&load.snapshot_json).map_err(|_| VaultError::CorruptVault)?;

    session.loaded_generation = load.generation;
    session.recovered = load.recovered;
    Ok(LoadSnapshotResponse {
        snapshot,
        generation: load.generation,
        recovered: load.recovered,
    })
}

// ---------------------------------------------------------------------------
// Tauri command wrappers
// ---------------------------------------------------------------------------

fn lock_state<'a>(
    session: &'a State<'_, SharedVaultSession>,
) -> Result<std::sync::MutexGuard<'a, VaultSession>, String> {
    session.lock().map_err(|_| {
        command_error_code(VaultError::Storage(
            "Vault session lock is poisoned.".to_string(),
        ))
    })
}

#[tauri::command]
pub fn get_vault_status(
    session: State<'_, SharedVaultSession>,
) -> Result<VaultStatusResponse, String> {
    let session = lock_state(&session)?;
    Ok(get_status_for_session(&session))
}

#[tauri::command]
pub fn create_vault(
    request: CreateVaultRequest,
    session: State<'_, SharedVaultSession>,
) -> Result<VaultStatusResponse, String> {
    let master_password = Zeroizing::new(request.master_password);
    let owner_name = request.owner_name;
    let mut session = lock_state(&session)?;
    let vault_path = session.vault_path.clone();
    create_vault_at_path(&vault_path, &mut session, &master_password, &owner_name)
        .map_err(command_error_code)
    // `master_password` (Zeroizing) is zeroized on drop here.
}

#[tauri::command]
pub fn unlock_vault(
    request: UnlockVaultRequest,
    session: State<'_, SharedVaultSession>,
) -> Result<VaultStatusResponse, String> {
    let master_password = Zeroizing::new(request.master_password);
    let mut session = lock_state(&session)?;
    let vault_path = session.vault_path.clone();
    let result = unlock_vault_at_path(&vault_path, &mut session, &master_password);
    if result.is_err() {
        // Fixed delay after a failed attempt only — basic throttle against
        // rapid-fire password guessing through the UI/IPC.
        std::thread::sleep(FAILED_UNLOCK_DELAY);
    }
    result.map_err(command_error_code)
}

#[tauri::command]
pub fn lock_vault(session: State<'_, SharedVaultSession>) -> Result<VaultStatusResponse, String> {
    let mut session = lock_state(&session)?;
    lock_session(&mut session).map_err(command_error_code)
}

#[tauri::command]
pub fn save_vault_snapshot(
    snapshot: Value,
    base_generation: u64,
    session: State<'_, SharedVaultSession>,
) -> Result<SaveSnapshotResponse, String> {
    let mut session = lock_state(&session)?;
    save_vault_snapshot_for_session(&mut session, &snapshot, base_generation)
        .map_err(command_error_code)
}

#[tauri::command]
pub fn load_vault_snapshot(
    session: State<'_, SharedVaultSession>,
) -> Result<LoadSnapshotResponse, String> {
    let mut session = lock_state(&session)?;
    load_vault_snapshot_for_session(&mut session).map_err(command_error_code)
}

/// Encrypt-and-stash a dirty draft (U5 lock flow). The frontend calls this
/// BEFORE `lock_vault`, while the session data key still exists.
#[tauri::command]
pub fn stash_draft(
    draft: Value,
    session: State<'_, SharedVaultSession>,
) -> Result<(), String> {
    let session = lock_state(&session)?;
    crate::draft_stash::stash_draft_for_session(&session, &draft).map_err(command_error_code)
}

/// Decrypt and consume the stashed draft, surfacing corrupt / stale stashes
/// explicitly (they never silently vanish).
#[tauri::command]
pub fn take_draft(
    session: State<'_, SharedVaultSession>,
) -> Result<crate::draft_stash::TakeDraftResponse, String> {
    let session = lock_state(&session)?;
    crate::draft_stash::take_draft_for_session(&session).map_err(command_error_code)
}

/// Delete any stashed draft (explicit user discard, or post-save purge).
#[tauri::command]
pub fn discard_draft(session: State<'_, SharedVaultSession>) -> Result<(), String> {
    let session = lock_state(&session)?;
    crate::draft_stash::discard_draft_for_session(&session).map_err(command_error_code)
}

/// No `Debug` derive — carries a plaintext vault value in transit.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyVaultValueRequest {
    pub value: String,
    pub clear_after_seconds: Option<u32>,
}

/// Clipboard-hygiene copy: Windows exclusion formats + auto-clear. The only
/// sanctioned path for putting vault values on the clipboard (see
/// `clipboard.rs` module docs).
#[tauri::command]
pub fn copy_vault_value(request: CopyVaultValueRequest) -> Result<(), String> {
    crate::clipboard::copy_vault_value_with_auto_clear(
        request.value,
        request.clear_after_seconds,
    )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn lock_session_state(session: &mut VaultSession) {
    // Dropping the Zeroizing key zeroizes it.
    session.key = None;
    session.vault_id = None;
    session.loaded_generation = 0;
    session.recovered = false;
}

fn ensure_parent_dir(vault_path: &Path) -> VaultResult<()> {
    if let Some(parent) = vault_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| VaultError::FileOperation(error.to_string()))?;
    }
    Ok(())
}

fn vault_header_exists_at_path(vault_path: &Path) -> bool {
    VaultRepository::open_existing(vault_path)
        .and_then(|repository| repository.vault_header_exists())
        .unwrap_or(false)
}

/// Sibling staging path for atomic creation, e.g.
/// `vault.sqlite3.staging-<uuid>` next to the real vault file.
pub fn staging_path(vault_path: &Path) -> PathBuf {
    let mut name = vault_path.as_os_str().to_owned();
    name.push(format!(".staging-{}", uuid::Uuid::new_v4()));
    PathBuf::from(name)
}

fn cleanup_staging(stage_path: &Path) {
    for suffix in ["", "-wal", "-shm"] {
        let mut name = stage_path.as_os_str().to_owned();
        name.push(suffix);
        let _ = std::fs::remove_file(PathBuf::from(name));
    }
}
