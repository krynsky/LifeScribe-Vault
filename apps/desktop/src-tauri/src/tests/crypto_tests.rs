use crate::crypto::{
    content_aad, decrypt_bytes, derive_key, encrypt_bytes, generate_data_key, key_wrap_aad,
    unwrap_data_key, wrap_data_key, AadDomain, KeyDerivationMetadata, WRAP_FORMAT_VERSION,
};
use crate::error::VaultError;

fn test_metadata() -> KeyDerivationMetadata {
    KeyDerivationMetadata {
        salt: b"test-salt-16byte".to_vec(),
        memory_cost_kib: 19 * 1024,
        time_cost: 1,
        parallelism: 1,
    }
}

#[test]
fn default_metadata_uses_v1_params_and_random_salt() {
    let first = KeyDerivationMetadata::new();
    let second = KeyDerivationMetadata::new();

    assert_eq!(first.memory_cost_kib, 64 * 1024);
    assert_eq!(first.time_cost, 3);
    assert_eq!(first.parallelism, 1);
    assert_eq!(first.salt.len(), 16);
    assert_ne!(first.salt, second.salt);
}

#[test]
fn kdf_metadata_outside_bounds_is_rejected() {
    let cases: Vec<Box<dyn Fn(&mut KeyDerivationMetadata)>> = vec![
        Box::new(|m| m.salt = b"too-short".to_vec()),
        Box::new(|m| m.memory_cost_kib = (19 * 1024) - 1),
        Box::new(|m| m.memory_cost_kib = (1024 * 1024) + 1),
        Box::new(|m| m.time_cost = 0),
        Box::new(|m| m.time_cost = 11),
        Box::new(|m| m.parallelism = 0),
        Box::new(|m| m.parallelism = 17),
    ];

    for mutate in cases {
        let mut metadata = test_metadata();
        mutate(&mut metadata);
        assert!(matches!(
            derive_key("password", &metadata),
            Err(VaultError::CorruptVault)
        ));
    }
}

#[test]
fn generated_data_keys_differ() {
    let first = generate_data_key();
    let second = generate_data_key();
    assert_ne!(first.as_ref(), second.as_ref());
}

#[test]
fn aead_round_trips_with_aad() {
    let key = generate_data_key();
    let aad = content_aad(AadDomain::Snapshot, "vault-a", "generation:1");
    let encrypted = encrypt_bytes(b"executor instructions", &key, &aad).unwrap();
    let decrypted = decrypt_bytes(&encrypted, &key, &aad).unwrap();

    assert_eq!(decrypted, b"executor instructions");
    assert_ne!(encrypted.ciphertext.as_slice(), b"executor instructions");
    assert_eq!(encrypted.nonce.len(), 24);
}

#[test]
fn two_encryptions_of_identical_plaintext_yield_distinct_nonces_and_ciphertexts() {
    let key = generate_data_key();
    let aad = content_aad(AadDomain::Snapshot, "vault-a", "generation:1");
    let first = encrypt_bytes(b"identical plaintext", &key, &aad).unwrap();
    let second = encrypt_bytes(b"identical plaintext", &key, &aad).unwrap();

    assert_ne!(first.nonce, second.nonce);
    assert_ne!(first.ciphertext, second.ciphertext);
}

#[test]
fn ciphertext_tampering_fails_to_decrypt() {
    let key = generate_data_key();
    let aad = content_aad(AadDomain::Snapshot, "vault-a", "generation:1");
    let mut encrypted = encrypt_bytes(b"private data", &key, &aad).unwrap();
    encrypted.ciphertext[0] ^= 0x01;

    assert!(matches!(
        decrypt_bytes(&encrypted, &key, &aad),
        Err(VaultError::DecryptionFailed)
    ));
}

#[test]
fn content_blob_presented_under_different_domain_tag_fails_authentication() {
    let key = generate_data_key();
    let snapshot_aad = content_aad(AadDomain::Snapshot, "vault-a", "generation:1");
    let encrypted = encrypt_bytes(b"snapshot body", &key, &snapshot_aad).unwrap();

    for domain in [AadDomain::Attachment, AadDomain::Draft, AadDomain::Backup] {
        let spliced_aad = content_aad(domain, "vault-a", "generation:1");
        assert!(matches!(
            decrypt_bytes(&encrypted, &key, &spliced_aad),
            Err(VaultError::DecryptionFailed)
        ));
    }
}

