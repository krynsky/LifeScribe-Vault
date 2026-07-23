# Composable Form Modules — Design

**Date:** 2026-07-23
**Status:** Approved design (runtime model). Authoring UX is a separate follow-up spec.
**Scope of this spec:** the runtime model only — what a module is, how modules compose onto the base form at load, how onboarding selects them, and how switching a selection handles existing data. The pack-editor authoring UX is explicitly out of scope and gets its own spec afterward.

---

## 1. Problem

Today the app ships **two pre-built packs** — `default-pack.json` (hint) and `default-pack-credential.json` (credential) — where the credential pack is derived from the hint pack plus a single overlay (`scripts/credential-overlay.json`, applied by `buildCredentialPack`). The user picks one posture (`profile.formMode = "hint" | "credential"`) at onboarding.

Two problems:

1. **The pack editor is confusing.** It reuses the full form editor for the credential layer, so it must show every shared field (just locked) as if it were a second copy of the form. What is actually a *tiny delta* (in practice: two secret fields + their kit mappings; `fieldOverrides` is unused) looks like a whole parallel form.
2. **The model doesn't generalize.** "Hint vs credential" is a single either/or axis. We want *several* independent feature choices — "store secrets?", "file location: path vs. attach a file?", and more later — each of which adds, removes, or swaps fields, chosen at onboarding. Pre-building every combination is 2^N packs and does not scale.

## 2. Vision

Replace the single `formMode` axis with a **composable form-variant system**: one **base form** plus a set of independently-chosen **feature modules**. Each module is an onboarding question; each answer applies a set of field changes to the base. The final form is **composed at load** from the base plus the selected options. "Store secrets" becomes the first module; "file method" is the second.

## 3. Goals / Non-goals

**Goals**
- A declarative module definition (no scripts — honors the "definitions are data" law).
- Deterministic, pure composition of base + selected module options into a final `FormPack`, validated before render.
- Onboarding selects module options; selections persist in the profile.
- Post-onboarding switching recomposes and safely archives data from removed fields, reusing existing reconcile machinery.
- Retire the pre-built credential pack, its build tooling, and its drift-guard test; the "secrets" module reproduces the former credential overlay exactly.
- Backward compatibility: existing `formMode` vaults migrate to module selections with no data loss.

**Non-goals (deferred / dropped)**
- Pack-editor authoring UX for base + modules — **separate follow-up spec** (the original request).
- Auto-restore of archived data when switching a choice back — **archive-only** for v1 (decided).
- In-place field edits / general `fieldOverrides` — **dropped**; the change primitive is whole-field add/remove (decided).
- Inter-module dependencies (module A only shown if module B = x) — out of scope v1; modules are independent.

## 4. Core concepts

- **Base form (base pack):** the shared `FormPack`, the single source of truth for structure. Ships as one file (`default-pack.json`).
- **Module:** an onboarding question with ≥2 mutually-exclusive **options**. A binary toggle ("store secrets? yes/no") is just a 2-option module.
- **Option:** one answer. Carries `addFields` (whole field defs + placement), `removeKeys` (systemKeys to drop), and optional `kitAdditions`.
- **Selection:** the chosen `optionId` per module, stored in the profile.
- **Composition:** `base + selected options → composed FormPack`, pure and deterministic, performed in TypeScript at load.

## 5. Data model

### 5.1 Module definitions (embedded in the base pack)

Modules ship **inside the base pack** (`FormPack.modules?: FormModule[]`) so they version, validate, and load with the form they modify — one cohesive artifact, one validation pass.

```ts
interface FormModule {
  moduleId: string;            // stable id, e.g. "secrets", "file-method"
  title: string;              // short question label (onboarding + settings)
  question: string;           // full prompt shown to the user
  helperText?: string;
  options: FormModuleOption[]; // >= 2, mutually exclusive
  defaultOptionId: string;    // selection used when unset (skip / back-compat)
  order: number;              // onboarding display order
}

interface FormModuleOption {
  optionId: string;                          // stable, e.g. "off"/"on", "path"/"attach"
  label: string;
  description?: string;
  addFields?: ModuleAddField[];              // whole fields to insert
  removeKeys?: string[];                     // systemKeys to remove from the composed pack
  kitAdditions?: Record<string, string[]>;   // sectionKey -> systemKeys appended to first kit entry
}

interface ModuleAddField {
  sectionKey: string;
  groupKey: string;
  order: number;                             // desired FINAL slot (insert at order-0.5, then renumber)
  field: FieldDefinition;
}
```

