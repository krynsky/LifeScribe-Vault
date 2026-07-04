# Credential Pack Editor — Visual Dev/Admin Tool

**Date:** 2026-07-04
**Status:** Approved design, ready for implementation planning

## Problem

The credential-mode form (`default-pack-credential.json`) is authored as a
"credential layer" over the hint pack, managed today by a CLI generator plus a
hand-edited `credential-overlay.json`. Editing that overlay by hand is a
developer/admin task done in a text editor — there is no way to *see* the form
while shaping it, and non-trivial edits (rewording many fields, reordering,
choosing Recovery-Kit membership) are tedious and error-prone.

The owner wants a **separate visual editor** — its own tool, distinct from the
end-user vault app — to edit the credential form by clicking and typing, with a
live preview, that writes back the artifacts the app ships.

## Goal

A dev/admin-only, browser-based visual editor for the credential form:

- Launched with a single command (`npm run pack-editor`); opens in the browser.
- Edit the credential form **WYSIWYG** using the same field editors the vault app
  already has, with a live preview of the resulting form.
- **Save writes to disk**: it regenerates `credential-overlay.json` and
  `default-pack-credential.json`, keeping the overlay the committed source of
  truth (the drift-guard test stays green).
- **Never bundled into the end-user vault app** — it is a separate Vite app and
  compiles/ships independently of the Tauri build.

## Non-goals (v1)

- Adding, removing, or renaming **groups or sections** (existing structure is
  fixed; only field-level edits).
- Editing the **hint** pack.
- Drag-and-drop reordering (v1 uses up/down move, reusing the app's existing
  control); fancy DnD is a later enhancement.
- Any change to the shipped vault app or its runtime.
- Editing arbitrary packs / multi-pack support.

## Editing model (Approach A: WYSIWYG, auto-derived overlay)

The editor edits the **generated credential `FormPack`** directly, in memory.
On save, the tool computes the **overlay as the diff between the edited pack and
the hint pack**, writes that overlay, and regenerates the credential pack from
it. This gives true visual editing while keeping `credential-overlay.json` the
single committed source (DRY link to the hint pack + existing drift-guard test
remain intact).

Rejected alternatives:

- **Edit the overlay's fields directly** — a structured form over
  overrides/added-fields. Simplest save, but it is a prettier JSON editor, not
  visual editing of the form. Rejected: defeats the purpose.
- **WYSIWYG, save the full pack directly** — abandons the overlay/generator we
  just built; the two packs re-diverge and the drift test dies. Rejected:
  regression of the current design.

### `deriveOverlay(hintPack, credentialPack)` — the inverse of the generator

A new **pure** module in `scripts/lib/` producing an overlay such that
`buildCredentialPack(hintPack, deriveOverlay(hintPack, credentialPack))`
deep-equals `credentialPack`. Semantics:

- **packId** — copied from the edited pack.
- **addedFields** — every field present in the credential pack but not in the
  hint pack, recorded as `{ sectionKey, groupKey, order: <final position>,
  field: <props except order> }`.
- **fieldOverrides** — for each *shared* field (present in both), the props that
  differ from the hint field (label, helperText, type, required, options,
  visibleWhen, protected).
- **order overrides** — emitted *only* when the user genuinely reordered shared
  fields. Compare the relative sequence of shared fields (credential vs hint,
  ignoring added fields): if identical, the ordering is a mechanical
  consequence of insertion and the generator reproduces it with no order
  overrides (this is the current minimal overlay); if the relative sequence
  differs, emit `order` on the affected shared fields to encode the new order.
- **kitAdditions** — for each section, the kit-mapping systemKeys present in the
  credential pack but not the hint pack.

**Correctness is guarded by a round-trip test:** for the committed overlay,
`deriveOverlay(hint, buildCredentialPack(hint, overlay))` must equal the
committed overlay, and `buildCredentialPack(hint, deriveOverlay(hint, pack))`
must equal `pack`. Order normalization (the generator renumbers touched groups
to sequential integers) is applied consistently on both sides so
what-you-see-equals-what-is-saved.

## Architecture

A separate Vite React app that reuses the vault app's pure form modules; a Vite
dev-server plugin handles disk I/O. No separate server process, no new runtime
dependencies.

### Components / file structure

- `apps/desktop/pack-editor/index.html` — separate entry document.
- `apps/desktop/pack-editor/main.tsx` — React entry.
- `apps/desktop/pack-editor/PackEditorApp.tsx` — root: loads the pack, hosts the
  section navigation, the editing surface, the live preview, and the save bar.
- `apps/desktop/pack-editor/api.ts` — thin `fetch` wrappers for the two
  endpoints (`GET`/`POST /__pack`).
