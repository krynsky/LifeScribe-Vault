/**
 * Generic readiness model (U5; revised to a user-driven "mark complete" model
 * — see docs/development.md "Section completeness is a user decision").
 *
 * Laws:
 * - Completeness is a DECISION, not a field count. A section is READY when
 *   the user has explicitly marked it complete (and it still has at least
 *   one non-empty value — see below), or marked it "doesn't apply to me"
 *   (N/A). It is never inferred from which fields happen to be filled: every
 *   section is structured differently, and "how much is enough" is arbitrary
 *   and different for every user. A single filled-in record is STARTED, not
 *   complete, however many fields it has.
 * - A section that loses all its data (every record deleted, or every value
 *   cleared) cannot remain "complete" — the flag is ignored, not just hidden,
 *   the moment there is nothing left to be complete about. Re-adding data
 *   later starts over at "started"; completeness is never silently restored
 *   from a stale flag.
 * - Without N/A, most real users could never reach 100% and the motivational
 *   loop dies — N/A remains the escape hatch for "this genuinely does not
 *   apply to me."
 * - STALENESS: a completed section goes "stale-complete" when neither a save
 *   nor an explicit "mark reviewed" has happened within the review cadence
 *   (profile setting, default 12 months). Mark-reviewed and saves both
 *   reset the clock. Stale-complete still counts toward the readiness
 *   percentage — it is "done but worth a look", distinct from not ready.
 * - Readiness is computed from SAVED data only; transient form edits never
 *   move a badge.
 */

import type { ResolvedSection } from "./formModel";
import type { SectionMeta, SectionMetaMap } from "./snapshot";
import type { SectionValues, VaultValues } from "./valuesStore";

export { DEFAULT_REVIEW_CADENCE_MONTHS } from "./snapshot";

export type SectionStatus = "not-started" | "started" | "complete" | "stale-complete" | "na";

export interface ReadinessSummary {
  /** 0-100, sections counting as ready (complete, stale-complete, or N/A). */
  percent: number;
  readySections: number;
  totalSections: number;
  /** First section (pack order) not ready — the welcome CTA target. */
  firstIncomplete: ResolvedSection | null;
}

/**
 * ≥1 saved record with at least one non-empty value, in ANY field. This is
 * the sole gate for "started" and the sole thing that can revoke a stale
 * `completed` flag — it deliberately knows nothing about which fields the
 * pack considers important, because completeness itself no longer does.
 */
export function sectionHasAnyValue(values: SectionValues | undefined): boolean {
  if (!values || values.records.length === 0) {
    return false;
  }
  return values.records.some((record) =>
    Object.values(record.values).some((value) => value.trim().length > 0),
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
  values: SectionValues | undefined,
  meta: SectionMeta | undefined,
  reviewCadenceMonths: number,
  now: Date,
): SectionStatus {
  if (meta?.na) {
    return "na";
  }
  const hasContent = sectionHasAnyValue(values);
  if (!meta?.completed || !hasContent) {
    // Not marked complete, OR marked complete but nothing is left to be
    // complete about — a stale flag is worth exactly nothing here.
    return hasContent ? "started" : "not-started";
  }
  const anchor = staleAnchor(meta);
  if (!anchor) {
    // Completed but with no recorded save/review time (e.g. imported data):
    // surface it as worth a review rather than silently fresh.
    return "stale-complete";
  }
  return addMonths(anchor, reviewCadenceMonths) <= now ? "stale-complete" : "complete";
}

export function isReadyStatus(status: SectionStatus): boolean {
  return status === "complete" || status === "stale-complete" || status === "na";
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

/**
 * Meta to persist alongside a section save: stamps `lastSavedAt`, and drops
 * a stale `completed` flag the moment the save leaves nothing behind to be
 * complete about.
 *
 * `sectionStatus` already ignores `completed` when the section is empty, so
 * omitting this step would be safe for *display* — but the flag would sit in
 * storage waiting to silently resurrect "Complete" the instant a single new
 * value is saved, with no re-confirmation from the user. Clearing it here
 * keeps storage honest, not just the computed status.
 */
export function sectionMetaAfterSave(
  meta: SectionMeta | undefined,
  values: SectionValues,
  now: string,
): SectionMeta {
  const next: SectionMeta = { ...meta, lastSavedAt: now };
  if (meta?.completed && !sectionHasAnyValue(values)) {
    delete next.completed;
  }
  return next;
}
