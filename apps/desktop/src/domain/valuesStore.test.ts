import { describe, expect, it } from "vitest";
import type { ResolvedSection } from "./formModel";
import { mergePackWithOverlay } from "./packMerge";
import {
  applyKeyRenames,
  applyRecordValues,
  collectAllStoredValues,
  collectRecordValues,
  createSectionRecord,
  createSectionValues,
  reconcileSectionValues,
  upsertSectionRecord,
  valueConformsToField,
  type AttachmentRef,
  type SectionRecord,
} from "./valuesStore";
import {
  makePlanPack,
  makeRecord,
  makeSectionValues,
  makeVaultValues,
  previousFieldsOf,
} from "./testing/fixtures";

/** Resolve the makePlanPack "plan" section the way the loader does. */
function resolvedPlanSection(mutate?: (pack: ReturnType<typeof makePlanPack>) => void): ResolvedSection {
  const pack = makePlanPack();
  mutate?.(pack);
  return mergePackWithOverlay(pack).resolved.sections[0];
}

const PLAN_PREVIOUS_FIELDS = previousFieldsOf(makePlanPack(), "plan");

describe("record helpers — multi-record CRUD", () => {
  it("createSectionRecord copies values and only sets groupKey when given", () => {
    const source = { contactName: "Dana" };
    const grouped = createSectionRecord("c1", 1, source, "contact");
    const plain = createSectionRecord("m1", 1, source);
    source.contactName = "mutated";
    expect(grouped).toEqual({ id: "c1", schemaVersion: 1, groupKey: "contact", values: { contactName: "Dana" } });
    expect(plain.values.contactName).toBe("Dana");
    expect("groupKey" in plain).toBe(false);
  });

  it("upsertSectionRecord appends new records and replaces by id without mutating", () => {
    const empty = createSectionValues("plan");
    const first = createSectionRecord("c1", 1, { contactName: "Dana" }, "contact");
    const second = createSectionRecord("c2", 1, { contactName: "Sam" }, "contact");

    const withFirst = upsertSectionRecord(empty, first);
    const withBoth = upsertSectionRecord(withFirst, second);
    expect(withBoth.records.map((record) => record.id)).toEqual(["c1", "c2"]);

    const edited = createSectionRecord("c1", 1, { contactName: "Dana Reyes" }, "contact");
    const updated = upsertSectionRecord(withBoth, edited);
    expect(updated.records.map((record) => record.values.contactName)).toEqual(["Dana Reyes", "Sam"]);

    // Purity: earlier snapshots are untouched.
    expect(empty.records).toEqual([]);
    expect(withBoth.records[0].values.contactName).toBe("Dana");
  });
});

describe("collect / apply round-trip", () => {
  const fields = [{ systemKey: "provider" }, { systemKey: "notes" }, { systemKey: "contactName" }];

  it("collects trimmed non-empty input restricted to known fields", () => {
    const collected = collectRecordValues(fields, {
      provider: "  1Password  ",
      notes: "   ",
      contactName: undefined,
      injected: "never enters the store",
    });
    expect(collected).toEqual({ provider: "1Password" });
  });

  it("applies a record into a complete form-input map with empty strings for gaps", () => {
    const record = makeRecord({ id: "m1", values: { provider: "1Password" } });
    expect(applyRecordValues(fields, record)).toEqual({ provider: "1Password", notes: "", contactName: "" });
  });

  it("round-trips: collect(apply(record)) reproduces the stored values", () => {
    const record = makeRecord({ id: "m1", values: { provider: "1Password", notes: "Ask Dana" } });
    expect(collectRecordValues(fields, applyRecordValues(fields, record))).toEqual(record.values);
  });
});

describe("valueConformsToField", () => {
  it("checks select values against options and date/email shapes", () => {
    expect(valueConformsToField("a", { type: "select", options: [{ value: "a", label: "A" }] })).toBe(true);
    expect(valueConformsToField("b", { type: "select", options: [{ value: "a", label: "A" }] })).toBe(false);
    expect(valueConformsToField("2026-01-15", { type: "date" })).toBe(true);
    expect(valueConformsToField("next spring", { type: "date" })).toBe(false);
    expect(valueConformsToField("dana@example.com", { type: "email" })).toBe(true);
    expect(valueConformsToField("no-at-sign", { type: "email" })).toBe(false);
    expect(valueConformsToField("anything", { type: "text" })).toBe(true);
    // A path is a free-form string: any value conforms (folder or file path).
    expect(valueConformsToField("C:\\Users\\Dana\\Estate", { type: "path" })).toBe(true);
    expect(valueConformsToField("", { type: "path" })).toBe(true);
    expect(valueConformsToField("saved-record-id", { type: "recordRef" })).toBe(true);
    expect(valueConformsToField("", { type: "recordRef" })).toBe(false);
  });
});

