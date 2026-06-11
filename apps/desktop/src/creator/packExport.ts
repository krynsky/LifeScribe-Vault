/**
 * Creator-mode pack export (U10).
 *
 * Runs the full creator validation pipeline and serializes the exported pack:
 * 1. Structural validation (validatePack).
 * 2. Creator-specific rules: no custom.* keys, no overlay content.
 * 3. Upgrade validation in strict mode — warnings (lossy changes without
 *    authored migrations) are promoted to errors.
 * 4. On success: bumps the minor packVersion and returns the JSON string.
 *
 * The serialized output has no value slots by construction — FormPack carries
 * only structure. Asserted by the packExport.test.ts "no values" test.
 */

import { isCustomFieldKey, type FormPack } from "../domain/formModel";
import { validatePack, validatePackUpgrade } from "../domain/packValidation";

export interface ExportResult {
  ok: boolean;
  /** Populated only when ok is true. */
  json: string;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Version bump: minor component +1, patch reset to 0.
// ---------------------------------------------------------------------------

export function bumpPackVersion(version: string): string {
  const parts = version.split(".");
  if (parts.length !== 3) {
    return version;
  }
  const minor = parseInt(parts[1] ?? "0", 10);
  return `${parts[0]}.${isNaN(minor) ? 0 : minor + 1}.0`;
}

// ---------------------------------------------------------------------------
// Creator-specific validation (on top of structural validatePack)
// ---------------------------------------------------------------------------

function creatorOnlyErrors(pack: FormPack): string[] {
  const errors: string[] = [];
  for (const section of pack.sections) {
    for (const group of section.groups) {
      for (const field of group.fields) {
        if (isCustomFieldKey(field.systemKey)) {
          errors.push(
            `Field "${field.systemKey}" uses the custom.* namespace. Default packs may not contain custom-namespace fields — those belong in user overlays.`,
          );
        }
      }
    }
    // readinessRule and kitMapping references are checked by validatePack, not here.
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate the working pack against the previous pack and return an
 * export-ready JSON string on success, or a list of errors on failure.
 *
 * @param workingPack  The pack currently being edited.
 * @param previousPack The pack the working copy was forked from (for upgrade
 *                     validation). Pass the same value as workingPack for a
 *                     first-time export (no upgrade rules apply).
 */
export function exportPack(workingPack: FormPack, previousPack: FormPack): ExportResult {
  // 1. Structural validation — same rules the loader applies.
  const structural = validatePack(workingPack);
  if (!structural.ok) {
    return { ok: false, json: "", errors: structural.errors };
  }

  // 2. Creator-only rules.
  const creatorErrors = creatorOnlyErrors(workingPack);
  if (creatorErrors.length > 0) {
    return { ok: false, json: "", errors: creatorErrors };
  }

  // 3. Upgrade validation in strict mode: warnings become errors so the
  //    creator is forced to author migrations for all lossy changes.
  const upgrade = validatePackUpgrade(previousPack, workingPack, { strict: true });
  if (upgrade.errors.length > 0) {
    return { ok: false, json: "", errors: upgrade.errors };
  }

  // 4. Bump version and serialize.
  const exported: FormPack = {
    ...workingPack,
    packVersion: bumpPackVersion(workingPack.packVersion),
  };

  return {
    ok: true,
    json: JSON.stringify(exported, null, 2),
    errors: [],
  };
}
