//! SQLite (WAL) repository: vault header + generation-counted snapshots.
//!
//! Snapshot storage law (see plan): saves are compare-and-swap against the
//! caller's base generation (`SnapshotConflict` on stale base — never
//! blind-overwrite); the previous `SNAPSHOT_RETAIN_PREVIOUS` generations are
//! retained; load returns the newest generation that decrypts, falling back
//! to older generations with a `recovered` flag. A save from a recovered
//! session supersedes newer generations that fail to decrypt (they stay
//! retained inside the window) rather than failing CAS forever.

use std::path::Path;

use rusqlite::{params, Connection, Error as SqliteError, ErrorCode, OpenFlags, TransactionBehavior};
use zeroize::Zeroizing;

use crate::crypto::{
    content_aad, decrypt_bytes, encrypt_bytes, AadDomain, EncryptedBytes, KeyDerivationMetadata,
    KEY_LEN,
};
use crate::error::{VaultError, VaultResult};

/// Number of previous snapshot generations retained alongside the newest.
pub const SNAPSHOT_RETAIN_PREVIOUS: u64 = 3;

pub struct VaultRepository {
    connection: Connection,
}

#[derive(Clone)]
pub struct VaultHeader {
    pub kdf: KeyDerivationMetadata,
    pub wrap_format_version: u32,
    pub vault_id: String,
    pub wrapped_data_key: EncryptedBytes,
}

pub struct SnapshotLoad {
    pub snapshot_json: Vec<u8>,
    pub generation: u64,
    pub recovered: bool,
}

/// Record-id validation carried from v1: `[a-z0-9_-]{3,80}`.
/// Snapshots are keyed by generation, so U2 itself does not store record
/// ids, but U8 (attachments) and later units validate ids through this.
pub struct RecordId<'a>(&'a str);

impl<'a> RecordId<'a> {
    pub fn parse(value: &'a str) -> Option<Self> {
        let is_valid_length = (3..=80).contains(&value.len());
        let has_valid_chars = value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_' || byte == b'-'
        });
        if is_valid_length && has_valid_chars {
            Some(Self(value))
        } else {
            None
        }
    }

    pub fn as_str(&self) -> &'a str {
        self.0
    }
}

fn snapshot_record_identity(generation: u64) -> String {
    format!("generation:{generation}")
}

impl VaultRepository {
    /// Open, creating the file if needed. Used only for staging a new vault
    /// at a temp path (the atomic-create flow in `commands.rs`).
    pub fn create_new(path: &Path) -> VaultResult<Self> {
        let connection =
            Connection::open(path).map_err(|error| VaultError::Storage(error.to_string()))?;
        Self::configure(connection)
    }

