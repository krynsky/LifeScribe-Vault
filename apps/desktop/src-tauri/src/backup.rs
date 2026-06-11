//! Encrypted backup create and restore (.lsvbackup).
//!
//! Backup envelope layout (outer — JSON on disk):
//!   { "kdf": {...}, "wrapFormatVersion": N, "wrappedKey": {...}, "payload": {...} }
//!
//! - `kdf` and `wrapFormatVersion` are plaintext but bound into the key-wrap
//!   AAD — tampering them fails the wrapped-key authentication.
//! - `wrappedKey` is the vault's data key wrapped under the backup password's
//!   Argon2id KEK (fresh salt per backup, independent of the vault's own KDF
//!   params).
//! - `payload` is the encrypted backup payload (see BackupPayload). After
//!   decryption it contains a `version` field; an attacker cannot steer
//!   migration or refusal by flipping that byte on disk because it is
//!   AEAD-protected.
//!
//! Restore invariants:
//! - Safety backup copied (raw, no password) before any vault file is touched.
//! - Restore marker written before the swap begins; cleared after first
//!   successful unlock; auto-deleted with the safety backup on that unlock.
//! - Swap is atomic (temp + rename for the DB file); orphan sweep is skipped
//!   while the marker is present.
//! - A crash mid-restore leaves the original vault intact (marker points to
//!   the safety backup for rollback on next startup if needed).

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use crate::crypto::{
    content_aad, decrypt_bytes, encrypt_bytes, generate_data_key, unwrap_data_key,
    wrap_data_key, AadDomain, EncryptedBytes, KeyDerivationMetadata, WRAP_FORMAT_VERSION,
};
use crate::error::{VaultError, VaultResult};
use crate::repository::VaultRepository;

/// Maximum backup payload version this build can read.
pub const MAX_BACKUP_PAYLOAD_VERSION: u8 = 2;
const BACKUP_PAYLOAD_VERSION: u8 = 2;

// Restore marker and safety backup names within app_data_dir.
pub const RESTORE_MARKER_NAME: &str = "restore-in-progress.json";
const SAFETY_BACKUP_DB_NAME: &str = "vault-safety-backup.sqlite3";
const SAFETY_BACKUP_ATT_NAME: &str = "attachments-safety-backup";

// ---------------------------------------------------------------------------
// On-disk types
// ---------------------------------------------------------------------------

/// Outer backup envelope — serialised to disk as JSON. The `version` field
/// lives inside `payload` (AEAD-authenticated region) so it cannot be used
/// to steer migration or refusal without the authentication failing first.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEnvelope {
    pub kdf: KeyDerivationMetadata,
    pub wrap_format_version: u32,
    pub wrapped_key: EncryptedBytes,
    pub payload: EncryptedBytes,
}

/// Decrypted payload stored inside the AEAD region.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupPayload {
    /// Backup format version — AEAD-protected, cannot be tampered externally.
    version: u8,
    created_at: String,
    vault_id: String,
    /// Raw vault SQLite file bytes (base64 via serde).
    #[serde(with = "base64_bytes")]
    vault_db: Vec<u8>,
    attachments: Vec<BackupAttachment>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupAttachment {
    id: String,
    file_name: String,
    size_bytes: u64,
    /// Raw ciphertext file contents (base64 via serde).
    #[serde(with = "base64_bytes")]
    data: Vec<u8>,
}

/// Restore-in-progress marker stored in app_data_dir.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreMarker {
    pub safety_backup_db: PathBuf,
    pub safety_backup_att: PathBuf,
    pub started_at: String,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

pub struct BackupResult {
    pub output_path: PathBuf,
}

pub struct RestoreResult {
    pub safety_backup_db: PathBuf,
}

