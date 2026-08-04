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
- [ ] Setup asks where the vault should live, defaulting to the app-data folder; the default is accepted without browsing.
- [ ] Setup is a **single screen** — no form-style or privacy-posture questions.
- [ ] Create a vault with a strong test password (do not use a real master password).
- [ ] Dashboard shows all nine sections in the sidebar, in pack order: Digital Executors, Password Manager, Devices, Financial Accounts, Subscriptions, Online Accounts, Documents, Backups & Storage, Platform Legacy Tools.
- [ ] Readiness indicators are visible on the dashboard checklist.
- [ ] Recovery Kit section is present and shows its empty state until a guided section has saved data.

## 3. Section entry forms

For each section, open it and verify:

- [ ] In every record-based section, the primary **Add [item]** button appears above the records panel.
- [ ] Every saved record row has an explicit **Expand** button; selecting it reveals the fields and changes the control to **Collapse**.
- [ ] When every record is collapsed, no **Save** button is visible. Expanding a record shows **Save** at the bottom of that record's fields.

- [ ] **Digital Executors** — form renders; primary and backup executor records can be added with multi-record support.
- [ ] **Password Manager** — single-record form renders; all fields visible, including an optional master-password field.
- [ ] **Documents** — multi-record; at least one document record can be added with a physical location field and an optional file attachment.
- [ ] **Devices** — multi-record form renders, including an optional PIN/passcode field.
- [ ] No field anywhere is missing because of a setup choice — every field ships present and optional.
- [ ] **Financial Accounts** — multi-record form renders, including Account Name and Account Number.
- [ ] **Subscriptions** — multi-record form renders; each entry captures the service and its keep/cancel action.
- [ ] **Online Accounts** — multi-record form renders.
- [ ] **Platform Legacy Tools** — multi-record form renders; one record per platform, with a Platform dropdown (Apple / Google / Facebook / Other).
- [ ] **Backups & Storage** — multi-record form renders; backup type field visible.
- [ ] Fill in one or two fields in a section; save succeeds with no error banner.
- [ ] Reload (lock → unlock) and verify saved values persist.

### Linked fields (records that point at other records)

- [ ] Add two devices in **Devices**, then open **Backups & Storage**: the **Device** field offers both by name, and **does not** offer any PIN or password as part of the option text.
- [ ] Pick one, save, then rename that device in **Devices**. Return to Backups — the link now shows the **new name** without being re-picked.
- [ ] Give two devices the **same name**; confirm both still appear as separate options and picking each yields a distinct saved entry.
- [ ] Try to delete a device that a backup points at. **The delete is refused**, and the app names the backup using it.
- [ ] Clear that backup's Device field, save, then delete the device — it now succeeds.

## 4. Attachments

- [ ] Open Documents; add an attachment to a record (any file ≤ 10 MB).
- [ ] Attachment appears in the record after saving.
- [ ] Lock and unlock; attachment is still present and downloadable.
- [ ] Delete the attachment; verify it no longer appears and orphan sweep runs cleanly on next unlock.

## 5. Lock and auto-lock behaviour

- [ ] Click "Lock vault" in the sidebar; app returns to the unlock screen immediately.
- [ ] Unlock with the correct password; dashboard reappears with all saved data intact.
- [ ] Enter the wrong password; error message is shown; vault remains locked.

## 6. Change master password

- [ ] Open **Settings → Master password** while the vault is unlocked.
- [ ] Enter the correct current password and matching new passwords of at least 15 characters; the change succeeds and all three password fields clear.
- [ ] Confirm the app remains unlocked and saved records and attachments are still available immediately after the change.
- [ ] Lock the vault. Confirm the old password is rejected and the new password unlocks the vault with all saved data intact.
- [ ] Try another change with the wrong current password. Confirm the error says the password was not changed, then lock and verify the current password still unlocks the vault.
- [ ] Confirm a new password shorter than 15 characters and mismatched confirmation values are rejected before the change is attempted.
- [ ] Restore a backup created before the password change. Confirm it requires the password that was in effect when that backup was created, not the vault's current password.

## 7. Draft stash

- [ ] Open a section form; edit a field but do not save.
- [ ] Lock the vault (should trigger draft stash prompt or auto-stash).
- [ ] Unlock; verify the draft is offered for recovery or was discarded cleanly (no crash, no silent data loss).

## 8. Recovery Kit

