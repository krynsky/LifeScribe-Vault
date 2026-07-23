# Composable Form Modules — Load Integration & Migration (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the composition engine live — compose the base pack + selected modules at load, migrate `formMode` to `moduleSelections`, add the `secrets` and `file-method` modules to the base pack, and retire the pre-built credential pack and its tooling.

**Architecture:** The engine from Plan 1 (`composePack`, `validateModules`, module types) is wired into the load path. `resolveBasePack` now composes `base + base.modules + profile.moduleSelections`. The two shipped packs collapse to one base pack carrying `modules`; the credential variant is reproduced by the `secrets` module. Existing hint/credential vaults migrate to a `moduleSelections` map. UI (onboarding + a general switch surface) stays on `formMode` for now — Plan 3 replaces it and removes `formMode`.

**Tech Stack:** TypeScript, Vitest, React (Tauri desktop). All logic is domain-level; the only component touch is a one-line profile sync in `Dashboard.handleSwitchMode`.

**Depends on:** Plan 1 (branch `feat/composable-form-modules-engine`, merged or branched from). Source spec: `docs/superpowers/specs/2026-07-23-composable-form-modules-design.md` (§7–§11).

**Design refinements locked in here:**
- `file-method`'s default option `path` is a **no-op** — `documentDigitalLocation` stays in the base pack untouched. Only `attach` swaps it for a file field. This keeps `composePack(base, modules, defaults)` structurally identical to today's packs, so migration is provably faithful.
- `formMode` is **kept** (deprecated) through Plan 2; the load path reads `moduleSelections`. `handleSwitchMode` writes BOTH so the current toggle keeps working until Plan 3.
- Legacy vaults with a `customPack` (form-editor edits) already baked in their mode's fields; their `base.modules` is `undefined`, so composition is a no-op for them and nothing double-adds.

All commands run from repo root. Test command shape: `npm --prefix apps/desktop run test -- <path>`.

---

## Task 1: Profile `moduleSelections` + `formMode` migration

**Files:**
- Modify: `apps/desktop/src/domain/snapshot.ts` (`VaultProfile`, `emptySnapshot`, `normalizeSnapshot`)
- Test: `apps/desktop/src/domain/snapshot.test.ts` (append cases)

- [ ] **Step 1: Write failing tests** — append to `apps/desktop/src/domain/snapshot.test.ts` (add `normalizeSnapshot` / `emptySnapshot` to the existing import from `./snapshot` if not already imported):

```typescript
describe("moduleSelections migration", () => {
  it("seeds { secrets: 'on' } from a legacy credential formMode", () => {
    const parsed = normalizeSnapshot({ profile: { ownerName: "Dana", formMode: "credential" } });
    expect(parsed.profile.moduleSelections).toEqual({ secrets: "on" });
  });

  it("seeds { secrets: 'off' } from a legacy hint formMode", () => {
    const parsed = normalizeSnapshot({ profile: { ownerName: "Dana", formMode: "hint" } });
    expect(parsed.profile.moduleSelections).toEqual({ secrets: "off" });
  });

  it("preserves an explicit moduleSelections map over the formMode-derived seed", () => {
    const parsed = normalizeSnapshot({
      profile: { ownerName: "Dana", formMode: "hint", moduleSelections: { secrets: "on", "file-method": "attach" } },
    });
    expect(parsed.profile.moduleSelections).toEqual({ secrets: "on", "file-method": "attach" });
  });

  it("ignores a non-string-record moduleSelections and falls back to the formMode seed", () => {
    const parsed = normalizeSnapshot({
      profile: { ownerName: "Dana", formMode: "credential", moduleSelections: "bogus" },
    });
    expect(parsed.profile.moduleSelections).toEqual({ secrets: "on" });
  });

  it("emptySnapshot seeds moduleSelections from its formMode", () => {
    expect(emptySnapshot("Dana", "credential").profile.moduleSelections).toEqual({ secrets: "on" });
    expect(emptySnapshot("Dana", "hint").profile.moduleSelections).toEqual({ secrets: "off" });
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npm --prefix apps/desktop run test -- src/domain/snapshot.test.ts`. Expected: FAIL — `profile.moduleSelections` is undefined.

