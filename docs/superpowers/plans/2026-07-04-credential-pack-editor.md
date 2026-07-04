# Credential Pack Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A separate, dev-only, browser-based WYSIWYG editor for the credential form that reuses the vault app's form components and, on save, derives the overlay and regenerates `default-pack-credential.json`.

**Architecture:** A standalone Vite app under `apps/desktop/pack-editor/` reuses `FormRenderer`, `packEdits`, `mergePackWithOverlay`, and `validatePack` from `../src`. A Vite dev-server plugin exposes `GET/POST /__pack` for disk I/O. Save posts the edited `FormPack`; the server derives the overlay (`deriveOverlay`, the inverse of the existing generator) and regenerates the pack, keeping `credential-overlay.json` the committed source of truth.

**Tech Stack:** TypeScript + React 19, Vite 7, Vitest + RTL, Node ESM (`.mjs`) dev tooling.

**Spec:** `docs/superpowers/specs/2026-07-04-credential-pack-editor-design.md`

**v1 editing scope:** field label, helper text, type, required, dropdown options (all via the reused `InlineFieldEditor`), reorder within a group (move up/down), and add/remove fields. **Recovery-Kit membership editing is deferred to v2** — the reused editor does not expose it, and the overlay only encodes kit *additions* (removing a hint-kit field is not representable), so it needs a deliberate overlay extension. Added secret fields already flow to the Kit via the committed overlay's `kitAdditions`, and `deriveOverlay` preserves that. The spec's future-enhancements section records this.

---

## Background the engineer needs

- The credential pack is already generated from `apps/desktop/scripts/credential-overlay.json` + the hint pack by `apps/desktop/scripts/lib/credential-pack.mjs` (`buildCredentialPack(hintPack, overlay)` and `serializePack(pack)`). A drift test (`src/domain/credentialPack.test.ts`) asserts the committed pack equals the generator output. **Do not change the generator** — this plan adds its inverse.
- `buildCredentialPack` inserts added fields at `order - 0.5` and renumbers touched groups to sequential integers. Because a group's final positions are always distinct integers, the inverse can reproduce them exactly.
- Pure, Tauri-free modules the editor reuses (import from `../src`):
  - `domain/formModel.ts` — types `FormPack`, `PackSection`, `FieldGroup`, `FieldDefinition`, `ResolvedSection`.
  - `domain/packValidation.ts` — `validatePack(pack)` → `{ ok: boolean; errors: string[]; pack?: FormPack }`.
  - `domain/packMerge.ts` — `mergePackWithOverlay(pack, overlay?, values?)` → `{ resolved: { sections: ResolvedSection[] }, ... }`.
  - `domain/valuesStore.ts` — `createSectionValues(sectionKey)` → empty `SectionValues`.
  - `creator/packEdits.ts` — `updateField(pack, sectionKey, groupKey, systemKey, updater)`, `removeField(pack, sectionKey, groupKey, systemKey)`, `moveField(pack, sectionKey, groupKey, systemKey, "up"|"down")`, `addOptionalField(pack, sectionKey, groupKey)`, `updateGroup(pack, sectionKey, groupKey, updater)`. All immutable (return new `FormPack`).
  - `forms/FormRenderer.tsx` — `FormRenderer` props: `section: ResolvedSection`, `values: SectionValues`, `schemaVersion: number`, `onChange`, and editing props `editing?`, `packSection?: PackSection`, `onEditField?(sk,gk,updated: FieldDefinition)`, `onRemoveField?(sk,gk,systemKey)`, `onMoveField?(sk,gk,systemKey,dir)`, `onAddField?(sk,gk)`, `onEditGroupTitle?(sk,gk,title)`.
- Commands:
  - Frontend tests: `npm --prefix apps/desktop run test -- <substring>`
  - Typecheck (app): `npm --prefix apps/desktop run typecheck`
  - Typecheck (editor, added in Task 3): `npm --prefix apps/desktop run typecheck:pack-editor`
  - Run the editor (added in Task 3): `npm --prefix apps/desktop run pack-editor`

## File structure

