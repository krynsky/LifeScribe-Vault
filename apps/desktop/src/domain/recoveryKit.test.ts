/**
 * Recovery Kit derivation (U7): pointer-based, generically derived from kit
 * mappings, with the staleness fingerprint.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { FormPack, PackSection, ResolvedField } from "./formModel";
import { validatePack } from "./packValidation";
import {
  buildRecoveryKit,
  computeKitFingerprint,
  isKitStale,
  type RecoveryKit,
} from "./recoveryKit";
import { buildSnapshot, normalizeSnapshot } from "./snapshot";
import {
  makeField,
  makeGroup,
  makePack,
  makeRecord,
  makeSection,
  makeSectionValues,
  makeVaultValues,
} from "./testing/fixtures";
import type { VaultValues } from "./valuesStore";

const DEFAULT_PACK_PATH = resolve(process.cwd(), "src-tauri/resources/packs/default-pack.json");

function loadShippedPack(): FormPack {
  const result = validatePack(JSON.parse(readFileSync(DEFAULT_PACK_PATH, "utf-8")));
  if (!result.ok) {
    throw new Error("shipped pack failed validation");
  }
  return result.pack;
}

/** Every string value reachable anywhere in a built kit (labels included). */
function allKitStrings(kit: RecoveryKit): string[] {
  return kit.entries.flatMap((entry) => [
    entry.sectionTitle,
    entry.heading,
    ...entry.blocks.flatMap((block) => [
      ...(block.recordLabel ? [block.recordLabel] : []),
      ...block.items.flatMap((item) => [item.label, item.value]),
    ]),
  ]);
}

/**
 * Synthetic test pack: a singleton "plan" section with a conditional field
 * and an UNMAPPED field, plus a multi-record "docs" section.
 */
function makeKitPack(): FormPack {
  return makePack({
    sections: [
      makeSection({
        sectionKey: "plan",
        title: "Password Plan",
        order: 1,
        groups: [
          makeGroup({
            groupKey: "main",
            order: 1,
            fields: [
              makeField({
                systemKey: "provider",
                label: "Provider",
                type: "select",
                protected: true,
                options: [
                  { value: "1Password", label: "1Password" },
                  { value: "Other", label: "Other" },
                ],
                order: 1,
              }),
              makeField({
                systemKey: "otherProviderName",
                label: "Other provider name",
                visibleWhen: { field: "provider", equals: "Other" },
                order: 2,
              }),
              makeField({ systemKey: "accessNotes", label: "Access notes", order: 3 }),
              // Deliberately NOT in the kit mapping.
              makeField({ systemKey: "privateNotes", label: "Private notes", order: 4 }),
            ],
          }),
        ],
        readinessRule: { requiredKeys: ["provider"] },
        kitMapping: {
          entries: [
            {
              heading: "Password manager",
              fields: ["provider", "otherProviderName", "accessNotes"],
            },
          ],
        },
      }),
      makeSection({
        sectionKey: "docs",
        title: "Documents",
        multiRecord: true,
        order: 2,
        groups: [
          makeGroup({
            groupKey: "doc",
            order: 1,
            fields: [
              makeField({ systemKey: "docTitle", label: "Document", protected: true, order: 1 }),
              makeField({ systemKey: "docLocation", label: "Where it lives", order: 2 }),
            ],
          }),
        ],
        readinessRule: { requiredKeys: ["docTitle"] },
        kitMapping: {
          entries: [{ heading: "Documents and locations", fields: ["docTitle", "docLocation"] }],
        },
      }),
    ],
  });
}

function kitPackValues(): VaultValues {
  return makeVaultValues([
    makeSectionValues("plan", [
      makeRecord({
        id: "plan-1",
        values: {
          provider: "1Password",
          otherProviderName: "Hidden Corp", // conditional NOT satisfied
          accessNotes: "Emergency kit in the fire safe",
          privateNotes: "do not surface me", // unmapped
        },
      }),
    ]),
    makeSectionValues("docs", [
      makeRecord({ id: "doc-1", values: { docTitle: "Will", docLocation: "Desk drawer" } }),
      makeRecord({ id: "doc-2", values: { docTitle: "Deed", docLocation: "Bank box" } }),
    ]),
  ]);
}

