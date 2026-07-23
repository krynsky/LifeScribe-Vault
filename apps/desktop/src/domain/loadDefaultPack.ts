/**
 * Default-pack loading seam (U6).
 *
 * There is now a single bundled base ("hint") pack; per-module fields (e.g.
 * secrets, file-method) are declared on it as `FormModule`s and composed in
 * at load time via `composePack(base, base.modules, profile.moduleSelections)`
 * — see `resolveBasePack` in Dashboard.tsx. This loader only resolves the
 * base pack itself; it does not know about modules or selections.
 *
 * Primary source: the bundled Tauri resource, read through the Rust
 * `read_default_pack` command (the frontend has no fs scope; dev builds
 * read the source resources/ dir for hot-reload). Fallback: the build-time
 * static import — used when invoke is unavailable (component tests, plain
 * Vitest) or when the resource read/validation fails.
 *
 * BOTH paths are treated as UNTRUSTED INPUT and run through validatePack
 * before anything renders — never silent acceptance, never partial loads.
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

// `_mode` is retained (ignored) so existing call sites compile without
// churn; there is only one base pack now, composed with module selections
// by the caller.
export async function loadDefaultPack(mode: FormMode = "hint"): Promise<FormPack> {
  void mode; // vestigial: retained only so existing call sites compile.
  let raw: unknown;
  try {
    raw = await readDefaultPack();
  } catch {
    raw = null; // invoke unavailable (tests) or resource read failed.
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
