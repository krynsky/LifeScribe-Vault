use std::path::{Path, PathBuf};

use tempfile::tempdir;
use zeroize::Zeroizing;

use crate::crypto::{generate_data_key, KEY_LEN};
use crate::error::{command_error_code, VaultError};
use crate::repository::{RecordId, SnapshotLoad, VaultRepository, SNAPSHOT_RETAIN_PREVIOUS};

const VAULT_ID: &str = "test-vault-id";

fn open_repo(path: &Path) -> VaultRepository {
    let repo = VaultRepository::create_new(path).unwrap();
    repo.initialize().unwrap();
    repo
}

fn setup() -> (tempfile::TempDir, PathBuf, VaultRepository, Zeroizing<[u8; KEY_LEN]>) {
    let dir = tempdir().unwrap();
    let path = dir.path().join("vault.sqlite3");
    let repo = open_repo(&path);
    let key = generate_data_key();
    (dir, path, repo, key)
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

fn generations_present(path: &Path) -> Vec<u64> {
    let connection = rusqlite::Connection::open(path).unwrap();
    let mut statement = connection
        .prepare("SELECT generation FROM vault_snapshots ORDER BY generation")
        .unwrap();
    let rows = statement
        .query_map([], |row| row.get::<_, u64>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    rows
}

#[test]
fn first_save_and_load_round_trip_with_generation_one() {
    let (_dir, _path, mut repo, key) = setup();
    let body = br#"{"profile":{"ownerName":"Owner"},"novelTopLevelField":[1,2,3]}"#;

    let generation = repo.save_snapshot(body, 0, &key, VAULT_ID).unwrap();
    assert_eq!(generation, 1);

    let SnapshotLoad {
        snapshot_json,
        generation,
        recovered,
    } = repo.load_snapshot(&key, VAULT_ID).unwrap();
    assert_eq!(snapshot_json, body);
    assert_eq!(generation, 1);
    assert!(!recovered);
}

#[test]
fn load_without_any_snapshot_returns_not_found() {
    let (_dir, _path, repo, key) = setup();
    assert!(matches!(
        repo.load_snapshot(&key, VAULT_ID),
        Err(VaultError::NotFound)
    ));
}

#[test]
fn save_with_stale_base_generation_returns_snapshot_conflict_and_leaves_data_unchanged() {
    let (_dir, _path, mut repo, key) = setup();
    repo.save_snapshot(b"{\"v\":1}", 0, &key, VAULT_ID).unwrap();
    repo.save_snapshot(b"{\"v\":2}", 1, &key, VAULT_ID).unwrap();

    // A caller still holding base generation 1 must not blind-overwrite.
    let result = repo.save_snapshot(b"{\"v\":99}", 1, &key, VAULT_ID);
    assert!(matches!(result, Err(VaultError::SnapshotConflict)));
    assert_eq!(
        result.err().map(command_error_code),
        Some("SnapshotConflict".to_string())
    );

    let loaded = repo.load_snapshot(&key, VAULT_ID).unwrap();
    assert_eq!(loaded.snapshot_json, b"{\"v\":2}");
    assert_eq!(loaded.generation, 2);
    assert!(!loaded.recovered);
}

#[test]
fn save_with_base_generation_ahead_of_store_returns_snapshot_conflict() {
    let (_dir, _path, mut repo, key) = setup();
    repo.save_snapshot(b"{\"v\":1}", 0, &key, VAULT_ID).unwrap();

    assert!(matches!(
        repo.save_snapshot(b"{\"v\":2}", 7, &key, VAULT_ID),
        Err(VaultError::SnapshotConflict)
    ));
}

#[test]
fn corrupt_newest_generation_falls_back_to_previous_with_recovered_flag() {
    let (_dir, path, mut repo, key) = setup();
    repo.save_snapshot(b"{\"v\":1}", 0, &key, VAULT_ID).unwrap();
    repo.save_snapshot(b"{\"v\":2}", 1, &key, VAULT_ID).unwrap();
    corrupt_generation(&path, 2);

    let loaded = repo.load_snapshot(&key, VAULT_ID).unwrap();
    assert_eq!(loaded.snapshot_json, b"{\"v\":1}");
    assert_eq!(loaded.generation, 1);
    assert!(loaded.recovered);
}

#[test]
fn all_generations_corrupt_returns_corrupt_vault() {
    let (_dir, path, mut repo, key) = setup();
    repo.save_snapshot(b"{\"v\":1}", 0, &key, VAULT_ID).unwrap();
    corrupt_generation(&path, 1);

    assert!(matches!(
        repo.load_snapshot(&key, VAULT_ID),
        Err(VaultError::CorruptVault)
    ));
}

#[test]
fn save_after_recovered_load_supersedes_corrupt_generations_which_stay_retained() {
    let (_dir, path, mut repo, key) = setup();
    repo.save_snapshot(b"{\"v\":1}", 0, &key, VAULT_ID).unwrap();
    repo.save_snapshot(b"{\"v\":2}", 1, &key, VAULT_ID).unwrap();
    repo.save_snapshot(b"{\"v\":3}", 2, &key, VAULT_ID).unwrap();
    corrupt_generation(&path, 2);
    corrupt_generation(&path, 3);

    // Fallback load recovers generation 1.
    let loaded = repo.load_snapshot(&key, VAULT_ID).unwrap();
    assert_eq!(loaded.generation, 1);
    assert!(loaded.recovered);

    // The next save from base 1 must SUPERSEDE the undecryptable newer
    // generations (not fail CAS forever): it lands as generation 4.
    let new_generation = repo
        .save_snapshot(b"{\"v\":\"recovered-edit\"}", 1, &key, VAULT_ID)
        .unwrap();
    assert_eq!(new_generation, 4);

    let reloaded = repo.load_snapshot(&key, VAULT_ID).unwrap();
    assert_eq!(reloaded.snapshot_json, b"{\"v\":\"recovered-edit\"}");
    assert_eq!(reloaded.generation, 4);
    assert!(!reloaded.recovered);

    // The corrupt generations stay retained inside the window.
    assert_eq!(generations_present(&path), vec![1, 2, 3, 4]);
}

#[test]
fn save_with_stale_base_still_conflicts_when_a_newer_generation_decrypts() {
    let (_dir, path, mut repo, key) = setup();
    repo.save_snapshot(b"{\"v\":1}", 0, &key, VAULT_ID).unwrap();
    repo.save_snapshot(b"{\"v\":2}", 1, &key, VAULT_ID).unwrap();
    repo.save_snapshot(b"{\"v\":3}", 2, &key, VAULT_ID).unwrap();
    // Only the middle generation is corrupt; generation 3 is intact, so a
    // stale base-1 save is a true conflict, not a recovery supersede.
    corrupt_generation(&path, 2);

    assert!(matches!(
        repo.save_snapshot(b"{\"v\":99}", 1, &key, VAULT_ID),
        Err(VaultError::SnapshotConflict)
    ));
}

#[test]
fn older_generations_are_pruned_beyond_retention_window() {
    let (_dir, path, mut repo, key) = setup();
    for base in 0..6 {
        let body = format!("{{\"v\":{}}}", base + 1);
        repo.save_snapshot(body.as_bytes(), base, &key, VAULT_ID)
            .unwrap();
    }

    let retained = generations_present(&path);
    let expected_count = (SNAPSHOT_RETAIN_PREVIOUS + 1) as usize;
    assert_eq!(retained.len(), expected_count);
    assert_eq!(retained, vec![3, 4, 5, 6]);
}

#[test]
fn snapshot_ciphertext_moved_to_another_generation_row_fails_authentication() {
    let (_dir, path, mut repo, key) = setup();
    repo.save_snapshot(b"{\"v\":1}", 0, &key, VAULT_ID).unwrap();
    repo.save_snapshot(b"{\"v\":2}", 1, &key, VAULT_ID).unwrap();

    // Splice generation 1's blob into the generation 2 row: the content AAD
    // binds the generation number, so generation 2 must fail authentication
    // and load must fall back to generation 1 as recovered.
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute(
            "UPDATE vault_snapshots SET nonce = (SELECT nonce FROM vault_snapshots WHERE generation = 1), ciphertext = (SELECT ciphertext FROM vault_snapshots WHERE generation = 1) WHERE generation = 2",
            [],
        )
        .unwrap();
    drop(connection);

    let loaded = repo.load_snapshot(&key, VAULT_ID).unwrap();
    assert_eq!(loaded.snapshot_json, b"{\"v\":1}");
    assert_eq!(loaded.generation, 1);
    assert!(loaded.recovered);
}

#[test]
fn snapshot_from_one_vault_cannot_be_read_under_another_vault_identity() {
    let (_dir, _path, mut repo, key) = setup();
    repo.save_snapshot(b"{\"v\":1}", 0, &key, VAULT_ID).unwrap();

    assert!(matches!(
        repo.load_snapshot(&key, "another-vault-id"),
        Err(VaultError::CorruptVault)
    ));
}

#[test]
fn plaintext_snapshot_content_never_appears_in_db_file_bytes() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("vault.sqlite3");
    let marker = "EXTREMELY-DISTINCTIVE-PLAINTEXT-MARKER-0451";
    {
        let mut repo = open_repo(&path);
        let key = generate_data_key();
        let body = format!("{{\"secretNote\":\"{marker}\"}}");
        repo.save_snapshot(body.as_bytes(), 0, &key, VAULT_ID)
            .unwrap();
        repo.checkpoint_truncate().unwrap();
    }

    for candidate in [
        path.clone(),
        path.with_extension("sqlite3-wal"),
        path.with_extension("sqlite3-shm"),
    ] {
        if candidate.exists() {
            let bytes = std::fs::read(&candidate).unwrap();
            let haystack = String::from_utf8_lossy(&bytes);
            assert!(
                !haystack.contains(marker),
                "plaintext leaked into {}",
                candidate.display()
            );
        }
    }
}

#[test]
fn record_id_validation_accepts_valid_and_rejects_invalid_ids() {
    assert!(RecordId::parse("abc").is_some());
    assert!(RecordId::parse("attachment_01-a").is_some());
    assert_eq!(RecordId::parse("abc").unwrap().as_str(), "abc");

    assert!(RecordId::parse("ab").is_none());
    assert!(RecordId::parse(&"a".repeat(81)).is_none());
    assert!(RecordId::parse("UPPER").is_none());
    assert!(RecordId::parse("has space").is_none());
    assert!(RecordId::parse("dot.dot").is_none());
}
