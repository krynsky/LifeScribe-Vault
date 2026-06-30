# Form Detail Modes (Hint vs Credential) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the vault owner choose between a "hint" form (locations only, current behavior) and a "credential" form (stores actual passwords/PINs), at onboarding and switchable afterward.

**Architecture:** Two bundled `FormPack` JSON files (hint + credential superset sharing all `systemKey`s and `schemaVersion`), selected by a new `profile.formMode` flag stored in the already-encrypted snapshot. The existing merge → migrate → reconcile pipeline handles data preservation on switch; credential-only values become archived answers when switching back to hint.

**Tech Stack:** TypeScript + React 19 (frontend), Rust + Tauri 2 (native), Vitest + RTL (frontend tests), `cargo test` (Rust tests).

**Spec:** `docs/superpowers/specs/2026-06-30-form-detail-modes-design.md`

---

## Background the engineer needs

- The snapshot is opaque JSON to Rust and is fully AEAD-encrypted before disk. The frontend gives it structure in `apps/desktop/src/domain/snapshot.ts`. **No new encryption is needed** — a credential typed into a field is encrypted exactly like any other value.
- The base form pack is resolved at load in `apps/desktop/src/routes/Dashboard.tsx`: today it is `customPack ?? loadDefaultPack()`. `customPack` is the user's inline-editor output stored in the snapshot; otherwise the bundled default pack is used.
- Values are keyed by `systemKey`. `mergePackWithOverlay` + `reconcileSectionValues` reconcile stored values against whatever pack is active; values with no matching field are retained as **archived answers** (never deleted). This is the mechanism that makes mode switching lossless.
- The Recovery Kit (`apps/desktop/src/domain/recoveryKit.ts`) is driven entirely by each section's `kitMapping`. Listing a `systemKey` in `kitMapping` is the only way a value reaches the Kit.
- Run all frontend tests with: `npm --prefix apps/desktop run test`
- Run a single frontend test file: `npm --prefix apps/desktop run test -- <substring>`
- Typecheck: `npm --prefix apps/desktop run typecheck`
- Rust tests: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`

## Final secret-field set (decided)

Two secret fields are added in credential mode (focused, YAGNI):
- Password Manager → `passwordManagerMasterPassword` (`text`)
- Devices → `devicePin` (`text`)

All existing hint fields (including the `*Location` fields) are **kept** in the credential pack — the credential pack is a strict superset.

## File Structure

- `apps/desktop/src/domain/snapshot.ts` — add `FormMode` type + `formMode` to `VaultProfile`; normalize/build/empty handle it. (Task 1)
- `apps/desktop/src/domain/snapshot.test.ts` — round-trip + default tests. (Task 1)
- `apps/desktop/src-tauri/resources/packs/default-pack-credential.json` — **new** credential pack. (Task 2)
- `apps/desktop/src/domain/credentialPack.test.ts` — **new** superset-invariant + validate tests. (Task 2)
- `apps/desktop/src-tauri/tauri.conf.json` — bundle the new resource. (Task 2)
- `apps/desktop/src-tauri/src/pack_resources.rs` — `read_default_pack` takes a `variant`. (Task 3)
- `apps/desktop/src-tauri/src/tests/` — Rust test for variant path resolution. (Task 3)
- `apps/desktop/src/api/vaultApi.ts` — `readDefaultPack(variant)`. (Task 3)
- `apps/desktop/src/domain/loadDefaultPack.ts` — `loadDefaultPack(mode)`. (Task 3)
- `apps/desktop/src/domain/loadDefaultPack.test.ts` — mode-selects-pack test. (Task 3)
- `apps/desktop/src/routes/SetupScreen.tsx` + `.test.tsx` — onboarding mode choice. (Task 4)
- `apps/desktop/src/App.tsx` — thread `formMode` from setup to Dashboard. (Task 4)
- `apps/desktop/src/routes/Dashboard.tsx` — `formModeHint` prop, `resolveBasePack`, `handleSwitchMode`, mode switch UI. (Tasks 5–6)
- `apps/desktop/src/routes/Dashboard.test.tsx` — load-by-mode, switch behavior, Kit inclusion. (Tasks 5–7)

---

## Task 1: Add `formMode` to the snapshot profile

**Files:**
- Modify: `apps/desktop/src/domain/snapshot.ts`
- Test: `apps/desktop/src/domain/snapshot.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `apps/desktop/src/domain/snapshot.test.ts` (place near the other `normalizeSnapshot` tests; add the import for `emptySnapshot`/`buildSnapshot` if not already imported):

