#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;

use std::sync::Mutex;

use tauri::Manager;

use sidecar::{backend_info, spawn_backend, BackendState};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(BackendState {
            ready: Mutex::new(None),
            child: Mutex::new(None),
        })
        .setup(|app| {
            spawn_backend(app.handle()).expect("failed to spawn backend");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![backend_info])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let handle = window.app_handle().clone();
                let bs = handle.state::<BackendState>();
                let child = bs.child.lock().unwrap().take();
                if let Some(child) = child {
                    let _: Result<(), tauri_plugin_shell::Error> = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running LifeScribe Vault");
}
