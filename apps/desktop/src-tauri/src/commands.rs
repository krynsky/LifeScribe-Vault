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
const MIN_MASTER_PASSWORD_LENGTH: usize = 15;

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
    /// Temp directories holding decrypted plaintext handed to an external app
    /// via `open_attachment_external`. They cannot be deleted right after
    /// launching (the reader would race the delete), so the session owns them
    /// and purges them on lock — plaintext never outlives the unlocked session.
    pub external_temp_dirs: Vec<PathBuf>,
    /// Where the location pointer lives. Distinct from the vault directory:
    /// the pointer is needed to FIND the vault, so it cannot live inside it.
    pub config_dir: PathBuf,
}

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

pub type SharedVaultSession = Mutex<VaultSession>;

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

/// No `Debug` derive — carries both the current and replacement passwords.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeVaultPasswordRequest {
    pub current_password: String,
    pub new_password: String,
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

/// Minimum length for any password that will protect a vault, counted in
/// Unicode scalar values to match the frontend's `masterPasswordLengthError`
/// (a UTF-16 `.length` would disagree on astral characters). Applied to both
/// vault creation and password changes so the two cannot drift: a vault must
/// never be creatable with a password it could not later be changed to.
fn ensure_master_password_length(password: &str) -> VaultResult<()> {
    if password.chars().count() < MIN_MASTER_PASSWORD_LENGTH {
        return Err(VaultError::InvalidNewMasterPassword);
    }
    Ok(())
}

pub fn create_vault_at_path(
    vault_path: &Path,
    session: &mut VaultSession,
    master_password: &str,
    owner_name: &str,
) -> VaultResult<VaultStatusResponse> {
    // Accepted but intentionally not persisted here (see CreateVaultRequest).
    let _ = owner_name;

    // Before any filesystem side effect: `ensure_parent_dir` creates
    // directories, and a request that cannot succeed should not leave any
    // behind.
    ensure_master_password_length(master_password)?;

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

fn load_header_and_data_key(
    repository: &VaultRepository,
    master_password: &str,
) -> VaultResult<(VaultHeader, Zeroizing<[u8; KEY_LEN]>)> {
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
        VaultError::DecryptionFailed => VaultError::InvalidMasterPassword,
        error => error,
    })?;
    Ok((header, data_key))
}

pub fn unlock_vault_at_path(
    vault_path: &Path,
    session: &mut VaultSession,
    master_password: &str,
) -> VaultResult<VaultStatusResponse> {
    lock_session_state(session);

    let repository = VaultRepository::open_existing(vault_path)?;
    // Wrong passwords and tampered wrap metadata are indistinguishable by
    // design: both become InvalidMasterPassword inside this shared path.
    let (header, data_key) = load_header_and_data_key(&repository, master_password)?;

    session.vault_path = vault_path.to_path_buf();
    session.key = Some(data_key);
    session.vault_id = Some(header.vault_id);
    session.loaded_generation = 0;
    session.recovered = false;

    // Clear any restore-in-progress marker (and auto-delete safety backup)
    // on the first successful unlock after a restore completes.
    if let Some(app_data_dir) = vault_path.parent() {
        crate::backup::clear_restore_marker(app_data_dir);
    }

    Ok(get_status_for_session(session))
}

pub fn lock_session(session: &mut VaultSession) -> VaultResult<VaultStatusResponse> {
    lock_session_state(session);
    Ok(get_status_for_session(session))
}