```ts
import { buildSnapshot, emptySnapshot, normalizeSnapshot } from "./snapshot";

describe("formMode", () => {
  it("defaults to hint when absent from a snapshot", () => {
    const parsed = normalizeSnapshot({ profile: { ownerName: "A" } });
    expect(parsed.profile.formMode).toBe("hint");
  });

  it("reads an explicit credential formMode", () => {
    const parsed = normalizeSnapshot({
      profile: { ownerName: "A", formMode: "credential" },
    });
    expect(parsed.profile.formMode).toBe("credential");
  });

  it("ignores a malformed formMode and falls back to hint", () => {
    const parsed = normalizeSnapshot({
      profile: { ownerName: "A", formMode: "nonsense" },
    });
    expect(parsed.profile.formMode).toBe("hint");
  });

  it("round-trips formMode through build + normalize", () => {
    const built = buildSnapshot(emptySnapshot("A", "credential"));
    expect(normalizeSnapshot(built).profile.formMode).toBe("credential");
  });

  it("emptySnapshot defaults to hint", () => {
    expect(emptySnapshot("A").profile.formMode).toBe("hint");
  });

  it("uses the fallbackFormMode for a fresh (null) snapshot", () => {
    expect(normalizeSnapshot(null, "A", "credential").profile.formMode).toBe(
      "credential",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix apps/desktop run test -- snapshot`
Expected: FAIL — `formMode` does not exist on profile.

- [ ] **Step 3: Implement**

In `apps/desktop/src/domain/snapshot.ts`:

Add the type and extend `VaultProfile`:

```ts
export type FormMode = "hint" | "credential";

export interface VaultProfile {
  ownerName: string;
  reviewCadenceMonths: number;
  formMode: FormMode;
}
```

Add a coercion helper (place near `asString`):

```ts
function asFormMode(value: unknown, fallback: FormMode): FormMode {
  return value === "hint" || value === "credential" ? value : fallback;
}
```

Change `emptySnapshot` to accept and store the mode:

```ts
export function emptySnapshot(
  ownerName: string,
  formMode: FormMode = "hint",
): ParsedSnapshot {
  return {
    snapshotFormat: SNAPSHOT_FORMAT,
    schemaVersion: 0,
    profile: { ownerName, reviewCadenceMonths: DEFAULT_REVIEW_CADENCE_MONTHS, formMode },
    values: {},
    sectionMeta: {},
    overlay: null,
    kitMeta: null,
    extra: {},
  };
}
```

Change the `normalizeSnapshot` signature and its null branch and profile build. The current signature is `normalizeSnapshot(raw, fallbackOwnerName = "")`; make it:

```ts
export function normalizeSnapshot(
  raw: VaultSnapshot | null,
  fallbackOwnerName = "",
  fallbackFormMode: FormMode = "hint",
): ParsedSnapshot {
  if (!isRecord(raw)) {
    return emptySnapshot(fallbackOwnerName, fallbackFormMode);
  }
  // ...existing profileRaw / cadence logic unchanged...
```

In the returned `profile` object inside `normalizeSnapshot`, add `formMode`:

```ts
    profile: {
      ownerName: asString(profileRaw.ownerName, fallbackOwnerName),
      reviewCadenceMonths,
      formMode: asFormMode(profileRaw.formMode, fallbackFormMode),
    },
```

`buildSnapshot` already spreads `parsed.profile` (`profile: { ...parsed.profile }`), so `formMode` is re-emitted automatically — no change there.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix apps/desktop run test -- snapshot`
Expected: PASS.

Then run `npm --prefix apps/desktop run typecheck`. This will surface call sites that construct a `VaultProfile` without `formMode` (e.g. test fixtures). Fix each by adding `formMode: "hint"`. Search for them:

Run: `npm --prefix apps/desktop run typecheck 2>&1 | grep -i formMode`
Expected after fixes: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/domain/snapshot.ts apps/desktop/src/domain/snapshot.test.ts
git commit -m "feat(snapshot): add formMode to vault profile"
```

---

## Task 2: Create the credential pack file

**Files:**
- Create: `apps/desktop/src-tauri/resources/packs/default-pack-credential.json`
- Create: `apps/desktop/src/domain/credentialPack.test.ts`
- Modify: `apps/desktop/src-tauri/tauri.conf.json:31`

- [ ] **Step 1: Generate the credential pack from the hint pack**

Copy the hint pack as the starting point:

```bash
cp "apps/desktop/src-tauri/resources/packs/default-pack.json" \
   "apps/desktop/src-tauri/resources/packs/default-pack-credential.json"
```

- [ ] **Step 2: Apply the credential edits**

Edit `apps/desktop/src-tauri/resources/packs/default-pack-credential.json`:

1. Change `packId` (top of file) from `"lifescribe-default"` to `"lifescribe-default-credential"`. Leave `packVersion`, `schemaVersion`, and `minAppVersion` identical to the hint pack (lockstep invariant).

2. In the `password-manager` section's `plan` group, after the `passwordManagerExecutorInstructions` field (the last field, `order: 10`), add a new field:

```json
            ,{
              "systemKey": "passwordManagerMasterPassword",
              "label": "Master password",
              "helperText": "The actual master password for your password manager. It is stored encrypted in this vault.",
              "type": "text",
              "required": false,
              "protected": false,
              "order": 11
            }
```

