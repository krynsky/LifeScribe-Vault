//! Vault lifecycle integration tests through the testable command core
//! (`*_at_path` / `*_for_session`), against real SQLite via `tempfile`.
//!
//! Repository-level CAS, retention, fallback, and ciphertext properties are
//! covered in `snapshot_tests.rs`; these tests exercise the same guarantees
//! end to end through the session/command layer.

use std::path::{Path, PathBuf};

use serde_json::json;
use tempfile::tempdir;

use crate::commands::{
    change_vault_password_at_path, create_vault_at_path, get_status_for_session,
    load_vault_snapshot_for_session, lock_session, save_vault_snapshot_for_session, stage_vault,
    staging_path, unlock_vault_at_path, VaultSession,
};
use crate::error::{command_error_code, VaultError};

const PASSWORD: &str = "test-master-password";

fn setup() -> (tempfile::TempDir, PathBuf, VaultSession) {
    let dir = tempdir().unwrap();
    let path = dir.path().join("vault.sqlite3");
    let session = VaultSession::new(path.clone());
    (dir, path, session)
}

fn create(path: &Path, session: &mut VaultSession) {
    create_vault_at_path(path, session, PASSWORD, "Owner Name").unwrap();
}

fn corrupt_generation(path: &Path, generation: u64) {
    let connection = rusqlite::Connection::open(path).unwrap();
    connection
        .execute(
            "UPDATE vault_snapshots SET ciphertext = x'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' WHERE generation = ?1",
            rusqlite::params![generation],
        )
        .unwrap();
}

#[test]
fn status_transitions_across_create_lock_unlock() {
    let (_dir, path, mut session) = setup();

    let status = get_status_for_session(&session);
    assert!(!status.unlocked);
    assert!(!status.vault_exists);

    let status = create_vault_at_path(&path, &mut session, PASSWORD, "Owner").unwrap();
    assert!(status.unlocked);
    assert!(status.vault_exists);

    let status = lock_session(&mut session).unwrap();
    assert!(!status.unlocked);
    assert!(status.vault_exists);
    assert!(session.key.is_none());
    assert!(session.vault_id.is_none());

    let status = unlock_vault_at_path(&path, &mut session, PASSWORD).unwrap();
    assert!(status.unlocked);
    assert!(status.vault_exists);
}

#[test]
fn unlock_without_a_vault_returns_not_found() {
    let (_dir, path, mut session) = setup();
    assert!(matches!(
        unlock_vault_at_path(&path, &mut session, PASSWORD),
        Err(VaultError::NotFound)
    ));
}

#[test]
fn legacy_database_is_stamped_with_current_schema_on_open() {
    let (_dir, path, mut session) = setup();
    create(&path, &mut session);
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.execute_batch("PRAGMA user_version = 0;").unwrap();
    drop(connection);

    crate::repository::VaultRepository::open_existing(&path).unwrap();

    let version: u32 = rusqlite::Connection::open(&path)
        .unwrap()
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, crate::repository::CURRENT_DB_SCHEMA_VERSION);
}

#[test]
fn future_database_schema_is_refused_without_modification() {
    let (_dir, path, mut session) = setup();
    create(&path, &mut session);
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.execute_batch("PRAGMA user_version = 2;").unwrap();
    drop(connection);

    assert!(matches!(
        crate::repository::VaultRepository::open_existing(&path),
        Err(VaultError::VaultDatabaseTooNew)
    ));
    let version: u32 = rusqlite::Connection::open(&path)
        .unwrap()
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, 2);
}