/// Verify the current password and atomically replace the header's key wrap.
/// Content remains encrypted under the same random data key, and the session
/// stays unlocked with that verified key after the change succeeds.
pub fn change_vault_password_at_path(
    vault_path: &Path,
    session: &mut VaultSession,
    current_password: &str,
    new_password: &str,
) -> VaultResult<()> {
    if !session.is_unlocked() {
        return Err(VaultError::Locked);
    }
    ensure_master_password_length(new_password)?;

    let repository = VaultRepository::open_existing(vault_path)?;
    let (_header, verified_data_key) =
        load_header_and_data_key(&repository, current_password)?;

    let kdf = KeyDerivationMetadata::new();
    let wrapped_data_key =
        wrap_data_key(new_password, &kdf, WRAP_FORMAT_VERSION, &verified_data_key)?;
    repository.update_key_wrap(&kdf, WRAP_FORMAT_VERSION, &wrapped_data_key)?;
    session.key = Some(verified_data_key);
    Ok(())
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
pub fn change_vault_password(
    request: ChangeVaultPasswordRequest,
    session: State<'_, SharedVaultSession>,
) -> Result<(), String> {
    let current_password = Zeroizing::new(request.current_password);
    let new_password = Zeroizing::new(request.new_password);
    let mut session = lock_state(&session)?;
    let vault_path = session.vault_path.clone();
    let result =
        change_vault_password_at_path(&vault_path, &mut session, &current_password, &new_password);
    drop(session);
    if matches!(&result, Err(VaultError::InvalidMasterPassword)) {
        std::thread::sleep(FAILED_UNLOCK_DELAY);
    }
    result.map_err(command_error_code)
}

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
        // NOTE the inversion: `VaultError::Locked` (wire code "VaultLocked")
        // is the refusal for a vault that is UNLOCKED. The variant reads as a
        // state, not as a precondition. The code is part of the frozen IPC
        // contract, so it stays as-is.
        return Err(VaultError::Locked);
    }
    std::fs::create_dir_all(dir).map_err(|e| VaultError::FileOperation(e.to_string()))?;

    // Probe writability rather than trusting the path: a read-only or
    // disconnected location must fail here, not at the first save. The UUID
    // suffix keeps a leftover probe from an interrupted call from ever
    // colliding with a later one.
    let probe = dir.join(format!(".lifescribe-write-probe-{}", uuid::Uuid::new_v4()));
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

/// Check whether `dir` is a usable relocation destination, WITHOUT moving
/// anything and without requiring a locked vault.
///
/// Lets the UI reject a bad folder (nested inside the vault folder, already
/// holding a vault, not writable, restore in progress) while the user is still
/// unlocked, instead of charging them a full password re-entry to discover a
/// one-click mistake. Shares its rules with `relocate` so the pre-flight and
/// the move can never disagree.
#[tauri::command]
pub fn check_vault_location(
    dir: String,
    session: State<'_, SharedVaultSession>,
) -> Result<(), String> {
    let session = lock_state(&session)?;
    let from_dir = session
        .vault_path
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| {
            command_error_code(VaultError::FileOperation(
                "vault path has no parent".to_string(),
            ))
        })?;
    crate::vault_location::check_destination(&from_dir, Path::new(&dir))
        .map_err(command_error_code)
}

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
        // NOTE the inversion: `VaultError::Locked` (wire code "VaultLocked")
        // is the refusal for a vault that is UNLOCKED — relocation REQUIRES a
        // locked vault. The code is part of the frozen IPC contract, so the
        // misleading variant name stays.
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
// Backup / restore commands (U9)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBackupResponse {
    /// Full path of the created .lsvbackup file (shown in success notice).
    pub output_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreBackupResponse {
    /// Path of the safety backup so the user can archive it before it
    /// is auto-deleted on the next successful unlock.
    pub safety_backup_path: String,
}

/// No `Debug` — carries the master password.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBackupRequest {
    pub master_password: String,
    /// User-chosen destination directory (from OS folder picker).
    pub dest_dir: String,
}

/// No `Debug` — carries the backup password.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreBackupRequest {
    pub backup_path: String,
    pub backup_password: String,
}

