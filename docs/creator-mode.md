# Creator Mode — Pack Authoring Workflow

Creator mode is a compile-time feature that lets a developer edit and publish the bundled `default-pack.json` without running an external tool. It is **never included in end-user builds**.

## Enabling creator mode

```powershell
# Frontend (Vite) — set in shell or .env.local, never commit to .env
$env:VITE_CREATOR_MODE = "1"

# Rust (Tauri) — adds write_default_pack command
npm run dev -- --features creator-mode
```

Or add `VITE_CREATOR_MODE=1` to `apps/desktop/.env.local` (gitignored).

## Using the Pack Editor

1. Launch the dev server with both flags above.
2. Click **Pack Editor** in the sidebar (visible only in creator builds).
3. Edit sections, groups, fields, and migration steps in the three-panel layout.
4. Use the **Preview** panel to see synthetic form data rendered in `FormRenderer`.
5. Click **Export Pack** to validate and produce updated JSON.
   - Export blocks on any validation error (structural, strict-upgrade, or `custom.*` namespace).
   - Export automatically increments the minor version (e.g. `2.1.0 → 2.2.0`).
6. Click **Write to source** to overwrite `resources/packs/default-pack.json` in-place.
7. Review the diff and commit the updated pack file.

## What the export pipeline checks

| Check | When it fails |
|-------|--------------|
| `validatePack` | Structural errors — missing required fields, invalid types, duplicate keys, custom-namespace leak |
| `creatorOnlyErrors` | `custom.*` overlay keys in the pack definition (these are user-data slots, never in a published pack) |
| `validatePackUpgrade(strict: true)` | Any warning treated as an error: protected field rename/retype/delete, required count change on existing records |

## Security constraints

- **`write_default_pack`** is gated behind `#[cfg(feature = "creator-mode")]` in Rust — it does not exist in end-user binaries.
- The `VITE_CREATOR_MODE` env var is statically replaced at build time by Vite `define`; Rollup tree-shakes the lazy import of `CreatorModePage` in non-creator bundles.
- Exported pack JSON contains **structure only** — no personal field values, no `custom.*` overlay keys.

## Testing creator-mode logic

```powershell
npm --prefix apps/desktop run test -- --reporter=verbose src/creator
```

All creator-mode TypeScript lives in `apps/desktop/src/creator/` and is covered by colocated `.test.ts` files. The Rust `write_default_pack` path is tested by the `pack_resource_tests` integration suite.
