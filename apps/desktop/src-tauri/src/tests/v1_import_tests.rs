use std::fs;

use rusqlite::{params, Connection};
use tempfile::tempdir;

use crate::attachments::{attachment_dir, decrypt_attachment};
use crate::commands::{create_vault_at_path, save_vault_snapshot_for_session, VaultSession};
use crate::crypto::{encrypt_bytes, KeyDerivationMetadata, KEY_LEN};
use crate::v1_import::{import_v1_snapshot, V1ImportResult};

const V1_PASSWORD: &str = "v1-test-password";
const V2_PASSWORD: &str = "v2-test-password";
const V1_VERIFICATION_PLAINTEXT: &[u8] = b"lifescribe-vault-verification-v1";

// ---------------------------------------------------------------------------
// Helpers: build a minimal v1-format vault in a temp dir.
// ---------------------------------------------------------------------------

fn make_v1_vault(dir: &std::path::Path, password: &str, snapshot: &serde_json::Value) {
    let vault_path = dir.join("vault.sqlite3");
    let conn = Connection::open(&vault_path).unwrap();
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE vault_header (
             id INTEGER PRIMARY KEY CHECK (id = 1),
             kdf_metadata TEXT NOT NULL,
             verification_nonce BLOB NOT NULL,
             verification_ciphertext BLOB NOT NULL,
             updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );
         CREATE TABLE vault_records (
             id TEXT PRIMARY KEY,
             kind TEXT NOT NULL,
             nonce BLOB NOT NULL,
             ciphertext BLOB NOT NULL,
             updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );",
    )
    .unwrap();

    // Derive the v1 key and write a verification ciphertext.
    let kdf = KeyDerivationMetadata::new();
    let key = crate::crypto::derive_key(password, &kdf).unwrap();
    // v1 encrypt = no AAD.
    let verification = encrypt_bytes(V1_VERIFICATION_PLAINTEXT, &key, &[]).unwrap();

    let kdf_json = serde_json::to_string(&kdf).unwrap();
    conn.execute(
        "INSERT INTO vault_header (id, kdf_metadata, verification_nonce, verification_ciphertext)
         VALUES (1, ?1, ?2, ?3)",
        params![kdf_json, verification.nonce, verification.ciphertext],
    )
    .unwrap();

    // Encrypt the snapshot record with no AAD (v1 style).
    let snapshot_bytes = serde_json::to_vec(snapshot).unwrap();
    let encrypted = encrypt_bytes(&snapshot_bytes, &key, &[]).unwrap();
    conn.execute(
        "INSERT INTO vault_records (id, kind, nonce, ciphertext) VALUES (?1, ?2, ?3, ?4)",
        params!["vault_snapshot", "vault_snapshot", encrypted.nonce, encrypted.ciphertext],
    )
    .unwrap();

    // Checkpoint so the file is self-contained (no WAL needed to read).
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").unwrap();
}

/// Write a v1-style attachment .bin file: JSON-serialised EncryptedBytes with no AAD.
fn write_v1_attachment(dir: &std::path::Path, id: &str, plaintext: &[u8], key: &[u8; KEY_LEN]) {
    let att_dir = dir.join("attachments");
    fs::create_dir_all(&att_dir).unwrap();
    let encrypted = encrypt_bytes(plaintext, key, &[]).unwrap();
    let envelope = serde_json::to_vec(&encrypted).unwrap();
    fs::write(att_dir.join(format!("{id}.bin")), envelope).unwrap();
}

fn make_v2_session(dir: &std::path::Path) -> (VaultSession, std::path::PathBuf) {
    let vault_path = dir.join("v2.sqlite3");
    let mut session = VaultSession::new(vault_path.clone());
    create_vault_at_path(&vault_path, &mut session, V2_PASSWORD, "Test User").unwrap();
    let snapshot = serde_json::json!({ "snapshotFormat": 1, "schemaVersion": 1, "profile": {}, "values": {}, "sectionMeta": {} });
    save_vault_snapshot_for_session(&mut session, &snapshot, 0).unwrap();
    (session, vault_path)
}

// ---------------------------------------------------------------------------
// Happy path: snapshot fields preserved, executor present.
// ---------------------------------------------------------------------------

#[test]
fn import_v1_snapshot_roundtrip() {
    let dir = tempdir().unwrap();
    let v1_dir = dir.path().join("v1");
    fs::create_dir_all(&v1_dir).unwrap();

    let v1_snapshot = serde_json::json!({
        "profile": { "ownerName": "Alice" },
        "people": [
            { "id": "p1", "role": "primary_executor", "fullName": "Bob Smith", "relationship": "spouse", "contact": "bob@example.com", "informed": true }
        ],
        "passwordManagerPlans": [],
        "documents": [],
        "backups": [],
        "attachments": [],
        "responsibilities": [],
        "recoveryKit": null,
        "encryptedBackups": []
    });
    make_v1_vault(&v1_dir, V1_PASSWORD, &v1_snapshot);

    let (session, v2_vault_path) = make_v2_session(dir.path());
    let v2_att_dir = attachment_dir(&v2_vault_path);

    let result: V1ImportResult = import_v1_snapshot(
        &v1_dir.join("vault.sqlite3"),
        V1_PASSWORD,
        &v2_att_dir,
        session.key.as_ref().unwrap(),
        session.vault_id.as_deref().unwrap(),
    )
    .unwrap();

    assert_eq!(result.snapshot["people"][0]["fullName"], "Bob Smith");
    assert_eq!(result.snapshot["people"][0]["role"], "primary_executor");
    assert!(result.attachments.is_empty());
}

