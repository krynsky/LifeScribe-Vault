#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;

use std::sync::Mutex;

use sidecar::{backend_info, spawn_backend, BackendState};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(BackendState {
            ready: Mutex::new(None),
            child: Mutex::new(None),
        })
        .setup(|app| {
            spawn_backend(app.handle()).expect("failed to spawn backend");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![backend_info])
        .run(tauri::generate_context!())
        .expect("error while running LifeScribe Vault");
}
