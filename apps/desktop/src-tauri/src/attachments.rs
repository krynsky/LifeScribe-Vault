//! Attachment encrypt/delete/sweep.
//!
//! Invariants:
//! - Ciphertext files are written atomically (temp + rename + fsync) BEFORE
//!   the caller saves the snapshot that references them — a crash between write
//!   and snapshot save yields a sweepable orphan, never a dangling reference.
//! - Every encryption binds `AadDomain::Attachment` + vault_id + attachment_id
//!   so a ciphertext blob cannot be presented under a different domain or vault.
//! - Orphan sweep runs only after successful unlock + snapshot load; skips
//!   files modified within the last GRACE_SECS to protect attachments whose
//!   snapshot save is still in flight.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use zeroize::Zeroizing;

use crate::crypto::{content_aad, decrypt_bytes, encrypt_bytes, AadDomain, EncryptedBytes, KEY_LEN};
use crate::error::{VaultError, VaultResult};

/// Grace period (seconds) before a file without a snapshot reference is
/// treated as orphaned — protects attachments whose snapshot save is in flight.
const GRACE_SECS: u64 = 120;

pub struct AttachmentMeta {
    pub id: String,
    pub file_name: String,
    pub size_bytes: u64,
}

/// The attachment directory lives next to the vault DB file.
pub fn attachment_dir(vault_path: &Path) -> PathBuf {
    vault_path
        .parent()
        .unwrap_or(vault_path)
        .join("attachments")
}

/// Encrypt an attachment from `source_path`, writing the ciphertext to
/// `dir/{id}.bin` atomically (temp + rename + fsync).
///
/// The caller MUST save the snapshot referencing the returned id AFTER this
/// call returns. A crash between write and snapshot save leaves the file as a
/// sweepable orphan — safe; no dangling reference.
pub fn encrypt_attachment(
    source_path: &Path,
    dir: &Path,
    key: &Zeroizing<[u8; KEY_LEN]>,
    vault_id: &str,
) -> VaultResult<AttachmentMeta> {
    let plaintext = Zeroizing::new(fs::read(source_path).map_err(|e| {
        if e.kind() == io::ErrorKind::NotFound {
            VaultError::NotFound
        } else {
            VaultError::FileOperation(e.to_string())
        }
    })?);
    let size_bytes = plaintext.len() as u64;
    let file_name = source_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("attachment")
        .to_string();

    fs::create_dir_all(dir).map_err(|e| VaultError::FileOperation(e.to_string()))?;

    let id = uuid::Uuid::new_v4().to_string();
    let aad = content_aad(AadDomain::Attachment, vault_id, &id);
    let encrypted = encrypt_bytes(&plaintext, key, &aad)?;
    let envelope =
        serde_json::to_vec(&encrypted).map_err(|e| VaultError::Storage(e.to_string()))?;

    let bin_path = dir.join(format!("{id}.bin"));
    let tmp_path = dir.join(format!("{id}.tmp"));
    write_atomically(&tmp_path, &bin_path, &envelope)?;

    Ok(AttachmentMeta {
        id,
        file_name,
        size_bytes,
    })
}

/// Encrypt raw plaintext bytes as a v2 attachment ciphertext file.
///
/// Used by v1 import to re-encrypt v1 attachment bytes under the v2 data key
/// and AAD domain without needing a source file on disk.
pub fn encrypt_attachment_bytes(
    plaintext: &[u8],
    file_name: &str,
    dir: &Path,
    key: &Zeroizing<[u8; KEY_LEN]>,
    vault_id: &str,
) -> VaultResult<AttachmentMeta> {
    let size_bytes = plaintext.len() as u64;
    fs::create_dir_all(dir).map_err(|e| VaultError::FileOperation(e.to_string()))?;
    let id = uuid::Uuid::new_v4().to_string();
    let aad = content_aad(AadDomain::Attachment, vault_id, &id);
    let encrypted = encrypt_bytes(plaintext, key, &aad)?;
    let envelope =
        serde_json::to_vec(&encrypted).map_err(|e| VaultError::Storage(e.to_string()))?;
    let bin_path = dir.join(format!("{id}.bin"));
    let tmp_path = dir.join(format!("{id}.tmp"));
    write_atomically(&tmp_path, &bin_path, &envelope)?;
    Ok(AttachmentMeta { id, file_name: file_name.to_string(), size_bytes })
}

