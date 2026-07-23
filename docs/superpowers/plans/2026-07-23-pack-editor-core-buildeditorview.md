# Pack-Editor Redesign — Editor Core (Plan 3b of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure logic the redesigned overlay pack editor rests on — a provenance-annotated view of the composed form (`buildEditorView`) and the edit-routing helpers that send an edit to the right layer (`editorEdits`) — with zero UI change.

**Architecture:** The overlay editor renders the base form with a set of module options *toggled into view*, every field/section tagged by where it lives, and one active layer that edits flow into. Two pure modules make that possible without React: `buildEditorView(base, viewSelections)` returns the annotated view (base / added-by / removed-by, keeping removed items so they can be struck-through), and `editorEdits` routes an add/remove/edit to either the base pack or a specific module option. The React assembly (Plan 3b-2) is thin over these.

**Tech Stack:** TypeScript, Vitest. Pure domain/editor logic under `apps/desktop/src/creator/`. No React, no IPC.

**Depends on:** the section-extension engine (Plan 3a — this branch). Source spec: `docs/superpowers/specs/2026-07-23-pack-editor-authoring-redesign-design.md` (§4.2–§4.3).

**Decomposition:** Plan 3b is itself split — **Plan 3b (this doc) = the editor core** (`buildEditorView` + `editorEdits`), pure and fully tested. **Plan 3b-2** (outlined at the end) = the React overlay-editor UI assembled over this core. **Plan 3c** retires the legacy credential tooling.

All commands run from repo root. Test command shape: `npm --prefix apps/desktop run test -- <path>`.

Reference types (already in `apps/desktop/src/domain/formModel.ts`): `FormPack`, `PackSection`, `FieldGroup`, `FieldDefinition`, `FormModule`, `FormModuleOption`, `ModuleAddField`, `ModuleAddSection`.

---

## Task 1: `EditorView` types + `buildEditorView`

**Files:**
- Create: `apps/desktop/src/creator/editorView.ts`
- Test: `apps/desktop/src/creator/editorView.test.ts`

`buildEditorView(base, viewSelections)` merges the base pack with the module options named in `viewSelections` (a `moduleId → optionId | null` map; `null`/absent = not overlaid), producing the composed shape **but keeping removed items** (flagged `removed: true`) and tagging every section/field with its `source`. Unlike `composePack`, it never drops anything and never renumbers — it is a *view*, not a resolved artifact.

