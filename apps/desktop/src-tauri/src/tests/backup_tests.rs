use std::fs;

use tempfile::tempdir;

use crate::attachments::{attachment_dir, encrypt_attachment};
use crate::backup::{
    clear_restore_marker, corrupt_authenticated_attachment_for_test, create_backup,
    restore_backup, restore_in_progress, rollback_if_marker_present,
    set_authenticated_payload_vault_id_for_test, RestorePhase, RESTORE_MARKER_NAME,
};
use crate::commands::{
    create_vault_at_path, finalize_restore_for_session, load_vault_snapshot_for_session,
    restore_backup_for_session, save_vault_snapshot_for_session, unlock_vault_at_path, VaultSession,
};

const MASTER_PASSWORD: &str = "vault-password-for-backup-tests";

fn create_test_vault(dir: &std::path::Path) -> (VaultSession, std::path::PathBuf) {
    let vault_path = dir.join("vault.sqlite3");
    let mut session = VaultSession::new(vault_path.clone());
    create_vault_at_path(&vault_path, &mut session, MASTER_PASSWORD, "Test User").unwrap();

    // Save an initial snapshot with a known field.
    let snapshot = serde_json::json!({
        "snapshotFormat": 1,
        "schemaVersion": 1,
        "profile": { "ownerName": "Test User", "reviewCadenceMonths": 6 },
        "values": {},
        "sectionMeta": {}
    });
    save_vault_snapshot_for_session(&mut session, &snapshot, 0).unwrap();
    (session, vault_path)
}

// ---------------------------------------------------------------------------
// Happy path: backup → wipe app data → restore → identical snapshot.
// ---------------------------------------------------------------------------

#[test]
fn backup_and_restore_round_trip_snapshot() {
    let dir = tempdir().unwrap();
    let app_data_dir = dir.path();
    // The original session is discarded on purpose: after backup + restore,
    // the test unlocks a FRESH session below, simulating a real close-and-
    // reopen rather than reusing in-memory state that a restart wouldn't have.
    let (_session, vault_path) = create_test_vault(app_data_dir);
    let att_dir = attachment_dir(&vault_path);

    // Create backup.
    let dest = dir.path().join("backups");
    let backup_result = create_backup(&vault_path, &att_dir, MASTER_PASSWORD, &dest).unwrap();
    assert!(backup_result.output_path.exists());

    // Restore over the existing vault (the common use case).
    let restore_result = restore_backup(
        &backup_result.output_path,
        MASTER_PASSWORD,
        &vault_path,
        &att_dir,
        app_data_dir,
    )
    .unwrap();
    assert!(vault_path.exists());
    // Safety backup is created (vault existed before the swap).
    assert!(restore_result.safety_backup_db.exists());

    // Authentication alone retains recovery. Full snapshot loading followed by
    // explicit finalization clears the marker and safety copy.
    let mut fresh_session = VaultSession::new(vault_path.clone());
    unlock_vault_at_path(&vault_path, &mut fresh_session, MASTER_PASSWORD).unwrap();
    assert!(app_data_dir.join(RESTORE_MARKER_NAME).exists());

    // Load and verify snapshot survived.
    let load = load_vault_snapshot_for_session(&mut fresh_session).unwrap();
    assert_eq!(load.snapshot["profile"]["ownerName"], "Test User");
    finalize_restore_for_session(&fresh_session).unwrap();
    assert!(!app_data_dir.join(RESTORE_MARKER_NAME).exists());
    assert!(!restore_result.safety_backup_db.exists());
}

// ---------------------------------------------------------------------------
// Happy path: backup + attachments round trip.
// ---------------------------------------------------------------------------

#[test]
fn backup_and_restore_with_attachments() {
    let dir = tempdir().unwrap();
    let app_data_dir = dir.path();
    let (session, vault_path) = create_test_vault(app_data_dir);
    let att_dir = attachment_dir(&vault_path);

    // Create an attachment.
    let source = dir.path().join("doc.txt");
    fs::write(&source, b"important document").unwrap();
    let key = session.key.as_ref().unwrap();
    let vault_id = session.vault_id.as_deref().unwrap();
    let att_meta = encrypt_attachment(&source, &att_dir, key, vault_id).unwrap();
    let bin_path = att_dir.join(format!("{}.bin", att_meta.id));
    let original_bytes = fs::read(&bin_path).unwrap();

    // Create backup.
    let dest = dir.path().join("backups");
    let backup_result = create_backup(&vault_path, &att_dir, MASTER_PASSWORD, &dest).unwrap();

    // Wipe vault + attachments.
    fs::remove_file(&vault_path).unwrap();
    fs::remove_dir_all(&att_dir).unwrap();

    // Restore.
    restore_backup(
        &backup_result.output_path,
        MASTER_PASSWORD,
        &vault_path,
        &att_dir,
        app_data_dir,
    )
    .unwrap();

    // Attachment file should be back.
    let restored_bytes = fs::read(&bin_path).unwrap();
    assert_eq!(original_bytes, restored_bytes);
}