- `apps/desktop/scripts/lib/derive-overlay.mjs` (+ `.d.mts`) — pure inverse of the generator. (Task 1)
- `apps/desktop/scripts/lib/save-artifacts.mjs` (+ `.d.mts`) — `renderSaveArtifacts(hint, editedPack)` → `{ overlayJson, packJson }`. (Task 2)
- `apps/desktop/src/domain/deriveOverlay.test.ts` — round-trip tests. (Task 1)
- `apps/desktop/src/domain/saveArtifacts.test.ts` — artifact tests. (Task 2)
- `apps/desktop/pack-editor/save-plugin.mjs` — Vite dev-server plugin (`GET/POST /__pack`). (Task 3)
- `apps/desktop/vite.pack-editor.config.ts` — Vite config rooted at `pack-editor/`. (Task 3)
- `apps/desktop/tsconfig.pack-editor.json` — editor typecheck config. (Task 3)
- `apps/desktop/pack-editor/index.html`, `main.tsx`, `api.ts` — app entry + fetch seam. (Task 4)
- `apps/desktop/pack-editor/PackEditorApp.tsx` — editor UI. (Tasks 4–5)
- `apps/desktop/pack-editor/PackEditorApp.test.tsx` — RTL smoke test. (Task 4)
- `apps/desktop/package.json`, root `package.json` — scripts. (Task 3)

---

## Task 1: `deriveOverlay` — the inverse of the generator

**Files:**
- Create: `apps/desktop/scripts/lib/derive-overlay.mjs`
- Create: `apps/desktop/scripts/lib/derive-overlay.d.mts`
- Test: `apps/desktop/src/domain/deriveOverlay.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/domain/deriveOverlay.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import hintPack from "../../src-tauri/resources/packs/default-pack.json";
import overlay from "../../scripts/credential-overlay.json";
import { buildCredentialPack } from "../../scripts/lib/credential-pack.mjs";
import { deriveOverlay } from "../../scripts/lib/derive-overlay.mjs";

// buildCredentialPack/deriveOverlay treat packs as opaque JSON; cast loosely.
const hint = hintPack as unknown as Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

describe("deriveOverlay", () => {
  it("round-trips the committed overlay (derive ∘ generate = identity)", () => {
    const pack = buildCredentialPack(hint, overlay);
    expect(deriveOverlay(hint, pack)).toEqual(overlay);
  });

  it("generate ∘ derive = identity for a helper-text reword", () => {
    const pack = buildCredentialPack(hint, overlay) as any;
    const pm = pack.sections.find((s: any) => s.sectionKey === "password-manager");
    const field = pm.groups
      .flatMap((g: any) => g.fields)
      .find((f: any) => f.systemKey === "passwordManagerRecoveryLocation");
    field.helperText = "Reworded for credential mode.";
    const derived = deriveOverlay(hint, pack);
    expect(derived.fieldOverrides.passwordManagerRecoveryLocation).toEqual({
      helperText: "Reworded for credential mode.",
    });
    expect(buildCredentialPack(hint, derived)).toEqual(pack);
  });

  it("generate ∘ derive = identity when shared fields are reordered", () => {
    const pack = buildCredentialPack(hint, overlay) as any;
    const devices = pack.sections.find((s: any) => s.sectionKey === "devices");
    const group = devices.groups.find((g: any) => g.groupKey === "device");
    // Swap the order values of deviceType (2) and deviceOwner (3).
    const type = group.fields.find((f: any) => f.systemKey === "deviceType");
    const owner = group.fields.find((f: any) => f.systemKey === "deviceOwner");
    [type.order, owner.order] = [owner.order, type.order];
    const derived = deriveOverlay(hint, pack);
    expect(buildCredentialPack(hint, derived)).toEqual(pack);
  });

  it("records added fields and kit additions", () => {
    const pack = buildCredentialPack(hint, overlay);
    const derived = deriveOverlay(hint, pack);
    const addedKeys = derived.addedFields.map((a) => a.field.systemKey);
    expect(addedKeys).toContain("passwordManagerMasterPassword");
    expect(addedKeys).toContain("devicePin");
    expect(derived.kitAdditions["password-manager"]).toContain(
      "passwordManagerMasterPassword",
    );
  });

  it("emits no overrides for an unedited pack (packId only + added fields)", () => {
    const pack = clone(buildCredentialPack(hint, overlay));
    const derived = deriveOverlay(hint, pack);
    expect(derived.fieldOverrides).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix apps/desktop run test -- deriveOverlay`
Expected: FAIL — `deriveOverlay` module does not exist.

- [ ] **Step 3: Implement `derive-overlay.mjs`**

