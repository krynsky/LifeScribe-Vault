/**
 * Default-pack loading seam (U6).
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