`ModuleAddField` and `kitAdditions` mirror the existing credential overlay exactly (`buildCredentialPack` already implements this insert-at-`order-0.5`-then-renumber behavior); the new piece is `removeKeys`.

### 5.2 Profile

```ts
interface VaultProfile {
  ownerName: string;
  reviewCadenceMonths: number;
  moduleSelections: Record<string, string>; // moduleId -> optionId   (NEW)
  basePackId?: string;
  // formMode: removed after migration (see §9)
}
```

## 6. Composition

A new pure domain function:

```ts
function composePack(
  base: FormPack,
  modules: FormModule[],
  selections: Record<string, string>,
): FormPack
```

**Algorithm** (deterministic):

1. `structuredClone(base)`.
2. For each module in ascending `order` (declared order is the tie-break):
   1. Resolve `optionId = selections[moduleId] ?? module.defaultOptionId`.
   2. Apply the option in a fixed sub-order: **remove first, then add, then kit-additions.**
      - `removeKeys`: delete matching fields from every section/group; renumber affected groups.
      - `addFields`: insert each at `order - 0.5`, then renumber the touched group to sequential integers (identical to `buildCredentialPack`).
      - `kitAdditions`: append systemKeys to the section's first `kitMapping` entry (idempotent).
3. Return the composed pack. The caller runs it through `validatePack` before anything renders (never silent acceptance — same contract as `loadDefaultPack` today).

**Determinism & idempotence:** composition depends only on `(base, modules, selections)`; re-running with the same inputs yields byte-identical output. This is required by the "migrations are pure, deterministic, idempotent" family of laws.

**Rules enforced by validation (authoring-time):**
- A module option may only **add or remove unprotected fields.** Removing a `protected` field is a validation error — protected system keys must stay stable (readiness/kit/save mappings depend on them).
- `removeKeys` must reference fields that exist in the base (or a field added by an earlier-ordered module).
- Added `systemKey`s must be unique across the composed pack and must not be in the `custom.*` namespace.
- Two modules must not both add the same key or both remove the same key (conflicting deltas) — validation error, surfaced at authoring time, never silent.

## 7. Load pipeline integration

One new step, slotted before the existing overlay merge:

```
loadDefaultPack()                         → base pack (now carries `modules`)
composePack(base, base.modules, profile.moduleSelections)   ← NEW
mergePackWithOverlay(composed, userOverlay, values)         ← existing per-vault customization
→ resolved definition → render
value reconcile / migrate-on-read                           ← existing; archives now-absent fields
```

Fields removed by the current selection are simply **absent from the composed pack**, so the existing `valuesStore` reconcile already archives their saved values as archived answers — no new archival code. `loadDefaultPack` loses its `mode` parameter (there is one base pack now); composition replaces the hint/credential file split.

## 8. Onboarding

`SetupScreen` stops hard-coding the hint/credential radio pair and instead **iterates `base.modules`** (in `order`), rendering each as a radio group of its options. Selections collect into `profile.moduleSelections`. The existing `PackPreview` previews the **composed** pack for the current selections. The former "Store locations only / Store secrets" choice is simply the `secrets` module rendered by this generic path.

## 9. Post-onboarding switching

Today's "Switch to locations only" (`handleSwitchMode`) generalizes to **"change a module choice."** A settings surface lists each module with its current selection; changing one:

1. Updates `profile.moduleSelections[moduleId]`.
2. Recomposes the pack.
3. Saves through the normal path, whose reconcile archives any fields the new selection removed.

Archive-only (decided): switching back shows empty fields; prior data remains in archived answers, viewable and recoverable, never silently dropped.