- [ ] **Step 3: Implement** — in `apps/desktop/src/domain/snapshot.ts`:

Add to the `VaultProfile` interface (after `formMode`):

```typescript
  /**
   * moduleId -> selected optionId for composable form modules. Seeded from the
   * legacy `formMode` on read when absent. `formMode` is retained for now and
   * removed in a later change once onboarding/switch UI drives selections.
   */
  moduleSelections: Record<string, string>;
```

Add this helper near the other `as*` helpers (e.g. after `asFormMode`):

```typescript
/** Map a legacy formMode to its equivalent module selection. */
function moduleSelectionsFromFormMode(formMode: FormMode): Record<string, string> {
  return { secrets: formMode === "credential" ? "on" : "off" };
}

function asModuleSelections(value: unknown, formMode: FormMode): Record<string, string> {
  if (isRecord(value) && Object.values(value).every((entry) => typeof entry === "string")) {
    return value as Record<string, string>;
  }
  return moduleSelectionsFromFormMode(formMode);
}
```

In `emptySnapshot`, add `moduleSelections` to the profile:

```typescript
    profile: {
      ownerName,
      reviewCadenceMonths: DEFAULT_REVIEW_CADENCE_MONTHS,
      formMode,
      moduleSelections: moduleSelectionsFromFormMode(formMode),
    },
```

In `normalizeSnapshot`, compute the resolved formMode first, then add `moduleSelections` to the returned profile:

```typescript
    profile: (() => {
      const formMode = asFormMode(profileRaw.formMode, fallbackFormMode);
      return {
        ownerName: asString(profileRaw.ownerName, fallbackOwnerName),
        reviewCadenceMonths,
        formMode,
        moduleSelections: asModuleSelections(profileRaw.moduleSelections, formMode),
        ...(typeof profileRaw.basePackId === "string" && profileRaw.basePackId.length > 0
          ? { basePackId: profileRaw.basePackId }
          : {}),
      };
    })(),
```

(This replaces the existing inline `profile: { ... }` object. Keep every other field of the returned `ParsedSnapshot` unchanged.)

- [ ] **Step 4: Run to verify PASS** — `npm --prefix apps/desktop run test -- src/domain/snapshot.test.ts` → PASS. Then `npm --prefix apps/desktop run typecheck`. This WILL fail elsewhere if any code constructs a `VaultProfile` literal without `moduleSelections`. Fix each such site by adding `moduleSelections` (search: `grep -rn "formMode:" apps/desktop/src --include=*.ts --include=*.tsx | grep -v test`). Most construction goes through `emptySnapshot`/`normalizeSnapshot` (already handled). If `Dashboard.tsx` builds a profile literal (e.g. in `handleSwitchMode`), it is handled in Task 3 — for now, if typecheck flags it, add `moduleSelections: profile.moduleSelections` to satisfy the type and leave the value logic to Task 3.

- [ ] **Step 5: Full suite + commit**

```bash
npm --prefix apps/desktop run test
git add apps/desktop/src/domain/snapshot.ts apps/desktop/src/domain/snapshot.test.ts
git commit -m "feat(modules): add profile.moduleSelections migrated from formMode"
```

---

## Task 2: Add `secrets` and `file-method` modules to the base pack

**Files:**
- Modify: `apps/desktop/src-tauri/resources/packs/default-pack.json` (add a top-level `modules` array)
- Test: `apps/desktop/src/domain/basePackModules.test.ts` (new)

Note: `default-pack.json` currently has NO `modules` field and includes `documentDigitalLocation` (a `path` field, order 4) in the `documents/document` group. Leave the sections untouched; only add the `modules` array.