- `apps/desktop/pack-editor/save-plugin.mjs` — the Vite dev-server plugin
  (Node `fs` + the generator/derive libs) exposing:
  - `GET /__pack` → `{ hintPack, overlay }` read from disk.
  - `POST /__pack` → receives the edited `FormPack`; runs `deriveOverlay`, writes
    `credential-overlay.json`, regenerates `default-pack-credential.json`, and
    returns `{ ok }` or an error message.
- `apps/desktop/vite.pack-editor.config.ts` — Vite config rooted at
  `pack-editor/`, registering `save-plugin`.
- `apps/desktop/scripts/lib/derive-overlay.mjs` (+ `.d.mts`) — the pure inverse
  transform, alongside the existing `credential-pack.mjs`.
- `apps/desktop/tsconfig.pack-editor.json` — TS config that type-checks the
  editor together with the reused `src` modules (the app's own
  `tsconfig`/`tsc --noEmit` continues to cover only `src`, unchanged).
- `apps/desktop/package.json` — add `pack-editor` (run) and
  `typecheck:pack-editor` scripts; root `package.json` proxies `pack-editor`.

### Reuse (no reimplementation)

The editor imports from `../src`:

- `domain/formModel.ts`, `domain/packValidation.ts` — the `FormPack` type + `validatePack`.
- `creator/packEdits.ts` — mutation ops (`updateField`, `addOptionalField`,
  `removeField`, `moveField`, `updateGroup`, …).
- `forms/FormRenderer.tsx` + `forms/inline/*` — the editing surface and the live
  preview. These are already Tauri-free; only `AttachmentList` needs the backend
  and is not used by the preview.

### UI

Two-pane layout: an **edit pane** (section nav + the credential form rendered
with the existing inline field editors, driven by `packEdits` ops on the
in-memory pack) and a **preview pane** (the same form rendered read-only via
`FormRenderer` as an end user sees it). A **save bar** shows dirty state and a
Save button; save results (success / validation or write error) surface inline.

## Data flow

```
launch  →  GET /__pack  →  buildCredentialPack(hint, overlay)  →  render (edit + preview)
edit    →  packEdits ops mutate the in-memory FormPack  →  live preview updates
save    →  validatePack(editedPack)   (client-side, in the editor; reject → show error, no POST)
        →  POST /__pack {editedPack}
            → overlay = deriveOverlay(hint, editedPack)
            → write credential-overlay.json
            → write default-pack-credential.json = buildCredentialPack(hint, overlay)
            → respond {ok}; editor reloads from disk so preview == saved
```

`validatePack` is a frontend (`.ts`) module and runs in the editor client before
the POST is sent — a validation failure surfaces in the UI and no request is
made. The dev-server plugin is plain Node ESM (`.mjs`) and does not re-import the
TS validator; it trusts the already-validated client on a localhost-only endpoint.

## Error handling

- **Load:** if the hint pack or overlay fails to read/parse/validate, the editor
  shows a blocking error rather than a partial form.
- **Save:** the editor runs `validatePack` client-side before POSTing; a
  validation failure is reported in the UI and no request is sent. On the
  server, filesystem write failures are returned (400) and surfaced. The save is
  all-or-nothing (overlay + pack written together).
- **Round-trip safety:** the `deriveOverlay`/`buildCredentialPack` round-trip
  test and the existing drift-guard test keep the overlay and the committed pack
  provably in sync; a regression fails CI.

## Security / isolation

- The tool handles **form structure only** — never vault values, never secrets,
  never the `custom.*` overlay namespace — consistent with "packs carry
  structure only." It never touches a vault file or the encryption path.
- The dev server binds to localhost and exists only while `npm run pack-editor`
  runs. It is a developer tool, not part of any shipped artifact.
- The editor is a separate Vite app; the Tauri end-user build uses the main app
  entry only, so none of this code ships to end users.

## Testing

- **`deriveOverlay` unit + round-trip tests** (Vitest, `scripts/lib`): inverse
  property against the committed overlay and against hand-constructed edited
  packs (rewords, added field, reorder). Kit additions are still exercised via
  the committed overlay's `kitAdditions` in the round-trip.
- **Existing drift-guard test** — unchanged; continues to assert the committed
  pack equals `buildCredentialPack(hint, overlay)`.
- **`save-plugin` handler test** — deriving + serializing writes the expected
  overlay and pack strings for a sample edited pack (pure-function level; no
  live server needed).
- **Editor smoke test** (optional, RTL): the app renders a loaded pack and a
  field edit updates the preview.
- Manual: `npm run pack-editor`, reword a field, add/remove a field, reorder,
  Save, confirm `git diff` shows the expected overlay + regenerated pack, and
  `npm test` (drift + round-trip) stays green.

## Future enhancements (out of scope now)

- Recovery-Kit membership editing (needs an overlay `kitRemovals` extension so
  removing a hint-kit field is representable; today only additions are encoded).
- Group/section structural editing (needs overlay schema extensions).
- Drag-and-drop reordering.
- Editing the hint pack / a general multi-pack editor.
- A "preview as Recovery Kit" panel.