3. In the same section's `kitMapping.entries[0].fields` array, append `"passwordManagerMasterPassword"` as the last entry.

4. In the `devices` section's `device` group, after the `deviceRecoveryNotes` field (`order: 5`), add:

```json
            ,{
              "systemKey": "devicePin",
              "label": "PIN or passcode",
              "helperText": "The actual unlock PIN or passcode for this device. It is stored encrypted in this vault.",
              "type": "text",
              "required": false,
              "protected": false,
              "order": 6
            }
```

5. In the `devices` section's `kitMapping`, append `"devicePin"` to that section's `entries[0].fields` array.

(Leave every existing field, including `passwordManagerRecoveryLocation` and `deviceUnlockHintLocation`, in place — the credential pack is a superset.)

- [ ] **Step 3: Write failing invariant tests**

Create `apps/desktop/src/domain/credentialPack.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import hintPack from "../../src-tauri/resources/packs/default-pack.json";
import credentialPack from "../../src-tauri/resources/packs/default-pack-credential.json";
import type { FormPack } from "./formModel";
import { validatePack } from "./packValidation";

function systemKeys(pack: FormPack): Set<string> {
  const keys = new Set<string>();
  for (const section of pack.sections) {
    for (const group of section.groups) {
      for (const field of group.fields) {
        keys.add(`${section.sectionKey}.${field.systemKey}`);
      }
    }
  }
  return keys;
}

describe("credential pack", () => {
  it("passes the same validation as the default pack", () => {
    expect(validatePack(credentialPack).ok).toBe(true);
  });

  it("is a superset of the hint pack (every hint key exists in credential)", () => {
    const hintKeys = systemKeys(hintPack as unknown as FormPack);
    const credKeys = systemKeys(credentialPack as unknown as FormPack);
    for (const key of hintKeys) {
      expect(credKeys.has(key)).toBe(true);
    }
  });

  it("shares schemaVersion with the hint pack (lockstep)", () => {
    expect((credentialPack as unknown as FormPack).schemaVersion).toBe(
      (hintPack as unknown as FormPack).schemaVersion,
    );
  });

  it("adds the secret fields", () => {
    const credKeys = systemKeys(credentialPack as unknown as FormPack);
    expect(credKeys.has("password-manager.passwordManagerMasterPassword")).toBe(true);
    expect(credKeys.has("devices.devicePin")).toBe(true);
  });

  it("includes the secret fields in the Recovery Kit mapping", () => {
    const pack = credentialPack as unknown as FormPack;
    const pm = pack.sections.find((s) => s.sectionKey === "password-manager");
    const devices = pack.sections.find((s) => s.sectionKey === "devices");
    const pmKitFields = pm!.kitMapping.entries.flatMap((e) => e.fields);
    const deviceKitFields = devices!.kitMapping.entries.flatMap((e) => e.fields);
    expect(pmKitFields).toContain("passwordManagerMasterPassword");
    expect(deviceKitFields).toContain("devicePin");
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npm --prefix apps/desktop run test -- credentialPack`
Expected: PASS. If the superset or schemaVersion test fails, fix the JSON (a missed field edit or a changed `schemaVersion`).

- [ ] **Step 5: Bundle the resource**

In `apps/desktop/src-tauri/tauri.conf.json`, change line 31 from:

```json
    "resources": ["resources/packs/default-pack.json"],
```

to:

```json
    "resources": ["resources/packs/default-pack.json", "resources/packs/default-pack-credential.json"],
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/resources/packs/default-pack-credential.json \
        apps/desktop/src/domain/credentialPack.test.ts \
        apps/desktop/src-tauri/tauri.conf.json
git commit -m "feat(packs): add credential-mode form pack (superset of hint pack)"
```

---

## Task 3: Variant-aware pack loading (Rust + TS)

**Files:**
- Modify: `apps/desktop/src-tauri/src/pack_resources.rs`
- Modify: `apps/desktop/src-tauri/src/tests/` (add a test module or extend an existing pack-resources test)
- Modify: `apps/desktop/src/api/vaultApi.ts:124`
- Modify: `apps/desktop/src/domain/loadDefaultPack.ts`
- Test: `apps/desktop/src/domain/loadDefaultPack.test.ts`

- [ ] **Step 1: Rust — add a credential resource constant and variant resolution**

In `apps/desktop/src-tauri/src/pack_resources.rs`, below `DEFAULT_PACK_RESOURCE`:

```rust
/// Resource-relative path of the credential-mode pack.
pub const CREDENTIAL_PACK_RESOURCE: &str = "resources/packs/default-pack-credential.json";

/// Map a wire variant string to its resource-relative path. Any unknown value
/// resolves to the hint pack — the safe default.
pub fn pack_resource_for_variant(variant: &str) -> &'static str {
    match variant {
        "credential" => CREDENTIAL_PACK_RESOURCE,
        _ => DEFAULT_PACK_RESOURCE,
    }
}
```