/// Decrypt an attachment for round-trip verification (used in tests only —
/// in-app viewer is deferred per plan scope).
pub fn decrypt_attachment(
    dir: &Path,
    attachment_id: &str,
    key: &Zeroizing<[u8; KEY_LEN]>,
    vault_id: &str,
) -> VaultResult<Vec<u8>> {
    let bin_path = dir.join(format!("{attachment_id}.bin"));
    let envelope_bytes =
        fs::read(&bin_path).map_err(|e| VaultError::FileOperation(e.to_string()))?;
    let encrypted: EncryptedBytes = serde_json::from_slice(&envelope_bytes)
        .map_err(|_| VaultError::CorruptVault)?;
    let aad = content_aad(AadDomain::Attachment, vault_id, attachment_id);
    decrypt_bytes(&encrypted, key, &aad)
}

/// Decrypt an attachment to a fresh plaintext file inside a random temp
/// subdirectory, preserving the original file name (so the OS default app sees
/// the right extension). Returns the temp file path for the caller to open and
/// later clean up. This is the ONLY sanctioned plaintext-to-disk path and MUST
/// be gated behind explicit user confirmation at the UI layer.
pub fn decrypt_to_temp(
    dir: &Path,
    attachment_id: &str,
    file_name: &str,
    key: &Zeroizing<[u8; KEY_LEN]>,
    vault_id: &str,
) -> VaultResult<PathBuf> {
    let plaintext = decrypt_attachment(dir, attachment_id, key, vault_id)?;
    let sub = std::env::temp_dir().join(format!("lifescribe-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&sub).map_err(|e| VaultError::FileOperation(e.to_string()))?;
    let safe_name = Path::new(file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("attachment");
    let path = sub.join(safe_name);
    fs::write(&path, &plaintext).map_err(|e| VaultError::FileOperation(e.to_string()))?;
    Ok(path)
}

/// Delete the ciphertext file for `attachment_id`. A missing file is treated
/// as success (already gone) — the snapshot reference should be removed
/// unconditionally regardless.
pub fn delete_attachment_file(dir: &Path, attachment_id: &str) -> VaultResult<()> {
    let bin_path = dir.join(format!("{attachment_id}.bin"));
    match fs::remove_file(&bin_path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(VaultError::FileOperation(e.to_string())),
    }
}

/// Sweep orphaned ciphertext files (present on disk but absent from
/// `referenced_ids`) from `dir`. Files modified within the last GRACE_SECS
/// are skipped. Stale `.tmp` files are also removed without a grace period.
/// Returns the count of files swept.
pub fn sweep_orphaned_attachments(dir: &Path, referenced_ids: &[String]) -> VaultResult<u32> {
    if !dir.exists() {
        return Ok(0);
    }
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut swept = 0u32;
    let entries =
        fs::read_dir(dir).map_err(|e| VaultError::FileOperation(e.to_string()))?;

    for entry in entries {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };

        if name.ends_with(".tmp") {
            let _ = fs::remove_file(&path);
            swept += 1;
            continue;
        }

        let Some(id) = name.strip_suffix(".bin") else {
            continue;
        };

        if referenced_ids.iter().any(|r| r.as_str() == id) {
            continue;
        }

        // Skip recently-written files: their snapshot save may still be pending.
        if let Ok(meta) = fs::metadata(&path) {
            if let Ok(modified) = meta.modified() {
                if let Ok(age) = modified.duration_since(UNIX_EPOCH) {
                    if now_secs.saturating_sub(age.as_secs()) < GRACE_SECS {
                        continue;
                    }
                }
            }
        }

        if fs::remove_file(&path).is_ok() {
            swept += 1;
        }
    }
    Ok(swept)
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
