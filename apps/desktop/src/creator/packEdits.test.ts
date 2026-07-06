import { describe, it, expect } from "vitest";
import {
  updateField,
  addOptionalField,
  moveField,
  removeField,
  addGroup,
  addSection,
  maxOrder,
} from "./packEdits";
import type { FormPack } from "../domain/formModel";

// ---------------------------------------------------------------------------
// Minimal fixture
// ---------------------------------------------------------------------------

const MINIMAL_PACK: FormPack = {
  packId: "test-pack",
  packVersion: "1.0.0",
  schemaVersion: 1,
  minAppVersion: "0.0.0",
  migrations: [],
  sections: [
    {
      sectionKey: "personal",
      title: "Personal",
      lede: "",
      multiRecord: false,
      order: 1,
      readinessRule: { requiredKeys: ["full_name"] },
      kitMapping: { entries: [] },
      groups: [
        {
          groupKey: "basics",
          title: "Basics",
          repeatable: false,
          order: 1,
          fields: [
            {
              systemKey: "full_name",
              label: "Full Name",
              type: "text",
              required: true,
              protected: true,
              order: 1,
            },
            {
              systemKey: "nickname",
              label: "Nickname",
              type: "text",
              required: false,
              protected: false,
              order: 2,
            },
          ],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getGroup(pack: FormPack, sectionKey: string, groupKey: string) {
  const section = pack.sections.find((s) => s.sectionKey === sectionKey)!;
  return section.groups.find((g) => g.groupKey === groupKey)!;
}

function getField(pack: FormPack, sectionKey: string, groupKey: string, systemKey: string) {
  const group = getGroup(pack, sectionKey, groupKey);
  return group.fields.find((f) => f.systemKey === systemKey)!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("updateField", () => {
  it("changes a field's label and preserves sibling referential identity", () => {
    const updated = updateField(
      MINIMAL_PACK,
      "personal",
      "basics",
      "nickname",
      (f) => ({ ...f, label: "Preferred Name" }),
    );

    // Changed field has new label.
    const changedField = getField(updated, "personal", "basics", "nickname");
    expect(changedField.label).toBe("Preferred Name");

    // Sibling field is the exact same object reference.
    const originalGroup = getGroup(MINIMAL_PACK, "personal", "basics");
    const updatedGroup = getGroup(updated, "personal", "basics");
    expect(updatedGroup.fields.find((f) => f.systemKey === "full_name")).toBe(
      originalGroup.fields.find((f) => f.systemKey === "full_name"),
    );
  });
});

describe("addOptionalField", () => {
  it("appends a field with order = maxOrder+1, protected: false, non-custom key", () => {
    const group = getGroup(MINIMAL_PACK, "personal", "basics");
    const expectedOrder = maxOrder(group.fields) + 1;

    const updated = addOptionalField(MINIMAL_PACK, "personal", "basics");
    const updatedGroup = getGroup(updated, "personal", "basics");
    const newField = updatedGroup.fields.find(
      (f) => !["full_name", "nickname"].includes(f.systemKey),
    );

    expect(newField).toBeDefined();
    expect(newField!.order).toBe(expectedOrder);
    expect(newField!.protected).toBe(false);
    expect(newField!.required).toBe(false);
    expect(newField!.systemKey.startsWith("custom.")).toBe(false);
  });
});

describe("moveField", () => {
  it("swaps order of adjacent fields and round-trips to identity", () => {
    const group = getGroup(MINIMAL_PACK, "personal", "basics");
    const beforeFullName = group.fields.find((f) => f.systemKey === "full_name")!.order;
    const beforeNickname = group.fields.find((f) => f.systemKey === "nickname")!.order;

    // Move nickname up (swap with full_name).
    const movedUp = moveField(MINIMAL_PACK, "personal", "basics", "nickname", "up");
    const afterUpFullName = getField(movedUp, "personal", "basics", "full_name").order;
    const afterUpNickname = getField(movedUp, "personal", "basics", "nickname").order;

    expect(afterUpNickname).toBe(beforeFullName);
    expect(afterUpFullName).toBe(beforeNickname);

    // Move nickname back down — orders should be restored.
    const movedDown = moveField(movedUp, "personal", "basics", "nickname", "down");
    const afterDownFullName = getField(movedDown, "personal", "basics", "full_name").order;
    const afterDownNickname = getField(movedDown, "personal", "basics", "nickname").order;

    expect(afterDownFullName).toBe(beforeFullName);
    expect(afterDownNickname).toBe(beforeNickname);
  });

  it("returns pack unchanged when already at boundary (move first field up)", () => {
    // full_name has order 1 (lowest), moving it up is a no-op.
    const result = moveField(MINIMAL_PACK, "personal", "basics", "full_name", "up");
    const group = getGroup(result, "personal", "basics");
    const originalGroup = getGroup(MINIMAL_PACK, "personal", "basics");
    // Same fields array since nothing changed.
    expect(group.fields).toEqual(originalGroup.fields);
  });
});

describe("removeField", () => {
  it("throws when attempting to remove a protected field", () => {
    expect(() =>
      removeField(MINIMAL_PACK, "personal", "basics", "full_name"),
    ).toThrow("Cannot remove a protected field");
  });

  it("removes only the target optional field; all others remain", () => {
    const updated = removeField(MINIMAL_PACK, "personal", "basics", "nickname");
    const group = getGroup(updated, "personal", "basics");

    expect(group.fields.find((f) => f.systemKey === "nickname")).toBeUndefined();
    expect(group.fields.find((f) => f.systemKey === "full_name")).toBeDefined();
    expect(group.fields).toHaveLength(1);
  });

  it("returns pack unchanged when field is not found", () => {
    const result = removeField(MINIMAL_PACK, "personal", "basics", "nonexistent");
    // Same sections reference since nothing changed.
    expect(result).toBe(MINIMAL_PACK);
  });

  it("prunes the removed key from the section's kit mapping and readiness rule", () => {
    // A pack where the removable field is also referenced by the kit mapping
    // (and, defensively, the readiness rule). Leaving either reference dangling
    // makes validatePack reject the save with "references unknown field".
    const packWithRefs: FormPack = {
      ...MINIMAL_PACK,
      sections: MINIMAL_PACK.sections.map((s) => ({
        ...s,
        readinessRule: { requiredKeys: ["full_name", "nickname"] },
        kitMapping: { entries: [{ heading: "Basics", fields: ["full_name", "nickname"] }] },
      })),
    };

    const updated = removeField(packWithRefs, "personal", "basics", "nickname");
    const section = updated.sections.find((s) => s.sectionKey === "personal")!;

    expect(section.kitMapping.entries[0]!.fields).toEqual(["full_name"]);
    expect(section.readinessRule.requiredKeys).toEqual(["full_name"]);
  });
});

describe("addGroup", () => {
  it("produces groups with different groupKey values when called twice", () => {
    const once = addGroup(MINIMAL_PACK, "personal");
    const twice = addGroup(once, "personal");

    const section1 = once.sections.find((s) => s.sectionKey === "personal")!;
    const section2 = twice.sections.find((s) => s.sectionKey === "personal")!;

    const keys1 = new Set(section1.groups.map((g) => g.groupKey));
    const keys2 = new Set(section2.groups.map((g) => g.groupKey));

    // The second call added a new key not present in the first result.
    const newKeys = [...keys2].filter((k) => !keys1.has(k));
    expect(newKeys).toHaveLength(1);

    // All keys in the final pack are unique.
    expect(section2.groups.map((g) => g.groupKey).length).toBe(
      new Set(section2.groups.map((g) => g.groupKey)).size,
    );
  });
});

describe("addSection", () => {
  it("produces sections with different sectionKey values when called twice", () => {
    const once = addSection(MINIMAL_PACK);
    const twice = addSection(once);

    const keys1 = new Set(once.sections.map((s) => s.sectionKey));
    const keys2 = new Set(twice.sections.map((s) => s.sectionKey));

    const newKeys = [...keys2].filter((k) => !keys1.has(k));
    expect(newKeys).toHaveLength(1);

    // All keys in the final pack are unique.
    expect(twice.sections.map((s) => s.sectionKey).length).toBe(
      new Set(twice.sections.map((s) => s.sectionKey)).size,
    );
  });

  it("appends section with empty groups, readinessRule, and kitMapping", () => {
    const updated = addSection(MINIMAL_PACK, "My New Section");
    const newSection = updated.sections.find((s) => s.title === "My New Section")!;
    expect(newSection).toBeDefined();
    expect(newSection.groups).toEqual([]);
    expect(newSection.readinessRule).toEqual({ requiredKeys: [] });
    expect(newSection.kitMapping).toEqual({ entries: [] });
  });
});