// ---------------------------------------------------------------------------
// Envelope property: old backup opens with old password after KDF change
// (simulated by using a different password for the vault vs backup).
// ---------------------------------------------------------------------------

#[test]
fn old_backup_opens_with_old_password() {
    let dir = tempdir().unwrap();
    let app_data_dir = dir.path();
    let (_, vault_path) = create_test_vault(app_data_dir);
    let att_dir = attachment_dir(&vault_path);

    let dest = dir.path().join("backups");
    // The backup was created with the MASTER_PASSWORD.
    let backup_result = create_backup(&vault_path, &att_dir, MASTER_PASSWORD, &dest).unwrap();

    // New password simulates a password change (just used to demonstrate the wrong-pw path).
    let wrong_pw_result = restore_backup(
        &backup_result.output_path,
        "wrong-new-password",
        &vault_path,
        &att_dir,
        app_data_dir,
    );
    // Wrong password must fail authentication.
    assert!(wrong_pw_result.is_err());

    // Original password works.
    let ok_result = restore_backup(
        &backup_result.output_path,
        MASTER_PASSWORD,
        &vault_path,
        &att_dir,
        app_data_dir,
    );
    assert!(ok_result.is_ok());
}

// ---------------------------------------------------------------------------
// Error path: wrong password or truncated backup → existing vault untouched.
// ---------------------------------------------------------------------------

#[test]
fn wrong_password_does_not_touch_vault() {
    let dir = tempdir().unwrap();
    let app_data_dir = dir.path();
    let (_, vault_path) = create_test_vault(app_data_dir);
    let att_dir = attachment_dir(&vault_path);
    let dest = dir.path().join("backups");
    let backup_result = create_backup(&vault_path, &att_dir, MASTER_PASSWORD, &dest).unwrap();

    let vault_bytes_before = fs::read(&vault_path).unwrap();
    let result = restore_backup(
        &backup_result.output_path,
        "wrong-password",
        &vault_path,
        &att_dir,
        app_data_dir,
    );
    assert!(result.is_err());
    // Vault must be byte-identical.
    let vault_bytes_after = fs::read(&vault_path).unwrap();
    assert_eq!(vault_bytes_before, vault_bytes_after);
    // Marker must NOT exist (we failed before touching anything).
    assert!(!app_data_dir.join(RESTORE_MARKER_NAME).exists());
}

#[test]
fn truncated_backup_file_returns_error() {
    let dir = tempdir().unwrap();
    let app_data_dir = dir.path();
    let (_, vault_path) = create_test_vault(app_data_dir);
    let att_dir = attachment_dir(&vault_path);
    let dest = dir.path().join("backups");
    let backup_result = create_backup(&vault_path, &att_dir, MASTER_PASSWORD, &dest).unwrap();

    // Truncate the REAL backup: cut a valid file short, simulating a copy or
    // disk-full failure mid-write. Distinct from restoring an unrelated
    // garbage file — a truncated file carries a genuine (partial) header and
    // must still be rejected, not just any malformed bytes.
    let original_bytes = fs::read(&backup_result.output_path).unwrap();
    assert!(
        original_bytes.len() > 16,
        "backup file is too small to truncate meaningfully"
    );
    fs::write(
        &backup_result.output_path,
        &original_bytes[..original_bytes.len() / 2],
    )
    .unwrap();

    let result = restore_backup(
        &backup_result.output_path,
        MASTER_PASSWORD,
        &vault_path,
        &att_dir,
        app_data_dir,
    );
    assert!(result.is_err());
}

// ---------------------------------------------------------------------------
// Error path: newer-version backup refused; tampered version byte fails AEAD.
// ---------------------------------------------------------------------------

