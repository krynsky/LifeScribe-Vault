# Browse and Import

Once your vault is initialized, the Dashboard opens to the **Browse** view.

## Browse

Browse lists every `SourceRecord` note — one per file you've imported. Use the
filter box to narrow by title or filename. Click a row to read the extracted
Markdown. Nothing is editable; the vault's Markdown files are the system of
record, so open them in Obsidian or a text editor if you need to edit.

## Import

The Import section is how files enter the vault. Two ways:

1. Click **Add files…** to open the native file picker.
2. Drag files onto the app window.

Either way, the selected paths are sent to the ingestion pipeline. A progress
card appears showing counters (✓ succeeded, ✗ failed, ⏭ skipped). Click
**Cancel** to stop a job mid-flight; files already processed are kept, the
rest are left untouched.

Only one job runs at a time. If you try to start a second, you'll see a
"job already running" banner.

## Logs

Every job leaves a Markdown log in `system/logs/ingestion/`. The **Logs**
section lists them — click one to see its per-file results.

## Settings

Currently exposes the vault path (read-only) and a privacy master-switch. The
switch is persisted to `system/settings.md` but does not yet gate any
behavior — it's a placeholder for future enforcement.