/// Create an encrypted backup of the current vault + attachments.
/// Must be called while unlocked.
#[tauri::command]
pub fn create_backup(
    request: CreateBackupRequest,
    session: State<'_, SharedVaultSession>,
) -> Result<CreateBackupResponse, String> {
    let master_password = zeroize::Zeroizing::new(request.master_password);
    let session = lock_state(&session)?;
    if session.key.is_none() {
        return Err(command_error_code(VaultError::Locked));
    }
    let att_dir = crate::attachments::attachment_dir(&session.vault_path);
    let result = crate::backup::create_backup(
        &session.vault_path,
        &att_dir,
        &master_password,
        std::path::Path::new(&request.dest_dir),
    )
    .map_err(command_error_code)?;

    Ok(CreateBackupResponse {
        output_path: result.output_path.to_string_lossy().into_owned(),
    })
}

/// Restore a .lsvbackup file: safety-backup, swap, clear draft stash.
/// The session should be locked before calling this.
#[tauri::command]
pub fn restore_backup(
    request: RestoreBackupRequest,
    session: State<'_, SharedVaultSession>,
) -> Result<RestoreBackupResponse, String> {
    let backup_password = zeroize::Zeroizing::new(request.backup_password);
    let session = lock_state(&session)?;
    let att_dir = crate::attachments::attachment_dir(&session.vault_path);
    let app_data_dir = session
        .vault_path
        .parent()
        .ok_or_else(|| command_error_code(VaultError::FileOperation(
            "vault path has no parent".to_string(),
        )))?
        .to_path_buf();

    let result = crate::backup::restore_backup(
        std::path::Path::new(&request.backup_path),
        &backup_password,
        &session.vault_path,
        &att_dir,
        &app_data_dir,
    )
    .map_err(command_error_code)?;

    Ok(RestoreBackupResponse {
        safety_backup_path: result.safety_backup_db.to_string_lossy().into_owned(),
    })
}

// ---------------------------------------------------------------------------
// Attachment commands (U8)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRefResponse {
    pub id: String,
    pub file_name: String,
    pub size_bytes: u64,
}

/// No `Debug` derive — source_path may contain user-identifying info.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddAttachmentRequest {
    /// File path returned by the frontend OS file picker (Tauri dialog).
    pub source_path: String,
}

/// Encrypt an attachment from a user-chosen path and return the metadata
/// (id, file name, size) for the frontend to embed in the snapshot record.
/// MUST be called BEFORE the snapshot save that references the attachment.
#[tauri::command]
pub fn add_attachment(
    request: AddAttachmentRequest,
    session: State<'_, SharedVaultSession>,
) -> Result<AttachmentRefResponse, String> {
    let session = lock_state(&session)?;
    let key = session.key.as_ref().ok_or_else(|| command_error_code(VaultError::Locked))?;
    let vault_id = session
        .vault_id
        .as_deref()
        .ok_or_else(|| command_error_code(VaultError::Locked))?;

    let att_dir = crate::attachments::attachment_dir(&session.vault_path);
    let source = std::path::Path::new(&request.source_path);
    let meta =
        crate::attachments::encrypt_attachment(source, &att_dir, key, vault_id)
            .map_err(command_error_code)?;

    Ok(AttachmentRefResponse {
        id: meta.id,
        file_name: meta.file_name,
        size_bytes: meta.size_bytes,
    })
}

/// Delete the ciphertext file for an attachment. The caller must also remove
/// the ref from the snapshot record and save.
#[tauri::command]
pub fn delete_attachment(
    attachment_id: String,
    session: State<'_, SharedVaultSession>,
) -> Result<(), String> {
    let session = lock_state(&session)?;
    if session.key.is_none() {
        return Err(command_error_code(VaultError::Locked));
    }
    let att_dir = crate::attachments::attachment_dir(&session.vault_path);
    crate::attachments::delete_attachment_file(&att_dir, &attachment_id)
        .map_err(command_error_code)
}