#[test]
fn snapshot_with_unknown_top_level_fields_round_trips_byte_identical_across_lock_unlock() {
    // Regression test for the v1 stripping bug: a mirrored Rust struct
    // silently dropped fields it didn't know about. The opaque
    // `serde_json::Value` passthrough must preserve everything.
    let (_dir, path, mut session) = setup();
    create(&path, &mut session);

    let snapshot = json!({
        "profile": { "ownerName": "Owner Name" },
        "formDefinitions": { "sectionA": { "fields": [1, 2, 3] } },
        "customFieldValues": { "custom.sectionA.note": "kept" },
        "novelTopLevelField": [ { "nested": true }, null, 42.5 ],
        "anotherUnknownKey": "must survive"
    });

    let saved = save_vault_snapshot_for_session(&mut session, &snapshot, 0).unwrap();
    assert_eq!(saved.generation, 1);
    assert_eq!(session.loaded_generation, 1);

    lock_session(&mut session).unwrap();
    unlock_vault_at_path(&path, &mut session, PASSWORD).unwrap();

    let loaded = load_vault_snapshot_for_session(&mut session).unwrap();
    assert_eq!(loaded.generation, 1);
    assert!(!loaded.recovered);
    assert_eq!(loaded.snapshot, snapshot);
    // Byte-identical JSON fidelity, not just structural equality.
    assert_eq!(
        serde_json::to_vec(&loaded.snapshot).unwrap(),
        serde_json::to_vec(&snapshot).unwrap()
    );
}

#[test]
fn unlock_with_wrong_password_returns_invalid_master_password() {
    let (_dir, path, mut session) = setup();
    create(&path, &mut session);
    lock_session(&mut session).unwrap();

    let result = unlock_vault_at_path(&path, &mut session, "wrong-password");
    assert!(matches!(result, Err(VaultError::InvalidMasterPassword)));
    assert_eq!(
        result.err().map(command_error_code),
        Some("InvalidMasterPassword".to_string())
    );
    assert!(!session.is_unlocked());
}

#[test]
fn changing_password_rewraps_the_existing_data_key_without_changing_vault_content() {
    let (_dir, path, mut session) = setup();
    create(&path, &mut session);
    let snapshot = json!({"secret": "preserved", "nested": {"value": 42}});
    save_vault_snapshot_for_session(&mut session, &snapshot, 0).unwrap();

    change_vault_password_at_path(&path, &mut session, PASSWORD, "replacement-master-password")
        .unwrap();
    assert!(session.is_unlocked());
    assert_eq!(
        load_vault_snapshot_for_session(&mut session)
            .unwrap()
            .snapshot,
        snapshot
    );

    lock_session(&mut session).unwrap();
    assert!(matches!(
        unlock_vault_at_path(&path, &mut session, PASSWORD),
        Err(VaultError::InvalidMasterPassword)
    ));
    unlock_vault_at_path(&path, &mut session, "replacement-master-password").unwrap();
    assert_eq!(
        load_vault_snapshot_for_session(&mut session)
            .unwrap()
            .snapshot,
        snapshot
    );
}

#[test]
fn changing_password_with_the_wrong_current_password_leaves_the_old_password_intact() {
    let (_dir, path, mut session) = setup();
    create(&path, &mut session);
    let snapshot = json!({"secret": "still-preserved"});
    save_vault_snapshot_for_session(&mut session, &snapshot, 0).unwrap();

    let result = change_vault_password_at_path(
        &path,
        &mut session,
        "wrong-current-password",
        "replacement-master-password",
    );
    assert!(matches!(result, Err(VaultError::InvalidMasterPassword)));

    lock_session(&mut session).unwrap();
    unlock_vault_at_path(&path, &mut session, PASSWORD).unwrap();
    assert_eq!(
        load_vault_snapshot_for_session(&mut session)
            .unwrap()
            .snapshot,
        snapshot
    );
}

#[test]
fn changing_password_requires_an_unlocked_vault_and_a_strong_new_password() {
    let (_dir, path, mut session) = setup();
    create(&path, &mut session);

    let weak_result =
        change_vault_password_at_path(&path, &mut session, PASSWORD, "too-short");
    assert!(matches!(&weak_result, Err(VaultError::InvalidNewMasterPassword)));
    assert_eq!(
        weak_result.err().map(command_error_code),
        Some("InvalidNewMasterPassword".to_string())
    );

    lock_session(&mut session).unwrap();
    assert!(matches!(
        change_vault_password_at_path(&path, &mut session, PASSWORD, "replacement-master-password"),
        Err(VaultError::Locked)
    ));
}

