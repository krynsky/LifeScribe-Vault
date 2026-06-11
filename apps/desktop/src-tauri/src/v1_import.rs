//! v1 vault import.
//!
//! Security contract:
//! - v1 password is `Zeroizing`-wrapped, never logged/echoed, dropped after
//!   the key-derive-and-verify call.
//! - The derived v1 key lives only inside this function; it is dropped on
//!   return (or on any error path).
//! - The v1 vault file and its WAL/SHM sidecars are never mutated — all reads
//!   operate on a temporary copy that is cleaned up on both success and failure.
//! - v1 attachment plaintext is decrypted, passed directly to
//!   `encrypt_attachment_bytes`, and immediately freed; it is never written to
//!   disk in plaintext.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, ErrorCode, OpenFlags};
use serde::Serialize;
use zeroize::Zeroizing;

use crate::attachments::encrypt_attachment_bytes;
use crate::crypto::{decrypt_bytes, derive_key, EncryptedBytes, KeyDerivationMetadata, KEY_LEN};
use crate::error::{VaultError, VaultResult};

/// Known plaintext encrypted under the v1 verification key at vault-creation time.
const V1_VERIFICATION_PLAINTEXT: &[u8] = b"lifescribe-vault-verification-v1";
const V1_SNAPSHOT_ID: &str = "vault_snapshot";
const V1_SNAPSHOT_KIND: &str = "vault_snapshot";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// One re-encrypted attachment: the v1 `id` and `fileName` for snapshot
/// cross-referencing, plus the fresh v2 `id` that was just written to
/// `v2_att_dir`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct V1AttachmentEntry {
    pub v1_id: String,
    pub v2_id: String,
    pub file_name: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct V1ImportResult {
    /// Raw v1 snapshot JSON — TypeScript does the field-level mapping.
    pub snapshot: serde_json::Value,
    /// Re-encrypted attachments, keyed by v1 id so the mapper can substitute
    /// new v2 ids into the records.
    pub attachments: Vec<V1AttachmentEntry>,
}

/// Open a v1 vault, verify the password, decrypt the snapshot, re-encrypt any
/// attachments under the active v2 session key, and return the raw v1 snapshot
/// JSON + attachment id remapping to TypeScript.
///
/// The v1 vault file is never mutated: a temporary copy is used for all reads.
pub fn import_v1_snapshot(
    v1_vault_path: &Path,
    v1_password: &str,
    v2_att_dir: &Path,
    v2_data_key: &Zeroizing<[u8; KEY_LEN]>,
    v2_vault_id: &str,
) -> VaultResult<V1ImportResult> {
    // 1. Copy vault + WAL/SHM to a temp directory.
    let tmp_dir = tempfile::tempdir()
        .map_err(|e| VaultError::FileOperation(e.to_string()))?;
    let tmp_vault = tmp_dir.path().join("vault.sqlite3");
    copy_with_sidecars(v1_vault_path, &tmp_vault)?;

    // 2. Checkpoint the copy so any uncommitted WAL frames are included.
    {
        let conn = open_readwrite(&tmp_vault)?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|e| VaultError::Storage(e.to_string()))?;
    }

    // 3. Open the copy read-only and read the v1 header.
    let conn = open_readonly(&tmp_vault)?;
    let header = load_v1_header(&conn)?;

    // 4. Derive the v1 data key and verify the password. No Debug on key.
    let v1_key = {
        let pw = Zeroizing::new(v1_password.to_string());
        derive_key(&pw, &header.kdf).map_err(|e| match e {
            VaultError::CorruptVault => VaultError::InvalidMasterPassword,
            other => other,
        })?
    };
    verify_v1_password(&conn, &header, &v1_key)?;

    // 5. Decrypt the snapshot record (v1 uses no AAD — empty slice).
    let snapshot = load_v1_snapshot(&conn, &v1_key)?;

    // Temp dir cleaned up here (conn dropped first so SQLite releases files).
    drop(conn);
    drop(tmp_dir);

    // 6. Re-encrypt v1 attachments under the v2 data key.
    let v1_att_dir = v1_vault_path
        .parent()
        .unwrap_or(v1_vault_path)
        .join("attachments");
    let attachments = reimport_attachments(
        &snapshot,
        &v1_att_dir,
        &v1_key,
        v2_att_dir,
        v2_data_key,
        v2_vault_id,
    )?;

    Ok(V1ImportResult { snapshot, attachments })
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// v1 vault_header row (different from v2's wrapped-key scheme).
struct V1Header {
    kdf: KeyDerivationMetadata,
    verification_nonce: Vec<u8>,
    verification_ciphertext: Vec<u8>,
}