Change `default_pack_path` (both the `#[cfg(debug_assertions)]` and the `#[cfg(not(debug_assertions))]` variants) to take a resource path argument instead of hardcoding `DEFAULT_PACK_RESOURCE`:

```rust
#[cfg(debug_assertions)]
fn default_pack_path(_app: &tauri::AppHandle, resource: &str) -> VaultResult<PathBuf> {
    Ok(Path::new(env!("CARGO_MANIFEST_DIR")).join(resource))
}

#[cfg(not(debug_assertions))]
fn default_pack_path(app: &tauri::AppHandle, resource: &str) -> VaultResult<PathBuf> {
    use tauri::path::BaseDirectory;
    use tauri::Manager;

    app.path()
        .resolve(resource, BaseDirectory::Resource)
        .map_err(|error| VaultError::FileOperation(error.to_string()))
}
```

Change the command to accept a `variant`:

```rust
#[tauri::command]
pub fn read_default_pack(app: tauri::AppHandle, variant: String) -> Result<String, String> {
    let resource = pack_resource_for_variant(&variant);
    let pack_path = default_pack_path(&app, resource).map_err(command_error_code)?;
    read_pack_at_path(&pack_path).map_err(command_error_code)
}
```

- [ ] **Step 2: Rust — add a failing test for variant resolution**

Add to the Rust tests (e.g. a new `#[cfg(test)] mod` at the bottom of `pack_resources.rs`, or a file under `src/tests/`):

```rust
#[cfg(test)]
mod variant_tests {
    use super::{pack_resource_for_variant, CREDENTIAL_PACK_RESOURCE, DEFAULT_PACK_RESOURCE};

    #[test]
    fn credential_variant_maps_to_credential_resource() {
        assert_eq!(pack_resource_for_variant("credential"), CREDENTIAL_PACK_RESOURCE);
    }

    #[test]
    fn hint_and_unknown_variants_map_to_default_resource() {
        assert_eq!(pack_resource_for_variant("hint"), DEFAULT_PACK_RESOURCE);
        assert_eq!(pack_resource_for_variant("anything-else"), DEFAULT_PACK_RESOURCE);
    }
}
```

- [ ] **Step 3: Run Rust tests**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml pack_resource_for_variant`
Expected: PASS. Also run a full `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` to confirm the signature change didn't break callers (no production caller passes the old zero-arg form; Tauri injects the `variant` from the JS payload).

- [ ] **Step 4: TS — update the API wrapper**

In `apps/desktop/src/api/vaultApi.ts`, replace the existing `readDefaultPack`:

```ts
export function readDefaultPack(
  variant: "hint" | "credential" = "hint",
): Promise<string> {
  return invoke("read_default_pack", { variant });
}
```

- [ ] **Step 5: TS — write a failing loadDefaultPack test**

Create `apps/desktop/src/domain/loadDefaultPack.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/vaultApi", () => ({
  readDefaultPack: vi.fn().mockRejectedValue(new Error("invoke unavailable")),
}));

import { readDefaultPack } from "../api/vaultApi";
import { loadDefaultPack } from "./loadDefaultPack";

const mockedRead = vi.mocked(readDefaultPack);

describe("loadDefaultPack", () => {
  beforeEach(() => {
    mockedRead.mockClear();
    mockedRead.mockRejectedValue(new Error("invoke unavailable"));
  });

  it("requests the hint variant by default and returns the hint pack", async () => {
    const pack = await loadDefaultPack();
    expect(mockedRead).toHaveBeenCalledWith("hint");
    expect(pack.packId).toBe("lifescribe-default");
  });

  it("requests the credential variant and returns the credential pack", async () => {
    const pack = await loadDefaultPack("credential");
    expect(mockedRead).toHaveBeenCalledWith("credential");
    expect(pack.packId).toBe("lifescribe-default-credential");
  });
});
```

(Both assertions exercise the static-import fallback because the mock rejects — that fallback must pick the file by mode, which is what Step 6 implements.)

- [ ] **Step 6: TS — implement mode selection in loadDefaultPack**

Rewrite `apps/desktop/src/domain/loadDefaultPack.ts`:

```ts
import type { FormMode } from "./snapshot";
import hintPackJson from "../../src-tauri/resources/packs/default-pack.json";
import credentialPackJson from "../../src-tauri/resources/packs/default-pack-credential.json";
import { readDefaultPack } from "../api/vaultApi";
import type { FormPack } from "./formModel";
import { validatePack } from "./packValidation";

function staticPackFor(mode: FormMode): unknown {
  return mode === "credential" ? credentialPackJson : hintPackJson;
}

function validateCandidate(candidate: unknown): FormPack | null {
  const result = validatePack(candidate);
  return result.ok ? result.pack : null;
}

