/**
 * Cross-model property test: across merge + migration + reconcile paths,
 * every non-empty user value either remains an active record value or
 * becomes an archived answer — it never vanishes and is never transformed
 * by an unauthored change. ("No value ever dropped" — the plan's mitigation
 * for silent customized-vault breakage on pack upgrades.)
 */

import { describe, expect, it } from "vitest";
import type { FormPack, UserOverlay } from "./formModel";
import { mergePackWithOverlay } from "./packMerge";
import { migrateVaultValues } from "./packMigrations";
import {
  applyKeyRenames,
  collectAllStoredValues,
  reconcileSectionValues,
  type VaultValues,
} from "./valuesStore";
import {
  makeField,
  makePlanPack,
  makeRecord,
  makeSectionValues,
  makeVaultValues,
  previousFieldsOf,
} from "./testing/fixtures";

/** Deterministic LCG so the "varied fixtures" are reproducible. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

const VALUE_POOL = [
  "1Password",
  "LastPass", // falls out of the select options in some pack variants
  "Call Dana first",
  "2026-01-15",
  "dana@example.com",
  "not-an-email",
  "Sam Ortiz",
  "Spare key under planter",
] as const;

function makeV2PlanPack(): FormPack {
  return makePlanPack({
    schemaVersion: 2,
    migrations: [{ fromVersion: 1, operations: [] }],
  });
}

/** Pack variants: each models one default-change type. */
const PACK_VARIANTS: ReadonlyArray<{ name: string; build: () => FormPack }> = [
  { name: "unchanged", build: makeV2PlanPack },
  {
    name: "field removed",
    build: () => {
      const pack = makeV2PlanPack();
      pack.sections[0].groups[0].fields = pack.sections[0].groups[0].fields.filter(
        (field) => field.systemKey !== "notes",
      );
      return pack;
    },
  },
  {
    name: "field retyped without migration",
    build: () => {
      const pack = makeV2PlanPack();
      pack.sections[0].groups[0].fields[2].type = "date";
      return pack;
    },
  },
  {
    name: "select options narrowed",
    build: () => {
      const pack = makeV2PlanPack();
      pack.sections[0].groups[0].fields[0].options = [{ value: "Bitwarden", label: "Bitwarden" }];
      return pack;
    },
  },
  {
    name: "repeatable group reduced",
    build: () => {
      const pack = makeV2PlanPack();
      pack.sections[0].groups[1].repeatable = false;
      return pack;
    },
  },
  {
    name: "group removed",
    build: () => {
      const pack = makeV2PlanPack();
      pack.sections[0].groups = pack.sections[0].groups.filter((group) => group.groupKey !== "contact");
      return pack;
    },
  },
  {
    name: "new default field collides with custom key",
    build: () => {
      const pack = makeV2PlanPack();
      pack.sections[0].groups[0].fields.push(
        makeField({ systemKey: "custom.plan.note", label: "Planning note", order: 4 }),
      );
      return pack;
    },
  },
  {
    name: "authored rename migration",
    build: () =>
      makePlanPack({
        schemaVersion: 2,
        migrations: [
          {
            fromVersion: 1,
            operations: [{ op: "renameField", sectionKey: "plan", fromKey: "legacyNotes", toKey: "notes" }],
          },
        ],
      }),
  },
];

const OVERLAY_VARIANTS: ReadonlyArray<{ name: string; overlay: UserOverlay | null }> = [
  { name: "no overlay", overlay: null },
  {
    name: "relabel + reorder",
    overlay: {
      sections: [
        { sectionKey: "plan", relabels: { notes: { label: "Family notes" } }, fieldOrder: ["notes", "provider"] },
      ],
    },
  },
  {
    name: "custom field",
    overlay: {
      sections: [
        {
          sectionKey: "plan",
          customFields: [
            { systemKey: "custom.plan.note", groupKey: "main", label: "My note", type: "text", order: 9 },
          ],
        },
      ],
    },
  },
  {
    name: "hidden optional field",
    overlay: { sections: [{ sectionKey: "plan", hiddenFields: ["notes"] }] },
  },
];

