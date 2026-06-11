use std::path::PathBuf;

use serde_json::json;
use tempfile::{tempdir, TempDir};

use crate::commands::VaultSession;
use crate::crypto::generate_data_key;
use crate::draft_stash::{
    discard_draft_for_session, draft_stash_path, stash_draft_for_session,
    take_draft_for_session,
};
use crate::error::{command_error_code, VaultError};

const VAULT_ID: &str = "draft-test-vault";

fn unlocked_session(dir: &TempDir, generation: u64) -> VaultSession {
    let mut session = VaultSession::new(dir.path().join("vault.sqlite3"));
    session.key = Some(generate_data_key());
    session.vault_id = Some(VAULT_ID.to_string());
    session.loaded_generation = generation;
    session
}

fn dir_entries(dir: &TempDir) -> Vec<PathBuf> {
    std::fs::read_dir(dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect()
}

#[test]
fn stash_then_take_round_trips_the_draft_and_consumes_the_file() {
    let dir = tempdir().unwrap();
    let session = unlocked_session(&dir, 3);
    let draft = json!({
        "draftFormat": 1,
        "savedAt": "2026-06-11T10:00:00Z",
        "sections": [{ "sectionKey": "digital-executors", "values": { "novel": [1, 2, 3] } }]
    });

    stash_draft_for_session(&session, &draft).unwrap();
    let stash_path = draft_stash_path(&session.vault_path);
    assert!(stash_path.exists());

    let taken = take_draft_for_session(&session).unwrap();
    assert_eq!(taken.draft, Some(draft));
    assert!(!taken.corrupt);
    assert!(!taken.stale_generation);
    assert!(taken.stashed_at.is_some());
    // Take-success consumes the stash file.
    assert!(!stash_path.exists());

    // A second take finds nothing.
    let empty = take_draft_for_session(&session).unwrap();
    assert_eq!(empty.draft, None);
    assert!(!empty.corrupt);
}

#[test]
fn no_plaintext_draft_content_in_the_stash_file() {
    let dir = tempdir().unwrap();
    let session = unlocked_session(&dir, 1);
    let marker = "EXTREMELY-DISTINCTIVE-DRAFT-MARKER-0452";
    let draft = json!({ "secretNote": marker });

    stash_draft_for_session(&session, &draft).unwrap();
    let bytes = std::fs::read(draft_stash_path(&session.vault_path)).unwrap();
    let haystack = String::from_utf8_lossy(&bytes);
    assert!(!haystack.contains(marker));
    assert!(!haystack.contains("secretNote"));
}

#[test]
fn corrupt_stash_file_surfaces_corrupt_flag_and_is_retained() {
    let dir = tempdir().unwrap();
    let session = unlocked_session(&dir, 2);
    stash_draft_for_session(&session, &json!({ "a": 1 })).unwrap();

    // Flip ciphertext bytes inside the (valid JSON) stash envelope.
    let stash_path = draft_stash_path(&session.vault_path);
    let mut envelope: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&stash_path).unwrap()).unwrap();
    envelope["body"]["ciphertext"] = json!([1, 2, 3, 4, 5, 6, 7, 8]);
    std::fs::write(&stash_path, serde_json::to_vec(&envelope).unwrap()).unwrap();

    let taken = take_draft_for_session(&session).unwrap();
    assert!(taken.corrupt);
    assert_eq!(taken.draft, None);
    // A corrupt stash never silently vanishes — the file is retained until
    // the frontend explicitly discards it.
    assert!(stash_path.exists());

    // Unparseable garbage is corrupt too.
    std::fs::write(&stash_path, b"not json at all").unwrap();
    let garbage = take_draft_for_session(&session).unwrap();
    assert!(garbage.corrupt);
    assert_eq!(garbage.draft, None);
}

#[test]
fn tampered_generation_metadata_fails_decryption_as_corrupt() {
    let dir = tempdir().unwrap();
    let session = unlocked_session(&dir, 2);
    stash_draft_for_session(&session, &json!({ "a": 1 })).unwrap();

    // The generation is plaintext metadata, but it is bound into the AAD:
    // editing it on disk must fail authentication, not report stale.
    let stash_path = draft_stash_path(&session.vault_path);
    let mut envelope: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&stash_path).unwrap()).unwrap();
    envelope["generation"] = json!(99);
    std::fs::write(&stash_path, serde_json::to_vec(&envelope).unwrap()).unwrap();

    let taken = take_draft_for_session(&session).unwrap();
    assert!(taken.corrupt);
    assert_eq!(taken.draft, None);
}

#[test]
fn draft_stashed_at_a_different_generation_surfaces_stale_flag() {
    let dir = tempdir().unwrap();
    let mut session = unlocked_session(&dir, 3);
    stash_draft_for_session(&session, &json!({ "edit": "pending" })).unwrap();

    // The vault advanced (e.g. restore or another save) before the take.
    session.loaded_generation = 4;
    let taken = take_draft_for_session(&session).unwrap();
    assert!(taken.stale_generation);
    assert!(!taken.corrupt);
    assert_eq!(taken.draft, Some(json!({ "edit": "pending" })));
}

#[test]
fn stash_write_is_atomic_and_leaves_no_temp_file() {
    let dir = tempdir().unwrap();
    let session = unlocked_session(&dir, 1);

    stash_draft_for_session(&session, &json!({ "a": 1 })).unwrap();
    // Overwrite an existing stash too (the replace path).
    stash_draft_for_session(&session, &json!({ "a": 2 })).unwrap();

    let entries = dir_entries(&dir);
    assert_eq!(entries.len(), 1, "only the stash file may remain: {entries:?}");
    assert_eq!(entries[0], draft_stash_path(&session.vault_path));

    let taken = take_draft_for_session(&session).unwrap();
    assert_eq!(taken.draft, Some(json!({ "a": 2 })));
}

#[test]
fn stash_and_take_require_an_unlocked_session() {
    let dir = tempdir().unwrap();
    let locked = VaultSession::new(dir.path().join("vault.sqlite3"));

    let stash_error = stash_draft_for_session(&locked, &json!({ "a": 1 })).unwrap_err();
    assert!(matches!(stash_error, VaultError::Locked));
    assert_eq!(command_error_code(stash_error), "VaultLocked");

    assert!(matches!(
        take_draft_for_session(&locked),
        Err(VaultError::Locked)
    ));
}

#[test]
fn discard_removes_the_stash_and_tolerates_a_missing_one() {
    let dir = tempdir().unwrap();
    let session = unlocked_session(&dir, 1);
    stash_draft_for_session(&session, &json!({ "a": 1 })).unwrap();

    discard_draft_for_session(&session).unwrap();
    assert!(!draft_stash_path(&session.vault_path).exists());

    // Discard with nothing stashed is fine, and works while locked (the
    // post-restore purge runs without a key).
    discard_draft_for_session(&session).unwrap();
    let locked = VaultSession::new(session.vault_path.clone());
    discard_draft_for_session(&locked).unwrap();
}
