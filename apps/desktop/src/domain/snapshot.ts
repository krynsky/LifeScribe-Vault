/**
 * THE VAULT SNAPSHOT SHAPE — single source of truth for this comment.
 *
 * The snapshot is opaque JSON to Rust (stored/returned byte-identically);
 * this module is the only place the frontend gives it structure:
 *
 *     {
 *       snapshotFormat: 1,
 *       schemaVersion: number,        // pack schemaVersion values were last
 *                                     // migrated to (records carry their own
 *                                     // per-record stamps too)
 *       profile: {
 *         ownerName: string,
 *         reviewCadenceMonths: number, // staleness cadence, default 12
 *         basePackId?: string         // advisory: the base pack this vault
 *                                     // resolves from, re-stamped on save
 *       },
 *       values: VaultValues,          // sectionKey -> SectionValues
 *       sectionMeta: {                // sectionKey -> per-section metadata
 *         [sectionKey]: {
 *           na?: boolean,             // "doesn't apply to me"
 *           lastReviewedAt?: string,  // ISO; mark-reviewed resets staleness
 *           lastSavedAt?: string      // ISO; saves reset staleness too
 *         }
 *       },
 *       overlay?: UserOverlay,        // user customization overlay (U3)
 *       kitMeta?: {                   // Recovery Kit staleness anchor (U7)
 *         lastGeneratedAt: string,    // ISO; when "Save Kit" last committed
 *         fingerprint: string         // hash of the contributing values
 *       },
 *       ...unknown top-level fields   // preserved verbatim on round-trip
 *     }
 *
 * Unknown top-level fields written by newer app versions are carried through
 * `extra` and re-emitted by `buildSnapshot` — the frontend mirrors Rust's
 * "never strip fields" law.
 */

import type { VaultSnapshot } from "../api/vaultApi";
import type { FormPack, UserOverlay } from "./formModel";
import type { SectionValues, VaultValues } from "./valuesStore";

export const SNAPSHOT_FORMAT = 1;
export const DEFAULT_REVIEW_CADENCE_MONTHS = 12;

export class SnapshotFormatTooNewError extends Error {
  constructor(readonly foundFormat: number) {
    super(`Snapshot format ${foundFormat} requires a newer version of LifeScribe Vault.`);
    this.name = "SnapshotFormatTooNewError";
  }
}

export interface VaultProfile {
  ownerName: string;
  reviewCadenceMonths: number;
  /**
   * packId of the base pack this vault resolves from (advisory metadata,
   * re-stamped from the loaded pack on every save). Absent on snapshots
   * written before this field existed. Recorded now so a future
   * multi-template registry can key off it without a snapshot migration.
   */
  basePackId?: string;
}

export interface SectionMeta {
  na?: boolean;
  /**
   * User's own explicit "I'm done with this section" decision — see
   * domain/readiness.ts. Not derived from field data: a section with saved
   * records is merely "started" until this is set. Ignored (treated as
   * false) if the section has no non-empty value at read time, so a
   * completed section that later loses all its data cannot still claim to
   * be complete.
   */
  completed?: boolean;
  lastReviewedAt?: string;
  lastSavedAt?: string;
}

export type SectionMetaMap = Record<string, SectionMeta>;

/** When the Recovery Kit was last saved and the fingerprint of what it contained. */
export interface KitMeta {
  lastGeneratedAt: string;
  fingerprint: string;
}

export interface ParsedSnapshot {
  snapshotFormat: number;
  schemaVersion: number;
  profile: VaultProfile;
  values: VaultValues;
  sectionMeta: SectionMetaMap;
  overlay: UserOverlay | null;
  kitMeta: KitMeta | null;
  /** Unknown top-level fields, preserved for forward compatibility. */
  extra: Record<string, unknown>;
  /** User's personal form-definition pack, stored encrypted in their vault. */
  customPack?: FormPack;
  /** Bundled base the custom pack was last rebased against. */
  customPackBase?: FormPack;
}

