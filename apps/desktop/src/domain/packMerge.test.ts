import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  FormPack,
  MergeNoticeKind,
  ResolvedField,
  ResolvedSection,
  UserOverlay,
} from "./formModel";
import { mergePackWithOverlay } from "./packMerge";
import { validatePack } from "./packValidation";
import {
  applyKeyRenames,
  collectAllStoredValues,
  reconcileSectionValues,
  type ArchivedAnswer,
  type PreviousFieldIndex,
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

// Vitest runs with cwd = apps/desktop
const DEFAULT_PACK_PATH = resolve(process.cwd(), "src-tauri/resources/packs/default-pack.json");

function fieldIn(section: ResolvedSection, systemKey: string): ResolvedField {
  for (const group of section.groups) {
    const match = group.fields.find((field) => field.systemKey === systemKey);
    if (match) {
      return match;
    }
  }
  throw new Error(`field ${systemKey} was not resolved in section ${section.sectionKey}`);
}

function fieldKeysOf(section: ResolvedSection, groupKey: string): string[] {
  const group = section.groups.find((candidate) => candidate.groupKey === groupKey);
  if (!group) {
    throw new Error(`group ${groupKey} was not resolved`);
  }
  return [...group.fields].sort((left, right) => left.order - right.order).map((field) => field.systemKey);
}

/** Baseline stored values for the makePlanPack "plan" section. */
function makePlanValues(mainExtra: Record<string, string> = {}): VaultValues {
  return makeVaultValues([
    makeSectionValues("plan", [
      makeRecord({ id: "main-1", values: { provider: "1Password", notes: "Call Dana first", ...mainExtra } }),
      makeRecord({ id: "contact-1", groupKey: "contact", values: { contactName: "Dana Reyes", contactEmail: "dana@example.com" } }),
      makeRecord({ id: "contact-2", groupKey: "contact", values: { contactName: "Sam Ortiz" } }),
      makeRecord({ id: "contact-3", groupKey: "contact", values: { contactName: "Lee Park" } }),
    ]),
  ]);
}

/**
 * Full upgrade pipeline as the loader runs it: merge, re-key renamed custom
 * fields, then reconcile every section against the resolved definition.
 */
function runUpgradePipeline(
  pack: FormPack,
  overlay: UserOverlay | null,
  values: VaultValues,
  previousFields?: PreviousFieldIndex,
) {
  const merge = mergePackWithOverlay(pack, overlay, values);
  const rekeyed = applyKeyRenames(values, merge.keyRenames);
  const reconciled: VaultValues = {};
  const newlyArchived: ArchivedAnswer[] = [];
  for (const section of merge.resolved.sections) {
    const sectionValues = rekeyed[section.sectionKey];
    if (!sectionValues) {
      continue;
    }
    const result = reconcileSectionValues(sectionValues, section, previousFields);
    reconciled[section.sectionKey] = result.sectionValues;
    newlyArchived.push(...result.newlyArchived);
  }
  return { merge, reconciled, newlyArchived };
}

describe("mergePackWithOverlay — bundled default pack golden", () => {
  it("resolves the bundled default pack with an empty overlay, no notices", () => {
    const validation = validatePack(JSON.parse(readFileSync(DEFAULT_PACK_PATH, "utf-8")));
    expect(validation.ok).toBe(true);
    if (!validation.ok) {
      return;
    }
    const { resolved, notices, keyRenames } = mergePackWithOverlay(validation.pack);
    expect(notices).toEqual([]);
    expect(keyRenames).toEqual([]);
    expect(resolved.schemaVersion).toBe(validation.pack.schemaVersion);
    expect(resolved.sections.map((section) => section.sectionKey)).toEqual(
      validation.pack.sections.map((section) => section.sectionKey),
    );
    for (const section of resolved.sections) {
      for (const group of section.groups) {
        for (const field of group.fields) {
          expect(field.source).toBe("pack");
          expect(field.hidden).toBe(false);
        }
      }
    }
  });
});

describe("mergePackWithOverlay — overlay relabel / reorder / custom fields", () => {
  it("applies relabels while the pack keeps structural authority", () => {
    const overlay: UserOverlay = {
      sections: [
        {
          sectionKey: "plan",
          relabels: { notes: { label: "Family notes", helperText: "Anything they should know." } },
        },
      ],
    };
    const { resolved, notices } = mergePackWithOverlay(makePlanPack(), overlay);
    const notes = fieldIn(resolved.sections[0], "notes");
    expect(notes.label).toBe("Family notes");
    expect(notes.helperText).toBe("Anything they should know.");
    // Structure still comes from the pack.
    expect(notes.type).toBe("textarea");
    expect(notes.required).toBe(false);
    expect(notes.protected).toBe(false);
    expect(notes.source).toBe("pack");
    expect(notices).toEqual([]);
  });

  it("ignores blank relabel labels instead of erasing the pack label", () => {
    const overlay: UserOverlay = {
      sections: [{ sectionKey: "plan", relabels: { notes: { label: "   " } } }],
    };
    const { resolved } = mergePackWithOverlay(makePlanPack(), overlay);
    expect(fieldIn(resolved.sections[0], "notes").label).toBe("Notes");
  });

  it("reorders fields within a group by the overlay fieldOrder, unlisted fields after", () => {
    const overlay: UserOverlay = {
      sections: [{ sectionKey: "plan", fieldOrder: ["notes", "provider"] }],
    };
    const { resolved, notices } = mergePackWithOverlay(makePlanPack(), overlay);
    expect(fieldKeysOf(resolved.sections[0], "main")).toEqual(["notes", "provider", "otherProvider"]);
    // Orders are re-numbered contiguously for the renderer.
    const main = resolved.sections[0].groups.find((group) => group.groupKey === "main");
    expect(main?.fields.map((field) => field.order).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(notices).toEqual([]);
  });

  it("merges custom fields into their group as unrequired, unprotected fields", () => {
    const overlay: UserOverlay = {
      sections: [
        {
          sectionKey: "plan",
          customFields: [
            {
              systemKey: "custom.plan.vaultLocation",
              groupKey: "main",
              label: "Where the printed vault sheet lives",
              type: "text",
              order: 99,
            },
          ],
        },
      ],
    };
    const { resolved, notices, keyRenames, overlay: normalized } = mergePackWithOverlay(makePlanPack(), overlay);
    const custom = fieldIn(resolved.sections[0], "custom.plan.vaultLocation");
    expect(custom.source).toBe("custom");
    expect(custom.required).toBe(false);
    expect(custom.protected).toBe(false);
    expect(custom.hidden).toBe(false);
    expect(notices).toEqual([]);
    expect(keyRenames).toEqual([]);
    expect(normalized.sections[0].customFields?.[0].systemKey).toBe("custom.plan.vaultLocation");
  });

  it("relocates a custom field into a surviving group when its group disappears", () => {
    const overlay: UserOverlay = {
      sections: [
        {
          sectionKey: "plan",
          customFields: [
            { systemKey: "custom.plan.note", groupKey: "ghost-group", label: "Note", type: "text", order: 1 },
          ],
        },
      ],
    };
    const { resolved, overlay: normalized } = mergePackWithOverlay(makePlanPack(), overlay);
    // Falls back to the first group rather than dropping the field.
    expect(fieldKeysOf(resolved.sections[0], "main")).toContain("custom.plan.note");
    expect(normalized.sections[0].customFields?.[0].groupKey).toBe("main");
  });
});

describe("mergePackWithOverlay — systemKey collision (new default key vs user custom key)", () => {
  function collisionSetup() {
    const pack = makePlanPack();
    // An updated default pack now ships a field at the user's custom key.
    pack.sections[0].groups[0].fields.push(
      makeField({ systemKey: "custom.plan.note", label: "Planning note", order: 4 }),
    );
    const overlay: UserOverlay = {
      sections: [
        {
          sectionKey: "plan",
          customFields: [
            { systemKey: "custom.plan.note", groupKey: "main", label: "My note", type: "text", order: 5 },
          ],
        },
      ],
    };
    return { pack, overlay };
  }

  it("renames the custom field deterministically, emits a notice and a key rename", () => {
    const { pack, overlay } = collisionSetup();
    const { resolved, notices, keyRenames, overlay: normalized } = mergePackWithOverlay(pack, overlay);

    const renamedKey = "custom.plan.note.user";
    const packField = fieldIn(resolved.sections[0], "custom.plan.note");
    const customField = fieldIn(resolved.sections[0], renamedKey);
    expect(packField.source).toBe("pack");
    expect(customField.source).toBe("custom");
    expect(customField.label).toBe("My note");

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      kind: "custom-field-renamed",
      sectionKey: "plan",
      systemKey: renamedKey,
    });
    expect(notices[0].message).not.toHaveLength(0);

    expect(keyRenames).toEqual([{ sectionKey: "plan", from: "custom.plan.note", to: renamedKey }]);
    expect(normalized.sections[0].customFields?.[0].systemKey).toBe(renamedKey);
  });

  it("re-keys stored values through applyKeyRenames so the value follows the custom field", () => {
    const { pack, overlay } = collisionSetup();
    const values = makeVaultValues([
      makeSectionValues("plan", [
        makeRecord({ id: "main-1", values: { "custom.plan.note": "Check the safe" } }),
      ]),
    ]);
    const { merge, reconciled } = runUpgradePipeline(pack, overlay, values);
    const record = reconciled.plan.records[0];
    expect(record.values["custom.plan.note.user"]).toBe("Check the safe");
    expect(record.values["custom.plan.note"]).toBeUndefined();
    expect(merge.notices.length).toBeGreaterThan(0);
  });

  it("relocates a malformed custom key into the section namespace with a notice", () => {
    const overlay: UserOverlay = {
      sections: [
        {
          sectionKey: "plan",
          customFields: [{ systemKey: "warranty", groupKey: "main", label: "Warranty", type: "text", order: 9 }],
        },
      ],
    };
    const { resolved, notices, keyRenames } = mergePackWithOverlay(makePlanPack(), overlay);
    expect(fieldIn(resolved.sections[0], "custom.plan.warranty").source).toBe("custom");
    expect(notices[0]).toMatchObject({ kind: "custom-field-renamed", sectionKey: "plan" });
    expect(keyRenames).toEqual([{ sectionKey: "plan", from: "warranty", to: "custom.plan.warranty" }]);
  });
});

