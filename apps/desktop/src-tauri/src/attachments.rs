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

/// Prefix of the per-open temp directories `decrypt_to_temp` creates.
const EXTERNAL_TEMP_PREFIX: &str = "lifescribe-";

/// A leftover external-open temp directory is only swept once it is older than
/// this. Guards against deleting a directory another running instance just
/// created; this session's own directories are purged deterministically on lock.
const EXTERNAL_TEMP_STALE_SECS: u64 = 3600;

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
///
/// The caller MUST NOT delete the file immediately after launching the external
/// app: `open::that` returns once the launcher is dispatched, not once the app
/// has read the file, so an eager delete races the reader (Chrome et al. report
/// ERR_FILE_NOT_FOUND). Ownership of the returned directory passes to the
/// session, which purges it on lock; `sweep_stale_external_temp_dirs` covers
/// the crash case.
pub fn decrypt_to_temp(
    dir: &Path,
    attachment_id: &str,
    file_name: &str,
    key: &Zeroizing<[u8; KEY_LEN]>,
    vault_id: &str,
) -> VaultResult<PathBuf> {
    let plaintext = decrypt_attachment(dir, attachment_id, key, vault_id)?;
    let sub =
        std::env::temp_dir().join(format!("{EXTERNAL_TEMP_PREFIX}{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&sub).map_err(|e| VaultError::FileOperation(e.to_string()))?;
    let safe_name = Path::new(file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("attachment");
    let path = sub.join(safe_name);
    fs::write(&path, &plaintext).map_err(|e| VaultError::FileOperation(e.to_string()))?;
    Ok(path)
}

/// Remove one external-open temp directory and the plaintext file inside it.
/// Best-effort: a file still held open by the external app cannot be deleted on
/// Windows, and that is an accepted limitation (the stale sweep retries later).
pub fn purge_external_temp_dir(dir: &Path) {
    let _ = fs::remove_dir_all(dir);
}

/// Sweep external-open temp directories left behind by a previous run that
/// never reached its lock (a crash or a kill). Only directories older than
/// `EXTERNAL_TEMP_STALE_SECS` are removed, so a concurrently-running instance's
/// freshly-created directory is never pulled out from under it. Returns the
/// count removed.
pub fn sweep_stale_external_temp_dirs() -> u32 {
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let Ok(entries) = fs::read_dir(std::env::temp_dir()) else {
        return 0;
    };

    let mut swept = 0u32;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !name.starts_with(EXTERNAL_TEMP_PREFIX) {
            continue;
        }
        let Ok(modified) = fs::metadata(&path).and_then(|m| m.modified()) else {
            continue;
        };
        let Ok(age) = modified.duration_since(UNIX_EPOCH) else {
            continue;
        };
        if now_secs.saturating_sub(age.as_secs()) < EXTERNAL_TEMP_STALE_SECS {
            continue;
        }
        if fs::remove_dir_all(&path).is_ok() {
            swept += 1;
        }
    }
    swept
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
///
/// A `.bin` file is only deleted once it is PROVEN to belong to this vault:
/// the sweep decrypts it with this session's key and vault_id (the ciphertext
/// is AAD-bound to both). Two vault databases can live in one folder and thus
/// share one attachments directory — without this check, unlocking one vault
/// silently destroys the other's attachments.
pub fn sweep_orphaned_attachments(
    dir: &Path,
    referenced_ids: &[String],
    key: &Zeroizing<[u8; KEY_LEN]>,
    vault_id: &str,
) -> VaultResult<u32> {
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

        // Last gate before deletion: prove ownership. Only a file that decrypts
        // under this vault's key AND vault_id is ours to delete. Anything that
        // fails to parse as an envelope or fails the AEAD tag is left alone —
        // it may belong to another vault sharing this directory. The cost of
        // keeping a corrupt orphan of our own is a few stale bytes; the cost of
        // deleting a file of unknown ownership is permanent data loss. Do not
        // "optimize" this check away. Note this runs only on files already
        // selected for deletion, so the normal (no-orphan) path pays nothing.
        if !belongs_to_vault(dir, id, key, vault_id) {
            continue;
        }

        if fs::remove_file(&path).is_ok() {
            swept += 1;
        }
    }
    Ok(swept)
}

/// True only if `id`'s ciphertext verifies under this vault's key and identity.
/// Any failure (missing, unparseable, bad AEAD tag) answers "not ours". The
/// decrypted plaintext is dropped here and never surfaces in a return value,
/// an error, or a log.
fn belongs_to_vault(
    dir: &Path,
    id: &str,
    key: &Zeroizing<[u8; KEY_LEN]>,
    vault_id: &str,
) -> bool {
    match decrypt_attachment(dir, id, key, vault_id) {
        Ok(plaintext) => {
            let _ = Zeroizing::new(plaintext);
            true
        }
        Err(_) => false,
    }
}

/// Write `data` to `out_path` without ever leaving a partial file there:
/// fully write and fsync a temp file, then rename it into place. `tmp_path`
/// MUST be on the same filesystem as `out_path` (rename is only atomic within
/// one volume), so callers build it as a sibling of the destination.
///
/// Shared with the Recovery Kit PDF export, which writes to a user-chosen
/// path that may already hold a file worth keeping.
pub(crate) fn write_atomically(tmp_path: &Path, out_path: &Path, data: &[u8]) -> VaultResult<()> {
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
