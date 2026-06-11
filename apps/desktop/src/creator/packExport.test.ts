/**
 * packExport tests (U10).
 *
 * Covers the creator-specific validation layer that sits on top of validatePack
 * and validatePackUpgrade. All plan test scenarios for export:
 *
 * - Happy path: add field → export validates and round-trips through the loader.
 * - Error path: attempt to delete a protected field → blocked.
 * - Error path: retype a protected field → blocked.
 * - Error path: rename a protected field without a migration → blocked.
 * - Error path: custom.* key in a default pack → blocked.
 * - Edge case: exported JSON contains zero record values (structural assertion).
 * - Error path: cardinality reduction without a migration → blocked.
 * - Error path: field retype without a migration → blocked (strict mode).
 */

import { describe, expect, it } from "vitest";
import type { FieldDefinition, FieldGroup, FormPack, PackSection } from "../domain/formModel";
import { validatePack } from "../domain/packValidation";
import { bumpPackVersion, exportPack } from "./packExport";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeField(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    systemKey: "someField",
    label: "Some Field",
    type: "text",
    required: true,
    protected: false,
    order: 1,
    ...overrides,
  };
}

function makeGroup(fields: FieldDefinition[], overrides: Partial<FieldGroup> = {}): FieldGroup {
  return {
    groupKey: "main",
    title: "Main",
    repeatable: false,
    order: 1,
    fields,
    ...overrides,
  };
}

function makeSection(groups: FieldGroup[], key = "section-a"): PackSection {
  const requiredKeys = groups
    .flatMap((g) => g.fields)
    .filter((f) => f.protected)
    .map((f) => f.systemKey);
  return {
    sectionKey: key,
    title: `Section ${key}`,
    lede: "",
    multiRecord: false,
    order: 1,
    groups,
    readinessRule: { requiredKeys },
    kitMapping: { entries: [] },
  };
}

function makePack(sections: PackSection[], overrides: Partial<FormPack> = {}): FormPack {
  return {
    packId: "test-pack",
    packVersion: "1.0.0",
    schemaVersion: 1,
    minAppVersion: "0.2.0",
    sections,
    migrations: [],
    ...overrides,
  };
}