describe("buildRecoveryKit", () => {
  it("derives entries per section in order, per its kit mapping", () => {
    const kit = buildRecoveryKit(makeKitPack().sections, kitPackValues());
    expect(kit.entries.map((entry) => entry.heading)).toEqual([
      "Password manager",
      "Documents and locations",
    ]);
    const plan = kit.entries[0];
    expect(plan.sectionTitle).toBe("Password Plan");
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].items).toEqual([
      { systemKey: "provider", label: "Provider", value: "1Password" },
      { systemKey: "accessNotes", label: "Access notes", value: "Emergency kit in the fire safe" },
    ]);
  });

  it("carries the owner name as the generated-at header concept", () => {
    const kit = buildRecoveryKit(makeKitPack().sections, kitPackValues(), {}, {
      ownerName: "Dana",
    });
    expect(kit.ownerName).toBe("Dana");
    // No profile (or a blank owner) -> no owner header.
    expect(buildRecoveryKit(makeKitPack().sections, kitPackValues()).ownerName).toBeNull();
    expect(
      buildRecoveryKit(makeKitPack().sections, kitPackValues(), {}, { ownerName: "  " })
        .ownerName,
    ).toBeNull();
  });

  it("excludes hidden-conditional values and includes them when the condition holds", () => {
    const pack = makeKitPack();
    const hidden = buildRecoveryKit(pack.sections, kitPackValues());
    expect(allKitStrings(hidden)).not.toContain("Hidden Corp");

    const values = kitPackValues();
    values.plan.records[0].values.provider = "Other";
    const shown = buildRecoveryKit(pack.sections, values);
    expect(shown.entries[0].blocks[0].items.map((item) => item.systemKey)).toContain(
      "otherProviderName",
    );
    expect(allKitStrings(shown)).toContain("Hidden Corp");
  });

  it("excludes overlay-hidden fields even when populated and kit-mapped", () => {
    const pack = makeKitPack();
    // Resolve-shape the plan section with `accessNotes` hidden by the user's
    // overlay (ResolvedField.hidden) — its populated value must not appear.
    const sections = pack.sections.map((section) =>
      section.sectionKey === "plan"
        ? {
            ...section,
            groups: section.groups.map((group) => ({
              ...group,
              fields: group.fields.map(
                (field): ResolvedField => ({
                  ...field,
                  source: "pack",
                  hidden: field.systemKey === "accessNotes",
                }),
              ),
            })),
          }
        : section,
    );
    const kit = buildRecoveryKit(sections, kitPackValues());
    const strings = allKitStrings(kit);
    expect(strings).not.toContain("Emergency kit in the fire safe");
    expect(strings).toContain("1Password"); // non-hidden mapped value remains
  });

  it("never lets a field outside the kit mapping reach the output", () => {
    const kit = buildRecoveryKit(makeKitPack().sections, kitPackValues());
    const strings = allKitStrings(kit);
    expect(strings).not.toContain("do not surface me");
    expect(strings).not.toContain("Private notes");
    expect(
      kit.entries.flatMap((entry) => entry.blocks.flatMap((block) => block.items)),
    ).not.toContainEqual(expect.objectContaining({ systemKey: "privateNotes" }));
  });

  it("omits empty sections, skips empty values, and omits N/A sections entirely", () => {
    const pack = makeKitPack();
    const empty = buildRecoveryKit(pack.sections, {});
    expect(empty.entries).toEqual([]);

    // docs present but with only empty values -> omitted.
    const blankValues = makeVaultValues([
      makeSectionValues("docs", [makeRecord({ id: "doc-1", values: { docTitle: "  " } })]),
    ]);
    expect(buildRecoveryKit(pack.sections, blankValues).entries).toEqual([]);

    // populated but N/A -> omitted entirely.
    const kit = buildRecoveryKit(pack.sections, kitPackValues(), {
      docs: { na: true },
    });
    expect(kit.entries.map((entry) => entry.sectionKey)).toEqual(["plan"]);
  });

  it("emits one labeled block per record for multi-record sections", () => {
    const kit = buildRecoveryKit(makeKitPack().sections, kitPackValues());
    const docs = kit.entries.find((entry) => entry.sectionKey === "docs");
    expect(docs?.blocks).toHaveLength(2);
    expect(docs?.blocks.map((block) => block.recordLabel)).toEqual(["Will", "Deed"]);
    expect(docs?.blocks[1].items).toEqual([
      { systemKey: "docTitle", label: "Document", value: "Deed" },
      { systemKey: "docLocation", label: "Where it lives", value: "Bank box" },
    ]);
    // Singleton-section blocks carry no record label.
    const plan = kit.entries.find((entry) => entry.sectionKey === "plan");
    expect(plan?.blocks[0].recordLabel).toBeNull();
  });

  it("shows the fileName for a file field in the Recovery Kit", () => {
    const pack = makePack({
      sections: [
        makeSection({
          sectionKey: "docs",
          title: "Documents",
          order: 1,
          groups: [
            makeGroup({
              groupKey: "main",
              fields: [
                makeField({ systemKey: "willPdf", label: "Will", type: "file", order: 1 }),
              ],
            }),
          ],
          kitMapping: { entries: [{ heading: "Files", fields: ["willPdf"] }] },
        }),
      ],
    });
    const values = makeVaultValues([
      makeSectionValues("docs", [
        makeRecord({
          id: "r1",
          values: { willPdf: "att1" },
          attachments: [{ id: "att1", fileName: "will.pdf", sizeBytes: 10 }],
        }),
      ]),
    ]);

    const kit = buildRecoveryKit(pack.sections, values);
    const strings = allKitStrings(kit);
    expect(strings.some((s) => s.includes("will.pdf"))).toBe(true);
    expect(strings.some((s) => s === "att1")).toBe(false);
  });

  it("never includes archived answers", () => {
    const values = kitPackValues();
    values.docs.archivedAnswers = [
      {
        id: "docs:doc-9:docLocation",
        sectionKey: "docs",
        recordId: "doc-9",
        systemKey: "docLocation",
        originalLabel: "Where it lives",
        value: "Archived attic box",
        reason: "This field was removed from the form definition.",
      },
    ];
    const kit = buildRecoveryKit(makeKitPack().sections, values);
    expect(allKitStrings(kit)).not.toContain("Archived attic box");
  });
});