#[test]
fn tampered_payload_version_fails_aead_not_version_check() {
    let dir = tempdir().unwrap();
    let app_data_dir = dir.path();
    let (_, vault_path) = create_test_vault(app_data_dir);
    let att_dir = attachment_dir(&vault_path);
    let dest = dir.path().join("backups");
    let backup_result = create_backup(&vault_path, &att_dir, MASTER_PASSWORD, &dest).unwrap();

    // Flip the first byte of the payload ciphertext array to simulate tampering.
    // EncryptedBytes serialises ciphertext as a JSON array of u8 integers.
    let backup_bytes = fs::read(&backup_result.output_path).unwrap();
    let mut tampered: serde_json::Value = serde_json::from_slice(&backup_bytes).unwrap();
    if let Some(arr) = tampered["payload"]["ciphertext"].as_array_mut() {
        if !arr.is_empty() {
            if let Some(b) = arr[0].as_u64() {
                arr[0] = serde_json::Value::Number((b ^ 0xFF).into());
            }
        }
    }
    let tampered_path = dest.join("tampered.lsvbackup");
    fs::write(&tampered_path, serde_json::to_vec(&tampered).unwrap()).unwrap();

    let result = restore_backup(
        &tampered_path,
        MASTER_PASSWORD,
        &vault_path,
        &att_dir,
        app_data_dir,
    );
    // Must fail as corrupt (AEAD failure), not as BackupVersionTooNew.
    match result {
        Err(crate::error::VaultError::InvalidMasterPassword) => {} // AEAD fail mapped here
        Err(crate::error::VaultError::CorruptVault) => {}
        Err(other) => panic!("unexpected error: {other:?}"),
        Ok(_) => panic!("should have failed"),
    }
}

#[test]
fn authenticated_future_backup_is_refused_before_touching_the_vault() {
    let dir = tempdir().unwrap();
    let (_, vault_path) = create_test_vault(dir.path());
    let att_dir = attachment_dir(&vault_path);
    let backup = create_backup(
        &vault_path,
        &att_dir,
        MASTER_PASSWORD,
        &dir.path().join("backups"),
    )
    .unwrap();
    crate::backup::set_authenticated_payload_version_for_test(
        &backup.output_path,
        MASTER_PASSWORD,
        crate::backup::MAX_BACKUP_PAYLOAD_VERSION + 1,
    )
    .unwrap();
    let before = fs::read(&vault_path).unwrap();

    let result = restore_backup(
        &backup.output_path,
        MASTER_PASSWORD,
        &vault_path,
        &att_dir,
        dir.path(),
    );

    assert!(matches!(result, Err(crate::error::VaultError::BackupVersionTooNew)));
    assert_eq!(fs::read(&vault_path).unwrap(), before);
    assert!(!dir.path().join(RESTORE_MARKER_NAME).exists());
}

// ---------------------------------------------------------------------------
// Edge case: restore while restore-in-progress marker exists → RestoreConflict.
// ---------------------------------------------------------------------------

#[test]
fn restore_conflict_when_marker_present() {
    let dir = tempdir().unwrap();
    let app_data_dir = dir.path();
    let (_, vault_path) = create_test_vault(app_data_dir);
    let att_dir = attachment_dir(&vault_path);
    let dest = dir.path().join("backups");
    let backup_result = create_backup(&vault_path, &att_dir, MASTER_PASSWORD, &dest).unwrap();

    // Write a marker directly.
    let marker = crate::backup::RestoreMarker {
        safety_backup_db: app_data_dir.join("safety.sqlite3"),
        safety_backup_att: app_data_dir.join("safety-att"),
        started_at: "2026-01-01T00:00:00Z".to_string(),
        had_vault_db: true,
        phase: crate::backup::RestorePhase::Preparing,
    };
    fs::create_dir_all(&marker.safety_backup_att).unwrap();
    let marker_path = app_data_dir.join(RESTORE_MARKER_NAME);
    fs::write(&marker_path, serde_json::to_vec(&marker).unwrap()).unwrap();

    let result = restore_backup(
        &backup_result.output_path,
        MASTER_PASSWORD,
        &vault_path,
        &att_dir,
        app_data_dir,
    );
    assert!(matches!(
        result,
        Err(crate::error::VaultError::RestoreConflict)
    ));
}

// ---------------------------------------------------------------------------
// Edge case: restore_in_progress returns true while marker exists.
// ---------------------------------------------------------------------------

#[test]
fn restore_in_progress_reflects_marker() {
    let dir = tempdir().unwrap();
    let app_data_dir = dir.path();
    assert!(!restore_in_progress(app_data_dir));

    let marker = crate::backup::RestoreMarker {
        safety_backup_db: app_data_dir.join("safety.sqlite3"),
        safety_backup_att: app_data_dir.join("safety-att"),
        started_at: "2026-01-01T00:00:00Z".to_string(),
        had_vault_db: true,
        phase: crate::backup::RestorePhase::Preparing,
    };
    let marker_path = app_data_dir.join(RESTORE_MARKER_NAME);
    fs::write(&marker_path, serde_json::to_vec(&marker).unwrap()).unwrap();

    assert!(restore_in_progress(app_data_dir));
    clear_restore_marker(app_data_dir);
    assert!(!restore_in_progress(app_data_dir));
}