- [ ] **Step 1: Write the failing tests** — create `apps/desktop/src/creator/editorView.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { FormPack } from "../domain/formModel";
import { buildEditorView } from "./editorView";

function base(): FormPack {
  return {
    packId: "b", packVersion: "1.0.0", schemaVersion: 1, minAppVersion: "0.0.0", migrations: [],
    sections: [
      {
        sectionKey: "devices", title: "Devices", lede: "", multiRecord: true, order: 1,
        readinessRule: { requiredKeys: ["deviceName"] },
        kitMapping: { entries: [{ heading: "Devices", fields: ["deviceName"] }] },
        groups: [{ groupKey: "device", title: "Device", repeatable: false, order: 1, fields: [
          { systemKey: "deviceName", label: "Device name", type: "text", required: true, protected: true, order: 1 },
          { systemKey: "unlockHint", label: "Unlock hint", type: "text", required: false, protected: false, order: 2 },
        ] }],
      },
    ],
    modules: [
      {
        moduleId: "secrets", title: "Secrets", question: "?", order: 1, defaultOptionId: "off",
        options: [
          { optionId: "off" },
          {
            optionId: "on",
            addFields: [{ sectionKey: "devices", groupKey: "device", order: 3, field: {
              systemKey: "devicePin", label: "PIN", type: "text", required: false, protected: false, order: 3 } }],
            removeKeys: ["unlockHint"],
          },
        ],
      },
      {
        moduleId: "crypto", title: "Crypto", question: "?", order: 2, defaultOptionId: "off",
        options: [
          { optionId: "off" },
          { optionId: "on", addSections: [{ order: 2, section: {
            sectionKey: "crypto", title: "Crypto", lede: "", multiRecord: true, order: 2,
            readinessRule: { requiredKeys: ["walletName"] },
            kitMapping: { entries: [{ heading: "Crypto", fields: ["walletName"] }] },
            groups: [{ groupKey: "wallet", title: "Wallet", repeatable: false, order: 1, fields: [
              { systemKey: "walletName", label: "Wallet name", type: "text", required: true, protected: true, order: 1 },
            ] }],
          } }], removeSectionKeys: ["devices"] },
        ],
      },
    ],
  };
}

function field(view: ReturnType<typeof buildEditorView>, sectionKey: string, systemKey: string) {
  return view.sections
    .find((s) => s.sectionKey === sectionKey)!
    .groups.flatMap((g) => g.fields)
    .find((f) => f.systemKey === systemKey);
}

describe("buildEditorView", () => {
  it("with no overlays returns the base tagged as source base, nothing removed", () => {
    const view = buildEditorView(base(), {});
    expect(view.sections.map((s) => s.sectionKey)).toEqual(["devices"]);
    expect(view.sections[0]!.source).toEqual({ kind: "base" });
    expect(view.sections[0]!.removed).toBe(false);
    expect(field(view, "devices", "deviceName")!.source).toEqual({ kind: "base" });
  });

  it("overlaying secrets:on tags devicePin as module-added and flags unlockHint removed (still present)", () => {
    const view = buildEditorView(base(), { secrets: "on" });
    const pin = field(view, "devices", "devicePin")!;
    expect(pin.source).toEqual({ kind: "module", moduleId: "secrets", optionId: "on" });
    expect(pin.removed).toBe(false);
    const hint = field(view, "devices", "unlockHint")!;
    expect(hint.removed).toBe(true); // kept in the view, struck-through
    expect(hint.source).toEqual({ kind: "base" });
  });

  it("overlaying crypto:on appends the crypto section (module source) and flags devices removed", () => {
    const view = buildEditorView(base(), { crypto: "on" });
    expect(view.sections.map((s) => s.sectionKey)).toEqual(["devices", "crypto"]);
    const devices = view.sections.find((s) => s.sectionKey === "devices")!;
    expect(devices.removed).toBe(true);
    const crypto = view.sections.find((s) => s.sectionKey === "crypto")!;
    expect(crypto.source).toEqual({ kind: "module", moduleId: "crypto", optionId: "on" });
    expect(crypto.removed).toBe(false);
  });

  it("overlays multiple modules at once and orders sections by their order value", () => {
    const view = buildEditorView(base(), { secrets: "on", crypto: "on" });
    expect(view.sections.map((s) => s.sectionKey)).toEqual(["devices", "crypto"]);
    expect(field(view, "devices", "devicePin")).toBeDefined();
    expect(view.sections.find((s) => s.sectionKey === "devices")!.removed).toBe(true);
  });

  it("a null / absent selection is not overlaid", () => {
    const view = buildEditorView(base(), { secrets: null });
    expect(field(view, "devices", "devicePin")).toBeUndefined();
    expect(field(view, "devices", "unlockHint")!.removed).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npm --prefix apps/desktop run test -- src/creator/editorView.test.ts`. Expected: module not found / `buildEditorView` undefined.

- [ ] **Step 3: Implement** — create `apps/desktop/src/creator/editorView.ts`:

```typescript
/**
 * buildEditorView — a provenance-annotated view of the base pack overlaid with
 * a set of module options, for the pack editor's overlay Design view.
 *
 * Unlike composePack (which resolves to a runtime artifact and DROPS removed
 * items), this KEEPS removed sections/fields — flagged `removed: true` so the
 * editor can render them struck-through — and tags every section/field with the
 * layer it comes from (`base` or a specific module option). It never renumbers;
 * ordering is for display only.
 *
 * Pure — no React, no IPC.
 */

import type {
  FieldDefinition,
  FieldGroup,
  FormModuleOption,
  FormPack,
  PackSection,
} from "../domain/formModel";

export type ViewSource = { kind: "base" } | { kind: "module"; moduleId: string; optionId: string };

export interface EditorViewField extends FieldDefinition {
  source: ViewSource;
  removed: boolean;
}
export interface EditorViewGroup extends Omit<FieldGroup, "fields"> {
  fields: EditorViewField[];
}
export interface EditorViewSection extends Omit<PackSection, "groups"> {
  source: ViewSource;
  removed: boolean;
  groups: EditorViewGroup[];
}
export interface EditorView {
  sections: EditorViewSection[];
}

const BASE: ViewSource = { kind: "base" };

function tagSection(section: PackSection, source: ViewSource): EditorViewSection {
  return {
    ...section,
    source,
    removed: false,
    groups: section.groups.map((group) => ({
      ...group,
      fields: group.fields.map((field) => ({ ...field, source, removed: false })),
    })),
  };
}

function findSection(view: EditorView, sectionKey: string): EditorViewSection | undefined {
  return view.sections.find((section) => section.sectionKey === sectionKey);
}

function markSectionRemoved(view: EditorView, sectionKey: string): void {
  const section = findSection(view, sectionKey);
  if (section) section.removed = true;
}

function markFieldRemoved(view: EditorView, key: string): void {
  for (const section of view.sections) {
    for (const group of section.groups) {
      const field = group.fields.find((candidate) => candidate.systemKey === key);
      if (field) field.removed = true;
    }
  }
}

function addField(view: EditorView, source: ViewSource, add: { sectionKey: string; groupKey: string; order: number; field: FieldDefinition }): void {
  const section = findSection(view, add.sectionKey);
  const group = section?.groups.find((candidate) => candidate.groupKey === add.groupKey);
  if (!group) return; // targets a section/group not in the current view — skip in the view
  group.fields.push({ ...add.field, order: add.order, source, removed: false });
}

function applyOption(view: EditorView, source: ViewSource, option: FormModuleOption): void {
  for (const key of option.removeSectionKeys ?? []) markSectionRemoved(view, key);
  for (const add of option.addSections ?? []) {
    view.sections.push({ ...tagSection(add.section, source), order: add.order });
  }
  for (const key of option.removeKeys ?? []) markFieldRemoved(view, key);
  for (const add of option.addFields ?? []) addField(view, source, add);
}

export function buildEditorView(
  base: FormPack,
  viewSelections: Record<string, string | null>,
): EditorView {
  const view: EditorView = {
    sections: base.sections.map((section) => tagSection(section, BASE)),
  };
  const modules = [...(base.modules ?? [])].sort((left, right) => left.order - right.order);
  for (const module of modules) {
    const optionId = viewSelections[module.moduleId];
    if (!optionId) continue; // null / absent = not overlaid
    const option = module.options.find((candidate) => candidate.optionId === optionId);
    if (!option) continue;
    applyOption(view, { kind: "module", moduleId: module.moduleId, optionId }, option);
  }
  // Display order only (removed items keep their slot; never renumbered).
  view.sections.sort((left, right) => left.order - right.order);
  for (const section of view.sections) {
    for (const group of section.groups) {
      group.fields.sort((left, right) => left.order - right.order);
    }
  }
  return view;
}
```

- [ ] **Step 4: Run to verify PASS** — `npm --prefix apps/desktop run test -- src/creator/editorView.test.ts` → all pass (5 tests). Then `npm --prefix apps/desktop run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/creator/editorView.ts apps/desktop/src/creator/editorView.test.ts
git commit -m "feat(pack-editor): add buildEditorView provenance view helper"
```

---

## Task 2: `editorEdits` — route edits to the base or a module option

**Files:**
- Create: `apps/desktop/src/creator/editorEdits.ts`
- Test: `apps/desktop/src/creator/editorEdits.test.ts`

The `activeTarget` is either `{ kind: "base" }` or `{ kind: "module"; moduleId; optionId }`. These pure functions take the base pack + a target and return a new base pack with the edit routed to the right layer: a base edit mutates `pack.sections`; a module edit mutates that option's `addFields` / `removeKeys` / `addSections` / `removeSectionKeys`. Base-layer field edits reuse the existing helpers in `packEdits.ts` (`updateGroup`, `updateSection`) where practical — read that file and prefer its immutable updaters.