- [ ] **Step 1: Write the failing test** — create `apps/desktop/src/domain/basePackModules.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import basePackJson from "../../src-tauri/resources/packs/default-pack.json";
import type { FormPack } from "./formModel";
import { composePack } from "./composePack";
import { validatePack } from "./packValidation";

const base = basePackJson as unknown as FormPack;

function fieldKeys(pack: FormPack, sectionKey: string): string[] {
  const section = pack.sections.find((s) => s.sectionKey === sectionKey)!;
  return section.groups.flatMap((g) => g.fields.map((f) => f.systemKey));
}
function kitFields(pack: FormPack, sectionKey: string): string[] {
  return pack.sections.find((s) => s.sectionKey === sectionKey)!.kitMapping.entries.flatMap((e) => e.fields);
}

describe("base pack modules", () => {
  it("declares the secrets and file-method modules and still validates", () => {
    expect(validatePack(base).ok).toBe(true);
    const ids = (base.modules ?? []).map((m) => m.moduleId).sort();
    expect(ids).toEqual(["file-method", "secrets"]);
  });

  it("default selections are a no-op — composed output equals the base sections", () => {
    const composed = composePack(base, base.modules ?? [], {});
    expect(composed.sections).toEqual(base.sections);
  });

  it("secrets:on adds the master password and device PIN plus their kit entries", () => {
    const composed = composePack(base, base.modules ?? [], { secrets: "on" });
    expect(fieldKeys(composed, "password-manager")).toContain("passwordManagerMasterPassword");
    expect(fieldKeys(composed, "devices")).toContain("devicePin");
    expect(kitFields(composed, "password-manager")).toContain("passwordManagerMasterPassword");
    expect(kitFields(composed, "devices")).toContain("devicePin");
  });

  it("file-method:attach swaps the digital-location path field for an attachment field", () => {
    const composed = composePack(base, base.modules ?? [], { "file-method": "attach" });
    const docs = fieldKeys(composed, "documents");
    expect(docs).not.toContain("documentDigitalLocation");
    expect(docs).toContain("documentDigitalFile");
    expect(kitFields(composed, "documents")).toContain("documentDigitalFile");
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npm --prefix apps/desktop run test -- src/domain/basePackModules.test.ts`. Expected: FAIL — `base.modules` is undefined, so the module-id and secrets/file-method assertions fail.

- [ ] **Step 3: Add the `modules` array to `default-pack.json`** — insert a top-level `"modules"` key (sibling of `"sections"` and `"migrations"`) with exactly this value:

```json
  "modules": [
    {
      "moduleId": "secrets",
      "title": "Store secrets",
      "question": "Do you want to store the actual secrets (passwords, PINs) in your vault, or only where to find them?",
      "helperText": "Secrets are encrypted in this vault. Choose \"Only locations\" to keep this vault free of live credentials.",
      "order": 1,
      "defaultOptionId": "off",
      "options": [
        { "optionId": "off", "label": "Only locations (safer)" },
        {
          "optionId": "on",
          "label": "Store the actual secrets",
          "addFields": [
            {
              "sectionKey": "password-manager",
              "groupKey": "plan",
              "order": 4,
              "field": {
                "systemKey": "passwordManagerMasterPassword",
                "label": "Master password",
                "helperText": "The actual master password for your password manager. It is stored encrypted in this vault.",
                "type": "text",
                "required": false,
                "protected": false,
                "order": 4
              }
            },
            {
              "sectionKey": "devices",
              "groupKey": "device",
              "order": 4,
              "field": {
                "systemKey": "devicePin",
                "label": "PIN or passcode",
                "helperText": "The actual unlock PIN or passcode for this device. It is stored encrypted in this vault.",
                "type": "text",
                "required": false,
                "protected": false,
                "order": 4
              }
            }
          ],
          "kitAdditions": {
            "password-manager": ["passwordManagerMasterPassword"],
            "devices": ["devicePin"]
          }
        }
      ]
    },
    {
      "moduleId": "file-method",
      "title": "File handling",
      "question": "For documents, do you want to point to where a file lives, or attach the file into your vault?",
      "helperText": "\"Point to a location\" stores only a path. \"Attach the file\" encrypts a copy into this vault.",
      "order": 2,
      "defaultOptionId": "path",
      "options": [
        { "optionId": "path", "label": "Point to a location on disk" },
        {
          "optionId": "attach",
          "label": "Attach the file into the vault",
          "removeKeys": ["documentDigitalLocation"],
          "addFields": [
            {
              "sectionKey": "documents",
              "groupKey": "document",
              "order": 4,
              "field": {
                "systemKey": "documentDigitalFile",
                "label": "Attached copy",
                "helperText": "Attach a scanned or digital copy. It is stored encrypted in this vault.",
                "type": "file",
                "required": false,
                "protected": false,
                "order": 4
              }
            }
          ],
          "kitAdditions": { "documents": ["documentDigitalFile"] }
        }
      ]
    }
  ]
```