// ---------------------------------------------------------------------------
// Security: attachment names from a backup payload must be single plain path
// components — a crafted backup can never write outside the attachment dir.
// ---------------------------------------------------------------------------

#[test]
fn attachment_name_component_guard_rejects_traversal() {
    use crate::backup::is_safe_file_component;

    // Legitimate names pass.
    assert!(is_safe_file_component(
        "0b6de292-9f9c-4dbb-8bd5-2e1e59b3a6a5.bin"
    ));
    assert!(is_safe_file_component("plain.bin"));

    // Traversal / separator / drive forms fail closed.
    assert!(!is_safe_file_component(""));
    assert!(!is_safe_file_component("."));
    assert!(!is_safe_file_component(".."));
    assert!(!is_safe_file_component("../evil.bin"));
    assert!(!is_safe_file_component("..\\evil.bin"));
    assert!(!is_safe_file_component("sub/evil.bin"));
    assert!(!is_safe_file_component("sub\\evil.bin"));
    assert!(!is_safe_file_component("C:evil.bin"));
    assert!(!is_safe_file_component("C:\\evil.bin"));
    assert!(!is_safe_file_component("..\\..\\Startup\\evil.exe"));
}

#[test]
fn create_backup_rejects_wrong_current_password_without_writing_output() {
    let dir = tempdir().unwrap();
    let (_, vault_path) = create_test_vault(dir.path());
    let dest = dir.path().join("backups");

    let result = create_backup(
        &vault_path,
        &attachment_dir(&vault_path),
        "definitely-wrong-password",
        &dest,
    );

    assert!(matches!(
        result,
        Err(crate::error::VaultError::InvalidMasterPassword)
    ));
    assert!(!dest.exists() || fs::read_dir(dest).unwrap().next().is_none());
}

#[test]
fn startup_rolls_back_incomplete_restore_even_when_live_db_is_valid() {
    let dir = tempdir().unwrap();
    let (_, vault_path) = create_test_vault(dir.path());
    let original = fs::read(&vault_path).unwrap();
    let safety_db = dir.path().join("safety.sqlite3");
    fs::copy(&vault_path, &safety_db).unwrap();

    // The live DB remains structurally valid but differs from the safety copy.
    let alternate_dir = dir.path().join("alternate");
    fs::create_dir_all(&alternate_dir).unwrap();
    let (_, alternate_path) = create_test_vault(&alternate_dir);
    fs::copy(alternate_path, &vault_path).unwrap();
    let marker = crate::backup::RestoreMarker {
        safety_backup_db: safety_db.clone(),
        safety_backup_att: dir.path().join("safety-att"),
        started_at: "2026-01-01T00:00:00Z".to_string(),
        had_vault_db: true,
        phase: RestorePhase::Preparing,
    };
    fs::create_dir_all(&marker.safety_backup_att).unwrap();
    fs::write(
        dir.path().join(RESTORE_MARKER_NAME),
        serde_json::to_vec(&marker).unwrap(),
    )
    .unwrap();

    assert!(
        rollback_if_marker_present(&vault_path, &attachment_dir(&vault_path), dir.path(),).unwrap()
    );
    assert_eq!(fs::read(&vault_path).unwrap(), original);
    assert!(!dir.path().join(RESTORE_MARKER_NAME).exists());
}

#[test]
fn startup_rolls_back_completed_restore_that_was_not_fully_loaded() {
    let dir = tempdir().unwrap();
    let (_, vault_path) = create_test_vault(dir.path());
    let safety_db = dir.path().join("safety.sqlite3");
    fs::copy(&vault_path, &safety_db).unwrap();
    let marker = crate::backup::RestoreMarker {
        safety_backup_db: safety_db.clone(),
        safety_backup_att: dir.path().join("safety-att"),
        started_at: "2026-01-01T00:00:00Z".to_string(),
        had_vault_db: true,
        phase: RestorePhase::Complete,
    };
    fs::create_dir_all(&marker.safety_backup_att).unwrap();
    fs::write(
        dir.path().join(RESTORE_MARKER_NAME),
        serde_json::to_vec(&marker).unwrap(),
    )
    .unwrap();

    rollback_if_marker_present(&vault_path, &attachment_dir(&vault_path), dir.path()).unwrap();
    assert!(!safety_db.exists());
    assert!(!dir.path().join(RESTORE_MARKER_NAME).exists());
}