/// Create an encrypted backup at `dest_dir/{filename}.lsvbackup`.
///
/// The backup envelope is self-contained: it embeds fresh KDF params and a
/// wrapped copy of the vault's data key so the backup can be restored with
/// only the master password in effect at backup time.
pub fn create_backup(
    vault_path: &Path,
    attachment_dir: &Path,
    master_password: &str,
    dest_dir: &Path,
) -> VaultResult<BackupResult> {
    // Checkpoint WAL so the DB file is self-contained before reading bytes.
    {
        let repo =
            VaultRepository::open_existing(vault_path).map_err(|_| VaultError::NotFound)?;
        repo.checkpoint_truncate()?;
    }

    // Read raw vault DB bytes.
    let vault_db =
        fs::read(vault_path).map_err(|e| VaultError::FileOperation(e.to_string()))?;

    // Collect encrypted attachment files (already vault-encrypted).
    let attachments = collect_attachment_files(attachment_dir)?;

    // Get the vault_id from the header (embedded in payload for display).
    let vault_id = {
        let repo = VaultRepository::open_existing(vault_path)?;
        repo.load_vault_header()
            .map(|h| h.vault_id)
            .unwrap_or_default()
    };

    // Fresh backup data key + KDF params (independent of vault's own params).
    let backup_kdf = KeyDerivationMetadata::new();
    let backup_data_key = generate_data_key();

    // Wrap backup data key under a fresh KEK derived from master password.
    let wrapped_key =
        wrap_data_key(master_password, &backup_kdf, WRAP_FORMAT_VERSION, &backup_data_key)?;

    // Build and encrypt the payload.
    let created_at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| VaultError::Storage(e.to_string()))?;
    let payload = BackupPayload {
        version: BACKUP_PAYLOAD_VERSION,
        created_at: created_at.clone(),
        vault_id: vault_id.clone(),
        vault_db,
        attachments,
    };
    let payload_json = serde_json::to_vec(&payload)
        .map_err(|e| VaultError::Storage(e.to_string()))?;
    let payload_aad = backup_payload_aad();
    let encrypted_payload =
        encrypt_bytes(&payload_json, &backup_data_key, &payload_aad)?;

    let envelope = BackupEnvelope {
        kdf: backup_kdf,
        wrap_format_version: WRAP_FORMAT_VERSION,
        wrapped_key,
        payload: encrypted_payload,
    };
    let envelope_json = serde_json::to_vec(&envelope)
        .map_err(|e| VaultError::Storage(e.to_string()))?;

    // Write atomically to destination.
    fs::create_dir_all(dest_dir)
        .map_err(|e| VaultError::FileOperation(e.to_string()))?;
    let ts = created_at.replace([':', '.'], "-");
    let output_path = dest_dir.join(format!("lifescribe-vault-backup-{ts}.lsvbackup"));
    let tmp_path = dest_dir.join(format!("lifescribe-vault-backup-{ts}.tmp"));
    write_atomically(&tmp_path, &output_path, &envelope_json)?;

    Ok(BackupResult { output_path })
}

/// Restore a backup: safety-backup → marker → swap.
///
/// The vault_path and attachment_dir are the LIVE targets; app_data_dir is
/// used for the safety backup and marker.
///
/// Returns the safety backup DB path (shown in the restore-complete UI so the
/// user can archive it before it is auto-deleted on next unlock).
pub fn restore_backup(
    backup_path: &Path,
    master_password: &str,
    vault_path: &Path,
    attachment_dir: &Path,
    app_data_dir: &Path,
) -> VaultResult<RestoreResult> {
    // Guard against concurrent restores.
    let marker_path = app_data_dir.join(RESTORE_MARKER_NAME);
    if marker_path.exists() {
        return Err(VaultError::RestoreConflict);
    }

    // Read and decrypt the backup.
    let payload = read_and_decrypt_backup(backup_path, master_password)?;

    // Safety backup: copy current vault + attachments BEFORE touching anything.
    let safety_db = app_data_dir.join(SAFETY_BACKUP_DB_NAME);
    let safety_att = app_data_dir.join(SAFETY_BACKUP_ATT_NAME);
    create_safety_backup(vault_path, attachment_dir, &safety_db, &safety_att)?;

    // Write the restore marker.
    let marker = RestoreMarker {
        safety_backup_db: safety_db.clone(),
        safety_backup_att: safety_att.clone(),
        started_at: OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "unknown".to_string()),
    };
    write_marker(&marker_path, &marker)?;

    // Purge any stale draft stash (the restored vault has no relation to it).
    purge_draft_stash(vault_path);

    // Restore vault DB: write to temp, checkpoint-rename into place.
    restore_vault_db(vault_path, &payload.vault_db)?;

    // Restore attachments: clear existing dir, write all backup attachment files.
    restore_attachments(attachment_dir, &payload.attachments)?;

    // Marker stays present until the first successful unlock clears it.
    Ok(RestoreResult { safety_backup_db: safety_db })
}