fn load_v1_header(conn: &Connection) -> VaultResult<V1Header> {
    // Table might not exist if the file is not a v1 vault.
    let table_exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='vault_header')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| VaultError::Storage(e.to_string()))?;
    if !table_exists {
        return Err(VaultError::CorruptVault);
    }

    conn.query_row(
        "SELECT kdf_metadata, verification_nonce, verification_ciphertext FROM vault_header WHERE id=1",
        [],
        |row| {
            let kdf_str: String = row.get(0)?;
            let nonce: Vec<u8> = row.get(1)?;
            let ct: Vec<u8> = row.get(2)?;
            Ok((kdf_str, nonce, ct))
        },
    )
    .map_err(map_sqlite_error)
    .and_then(|(kdf_str, nonce, ct)| {
        let kdf: KeyDerivationMetadata = serde_json::from_str(&kdf_str)
            .map_err(|_| VaultError::CorruptVault)?;
        Ok(V1Header {
            kdf,
            verification_nonce: nonce,
            verification_ciphertext: ct,
        })
    })
}

fn verify_v1_password(conn: &Connection, header: &V1Header, key: &[u8; KEY_LEN]) -> VaultResult<()> {
    // Also check there is actually a vault_records table (otherwise it is not a
    // v1 vault at all).
    let records_exist: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='vault_records')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| VaultError::Storage(e.to_string()))?;
    if !records_exist {
        return Err(VaultError::CorruptVault);
    }

    let encrypted = EncryptedBytes {
        nonce: header.verification_nonce.clone(),
        ciphertext: header.verification_ciphertext.clone(),
    };
    // v1 used no AAD — empty slice.
    let plaintext = decrypt_bytes(&encrypted, key, &[]).map_err(|_| VaultError::InvalidMasterPassword)?;
    if plaintext != V1_VERIFICATION_PLAINTEXT {
        return Err(VaultError::InvalidMasterPassword);
    }
    Ok(())
}