#[test]
fn create_rejects_a_weak_password_without_touching_the_filesystem() {
    let (_dir, path, mut session) = setup();

    let result = create_vault_at_path(&path, &mut session, "too-short", "Owner");
    assert!(matches!(&result, Err(VaultError::InvalidNewMasterPassword)));
    assert_eq!(
        result.err().map(command_error_code),
        Some("InvalidNewMasterPassword".to_string())
    );
    // The rejection happens before any staging or parent-directory creation.
    assert!(!path.exists());
    assert!(!staging_path(&path).exists());
    assert!(!session.is_unlocked());

    // The same vault path still accepts a compliant password afterwards.
    create_vault_at_path(&path, &mut session, PASSWORD, "Owner").unwrap();
    assert!(session.is_unlocked());
}

#[test]
fn create_when_vault_exists_returns_vault_already_exists() {
    let (_dir, path, mut session) = setup();
    create(&path, &mut session);
    lock_session(&mut session).unwrap();

    let result = create_vault_at_path(&path, &mut session, "another-password", "Owner");
    assert!(matches!(result, Err(VaultError::VaultAlreadyExists)));
    assert_eq!(
        result.err().map(command_error_code),
        Some("VaultAlreadyExists".to_string())
    );
}

#[test]
fn snapshot_commands_while_locked_return_vault_locked() {
    let (_dir, path, mut session) = setup();
    create(&path, &mut session);
    save_vault_snapshot_for_session(&mut session, &json!({"v": 1}), 0).unwrap();
    lock_session(&mut session).unwrap();

    let save_result = save_vault_snapshot_for_session(&mut session, &json!({"v": 2}), 1);
    assert!(matches!(save_result, Err(VaultError::Locked)));
    assert_eq!(
        save_result.err().map(command_error_code),
        Some("VaultLocked".to_string())
    );

    let load_result = load_vault_snapshot_for_session(&mut session);
    assert!(matches!(load_result, Err(VaultError::Locked)));
    assert_eq!(
        load_result.err().map(command_error_code),
        Some("VaultLocked".to_string())
    );
}

#[test]
fn crash_between_staging_and_rename_leaves_no_vault_file() {
    // Atomic-creation property: the vault is staged at a temp path and only
    // renamed into place when fully initialized. Simulate a crash after
    // staging by never performing the rename.
    let (_dir, path, mut session) = setup();
    let stage_path = staging_path(&path);
    let (_data_key, _vault_id) = stage_vault(&stage_path, PASSWORD).unwrap();
    // "Crash" here: the staged file is never renamed to the real path.

    assert!(!path.exists());
    let status = get_status_for_session(&session);
    assert!(!status.vault_exists);

    // A fresh create at the real path still succeeds.
    let status = create_vault_at_path(&path, &mut session, PASSWORD, "Owner").unwrap();
    assert!(status.unlocked);
    assert!(status.vault_exists);
}

#[test]
fn failed_creation_cleans_up_staging_and_leaves_no_vault_file() {
    // Force a failure inside creation: the vault parent "directory" is an
    // existing file, so ensure_parent_dir fails before anything lands.
    let dir = tempdir().unwrap();
    let blocking_file = dir.path().join("not-a-directory");
    std::fs::write(&blocking_file, b"occupied").unwrap();
    let path = blocking_file.join("vault.sqlite3");
    let mut session = VaultSession::new(path.clone());

    let result = create_vault_at_path(&path, &mut session, PASSWORD, "Owner");
    assert!(result.is_err());
    assert!(!path.exists());
    assert!(!session.is_unlocked());

    // No staging leftovers anywhere in the temp dir.
    let leftovers: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
        .filter(|name| name.contains("staging"))
        .collect();
    assert!(leftovers.is_empty(), "staging leftovers: {leftovers:?}");
}