(The `field.order` values inside `addFields` are placeholders that `composePack` overwrites via the `order-0.5` insert + renumber; they must still be present and numeric to satisfy `validateField`.)

- [ ] **Step 4: Run to verify PASS** — `npm --prefix apps/desktop run test -- src/domain/basePackModules.test.ts` → PASS (4 tests). Also `npm --prefix apps/desktop run test -- src/domain/loadDefaultPack.test.ts src/domain/defaultPack.test.ts` to confirm the base pack still loads/validates. If any existing default-pack test asserts an exact section/field count that the `modules` addition disturbs, it should NOT — modules are a sibling of `sections` — but run them to be sure.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/resources/packs/default-pack.json apps/desktop/src/domain/basePackModules.test.ts
git commit -m "feat(modules): declare secrets and file-method modules in the base pack"
```

---

## Task 3: Compose at load + `loadDefaultPack` collapses to one base pack

**Files:**
- Modify: `apps/desktop/src/domain/loadDefaultPack.ts` (drop the credential branch; ignore the mode param)
- Modify: `apps/desktop/src/routes/Dashboard.tsx` (`resolveBasePack` composes; `handleSwitchMode` syncs `moduleSelections`)
- Test: `apps/desktop/src/domain/loadDefaultPack.test.ts` (adjust/extend); `apps/desktop/src/routes/Dashboard.test.tsx` (add a compose-at-load assertion)

- [ ] **Step 1: Simplify `loadDefaultPack`** — replace the body of `apps/desktop/src/domain/loadDefaultPack.ts` so it always loads the single base pack (the hint file), removing the credential import/branch. Keep the `mode` parameter in the signature (now ignored) so existing UI callers still compile:

```typescript
/**
 * Default-pack loading seam. There is now a single base pack; composable
 * modules (composePack) produce the credential/other variants at load, so the
 * former per-mode credential file is gone. The `mode` parameter is retained
 * (ignored) until the onboarding/switch UI stops passing it.
 *
 * The pack is UNTRUSTED INPUT and runs through validatePack before use.
 */

import type { FormMode } from "./snapshot";
import basePackJson from "../../src-tauri/resources/packs/default-pack.json";
import { readDefaultPack } from "../api/vaultApi";
import type { FormPack } from "./formModel";
import { validatePack } from "./packValidation";

function loadStaticBasePack(): FormPack {
  const result = validatePack(basePackJson);
  if (!result.ok) {
    throw new Error(`The bundled base pack failed validation: ${result.errors.join("; ")}`);
  }
  return result.pack;
}