Create `apps/desktop/scripts/lib/derive-overlay.mjs`:

```js
/**
 * Pure inverse of buildCredentialPack: hint pack + edited credential pack ->
 * overlay, such that buildCredentialPack(hint, deriveOverlay(hint, cred))
 * deep-equals cred. DEV/ADMIN TOOLING — not imported by the app runtime.
 *
 * The generator inserts added fields at order-0.5 and renumbers touched groups
 * to sequential integers, so a group's final positions are distinct integers.
 * This lets us reproduce ordering exactly:
 *   - added fields carry their final 1-based position;
 *   - shared fields get an explicit order override ONLY when the user reordered
 *     them relative to the hint sequence (a mechanical shift from insertion is
 *     reproduced by the generator with no override).
 */

const FIELD_PROPS = [
  "label",
  "helperText",
  "type",
  "required",
  "protected",
  "options",
  "visibleWhen",
];

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function indexHint(hintPack) {
  const bySection = new Map();
  for (const section of hintPack.sections) {
    const groups = new Map();
    for (const group of section.groups) {
      groups.set(group.groupKey, group);
    }
    bySection.set(section.sectionKey, { section, groups });
  }
  return bySection;
}

export function deriveOverlay(hintPack, credentialPack) {
  const hintIndex = indexHint(hintPack);
  const fieldOverrides = {};
  const addedFields = [];
  const kitAdditions = {};

  for (const credSection of credentialPack.sections) {
    const hintSection = hintIndex.get(credSection.sectionKey);

    for (const credGroup of credSection.groups) {
      const hintGroup = hintSection?.groups.get(credGroup.groupKey);
      const hintFieldByKey = new Map(
        (hintGroup?.fields ?? []).map((f) => [f.systemKey, f]),
      );

      const credSorted = [...credGroup.fields].sort((a, b) => a.order - b.order);
      const credShared = credSorted
        .filter((f) => hintFieldByKey.has(f.systemKey))
        .map((f) => f.systemKey);
      const hintShared = [...(hintGroup?.fields ?? [])]
        .sort((a, b) => a.order - b.order)
        .map((f) => f.systemKey);
      const reordered = JSON.stringify(credShared) !== JSON.stringify(hintShared);

      credSorted.forEach((field, index) => {
        const finalPosition = index + 1;
        const hintField = hintFieldByKey.get(field.systemKey);

        if (!hintField) {
          const { order: _order, ...rest } = field;
          addedFields.push({
            sectionKey: credSection.sectionKey,
            groupKey: credGroup.groupKey,
            order: finalPosition,
            field: rest,
          });
          return;
        }

        const override = {};
        for (const prop of FIELD_PROPS) {
          if (!deepEqual(hintField[prop], field[prop])) {
            override[prop] = field[prop];
          }
        }
        if (reordered) {
          override.order = finalPosition;
        }
        if (Object.keys(override).length > 0) {
          fieldOverrides[field.systemKey] = override;
        }
      });
    }

    const hintKit = new Set(
      (hintSection?.section.kitMapping?.entries ?? []).flatMap((e) => e.fields),
    );
    const added = (credSection.kitMapping?.entries ?? [])
      .flatMap((e) => e.fields)
      .filter((key) => !hintKit.has(key));
    if (added.length > 0) {
      kitAdditions[credSection.sectionKey] = added;
    }
  }

  return {
    packId: credentialPack.packId,
    fieldOverrides,
    addedFields,
    kitAdditions,
  };
}
```

Create `apps/desktop/scripts/lib/derive-overlay.d.mts`:

```ts
export function deriveOverlay(
  hintPack: unknown,
  credentialPack: unknown,
): {
  packId: string;
  fieldOverrides: Record<string, Record<string, unknown>>;
  addedFields: Array<{
    sectionKey: string;
    groupKey: string;
    order: number;
    field: Record<string, unknown>;
  }>;
  kitAdditions: Record<string, string[]>;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix apps/desktop run test -- deriveOverlay`
Expected: PASS (all 5).

Then run the app typecheck to confirm the `.d.mts` is picked up by the test's import:
Run: `npm --prefix apps/desktop run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/scripts/lib/derive-overlay.mjs apps/desktop/scripts/lib/derive-overlay.d.mts apps/desktop/src/domain/deriveOverlay.test.ts
git commit -m "feat(pack-tooling): derive overlay from an edited credential pack"
```