describe("mergePackWithOverlay — saved select value absent from new options", () => {
  it("flags the record's value as a read-only previous answer with a notice", () => {
    const pack = makePlanPack();
    const provider = pack.sections[0].groups[0].fields[0];
    provider.options = [
      { value: "1Password", label: "1Password" },
      { value: "Bitwarden", label: "Bitwarden" },
    ];
    const values = makeVaultValues([
      makeSectionValues("plan", [makeRecord({ id: "main-1", values: { provider: "LastPass" } })]),
    ]);

    const { resolved, notices } = mergePackWithOverlay(pack, null, values);
    const field = fieldIn(resolved.sections[0], "provider");
    expect(field.previousAnswers).toEqual([{ recordId: "main-1", value: "LastPass" }]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: "previous-answer", sectionKey: "plan", systemKey: "provider" });
  });

  it("leaves the stored value in place — flagged, never archived or dropped", () => {
    const pack = makePlanPack();
    pack.sections[0].groups[0].fields[0].options = [{ value: "Bitwarden", label: "Bitwarden" }];
    const values = makeVaultValues([
      makeSectionValues("plan", [makeRecord({ id: "main-1", values: { provider: "LastPass" } })]),
    ]);
    const { reconciled, newlyArchived } = runUpgradePipeline(
      pack,
      null,
      values,
      previousFieldsOf(makePlanPack(), "plan"),
    );
    expect(reconciled.plan.records[0].values.provider).toBe("LastPass");
    expect(newlyArchived).toEqual([]);
  });

  it("does not flag values that still match an option", () => {
    const values = makeVaultValues([
      makeSectionValues("plan", [makeRecord({ id: "main-1", values: { provider: "Bitwarden" } })]),
    ]);
    const { resolved, notices } = mergePackWithOverlay(makePlanPack(), null, values);
    expect(fieldIn(resolved.sections[0], "provider").previousAnswers).toBeUndefined();
    expect(notices).toEqual([]);
  });
});