export async function loadDefaultPack(_mode: FormMode = "hint"): Promise<FormPack> {
  let raw: unknown;
  try {
    raw = await readDefaultPack();
  } catch {
    raw = null;
  }
  if (typeof raw === "string") {
    try {
      const result = validatePack(JSON.parse(raw));
      if (result.ok) {
        return result.pack;
      }
    } catch {
      // Malformed resource JSON: fall through to the static copy.
    }
  }
  return loadStaticBasePack();
}
```

Note: `readDefaultPack(variant)` in `vaultApi.ts` currently takes a `"hint" | "credential"` variant. Call it with no argument (defaults to `"hint"`), and on the Rust side the credential resource may still exist — it is simply never requested now. Do not change the Rust command in this task.

- [ ] **Step 2: Update `loadDefaultPack.test.ts`** — any test asserting `loadDefaultPack("credential")` returns the credential pack must change: there is one base pack now. Replace such assertions with: `loadDefaultPack()` (and `loadDefaultPack("credential")`) both return the base pack — e.g. assert `pack.packId` equals the base pack's id and that `pack.modules` is defined. Run `npm --prefix apps/desktop run test -- src/domain/loadDefaultPack.test.ts` and reconcile until green.

- [ ] **Step 3: Compose in `resolveBasePack`** — in `apps/desktop/src/routes/Dashboard.tsx`, add the import `import { composePack } from "../domain/composePack";` and replace `resolveBasePack`:

```typescript
/**
 * The pack this vault renders from: the saved customPack (form-editor edits) or
 * the bundled base pack, then composed with the profile's module selections.
 * Legacy customPacks predate modules (base.modules undefined) so compose is a
 * no-op for them — they already baked in their mode's fields.
 */
async function resolveBasePack(parsed: ParsedSnapshot): Promise<FormPack> {
  const base = parsed.customPack ?? (await loadDefaultPack());
  return composePack(base, base.modules ?? [], parsed.profile.moduleSelections);
}
```

- [ ] **Step 4: Sync `moduleSelections` in `handleSwitchMode`** — still in `Dashboard.tsx`, in `handleSwitchMode`, where the new profile is built (`profile: { ...loaded.vault.profile, formMode: newMode, basePackId: nextBasePackId }`), add the module selection so the existing toggle keeps working now that load reads `moduleSelections`:

```typescript
        profile: {
          ...loaded.vault.profile,
          formMode: newMode,
          moduleSelections: { ...loaded.vault.profile.moduleSelections, secrets: newMode === "credential" ? "on" : "off" },
          basePackId: nextBasePackId,
        },
```

- [ ] **Step 5: Add a Dashboard compose-at-load test** — in `apps/desktop/src/routes/Dashboard.test.tsx`, add a test under the existing top-level flow: a vault whose snapshot profile has `formMode: "credential"` (so migration seeds `{ secrets: "on" }`) shows a secret field the base pack lacks. Use the existing render harness; assert that after unlock, the Password Manager section renders the "Master password" field label. (Follow the patterns already in this file for constructing a loaded snapshot; the section is `password-manager`, the field label is `Master password`.) If the existing harness always starts from an empty vault, instead assert the narrower unit: `composePack(base, base.modules, { secrets: "on" })` exposes `passwordManagerMasterPassword` — but prefer the through-the-app assertion if the harness supports a seeded snapshot.

- [ ] **Step 6: Full suite + typecheck + lint**

```bash
npm --prefix apps/desktop run test
npm --prefix apps/desktop run typecheck
npm --prefix apps/desktop run lint
```
Expected: all green. Existing hint vaults compose to the base (no-op); credential vaults now gain their secret fields via composition rather than the credential file.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/domain/loadDefaultPack.ts apps/desktop/src/domain/loadDefaultPack.test.ts apps/desktop/src/routes/Dashboard.tsx apps/desktop/src/routes/Dashboard.test.tsx
git commit -m "feat(modules): compose base pack + module selections at load"
```

---

## Task 4: Retire the pre-built credential pack + tooling; add a durable compatibility guard

