# Composable Form Modules — Engine Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure composition engine — module types, a deterministic `composePack()` function, and module validation — with zero behavior change to the running app.

**Architecture:** A module is declarative data embedded in a `FormPack` (`modules?: FormModule[]`). Each module is an onboarding question with mutually-exclusive options; each option carries whole-field `addFields`/`removeKeys` (+ `kitAdditions`). `composePack(base, modules, selections)` clones the base and applies each selected option (remove → add → kit) in module order, returning a validated-shape pack. Nothing is wired into load/onboarding yet.

**Tech Stack:** TypeScript, Vitest. Pure domain code under `apps/desktop/src/domain/`. No React, no Tauri IPC.

**Decomposition — this is Plan 1 of 3:**
- **Plan 1 (this doc): Engine.** Types, `composePack`, module validation. Pure, fully unit-tested, unused by the app. Ships a working, tested library.
- **Plan 2: Load integration + migration.** Add `profile.moduleSelections`; migrate `formMode` → selections in `normalizeSnapshot`; call `composePack` in `resolveBasePack`; add the `secrets` + `file-method` modules to `default-pack.json` (move `documentDigitalLocation` into `file-method`); retire the pre-built credential pack, its tooling, and its drift-guard (replaced by a `composePack` compatibility test).
- **Plan 3: Onboarding + switch UI.** Generalize `SetupScreen` to iterate `base.modules`; generalize the "Switch to locations only" toggle to a module-choice surface; remove `formMode` from the profile.

Source spec: `docs/superpowers/specs/2026-07-23-composable-form-modules-design.md`.

All commands run from the repo root. Test command shape: `npm --prefix apps/desktop run test -- <path>`.

---

## Task 1: Module types

**Files:**
- Modify: `apps/desktop/src/domain/formModel.ts` (append after the `FormPack` interface, ~line 118)

- [ ] **Step 1: Add the module types and extend `FormPack`**

Append these interfaces to `formModel.ts` (place them immediately after the existing `FormPack` interface):

```typescript
// ---------------------------------------------------------------------------
// Composable form modules — an onboarding question whose selected option adds
// or removes whole fields on the base pack. Declarative data only (no scripts).
// Composition happens in composePack.ts; selection lives in the vault profile.
// ---------------------------------------------------------------------------

/** A whole field a module option inserts, with its placement in the base pack. */
export interface ModuleAddField {
  sectionKey: string;
  groupKey: string;
  /** Desired FINAL slot; inserted at order-0.5 then the group is renumbered. */
  order: number;
  field: FieldDefinition;
}

/** One mutually-exclusive answer to a module's question. */
export interface FormModuleOption {
  optionId: string;
  label: string;
  description?: string;
  /** Whole fields this option inserts into the composed pack. */
  addFields?: ModuleAddField[];
  /** systemKeys this option removes from the composed pack. */
  removeKeys?: string[];
  /** sectionKey -> systemKeys appended to the section's first kitMapping entry. */
  kitAdditions?: Record<string, string[]>;
}

/** An onboarding question. A binary toggle is just a 2-option module. */
export interface FormModule {
  moduleId: string;
  title: string;
  question: string;
  helperText?: string;
  options: FormModuleOption[];
  /** optionId used when the profile has no selection for this module. */
  defaultOptionId: string;
  /** Onboarding display order and composition order (ascending). */
  order: number;
}
```

Then add the optional `modules` field to the existing `FormPack` interface:

```typescript
export interface FormPack {
  packId: string;
  packVersion: string;
  schemaVersion: number;
  minAppVersion: string;
  sections: PackSection[];
  migrations: MigrationStep[];
  /** Optional onboarding modules composed onto this pack at load. */
  modules?: FormModule[];
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm --prefix apps/desktop run typecheck`
Expected: no errors (types are additive; `modules` is optional so existing packs still satisfy `FormPack`).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/domain/formModel.ts
git commit -m "feat(modules): add FormModule types to the form model"
```

---

## Task 2: `composePack()`

**Files:**
- Create: `apps/desktop/src/domain/composePack.ts`
- Test: `apps/desktop/src/domain/composePack.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/domain/composePack.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { FormModule, FormPack } from "./formModel";
import { composePack } from "./composePack";

