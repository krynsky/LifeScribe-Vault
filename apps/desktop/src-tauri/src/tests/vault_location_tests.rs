//! Vault location pointer + relocation tests, against real files via `tempfile`.

use std::fs;

use tempfile::tempdir;

use crate::vault_location::{
    check_destination, read_location, relocate, remove_entries, resolve_vault_dir, vault_file_in,
    write_location,
};

#[test]
fn resolve_falls_back_to_config_dir_when_no_pointer_exists() {
    let dir = tempdir().unwrap();
    assert_eq!(resolve_vault_dir(dir.path()).unwrap(), dir.path().to_path_buf());
}

#[test]
fn pointer_round_trips() {
    let config = tempdir().unwrap();
    let target = tempdir().unwrap();

    write_location(config.path(), target.path()).unwrap();

    assert_eq!(read_location(config.path()).unwrap(), Some(target.path().to_path_buf()));
    assert_eq!(resolve_vault_dir(config.path()).unwrap(), target.path().to_path_buf());
}

#[test]
fn corrupt_pointer_is_refused_instead_of_falling_back() {
    let config = tempdir().unwrap();
    fs::write(config.path().join("vault-location.json"), b"{ this is not json").unwrap();

    assert!(read_location(config.path()).is_err());
    assert!(resolve_vault_dir(config.path()).is_err());
}