describe("applyKeyRenames", () => {
  it("re-keys values per section and returns the input when there is nothing to do", () => {
    const values = makeVaultValues([
      makeSectionValues("plan", [makeRecord({ id: "m1", values: { old: "kept value" } })]),
      makeSectionValues("devices", [makeRecord({ id: "d1", values: { old: "untouched" } })]),
    ]);
    const renamed = applyKeyRenames(values, [{ sectionKey: "plan", from: "old", to: "new" }]);
    expect(renamed.plan.records[0].values).toEqual({ new: "kept value" });
    expect(renamed.devices).toBe(values.devices);
    expect(values.plan.records[0].values.old).toBe("kept value");
    expect(applyKeyRenames(values, [])).toBe(values);
  });
});

describe("reconcileSectionValues — orphaned field values", () => {
  it("preserves a nonempty unresolved id when a field changes to recordRef", () => {
    const section = resolvedPlanSection((pack) => {
      const provider = pack.sections[0].groups[0].fields[0];
      provider.type = "recordRef";
      provider.options = undefined;
      provider.reference = {
        sectionKey: "devices",
        displayFields: [{ systemKey: "deviceName" }],
        separator: " — ",
      };
    });
    const sectionValues = makeSectionValues("plan", [
      makeRecord({ id: "m1", values: { provider: "missing-device-id" } }),
    ]);

    const result = reconcileSectionValues(sectionValues, section, PLAN_PREVIOUS_FIELDS);

    expect(result.sectionValues.records[0].values.provider).toBe("missing-device-id");
    expect(result.newlyArchived).toEqual([]);
  });

  it("archives an orphaned value with its original label and a reason", () => {
    const section = resolvedPlanSection((pack) => {
      pack.sections[0].groups[0].fields = pack.sections[0].groups[0].fields.filter(
        (field) => field.systemKey !== "notes",
      );
    });
    const sectionValues = makeSectionValues("plan", [
      makeRecord({ id: "m1", values: { provider: "1Password", notes: "Call Dana first" } }),
    ]);

    const { sectionValues: reconciled, newlyArchived } = reconcileSectionValues(
      sectionValues,
      section,
      PLAN_PREVIOUS_FIELDS,
    );

    expect(reconciled.records[0].values).toEqual({ provider: "1Password" });
    expect(newlyArchived).toEqual([
      {
        id: "plan:m1:notes",
        sectionKey: "plan",
        recordId: "m1",
        systemKey: "notes",
        originalLabel: "Notes",
        value: "Call Dana first",
        reason: "This field was removed from the form definition.",
      },
    ]);
    expect(reconciled.archivedAnswers).toEqual(newlyArchived);
    // Input untouched.
    expect(sectionValues.records[0].values.notes).toBe("Call Dana first");
    expect(sectionValues.archivedAnswers).toEqual([]);
  });

  it("falls back to the systemKey as label when no previous definition is known", () => {
    const section = resolvedPlanSection();
    const sectionValues = makeSectionValues("plan", [
      makeRecord({ id: "m1", values: { vanishedKey: "still precious" } }),
    ]);
    const { newlyArchived } = reconcileSectionValues(sectionValues, section);
    expect(newlyArchived[0].originalLabel).toBe("vanishedKey");
    expect(newlyArchived[0].value).toBe("still precious");
  });

  it("keeps a select value whose option vanished but whose type is unchanged (previous-answer territory)", () => {
    const section = resolvedPlanSection((pack) => {
      pack.sections[0].groups[0].fields[0].options = [{ value: "Bitwarden", label: "Bitwarden" }];
    });
    const sectionValues = makeSectionValues("plan", [
      makeRecord({ id: "m1", values: { provider: "LastPass" } }),
    ]);
    const result = reconcileSectionValues(sectionValues, section, PLAN_PREVIOUS_FIELDS);
    expect(result.sectionValues.records[0].values.provider).toBe("LastPass");
    expect(result.newlyArchived).toEqual([]);
  });

  it("deletes the attached file (drops the ref) and archives the id when a file field is removed", () => {
    const sectionWithoutWillPdf = resolvedPlanSection((pack) => {
      pack.sections[0].groups[0].fields = [];
    });
    const sectionValues = makeSectionValues("plan", [
      makeRecord({
        id: "r1",
        values: { willPdf: "att1" },
        attachments: [{ id: "att1", fileName: "will.pdf", sizeBytes: 10 }],
      }),
    ]);

    const { sectionValues: reconciled, newlyArchived } = reconcileSectionValues(
      sectionValues,
      sectionWithoutWillPdf,
    );

    expect(reconciled.records[0].attachments).toEqual([]);
    const archived = newlyArchived.find((a) => a.systemKey === "willPdf");
    expect(archived?.value).toBe("att1");
    expect(archived?.reason).toMatch(/will\.pdf/);
  });
});