---

## Task 2: `renderSaveArtifacts` — overlay + pack text for a save

**Files:**
- Create: `apps/desktop/scripts/lib/save-artifacts.mjs`
- Create: `apps/desktop/scripts/lib/save-artifacts.d.mts`
- Test: `apps/desktop/src/domain/saveArtifacts.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/domain/saveArtifacts.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import hintPack from "../../src-tauri/resources/packs/default-pack.json";
import overlay from "../../scripts/credential-overlay.json";
import { buildCredentialPack } from "../../scripts/lib/credential-pack.mjs";
import { renderSaveArtifacts } from "../../scripts/lib/save-artifacts.mjs";

const hint = hintPack as unknown as Record<string, unknown>;

describe("renderSaveArtifacts", () => {
  it("reproduces the committed overlay and pack for an unedited pack", () => {
    const pack = buildCredentialPack(hint, overlay);
    const { overlayJson, packJson } = renderSaveArtifacts(hint, pack);

    const committedOverlay = readFileSync(
      resolve(process.cwd(), "scripts/credential-overlay.json"),
      "utf-8",
    );
    const committedPack = readFileSync(
      resolve(process.cwd(), "src-tauri/resources/packs/default-pack-credential.json"),
      "utf-8",
    );
    expect(overlayJson).toBe(committedOverlay);
    expect(packJson).toBe(committedPack);
  });

  it("ends both artifacts with a trailing newline", () => {
    const pack = buildCredentialPack(hint, overlay);
    const { overlayJson, packJson } = renderSaveArtifacts(hint, pack);
    expect(overlayJson.endsWith("\n")).toBe(true);
    expect(packJson.endsWith("\n")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix apps/desktop run test -- saveArtifacts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `save-artifacts.mjs`**

Create `apps/desktop/scripts/lib/save-artifacts.mjs`:

```js
/**
 * Pure: hint pack + edited credential pack -> the exact file contents to write
 * for a save (overlay JSON + regenerated pack JSON). DEV/ADMIN TOOLING.
 */
import { buildCredentialPack, serializePack } from "./credential-pack.mjs";
import { deriveOverlay } from "./derive-overlay.mjs";

export function renderSaveArtifacts(hintPack, editedPack) {
  const overlay = deriveOverlay(hintPack, editedPack);
  const overlayJson = `${JSON.stringify(overlay, null, 2)}\n`;
  const packJson = serializePack(buildCredentialPack(hintPack, overlay));
  return { overlayJson, packJson };
}
```

Create `apps/desktop/scripts/lib/save-artifacts.d.mts`:

```ts
export function renderSaveArtifacts(
  hintPack: unknown,
  editedPack: unknown,
): { overlayJson: string; packJson: string };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix apps/desktop run test -- saveArtifacts`
Expected: PASS (both). If `overlayJson` mismatches the committed overlay, the mismatch is a key-ordering difference in `deriveOverlay`'s output vs the hand-written overlay — align `deriveOverlay`'s object key order (`packId`, `fieldOverrides`, `addedFields`, `kitAdditions`; added-field object `sectionKey`, `groupKey`, `order`, `field`) to the committed file.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/scripts/lib/save-artifacts.mjs apps/desktop/scripts/lib/save-artifacts.d.mts apps/desktop/src/domain/saveArtifacts.test.ts
git commit -m "feat(pack-tooling): render overlay + pack artifacts for a save"
```

---

## Task 3: Vite save-plugin, config, tsconfig, and scripts

**Files:**
- Create: `apps/desktop/pack-editor/save-plugin.mjs`
- Create: `apps/desktop/vite.pack-editor.config.ts`
- Create: `apps/desktop/tsconfig.pack-editor.json`
- Modify: `apps/desktop/package.json`
- Modify: `package.json` (repo root)

This task has no unit test of its own (it is dev-server wiring exercised end-to-end in the final manual verification). The pure logic it calls (`renderSaveArtifacts`) is already tested in Task 2.

- [ ] **Step 1: Create the dev-server plugin**

Create `apps/desktop/pack-editor/save-plugin.mjs`:

```js
/**
 * Vite dev-server plugin backing the pack editor. Dev-only.
 *   GET  /__pack  -> { hintPack, overlay } read from disk
 *   POST /__pack  -> writes credential-overlay.json + regenerated pack;
 *                    body is the edited credential FormPack (JSON)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderSaveArtifacts } from "../scripts/lib/save-artifacts.mjs";

const resolvePath = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const HINT_PATH = resolvePath("../src-tauri/resources/packs/default-pack.json");
const OVERLAY_PATH = resolvePath("../scripts/credential-overlay.json");
const PACK_PATH = resolvePath(
  "../src-tauri/resources/packs/default-pack-credential.json",
);

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

export function packEditorSavePlugin() {
  return {
    name: "pack-editor-save",
    configureServer(server) {
      server.middlewares.use("/__pack", (req, res, next) => {
        if (req.method === "GET") {
          try {
            const hintPack = JSON.parse(readFileSync(HINT_PATH, "utf-8"));
            const overlay = JSON.parse(readFileSync(OVERLAY_PATH, "utf-8"));
            sendJson(res, 200, { hintPack, overlay });
          } catch (error) {
            sendJson(res, 500, { error: String(error?.message ?? error) });
          }
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => {
            body += chunk;
          });
          req.on("end", () => {
            try {
              const editedPack = JSON.parse(body);
              const hintPack = JSON.parse(readFileSync(HINT_PATH, "utf-8"));
              const { overlayJson, packJson } = renderSaveArtifacts(
                hintPack,
                editedPack,
              );
              writeFileSync(OVERLAY_PATH, overlayJson);
              writeFileSync(PACK_PATH, packJson);
              sendJson(res, 200, { ok: true });
            } catch (error) {
              sendJson(res, 400, { error: String(error?.message ?? error) });
            }
          });
          return;
        }
        next();
      });
    },
  };
}
```

- [ ] **Step 2: Create the Vite config**

Create `apps/desktop/vite.pack-editor.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { packEditorSavePlugin } from "./pack-editor/save-plugin.mjs";

// apps/desktop — lets the editor import ../src and ../scripts under root=pack-editor.
const appRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: "pack-editor",
  plugins: [react(), packEditorSavePlugin()],
  server: {
    port: 1430,
    strictPort: true,
    fs: { allow: [appRoot] },
  },
});
```

- [ ] **Step 3: Create the editor typecheck config**

Create `apps/desktop/tsconfig.pack-editor.json`:

```json
{
  "extends": "./tsconfig.json",
  "include": ["pack-editor"]
}
```

- [ ] **Step 4: Add the npm scripts**

In `apps/desktop/package.json`, add to `"scripts"` (after `"build:credential-pack"`):

```json
    "build:credential-pack": "node scripts/build-credential-pack.mjs",
    "pack-editor": "vite --config vite.pack-editor.config.ts",
    "typecheck:pack-editor": "tsc --noEmit -p tsconfig.pack-editor.json"
```

In the repo-root `package.json`, add to `"scripts"` (after the `build:credential-pack` proxy):

```json
    "build:credential-pack": "npm --prefix apps/desktop run build:credential-pack",
    "pack-editor": "npm --prefix apps/desktop run pack-editor"
```

- [ ] **Step 5: Verify the config loads (no test yet — the app has no index.html until Task 4)**

Run: `npm --prefix apps/desktop run typecheck`
Expected: no errors (the new `.mjs`/config are not part of the app tsconfig).

Confirm the eslint ignore still covers tooling — `apps/desktop/eslint.config.js` already ignores `scripts`; add `pack-editor` to the same ignore array so the editor sources are not linted by the app config in this task:

In `apps/desktop/eslint.config.js`, change:

```js
  { ignores: ["dist", "src-tauri/target", "scripts"] },
```

to:

```js
  { ignores: ["dist", "src-tauri/target", "scripts", "pack-editor"] },
```

Run: `npm --prefix apps/desktop run lint`
Expected: no new errors (pre-existing warnings unrelated to this change are acceptable).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/pack-editor/save-plugin.mjs apps/desktop/vite.pack-editor.config.ts apps/desktop/tsconfig.pack-editor.json apps/desktop/package.json apps/desktop/eslint.config.js package.json
git commit -m "build(pack-editor): dev-server plugin, vite config, and scripts"
```

---

## Task 4: Editor app shell — load, render, live preview

**Files:**
- Create: `apps/desktop/pack-editor/index.html`
- Create: `apps/desktop/pack-editor/main.tsx`
- Create: `apps/desktop/pack-editor/api.ts`
- Create: `apps/desktop/pack-editor/PackEditorApp.tsx`
- Test: `apps/desktop/pack-editor/PackEditorApp.test.tsx`

- [ ] **Step 1: Write the failing smoke test**

Create `apps/desktop/pack-editor/PackEditorApp.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import hintPack from "../src-tauri/resources/packs/default-pack.json";
import overlay from "../scripts/credential-overlay.json";
import * as api from "./api";
import { PackEditorApp } from "./PackEditorApp";