/** Keys a record may carry — including keys some pack variants orphan. */
const CANDIDATE_KEYS = ["provider", "notes", "legacyNotes", "custom.plan.note", "vanishedKey"] as const;
const CONTACT_KEYS = ["contactName", "contactEmail"] as const;

function randomValues(rng: () => number): VaultValues {
  const mainValues: Record<string, string> = {};
  for (const key of CANDIDATE_KEYS) {
    if (rng() < 0.6) {
      mainValues[key] = pick(rng, VALUE_POOL);
    }
  }
  const records = [makeRecord({ id: "main-1", schemaVersion: 1, values: mainValues })];
  const contactCount = Math.floor(rng() * 4); // 0..3 repeatable records
  for (let index = 1; index <= contactCount; index += 1) {
    const contactValues: Record<string, string> = {};
    for (const key of CONTACT_KEYS) {
      if (rng() < 0.7) {
        contactValues[key] = pick(rng, VALUE_POOL);
      }
    }
    records.push(
      makeRecord({ id: `contact-${index}`, groupKey: "contact", schemaVersion: 1, values: contactValues }),
    );
  }
  return makeVaultValues([makeSectionValues("plan", records)]);
}

/** The loader pipeline: merge -> re-key renames -> migrate-on-read -> reconcile. */
function runPipeline(pack: FormPack, overlay: UserOverlay | null, values: VaultValues): VaultValues {
  const merge = mergePackWithOverlay(pack, overlay, values);
  const rekeyed = applyKeyRenames(values, merge.keyRenames);
  const migration = migrateVaultValues(rekeyed, pack);
  expect(migration.ok).toBe(true);
  if (!migration.ok) {
    throw new Error(migration.error.message);
  }
  const previousFields = previousFieldsOf(makePlanPack(), "plan");
  const final: VaultValues = {};
  for (const section of merge.resolved.sections) {
    const sectionValues = migration.values[section.sectionKey];
    if (sectionValues) {
      final[section.sectionKey] = reconcileSectionValues(sectionValues, section, previousFields).sectionValues;
    }
  }
  return final;
}

function asMultiset(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

describe("property: no non-empty user value ever vanishes across merge + migration", () => {
  const cases = PACK_VARIANTS.flatMap((packVariant) =>
    OVERLAY_VARIANTS.map((overlayVariant) => ({
      name: `${packVariant.name} × ${overlayVariant.name}`,
      packVariant,
      overlayVariant,
    })),
  );

  it.each(cases)("$name", ({ packVariant, overlayVariant }) => {
    const rng = makeRng(0xc0ffee ^ cases.findIndex((entry) => entry.packVariant === packVariant));
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const values = randomValues(rng);
      const before = asMultiset(collectAllStoredValues(values));
      const beforeSnapshot = structuredClone(values);

      const after = asMultiset(
        collectAllStoredValues(runPipeline(packVariant.build(), overlayVariant.overlay, values)),
      );

      // Every input value survives with at least its original multiplicity
      // (values are never transformed by unauthored changes, only kept,
      // re-keyed, or archived).
      for (const [value, count] of before) {
        expect(after.get(value) ?? 0, `value "${value}" must survive`).toBeGreaterThanOrEqual(count);
      }

      // And the pipeline never mutates its input (crash-window safety).
      expect(values).toEqual(beforeSnapshot);
    }
  });

  it("holds when migration and reconcile run twice (idempotent end to end)", () => {
    const rng = makeRng(0xbeefcafe);
    const values = randomValues(rng);
    const pack = PACK_VARIANTS[4].build(); // repeatable group reduced
    const once = runPipeline(pack, OVERLAY_VARIANTS[2].overlay, values);
    const twice = runPipeline(pack, OVERLAY_VARIANTS[2].overlay, once);
    expect(twice).toEqual(once);
  });
});