describe("computeKitFingerprint / isKitStale", () => {
  it("is stable across object key order", () => {
    const pack = makeKitPack();
    const a = makeVaultValues([
      makeSectionValues("plan", [
        makeRecord({
          id: "plan-1",
          values: { provider: "1Password", accessNotes: "Fire safe" },
        }),
      ]),
    ]);
    const b = makeVaultValues([
      makeSectionValues("plan", [
        makeRecord({
          id: "plan-1",
          values: { accessNotes: "Fire safe", provider: "1Password" },
        }),
      ]),
    ]);
    expect(computeKitFingerprint(pack.sections, a)).toBe(computeKitFingerprint(pack.sections, b));
  });

  it("changes when a contributing value changes", () => {
    const pack = makeKitPack();
    const before = computeKitFingerprint(pack.sections, kitPackValues());
    const values = kitPackValues();
    values.docs.records[0].values.docLocation = "Moved to the safe";
    expect(computeKitFingerprint(pack.sections, values)).not.toBe(before);
  });

  it("is unchanged when a non-contributing value changes (unmapped or hidden-conditional)", () => {
    const pack = makeKitPack();
    const before = computeKitFingerprint(pack.sections, kitPackValues());

    const unmapped = kitPackValues();
    unmapped.plan.records[0].values.privateNotes = "still private, now different";
    expect(computeKitFingerprint(pack.sections, unmapped)).toBe(before);

    const hiddenConditional = kitPackValues();
    hiddenConditional.plan.records[0].values.otherProviderName = "Still Hidden Corp";
    expect(computeKitFingerprint(pack.sections, hiddenConditional)).toBe(before);
  });

  it("changes when a section is marked N/A (its values stop contributing)", () => {
    const pack = makeKitPack();
    const before = computeKitFingerprint(pack.sections, kitPackValues());
    expect(
      computeKitFingerprint(pack.sections, kitPackValues(), { docs: { na: true } }),
    ).not.toBe(before);
  });

  it("isKitStale: stale only when a saved Kit exists and its fingerprint differs", () => {
    const pack = makeKitPack();
    const saved = computeKitFingerprint(pack.sections, kitPackValues());
    const meta = { lastGeneratedAt: "2026-06-11T10:00:00Z", fingerprint: saved };

    // Never saved -> not stale (it is "not saved yet").
    expect(isKitStale(saved, null)).toBe(false);
    // Saved and unchanged -> fresh.
    expect(isKitStale(saved, meta)).toBe(false);

    // Editing a contributing field -> stale.
    const edited = kitPackValues();
    edited.docs.records[0].values.docLocation = "Moved";
    const editedFingerprint = computeKitFingerprint(pack.sections, edited);
    expect(isKitStale(editedFingerprint, meta)).toBe(true);

    // Regenerating (Save Kit commits the new fingerprint) clears staleness.
    const regenerated = { lastGeneratedAt: "2026-06-11T11:00:00Z", fingerprint: editedFingerprint };
    expect(isKitStale(editedFingerprint, regenerated)).toBe(false);

    // Editing a NON-contributing field never flags stale.
    const unmapped = kitPackValues();
    unmapped.plan.records[0].values.privateNotes = "changed, but private";
    expect(isKitStale(computeKitFingerprint(pack.sections, unmapped), meta)).toBe(false);
  });
});