    /// Open an existing vault file; a missing file maps to `NotFound` and
    /// never creates an empty database.
    pub fn open_existing(path: &Path) -> VaultResult<Self> {
        let connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|error| match error {
            SqliteError::SqliteFailure(failure, _) if failure.code == ErrorCode::CannotOpen => {
                VaultError::NotFound
            }
            error => VaultError::Storage(error.to_string()),
        })?;
        Self::configure(connection)
    }

    fn configure(connection: Connection) -> VaultResult<Self> {
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|error| VaultError::Storage(error.to_string()))?;
        Ok(Self { connection })
    }

    pub fn initialize(&self) -> VaultResult<()> {
        self.connection
            .execute_batch(
                r#"
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS vault_header (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    kdf_metadata TEXT NOT NULL,
                    wrap_format_version INTEGER NOT NULL,
                    vault_id TEXT NOT NULL,
                    wrapped_key_nonce BLOB NOT NULL,
                    wrapped_key_ciphertext BLOB NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS vault_snapshots (
                    generation INTEGER PRIMARY KEY CHECK (generation >= 1),
                    nonce BLOB NOT NULL,
                    ciphertext BLOB NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                "#,
            )
            .map_err(|error| VaultError::Storage(error.to_string()))?;
        Ok(())
    }

    /// Merge the WAL back into the main db file (used before the atomic
    /// rename during vault creation so the staged file is self-contained).
    pub fn checkpoint_truncate(&self) -> VaultResult<()> {
        self.connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|error| VaultError::Storage(error.to_string()))?;
        Ok(())
    }

    pub fn create_vault_header(&self, header: &VaultHeader) -> VaultResult<()> {
        if self.vault_header_exists()? {
            return Err(VaultError::VaultAlreadyExists);
        }
        let kdf_metadata =
            serde_json::to_string(&header.kdf).map_err(|_| VaultError::CorruptVault)?;
        self.connection
            .execute(
                r#"
                INSERT INTO vault_header (
                    id, kdf_metadata, wrap_format_version, vault_id,
                    wrapped_key_nonce, wrapped_key_ciphertext, updated_at
                )
                VALUES (1, ?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP)
                "#,
                params![
                    kdf_metadata,
                    header.wrap_format_version,
                    header.vault_id,
                    header.wrapped_data_key.nonce,
                    header.wrapped_data_key.ciphertext
                ],
            )
            .map_err(map_create_header_error)?;
        Ok(())
    }

    pub fn vault_header_exists(&self) -> VaultResult<bool> {
        if !self.vault_header_table_exists()? {
            return Ok(false);
        }
        self.connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM vault_header WHERE id = 1)",
                [],
                |row| row.get(0),
            )
            .map_err(|error| VaultError::Storage(error.to_string()))
    }

    pub fn load_vault_header(&self) -> VaultResult<VaultHeader> {
        if !self.vault_header_table_exists()? {
            return Err(VaultError::NotFound);
        }
        self.connection
            .query_row(
                r#"
                SELECT kdf_metadata, wrap_format_version, vault_id,
                       wrapped_key_nonce, wrapped_key_ciphertext
                FROM vault_header
                WHERE id = 1
                "#,
                [],
                |row| {
                    let kdf_metadata: String = row.get(0)?;
                    let kdf = serde_json::from_str(&kdf_metadata).map_err(|error| {
                        SqliteError::FromSqlConversionFailure(
                            0,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?;
                    Ok(VaultHeader {
                        kdf,
                        wrap_format_version: row.get(1)?,
                        vault_id: row.get(2)?,
                        wrapped_data_key: EncryptedBytes {
                            nonce: row.get(3)?,
                            ciphertext: row.get(4)?,
                        },
                    })
                },
            )
            .map_err(map_load_error)
    }

    /// Atomically replace only the password-derived key-wrap material.
    /// The vault id and content-encryption key stay unchanged, so snapshots,
    /// drafts, and attachments do not need to be rewritten.
    pub fn update_key_wrap(
        &self,
        kdf: &KeyDerivationMetadata,
        wrap_format_version: u32,
        wrapped_data_key: &EncryptedBytes,
    ) -> VaultResult<()> {
        let kdf_metadata = serde_json::to_string(kdf).map_err(|_| VaultError::CorruptVault)?;
        let updated = self
            .connection
            .execute(
                r#"
                UPDATE vault_header
                SET kdf_metadata = ?1,
                    wrap_format_version = ?2,
                    wrapped_key_nonce = ?3,
                    wrapped_key_ciphertext = ?4,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = 1
                "#,
                params![
                    kdf_metadata,
                    wrap_format_version,
                    wrapped_data_key.nonce,
                    wrapped_data_key.ciphertext
                ],
            )
            .map_err(|error| VaultError::Storage(error.to_string()))?;
        if updated != 1 {
            return Err(VaultError::VaultNotInitialized);
        }
        Ok(())
    }

    fn vault_header_table_exists(&self) -> VaultResult<bool> {
        self.connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'vault_header')",
                [],
                |row| row.get(0),
            )
            .map_err(|error| VaultError::Storage(error.to_string()))
    }

    /// Compare-and-swap snapshot save. Returns the new generation number.
    ///
    /// CAS rule: the save proceeds when the stored max generation equals
    /// `base_generation`. When the store has advanced past the base, the
    /// save is allowed only if EVERY generation newer than the base fails
    /// to decrypt (the recovered-session supersede path); if any newer
    /// generation decrypts, the base is genuinely stale → `SnapshotConflict`.
    /// The superseded (undecryptable) generations stay retained inside the
    /// retention window; the new save always lands at `max + 1` so the
    /// counter stays monotonic.
    pub fn save_snapshot(
        &mut self,
        snapshot_json: &[u8],
        base_generation: u64,
        key: &Zeroizing<[u8; KEY_LEN]>,
        vault_id: &str,
    ) -> VaultResult<u64> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| VaultError::Storage(error.to_string()))?;

        let current_max: u64 = tx
            .query_row(
                "SELECT COALESCE(MAX(generation), 0) FROM vault_snapshots",
                [],
                |row| row.get(0),
            )
            .map_err(|error| VaultError::Storage(error.to_string()))?;

        if base_generation > current_max {
            // The caller claims a generation the store has never produced.
            return Err(VaultError::SnapshotConflict);
        }

        if current_max > base_generation {
            // Newer generations exist. Allowed only when none of them
            // decrypt (i.e. the caller loaded via the recovered fallback).
            let mut statement = tx
                .prepare(
                    "SELECT generation, nonce, ciphertext FROM vault_snapshots WHERE generation > ?1",
                )
                .map_err(|error| VaultError::Storage(error.to_string()))?;
            let rows = statement
                .query_map(params![base_generation], |row| {
                    Ok((
                        row.get::<_, u64>(0)?,
                        EncryptedBytes {
                            nonce: row.get(1)?,
                            ciphertext: row.get(2)?,
                        },
                    ))
                })
                .map_err(|error| VaultError::Storage(error.to_string()))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| VaultError::Storage(error.to_string()))?;
            drop(statement);

            for (generation, encrypted) in rows {
                let aad = content_aad(
                    AadDomain::Snapshot,
                    vault_id,
                    &snapshot_record_identity(generation),
                );
                if decrypt_bytes(&encrypted, key, &aad).is_ok() {
                    return Err(VaultError::SnapshotConflict);
                }
            }
        }

        let new_generation = current_max + 1;
        let aad = content_aad(
            AadDomain::Snapshot,
            vault_id,
            &snapshot_record_identity(new_generation),
        );
        let encrypted = encrypt_bytes(snapshot_json, key, &aad)?;
        tx.execute(
            "INSERT INTO vault_snapshots (generation, nonce, ciphertext, created_at) VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)",
            params![new_generation, encrypted.nonce, encrypted.ciphertext],
        )
        .map_err(|error| VaultError::Storage(error.to_string()))?;

        // Retain the newest generation plus the previous N; prune older.
        if new_generation > SNAPSHOT_RETAIN_PREVIOUS {
            tx.execute(
                "DELETE FROM vault_snapshots WHERE generation < ?1",
                params![new_generation - SNAPSHOT_RETAIN_PREVIOUS],
            )
            .map_err(|error| VaultError::Storage(error.to_string()))?;
        }

        tx.commit()
            .map_err(|error| VaultError::Storage(error.to_string()))?;
        Ok(new_generation)
    }

    /// Load the newest snapshot generation that decrypts. Falls back to
    /// older retained generations, flagging the result `recovered` so the
    /// caller can surface a "recovered from previous save" notice.
    pub fn load_snapshot(
        &self,
        key: &Zeroizing<[u8; KEY_LEN]>,
        vault_id: &str,
    ) -> VaultResult<SnapshotLoad> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT generation, nonce, ciphertext FROM vault_snapshots ORDER BY generation DESC",
            )
            .map_err(|error| VaultError::Storage(error.to_string()))?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, u64>(0)?,
                    EncryptedBytes {
                        nonce: row.get(1)?,
                        ciphertext: row.get(2)?,
                    },
                ))
            })
            .map_err(|error| VaultError::Storage(error.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| VaultError::Storage(error.to_string()))?;

        if rows.is_empty() {
            return Err(VaultError::NotFound);
        }

        for (index, (generation, encrypted)) in rows.iter().enumerate() {
            let aad = content_aad(
                AadDomain::Snapshot,
                vault_id,
                &snapshot_record_identity(*generation),
            );
            if let Ok(snapshot_json) = decrypt_bytes(encrypted, key, &aad) {
                return Ok(SnapshotLoad {
                    snapshot_json,
                    generation: *generation,
                    recovered: index > 0,
                });
            }
        }

        Err(VaultError::CorruptVault)
    }
}

fn map_load_error(error: SqliteError) -> VaultError {
    match error {
        SqliteError::QueryReturnedNoRows => VaultError::NotFound,
        SqliteError::InvalidColumnType(..) | SqliteError::FromSqlConversionFailure(..) => {
            VaultError::CorruptVault
        }
        error => VaultError::Storage(error.to_string()),
    }
}

fn map_create_header_error(error: SqliteError) -> VaultError {
    match error {
        SqliteError::SqliteFailure(failure, _)
            if failure.code == ErrorCode::ConstraintViolation =>
        {
            VaultError::VaultAlreadyExists
        }
        error => VaultError::Storage(error.to_string()),
    }
}