vi.mock("./api", () => ({ getPack: vi.fn(), savePack: vi.fn() }));
const mocked = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.getPack.mockResolvedValue({ hintPack, overlay });
});

describe("PackEditorApp", () => {
  it("loads the credential form and shows a credential-only field", async () => {
    render(<PackEditorApp />);
    // Navigate to the Password Manager section, then assert the secret field.
    await userEvent.click(
      await screen.findByRole("button", { name: /password manager/i }),
    );
    expect(await screen.findByText("Master password")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix apps/desktop run test -- PackEditorApp`
Expected: FAIL — `PackEditorApp`/`api` modules do not exist.

- [ ] **Step 3: Create the fetch seam**

Create `apps/desktop/pack-editor/api.ts`:

```ts
import type { FormPack } from "../src/domain/formModel";

export interface PackPayload {
  hintPack: FormPack;
  overlay: unknown;
}

export async function getPack(): Promise<PackPayload> {
  const res = await fetch("/__pack");
  if (!res.ok) {
    throw new Error(`Could not load the pack (${res.status}).`);
  }
  return res.json();
}

export async function savePack(editedPack: FormPack): Promise<void> {
  const res = await fetch("/__pack", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(editedPack),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Save failed (${res.status}).`);
  }
}
```

- [ ] **Step 4: Create the editor component (load + render + preview)**

Create `apps/desktop/pack-editor/PackEditorApp.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { buildCredentialPack } from "../scripts/lib/credential-pack.mjs";
import type { FormPack } from "../src/domain/formModel";
import { mergePackWithOverlay } from "../src/domain/packMerge";
import { createSectionValues } from "../src/domain/valuesStore";
import { FormRenderer } from "../src/forms/FormRenderer";
import { getPack } from "./api";

type Status = "loading" | "ready" | "error";

export function PackEditorApp() {
  const [status, setStatus] = useState<Status>("loading");
  const [hintPack, setHintPack] = useState<FormPack | null>(null);
  const [pack, setPack] = useState<FormPack | null>(null);
  const [activeSection, setActiveSection] = useState<string>("");
  const [loadError, setLoadError] = useState<string>("");

  useEffect(() => {
    let current = true;
    getPack()
      .then(({ hintPack: hint, overlay }) => {
        if (!current) return;
        const credential = buildCredentialPack(hint, overlay) as FormPack;
        setHintPack(hint);
        setPack(credential);
        setActiveSection(credential.sections[0]?.sectionKey ?? "");
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!current) return;
        setLoadError(error instanceof Error ? error.message : String(error));
        setStatus("error");
      });
    return () => {
      current = false;
    };
  }, []);

  const resolvedSections = useMemo(
    () => (pack ? mergePackWithOverlay(pack, null, {}).resolved.sections : []),
    [pack],
  );

  if (status === "loading") {
    return <main className="centered-screen">Loading the credential form…</main>;
  }
  if (status === "error" || !pack || !hintPack) {
    return (
      <main className="centered-screen">
        <p className="form-error" role="alert">
          {loadError || "The credential form could not be loaded."}
        </p>
      </main>
    );
  }

  const section = resolvedSections.find((s) => s.sectionKey === activeSection);
  const rawSection = pack.sections.find((s) => s.sectionKey === activeSection);

  return (
    <div className="pack-editor">
      <nav className="pack-editor__nav" aria-label="Sections">
        {pack.sections.map((s) => (
          <button
            key={s.sectionKey}
            type="button"
            aria-current={s.sectionKey === activeSection ? "page" : undefined}
            onClick={() => setActiveSection(s.sectionKey)}
          >
            {s.title}
          </button>
        ))}
      </nav>

      <main className="pack-editor__main">
        {section && rawSection ? (
          <section className="pack-editor__preview" aria-label="Preview">
            <h2>{section.title}</h2>
            <FormRenderer
              section={section}
              values={createSectionValues(section.sectionKey)}
              schemaVersion={pack.schemaVersion}
              onChange={() => {}}
            />
          </section>
        ) : null}
      </main>
    </div>
  );
}
```

Create `apps/desktop/pack-editor/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pack Editor — LifeScribe Vault</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

Create `apps/desktop/pack-editor/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { PackEditorApp } from "./PackEditorApp";
import "../src/styles/tokens.css";
import "../src/App.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <PackEditorApp />
  </React.StrictMode>,
);
```

- [ ] **Step 5: Run the test + editor typecheck**

Run: `npm --prefix apps/desktop run test -- PackEditorApp`
Expected: PASS.

Run: `npm --prefix apps/desktop run typecheck:pack-editor`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/pack-editor/index.html apps/desktop/pack-editor/main.tsx apps/desktop/pack-editor/api.ts apps/desktop/pack-editor/PackEditorApp.tsx apps/desktop/pack-editor/PackEditorApp.test.tsx
git commit -m "feat(pack-editor): app shell loads and previews the credential form"
```

---

## Task 5: Inline editing + save flow

**Files:**
- Modify: `apps/desktop/pack-editor/PackEditorApp.tsx`
- Test: `apps/desktop/pack-editor/PackEditorApp.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `apps/desktop/pack-editor/PackEditorApp.test.tsx` (inside the existing `describe`):

```tsx
  it("edits a field label and saves the edited pack", async () => {
    mocked.savePack.mockResolvedValue(undefined);
    render(<PackEditorApp />);

    await userEvent.click(
      await screen.findByRole("button", { name: /password manager/i }),
    );
    // Enter the label of the master-password field and change it.
    const labelInput = await screen.findByDisplayValue("Master password");
    await userEvent.clear(labelInput);
    await userEvent.type(labelInput, "Vault master password");

    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(mocked.savePack).toHaveBeenCalledTimes(1);
    const savedPack = mocked.savePack.mock.calls[0]![0];
    const pm = savedPack.sections.find((s) => s.sectionKey === "password-manager")!;
    const field = pm.groups
      .flatMap((g) => g.fields)
      .find((f) => f.systemKey === "passwordManagerMasterPassword")!;
    expect(field.label).toBe("Vault master password");
  });

  it("blocks save and shows an error when the pack is invalid", async () => {
    mocked.savePack.mockResolvedValue(undefined);
    render(<PackEditorApp />);
    await userEvent.click(
      await screen.findByRole("button", { name: /password manager/i }),
    );
    const labelInput = await screen.findByDisplayValue("Master password");
    await userEvent.clear(labelInput); // empty label -> validatePack fails
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(mocked.savePack).not.toHaveBeenCalled();
  });
```

(The editing surface renders `InlineFieldEditor` per field in `editing` mode. Its label control is a text `<input>` whose `value` is the field label, so `findByDisplayValue("Master password")` uniquely targets the master-password field's label input. Clearing it makes the label empty, which `validatePack` rejects — the source of the "blocks save" assertion.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix apps/desktop run test -- PackEditorApp`
Expected: FAIL — no editing controls / no Save button yet.

- [ ] **Step 3: Wire editing + save into `PackEditorApp.tsx`**

Add imports at the top of `apps/desktop/pack-editor/PackEditorApp.tsx`:

```tsx
import {
  addOptionalField,
  moveField,
  removeField,
  updateField,
  updateGroup,
} from "../src/creator/packEdits";
import { validatePack } from "../src/domain/packValidation";
import { savePack } from "./api";
```

Add save state next to the other `useState` calls:

```tsx
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string>("");
  const [saveError, setSaveError] = useState<string>("");
```

Add the save handler inside the component (before `return`):

```tsx
  async function handleSave() {
    if (!pack) return;
    const result = validatePack(pack);
    if (!result.ok) {
      setSaveError(`Cannot save: ${result.errors.join("; ")}`);
      setSaveMessage("");
      return;
    }
    setSaving(true);
    setSaveError("");
    setSaveMessage("");
    try {
      await savePack(pack);
      // Reload so the editor reflects the regenerated pack.
      const { hintPack: hint, overlay } = await getPack();
      setHintPack(hint);
      setPack(buildCredentialPack(hint, overlay) as FormPack);
      setSaveMessage("Saved.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }
```

Replace the `<section className="pack-editor__preview" ...>` block (from Task 4) with an editing surface, a preview, and a save bar:

```tsx
        {section && rawSection ? (
          <>
            <section className="pack-editor__edit" aria-label="Edit">
              <h2>{section.title}</h2>
              <FormRenderer
                section={section}
                values={createSectionValues(section.sectionKey)}
                schemaVersion={pack.schemaVersion}
                onChange={() => {}}
                editing
                packSection={rawSection}
                onEditField={(sk, gk, updated) =>
                  setPack((p) =>
                    p ? updateField(p, sk, gk, updated.systemKey, () => updated) : p,
                  )
                }
                onRemoveField={(sk, gk, key) =>
                  setPack((p) => (p ? removeField(p, sk, gk, key) : p))
                }
                onMoveField={(sk, gk, key, dir) =>
                  setPack((p) => (p ? moveField(p, sk, gk, key, dir) : p))
                }
                onAddField={(sk, gk) =>
                  setPack((p) => (p ? addOptionalField(p, sk, gk) : p))
                }
                onEditGroupTitle={(sk, gk, title) =>
                  setPack((p) =>
                    p ? updateGroup(p, sk, gk, (g) => ({ ...g, title })) : p,
                  )
                }
              />
            </section>

            <section className="pack-editor__preview" aria-label="Preview">
              <h2>Preview</h2>
              <FormRenderer
                section={section}
                values={createSectionValues(section.sectionKey)}
                schemaVersion={pack.schemaVersion}
                onChange={() => {}}
              />
            </section>
          </>
        ) : null}

        <div className="pack-editor__savebar">
          <button
            className="button button--primary"
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saveMessage ? <span>{saveMessage}</span> : null}
          {saveError ? (
            <span className="form-error" role="alert">
              {saveError}
            </span>
          ) : null}
        </div>
```

- [ ] **Step 4: Run tests + editor typecheck**

Run: `npm --prefix apps/desktop run test -- PackEditorApp`
Expected: PASS (all tests, including the two new ones).

Run: `npm --prefix apps/desktop run typecheck:pack-editor`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/pack-editor/PackEditorApp.tsx apps/desktop/pack-editor/PackEditorApp.test.tsx
git commit -m "feat(pack-editor): inline field editing with validated save"
```

---

## Final verification

- [ ] Run the full frontend suite: `npm --prefix apps/desktop run test`
- [ ] App typecheck: `npm --prefix apps/desktop run typecheck`
- [ ] Editor typecheck: `npm --prefix apps/desktop run typecheck:pack-editor`
- [ ] Lint: `npm --prefix apps/desktop run lint` (no new errors; `pack-editor`/`scripts` are ignored)
- [ ] Confirm the drift test still passes: `npm --prefix apps/desktop run test -- credentialPack`
- [ ] Manual smoke (`npm run pack-editor` from the repo root → open the printed localhost URL, e.g. `http://localhost:1430`):
  - The credential form loads; navigate to **Password Manager** and confirm the **Master password** field shows.
  - Reword a field's helper text; the preview updates.
  - Click **Save**. Confirm `git status` shows `credential-overlay.json` and `default-pack-credential.json` modified, and `git diff scripts/credential-overlay.json` shows exactly your reword as a `fieldOverrides` entry.
  - Run `npm --prefix apps/desktop run test -- 'credentialPack|deriveOverlay|saveArtifacts'` and confirm green (the saved artifacts round-trip and the drift guard holds).
  - Revert the manual edit if it was only a smoke test: `git checkout apps/desktop/scripts/credential-overlay.json apps/desktop/src-tauri/resources/packs/default-pack-credential.json`.

## Notes on laws honored

- **Dev-only, never shipped:** the editor is a separate Vite app + dev-server plugin; the Tauri end-user build uses the main app entry only.
- **Packs carry structure only:** the editor handles form definitions, never vault values or `custom.*` keys; no vault file or encryption path is touched.
- **Overlay stays the source of truth:** save derives the overlay and regenerates the pack via the existing generator; the drift-guard + round-trip tests keep them provably in sync.
- **Form definitions are data:** the editor manipulates the declarative `FormPack`; it introduces no expression strings or executable form logic.
- **Reuse over reinvention:** rendering, editing ops, merge, and validation all come from the existing `src` modules.
```
