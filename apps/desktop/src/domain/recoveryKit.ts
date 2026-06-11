/**
 * Recovery Kit generation (U7).
 *
 * The Kit is a generated, pointer-based view derived ONLY from the pack's
 * kit mappings: contacts, instructions, and locations — structurally no
 * secret-value slots. The derivation consumes exclusively the systemKeys
 * listed in each section's `kitMapping`; no other field can reach the
 * output (the record label is likewise derived from mapped values only).
 *
 * Rules:
 * - Sections render in pack order; entries in mapping order; fields in the
 *   mapping entry's order.
 * - Values hidden by an unsatisfied `visibleWhen` condition (evaluated per
 *   record) are excluded.
 * - Empty values are skipped; empty sections and N/A sections are omitted
 *   entirely.
 * - Multi-record sections (and repeatable groups) emit one block per
 *   record, labeled by the record's summary value.
 * - Archived answers are NEVER included.
 *
 * Staleness: `computeKitFingerprint` is a stable, deterministic hash over
 * exactly the contributing (mapped, visible, non-empty) values. It is NOT
 * cryptographic — it only detects "vault data changed since the Kit was
 * last saved" (see `isKitStale`).
 */

import {
  isConditionSatisfied,
  type FieldDefinition,
  type KitMapping,
  type ReadinessRule,
} from "./formModel";
import type { KitMeta, SectionMetaMap, VaultProfile } from "./snapshot";
import type { SectionRecord, VaultValues } from "./valuesStore";

/**
 * The structural slice of a section the Kit derivation needs. Both
 * `PackSection` and `ResolvedSection` satisfy it, so creator-authored packs
 * and resolved (overlay-merged) definitions flow through identically.
 */
export interface KitSourceSection {
  sectionKey: string;
  title: string;
  order: number;
  multiRecord: boolean;
  groups: ReadonlyArray<{
    groupKey: string;
    repeatable: boolean;
    fields: ReadonlyArray<FieldDefinition>;
  }>;
  readinessRule: ReadinessRule;
  kitMapping: KitMapping;
}

export interface RecoveryKitItem {
  systemKey: string;
  label: string;
  value: string;
}

export interface RecoveryKitBlock {
  recordId: string;
  /** Summary label for multi-record / repeatable-group records; null for singletons. */
  recordLabel: string | null;
  items: RecoveryKitItem[];
}

export interface RecoveryKitEntry {
  sectionKey: string;
  sectionTitle: string;
  heading: string;
  blocks: RecoveryKitBlock[];
}

/**
 * The structured Kit: a generated-at header concept (whose vault this is —
 * the view renders the date it was generated alongside) plus the entries.
 */
export interface RecoveryKit {
  ownerName: string | null;
  entries: RecoveryKitEntry[];
}

/** Is the (resolved) field overlay-hidden? Pack fields have no flag. */
function isHiddenField(field: FieldDefinition): boolean {
  return "hidden" in field && (field as { hidden?: boolean }).hidden === true;
}

function indexSectionFields(section: KitSourceSection): Map<string, FieldDefinition> {
  const index = new Map<string, FieldDefinition>();
  for (const group of section.groups) {
    for (const field of group.fields) {
      index.set(field.systemKey, field);
    }
  }
  return index;
}

function buildItems(
  record: SectionRecord,
  mappedKeys: readonly string[],
  fieldIndex: Map<string, FieldDefinition>,
): RecoveryKitItem[] {
  const items: RecoveryKitItem[] = [];
  for (const systemKey of mappedKeys) {
    const field = fieldIndex.get(systemKey);
    if (!field || isHiddenField(field)) {
      continue; // Mapped key absent from the definition: nothing to point at.
    }
    if (!isConditionSatisfied(field.visibleWhen, record.values)) {
      continue; // Hidden-conditional value: excluded.
    }
    const value = (record.values[systemKey] ?? "").trim();
    if (value.length === 0) {
      continue;
    }
    items.push({ systemKey, label: field.label, value });
  }
  return items;
}