describe("mergePackWithOverlay — hide flags vs promoted fields", () => {
  const hiddenNotesOverlay: UserOverlay = {
    sections: [{ sectionKey: "plan", hiddenFields: ["notes"] }],
  };

  it("honors a hide flag on an optional, unprotected, non-readiness field", () => {
    const { resolved, notices, overlay: normalized } = mergePackWithOverlay(makePlanPack(), hiddenNotesOverlay);
    expect(fieldIn(resolved.sections[0], "notes").hidden).toBe(true);
    expect(notices).toEqual([]);
    expect(normalized.sections[0].hiddenFields).toEqual(["notes"]);
  });

  it("invalidates the hide flag with a notice when the pack promotes the field to protected", () => {
    const pack = makePlanPack();
    const notes = pack.sections[0].groups[0].fields[2];
    notes.protected = true;
    notes.required = true;

    const { resolved, notices, overlay: normalized } = mergePackWithOverlay(pack, hiddenNotesOverlay);
    expect(fieldIn(resolved.sections[0], "notes").hidden).toBe(false);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: "hide-flag-invalidated", sectionKey: "plan", systemKey: "notes" });
    expect(notices[0].message.length).toBeGreaterThan(0);
    // The invalidated flag is removed from the normalized overlay.
    expect(normalized.sections).toEqual([]);
  });

  it("invalidates the hide flag when the field becomes readiness-gating", () => {
    const pack = makePlanPack();
    pack.sections[0].readinessRule.requiredKeys = ["provider", "notes"];

    const { resolved, notices } = mergePackWithOverlay(pack, hiddenNotesOverlay);
    expect(fieldIn(resolved.sections[0], "notes").hidden).toBe(false);
    expect(notices).toEqual([
      expect.objectContaining({ kind: "hide-flag-invalidated", systemKey: "notes" }),
    ]);
  });

  it("invalidates the hide flag when the field becomes required", () => {
    const pack = makePlanPack();
    pack.sections[0].groups[0].fields[2].required = true;
    const { resolved, notices } = mergePackWithOverlay(pack, hiddenNotesOverlay);
    expect(fieldIn(resolved.sections[0], "notes").hidden).toBe(false);
    expect(notices[0]?.kind).toBe("hide-flag-invalidated");
  });
});