#[test]
fn save_with_stale_base_generation_through_command_core_returns_snapshot_conflict() {
    let (_dir, path, mut session) = setup();
    create(&path, &mut session);
    save_vault_snapshot_for_session(&mut session, &json!({"v": 1}), 0).unwrap();
    save_vault_snapshot_for_session(&mut session, &json!({"v": 2}), 1).unwrap();

    // A stale caller still holding base generation 1 must not overwrite.
    let result = save_vault_snapshot_for_session(&mut session, &json!({"v": 99}), 1);
    assert!(matches!(result, Err(VaultError::SnapshotConflict)));
    assert_eq!(
        result.err().map(command_error_code),
        Some("SnapshotConflict".to_string())
    );

    let loaded = load_vault_snapshot_for_session(&mut session).unwrap();
    assert_eq!(loaded.snapshot, json!({"v": 2}));
    assert_eq!(loaded.generation, 2);
}

#[test]
fn recovered_session_save_supersedes_corrupt_newest_generation() {
    let (_dir, path, mut session) = setup();
    create(&path, &mut session);
    save_vault_snapshot_for_session(&mut session, &json!({"v": 1}), 0).unwrap();
    save_vault_snapshot_for_session(&mut session, &json!({"v": 2}), 1).unwrap();
    lock_session(&mut session).unwrap();
    corrupt_generation(&path, 2);

    // Unlock + load falls back to generation 1, flagging the session recovered.
    unlock_vault_at_path(&path, &mut session, PASSWORD).unwrap();
    let loaded = load_vault_snapshot_for_session(&mut session).unwrap();
    assert_eq!(loaded.generation, 1);
    assert!(loaded.recovered);
    assert_eq!(loaded.snapshot, json!({"v": 1}));
    assert!(session.recovered);
    assert_eq!(session.loaded_generation, 1);

    // The recovered session's next save supersedes the corrupt generation
    // instead of failing CAS forever, landing past it at generation 3.
    let saved =
        save_vault_snapshot_for_session(&mut session, &json!({"v": "recovered-edit"}), 1).unwrap();
    assert_eq!(saved.generation, 3);
    assert!(!session.recovered);

    let reloaded = load_vault_snapshot_for_session(&mut session).unwrap();
    assert_eq!(reloaded.snapshot, json!({"v": "recovered-edit"}));
    assert_eq!(reloaded.generation, 3);
    assert!(!reloaded.recovered);
}

#[test]
fn plaintext_never_appears_in_vault_file_bytes_through_command_path() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("vault.sqlite3");
    let marker = "LIFECYCLE-DISTINCTIVE-PLAINTEXT-MARKER-1138";
    let owner = "DISTINCTIVE-OWNER-NAME-MARKER";

    let mut session = VaultSession::new(path.clone());
    create_vault_at_path(&path, &mut session, PASSWORD, owner).unwrap();
    let snapshot = json!({ "secretNote": marker });
    save_vault_snapshot_for_session(&mut session, &snapshot, 0).unwrap();
    lock_session(&mut session).unwrap();

    // Fold the WAL into the main file, then scan every candidate file.
    crate::repository::VaultRepository::open_existing(&path)
        .unwrap()
        .checkpoint_truncate()
        .unwrap();

    for entry in std::fs::read_dir(dir.path()).unwrap() {
        let candidate = entry.unwrap().path();
        let bytes = std::fs::read(&candidate).unwrap();
        let haystack = String::from_utf8_lossy(&bytes);
        for needle in [marker, owner, PASSWORD] {
            assert!(
                !haystack.contains(needle),
                "plaintext {needle:?} leaked into {}",
                candidate.display()
            );
        }
    }
}