/** Validate the static build-time copy for the mode; throws when broken. */
function loadStaticDefaultPack(mode: FormMode): FormPack {
  const result = validatePack(staticPackFor(mode));
  if (!result.ok) {
    throw new Error(`The bundled ${mode} pack failed validation: ${result.errors.join("; ")}`);
  }
  return result.pack;
}

export async function loadDefaultPack(mode: FormMode = "hint"): Promise<FormPack> {
  let raw: unknown;
  try {
    raw = await readDefaultPack(mode);
  } catch {
    raw = null; // invoke unavailable (tests) or resource read failed.
  }
  if (typeof raw === "string") {
    try {
      const pack = validateCandidate(JSON.parse(raw));
      if (pack) {
        return pack;
      }
    } catch {
      // Malformed resource JSON: fall through to the static copy.
    }
  }
  return loadStaticDefaultPack(mode);
}
```

Note: importing the JSON requires `resolveJsonModule` (already enabled — the hint pack is imported the same way today).

- [ ] **Step 7: Run tests**

Run: `npm --prefix apps/desktop run test -- loadDefaultPack`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src-tauri/src/pack_resources.rs apps/desktop/src/api/vaultApi.ts \
        apps/desktop/src/domain/loadDefaultPack.ts apps/desktop/src/domain/loadDefaultPack.test.ts
git commit -m "feat(packs): load pack by form-mode variant"
```

---

## Task 4: Onboarding mode choice

**Files:**
- Modify: `apps/desktop/src/routes/SetupScreen.tsx`
- Modify: `apps/desktop/src/routes/SetupScreen.test.tsx`
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Write a failing SetupScreen test**