- [ ] Navigate to Recovery Kit; verify the snapshot of saved data renders.
- [ ] Kit renders with all sections' key information (no blank/error panels for sections with saved data).
- [ ] Click **Save Kit**; the dashboard readiness indicator for Recovery Kit shows "up to date".
- [ ] Edit a section field; verify Recovery Kit shows a staleness indicator.
- [ ] Click **Print**; the standard Windows/WebView print preview opens with the Kit document, app navigation and controls are absent from the printed pages, and cancelling the preview returns to the still-open app.
- [ ] Click **Export PDF**; a native **Save As** dialog opens with a `.pdf` filename and PDF filter. Cancel it and verify no file is created and no error appears.
- [ ] Export again to a writable folder. Verify the file exists, begins with `%PDF-`, opens in a PDF reader, contains the current Kit, and the app reports the selected save path.
- [ ] The exported PDF's header carries **today's date with the month spelled out** ("exported August 3, 2026"). A filed PDF has no staleness badge, so the date on the page is the only way a reader can judge whether it is current.
- [ ] Export over an **existing** PDF (pick the same filename twice and confirm the overwrite). The file is fully replaced with the new Kit, and no `.tmp` file is left beside it.
- [ ] Export to a **removable drive or network share**, not just a local folder — the export stages beside its destination, so this is the case that would break if that ever regressed.
- [ ] Attempt an export to a location that cannot be written. Verify the app remains usable and shows a clear save error rather than failing silently.
- [ ] **Credential exclusion.** Enter a distinctive master password in Password Manager and a distinctive PIN in Devices, save, then review, print, and export the Kit. **Neither value appears anywhere on it**, on screen, in print preview, or in the PDF. This is the one check on this list where a failure is a data-disclosure bug, not a defect.
- [ ] A document attachment appears on the Kit as its **filename**, never its contents or an internal id.
- [ ] A dropdown field mapped into the Kit (e.g. Devices' device type, or Platform Legacy Tools' platform) shows its **readable option text** — "External drive," "Apple Legacy Contact" — never the underlying stored value like "external-drive" or "apple-legacy-contact".
- [ ] A linked field mapped into the Kit (Backups & Storage → Device) prints the **name of the entry it points at**, never an internal record id.
- [ ] **Records that share a name stay distinguishable.** Add two Financial Accounts at the same bank with different Account Names, then review the Kit: the two entries are headed **"Chase — Sapphire Reserve"** and **"Chase — Freedom Unlimited"**, not "Chase" twice. Check the printed, print-preview, and PDF output, not just the on-screen list — these are computed separately.

## 9. Backup and restore

- [ ] Create a backup via the Backups sidebar item; file dialog opens; `.lsvbackup` file is produced.
- [ ] Verify the backup file is not plaintext: open in a hex editor or `Format-Hex` — no readable strings matching any vault content.
- [ ] Lock the vault; overwrite the vault file (or delete `vault.sqlite3` from the vault folder — the default is `%APPDATA%\com.lifescribe.vault.v2\`, and Settings → Vault location shows the current path).
- [ ] Restore from the backup file using the correct password; vault data is fully restored.
- [ ] Attempt restore with the wrong password; error is shown; vault is not corrupted.

## 10. Vault location

- [ ] **Settings → Vault location** shows the current folder as a real path.
- [ ] **Move vault…** to a second folder. The vault locks and asks for the master password.
- [ ] After unlocking, all data and attachments are intact at the new location.
- [ ] The new folder contains `vault.sqlite3` and the `attachments/` tree.
- [ ] **Unrelated files already in the destination folder are untouched.** Seed the destination with a file of your own beforehand and confirm it survives — an early version of this feature deleted the destination's contents.
- [ ] Point the vault at a removable drive, disconnect it, relaunch: the app shows "Your vault folder can't be reached" with the path, and does **not** silently create a fresh vault at the default location.
- [ ] Reconnect the drive; the vault opens normally.
- [ ] Choosing a folder that already holds a LifeScribe vault opens that vault rather than replacing it.

## 11. Pack integrity check

- [ ] Close the app. Locate the bundled pack file in the installation directory (e.g. `C:\Program Files\LifeScribe Vault 2\resources\packs\default-pack.json`).
- [ ] Edit the file to introduce a structural error (e.g. delete a required field key).
- [ ] Relaunch the app; the app should fail gracefully (show an error or fallback message) rather than silently accept the corrupted pack.
- [ ] Restore the original pack file; app relaunches normally.

## 12. Pack-authoring surface is inert in the end-user build

- [ ] The bundled `default-pack.json` cannot be mutated by the app: invoking `write_default_pack` (via devtools/console if available) returns a `FileOperation` error, not success — the command ships but targets a compile-time source path that is absent on an install.
- [ ] The **Form Editor** toggle (bottom of the sidebar, off by default) edits only the user's own forms (their `customPack`); it never rewrites the bundled pack.

## 13. Uninstall / residue check

- [ ] Uninstall via Add or Remove Programs (or the NSIS uninstaller).
- [ ] After uninstall, verify the vault folder is **not** removed — vault data must be preserved on uninstall (Tauri default behaviour; user retains their data). Check both the default `%APPDATA%\com.lifescribe.vault.v2\` and any custom folder the vault was moved to.
- [ ] Verify the Start menu shortcut and installed binary are gone.
- [ ] Open the remaining `vault.sqlite3` in a hex editor; confirm no plaintext master password or decrypted vault content is visible.
- [ ] Open a file under `attachments/` in a hex editor; confirm the original file's contents are not readable.

---

## Sign-off

| Step | Result | Notes |
|---|---|---|
| 1. Clean install | Pass / Fail | |
| 2. First-run setup | Pass / Fail | |
| 3. Section forms | Pass / Fail | |
| 4. Attachments | Pass / Fail | |
| 5. Lock/unlock | Pass / Fail | |
| 6. Change password | Pass / Fail | |
| 7. Draft stash | Pass / Fail | |
| 8. Recovery Kit | Pass / Fail | |
| 9. Backup/restore | Pass / Fail | |
| 10. Vault location | Pass / Fail | |
| 11. Pack integrity | Pass / Fail | |
| 12. Pack-authoring inert | Pass / Fail | |
| 13. Uninstall residue | Pass / Fail | |

**Overall: Pass / Fail**

Tester sign-off: _____________________________ Date: ___________