describe("kitMeta snapshot round-trip (additive)", () => {
  it("normalize/build preserves kitMeta alongside unknown top-level fields", () => {
    const raw = {
      snapshotFormat: 1,
      schemaVersion: 1,
      profile: { ownerName: "Dana", reviewCadenceMonths: 12 },
      values: {},
      sectionMeta: {},
      kitMeta: { lastGeneratedAt: "2026-06-11T10:00:00Z", fingerprint: "0a1b2c3d" },
      futureField: { kept: true },
    };
    const parsed = normalizeSnapshot(raw);
    expect(parsed.kitMeta).toEqual({
      lastGeneratedAt: "2026-06-11T10:00:00Z",
      fingerprint: "0a1b2c3d",
    });
    const rebuilt = buildSnapshot(parsed) as Record<string, unknown>;
    expect(rebuilt.kitMeta).toEqual(raw.kitMeta);
    expect(rebuilt.futureField).toEqual({ kept: true });

    // Older snapshots without kitMeta (and malformed shapes) normalize to null
    // and are not re-emitted.
    const withoutKit = { ...raw } as Record<string, unknown>;
    delete withoutKit.kitMeta;
    expect(normalizeSnapshot(withoutKit).kitMeta).toBeNull();
    expect(
      normalizeSnapshot({ ...raw, kitMeta: { lastGeneratedAt: 5 } }).kitMeta,
    ).toBeNull();
    expect("kitMeta" in (buildSnapshot(normalizeSnapshot(withoutKit)) as object)).toBe(false);
  });
});

describe("Recovery Kit and the permanent credential fields", () => {
  it("names an attached document but emits neither the master password nor the device PIN", () => {
    const pack = loadShippedPack();
    const values = makeVaultValues([
      makeSectionValues("password-manager", [
        makeRecord({
          id: "pm-1",
          values: {
            passwordManagerProvider: "1Password",
            passwordManagerMasterPassword: "hunter2-correct-horse",
          },
        }),
      ]),
      makeSectionValues("devices", [
        makeRecord({
          id: "dev-1",
          values: {
            deviceName: "Mom's iPhone",
            devicePin: "480215",
          },
        }),
      ]),
      makeSectionValues("documents", [
        makeRecord({
          id: "doc-1",
          values: {
            documentTitle: "Last will",
            documentDigitalLocation: "D:/Estate/will.pdf",
            documentDigitalFile: "att-1",
          },
          attachments: [{ id: "att-1", fileName: "last-will-signed.pdf", sizeBytes: 2048 }],
        }),
      ]),
    ]);

    const kit = buildRecoveryKit(pack.sections, values);
    const strings = allKitStrings(kit);

    // R16: the attachment reaches the Kit as its file NAME (a pointer).
    expect(strings).toContain("last-will-signed.pdf");
    expect(strings).toContain("D:/Estate/will.pdf");

    // R17: live credentials never reach the printed page.
    expect(strings).not.toContain("hunter2-correct-horse");
    expect(strings).not.toContain("480215");
    const emittedKeys = kit.entries.flatMap((entry) =>
      entry.blocks.flatMap((block) => block.items.map((item) => item.systemKey)),
    );
    expect(emittedKeys).not.toContain("passwordManagerMasterPassword");
    expect(emittedKeys).not.toContain("devicePin");
  });
});