describe("merge + reconcile — whole-record and field archival goldens", () => {
  it("repeatable group reduced to single with 3 records archives records 2-3 whole", () => {
    const pack = makePlanPack();
    const contact = pack.sections[0].groups[1];
    contact.repeatable = false;
    const values = makePlanValues();

    const { reconciled, newlyArchived } = runUpgradePipeline(
      pack,
      null,
      values,
      previousFieldsOf(makePlanPack(), "plan"),
    );

    const keptIds = reconciled.plan.records.map((record) => record.id);
    expect(keptIds).toEqual(["main-1", "contact-1"]);

    // Every non-empty value of records 2-3 is archived with label + reason.
    const archivedByRecord = new Map<string, ArchivedAnswer[]>();
    for (const answer of newlyArchived) {
      archivedByRecord.set(answer.recordId, [...(archivedByRecord.get(answer.recordId) ?? []), answer]);
    }
    expect([...archivedByRecord.keys()].sort()).toEqual(["contact-2", "contact-3"]);
    for (const answer of newlyArchived) {
      expect(answer.originalLabel).toBe("Contact name");
      expect(answer.reason).toMatch(/no longer holds multiple records/);
      expect(answer.value.length).toBeGreaterThan(0);
    }
    expect(newlyArchived.map((answer) => answer.value).sort()).toEqual(["Lee Park", "Sam Ortiz"]);
  });

  it("unprotected field retyped without an authored migration archives the old value, never coerces", () => {
    const pack = makePlanPack();
    pack.sections[0].groups[0].fields[2].type = "date"; // notes: textarea -> date
    const values = makePlanValues();

    const { reconciled, newlyArchived } = runUpgradePipeline(
      pack,
      null,
      values,
      previousFieldsOf(makePlanPack(), "plan"),
    );

    const record = reconciled.plan.records.find((candidate) => candidate.id === "main-1");
    expect(record?.values.notes).toBeUndefined();
    const archived = newlyArchived.find((answer) => answer.systemKey === "notes");
    expect(archived).toMatchObject({
      recordId: "main-1",
      originalLabel: "Notes",
      value: "Call Dana first",
    });
    expect(archived?.reason).toMatch(/changed from textarea to date/);
  });

  it("a retyped value that already conforms to the new type is kept, not archived", () => {
    const pack = makePlanPack();
    pack.sections[0].groups[0].fields[2].type = "date";
    const values = makePlanValues({ notes: "2026-01-15" });
    const { reconciled, newlyArchived } = runUpgradePipeline(
      pack,
      null,
      values,
      previousFieldsOf(makePlanPack(), "plan"),
    );
    expect(reconciled.plan.records[0].values.notes).toBe("2026-01-15");
    expect(newlyArchived).toEqual([]);
  });

  it("fails open with a notice when a visibility condition references a removed field", () => {
    const pack = makePlanPack();
    pack.sections[0].groups[0].fields[1].visibleWhen = { field: "legacyKey", equals: "yes" };
    const { resolved, notices } = mergePackWithOverlay(pack, null);
    expect(fieldIn(resolved.sections[0], "otherProvider").visibleWhen).toBeUndefined();
    expect(notices).toEqual([
      expect.objectContaining({ kind: "dangling-condition", sectionKey: "plan" }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Golden matrix: default-change type × overlay state -> expected outcome.
// Every conflicting cell must produce at least one notice or archived answer,
// and no cell may lose a user value.
// ---------------------------------------------------------------------------

interface MatrixCase {
  name: string;
  pack: () => FormPack;
  overlay: UserOverlay | null;
  values: () => VaultValues;
  expectedNoticeKinds: MergeNoticeKind[];
  expectedArchivedValues: string[];
}

const customNoteOverlay: UserOverlay = {
  sections: [
    {
      sectionKey: "plan",
      customFields: [
        { systemKey: "custom.plan.note", groupKey: "main", label: "My note", type: "text", order: 9 },
      ],
    },
  ],
};

const matrix: MatrixCase[] = [
  {
    name: "unchanged pack × empty overlay -> clean resolve",
    pack: makePlanPack,
    overlay: null,
    values: makePlanValues,
    expectedNoticeKinds: [],
    expectedArchivedValues: [],
  },
  {
    name: "unchanged pack × relabel+reorder overlay -> cosmetic merge only",
    pack: makePlanPack,
    overlay: {
      sections: [
        { sectionKey: "plan", relabels: { notes: { label: "Family notes" } }, fieldOrder: ["notes", "provider"] },
      ],
    },
    values: makePlanValues,
    expectedNoticeKinds: [],
    expectedArchivedValues: [],
  },
  {
    name: "unchanged pack × custom-field overlay -> custom value lives alongside pack values",
    pack: makePlanPack,
    overlay: customNoteOverlay,
    values: () => makePlanValues({ "custom.plan.note": "Spare key under planter" }),
    expectedNoticeKinds: [],
    expectedArchivedValues: [],
  },
  {
    name: "select option removed × empty overlay -> previous-answer flag, value kept",
    pack: () => {
      const pack = makePlanPack();
      pack.sections[0].groups[0].fields[0].options = [{ value: "Bitwarden", label: "Bitwarden" }];
      return pack;
    },
    overlay: null,
    values: makePlanValues,
    expectedNoticeKinds: ["previous-answer"],
    expectedArchivedValues: [],
  },
  {
    name: "new default key × colliding custom field -> custom field renamed",
    pack: () => {
      const pack = makePlanPack();
      pack.sections[0].groups[0].fields.push(
        makeField({ systemKey: "custom.plan.note", label: "Planning note", order: 4 }),
      );
      return pack;
    },
    overlay: customNoteOverlay,
    values: () => makePlanValues({ "custom.plan.note": "Spare key under planter" }),
    expectedNoticeKinds: ["custom-field-renamed"],
    expectedArchivedValues: [],
  },
  {
    name: "field promoted to protected × hidden overlay -> hide flag invalidated",
    pack: () => {
      const pack = makePlanPack();
      pack.sections[0].groups[0].fields[2].protected = true;
      pack.sections[0].groups[0].fields[2].required = true;
      return pack;
    },
    overlay: { sections: [{ sectionKey: "plan", hiddenFields: ["notes"] }] },
    values: makePlanValues,
    expectedNoticeKinds: ["hide-flag-invalidated"],
    expectedArchivedValues: [],
  },
  {
    name: "unprotected field removed × empty overlay -> value archived",
    pack: () => {
      const pack = makePlanPack();
      pack.sections[0].groups[0].fields = pack.sections[0].groups[0].fields.filter(
        (field) => field.systemKey !== "notes",
      );
      return pack;
    },
    overlay: null,
    values: makePlanValues,
    expectedNoticeKinds: [],
    expectedArchivedValues: ["Call Dana first"],
  },
  {
    name: "field retyped without migration × relabel overlay -> non-conforming value archived",
    pack: () => {
      const pack = makePlanPack();
      pack.sections[0].groups[0].fields[2].type = "date";
      return pack;
    },
    overlay: { sections: [{ sectionKey: "plan", relabels: { notes: { label: "Family notes" } } }] },
    values: makePlanValues,
    expectedNoticeKinds: [],
    expectedArchivedValues: ["Call Dana first"],
  },
  {
    name: "repeatable group reduced × custom-field overlay -> extra records archived whole",
    pack: () => {
      const pack = makePlanPack();
      pack.sections[0].groups[1].repeatable = false;
      return pack;
    },
    overlay: customNoteOverlay,
    values: () => makePlanValues({ "custom.plan.note": "Spare key under planter" }),
    expectedNoticeKinds: [],
    expectedArchivedValues: ["Lee Park", "Sam Ortiz"],
  },
  {
    name: "condition target removed × empty overlay -> dangling condition fails open",
    pack: () => {
      const pack = makePlanPack();
      pack.sections[0].groups[0].fields[1].visibleWhen = { field: "legacyKey", equals: "yes" };
      return pack;
    },
    overlay: null,
    values: makePlanValues,
    expectedNoticeKinds: ["dangling-condition"],
    expectedArchivedValues: [],
  },
];

describe("golden matrix: default-change type × overlay state", () => {
  it.each(matrix)("$name", ({ pack, overlay, values, expectedNoticeKinds, expectedArchivedValues }) => {
    const inputValues = values();
    const inputSnapshot = collectAllStoredValues(inputValues).sort();

    const { merge, reconciled, newlyArchived } = runUpgradePipeline(
      pack(),
      overlay,
      inputValues,
      previousFieldsOf(makePlanPack(), "plan"),
    );

    expect(merge.notices.map((notice) => notice.kind).sort()).toEqual([...expectedNoticeKinds].sort());
    expect(newlyArchived.map((answer) => answer.value).sort()).toEqual([...expectedArchivedValues].sort());

    // Notices are never empty shells.
    for (const notice of merge.notices) {
      expect(notice.message.trim().length).toBeGreaterThan(0);
      expect(notice.sectionKey).toBe("plan");
    }
    // Archived answers always carry label + reason.
    for (const answer of newlyArchived) {
      expect(answer.originalLabel.trim().length).toBeGreaterThan(0);
      expect(answer.reason.trim().length).toBeGreaterThan(0);
    }

    // Nothing is ever silently dropped: every non-empty input value survives
    // in active records or archived answers (key renames keep the value).
    expect(collectAllStoredValues(reconciled).sort()).toEqual(inputSnapshot);

    // The input was never mutated (merge-on-read purity).
    expect(collectAllStoredValues(values()).sort()).toEqual(inputSnapshot);
  });
});