## 10. Migration & retirement

- **Snapshot migration (pure, migrate-on-read in `normalizeSnapshot`):** map legacy `profile.formMode` to a seed selection — `"credential" → { secrets: "on" }`, `"hint" → { secrets: "off" }` — then drop `formMode`. Any module without a stored selection falls back to its `defaultOptionId`, so older snapshots and new modules both resolve safely.
- **Base pack gains `modules`:** the `secrets` module's `on` option carries the former credential overlay's `addedFields` (master password → `password-manager/plan`, device PIN → `devices/device`) and its `kitAdditions`. The `file-method` module is added (see §11).
- **Retire:**
  - `default-pack-credential.json` (generated artifact) and `credential-overlay.json`.
  - `scripts/build-credential-pack.mjs`, `scripts/lib/credential-pack.mjs`.
  - `src/domain/credentialPack.test.ts` drift-guard.
  - `loadDefaultPack`'s `mode` branch and `staticPackFor`'s credential path.
- **Compatibility guard (replaces the retired drift test):** a test asserting `composePack(base, [secrets], { secrets: "on" })` equals the previously-shipped credential pack — proves the migration preserves the exact credential form.

## 11. First concrete modules

1. **`secrets`** — options `off` (default) / `on`.
   - `on.addFields`: `passwordManagerMasterPassword` (`password-manager/plan`, order 4), `devicePin` (`devices/device`, order 4).
   - `on.kitAdditions`: `{ "password-manager": ["passwordManagerMasterPassword"], "devices": ["devicePin"] }`.
   - Exactly reproduces today's credential overlay.

2. **`file-method`** — options `path` (default) / `attach`. Applies to the Documents section's digital-location.
   - `path.addFields`: `documentDigitalLocation` as a **`path`** field (the type added earlier this session).
   - `attach.addFields`: `documentDigitalFile` as a **`file`** field (attachment).
   - Because `documentDigitalLocation` **moves out of the base** into `file-method`'s `path` option, and `path` is the **default**, existing vaults keep the identical field/key/type — the value conforms and is preserved with no archival. Choosing `attach` removes `documentDigitalLocation` (its value archives) and adds `documentDigitalFile`.

## 12. Laws compliance

- **Field data never silently dropped:** removed-module fields archive via existing reconcile. ✓
- **Protected keys stable:** modules may only add/remove unprotected fields (validation-enforced). ✓
- **Definitions are data, not scripts:** modules are declarative add/remove/kit objects. ✓
- **Pure/deterministic/idempotent composition:** `composePack` depends only on inputs; validated before render. ✓
- **Pack opaque to Rust:** composition is TypeScript domain logic; Rust is untouched. ✓

## 13. Testing strategy

- **`composePack` unit tests:** add / remove / kit-additions; module ordering and remove-before-add; determinism; idempotence; conflict and protected-field-removal validation errors.
- **Migration test:** `formMode` `credential`/`hint`/absent → correct `moduleSelections`; `formMode` dropped.
- **Credential-compatibility test:** `composePack(base, [secrets], { secrets: "on" })` equals the previously-shipped credential pack.
- **Onboarding test:** module questions render from `base.modules`; selections persist to the profile; preview reflects composition.
- **Switch test:** changing a selection recomposes and archives removed fields' values (archive-only; nothing auto-restored).
- **File-method test:** `path` vs `attach` compose the correct field; switching `path → attach` archives the path value and surfaces the attachment field.

## 14. Open questions / risks

- **Onboarding length:** each module adds a question. Keep the module set small; consider "recommended defaults" so users can accept all at once. (UX detail, not blocking.)
- **Base-pack readiness/kit validity:** readiness keys are protected and never removed by modules, so section readiness is unaffected; kit changes are module-scoped. Confirm during implementation that no base `kitMapping`/`readinessRule` references a field that lives only in a module.
- **Authoring UX dependency:** until the follow-up editor spec lands, modules are hand-edited JSON in the base pack (acceptable; that is how the credential overlay is maintained today).