function basePack(): FormPack {
  return {
    packId: "base",
    packVersion: "1.0.0",
    schemaVersion: 1,
    minAppVersion: "0.0.0",
    migrations: [],
    sections: [
      {
        sectionKey: "devices",
        title: "Devices",
        lede: "",
        multiRecord: true,
        order: 1,
        readinessRule: { requiredKeys: ["deviceName"] },
        kitMapping: { entries: [{ heading: "Devices", fields: ["deviceName"] }] },
        groups: [
          {
            groupKey: "device",
            title: "Device",
            repeatable: false,
            order: 1,
            fields: [
              { systemKey: "deviceName", label: "Device name", type: "text", required: true, protected: true, order: 1 },
              { systemKey: "unlockHint", label: "Unlock hint", type: "text", required: false, protected: false, order: 2 },
            ],
          },
        ],
      },
    ],
  };
}

const secretsModule: FormModule = {
  moduleId: "secrets",
  title: "Secrets",
  question: "Store the actual secrets?",
  order: 1,
  defaultOptionId: "off",
  options: [
    { optionId: "off" },
    {
      optionId: "on",
      addFields: [
        {
          sectionKey: "devices",
          groupKey: "device",
          order: 3,
          field: { systemKey: "devicePin", label: "PIN", type: "text", required: false, protected: false, order: 3 },
        },
      ],
      kitAdditions: { devices: ["devicePin"] },
    },
  ],
};

