# v2 Acceptance Checklist

Run this checklist against a **clean Windows profile** (or a freshly wiped `%APPDATA%\com.lifescribe.vault.v2\` directory) before each release build is distributed. Check each item only after direct observation, not by inference.

Record the environment at the top of your run:

| Field | Value |
|---|---|
| Date | |
| Build version | |
| Installer type (MSI / NSIS) | |
| Windows version | |
| Profile / machine | |
| Tester | |

---

## 1. Clean install

- [ ] Run the installer on a machine with no prior `com.lifescribe.vault.v2` app-data directory.
- [ ] Installation completes without errors or privilege prompts beyond UAC.
- [ ] App launches from Start menu / desktop shortcut.
- [ ] No WebView2 install prompt (WebView2 skip mode is set in `tauri.conf.json`).

## 2. First-run setup wizard

- [ ] Unlock screen appears with "Create vault" option.
- [ ] Create a vault with a strong test password (do not use a real master password).
- [ ] Dashboard shows all nine sections in the sidebar: Digital Executors, Password Manager, Documents, Device Inventory, Financial Accounts, Subscriptions, Online Accounts & Domains, Platform Legacy Tools, Backups & Storage.
- [ ] Readiness indicators are visible on the dashboard checklist.
- [ ] Recovery Kit section is present and shows "not yet generated" state.

## 3. Section entry forms

For each section, open it and verify:

- [ ] **Digital Executors** — form renders; primary and backup executor records can be added with multi-record support.
- [ ] **Password Manager** — single-record form renders; all fields visible.
- [ ] **Documents** — multi-record; at least one document record can be added with a physical location field.
- [ ] **Device Inventory** — multi-record form renders.
- [ ] **Financial Accounts** — multi-record form renders.
- [ ] **Subscriptions** — multi-record form renders; each entry captures the service and its keep/cancel action.
- [ ] **Online Accounts & Domains** — multi-record form renders.
- [ ] **Platform Legacy Tools** — checklist-style fields render; Apple/Google/Facebook entries present.
- [ ] **Backups & Storage** — multi-record form renders; backup type field visible.
- [ ] Fill in one or two fields in a section; save succeeds with no error banner.
- [ ] Reload (lock → unlock) and verify saved values persist.

## 4. Attachments

- [ ] Open Documents; add an attachment to a record (any file ≤ 10 MB).
- [ ] Attachment appears in the record after saving.
- [ ] Lock and unlock; attachment is still present and downloadable.
- [ ] Delete the attachment; verify it no longer appears and orphan sweep runs cleanly on next unlock.

## 5. Lock and auto-lock behaviour

- [ ] Click "Lock vault" in the sidebar; app returns to the unlock screen immediately.
- [ ] Unlock with the correct password; dashboard reappears with all saved data intact.
- [ ] Enter the wrong password; error message is shown; vault remains locked.

## 6. Draft stash

- [ ] Open a section form; edit a field but do not save.
- [ ] Lock the vault (should trigger draft stash prompt or auto-stash).
- [ ] Unlock; verify the draft is offered for recovery or was discarded cleanly (no crash, no silent data loss).

## 7. Recovery Kit

- [ ] Navigate to Recovery Kit; generate the kit.
- [ ] Kit renders with all sections' key information (no blank/error panels for sections with saved data).
- [ ] After generating, the dashboard readiness indicator for Recovery Kit shows "up to date".
- [ ] Edit a section field; verify Recovery Kit shows a staleness indicator.

## 8. Backup and restore

- [ ] Create a backup via the Backups sidebar item; file dialog opens; `.lsvbackup` file is produced.
- [ ] Verify the backup file is not plaintext: open in a hex editor or `Format-Hex` — no readable strings matching any vault content.
- [ ] Lock the vault; overwrite the vault file (or delete `%APPDATA%\com.lifescribe.vault.v2\vault.sqlite3`).
- [ ] Restore from the backup file using the correct password; vault data is fully restored.
- [ ] Attempt restore with the wrong password; error is shown; vault is not corrupted.

## 9. v1 Import (if a v1 vault file is available)

- [ ] Navigate to "Import from v1" in the sidebar.
- [ ] Select the v1 vault directory and enter the v1 master password.
- [ ] Dry-run report appears showing sections to be imported.
- [ ] Confirm import; data appears in the corresponding v2 sections.
- [ ] The v1 vault directory is unchanged (import is read-only).

## 10. Clipboard hygiene

- [ ] Open a section that has a "copy to clipboard" button for a sensitive value (e.g. Password Manager).
- [ ] Click the copy button.
- [ ] Open Windows Clipboard History (Win + V).
- [ ] **The copied value must not appear in Clipboard History.** (The Rust clipboard-hygiene command sets the clipboard exclusion format before writing.)
- [ ] Wait 45 seconds (default auto-clear delay); verify the value is no longer on the clipboard.

## 11. Pack integrity check

- [ ] Close the app. Locate the bundled pack file in the installation directory (e.g. `C:\Program Files\LifeScribe Vault 2\resources\packs\default-pack.json`).
- [ ] Edit the file to introduce a structural error (e.g. delete a required field key).
- [ ] Relaunch the app; the app should fail gracefully (show an error or fallback message) rather than silently accept the corrupted pack.
- [ ] Restore the original pack file; app relaunches normally.

## 12. Creator mode is absent from the end-user build

- [ ] No "Pack Editor" item appears in the sidebar.
- [ ] Run the binary with a Tauri devtools call for `write_default_pack` (or attempt via console if devtools is enabled): the command must return "command not found" or similar — not a permission error.

## 13. Uninstall / residue check

- [ ] Uninstall via Add or Remove Programs (or the NSIS uninstaller).
- [ ] After uninstall, verify `%APPDATA%\com.lifescribe.vault.v2\` is **not** removed — vault data must be preserved on uninstall (Tauri default behaviour; user retains their data).
- [ ] Verify the Start menu shortcut and installed binary are gone.
- [ ] Open the remaining `vault.sqlite3` in a hex editor; confirm no plaintext master password or decrypted vault content is visible.

---

## Sign-off

| Step | Result | Notes |
|---|---|---|
| 1. Clean install | Pass / Fail | |
| 2. First-run setup | Pass / Fail | |
| 3. Section forms | Pass / Fail | |
| 4. Attachments | Pass / Fail | |
| 5. Lock/unlock | Pass / Fail | |
| 6. Draft stash | Pass / Fail | |
| 7. Recovery Kit | Pass / Fail | |
| 8. Backup/restore | Pass / Fail | |
| 9. v1 Import | Pass / Fail / N/A | |
| 10. Clipboard hygiene | Pass / Fail | |
| 11. Pack integrity | Pass / Fail | |
| 12. Creator mode absent | Pass / Fail | |
| 13. Uninstall residue | Pass / Fail | |

**Overall: Pass / Fail**

Tester sign-off: _____________________________ Date: ___________
