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

import defaultPackJson from "../../src-tauri/resources/packs/default-pack.json";
import { readDefaultPack } from "../api/vaultApi";
import type { FormPack } from "./formModel";
import { validatePack } from "./packValidation";

function validateCandidate(candidate: unknown): FormPack | null {
  const result = validatePack(candidate);
  return result.ok ? result.pack : null;
}

/** Validate the static build-time copy; throws when even that is broken. */
function loadStaticDefaultPack(): FormPack {
  const result = validatePack(defaultPackJson as unknown);
  if (!result.ok) {
    throw new Error(`The bundled default pack failed validation: ${result.errors.join("; ")}`);
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
      const pack = validateCandidate(JSON.parse(raw));
      if (pack) {
        return pack;
      }
    } catch {
      // Malformed resource JSON: fall through to the static copy.
    }
  }
  return loadStaticDefaultPack();
}