/**
 * Block label derived ONLY from mapped values (pointer-based law): the
 * record's first readiness-key value that is also kit-mapped, falling back
 * to the block's first item value.
 */
function blockLabel(
  section: KitSourceSection,
  record: SectionRecord,
  mappedKeys: readonly string[],
  items: RecoveryKitItem[],
): string {
  const mapped = new Set(mappedKeys);
  for (const key of section.readinessRule.requiredKeys) {
    if (!mapped.has(key)) {
      continue;
    }
    const value = (record.values[key] ?? "").trim();
    if (value.length > 0) {
      return value;
    }
  }
  return items[0]?.value ?? "Untitled";
}

function isLabeledRecord(section: KitSourceSection, record: SectionRecord): boolean {
  if (section.multiRecord) {
    return true;
  }
  if (record.groupKey === undefined) {
    return false;
  }
  const group = section.groups.find((candidate) => candidate.groupKey === record.groupKey);
  return group?.repeatable === true;
}

/**
 * Derive the Recovery Kit from the current vault values. Pure and
 * deterministic; archived answers are structurally unreachable (only
 * `records` is read).
 */
export function buildRecoveryKit(
  sections: readonly KitSourceSection[],
  values: VaultValues,
  sectionMeta: SectionMetaMap = {},
  profile?: Pick<VaultProfile, "ownerName">,
): RecoveryKit {
  const entries: RecoveryKitEntry[] = [];
  const ordered = [...sections].sort((left, right) => left.order - right.order);

  for (const section of ordered) {
    if (sectionMeta[section.sectionKey]?.na) {
      continue; // N/A sections are omitted entirely.
    }
    const sectionValues = values[section.sectionKey];
    if (!sectionValues || sectionValues.records.length === 0) {
      continue;
    }
    const fieldIndex = indexSectionFields(section);

    for (const entry of section.kitMapping.entries) {
      const blocks: RecoveryKitBlock[] = [];
      for (const record of sectionValues.records) {
        const items = buildItems(record, entry.fields, fieldIndex);
        if (items.length === 0) {
          continue;
        }
        blocks.push({
          recordId: record.id,
          recordLabel: isLabeledRecord(section, record)
            ? blockLabel(section, record, entry.fields, items)
            : null,
          items,
        });
      }
      if (blocks.length > 0) {
        entries.push({
          sectionKey: section.sectionKey,
          sectionTitle: section.title,
          heading: entry.heading,
          blocks,
        });
      }
    }
  }

  const ownerName = profile?.ownerName.trim() ?? "";
  return { ownerName: ownerName.length > 0 ? ownerName : null, entries };
}

/** FNV-1a 32-bit over a string — small, stable, deterministic. Not crypto. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Stable fingerprint over exactly the contributing (mapped, visible,
 * non-empty) values. Independent of object key order (derivation order comes
 * from the definitions and the records array); changes iff a contributing
 * value — or which values contribute — changes.
 */
export function computeKitFingerprint(
  sections: readonly KitSourceSection[],
  values: VaultValues,
  sectionMeta: SectionMetaMap = {},
): string {
  const kit = buildRecoveryKit(sections, values, sectionMeta);
  const contributing = kit.entries.flatMap((entry) =>
    entry.blocks.flatMap((block) =>
      block.items.map((item) => [entry.sectionKey, block.recordId, item.systemKey, item.value]),
    ),
  );
  return fnv1a(JSON.stringify(contributing));
}

/**
 * Stale = the Kit has been saved before AND the data it pointed at has
 * changed since. A never-saved Kit is "not saved yet", not stale.
 */
export function isKitStale(currentFingerprint: string, kitMeta: KitMeta | null): boolean {
  return kitMeta !== null && kitMeta.fingerprint !== currentFingerprint;
}