**Files:**
- Create: `apps/desktop/src/domain/testing/legacy-credential-pack.json` (frozen golden copy of the old credential pack)
- Create: `apps/desktop/src/domain/credentialCompatibility.test.ts`
- Delete: `apps/desktop/src/domain/credentialPack.test.ts`, `apps/desktop/src-tauri/resources/packs/default-pack-credential.json`, `apps/desktop/scripts/credential-overlay.json`, `apps/desktop/scripts/build-credential-pack.mjs`, `apps/desktop/scripts/lib/credential-pack.mjs`, `apps/desktop/scripts/lib/credential-pack.d.mts`
- Modify: `apps/desktop/package.json` (remove the `build:credential-pack` script), `apps/desktop/src/domain/loadDefaultPack.ts` (remove the now-unused credential import if any remains), `apps/desktop/pack-editor/save-plugin.mjs` + `apps/desktop/scripts/lib/save-artifacts.mjs` (these import the credential-pack transform — see Step 5)

- [ ] **Step 1: Freeze the golden credential pack as a test fixture** — copy the current committed credential pack to a fixture the compatibility test will own:

```bash
cp apps/desktop/src-tauri/resources/packs/default-pack-credential.json apps/desktop/src/domain/testing/legacy-credential-pack.json
```

- [ ] **Step 2: Write the compatibility test** — create `apps/desktop/src/domain/credentialCompatibility.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import basePackJson from "../../src-tauri/resources/packs/default-pack.json";
import legacyCredentialJson from "./testing/legacy-credential-pack.json";
import type { FormPack } from "./formModel";
import { composePack } from "./composePack";

const base = basePackJson as unknown as FormPack;
const legacy = legacyCredentialJson as unknown as FormPack;

describe("credential compatibility", () => {
  it("secrets:on (with default file-method) reproduces the retired credential pack's sections", () => {
    const composed = composePack(base, base.modules ?? [], { secrets: "on", "file-method": "path" });
    // packId/packVersion/modules differ by design; the field & kit structure must match.
    expect(composed.sections).toEqual(legacy.sections);
  });

  it("secrets:off reproduces the hint pack's sections", () => {
    const composed = composePack(base, base.modules ?? [], { secrets: "off", "file-method": "path" });
    expect(composed.sections).toEqual(base.sections);
  });
});
```

- [ ] **Step 3: Run it against the still-present files to prove fidelity** — `npm --prefix apps/desktop run test -- src/domain/credentialCompatibility.test.ts`. Expected: PASS. If the first test fails, the module definitions in Task 2 do not faithfully reproduce the credential pack — reconcile the `addFields`/`order`/`kitAdditions` against `legacy.sections` until it matches BEFORE deleting anything.

- [ ] **Step 4: Delete the drift-guard test and the retired artifacts**

```bash
git rm apps/desktop/src/domain/credentialPack.test.ts \
       apps/desktop/src-tauri/resources/packs/default-pack-credential.json \
       apps/desktop/scripts/credential-overlay.json \
       apps/desktop/scripts/build-credential-pack.mjs \
       apps/desktop/scripts/lib/credential-pack.mjs \
       apps/desktop/scripts/lib/credential-pack.d.mts
```

