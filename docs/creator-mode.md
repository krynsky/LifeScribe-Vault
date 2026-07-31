# Pack Authoring (Dev Workflow)

How a developer edits and publishes the bundled `default-pack.json` — the base
form pack every vault starts from. This is a **dev-only** workflow; the bundled
pack is a build artifact, not something end users edit. (End users customize
*their own* forms through the in-app Form Editor — see the last section — which
is a different, shipped feature.)

> There is no longer a compile-time "creator mode": no `VITE_CREATOR_MODE`, no
> `creator-mode` Cargo feature, and no in-app `CreatorModePage`. Pack authoring
> happens in a standalone dev tool.

## Editing the bundled pack — the Pack Editor

```powershell
npm run pack-editor   # standalone Vite app on http://localhost:1430
```

The Pack Editor (`apps/desktop/pack-editor/`) is a dev-only Vite app that edits
`default-pack.json` — its sections, groups, and fields. A left rail lists the
sections (drag to reorder, click to select, rename inline); the right pane edits
the selected field, or the section itself when no field is selected. Its
dev-server plugin (`pack-editor/save-plugin.mjs`) reads and writes the pack file
directly:

1. Edit sections, groups, and fields; the **Design**, **Preview**, and **JSON**
   tabs show the working pack.
2. **Save** writes the edited pack straight back to
   `resources/packs/default-pack.json`, validated by the same `validatePack`
   gate the app uses.
3. **Back up packs** copies the current on-disk pack into
   `scripts/pack-backups/<timestamp>/` (gitignored) before you overwrite it.
4. Review the diff and commit the updated pack file.

In dev builds the app reads the pack from the source `resources/` dir, so
pack-editor saves hot-reload into `npm run dev`.

## The `write_default_pack` command

The Rust `write_default_pack` command overwrites the source pack file. It is
**always compiled** (no feature gate) but only effective in a dev checkout: it
resolves the path via `CARGO_MANIFEST_DIR`, so in a production install it targets
a path that doesn't exist and returns a `FileOperation` error. It is never a way
for end users to mutate the shipped resource.

## Structure-only guarantees

Pack authoring and export are **structure only** — never personal field values,
never `custom.*` overlay keys (those are user-data slots). `packExport.ts`'s
`creatorOnlyErrors` rejects any pack definition that carries `custom.*` keys, and
`validatePack` is the single gate for all pack JSON (bundled or imported).

## In-app Form Editor (a separate, shipped feature)

Distinct from pack authoring: end users can edit **their own** pack from inside
the app via the **Form Editor** — a runtime sidebar toggle persisted in
`localStorage` as `lifescribe.packEditorEnabled`. It edits the user's `customPack`
inside their encrypted snapshot using the master-detail `FieldList` /
`FieldPropertyPanel` UI, and saves through the normal validated CAS path (breaking
edits emit migration ops + a `schemaVersion` bump). This ships in end-user builds
and never touches the bundled `default-pack.json`.

## Testing pack-authoring logic

```powershell
npm --prefix apps/desktop run test -- src/creator
```

The pack-editing logic lives in `apps/desktop/src/creator/` (`packEdits`,
`packAutoMigrate`, `packExport`) with colocated `.test.ts` files; the Pack
Editor's own UI and save plugin are tested under `apps/desktop/pack-editor/`.
The Rust `write_default_pack` / read path is covered by the pack-resources
integration tests.

The pack editor has its own tsconfig and eslint config, so it is **not** covered
by `npm run typecheck` / `npm run lint`. Run both of its gates too:

```powershell
npm --prefix apps/desktop run typecheck:pack-editor
npm --prefix apps/desktop run lint:pack-editor
```

## What the pack format no longer has

Until 2026-07-30 the pack carried a `modules` array — onboarding questions whose
answers composed optional fields and sections into the pack at load. That system
is gone. Every field is now either protected (structural) or ordinary and
optional, present in the pack as authored. If you are reading an older spec or
plan under `docs/superpowers/` that describes `FormModule`s, `composePack`, or
an "overlay editor" with module targets, it is a historical record.