#[test]
fn rollback_keeps_live_attachments_when_the_safety_directory_is_missing() {
    let dir = tempdir().unwrap();
    let (session, vault_path) = create_test_vault(dir.path());
    let att_dir = attachment_dir(&vault_path);
    let source = dir.path().join("live.txt");
    fs::write(&source, b"live attachment").unwrap();
    let attachment = encrypt_attachment(
        &source,
        &att_dir,
        session.key.as_ref().unwrap(),
        session.vault_id.as_deref().unwrap(),
    )
    .unwrap();
    let live_path = att_dir.join(format!("{}.bin", attachment.id));
    let original = fs::read(&live_path).unwrap();
    let safety_db = dir.path().join("safety.sqlite3");
    fs::copy(&vault_path, &safety_db).unwrap();
    let marker = crate::backup::RestoreMarker {
        safety_backup_db: safety_db,
        safety_backup_att: dir.path().join("missing-safety-att"),
        started_at: "2026-01-01T00:00:00Z".to_string(),
        had_vault_db: true,
        phase: RestorePhase::Preparing,
    };
    fs::write(
        dir.path().join(RESTORE_MARKER_NAME),
        serde_json::to_vec(&marker).unwrap(),
    )
    .unwrap();

    let result = rollback_if_marker_present(&vault_path, &att_dir, dir.path());

    assert!(matches!(result, Err(crate::error::VaultError::CorruptVault)));
    assert_eq!(fs::read(&live_path).unwrap(), original);
    assert!(dir.path().join(RESTORE_MARKER_NAME).exists());
}

#[test]
fn successful_restore_locks_the_in_memory_session() {
    let dir = tempdir().unwrap();
    let (mut session, vault_path) = create_test_vault(dir.path());
    let backup = create_backup(
        &vault_path,
        &attachment_dir(&vault_path),
        MASTER_PASSWORD,
        &dir.path().join("backups"),
    )
    .unwrap();
    assert!(session.is_unlocked());

    restore_backup_for_session(&mut session, &backup.output_path, MASTER_PASSWORD).unwrap();

    assert!(!session.is_unlocked());
    assert!(session.vault_id.is_none());
}

#[test]
fn restore_rejects_an_authenticated_payload_with_a_different_vault_id() {
    let dir = tempdir().unwrap();
    let (_, vault_path) = create_test_vault(dir.path());
    let original = fs::read(&vault_path).unwrap();
    let backup = create_backup(
        &vault_path,
        &attachment_dir(&vault_path),
        MASTER_PASSWORD,
        &dir.path().join("backups"),
    )
    .unwrap();
    set_authenticated_payload_vault_id_for_test(
        &backup.output_path,
        MASTER_PASSWORD,
        "different-vault-id",
    )
    .unwrap();

    let result = restore_backup(
        &backup.output_path,
        MASTER_PASSWORD,
        &vault_path,
        &attachment_dir(&vault_path),
        dir.path(),
    );

    assert!(matches!(result, Err(crate::error::VaultError::CorruptVault)));
    assert_eq!(fs::read(&vault_path).unwrap(), original);
    assert!(!dir.path().join(RESTORE_MARKER_NAME).exists());
}

#[test]
fn restore_authenticates_every_staged_attachment_before_mutating_live_data() {
    let dir = tempdir().unwrap();
    let (session, vault_path) = create_test_vault(dir.path());
    let att_dir = attachment_dir(&vault_path);
    let source = dir.path().join("evidence.txt");
    fs::write(&source, b"original evidence").unwrap();
    let attachment = encrypt_attachment(
        &source,
        &att_dir,
        session.key.as_ref().unwrap(),
        session.vault_id.as_deref().unwrap(),
    )
    .unwrap();
    let live_path = att_dir.join(format!("{}.bin", attachment.id));
    let original = fs::read(&live_path).unwrap();
    let backup = create_backup(&vault_path, &att_dir, MASTER_PASSWORD, &dir.path().join("backups"))
        .unwrap();
    corrupt_authenticated_attachment_for_test(&backup.output_path, MASTER_PASSWORD).unwrap();

    let result = restore_backup(
        &backup.output_path,
        MASTER_PASSWORD,
        &vault_path,
        &att_dir,
        dir.path(),
    );

    assert!(matches!(result, Err(crate::error::VaultError::CorruptVault)));
    assert_eq!(fs::read(&live_path).unwrap(), original);
    assert!(!dir.path().join(RESTORE_MARKER_NAME).exists());
}