// ---------------------------------------------------------------------------
// Error path: wrong v1 password.
// ---------------------------------------------------------------------------

#[test]
fn wrong_password_returns_invalid_master_password() {
    let dir = tempdir().unwrap();
    let v1_dir = dir.path().join("v1");
    fs::create_dir_all(&v1_dir).unwrap();

    make_v1_vault(&v1_dir, V1_PASSWORD, &serde_json::json!({}));

    let (session, v2_vault_path) = make_v2_session(dir.path());
    let v2_att_dir = attachment_dir(&v2_vault_path);

    let result = import_v1_snapshot(
        &v1_dir.join("vault.sqlite3"),
        "wrong-password",
        &v2_att_dir,
        session.key.as_ref().unwrap(),
        session.vault_id.as_deref().unwrap(),
    );
    assert!(matches!(result, Err(crate::error::VaultError::InvalidMasterPassword)));
}

// ---------------------------------------------------------------------------
// Error path: v1 vault file does not exist.
// ---------------------------------------------------------------------------

#[test]
fn missing_vault_file_returns_error() {
    let dir = tempdir().unwrap();
    let (session, v2_vault_path) = make_v2_session(dir.path());
    let v2_att_dir = attachment_dir(&v2_vault_path);

    let result = import_v1_snapshot(
        &dir.path().join("nonexistent.sqlite3"),
        V1_PASSWORD,
        &v2_att_dir,
        session.key.as_ref().unwrap(),
        session.vault_id.as_deref().unwrap(),
    );
    assert!(result.is_err());
}

// ---------------------------------------------------------------------------
// Edge case: v1 vault directory byte-identical after import.
// ---------------------------------------------------------------------------

#[test]
fn v1_vault_files_unchanged_after_import() {
    let dir = tempdir().unwrap();
    let v1_dir = dir.path().join("v1");
    fs::create_dir_all(&v1_dir).unwrap();

    let v1_snapshot = serde_json::json!({ "profile": {}, "people": [], "passwordManagerPlans": [], "documents": [], "backups": [], "attachments": [], "responsibilities": [], "recoveryKit": null, "encryptedBackups": [] });
    make_v1_vault(&v1_dir, V1_PASSWORD, &v1_snapshot);

    let vault_path = v1_dir.join("vault.sqlite3");
    let original_bytes = fs::read(&vault_path).unwrap();

    let (session, v2_vault_path) = make_v2_session(dir.path());
    let v2_att_dir = attachment_dir(&v2_vault_path);

    import_v1_snapshot(
        &vault_path,
        V1_PASSWORD,
        &v2_att_dir,
        session.key.as_ref().unwrap(),
        session.vault_id.as_deref().unwrap(),
    )
    .unwrap();

    let after_bytes = fs::read(&vault_path).unwrap();
    assert_eq!(original_bytes, after_bytes, "v1 vault was modified");

    // No WAL or SHM should have been created next to the v1 vault.
    let mut wal_path = vault_path.as_os_str().to_owned();
    wal_path.push("-wal");
    assert!(!std::path::Path::new(&wal_path).exists(), "v1 vault -wal created");
}

// ---------------------------------------------------------------------------
// Edge case: v1 vault with uncommitted WAL frames — those records appear.
// ---------------------------------------------------------------------------