describe("composePack", () => {
  it("returns a clone of the base when the default option is a no-op", () => {
    const out = composePack(basePack(), [secretsModule], {});
    expect(out).not.toBe(basePack());
    expect(out.sections[0]!.groups[0]!.fields.map((f) => f.systemKey)).toEqual([
      "deviceName",
      "unlockHint",
    ]);
  });

  it("adds a field and its kit mapping when the option is selected", () => {
    const out = composePack(basePack(), [secretsModule], { secrets: "on" });
    const fields = out.sections[0]!.groups[0]!.fields;
    expect(fields.map((f) => f.systemKey)).toEqual(["deviceName", "unlockHint", "devicePin"]);
    // Group is renumbered to sequential integers.
    expect(fields.map((f) => f.order)).toEqual([1, 2, 3]);
    expect(out.sections[0]!.kitMapping.entries[0]!.fields).toEqual(["deviceName", "devicePin"]);
  });

  it("removes a field when an option's removeKeys names it", () => {
    const removeModule: FormModule = {
      moduleId: "trim",
      title: "Trim",
      question: "?",
      order: 1,
      defaultOptionId: "keep",
      options: [{ optionId: "keep" }, { optionId: "drop", removeKeys: ["unlockHint"] }],
    };
    const out = composePack(basePack(), [removeModule], { trim: "drop" });
    expect(out.sections[0]!.groups[0]!.fields.map((f) => f.systemKey)).toEqual(["deviceName"]);
  });

  it("applies modules in ascending order (remove before add within an option)", () => {
    const swap: FormModule = {
      moduleId: "swap",
      title: "Swap",
      question: "?",
      order: 1,
      defaultOptionId: "b",
      options: [
        {
          optionId: "b",
          removeKeys: ["unlockHint"],
          addFields: [
            {
              sectionKey: "devices",
              groupKey: "device",
              order: 2,
              field: { systemKey: "unlockNote", label: "Note", type: "textarea", required: false, protected: false, order: 2 },
            },
          ],
        },
      ],
    };
    const out = composePack(basePack(), [swap], { swap: "b" });
    expect(out.sections[0]!.groups[0]!.fields.map((f) => f.systemKey)).toEqual([
      "deviceName",
      "unlockNote",
    ]);
  });

  it("is deterministic: same inputs produce deep-equal output", () => {
    const a = composePack(basePack(), [secretsModule], { secrets: "on" });
    const b = composePack(basePack(), [secretsModule], { secrets: "on" });
    expect(a).toEqual(b);
  });

  it("throws on an addField that references an unknown group", () => {
    const bad: FormModule = {
      moduleId: "bad",
      title: "Bad",
      question: "?",
      order: 1,
      defaultOptionId: "on",
      options: [
        {
          optionId: "on",
          addFields: [
            {
              sectionKey: "devices",
              groupKey: "nope",
              order: 1,
              field: { systemKey: "x", label: "X", type: "text", required: false, protected: false, order: 1 },
            },
          ],
        },
      ],
    };
    expect(() => composePack(basePack(), [bad], { bad: "on" })).toThrow(/unknown group/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix apps/desktop run test -- src/domain/composePack.test.ts`
Expected: FAIL — `composePack` is not defined / module not found.

- [ ] **Step 3: Implement `composePack`**

Create `apps/desktop/src/domain/composePack.ts`:

```typescript
/**
 * Pure composition: base FormPack + selected module options -> composed FormPack.
 *
 * Deterministic and idempotent — output depends only on (base, modules,
 * selections). Modules apply in ascending `order`; within an option, removals
 * happen before additions, then touched groups are renumbered to sequential
 * integers. The caller is responsible for running the result through
 * validatePack before rendering (never silent acceptance).
 *
 * No React, no IPC — plain data only.
 */

import type {
  FieldGroup,
  FormModule,
  FormModuleOption,
  FormPack,
  ModuleAddField,
} from "./formModel";

function selectedOption(
  module: FormModule,
  selections: Record<string, string>,
): FormModuleOption | undefined {
  const optionId = selections[module.moduleId] ?? module.defaultOptionId;
  return (
    module.options.find((option) => option.optionId === optionId) ??
    module.options.find((option) => option.optionId === module.defaultOptionId)
  );
}

function removeFields(pack: FormPack, keys: Set<string>, touched: Set<FieldGroup>): void {
  if (keys.size === 0) return;
  for (const section of pack.sections) {
    for (const group of section.groups) {
      const before = group.fields.length;
      group.fields = group.fields.filter((field) => !keys.has(field.systemKey));
      if (group.fields.length !== before) {
        touched.add(group);
      }
    }
  }
}

function addField(pack: FormPack, add: ModuleAddField, touched: Set<FieldGroup>): void {
  const section = pack.sections.find((candidate) => candidate.sectionKey === add.sectionKey);
  if (!section) {
    throw new Error(`module addField references unknown section "${add.sectionKey}"`);
  }
  const group = section.groups.find((candidate) => candidate.groupKey === add.groupKey);
  if (!group) {
    throw new Error(`module addField references unknown group "${add.sectionKey}/${add.groupKey}"`);
  }
  // order-0.5 sorts the new field just ahead of whatever holds that slot.
  group.fields.push({ ...add.field, order: add.order - 0.5 });
  touched.add(group);
}

function renumber(touched: Set<FieldGroup>): void {
  for (const group of touched) {
    group.fields.sort((left, right) => left.order - right.order);
    group.fields.forEach((field, index) => {
      field.order = index + 1;
    });
  }
}

function applyKitAdditions(pack: FormPack, kitAdditions: Record<string, string[]>): void {
  for (const [sectionKey, keys] of Object.entries(kitAdditions)) {
    const section = pack.sections.find((candidate) => candidate.sectionKey === sectionKey);
    if (!section) {
      throw new Error(`module kitAdditions references unknown section "${sectionKey}"`);
    }
    const entry = section.kitMapping?.entries?.[0];
    if (!entry) {
      throw new Error(`section "${sectionKey}" has no kitMapping entry to extend`);
    }
    for (const key of keys) {
      if (!entry.fields.includes(key)) {
        entry.fields.push(key);
      }
    }
  }
}

export function composePack(
  base: FormPack,
  modules: FormModule[],
  selections: Record<string, string>,
): FormPack {
  const pack = structuredClone(base);
  const ordered = [...modules].sort((left, right) => left.order - right.order);
  for (const module of ordered) {
    const option = selectedOption(module, selections);
    if (!option) continue;
    const touched = new Set<FieldGroup>();
    removeFields(pack, new Set(option.removeKeys ?? []), touched);
    for (const add of option.addFields ?? []) {
      addField(pack, add, touched);
    }
    renumber(touched);
    applyKitAdditions(pack, option.kitAdditions ?? {});
  }
  return pack;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix apps/desktop run test -- src/domain/composePack.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/domain/composePack.ts apps/desktop/src/domain/composePack.test.ts
git commit -m "feat(modules): add pure composePack() composition engine"
```

---

## Task 3: Module validation

**Files:**
- Modify: `apps/desktop/src/domain/packValidation.ts` (add an exported `validateModules`; call it from `validatePack`)
- Test: `apps/desktop/src/domain/packValidation.test.ts` (append a `validateModules` describe block)

Validation rules (from spec §6): modules may only add/remove **unprotected** fields; `removeKeys` must reference existing base fields; added `systemKey`s must be globally unique and never in the `custom.*` namespace; no `systemKey` is added by more than one module; and each option, composed alone onto the base, must yield a pack that passes `validatePack`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/src/domain/packValidation.test.ts`:

```typescript
import { validateModules } from "./packValidation";
import { composePack } from "./composePack";
import type { FormModule, FormPack } from "./formModel";

function moduleBasePack(): FormPack {
  return {
    packId: "base",
    packVersion: "1.0.0",
    schemaVersion: 1,
    minAppVersion: "0.0.0",
    migrations: [],
    sections: [
      {
        sectionKey: "devices",
        title: "Devices",
        lede: "",
        multiRecord: true,
        order: 1,
        readinessRule: { requiredKeys: ["deviceName"] },
        kitMapping: { entries: [{ heading: "Devices", fields: ["deviceName"] }] },
        groups: [
          {
            groupKey: "device",
            title: "Device",
            repeatable: false,
            order: 1,
            fields: [
              { systemKey: "deviceName", label: "Device name", type: "text", required: true, protected: true, order: 1 },
              { systemKey: "unlockHint", label: "Unlock hint", type: "text", required: false, protected: false, order: 2 },
            ],
          },
        ],
      },
    ],
  };
}

function addFieldModule(systemKey: string, order = 3): FormModule {
  return {
    moduleId: "secrets",
    title: "Secrets",
    question: "?",
    order: 1,
    defaultOptionId: "off",
    options: [
      { optionId: "off" },
      {
        optionId: "on",
        addFields: [
          {
            sectionKey: "devices",
            groupKey: "device",
            order,
            field: { systemKey, label: "PIN", type: "text", required: false, protected: false, order },
          },
        ],
      },
    ],
  };
}

describe("validateModules", () => {
  it("accepts a well-formed module that composes to a valid pack", () => {
    const pack = { ...moduleBasePack(), modules: [addFieldModule("devicePin")] };
    expect(validateModules(pack, composePack).errors).toEqual([]);
  });

  it("rejects a removeKeys that targets a protected field", () => {
    const remove: FormModule = {
      moduleId: "trim",
      title: "Trim",
      question: "?",
      order: 1,
      defaultOptionId: "keep",
      options: [{ optionId: "keep" }, { optionId: "drop", removeKeys: ["deviceName"] }],
    };
    const pack = { ...moduleBasePack(), modules: [remove] };
    const { errors } = validateModules(pack, composePack);
    expect(errors.join(" ")).toMatch(/protected/i);
  });

  it("rejects a removeKeys that references an unknown field", () => {
    const remove: FormModule = {
      moduleId: "trim",
      title: "Trim",
      question: "?",
      order: 1,
      defaultOptionId: "keep",
      options: [{ optionId: "keep" }, { optionId: "drop", removeKeys: ["ghost"] }],
    };
    const { errors } = validateModules({ ...moduleBasePack(), modules: [remove] }, composePack);
    expect(errors.join(" ")).toMatch(/unknown field/i);
  });

  it("rejects an added systemKey in the custom.* namespace", () => {
    const pack = { ...moduleBasePack(), modules: [addFieldModule("custom.devices.x")] };
    const { errors } = validateModules(pack, composePack);
    expect(errors.join(" ")).toMatch(/custom\./);
  });

  it("rejects the same systemKey added by two different modules", () => {
    const a = addFieldModule("dup");
    const b = { ...addFieldModule("dup"), moduleId: "other", order: 2 };
    const { errors } = validateModules({ ...moduleBasePack(), modules: [a, b] }, composePack);
    expect(errors.join(" ")).toMatch(/added by more than one module/i);
  });

  it("rejects a module with fewer than two options", () => {
    const one: FormModule = {
      moduleId: "x", title: "X", question: "?", order: 1, defaultOptionId: "a",
      options: [{ optionId: "a" }],
    };
    const { errors } = validateModules({ ...moduleBasePack(), modules: [one] }, composePack);
    expect(errors.join(" ")).toMatch(/at least two options/i);
  });

  it("rejects a defaultOptionId that is not one of the options", () => {
    const bad: FormModule = {
      moduleId: "x", title: "X", question: "?", order: 1, defaultOptionId: "missing",
      options: [{ optionId: "a" }, { optionId: "b" }],
    };
    const { errors } = validateModules({ ...moduleBasePack(), modules: [bad] }, composePack);
    expect(errors.join(" ")).toMatch(/defaultOptionId/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix apps/desktop run test -- src/domain/packValidation.test.ts`
Expected: FAIL — `validateModules` is not exported.

- [ ] **Step 3: Implement `validateModules`**

In `apps/desktop/src/domain/packValidation.ts`, add these imports at the top (merge with existing imports):

```typescript
import type { FormModule, FormPack, PackSection } from "./formModel";
import { isCustomFieldKey } from "./formModel";
```

Add this exported function (place it near the other exported validators, e.g. after `validatePack`):

```typescript
/** Index every field in a pack: systemKey -> { protected }. */
function indexPackFields(pack: FormPack): Map<string, { protected: boolean }> {
  const index = new Map<string, { protected: boolean }>();
  for (const section of pack.sections) {
    for (const group of section.groups) {
      for (const field of group.fields) {
        index.set(field.systemKey, { protected: field.protected });
      }
    }
  }
  return index;
}

/**
 * Validate a pack's optional `modules`. Modules may only add or remove
 * UNPROTECTED fields; added keys must be globally unique, outside the custom.*
 * namespace, and never contributed by two modules; each option must compose to
 * a pack that passes validatePack. `compose` is injected to avoid an import
 * cycle with composePack.ts.
 */
export function validateModules(
  pack: FormPack,
  compose: (base: FormPack, modules: FormModule[], selections: Record<string, string>) => FormPack,
): { errors: string[] } {
  const errors: string[] = [];
  const modules = pack.modules ?? [];
  const baseFields = indexPackFields(pack);
  const addedBy = new Map<string, string>(); // systemKey -> moduleId

  for (const module of modules) {
    const label = `module "${module.moduleId}"`;
    if (module.options.length < 2) {
      errors.push(`${label} must offer at least two options.`);
    }
    const optionIds = new Set(module.options.map((option) => option.optionId));
    if (!optionIds.has(module.defaultOptionId)) {
      errors.push(`${label} defaultOptionId "${module.defaultOptionId}" is not one of its options.`);
    }

    for (const option of module.options) {
      for (const key of option.removeKeys ?? []) {
        const existing = baseFields.get(key);
        if (!existing) {
          errors.push(`${label} option "${option.optionId}" removeKeys references unknown field "${key}".`);
        } else if (existing.protected) {
          errors.push(`${label} option "${option.optionId}" may not remove the protected field "${key}".`);
        }
      }
      for (const add of option.addFields ?? []) {
        if (add.field.protected) {
          errors.push(`${label} option "${option.optionId}" may not add a protected field "${add.field.systemKey}".`);
        }
        if (isCustomFieldKey(add.field.systemKey)) {
          errors.push(`${label} option "${option.optionId}" added field "${add.field.systemKey}" must not use the custom.* namespace.`);
        }
        const priorModule = addedBy.get(add.field.systemKey);
        if (priorModule && priorModule !== module.moduleId) {
          errors.push(`Field "${add.field.systemKey}" is added by more than one module ("${priorModule}" and "${module.moduleId}").`);
        }
        addedBy.set(add.field.systemKey, module.moduleId);
      }
    }
  }

  // Every option, composed alone onto the base, must yield a valid pack.
  for (const module of modules) {
    for (const option of module.options) {
      let composed: FormPack;
      try {
        composed = compose(pack, [module], { [module.moduleId]: option.optionId });
      } catch (error) {
        errors.push(`module "${module.moduleId}" option "${option.optionId}" failed to compose: ${String((error as Error).message ?? error)}`);
        continue;
      }
      const result = validatePack({ ...composed, modules: undefined });
      if (!result.ok) {
        errors.push(
          `module "${module.moduleId}" option "${option.optionId}" produces an invalid pack: ${result.errors.join("; ")}`,
        );
      }
    }
  }

  return { errors };
}
```

Note: `validatePack({ ...composed, modules: undefined })` strips the `modules` field so the compatibility check validates only the composed sections/fields. `validatePack` ignores unknown/extra fields, but stripping keeps the intent explicit.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix apps/desktop run test -- src/domain/packValidation.test.ts`
Expected: PASS (all existing tests plus the 7 new `validateModules` tests).

- [ ] **Step 5: Wire `validateModules` into `validatePack` (guarded, non-breaking)**

Packs without `modules` must be unaffected. At the end of `validatePack`, before it returns, add:

```typescript
  if (Array.isArray(candidate.modules) && candidate.modules.length > 0) {
    // Lazy require avoids an import cycle (composePack has no packValidation dep).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { composePack } = require("./composePack") as typeof import("./composePack");
    const moduleResult = validateModules(candidate as unknown as FormPack, composePack);
    errors.push(...moduleResult.errors);
  }
```

If the file is ESM-only and `require` is unavailable, instead import `composePack` at the top of `packValidation.ts` (`import { composePack } from "./composePack";`) — `composePack.ts` imports only from `formModel.ts`, so there is no cycle. Prefer the static import; it is cleaner:

```typescript
import { composePack } from "./composePack";
// ...
  if (Array.isArray(candidate.modules) && candidate.modules.length > 0) {
    errors.push(...validateModules(candidate as unknown as FormPack, composePack).errors);
  }
```

- [ ] **Step 6: Run the full suite + typecheck + lint**

Run: `npm --prefix apps/desktop run test`
Expected: PASS (all suites; existing packs have no `modules`, so behavior is unchanged).

Run: `npm --prefix apps/desktop run typecheck`
Expected: no errors.

Run: `npm --prefix apps/desktop run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/domain/packValidation.ts apps/desktop/src/domain/packValidation.test.ts
git commit -m "feat(modules): validate pack modules (unprotected-only, unique keys, composes valid)"
```

---

## Self-Review

**Spec coverage (this plan = spec §4, §5.1, §6, and §12 validation rules):**
- §5.1 module data shape → Task 1. ✓
- §6 composition algorithm (remove→add→renumber→kit, module order, determinism) → Task 2. ✓
- §6 validation rules (unprotected-only, removeKeys exist, unique non-custom keys, no cross-module dup, each option composes valid) → Task 3. ✓
- Spec §7–§11 (load integration, profile, migration, onboarding, base-pack content, retirement) → **Plan 2 / Plan 3**, intentionally out of scope here.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows exact command and expected result. ✓

**Type consistency:** `FormModule`/`FormModuleOption`/`ModuleAddField` fields (`moduleId`, `optionId`, `addFields`, `removeKeys`, `kitAdditions`, `defaultOptionId`, `order`) are used identically in Tasks 1–3. `composePack(base, modules, selections)` signature matches its call sites in the tests and in `validateModules`. ✓

**Note on `require` vs import (Task 3 Step 5):** the static-import form is preferred and has no cycle (`composePack` depends only on `formModel`). The `require` fallback is listed only in case of an unexpected bundler constraint.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-23-composable-form-modules-engine.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

After this engine plan lands, I'll write **Plan 2 (load integration + migration + base-pack modules + credential-pack retirement)**, then **Plan 3 (onboarding + switch UI)**.