describe("Recovery Kit from the shipped default pack", () => {
  function shippedValues(): VaultValues {
    return makeVaultValues([
      makeSectionValues("digital-executors", [
        makeRecord({
          id: "exec-1",
          groupKey: "executor",
          values: {
            executorName: "Dana Estate",
            executorRole: "primary",
            executorPhoneNumber: "555-0100",
          },
        }),
        makeRecord({
          id: "exec-2",
          groupKey: "executor",
          values: {
            executorName: "Riley Backup",
            executorRole: "backup",
            executorStepIn: "Step in if Dana is unreachable for a week",
          },
        }),
      ]),
      makeSectionValues("password-manager", [
        makeRecord({
          id: "pm-1",
          values: {
            passwordManagerProvider: "1Password",
            // Conditional (provider != Other): must NOT reach the Kit.
            passwordManagerOtherProvider: "ShadowPass",
            passwordManagerRecoveryLocation: "Emergency Kit printout in the fire safe",
          },
        }),
      ]),
      makeSectionValues("backups", [
        makeRecord({
          id: "backup-1",
          values: { backupLocation: "External drive in the desk", backupEncrypted: "yes" },
        }),
      ]),
    ]);
  }

  it("includes executors, the password manager plan, and each populated section per its mapping", () => {
    const pack = loadShippedPack();
    const kit = buildRecoveryKit(pack.sections, shippedValues());

    expect(kit.entries.map((entry) => entry.heading)).toEqual([
      "Who to contact first",
      "Password manager emergency access",
      "Backups and storage",
    ]);

    // Executors: one labeled block per repeatable-group record.
    const executors = kit.entries[0];
    expect(executors.blocks.map((block) => block.recordLabel)).toEqual([
      "Dana Estate",
      "Riley Backup",
    ]);
    // executorStepIn is conditional on role=backup: present only there.
    expect(
      executors.blocks[0].items.map((item) => item.systemKey),
    ).not.toContain("executorStepIn");
    expect(executors.blocks[1].items.map((item) => item.systemKey)).toContain(
      "executorStepIn",
    );

    // Hidden conditional excluded; mapped values present.
    const strings = allKitStrings(kit);
    expect(strings).not.toContain("ShadowPass");
    expect(strings).toContain("Emergency Kit printout in the fire safe");
    expect(strings).toContain("External drive in the desk");

    // Unpopulated sections are simply absent.
    expect(kit.entries.map((entry) => entry.sectionKey)).not.toContain("devices");
  });

  it("integration: a creator-added section with a kit mapping flows through with no code change", () => {
    const pack = loadShippedPack();
    const syntheticSection: PackSection = makeSection({
      sectionKey: "pet-care",
      title: "Pet Care",
      multiRecord: true,
      order: 99,
      groups: [
        makeGroup({
          groupKey: "pet",
          order: 1,
          fields: [
            makeField({ systemKey: "petName", label: "Pet", protected: true, order: 1 }),
            makeField({ systemKey: "petVet", label: "Vet contact", order: 2 }),
          ],
        }),
      ],
      readinessRule: { requiredKeys: ["petName"] },
      kitMapping: { entries: [{ heading: "Who feeds the pets", fields: ["petName", "petVet"] }] },
    });
    const sections = [...pack.sections, syntheticSection];

    const values = shippedValues();
    values["pet-care"] = makeSectionValues("pet-care", [
      makeRecord({ id: "pet-1", values: { petName: "Biscuit", petVet: "Dr. Lee, 555-0199" } }),
    ]);

    const kit = buildRecoveryKit(sections, values);
    const petEntry = kit.entries.find((entry) => entry.sectionKey === "pet-care");
    expect(petEntry?.heading).toBe("Who feeds the pets");
    expect(petEntry?.blocks[0].recordLabel).toBe("Biscuit");
    expect(petEntry?.blocks[0].items).toContainEqual({
      systemKey: "petVet",
      label: "Vet contact",
      value: "Dr. Lee, 555-0199",
    });
  });
});