#[test]
fn uncommitted_wal_frames_are_imported() {
    let dir = tempdir().unwrap();
    let v1_dir = dir.path().join("v1");
    fs::create_dir_all(&v1_dir).unwrap();

    let v1_snapshot_original = serde_json::json!({
        "profile": { "ownerName": "Wal Test Original" },
        "people": [], "passwordManagerPlans": [], "documents": [], "backups": [],
        "attachments": [], "responsibilities": [], "recoveryKit": null, "encryptedBackups": []
    });
    make_v1_vault(&v1_dir, V1_PASSWORD, &v1_snapshot_original);

    // Write an updated snapshot into the WAL WITHOUT checkpointing, using the
    // same KDF that make_v1_vault stored (read back from the header).
    {
        let vault_path = v1_dir.join("vault.sqlite3");
        let conn = Connection::open(&vault_path).unwrap();

        // Read the KDF from the header so we derive the same key.
        let kdf_str: String = conn
            .query_row(
                "SELECT kdf_metadata FROM vault_header WHERE id=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let kdf: KeyDerivationMetadata = serde_json::from_str(&kdf_str).unwrap();
        let key = crate::crypto::derive_key(V1_PASSWORD, &kdf).unwrap();

        let updated = serde_json::json!({
            "profile": { "ownerName": "Wal Test Updated" },
            "people": [{ "id": "px", "role": "primary_executor", "fullName": "In WAL", "relationship": "", "contact": "", "informed": false }],
            "passwordManagerPlans": [], "documents": [], "backups": [],
            "attachments": [], "responsibilities": [], "recoveryKit": null, "encryptedBackups": []
        });
        let encrypted = encrypt_bytes(&serde_json::to_vec(&updated).unwrap(), &key, &[]).unwrap();
        conn.execute(
            "UPDATE vault_records SET nonce=?1, ciphertext=?2 WHERE id='vault_snapshot'",
            params![encrypted.nonce, encrypted.ciphertext],
        ).unwrap();
        // Intentionally NOT checkpointing — the updated row sits in the WAL file.
    }

    let (session, v2_vault_path) = make_v2_session(dir.path());
    let v2_att_dir = attachment_dir(&v2_vault_path);

    let result = import_v1_snapshot(
        &v1_dir.join("vault.sqlite3"),
        V1_PASSWORD,
        &v2_att_dir,
        session.key.as_ref().unwrap(),
        session.vault_id.as_deref().unwrap(),
    )
    .unwrap();

    // The WAL frame (updated snapshot) must be included after copy+checkpoint.
    assert_eq!(result.snapshot["people"][0]["fullName"], "In WAL");
    assert_eq!(result.snapshot["profile"]["ownerName"], "Wal Test Updated");
}

// ---------------------------------------------------------------------------
// Happy path: v1 attachment re-encrypted under v2 key.
// ---------------------------------------------------------------------------

#[test]
fn attachments_are_reencrypted_under_v2_key() {
    let dir = tempdir().unwrap();
    let v1_dir = dir.path().join("v1");
    fs::create_dir_all(&v1_dir).unwrap();

    // Derive the v1 key so we can write a v1-style attachment.
    let v1_kdf = KeyDerivationMetadata::new();
    let v1_key = crate::crypto::derive_key(V1_PASSWORD, &v1_kdf).unwrap();

    let att_id = "a1b2c3d4-0000-0000-0000-000000000001";
    let att_plaintext = b"sensitive document contents";
    write_v1_attachment(&v1_dir, att_id, att_plaintext, &v1_key);

    let v1_snapshot = serde_json::json!({
        "profile": {},
        "people": [],
        "passwordManagerPlans": [],
        "documents": [{ "id": "doc1", "title": "Will", "category": "legal", "location": "safe", "attachmentIds": [att_id] }],
        "backups": [],
        "attachments": [{ "id": att_id, "recordId": "doc1", "fileName": "will.pdf", "mimeType": "application/pdf", "sizeBytes": 27, "encryptedPath": "", "createdAt": "2026-01-01T00:00:00Z" }],
        "responsibilities": [],
        "recoveryKit": null,
        "encryptedBackups": []
    });

    // Write the v1 vault with a custom KDF (so the key we used above is correct).
    // We need to use the same kdf we derived above.
    let vault_path = v1_dir.join("vault.sqlite3");
    {
        let conn = Connection::open(&vault_path).unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE vault_header (id INTEGER PRIMARY KEY CHECK (id=1), kdf_metadata TEXT NOT NULL, verification_nonce BLOB NOT NULL, verification_ciphertext BLOB NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
             CREATE TABLE vault_records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, nonce BLOB NOT NULL, ciphertext BLOB NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);",
        ).unwrap();

        let verification = encrypt_bytes(V1_VERIFICATION_PLAINTEXT, &v1_key, &[]).unwrap();
        let kdf_json = serde_json::to_string(&v1_kdf).unwrap();
        conn.execute(
            "INSERT INTO vault_header (id, kdf_metadata, verification_nonce, verification_ciphertext) VALUES (1,?1,?2,?3)",
            params![kdf_json, verification.nonce, verification.ciphertext],
        ).unwrap();

        let snapshot_bytes = serde_json::to_vec(&v1_snapshot).unwrap();
        let encrypted = encrypt_bytes(&snapshot_bytes, &v1_key, &[]).unwrap();
        conn.execute(
            "INSERT INTO vault_records (id, kind, nonce, ciphertext) VALUES (?1,?2,?3,?4)",
            params!["vault_snapshot", "vault_snapshot", encrypted.nonce, encrypted.ciphertext],
        ).unwrap();
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").unwrap();
    }

    let (session, v2_vault_path) = make_v2_session(dir.path());
    let v2_att_dir = attachment_dir(&v2_vault_path);

    let result = import_v1_snapshot(
        &vault_path,
        V1_PASSWORD,
        &v2_att_dir,
        session.key.as_ref().unwrap(),
        session.vault_id.as_deref().unwrap(),
    )
    .unwrap();

    assert_eq!(result.attachments.len(), 1);
    let att = &result.attachments[0];
    assert_eq!(att.v1_id, att_id);
    assert_eq!(att.file_name, "will.pdf");

    // Verify the re-encrypted file can be decrypted with the v2 key.
    let decrypted = decrypt_attachment(
        &v2_att_dir,
        &att.v2_id,
        session.key.as_ref().unwrap(),
        session.vault_id.as_deref().unwrap(),
    )
    .unwrap();
    assert_eq!(decrypted, att_plaintext);
}
