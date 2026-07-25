//! Bundled form-definition pack resources (U6).
//!
//! The frontend has no filesystem scope, so the default pack ships as a
//! Tauri bundle resource and is read through this command. Rust returns the
//! RAW JSON string without parsing or interpreting it — the pack is
//! UNTRUSTED INPUT and the frontend's `validatePack` is the single
//! validation gate (never silent acceptance, never partial loads).
//!
//! Dev builds read from the source `resources/` directory next to the crate
//! manifest so pack edits hot-reload without re-bundling; release builds
//! resolve the bundled resource via Tauri's path resolver.

use std::path::{Path, PathBuf};

use crate::error::{command_error_code, VaultError, VaultResult};

/// Resource-relative path of the default pack (also the bundle key in
/// `tauri.conf.json` > `bundle.resources`).
pub const DEFAULT_PACK_RESOURCE: &str = "resources/packs/default-pack.json";

// ---------------------------------------------------------------------------
// Testable core
// ---------------------------------------------------------------------------

/// Read a pack file at an explicit path and return the raw JSON string.
/// Missing file -> `NotFound`; any other IO failure -> `FileOperation`.
/// The content is never parsed here — validation happens in the frontend.
pub fn read_pack_at_path(pack_path: &Path) -> VaultResult<String> {
    match std::fs::read_to_string(pack_path) {
        Ok(content) => Ok(content),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err(VaultError::NotFound),
        Err(error) => Err(VaultError::FileOperation(error.to_string())),
    }
}

/// Dev-mode pack path: the source `resources/` dir next to Cargo.toml, so
/// editing the JSON hot-reloads in `npm run dev` without re-bundling.
#[cfg(debug_assertions)]
fn default_pack_path(_app: &tauri::AppHandle, resource: &str) -> VaultResult<PathBuf> {
    Ok(Path::new(env!("CARGO_MANIFEST_DIR")).join(resource))
}

/// Release pack path: the bundled Tauri resource only.
#[cfg(not(debug_assertions))]
fn default_pack_path(app: &tauri::AppHandle, resource: &str) -> VaultResult<PathBuf> {
    use tauri::path::BaseDirectory;
    use tauri::Manager;

    app.path()
        .resolve(resource, BaseDirectory::Resource)
        .map_err(|error| VaultError::FileOperation(error.to_string()))
}

// ---------------------------------------------------------------------------
// Tauri command wrapper
// ---------------------------------------------------------------------------

/// Return the bundled base pack as a raw JSON string. The frontend validates
/// it as untrusted input before anything renders.
#[tauri::command]
pub fn read_default_pack(app: tauri::AppHandle) -> Result<String, String> {
    let pack_path = default_pack_path(&app, DEFAULT_PACK_RESOURCE).map_err(command_error_code)?;
    read_pack_at_path(&pack_path).map_err(command_error_code)
}

// ---------------------------------------------------------------------------
// Write-back helpers (always compiled — runtime Form Editor toggle controls
// access; no build-time feature gate needed).
// ---------------------------------------------------------------------------

/// Write `content` to `path`, creating parent directories as needed.
pub fn write_pack_at_path(content: &str, path: &std::path::Path) -> VaultResult<()> {
    use std::fs;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| VaultError::FileOperation(e.to_string()))?;
    }
    fs::write(path, content).map_err(|e| VaultError::FileOperation(e.to_string()))
}

/// Overwrite the default-pack source file with `pack_json`.
/// Only useful in a dev environment where CARGO_MANIFEST_DIR resolves to the
/// source tree. In production installs this returns a FileOperation error.
#[tauri::command]
pub fn write_default_pack(pack_json: String) -> Result<(), String> {
    let pack_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(DEFAULT_PACK_RESOURCE);
    write_pack_at_path(&pack_json, &pack_path).map_err(command_error_code)
}