/// Attempt to roll back from the safety backup if a restore marker is present.
/// Called at startup before the vault is opened.
pub fn rollback_if_marker_present(
    vault_path: &Path,
    attachment_dir: &Path,
    app_data_dir: &Path,
) -> VaultResult<bool> {
    let marker_path = app_data_dir.join(RESTORE_MARKER_NAME);
    if !marker_path.exists() {
        return Ok(false);
    }
    let marker_bytes = fs::read(&marker_path)
        .map_err(|e| VaultError::FileOperation(e.to_string()))?;
    let marker: RestoreMarker = serde_json::from_slice(&marker_bytes)
        .map_err(|_| VaultError::CorruptVault)?;

    // Try to open the current vault. If it succeeds, the restore finished
    // correctly — clear the marker and auto-delete the safety backup.
    if let Ok(repo) = VaultRepository::open_existing(vault_path) {
        if repo.vault_header_exists().unwrap_or(false) {
            clear_marker_and_safety_backup(app_data_dir, &marker);
            return Ok(true);
        }
    }

    // Current vault is missing or corrupt — roll back.
    if marker.safety_backup_db.exists() {
        restore_vault_db(vault_path, &fs::read(&marker.safety_backup_db)
            .map_err(|e| VaultError::FileOperation(e.to_string()))?)?;
        if marker.safety_backup_att.exists() {
            restore_attachments_raw(attachment_dir, &marker.safety_backup_att)?;
        }
    }
    clear_marker_and_safety_backup(app_data_dir, &marker);
    Ok(true)
}

/// Clear the restore marker and delete the safety backup files. Called on the
/// first successful unlock after a restore.
pub fn clear_restore_marker(app_data_dir: &Path) {
    let marker_path = app_data_dir.join(RESTORE_MARKER_NAME);
    if let Ok(bytes) = fs::read(&marker_path) {
        if let Ok(marker) = serde_json::from_slice::<RestoreMarker>(&bytes) {
            clear_marker_and_safety_backup(app_data_dir, &marker);
            return;
        }
    }
    let _ = fs::remove_file(&marker_path);
}