fn load_v1_snapshot(conn: &Connection, key: &[u8; KEY_LEN]) -> VaultResult<serde_json::Value> {
    let (nonce, ciphertext): (Vec<u8>, Vec<u8>) = conn
        .query_row(
            "SELECT nonce, ciphertext FROM vault_records WHERE id=?1 AND kind=?2",
            rusqlite::params![V1_SNAPSHOT_ID, V1_SNAPSHOT_KIND],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(map_sqlite_error)?;
    let encrypted = EncryptedBytes { nonce, ciphertext };
    // v1 snapshot was encrypted without AAD.
    let plaintext = Zeroizing::new(
        decrypt_bytes(&encrypted, key, &[]).map_err(|_| VaultError::InvalidMasterPassword)?,
    );
    serde_json::from_slice(&plaintext).map_err(|_| VaultError::CorruptVault)
}

/// Re-encrypt v1 attachment files under the v2 data key.
///
/// v1 attachment files are JSON-serialised `EncryptedBytes` (nonce + ciphertext)
/// encrypted without AAD. This function decrypts each one with the v1 key and
/// re-encrypts under the v2 key + domain-bound AAD.
///
/// v1 attachment metadata lives in `snapshot["attachments"]` as an array of
/// objects: `{ id, fileName, ... }`.
fn reimport_attachments(
    snapshot: &serde_json::Value,
    v1_att_dir: &Path,
    v1_key: &[u8; KEY_LEN],
    v2_att_dir: &Path,
    v2_key: &Zeroizing<[u8; KEY_LEN]>,
    v2_vault_id: &str,
) -> VaultResult<Vec<V1AttachmentEntry>> {
    let Some(attachments_val) = snapshot.get("attachments") else {
        return Ok(Vec::new());
    };
    let Some(attachments_arr) = attachments_val.as_array() else {
        return Ok(Vec::new());
    };

    let mut entries = Vec::new();
    for att in attachments_arr {
        let Some(id) = att.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let file_name = att
            .get("fileName")
            .and_then(|v| v.as_str())
            .unwrap_or("attachment");

        // Read the v1 ciphertext file.
        let bin_path = v1_att_dir.join(format!("{id}.bin"));
        let envelope_bytes = match fs::read(&bin_path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // Attachment file missing from v1 dir — best-effort skip.
                continue;
            }
            Err(e) => return Err(VaultError::FileOperation(e.to_string())),
        };

        // Deserialize and decrypt with v1 key (no AAD).
        let v1_encrypted: EncryptedBytes = serde_json::from_slice(&envelope_bytes)
            .map_err(|_| VaultError::CorruptVault)?;
        let plaintext = Zeroizing::new(
            decrypt_bytes(&v1_encrypted, v1_key, &[])
                .map_err(|_| VaultError::InvalidMasterPassword)?,
        );

        // Re-encrypt under v2 key + AAD.
        let meta = encrypt_attachment_bytes(&plaintext, file_name, v2_att_dir, v2_key, v2_vault_id)?;

        entries.push(V1AttachmentEntry {
            v1_id: id.to_string(),
            v2_id: meta.id,
            file_name: file_name.to_string(),
            size_bytes: meta.size_bytes,
        });
    }
    Ok(entries)
}

// ---------------------------------------------------------------------------
// File copy helpers
// ---------------------------------------------------------------------------

/// Copy the v1 vault file plus any `-wal` and `-shm` sidecars to `dest`.
/// Returns `DatabaseLocked` if any file cannot be read.
fn copy_with_sidecars(src: &Path, dest: &Path) -> VaultResult<()> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| VaultError::FileOperation(e.to_string()))?;
    }
    copy_file(src, dest)?;
    for suffix in ["-wal", "-shm"] {
        let src_side = append_suffix(src, suffix);
        if src_side.exists() {
            let dest_side = append_suffix(dest, suffix);
            copy_file(&src_side, &dest_side)?;
        }
    }
    Ok(())
}

fn copy_file(src: &Path, dest: &Path) -> VaultResult<()> {
    fs::copy(src, dest).map(|_| ()).map_err(|e| {
        if e.raw_os_error() == Some(32) || e.raw_os_error() == Some(33) {
            // Windows error 32 = ERROR_SHARING_VIOLATION (file locked by v1).
            VaultError::DatabaseLocked
        } else {
            VaultError::FileOperation(e.to_string())
        }
    })
}

fn append_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

fn open_readwrite(path: &Path) -> VaultResult<Connection> {
    Connection::open(path).map_err(|e| {
        if matches!(e.sqlite_error_code(), Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked)) {
            VaultError::DatabaseLocked
        } else {
            VaultError::Storage(e.to_string())
        }
    })
}

fn open_readonly(path: &Path) -> VaultResult<Connection> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| {
        if matches!(e.sqlite_error_code(), Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked)) {
            VaultError::DatabaseLocked
        } else {
            VaultError::Storage(e.to_string())
        }
    })
}

fn map_sqlite_error(e: rusqlite::Error) -> VaultError {
    match e {
        rusqlite::Error::QueryReturnedNoRows => VaultError::NotFound,
        other => VaultError::Storage(other.to_string()),
    }
}
