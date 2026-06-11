/**
 * Default-pack loading seam (U5 interim).
 *
 * For now the bundled default pack is statically imported at build time —
 * U6 replaces the SOURCE with the Rust pack-resource read command (the
 * frontend has no fs scope) plus dev hot-reload, keeping this function
 * signature so callers don't change.
 *
 * Even the bundled pack is treated as UNTRUSTED INPUT and runs through
 * validatePack before anything renders.
 */

import defaultPackJson from "../../src-tauri/resources/packs/default-pack.json";
import type { FormPack } from "./formModel";
import { validatePack } from "./packValidation";

export function loadDefaultPack(): FormPack {
  const result = validatePack(defaultPackJson as unknown);
  if (!result.ok) {
    throw new Error(`The bundled default pack failed validation: ${result.errors.join("; ")}`);
  }
  return result.pack;
}