/** A minimal pack with one protected field. */
function baselinePack(): FormPack {
  return makePack([
    makeSection([
      makeGroup([
        makeField({ systemKey: "protectedKey", label: "Protected", protected: true, required: true }),
        makeField({ systemKey: "normalKey", label: "Normal", protected: false }),
      ]),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// bumpPackVersion
// ---------------------------------------------------------------------------

describe("bumpPackVersion", () => {
  it("increments the minor component and resets patch", () => {
    expect(bumpPackVersion("1.0.0")).toBe("1.1.0");
    expect(bumpPackVersion("2.3.7")).toBe("2.4.0");
    expect(bumpPackVersion("0.9.99")).toBe("0.10.0");
  });

  it("returns the input unchanged for non-semver strings", () => {
    expect(bumpPackVersion("dev")).toBe("dev");
    expect(bumpPackVersion("1.0")).toBe("1.0");
  });
});

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe("exportPack — happy paths", () => {
  it("exports a structurally valid pack with no changes from previous", () => {
    const pack = baselinePack();
    const result = exportPack(pack, pack);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("bumps the minor packVersion on export", () => {
    const pack = baselinePack();
    const result = exportPack(pack, pack);
    expect(result.ok).toBe(true);
    const exported = JSON.parse(result.json) as { packVersion: string };
    expect(exported.packVersion).toBe("1.1.0");
  });

  it("exported pack validates through validatePack", () => {
    const pack = baselinePack();
    const result = exportPack(pack, pack);
    expect(result.ok).toBe(true);
    const validation = validatePack(JSON.parse(result.json));
    expect(validation.ok).toBe(true);
  });

  it("adding a non-protected field is allowed without a migration", () => {
    const previous = baselinePack();
    const next = makePack([
      makeSection([
        makeGroup([
          makeField({ systemKey: "protectedKey", label: "Protected", protected: true, required: true }),
          makeField({ systemKey: "normalKey", label: "Normal" }),
          makeField({ systemKey: "newField", label: "New Field", order: 3 }),
        ]),
      ]),
    ]);
    const result = exportPack(next, previous);
    expect(result.ok).toBe(true);
  });

  it("exported JSON contains no value slots (structure-only assertion)", () => {
    const pack = baselinePack();
    const result = exportPack(pack, pack);
    expect(result.ok).toBe(true);
    // Inspect all leaf string values — none should look like user data.
    // The pack has no "values" or "records" keys by construction.
    const json = result.json;
    expect(json).not.toContain('"values"');
    expect(json).not.toContain('"records"');
    expect(json).not.toContain('"archivedAnswers"');
  });

  it("schemaVersion bump (new migration step) is allowed", () => {
    const previous = baselinePack();
    const next: FormPack = {
      ...baselinePack(),
      schemaVersion: 2,
      migrations: [
        {
          fromVersion: 1,
          operations: [
            {
              op: "renameField",
              sectionKey: "section-a",
              fromKey: "normalKey",
              toKey: "renamedKey",
            },
          ],
        },
      ],
      sections: [
        makeSection([
          makeGroup([
            makeField({ systemKey: "protectedKey", label: "Protected", protected: true, required: true }),
            makeField({ systemKey: "renamedKey", label: "Renamed", order: 2 }),
          ]),
        ]),
      ],
    };
    const result = exportPack(next, previous);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error paths — protected field violations
// ---------------------------------------------------------------------------

describe("exportPack — protected field violations", () => {
  it("blocks deletion of a protected field", () => {
    const previous = baselinePack();
    const next = makePack([
      makeSection([
        makeGroup([
          // protectedKey removed
          makeField({ systemKey: "normalKey", label: "Normal" }),
        ]),
      ]),
    ]);
    const result = exportPack(next, previous);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("protectedKey"))).toBe(true);
  });

  it("blocks retyping a protected field", () => {
    const previous = baselinePack();
    const next = makePack([
      makeSection([
        makeGroup([
          makeField({
            systemKey: "protectedKey",
            label: "Protected",
            protected: true,
            required: true,
            type: "textarea", // changed from "text"
          }),
          makeField({ systemKey: "normalKey", label: "Normal" }),
        ]),
      ]),
    ]);
    const result = exportPack(next, previous);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("protectedKey"))).toBe(true);
  });

  it("blocks renaming a protected field without an authored migration", () => {
    const previous = baselinePack();
    const next = makePack([
      makeSection([
        makeGroup([
          makeField({
            systemKey: "protectedKeyRenamed",
            label: "Protected",
            protected: true,
            required: true,
          }),
          makeField({ systemKey: "normalKey", label: "Normal" }),
        ]),
      ]),
    ]);
    const result = exportPack(next, previous);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("protectedKey"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error paths — strict-mode warnings become errors
// ---------------------------------------------------------------------------

describe("exportPack — strict-mode (warnings → errors)", () => {
  it("blocks removing a non-protected field without a migration", () => {
    const previous = baselinePack();
    const next = makePack([
      makeSection([
        makeGroup([
          makeField({ systemKey: "protectedKey", label: "Protected", protected: true, required: true }),
          // normalKey removed without a migration
        ]),
      ]),
    ]);
    const result = exportPack(next, previous);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("normalKey"))).toBe(true);
  });

  it("blocks retyping a non-protected field without a migration", () => {
    const previous = baselinePack();
    const next = makePack([
      makeSection([
        makeGroup([
          makeField({ systemKey: "protectedKey", label: "Protected", protected: true, required: true }),
          makeField({ systemKey: "normalKey", label: "Normal", type: "textarea" }), // changed from "text"
        ]),
      ]),
    ]);
    const result = exportPack(next, previous);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("normalKey"))).toBe(true);
  });

  it("blocks cardinality reduction without a migration", () => {
    const previousPack = makePack([
      makeSection([
        makeGroup(
          [makeField({ systemKey: "protectedKey", label: "P", protected: true, required: true })],
          { groupKey: "main", title: "Main", repeatable: true, order: 1 },
        ),
      ]),
    ]);
    const nextPack = makePack([
      makeSection([
        makeGroup(
          [makeField({ systemKey: "protectedKey", label: "P", protected: true, required: true })],
          { groupKey: "main", title: "Main", repeatable: false, order: 1 }, // reduced
        ),
      ]),
    ]);
    const result = exportPack(nextPack, previousPack);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("no longer repeatable"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error path — custom.* namespace
// ---------------------------------------------------------------------------

describe("exportPack — custom.* namespace", () => {
  it("blocks export when a field uses the custom.* namespace", () => {
    const pack = makePack([
      makeSection([
        makeGroup([
          makeField({ systemKey: "protectedKey", label: "P", protected: true, required: true }),
          makeField({ systemKey: "custom.section-a.myField", label: "Custom" }),
        ]),
      ]),
    ]);
    const result = exportPack(pack, pack);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes("custom"))).toBe(true);
  });
});
