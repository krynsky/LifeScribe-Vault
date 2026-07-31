/**
 * Default-pack loading seam (U6).
 *
 * There is a single bundled base pack, used exactly as authored — there is no
 * composition step. This loader resolves that pack; callers prefer the user's
 * own saved `customPack` when one exists (see `resolveBasePack` in
 * Dashboard.tsx).
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

export async function loadDefaultPack(): Promise<FormPack> {
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