describe("reconcileSectionValues — whole orphaned records", () => {
  it("archives every value of records whose group was removed, with label and reason", () => {
    const section = resolvedPlanSection((pack) => {
      pack.sections[0].groups = pack.sections[0].groups.filter((group) => group.groupKey !== "contact");
    });
    const sectionValues = makeSectionValues("plan", [
      makeRecord({ id: "m1", values: { provider: "1Password" } }),
      makeRecord({ id: "c1", groupKey: "contact", values: { contactName: "Dana Reyes", contactEmail: "dana@example.com" } }),
    ]);

    const { sectionValues: reconciled, newlyArchived } = reconcileSectionValues(
      sectionValues,
      section,
      PLAN_PREVIOUS_FIELDS,
    );

    expect(reconciled.records.map((record) => record.id)).toEqual(["m1"]);
    expect(newlyArchived).toHaveLength(2);
    for (const answer of newlyArchived) {
      expect(answer.recordId).toBe("c1");
      expect(answer.reason).toBe('The "contact" group was removed from this section.');
    }
    const byKey = Object.fromEntries(newlyArchived.map((answer) => [answer.systemKey, answer]));
    expect(byKey.contactName).toMatchObject({ originalLabel: "Contact name", value: "Dana Reyes" });
    expect(byKey.contactEmail).toMatchObject({ originalLabel: "Contact email", value: "dana@example.com" });
  });

  it("archives plain records beyond the first when the section stops being multi-record", () => {
    const pack = makePlanPack();
    pack.sections[0].multiRecord = false;
    const section = mergePackWithOverlay(pack).resolved.sections[0];
    const sectionValues = makeSectionValues("plan", [
      makeRecord({ id: "m1", values: { notes: "first" } }),
      makeRecord({ id: "m2", values: { notes: "second" } }),
    ]);
    const { sectionValues: reconciled, newlyArchived } = reconcileSectionValues(
      sectionValues,
      section,
      PLAN_PREVIOUS_FIELDS,
    );
    expect(reconciled.records.map((record) => record.id)).toEqual(["m1"]);
    expect(newlyArchived).toEqual([
      expect.objectContaining({
        recordId: "m2",
        systemKey: "notes",
        originalLabel: "Notes",
        value: "second",
        reason: 'The "Plan" section no longer holds multiple records.',
      }),
    ]);
  });

  it("is idempotent: reconciling an already-reconciled result changes nothing", () => {
    const section = resolvedPlanSection((pack) => {
      pack.sections[0].groups[1].repeatable = false;
    });
    const sectionValues = makeSectionValues("plan", [
      makeRecord({ id: "c1", groupKey: "contact", values: { contactName: "Dana" } }),
      makeRecord({ id: "c2", groupKey: "contact", values: { contactName: "Sam" } }),
    ]);
    const first = reconcileSectionValues(sectionValues, section, PLAN_PREVIOUS_FIELDS);
    expect(first.newlyArchived).toHaveLength(1);

    const second = reconcileSectionValues(first.sectionValues, section, PLAN_PREVIOUS_FIELDS);
    expect(second.newlyArchived).toEqual([]);
    // Untouched input is returned by reference when nothing changed.
    expect(second.sectionValues).toBe(first.sectionValues);
  });

  it("disambiguates archive ids when the same value is archived again under a new record", () => {
    const section = resolvedPlanSection((pack) => {
      pack.sections[0].groups[1].repeatable = false;
    });
    const sectionValues = {
      ...makeSectionValues("plan", [
        makeRecord({ id: "c1", groupKey: "contact", values: { contactName: "Dana" } }),
        makeRecord({ id: "c2", groupKey: "contact", values: { contactName: "Sam" } }),
      ]),
      archivedAnswers: [
        {
          id: "plan:c2:contactName",
          sectionKey: "plan",
          recordId: "c2",
          systemKey: "contactName",
          originalLabel: "Contact name",
          value: "Old Sam",
          reason: "earlier reconcile",
        },
      ],
    };
    const { sectionValues: reconciled, newlyArchived } = reconcileSectionValues(
      sectionValues,
      section,
      PLAN_PREVIOUS_FIELDS,
    );
    expect(newlyArchived[0].id).toBe("plan:c2:contactName:2");
    expect(reconciled.archivedAnswers).toHaveLength(2);
  });
});

describe("attachment-ref placeholder", () => {
  it("records carry typed optional attachment refs (U8 fills in behavior)", () => {
    const ref: AttachmentRef = { id: "att-1", fileName: "will.pdf", sizeBytes: 2048 };
    const record: SectionRecord = {
      id: "m1",
      schemaVersion: 1,
      values: {},
      attachments: [ref],
    };
    expect(record.attachments?.[0]).toEqual({ id: "att-1", fileName: "will.pdf", sizeBytes: 2048 });
    // The field is optional: records without attachments remain valid.
    const bare: SectionRecord = { id: "m2", schemaVersion: 1, values: {} };
    expect(bare.attachments).toBeUndefined();
  });
});

describe("collectAllStoredValues", () => {
  it("gathers every non-empty value across records and archived answers", () => {
    const values = makeVaultValues([
      {
        ...makeSectionValues("plan", [makeRecord({ id: "m1", values: { provider: "1Password", empty: "" } })]),
        archivedAnswers: [
          {
            id: "plan:old:notes",
            sectionKey: "plan",
            recordId: "old",
            systemKey: "notes",
            originalLabel: "Notes",
            value: "Call Dana first",
            reason: "This field was removed from the form definition.",
          },
        ],
      },
    ]);
    expect(collectAllStoredValues(values).sort()).toEqual(["1Password", "Call Dana first"]);
  });
});