- [ ] **Step 1: Write the failing tests** — create `apps/desktop/src/creator/editorEdits.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { FieldDefinition, FormPack } from "../domain/formModel";
import {
  addFieldToTarget,
  removeInTarget,
  type EditTarget,
} from "./editorEdits";

const NEW_FIELD: FieldDefinition = {
  systemKey: "note", label: "Note", type: "text", required: false, protected: false, order: 99,
};

function base(): FormPack {
  return {
    packId: "b", packVersion: "1.0.0", schemaVersion: 1, minAppVersion: "0.0.0", migrations: [],
    sections: [
      {
        sectionKey: "devices", title: "Devices", lede: "", multiRecord: true, order: 1,
        readinessRule: { requiredKeys: ["deviceName"] },
        kitMapping: { entries: [{ heading: "Devices", fields: ["deviceName"] }] },
        groups: [{ groupKey: "device", title: "Device", repeatable: false, order: 1, fields: [
          { systemKey: "deviceName", label: "Device name", type: "text", required: true, protected: true, order: 1 },
        ] }],
      },
    ],
    modules: [
      { moduleId: "secrets", title: "Secrets", question: "?", order: 1, defaultOptionId: "off",
        options: [{ optionId: "off" }, { optionId: "on" }] },
    ],
  };
}

const BASE_TARGET: EditTarget = { kind: "base" };
const SECRETS_ON: EditTarget = { kind: "module", moduleId: "secrets", optionId: "on" };

function group(pack: FormPack, sectionKey: string, groupKey: string) {
  return pack.sections.find((s) => s.sectionKey === sectionKey)!.groups.find((g) => g.groupKey === groupKey)!;
}
function option(pack: FormPack, moduleId: string, optionId: string) {
  return pack.modules!.find((m) => m.moduleId === moduleId)!.options.find((o) => o.optionId === optionId)!;
}

describe("addFieldToTarget", () => {
  it("adds a field into a base group when the target is base", () => {
    const out = addFieldToTarget(base(), BASE_TARGET, "devices", "device", NEW_FIELD);
    expect(group(out, "devices", "device").fields.map((f) => f.systemKey)).toContain("note");
    expect(option(out, "secrets", "on").addFields ?? []).toHaveLength(0);
  });

  it("adds a field into a module option's addFields when the target is a module option", () => {
    const out = addFieldToTarget(base(), SECRETS_ON, "devices", "device", NEW_FIELD);
    // Base group untouched; the field lands on the option as an addField.
    expect(group(out, "devices", "device").fields.map((f) => f.systemKey)).not.toContain("note");
    const added = option(out, "secrets", "on").addFields!;
    expect(added).toHaveLength(1);
    expect(added[0]!.sectionKey).toBe("devices");
    expect(added[0]!.groupKey).toBe("device");
    expect(added[0]!.field.systemKey).toBe("note");
  });
});

describe("removeInTarget", () => {
  it("deletes an unprotected base field outright when the target is base", () => {
    const withField = addFieldToTarget(base(), BASE_TARGET, "devices", "device", NEW_FIELD);
    const out = removeInTarget(withField, BASE_TARGET, "devices", "device", "note");
    expect(group(out, "devices", "device").fields.map((f) => f.systemKey)).not.toContain("note");
  });

  it("adds the key to a module option's removeKeys when the target is a module option", () => {
    const out = removeInTarget(base(), SECRETS_ON, "devices", "device", "deviceName");
    expect(group(out, "devices", "device").fields.map((f) => f.systemKey)).toContain("deviceName"); // base untouched
    expect(option(out, "secrets", "on").removeKeys).toEqual(["deviceName"]);
  });

  it("does not duplicate a key already in the option's removeKeys", () => {
    const once = removeInTarget(base(), SECRETS_ON, "devices", "device", "deviceName");
    const twice = removeInTarget(once, SECRETS_ON, "devices", "device", "deviceName");
    expect(option(twice, "secrets", "on").removeKeys).toEqual(["deviceName"]);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npm --prefix apps/desktop run test -- src/creator/editorEdits.test.ts`. Expected: module not found.

- [ ] **Step 3: Implement** — create `apps/desktop/src/creator/editorEdits.ts`. READ `apps/desktop/src/creator/packEdits.ts` first and reuse `updateGroup` for base edits. Implement (immutable — never mutate inputs):