#[test]
fn pointer_with_wrong_shape_is_refused() {
    let config = tempdir().unwrap();
    // Valid JSON, missing the vaultDir key.
    fs::write(config.path().join("vault-location.json"), br#"{"other":1}"#).unwrap();

    assert!(read_location(config.path()).is_err());
}

#[test]
fn future_pointer_version_is_refused() {
    let config = tempdir().unwrap();
    fs::write(
        config.path().join("vault-location.json"),
        br#"{"version":2,"vaultDir":"D:\\FutureVault"}"#,
    )
    .unwrap();

    assert!(matches!(
        read_location(config.path()),
        Err(crate::error::VaultError::VaultLocationTooNew)
    ));
}

#[test]
fn legacy_unversioned_pointer_remains_readable() {
    let config = tempdir().unwrap();
    let target = tempdir().unwrap();
    fs::write(
        config.path().join("vault-location.json"),
        serde_json::to_vec(&serde_json::json!({
            "vaultDir": target.path().to_string_lossy()
        }))
        .unwrap(),
    )
    .unwrap();

    assert_eq!(read_location(config.path()).unwrap(), Some(target.path().to_path_buf()));
}

#[test]
fn write_location_creates_the_config_directory_when_absent() {
    let root = tempdir().unwrap();
    let config = root.path().join("not-yet-created");
    let target = tempdir().unwrap();

    write_location(&config, target.path()).unwrap();

    assert_eq!(read_location(&config).unwrap(), Some(target.path().to_path_buf()));
}

#[test]
fn vault_file_in_appends_the_database_name() {
    let dir = tempdir().unwrap();
    assert_eq!(vault_file_in(dir.path()), dir.path().join("vault.sqlite3"));
}

use crate::commands::{
    create_vault_at_path, get_status_for_session, relocate_vault_for_session,
    set_vault_location_for_session, VaultSession,
};
use crate::error::command_error_code;

const PASSWORD: &str = "test-master-password-relocate";

/// A real vault at `dir`, with one attachment file so the attachments
/// directory is genuinely populated.
fn seed_vault(dir: &std::path::Path) {
    let vault_path = vault_file_in(dir);
    let mut session = VaultSession::new(vault_path.clone());
    create_vault_at_path(&vault_path, &mut session, PASSWORD, "Owner").unwrap();

    let att_dir = crate::attachments::attachment_dir(&vault_path);
    fs::create_dir_all(&att_dir).unwrap();
    fs::write(att_dir.join("abc-123.bin"), b"ciphertext-blob").unwrap();
}

#[test]
fn relocate_moves_the_database_and_attachments_and_the_result_opens() {
    let from = tempdir().unwrap();
    let to = tempdir().unwrap();
    seed_vault(from.path());

    let originals_removed = relocate(from.path(), from.path(), &to.path().join("moved")).unwrap();

    let moved_dir = to.path().join("moved");
    assert!(originals_removed, "originals should be removable in a temp dir");
    assert!(vault_file_in(&moved_dir).exists(), "database must exist at the destination");
    assert!(
        moved_dir.join("attachments").join("abc-123.bin").exists(),
        "attachments must come along",
    );
    assert!(!vault_file_in(from.path()).exists(), "original database must be gone");

    // The moved database must actually open.
    let repo = crate::repository::VaultRepository::open_existing(&vault_file_in(&moved_dir)).unwrap();
    assert!(repo.vault_header_exists().unwrap());
}

#[test]
fn relocate_to_the_same_directory_is_a_no_op_success() {
    let from = tempdir().unwrap();
    seed_vault(from.path());

    assert!(relocate(from.path(), from.path(), from.path()).unwrap());
    assert!(vault_file_in(from.path()).exists(), "vault must be untouched");
}

#[test]
fn relocate_rejects_a_destination_nested_inside_the_source() {
    let from = tempdir().unwrap();
    seed_vault(from.path());

    let nested = from.path().join("inner");
    let error = relocate(from.path(), from.path(), &nested).unwrap_err();

    assert_eq!(command_error_code(error), "InvalidVaultLocation");
    assert!(vault_file_in(from.path()).exists(), "source must be untouched");
}

#[test]
fn relocate_rejects_a_destination_that_contains_the_source() {
    // The mirror of the nesting guard. Without it, picking the PARENT of the
    // vault folder would put the rollback path across the live vault.
    let parent = tempdir().unwrap();
    let from = parent.path().join("vault");
    fs::create_dir_all(&from).unwrap();
    seed_vault(&from);

    let error = relocate(&from, &from, parent.path()).unwrap_err();

    assert_eq!(command_error_code(error), "InvalidVaultLocation");
    assert!(vault_file_in(&from).exists(), "source must be untouched");
}

#[test]
fn relocate_rejects_a_destination_that_already_holds_a_vault() {
    let from = tempdir().unwrap();
    let to = tempdir().unwrap();
    seed_vault(from.path());
    seed_vault(to.path());

    let error = relocate(from.path(), from.path(), to.path()).unwrap_err();

    assert_eq!(command_error_code(error), "VaultAlreadyExists");
    assert!(vault_file_in(from.path()).exists(), "source must be untouched");
}

#[test]
fn relocate_refuses_while_a_restore_is_in_progress() {
    let from = tempdir().unwrap();
    let to = tempdir().unwrap();
    seed_vault(from.path());
    // The marker name is what `restore_in_progress` looks for.
    fs::write(from.path().join(crate::backup::RESTORE_MARKER_NAME), b"{}").unwrap();

    let error = relocate(from.path(), from.path(), &to.path().join("moved")).unwrap_err();

    assert_eq!(command_error_code(error), "RestoreConflict");
    assert!(vault_file_in(from.path()).exists(), "source must be untouched");
}

#[test]
fn relocate_does_not_move_the_pointer_file_when_config_and_vault_dirs_coincide() {
    // The default configuration: vault_dir == config_dir, so the source
    // directory CONTAINS vault-location.json. Dragging it along would leave a
    // stale pointer at the destination.
    let from = tempdir().unwrap();
    let to = tempdir().unwrap();
    seed_vault(from.path());
    write_location(from.path(), from.path()).unwrap();

    relocate(from.path(), from.path(), &to.path().join("moved")).unwrap();

    assert!(
        !to.path().join("moved").join("vault-location.json").exists(),
        "the pointer must never be copied to the destination",
    );
}

#[test]
fn relocate_carries_the_safety_backup_directory_rather_than_stranding_it() {
    // `attachments-safety-backup` is a DIRECTORY, not a file — a plain
    // `fs::copy` over the moved-set list would fail on it.
    let from = tempdir().unwrap();
    let to = tempdir().unwrap();
    seed_vault(from.path());
    let safety_att = from.path().join("attachments-safety-backup");
    fs::create_dir_all(&safety_att).unwrap();
    fs::write(safety_att.join("old.bin"), b"older-ciphertext").unwrap();
    fs::write(from.path().join("vault-safety-backup.sqlite3"), b"older-db").unwrap();

    let moved_dir = to.path().join("moved");
    relocate(from.path(), from.path(), &moved_dir).unwrap();

    assert!(
        moved_dir.join("attachments-safety-backup").join("old.bin").exists(),
        "the safety-backup directory must travel with the vault",
    );
    assert!(moved_dir.join("vault-safety-backup.sqlite3").exists());
    assert!(!safety_att.exists(), "the original safety-backup directory must be gone");
}

#[test]
fn relocate_rejects_a_destination_that_fails_verification() {
    // THE core safety property: the pointer is written only AFTER the moved
    // database is proven to open. If `write_location` ever drifts above the
    // verification block, the final assertion here fails.
    let from = tempdir().unwrap();
    let to = tempdir().unwrap();
    fs::write(vault_file_in(from.path()), b"not-a-sqlite-database").unwrap();

    let error = relocate(from.path(), from.path(), &to.path().join("moved")).unwrap_err();

    assert_eq!(command_error_code(error), "CorruptVault");
    assert!(vault_file_in(from.path()).exists(), "source must be untouched");
    assert!(read_location(from.path()).unwrap().is_none(), "the pointer must NOT be written");
}

#[test]
fn failed_verification_does_not_delete_unrelated_files_at_the_destination() {
    // The destination is a folder the USER PICKED, and the only precheck is
    // "no vault.sqlite3 here" — so it may be full of unrelated documents.
    // Rollback must remove only what this call wrote.
    let from = tempdir().unwrap();
    let to = tempdir().unwrap();
    fs::write(vault_file_in(from.path()), b"not-a-sqlite-database").unwrap();
    let bystander = to.path().join("tax-return-2025.pdf");
    fs::write(&bystander, b"important-user-document").unwrap();

    relocate(from.path(), from.path(), to.path()).unwrap_err();

    assert!(bystander.exists(), "unrelated user files must survive a rollback");
    assert_eq!(fs::read(&bystander).unwrap(), b"important-user-document");
    assert!(to.path().exists(), "the destination directory itself must survive");
    assert!(
        !vault_file_in(to.path()).exists(),
        "the half-copied database must be rolled back so a retry is not blocked",
    );
}

#[test]
fn relocate_stores_a_pointer_without_the_verbatim_prefix() {
    // `fs::canonicalize` yields `\\?\C:\...` on Windows. Explorer and the shell
    // reject that form, and it compares unequal to a folder-picker result.
    let from = tempdir().unwrap();
    let to = tempdir().unwrap();
    seed_vault(from.path());

    relocate(from.path(), from.path(), &to.path().join("moved")).unwrap();

    let stored = read_location(from.path()).unwrap().expect("pointer must be written");
    assert!(
        !stored.to_string_lossy().starts_with(r"\\?\"),
        "stored pointer must not keep the verbatim prefix: {stored:?}",
    );
    assert!(vault_file_in(&stored).exists(), "the stored path must still resolve");
}

#[test]
fn remove_entries_reports_success_when_nothing_is_there() {
    let dir = tempdir().unwrap();
    assert!(remove_entries(dir.path(), &["absent.sqlite3".to_string()]));
}

#[test]
fn remove_entries_removes_both_files_and_directories() {
    let dir = tempdir().unwrap();
    fs::write(dir.path().join("a-file"), b"x").unwrap();
    fs::create_dir_all(dir.path().join("a-dir").join("nested")).unwrap();
    fs::write(dir.path().join("a-dir").join("nested").join("b"), b"y").unwrap();

    let names = vec!["a-file".to_string(), "a-dir".to_string(), "absent".to_string()];
    assert!(remove_entries(dir.path(), &names));

    assert!(!dir.path().join("a-file").exists());
    assert!(!dir.path().join("a-dir").exists());
    assert!(dir.path().exists(), "the containing directory must remain");
}

#[test]
fn session_derives_config_dir_from_the_vault_parent_by_default() {
    let dir = tempdir().unwrap();
    let session = VaultSession::new(vault_file_in(dir.path()));
    assert_eq!(session.config_dir, dir.path().to_path_buf());
}

#[test]
fn session_accepts_an_explicit_config_dir_distinct_from_the_vault_dir() {
    let config = tempdir().unwrap();
    let vault = tempdir().unwrap();
    let session =
        VaultSession::with_config_dir(vault_file_in(vault.path()), config.path().to_path_buf());

    assert_eq!(session.config_dir, config.path().to_path_buf());
    assert_eq!(session.vault_path, vault_file_in(vault.path()));
}

#[test]
fn status_reports_the_vault_directory_and_marks_it_available() {
    let dir = tempdir().unwrap();
    let session = VaultSession::new(vault_file_in(dir.path()));

    let status = get_status_for_session(&session);

    assert_eq!(status.vault_dir, dir.path().to_string_lossy());
    assert!(status.vault_dir_available, "an existing directory is available");
}

#[test]
fn status_marks_a_missing_vault_directory_unavailable() {
    let dir = tempdir().unwrap();
    let missing = dir.path().join("unplugged-drive");
    let session = VaultSession::new(vault_file_in(&missing));

    let status = get_status_for_session(&session);

    assert!(!status.vault_dir_available, "a missing directory is unavailable");
    assert!(!status.vault_exists, "and it certainly holds no vault");
}

#[test]
fn moved_database_still_contains_no_plaintext() {
    let from = tempdir().unwrap();
    let to = tempdir().unwrap();
    seed_vault(from.path());

    relocate(from.path(), from.path(), &to.path().join("moved")).unwrap();

    let bytes = fs::read(vault_file_in(&to.path().join("moved"))).unwrap();
    let haystack = String::from_utf8_lossy(&bytes);
    assert!(!haystack.contains(PASSWORD), "password must never appear in the file");
    assert!(!haystack.contains("Owner"), "owner name must never appear in the file");
}

#[test]
fn set_location_creates_the_directory_writes_the_pointer_and_repoints_the_session() {
    let config = tempdir().unwrap();
    let target_root = tempdir().unwrap();
    let target = target_root.path().join("new-home");
    let mut session =
        VaultSession::with_config_dir(vault_file_in(config.path()), config.path().to_path_buf());

    let status = set_vault_location_for_session(&mut session, &target).unwrap();

    assert!(target.is_dir(), "the directory is created when absent");
    assert_eq!(read_location(config.path()).unwrap(), Some(target.clone()));
    assert_eq!(session.vault_path, vault_file_in(&target));
    assert!(!status.vault_exists, "an empty folder holds no vault");
    assert!(status.vault_dir_available);
}

#[test]
fn set_location_reports_an_existing_vault_so_the_ui_can_offer_unlock() {
    let config = tempdir().unwrap();
    let target = tempdir().unwrap();
    seed_vault(target.path());
    let mut session =
        VaultSession::with_config_dir(vault_file_in(config.path()), config.path().to_path_buf());

    let status = set_vault_location_for_session(&mut session, target.path()).unwrap();

    assert!(status.vault_exists, "the caller routes to unlock on this");
    assert!(!status.unlocked);
}

#[test]
fn set_location_refuses_while_unlocked() {
    let config = tempdir().unwrap();
    let target = tempdir().unwrap();
    let vault_path = vault_file_in(config.path());
    let mut session =
        VaultSession::with_config_dir(vault_path.clone(), config.path().to_path_buf());
    create_vault_at_path(&vault_path, &mut session, PASSWORD, "Owner").unwrap();
    assert!(session.is_unlocked(), "create leaves the session unlocked");

    let error = set_vault_location_for_session(&mut session, target.path()).unwrap_err();

    assert_eq!(command_error_code(error), "VaultLocked");
    assert_eq!(session.vault_path, vault_path, "session must not be repointed");
}

#[test]
fn relocate_command_moves_the_vault_and_repoints_the_session() {
    let home = tempdir().unwrap();
    let target_root = tempdir().unwrap();
    let target = target_root.path().join("moved");
    seed_vault(home.path());
    let mut session =
        VaultSession::with_config_dir(vault_file_in(home.path()), home.path().to_path_buf());

    let response = relocate_vault_for_session(&mut session, &target).unwrap();

    assert_eq!(response.vault_dir, target.to_string_lossy());
    assert!(response.originals_removed);
    assert_eq!(session.vault_path, vault_file_in(&target));
    let stored = read_location(home.path()).unwrap().expect("pointer must be written");
    assert_eq!(
        fs::canonicalize(&stored).unwrap(),
        fs::canonicalize(&target).unwrap(),
        "pointer must name the destination",
    );
    assert!(vault_file_in(&target).exists());
}

#[test]
fn relocate_command_refuses_while_unlocked() {
    let home = tempdir().unwrap();
    let target = tempdir().unwrap();
    let vault_path = vault_file_in(home.path());
    let mut session =
        VaultSession::with_config_dir(vault_path.clone(), home.path().to_path_buf());
    create_vault_at_path(&vault_path, &mut session, PASSWORD, "Owner").unwrap();

    let error = relocate_vault_for_session(&mut session, target.path()).unwrap_err();

    assert_eq!(command_error_code(error), "VaultLocked");
    assert_eq!(session.vault_path, vault_path, "session must not be repointed");
}

// ---------------------------------------------------------------------------
// The pre-flight destination check. Same rules as `relocate`, no data moved —
// so the UI can reject a bad folder before charging a password re-entry.
// ---------------------------------------------------------------------------

#[test]
fn check_destination_accepts_a_usable_empty_folder_and_leaves_no_probe_behind() {
    let from = tempdir().unwrap();
    let to_root = tempdir().unwrap();
    let to = to_root.path().join("new-home");
    seed_vault(from.path());

    check_destination(from.path(), &to).expect("an empty writable folder is usable");

    assert!(to.is_dir(), "the folder is created when the picker names a new one");
    let leftovers: Vec<_> = fs::read_dir(&to).unwrap().map(|e| e.unwrap().file_name()).collect();
    assert!(leftovers.is_empty(), "the write probe must be cleaned up: {leftovers:?}");
}

#[test]
fn check_destination_agrees_with_relocate_that_the_same_directory_is_fine() {
    // Must stay a SUCCESS: `relocate` treats it as a no-op, and a pre-flight
    // that rejected it would block a harmless re-pick of the current folder.
    let from = tempdir().unwrap();
    seed_vault(from.path());

    check_destination(from.path(), from.path())
        .expect("the same directory is a no-op, not an error");
}

#[test]
fn check_destination_rejects_nesting_in_both_directions_without_moving_anything() {
    let parent = tempdir().unwrap();
    let from = parent.path().join("vault");
    fs::create_dir_all(&from).unwrap();
    seed_vault(&from);

    let inside = check_destination(&from, &from.join("inner")).unwrap_err();
    assert_eq!(command_error_code(inside), "InvalidVaultLocation");

    let containing = check_destination(&from, parent.path()).unwrap_err();
    assert_eq!(command_error_code(containing), "InvalidVaultLocation");

    assert!(vault_file_in(&from).exists(), "nothing is moved by a check");
}

#[test]
fn check_destination_rejects_a_folder_that_already_holds_a_vault() {
    let from = tempdir().unwrap();
    let to = tempdir().unwrap();
    seed_vault(from.path());
    seed_vault(to.path());

    let error = check_destination(from.path(), to.path()).unwrap_err();

    assert_eq!(command_error_code(error), "VaultAlreadyExists");
}

#[test]
fn check_destination_refuses_while_a_restore_is_in_progress() {
    let from = tempdir().unwrap();
    let to = tempdir().unwrap();
    seed_vault(from.path());
    fs::write(from.path().join(crate::backup::RESTORE_MARKER_NAME), b"{}").unwrap();

    let error = check_destination(from.path(), to.path()).unwrap_err();

    assert_eq!(command_error_code(error), "RestoreConflict");
}

#[test]
fn check_destination_refuses_a_destination_it_cannot_write_to() {
    // Stands in for the not-writable refusal. A genuinely read-only directory
    // cannot be produced portably (on Windows the read-only attribute does not
    // stop writes INTO a directory, and ACL edits are not portable), so this
    // exercises the same fail-before-touching-anything path with a destination
    // whose parent is a FILE: creation fails and the check errors out before
    // any copying could begin.
    let from = tempdir().unwrap();
    let blocker_root = tempdir().unwrap();
    let blocker = blocker_root.path().join("not-a-directory");
    fs::write(&blocker, b"file").unwrap();
    seed_vault(from.path());

    let error = check_destination(from.path(), &blocker.join("child")).unwrap_err();

    assert_eq!(command_error_code(error), "StorageError");
    assert!(vault_file_in(from.path()).exists(), "source must be untouched");
}
