/**
 * Generic readiness model (U5).
 *
 * Laws (plan: Key Technical Decisions / readiness model):
 * - A section is READY when at least one record has every
 *   `readinessRule.requiredKeys` value non-empty, OR it is marked
 *   "doesn't apply to me" (N/A). Without N/A most real users could never
 *   reach 100% and the motivational loop dies.
 * - STALENESS: a ready section goes "stale-complete" when neither a save
 *   nor an explicit "mark reviewed" has happened within the review cadence
 *   (profile setting, default 12 months). Mark-reviewed and saves both
 *   reset the clock. Stale-complete still counts toward the readiness
 *   percentage — it is "done but worth a look", distinct from incomplete.
 * - Readiness is computed from SAVED data only; transient form edits never
 *   move a badge.
 */

import type { ResolvedSection } from "./formModel";
import type { SectionMeta, SectionMetaMap } from "./snapshot";
import type { SectionValues, VaultValues } from "./valuesStore";

export { DEFAULT_REVIEW_CADENCE_MONTHS } from "./snapshot";

export type SectionStatus = "incomplete" | "complete" | "stale-complete" | "na";

export interface ReadinessSummary {
  /** 0-100, sections counting as ready (complete, stale-complete, or N/A). */
  percent: number;
  readySections: number;
  totalSections: number;
  /** First section (pack order) still incomplete — the welcome CTA target. */
  firstIncomplete: ResolvedSection | null;
}

/** ≥1 record with every readiness-rule required key filled (trimmed). */
export function isSectionFilled(
  section: ResolvedSection,
  values: SectionValues | undefined,
): boolean {
  if (!values || values.records.length === 0) {
    return false;
  }
  const requiredKeys = section.readinessRule.requiredKeys;
  if (requiredKeys.length === 0) {
    // No gating keys authored: any record with any non-empty value counts.
    return values.records.some((record) =>
      Object.values(record.values).some((value) => value.trim().length > 0),
    );
  }
  return values.records.some((record) =>
    requiredKeys.every((key) => (record.values[key] ?? "").trim().length > 0),
  );
}

/** Pure month arithmetic; clamps overflowing days (Jan 31 + 1mo = Feb end). */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const daysInTarget = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, daysInTarget));
  return result;
}

function staleAnchor(meta: SectionMeta | undefined): Date | null {
  const candidates = [meta?.lastReviewedAt, meta?.lastSavedAt]
    .filter((value): value is string => typeof value === "string")
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));
  if (candidates.length === 0) {
    return null;
  }
  return candidates.reduce((latest, date) => (date > latest ? date : latest));
}

export function sectionStatus(
  section: ResolvedSection,
  values: SectionValues | undefined,
  meta: SectionMeta | undefined,
  reviewCadenceMonths: number,
  now: Date,
): SectionStatus {
  if (meta?.na) {
    return "na";
  }
  if (!isSectionFilled(section, values)) {
    return "incomplete";
  }
  const anchor = staleAnchor(meta);
  if (!anchor) {
    // Filled but with no recorded save/review time (e.g. imported data):
    // surface it as worth a review rather than silently fresh.
    return "stale-complete";
  }
  return addMonths(anchor, reviewCadenceMonths) <= now ? "stale-complete" : "complete";
}

export function isReadyStatus(status: SectionStatus): boolean {
  return status !== "incomplete";
}

export function readinessSummary(
  sections: readonly ResolvedSection[],
  values: VaultValues,
  sectionMeta: SectionMetaMap,
  reviewCadenceMonths: number,
  now: Date,
): ReadinessSummary {
  const ordered = [...sections].sort((left, right) => left.order - right.order);
  let readySections = 0;
  let firstIncomplete: ResolvedSection | null = null;
  for (const section of ordered) {
    const status = sectionStatus(
      section,
      values[section.sectionKey],
      sectionMeta[section.sectionKey],
      reviewCadenceMonths,
      now,
    );
    if (isReadyStatus(status)) {
      readySections += 1;
    } else if (!firstIncomplete) {
      firstIncomplete = section;
    }
  }
  const totalSections = ordered.length;
  return {
    percent: totalSections === 0 ? 0 : Math.round((readySections / totalSections) * 100),
    readySections,
    totalSections,
    firstIncomplete,
  };
}