const KNOWN_KEYS = new Set([
  "snapshotFormat",
  "schemaVersion",
  "profile",
  "values",
  "sectionMeta",
  "overlay",
  "kitMeta",
  "customPack",
  "customPackBase",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asOptionalIso(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeSectionValues(sectionKey: string, raw: unknown): SectionValues {
  if (!isRecord(raw)) {
    return { sectionKey, records: [], archivedAnswers: [] };
  }
  return {
    ...raw,
    sectionKey,
    records: Array.isArray(raw.records) ? (raw.records as SectionValues["records"]) : [],
    archivedAnswers: Array.isArray(raw.archivedAnswers)
      ? (raw.archivedAnswers as SectionValues["archivedAnswers"])
      : [],
  };
}

function normalizeValues(raw: unknown): VaultValues {
  if (!isRecord(raw)) {
    return {};
  }
  const values: VaultValues = {};
  for (const [sectionKey, sectionRaw] of Object.entries(raw)) {
    values[sectionKey] = normalizeSectionValues(sectionKey, sectionRaw);
  }
  return values;
}

function normalizeSectionMeta(raw: unknown): SectionMetaMap {
  if (!isRecord(raw)) {
    return {};
  }
  const meta: SectionMetaMap = {};
  for (const [sectionKey, entryRaw] of Object.entries(raw)) {
    if (!isRecord(entryRaw)) {
      continue;
    }
    const entry: SectionMeta = { ...entryRaw };
    if (entryRaw.na === true) {
      entry.na = true;
    }
    if (entryRaw.completed === true) {
      entry.completed = true;
    }
    const lastReviewedAt = asOptionalIso(entryRaw.lastReviewedAt);
    if (lastReviewedAt) {
      entry.lastReviewedAt = lastReviewedAt;
    }
    const lastSavedAt = asOptionalIso(entryRaw.lastSavedAt);
    if (lastSavedAt) {
      entry.lastSavedAt = lastSavedAt;
    }
    meta[sectionKey] = entry;
  }
  return meta;
}

function normalizeKitMeta(raw: unknown): KitMeta | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (typeof raw.lastGeneratedAt !== "string" || typeof raw.fingerprint !== "string") {
    return null;
  }
  return { ...raw, lastGeneratedAt: raw.lastGeneratedAt, fingerprint: raw.fingerprint };
}

/** A brand-new snapshot for a vault that has never been saved. */
export function emptySnapshot(ownerName: string): ParsedSnapshot {
  return {
    snapshotFormat: SNAPSHOT_FORMAT,
    schemaVersion: 0,
    profile: {
      ownerName,
      reviewCadenceMonths: DEFAULT_REVIEW_CADENCE_MONTHS,
    },
    values: {},
    sectionMeta: {},
    overlay: null,
    kitMeta: null,
    extra: {},
  };
}

/**
 * Give structure to a raw snapshot from Rust. Tolerant of missing pieces
 * (older snapshots, fresh vaults) — defaults are filled in, and unknown
 * top-level fields are preserved in `extra`.
 */
export function normalizeSnapshot(
  raw: VaultSnapshot | null,
  fallbackOwnerName = "",
): ParsedSnapshot {
  if (!isRecord(raw)) {
    return emptySnapshot(fallbackOwnerName);
  }
  if (typeof raw.snapshotFormat === "number" && raw.snapshotFormat > SNAPSHOT_FORMAT) {
    throw new SnapshotFormatTooNewError(raw.snapshotFormat);
  }
  const profileRaw = isRecord(raw.profile) ? raw.profile : {};
  const knownProfileKeys = new Set([
    "ownerName",
    "reviewCadenceMonths",
    "basePackId",
    "formMode",
    "moduleSelections",
  ]);
  const profileExtra = Object.fromEntries(
    Object.entries(profileRaw).filter(([key]) => !knownProfileKeys.has(key)),
  );
  const cadenceRaw = profileRaw.reviewCadenceMonths;
  const reviewCadenceMonths =
    typeof cadenceRaw === "number" && Number.isFinite(cadenceRaw) && cadenceRaw > 0
      ? cadenceRaw
      : DEFAULT_REVIEW_CADENCE_MONTHS;

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!KNOWN_KEYS.has(key)) {
      extra[key] = value;
    }
  }

  return {
    snapshotFormat:
      typeof raw.snapshotFormat === "number" ? raw.snapshotFormat : SNAPSHOT_FORMAT,
    schemaVersion: typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0,
    profile: {
      ...profileExtra,
      ownerName: asString(profileRaw.ownerName, fallbackOwnerName),
      reviewCadenceMonths,
      ...(typeof profileRaw.basePackId === "string" && profileRaw.basePackId.length > 0
        ? { basePackId: profileRaw.basePackId }
        : {}),
    },
    values: normalizeValues(raw.values),
    sectionMeta: normalizeSectionMeta(raw.sectionMeta),
    overlay: isRecord(raw.overlay) ? (raw.overlay as unknown as UserOverlay) : null,
    kitMeta: normalizeKitMeta(raw.kitMeta),
    customPack: isRecord(raw.customPack)
      ? (raw.customPack as unknown as FormPack)
      : undefined,
    customPackBase: isRecord(raw.customPackBase)
      ? (raw.customPackBase as unknown as FormPack)
      : undefined,
    extra,
  };
}

/** Re-assemble the wire snapshot, re-emitting preserved unknown fields. */
export function buildSnapshot(parsed: ParsedSnapshot): VaultSnapshot {
  return {
    ...parsed.extra,
    snapshotFormat: parsed.snapshotFormat,
    schemaVersion: parsed.schemaVersion,
    profile: { ...parsed.profile },
    values: parsed.values,
    sectionMeta: parsed.sectionMeta,
    ...(parsed.overlay ? { overlay: parsed.overlay } : {}),
    ...(parsed.kitMeta ? { kitMeta: parsed.kitMeta } : {}),
    ...(parsed.customPack ? { customPack: parsed.customPack } : {}),
    ...(parsed.customPackBase ? { customPackBase: parsed.customPackBase } : {}),
  };
}