/// True when a restore-in-progress marker exists (orphan sweep must skip).
pub fn restore_in_progress(app_data_dir: &Path) -> bool {
    app_data_dir.join(RESTORE_MARKER_NAME).exists()
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn read_and_decrypt_backup(
    backup_path: &Path,
    master_password: &str,
) -> VaultResult<BackupPayload> {
    let envelope_bytes = fs::read(backup_path)
        .map_err(|e| VaultError::FileOperation(e.to_string()))?;
    let envelope: BackupEnvelope = serde_json::from_slice(&envelope_bytes)
        .map_err(|_| VaultError::InvalidMasterPassword)?;

    // Unwrap the backup data key.
    let data_key = unwrap_data_key(
        master_password,
        &envelope.kdf,
        envelope.wrap_format_version,
        &envelope.wrapped_key,
    )
    .map_err(|e| match e {
        // Wrong password and tampered KDF metadata / wrap version are
        // intentionally indistinguishable (AEAD failure).
        VaultError::DecryptionFailed => VaultError::InvalidMasterPassword,
        other => other,
    })?;

    // Verify KDF params haven't been tampered (re-derive AAD and check).
    // (Already enforced by key_wrap_aad being in the AEAD; if we get here
    // the unwrap succeeded and the params are authentic.)

    // Decrypt payload — uses a vault_id that we reconstruct from the decrypted result.
    // We decrypt with an empty vault_id first, which will fail if tampered.
    // Actually, the vault_id in payload_aad must match what was at backup creation time.
    // Solution: use an empty identity sentinel and put the real id inside the payload.
    // Re-try: use the vault_id stored inside the ENCRYPTED payload... but we need to
    // decrypt to get it. Chicken-and-egg.
    //
    // Resolution: the payload AAD uses a FIXED record identity "payload" (not the vault_id),
    // because the vault_id is inside the encrypted region. The vault_id in the content_aad
    // field is a placeholder that is verified by the AEAD itself — we use the vault_id
    // we derive from decryption. For this backup format, we use "backup-payload" as the
    // AAD identity so the entire backup file is self-consistent.
    let payload_aad = backup_payload_aad();
    let payload_bytes = decrypt_bytes(&envelope.payload, &data_key, &payload_aad)
        .map_err(|_| VaultError::InvalidMasterPassword)?;

    let payload: BackupPayload = serde_json::from_slice(&payload_bytes)
        .map_err(|_| VaultError::CorruptVault)?;

    if payload.version > MAX_BACKUP_PAYLOAD_VERSION {
        return Err(VaultError::BackupVersionTooNew);
    }

    Ok(payload)
}

/// Fixed AAD for the backup payload — the vault_id is inside the authenticated
/// region, so we use a stable sentinel for the record identity.
fn backup_payload_aad() -> Vec<u8> {
    content_aad(AadDomain::Backup, "backup-envelope", "payload")
}

fn collect_attachment_files(attachment_dir: &Path) -> VaultResult<Vec<BackupAttachment>> {
    if !attachment_dir.exists() {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    for entry in fs::read_dir(attachment_dir)
        .map_err(|e| VaultError::FileOperation(e.to_string()))?
    {
        let entry = entry.map_err(|e| VaultError::FileOperation(e.to_string()))?;
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(id) = name.strip_suffix(".bin") else {
            continue;
        };
        let data = fs::read(&path)
            .map_err(|e| VaultError::FileOperation(e.to_string()))?;
        let size_bytes = data.len() as u64;
        result.push(BackupAttachment {
            id: id.to_string(),
            file_name: name.to_string(),
            size_bytes,
            data,
        });
    }
    Ok(result)
}

fn create_safety_backup(
    vault_path: &Path,
    attachment_dir: &Path,
    safety_db: &Path,
    safety_att: &Path,
) -> VaultResult<()> {
    // Checkpoint before copying so the copy is self-contained.
    if vault_path.exists() {
        if let Ok(repo) = VaultRepository::open_existing(vault_path) {
            let _ = repo.checkpoint_truncate();
        }
        fs::copy(vault_path, safety_db)
            .map_err(|e| VaultError::FileOperation(e.to_string()))?;
    }
    // Copy attachments dir if it exists.
    if attachment_dir.exists() {
        if safety_att.exists() {
            fs::remove_dir_all(safety_att)
                .map_err(|e| VaultError::FileOperation(e.to_string()))?;
        }
        copy_dir_all(attachment_dir, safety_att)?;
    }
    Ok(())
}

fn restore_vault_db(vault_path: &Path, vault_db: &[u8]) -> VaultResult<()> {
    let parent = vault_path.parent().ok_or_else(|| {
        VaultError::FileOperation("vault path has no parent directory".to_string())
    })?;
    fs::create_dir_all(parent)
        .map_err(|e| VaultError::FileOperation(e.to_string()))?;

    // Remove WAL/SHM sidecars so the replaced DB is self-contained.
    for suffix in ["-wal", "-shm"] {
        let mut p = vault_path.as_os_str().to_owned();
        p.push(suffix);
        let _ = fs::remove_file(PathBuf::from(p));
    }

    let tmp_path = {
        let mut name = vault_path.as_os_str().to_owned();
        name.push(format!(".restore-{}", uuid::Uuid::new_v4()));
        PathBuf::from(name)
    };
    write_atomically(&tmp_path, vault_path, vault_db)
}

fn restore_attachments(attachment_dir: &Path, attachments: &[BackupAttachment]) -> VaultResult<()> {
    // Remove existing attachment dir and recreate from backup.
    if attachment_dir.exists() {
        fs::remove_dir_all(attachment_dir)
            .map_err(|e| VaultError::FileOperation(e.to_string()))?;
    }
    if attachments.is_empty() {
        return Ok(());
    }
    fs::create_dir_all(attachment_dir)
        .map_err(|e| VaultError::FileOperation(e.to_string()))?;
    for att in attachments {
        let bin_path = attachment_dir.join(&att.file_name);
        let tmp_path = attachment_dir.join(format!("{}.restore-tmp", att.id));
        write_atomically(&tmp_path, &bin_path, &att.data)?;
    }
    Ok(())
}

fn restore_attachments_raw(attachment_dir: &Path, src_dir: &Path) -> VaultResult<()> {
    if attachment_dir.exists() {
        fs::remove_dir_all(attachment_dir)
            .map_err(|e| VaultError::FileOperation(e.to_string()))?;
    }
    if src_dir.exists() {
        copy_dir_all(src_dir, attachment_dir)?;
    }
    Ok(())
}

fn copy_dir_all(src: &Path, dst: &Path) -> VaultResult<()> {
    fs::create_dir_all(dst).map_err(|e| VaultError::FileOperation(e.to_string()))?;
    for entry in fs::read_dir(src)
        .map_err(|e| VaultError::FileOperation(e.to_string()))?
    {
        let entry = entry.map_err(|e| VaultError::FileOperation(e.to_string()))?;
        let path = entry.path();
        if path.is_file() {
            let dest_file = dst.join(entry.file_name());
            fs::copy(&path, dest_file)
                .map_err(|e| VaultError::FileOperation(e.to_string()))?;
        }
    }
    Ok(())
}

fn write_marker(marker_path: &Path, marker: &RestoreMarker) -> VaultResult<()> {
    let bytes = serde_json::to_vec(marker)
        .map_err(|e| VaultError::Storage(e.to_string()))?;
    let tmp_path = {
        let mut name = marker_path.as_os_str().to_owned();
        name.push(".tmp");
        PathBuf::from(name)
    };
    write_atomically(&tmp_path, marker_path, &bytes)
}

fn clear_marker_and_safety_backup(app_data_dir: &Path, marker: &RestoreMarker) {
    let _ = fs::remove_file(app_data_dir.join(RESTORE_MARKER_NAME));
    let _ = fs::remove_file(&marker.safety_backup_db);
    let _ = fs::remove_dir_all(&marker.safety_backup_att);
}

fn purge_draft_stash(vault_path: &Path) {
    let stash_path = crate::draft_stash::draft_stash_path(vault_path);
    let _ = fs::remove_file(stash_path);
}

fn write_atomically(tmp_path: &Path, out_path: &Path, data: &[u8]) -> VaultResult<()> {
    let result = (|| -> io::Result<()> {
        let mut f = File::create(tmp_path)?;
        f.write_all(data)?;
        f.flush()?;
        f.sync_all()?;
        drop(f);
        fs::rename(tmp_path, out_path)?;
        Ok(())
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(tmp_path);
        return Err(VaultError::FileOperation(e.to_string()));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// base64 serde module for Vec<u8>
// ---------------------------------------------------------------------------

mod base64_bytes {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(bytes: &[u8], ser: S) -> Result<S::Ok, S::Error> {
        ser.serialize_str(&STANDARD.encode(bytes))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(de: D) -> Result<Vec<u8>, D::Error> {
        let s = String::deserialize(de)?;
        STANDARD.decode(s).map_err(serde::de::Error::custom)
    }
}