- [ ] **Step 5: Fix the two remaining importers of the deleted transform** — the pack-editor dev tooling imports `buildCredentialPack`:
  - `apps/desktop/pack-editor/save-plugin.mjs` imports from `../scripts/lib/credential-pack.mjs` and regenerates the credential pack on save.
  - `apps/desktop/scripts/lib/save-artifacts.mjs` imports `buildCredentialPack` from `./credential-pack.mjs`.

  The pack-editor is creator-only dev tooling and is **excluded from lint/typecheck** (see `eslint.config.js` ignores and `tsconfig.pack-editor.json`), so this will not break `npm run typecheck`/`lint`/`test`. However, leaving dead imports that reference deleted files makes the pack editor crash at runtime. For THIS plan, do the minimal safe thing: in `save-plugin.mjs`, remove the credential-regeneration branch (the `hintMode` POST path that writes `PACK_PATH` via `buildCredentialPack`) and the `PACK_PATH`/`buildCredentialPack`/`renderSaveArtifacts` usages, so saving the hint pack writes only the hint file; and delete `save-artifacts.mjs` if nothing else imports it (grep first: `grep -rn "save-artifacts" apps/desktop`). If the pack editor's credential-overlay editing is now meaningless (the overlay file is deleted), also remove the credential-overlay read paths in `save-plugin.mjs`. Note in the commit message that full pack-editor rework for modules is deferred to the Plan 3 authoring-UX spec. If this step balloons beyond mechanical import removal, STOP and report DONE_WITH_CONCERNS rather than redesigning the pack editor here.

- [ ] **Step 6: Remove the npm script** — in `apps/desktop/package.json`, delete the line `"build:credential-pack": "node scripts/build-credential-pack.mjs",`. Grep for other references (`grep -rn "build:credential-pack\|build-credential-pack" apps/desktop docs` ) and remove/adjust any that remain (e.g. root `package.json` proxy script if present).

- [ ] **Step 7: Full suite + typecheck + lint** — `npm --prefix apps/desktop run test` (the retired drift-guard test is gone; the compatibility test replaces it), `npm --prefix apps/desktop run typecheck`, `npm --prefix apps/desktop run lint`. All green. Confirm `git grep -n "default-pack-credential\|credential-overlay\|buildCredentialPack"` returns only historical/docs references, none in shipped `src/`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(modules): retire pre-built credential pack; secrets module + compatibility guard replace it"
```

---

## Self-Review

**Spec coverage (this plan = spec §7–§11):**
- §7 compose at load → Task 3 (`resolveBasePack`). ✓
- §5.2 profile `moduleSelections` + §10 formMode migration → Task 1. ✓
- §11 `secrets` + `file-method` modules; §11 `path` default keeps `documentDigitalLocation` → Task 2. ✓
- §10 retire pre-built credential pack + tooling + drift test; compatibility guard → Task 4. ✓
- §8–§9 onboarding + switch UI → **Plan 3** (out of scope; interim `handleSwitchMode` sync in Task 3 Step 4 keeps the current toggle working). ✓ (noted)

**Placeholder scan:** No TBD/TODO. JSON blocks and code blocks are complete. Task 3 Step 5 offers a concrete fallback assertion if the Dashboard harness can't seed a snapshot — that's a documented branch, not a placeholder. Task 4 Step 5 is bounded with an explicit STOP condition.

**Type consistency:** `moduleSelections: Record<string, string>` is used identically in `VaultProfile`, `emptySnapshot`, `normalizeSnapshot`, `resolveBasePack`, and `handleSwitchMode`. `composePack(base, modules, selections)` matches Plan 1's exported signature. Module `moduleId`s (`"secrets"`, `"file-method"`) and option ids (`"on"/"off"`, `"path"/"attach"`) are consistent across the base-pack JSON (Task 2), the migration seed (Task 1), and the tests (Tasks 2–4).

**Risk notes for the implementer:**
- Task 1 Step 4 may surface `VaultProfile` literal construction sites needing `moduleSelections`; the grep is provided.
- Task 4 Step 3 MUST pass before any deletion in Step 4 — it is the proof the migration is faithful.
- Task 4 Step 5 (pack-editor dev tooling) is the one open-ended spot; it is bounded with a STOP-and-report instruction.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-23-composable-form-modules-load-and-migration.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, spec + code-quality review between tasks.
2. **Inline Execution** — batch execution with checkpoints.

After this lands, **Plan 3 (onboarding UI iterates modules; general switch surface; remove `formMode`)** finishes the feature.
