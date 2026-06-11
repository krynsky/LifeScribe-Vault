/**
 * Draft payload shape (U5 lock flow). Opaque JSON to Rust — encrypted by
 * the draft stash with AAD domain "draft" + the loaded snapshot generation.
 *
 *     {
 *       draftFormat: 1,
 *       savedAt: string,            // ISO timestamp the edits were set aside
 *       sections: [
 *         { sectionKey: string, values: SectionValues }
 *       ]
 *     }
 */

import type { DraftPayload } from "../api/vaultApi";
import type { SectionValues } from "./valuesStore";

export const DRAFT_FORMAT = 1;

export interface DraftSectionEntry {
  sectionKey: string;
  values: SectionValues;
}

export interface ParsedDraft {
  savedAt: string | null;
  sections: DraftSectionEntry[];
}

export function buildDraftPayload(
  sections: DraftSectionEntry[],
  savedAt: string,
): DraftPayload {
  return {
    draftFormat: DRAFT_FORMAT,
    savedAt,
    sections: sections.map((entry) => ({
      sectionKey: entry.sectionKey,
      values: entry.values,
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Tolerant parse of a decrypted draft; malformed entries are skipped. */
export function parseDraftPayload(draft: DraftPayload): ParsedDraft {
  const savedAt = typeof draft.savedAt === "string" ? draft.savedAt : null;
  const sections: DraftSectionEntry[] = [];
  if (Array.isArray(draft.sections)) {
    for (const entry of draft.sections) {
      if (!isRecord(entry) || typeof entry.sectionKey !== "string") {
        continue;
      }
      const valuesRaw = entry.values;
      if (!isRecord(valuesRaw)) {
        continue;
      }
      sections.push({
        sectionKey: entry.sectionKey,
        values: {
          sectionKey: entry.sectionKey,
          records: Array.isArray(valuesRaw.records)
            ? (valuesRaw.records as SectionValues["records"])
            : [],
          archivedAnswers: Array.isArray(valuesRaw.archivedAnswers)
            ? (valuesRaw.archivedAnswers as SectionValues["archivedAnswers"])
            : [],
        },
      });
    }
  }
  return { savedAt, sections };
}