#[test]
fn content_blob_presented_under_different_vault_or_record_identity_fails_authentication() {
    let key = generate_data_key();
    let aad = content_aad(AadDomain::Snapshot, "vault-a", "generation:1");
    let encrypted = encrypt_bytes(b"snapshot body", &key, &aad).unwrap();

    let other_vault = content_aad(AadDomain::Snapshot, "vault-b", "generation:1");
    assert!(matches!(
        decrypt_bytes(&encrypted, &key, &other_vault),
        Err(VaultError::DecryptionFailed)
    ));

    let other_record = content_aad(AadDomain::Snapshot, "vault-a", "generation:2");
    assert!(matches!(
        decrypt_bytes(&encrypted, &key, &other_record),
        Err(VaultError::DecryptionFailed)
    ));
}

#[test]
fn aad_components_are_unambiguous_not_mere_concatenation() {
    // "vault-a" + "generation:1" must not collide with "vault-ag" + "eneration:1".
    let a = content_aad(AadDomain::Snapshot, "vault-a", "generation:1");
    let b = content_aad(AadDomain::Snapshot, "vault-ag", "eneration:1");
    assert_ne!(a, b);
}

#[test]
fn wrapped_data_key_round_trips_with_correct_password() {
    let metadata = test_metadata();
    let data_key = generate_data_key();
    let wrapped =
        wrap_data_key("correct horse", &metadata, WRAP_FORMAT_VERSION, &data_key).unwrap();

    let unwrapped =
        unwrap_data_key("correct horse", &metadata, WRAP_FORMAT_VERSION, &wrapped).unwrap();
    assert_eq!(unwrapped.as_ref(), data_key.as_ref());
    assert_ne!(wrapped.ciphertext.as_slice(), data_key.as_ref());
}

#[test]
fn wrapped_data_key_rejects_wrong_password() {
    let metadata = test_metadata();
    let data_key = generate_data_key();
    let wrapped =
        wrap_data_key("correct horse", &metadata, WRAP_FORMAT_VERSION, &data_key).unwrap();

    assert!(matches!(
        unwrap_data_key("wrong horse", &metadata, WRAP_FORMAT_VERSION, &wrapped),
        Err(VaultError::DecryptionFailed)
    ));
}

#[test]
fn tampered_kdf_params_fail_key_unwrap_downgrade_resistance() {
    let metadata = test_metadata();
    let data_key = generate_data_key();
    let wrapped =
        wrap_data_key("correct horse", &metadata, WRAP_FORMAT_VERSION, &data_key).unwrap();

    // Attacker rewrites on-disk KDF params (still within validated bounds)
    // hoping to weaken derivation: the key-wrap AAD binds the real params.
    let mut weakened = metadata.clone();
    weakened.time_cost = 2;
    assert!(unwrap_data_key("correct horse", &weakened, WRAP_FORMAT_VERSION, &wrapped).is_err());

    let mut salt_swapped = metadata.clone();
    salt_swapped.salt = b"other-salt-16byt".to_vec();
    assert!(
        unwrap_data_key("correct horse", &salt_swapped, WRAP_FORMAT_VERSION, &wrapped).is_err()
    );
}

#[test]
fn tampered_wrap_format_version_fails_key_unwrap() {
    let metadata = test_metadata();
    let data_key = generate_data_key();
    let wrapped =
        wrap_data_key("correct horse", &metadata, WRAP_FORMAT_VERSION, &data_key).unwrap();

    assert!(matches!(
        unwrap_data_key("correct horse", &metadata, WRAP_FORMAT_VERSION + 1, &wrapped),
        Err(VaultError::DecryptionFailed)
    ));
}

#[test]
fn key_wrap_aad_changes_with_every_bound_component() {
    let metadata = test_metadata();
    let baseline = key_wrap_aad(&metadata, WRAP_FORMAT_VERSION);

    assert_ne!(baseline, key_wrap_aad(&metadata, WRAP_FORMAT_VERSION + 1));

    let mut other = metadata.clone();
    other.memory_cost_kib += 1;
    assert_ne!(baseline, key_wrap_aad(&other, WRAP_FORMAT_VERSION));

    let mut other = metadata.clone();
    other.time_cost += 1;
    assert_ne!(baseline, key_wrap_aad(&other, WRAP_FORMAT_VERSION));

    let mut other = metadata.clone();
    other.parallelism += 1;
    assert_ne!(baseline, key_wrap_aad(&other, WRAP_FORMAT_VERSION));

    let mut other = metadata.clone();
    other.salt = b"other-salt-16byt".to_vec();
    assert_ne!(baseline, key_wrap_aad(&other, WRAP_FORMAT_VERSION));
}

#[test]
fn invalid_nonce_length_fails_without_panicking() {
    let key = generate_data_key();
    let aad = content_aad(AadDomain::Snapshot, "vault-a", "generation:1");
    let encrypted = crate::crypto::EncryptedBytes {
        nonce: vec![0_u8; 12],
        ciphertext: b"not valid ciphertext".to_vec(),
    };

    assert!(matches!(
        decrypt_bytes(&encrypted, &key, &aad),
        Err(VaultError::DecryptionFailed)
    ));
}