/// Decrypt an attachment INTO MEMORY and return its plaintext bytes for the
/// in-app viewer. Plaintext never touches disk. Requires an unlocked session.
#[tauri::command]
pub fn read_attachment(
    attachment_id: String,
    session: State<'_, SharedVaultSession>,
) -> Result<Vec<u8>, String> {
    let session = lock_state(&session)?;
    let key = session.key.as_ref().ok_or_else(|| command_error_code(VaultError::Locked))?;
    let vault_id = session
        .vault_id
        .as_deref()
        .ok_or_else(|| command_error_code(VaultError::Locked))?;
    let att_dir = crate::attachments::attachment_dir(&session.vault_path);
    crate::attachments::decrypt_attachment(&att_dir, &attachment_id, key, vault_id)
        .map_err(command_error_code)
}

/// Decrypt an attachment to a temporary plaintext file and open it in the OS
/// default application. WARNING: this writes decrypted plaintext to disk — the
/// UI MUST confirm with the user before calling it.
///
/// The temp directory is retained for the rest of the unlocked session and
/// purged on lock. Deleting it here would race the external app: `open::that`
/// returns once the launcher is dispatched, NOT once the app has opened the
/// file, so an eager delete makes the reader fail with "file not found".
#[tauri::command]
pub fn open_attachment_external(
    attachment_id: String,
    file_name: String,
    session: State<'_, SharedVaultSession>,
) -> Result<(), String> {
    let mut session = lock_state(&session)?;
    let key = session.key.as_ref().ok_or_else(|| command_error_code(VaultError::Locked))?;
    let vault_id = session
        .vault_id
        .as_deref()
        .ok_or_else(|| command_error_code(VaultError::Locked))?;
    let att_dir = crate::attachments::attachment_dir(&session.vault_path);
    let path =
        crate::attachments::decrypt_to_temp(&att_dir, &attachment_id, &file_name, key, vault_id)
            .map_err(command_error_code)?;

    // Record before launching: if `open::that` fails we still own the plaintext
    // and must guarantee it is purged on lock rather than leaked.
    if let Some(parent) = path.parent() {
        session.external_temp_dirs.push(parent.to_path_buf());
    }

    match open::that(&path) {
        Ok(()) => Ok(()),
        Err(e) => {
            // No external app took the file — purge it now instead of waiting
            // for lock, since nothing is going to read it.
            if let Some(parent) = path.parent() {
                crate::attachments::purge_external_temp_dir(parent);
                session.external_temp_dirs.pop();
            }
            Err(command_error_code(VaultError::FileOperation(e.to_string())))
        }
    }
}

/// Sweep orphaned attachment files (present on disk but absent from
/// `referenced_ids`). Called once after unlock + snapshot load. Returns the
/// count of swept files. No-op while a restore marker is present.
///
/// Also sweeps stale external-open temp directories, so decrypted plaintext a
/// previous run left behind (crash or kill before its lock) does not linger.
#[tauri::command]
pub fn sweep_orphaned_attachments(
    referenced_ids: Vec<String>,
    session: State<'_, SharedVaultSession>,
) -> Result<u32, String> {
    let session = lock_state(&session)?;
    // The sweep proves ownership of each candidate by decrypting it, so it
    // needs both the session key and this vault's identity.
    let (Some(key), Some(vault_id)) = (session.key.as_ref(), session.vault_id.as_ref()) else {
        return Err(command_error_code(VaultError::Locked));
    };
    let app_data_dir = session
        .vault_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_default();
    if crate::backup::restore_in_progress(&app_data_dir) {
        return Ok(0);
    }
    crate::attachments::sweep_stale_external_temp_dirs();
    let att_dir = crate::attachments::attachment_dir(&session.vault_path);
    crate::attachments::sweep_orphaned_attachments(&att_dir, &referenced_ids, key, vault_id)
        .map_err(command_error_code)
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
    // Decrypted plaintext handed to external apps must not outlive the unlocked
    // session. Best-effort: a file the external app still holds open cannot be
    // deleted on Windows; the stale sweep on a later unlock catches it.
    for dir in session.external_temp_dirs.drain(..) {
        crate::attachments::purge_external_temp_dir(&dir);
    }
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