Add to `apps/desktop/src/routes/SetupScreen.test.tsx` (follow the existing render/submit pattern in that file; the helper below fills the required fields — match the existing tests' field labels if they differ):

```ts
it("passes the chosen form mode to onCreate (defaults to hint)", async () => {
  const onCreate = vi.fn().mockResolvedValue(undefined);
  render(<SetupScreen onCreate={onCreate} />);

  await userEvent.type(screen.getByLabelText(/your name/i), "Mark");
  const password = "correct horse battery staple";
  // There are two password inputs (password + confirm); fill both.
  const pwInputs = screen.getAllByLabelText(/master password/i);
  await userEvent.type(pwInputs[0], password);
  await userEvent.type(pwInputs[1], password);
  await userEvent.click(screen.getByLabelText(/cannot be reset/i));

  // Select credential mode.
  await userEvent.click(screen.getByLabelText(/store the actual secrets/i));
  await userEvent.click(screen.getByRole("button", { name: /create/i }));

  expect(onCreate).toHaveBeenCalledWith(password, "Mark", "credential");
});
```

(If the existing tests already assert `onCreate(masterPassword, ownerName)` with two args, update those assertions to expect the third arg `"hint"`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix apps/desktop run test -- SetupScreen`
Expected: FAIL — `onCreate` called with 2 args / no mode radio present.

- [ ] **Step 3: Implement the mode choice**

In `apps/desktop/src/routes/SetupScreen.tsx`:

Update the prop type and import the `FormMode` type:

```ts
import type { FormMode } from "../domain/snapshot";

export interface SetupScreenProps {
  onCreate: (masterPassword: string, ownerName: string, formMode: FormMode) => Promise<void>;
}
```

Add state (next to the other `useState` calls):

```ts
  const [formMode, setFormMode] = useState<FormMode>("hint");
```

Pass it through in `handleSubmit` where `onCreate` is called:

```ts
      await onCreate(masterPassword, ownerName.trim(), formMode);
```

Add the radio group to the form JSX (place it above the submit button):

```tsx
      <fieldset className="setup-mode">
        <legend>What should this vault store?</legend>
        <label className="setup-mode__option">
          <input
            type="radio"
            name="formMode"
            value="hint"
            checked={formMode === "hint"}
            onChange={() => setFormMode("hint")}
          />
          <span className="setup-mode__title">Store locations only (safer)</span>
          <span className="setup-mode__desc">
            Records where to find passwords and PINs, never the secrets themselves.
          </span>
        </label>
        <label className="setup-mode__option">
          <input
            type="radio"
            name="formMode"
            value="credential"
            checked={formMode === "credential"}
            onChange={() => setFormMode("credential")}
          />
          <span className="setup-mode__title">Store the actual secrets</span>
          <span className="setup-mode__desc">
            Keeps real passwords, PINs, and codes inside this encrypted vault.
          </span>
        </label>
      </fieldset>
```

- [ ] **Step 4: Thread the mode through App**

In `apps/desktop/src/App.tsx`:

Add a state hint next to `ownerNameHint`:

```ts
  const [formModeHint, setFormModeHint] = useState<FormMode>("hint");
```

Import the type:

```ts
import type { FormMode } from "./domain/snapshot";
```

Update `handleCreate`:

```ts
  async function handleCreate(masterPassword: string, ownerName: string, formMode: FormMode) {
    const status = await createVault(masterPassword, ownerName);
    setOwnerNameHint(ownerName);
    setFormModeHint(formMode);
    setScreen(screenFromStatus(status));
  }
```

Pass the hint to the Dashboard render:

```tsx
  return (
    <Dashboard
      ownerNameHint={ownerNameHint}
      formModeHint={formModeHint}
      onLocked={() => setScreen("locked")}
    />
  );
```

- [ ] **Step 5: Add the `formModeHint` prop to Dashboard so the tree typechecks**

So this task stands on its own, add the prop to `apps/desktop/src/routes/Dashboard.tsx` now (it is consumed in Task 5). Import the type and extend the props:

```ts
import type { FormMode } from "../domain/snapshot";
```

```ts
interface DashboardProps {
  ownerNameHint?: string;
  formModeHint?: FormMode;
  onLocked: () => void;
}

export function Dashboard({ ownerNameHint = "", formModeHint = "hint", onLocked }: DashboardProps) {
```

`formModeHint` is unused until Task 5 — that is fine; it is an optional prop with a default. If the project's lint fails the build on an unused binding, add `void formModeHint;` as the first line of the component body and remove it in Task 5; otherwise leave it.

- [ ] **Step 6: Run tests + typecheck**

Run: `npm --prefix apps/desktop run test -- SetupScreen`
Expected: PASS.

Run: `npm --prefix apps/desktop run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/routes/SetupScreen.tsx apps/desktop/src/routes/SetupScreen.test.tsx \
        apps/desktop/src/App.tsx apps/desktop/src/routes/Dashboard.tsx
git commit -m "feat(onboarding): choose hint or credential form mode at setup"
```

---

## Task 5: Resolve the base pack by mode on load

**Files:**
- Modify: `apps/desktop/src/routes/Dashboard.tsx`
- Test: `apps/desktop/src/routes/Dashboard.test.tsx`

- [ ] **Step 1: Confirm the `formModeHint` prop exists**

Task 4 already added `formModeHint?: FormMode` to `DashboardProps` and the component signature, and imported `FormMode`. Verify it is present:

```ts
interface DashboardProps {
  ownerNameHint?: string;
  formModeHint?: FormMode;
  onLocked: () => void;
}

export function Dashboard({ ownerNameHint = "", formModeHint = "hint", onLocked }: DashboardProps) {
```

If Task 4 was not yet applied, add it now (import `FormMode` from `../domain/snapshot`). This task consumes the prop in `resolveBasePack` (Step 4).

- [ ] **Step 2: Write a failing load-by-mode test**

In `apps/desktop/src/routes/Dashboard.test.tsx`, add a test. The existing suite mocks `vaultApi`; `readDefaultPack` is mocked to reject so the static fallback runs (see the file header comment). A snapshot whose `profile.formMode === "credential"` must cause the credential pack to load — assert by finding a credential-only field label.

```ts
it("loads the credential pack when the snapshot profile is in credential mode", async () => {
  mocked.loadVaultSnapshot.mockResolvedValue({
    snapshot: {
      snapshotFormat: 1,
      schemaVersion: 1,
      profile: { ownerName: "Mark", reviewCadenceMonths: 12, formMode: "credential" },
      values: {},
      sectionMeta: {},
    },
    generation: 1,
    recovered: false,
  });

  render(<Dashboard ownerNameHint="Mark" onLocked={() => {}} />);

  // Navigate into Password Manager Plan and assert the credential-only field shows.
  await userEvent.click(await screen.findByRole("button", { name: /password manager plan/i }));
  expect(await screen.findByText(/master password/i)).toBeInTheDocument();
});
```

(Adjust the navigation to match how the suite opens a section — copy the pattern from an existing section-opening test in the same file.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --prefix apps/desktop run test -- Dashboard`
Expected: FAIL — hint pack still loads; "Master password" field absent.

- [ ] **Step 4: Implement `resolveBasePack` and use it at all load sites**

In `apps/desktop/src/routes/Dashboard.tsx`, add a helper inside the component (it needs `ownerNameHint`/`formModeHint`), placed near the load effect:

```ts
  async function resolveBasePack(raw: VaultSnapshot | null): Promise<FormPack> {
    const parsed = normalizeSnapshot(raw, ownerNameHint, formModeHint);
    return parsed.customPack ?? (await loadDefaultPack(parsed.profile.formMode));
  }
```

`VaultSnapshot` is already imported from `../api/vaultApi` (used by `assembleSnapshot`); if not, add it.

Replace the three load sites:

1. Main load (around line 239–245). Replace:

```ts
      const parsedForPack = normalizeSnapshot(raw, ownerNameHint);
      let pack: FormPack;
      if (parsedForPack.customPack) {
        pack = parsedForPack.customPack;
      } else {
        try {
          pack = await loadDefaultPack();
        } catch {
          if (isCurrent) setPhase("error");
          return;
        }
      }
```

with:

```ts
      let pack: FormPack;
      try {
        pack = await resolveBasePack(raw);
      } catch {
        if (isCurrent) setPhase("error");
        return;
      }
```

2. `handleSaveAgain` (line ~523): replace `const pack = await loadDefaultPack();` with `const pack = await resolveBasePack(response.snapshot);`.

3. `handleDiscardConflict` (line ~564): replace `const pack = await loadDefaultPack();` with `const pack = await resolveBasePack(response.snapshot);`.

In both 2 and 3, the subsequent `buildLoadedVault(pack, response.snapshot, ...)` call passes `ownerNameHint` already — keep that. Optionally pass `formModeHint` through to `buildLoadedVault`'s `normalizeSnapshot` too; but since those paths reload an *existing* snapshot (which carries its own `formMode`), the hint is irrelevant there. Leave `buildLoadedVault` as-is.

- [ ] **Step 5: Run tests + typecheck**

Run: `npm --prefix apps/desktop run test -- Dashboard`
Expected: PASS.

Run: `npm --prefix apps/desktop run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/routes/Dashboard.tsx apps/desktop/src/routes/Dashboard.test.tsx
git commit -m "feat(dashboard): resolve base pack by form mode on load"
```

---

## Task 6: Switch modes after install

**Files:**
- Modify: `apps/desktop/src/routes/Dashboard.tsx`
- Test: `apps/desktop/src/routes/Dashboard.test.tsx`

- [ ] **Step 1: Write a failing switch test**

In `apps/desktop/src/routes/Dashboard.test.tsx`, add tests asserting (a) switching to credential persists `profile.formMode: "credential"` via `saveVaultSnapshot`, and (b) a pre-existing `customPack` is dropped on switch. The suite mocks `saveVaultSnapshot`; inspect its call argument.

```ts
it("switching to credential mode saves formMode and clears customPack", async () => {
  mocked.loadVaultSnapshot.mockResolvedValue({
    snapshot: {
      snapshotFormat: 1,
      schemaVersion: 1,
      profile: { ownerName: "Mark", reviewCadenceMonths: 12, formMode: "hint" },
      values: { "password-manager": { records: [{ id: "r1", schemaVersion: 1, values: { passwordManagerProvider: "1Password" } }] } },
      sectionMeta: {},
      customPack: { /* any object is fine; assert it is gone after switch */ packId: "edited", packVersion: "1.0.0", schemaVersion: 1, minAppVersion: "0.2.0", sections: [], migrations: [] },
    },
    generation: 3,
    recovered: false,
  });
  mocked.saveVaultSnapshot.mockResolvedValue({ generation: 4 });

  render(<Dashboard ownerNameHint="Mark" onLocked={() => {}} />);

  // Open the mode switch and choose credential, then confirm.
  await userEvent.click(await screen.findByRole("button", { name: /store actual secrets|switch to credential|form detail/i }));
  await userEvent.click(await screen.findByRole("button", { name: /confirm/i }));

  const savedSnapshot = mocked.saveVaultSnapshot.mock.calls.at(-1)![0] as Record<string, unknown>;
  const profile = savedSnapshot.profile as Record<string, unknown>;
  expect(profile.formMode).toBe("credential");
  expect(savedSnapshot.customPack).toBeUndefined();
  // Entered value is preserved through the switch.
  const values = savedSnapshot.values as Record<string, { records: Array<{ values: Record<string, string> }> }>;
  expect(values["password-manager"].records[0].values.passwordManagerProvider).toBe("1Password");
});
```

(Adjust button names to the UI you build in Step 2. Keep the confirm-dialog flow.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix apps/desktop run test -- Dashboard`
Expected: FAIL — no switch control / `handleSwitchMode` undefined.

- [ ] **Step 3: Implement `handleSwitchMode` + UI**

In `apps/desktop/src/routes/Dashboard.tsx`, add state for the pending switch confirmation (near the other `useState`s):

```ts
  const [pendingModeSwitch, setPendingModeSwitch] = useState<FormMode | null>(null);
```

Add the handler (near `handleSavePack`):

```ts
  async function handleSwitchMode(newMode: FormMode) {
    if (!loaded || loaded.vault.profile.formMode === newMode) {
      setPendingModeSwitch(null);
      return;
    }
    const nextBase: LoadedVault = {
      ...loaded,
      vault: {
        ...loaded.vault,
        profile: { ...loaded.vault.profile, formMode: newMode },
        customPack: null,
      },
    };
    const ok = await persist(
      nextBase,
      loaded.vault.savedValues,
      loaded.vault.sectionMeta,
      null,
    );
    setPendingModeSwitch(null);
    if (ok) {
      setPhase("loading");
      setLoadKey((k) => k + 1);
    }
  }
```

`persist` builds the snapshot from `nextBase` via `assembleSnapshot`, which reads `current.vault.profile` and `current.vault.customPack ?? undefined` — so the new `formMode` is written and the cleared `customPack` is omitted. Reloading then re-resolves the base pack for the new mode (Task 5), and `reconcileSectionValues` archives any credential-only values when switching back to hint.

Add the UI in the sidebar footer, next to the Form Editor toggle (around line 919–930). Insert a "Form detail" control and a confirm dialog driven by `pendingModeSwitch`:

```tsx
        <div className="sidebar__mode">
          <span className="sidebar__mode-label">Form detail</span>
          <span className="sidebar__mode-current">
            {loaded.vault.profile.formMode === "credential" ? "Stores secrets" : "Locations only"}
          </span>
          <button
            className="button button--secondary button--small"
            type="button"
            onClick={() =>
              setPendingModeSwitch(
                loaded.vault.profile.formMode === "credential" ? "hint" : "credential",
              )
            }
          >
            {loaded.vault.profile.formMode === "credential"
              ? "Switch to locations only"
              : "Switch to store actual secrets"}
          </button>
        </div>
```

And the confirm dialog (place in the main render, e.g. alongside the other banners/dialogs):

```tsx
      {pendingModeSwitch ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Confirm form detail change">
          <div className="modal__body">
            <p>
              {pendingModeSwitch === "credential"
                ? "Switch to storing actual passwords and PINs in this vault?"
                : "Switch back to storing locations only?"}
            </p>
            {loaded.vault.customPack ? (
              <p className="modal__warning">
                Your custom form edits will be replaced by the standard form. Your entered data is kept.
              </p>
            ) : null}
            <div className="modal__actions">
              <button
                className="button button--primary"
                type="button"
                onClick={() => void handleSwitchMode(pendingModeSwitch)}
              >
                Confirm
              </button>
              <button
                className="button button--ghost"
                type="button"
                onClick={() => setPendingModeSwitch(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm --prefix apps/desktop run test -- Dashboard`
Expected: PASS.

Run: `npm --prefix apps/desktop run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/routes/Dashboard.tsx apps/desktop/src/routes/Dashboard.test.tsx
git commit -m "feat(dashboard): switch form detail mode after install"
```

---

## Task 7: Recovery Kit includes secrets in credential mode (verification)

**Files:**
- Test: `apps/desktop/src/domain/recoveryKit.test.ts`

This task adds no production code — the Recovery Kit is data-driven by `kitMapping`, which Task 2 already extended. The test locks the behavior in.

- [ ] **Step 1: Write the test**

Add to `apps/desktop/src/domain/recoveryKit.test.ts` (reuse the file's existing helpers for building a resolved definition from a pack + values; mirror an existing test's setup). The intent: with the credential pack and a stored `passwordManagerMasterPassword`, that value appears in the built Kit; with the hint pack it cannot (the field does not exist there).

```ts
it("includes the master password in the Recovery Kit under credential mode", () => {
  // Build the resolved definition from the credential pack (mirror existing setup
  // in this file — mergePackWithOverlay(credentialPack, null, values)).
  const values = {
    "password-manager": {
      records: [
        { id: "r1", schemaVersion: 1, values: { passwordManagerProvider: "1Password", passwordManagerMasterPassword: "hunter2-correct-horse" } },
      ],
    },
  };
  const kit = buildRecoveryKit(resolvedCredentialSections, values, "Mark");
  const allItems = kit.entries.flatMap((e) => e.items.map((i) => i.value));
  expect(allItems).toContain("hunter2-correct-horse");
});
```

(Use the actual `buildRecoveryKit` signature and resolved-section construction already present in the test file. The key assertion is that the master-password value reaches the Kit.)

- [ ] **Step 2: Run the test**

Run: `npm --prefix apps/desktop run test -- recoveryKit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/domain/recoveryKit.test.ts
git commit -m "test(recovery-kit): assert credential-mode secrets reach the kit"
```

---

## Final verification

- [ ] Run the full frontend suite: `npm --prefix apps/desktop run test`
- [ ] Run typecheck: `npm --prefix apps/desktop run typecheck`
- [ ] Run lint: `npm --prefix apps/desktop run lint`
- [ ] Run Rust tests: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- [ ] Manual smoke (`npm run dev`): create a vault choosing credential mode → confirm the Master password and PIN fields appear → enter values → generate the Recovery Kit and confirm the secrets show → switch to locations-only and confirm a warning, that the secrets vanish from the form, and that the Kit no longer lists them → switch back and confirm the secret values are still present (archived answers restored).

## Notes on laws honored

- **No new plaintext path:** secrets live only inside the existing encrypted snapshot; the Recovery Kit already exists and is unchanged in mechanism.
- **Never silently drop field data:** switching to hint archives credential-only values via `reconcileSectionValues`.
- **Form definitions are data:** both modes are plain JSON packs validated by the same gate.
- **Packs carry structure only:** the credential pack adds fields/labels, never values.
- **Protected system keys stable:** no protected field is renamed or retyped; only additive fields and reworded helper text.