```typescript
/**
 * editorEdits — route a pack-editor edit to the correct layer. A base-target
 * edit changes pack.sections directly; a module-target edit changes that
 * option's add/remove arrays. Pure and immutable.
 */

import type { FieldDefinition, FormModuleOption, FormPack } from "../domain/formModel";
import { updateGroup } from "./packEdits";

export type EditTarget = { kind: "base" } | { kind: "module"; moduleId: string; optionId: string };

/** Immutably update one module option by (moduleId, optionId). */
function updateOption(
  pack: FormPack,
  moduleId: string,
  optionId: string,
  updater: (option: FormModuleOption) => FormModuleOption,
): FormPack {
  return {
    ...pack,
    modules: (pack.modules ?? []).map((module) =>
      module.moduleId !== moduleId
        ? module
        : {
            ...module,
            options: module.options.map((option) =>
              option.optionId === optionId ? updater(option) : option,
            ),
          },
    ),
  };
}

export function addFieldToTarget(
  pack: FormPack,
  target: EditTarget,
  sectionKey: string,
  groupKey: string,
  field: FieldDefinition,
): FormPack {
  if (target.kind === "base") {
    return updateGroup(pack, sectionKey, groupKey, (group) => ({
      ...group,
      fields: [...group.fields, field],
    }));
  }
  return updateOption(pack, target.moduleId, target.optionId, (option) => ({
    ...option,
    addFields: [...(option.addFields ?? []), { sectionKey, groupKey, order: field.order, field }],
  }));
}

export function removeInTarget(
  pack: FormPack,
  target: EditTarget,
  sectionKey: string,
  groupKey: string,
  systemKey: string,
): FormPack {
  if (target.kind === "base") {
    return updateGroup(pack, sectionKey, groupKey, (group) => ({
      ...group,
      fields: group.fields.filter((field) => field.systemKey !== systemKey),
    }));
  }
  return updateOption(pack, target.moduleId, target.optionId, (option) => {
    const removeKeys = option.removeKeys ?? [];
    return removeKeys.includes(systemKey)
      ? option
      : { ...option, removeKeys: [...removeKeys, systemKey] };
  });
}
```

(Section-level routing — `addSectionToTarget` / `removeSectionInTarget` — follows the identical pattern against `addSections` / `removeSectionKeys`; add them here with matching tests when Plan 3b-2 needs them. This task ships the field-routing core; extend symmetrically as the UI lands. Keep each helper one-purpose.)

- [ ] **Step 4: Run to verify PASS** — `npm --prefix apps/desktop run test -- src/creator/editorEdits.test.ts` → all pass. Then full suite `npm --prefix apps/desktop run test`, `typecheck`, `lint`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/creator/editorEdits.ts apps/desktop/src/creator/editorEdits.test.ts
git commit -m "feat(pack-editor): add edit-routing helpers (base vs module option)"
```

---

## Self-Review

**Spec coverage (this plan = spec §4.2–§4.3 core logic):**
- §4.2 provenance view (`buildEditorView`, keeps removed items, tags source) → Task 1. ✓
- §4.3 active-target edit routing (`editorEdits`) → Task 2 (field routing; section routing extended symmetrically in 3b-2). ✓
- §4.1/§4.4–§4.7 (React shell, section-nav editing, module authoring, property panels, preview, save) → **Plan 3b-2**. Outlined below.

**Placeholder scan:** No TBD/TODO. Task 2 explicitly ships field-routing and notes section-routing extends symmetrically when 3b-2 needs it — a scoping decision, not a placeholder (the pattern is shown).

**Type consistency:** `ViewSource`/`EditTarget` share the same shape (`{kind:"base"}` | `{kind:"module";moduleId;optionId}`) across both modules and the UI to come. `buildEditorView(base, viewSelections)` and the `editorEdits` signatures are stable and reused by 3b-2.

---

## Plan 3b-2 roadmap (the React overlay editor — written after this core lands)

Assembled over `buildEditorView` + `editorEdits`, replacing `PackEditorApp`'s hint/credential toggle:
1. **Editor shell state** — `base` pack, `viewSelections`, `activeTarget`; a modules side panel with per-module view toggles and the active-target selector.
2. **Overlay Design view** — render `buildEditorView(base, viewSelections)`: base plain, active-target items highlighted + editable, other overlays muted, removed struck-through. `+ Add field` / edit / remove route through `editorEdits` into the active target.
3. **Section nav editing** — rename, drag-reorder (reuse `@dnd-kit` as `FieldList` does), add/delete, and module-membership controls (add/remove a section in the active option).
4. **Module authoring panel** — create a module; edit question/helperText/options/default; selecting an option sets the active target.
5. **Property panels** — reuse `FieldPropertyPanel`; add a section property panel and a module property panel.
6. **Preview** — a selection picker feeding `FormRenderer` over `composePack(base, base.modules, selection)`.
7. **Save** — write the base pack (with `modules`) to `default-pack.json` via a simplified save-plugin endpoint.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-23-pack-editor-core-buildeditorview.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, spec + code-quality review between tasks.
2. **Inline Execution** — batch execution with checkpoints.

After this core lands, I'll write **Plan 3b-2 (the React overlay editor)** against the real helpers, then **Plan 3c (credential-tooling retirement)**.
