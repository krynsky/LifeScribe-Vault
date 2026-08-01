import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { FormPack, ResolvedSection } from "../domain/formModel";
import { mergePackWithOverlay } from "../domain/packMerge";
import {
  makeField,
  makeGroup,
  makePack,
  makePlanPack,
  makeSection,
  makeSectionValues,
} from "../domain/testing/fixtures";
import type { ArchivedAnswer, SectionValues, VaultValues } from "../domain/valuesStore";
import { RecordList } from "./RecordList";

function resolveSection(pack: FormPack, sectionKey: string): ResolvedSection {
  const { resolved } = mergePackWithOverlay(pack);
  const section = resolved.sections.find((candidate) => candidate.sectionKey === sectionKey);
  if (!section) {
    throw new Error(`no resolved section ${sectionKey}`);
  }
  return section;
}

function makeDevicesPack(): FormPack {
  return makePack({
    sections: [
      makeSection({
        sectionKey: "devices",
        title: "Devices",
        lede: "List every device your family would need to unlock.",
        multiRecord: true,
        groups: [
          makeGroup({
            groupKey: "device",
            title: "Device",
            fields: [
              makeField({
                systemKey: "deviceName",
                label: "Device name",
                required: true,
                protected: true,
                order: 1,
              }),
              makeField({ systemKey: "unlockHint", label: "Unlock hint location", order: 2 }),
            ],
          }),
        ],
        readinessRule: { requiredKeys: ["deviceName"] },
      }),
    ],
  });
}

interface HarnessProps {
  section: ResolvedSection;
  initial?: SectionValues;
  onSave?: (values: SectionValues) => void;
  captureRef?: { current: SectionValues | null };
  validationIssues?: import("../domain/sectionValidation").SectionValidationIssue[];
  allSections?: ResolvedSection[];
  referenceValues?: VaultValues;
  effectiveReferenceValues?: VaultValues;
}

function Harness({
  section,
  initial,
  onSave,
  captureRef,
  validationIssues,
  allSections,
  referenceValues,
  effectiveReferenceValues,
}: HarnessProps) {
  const [values, setValues] = useState<SectionValues>(
    initial ?? makeSectionValues(section.sectionKey),
  );
  return (
    <RecordList
      section={section}
      values={values}
      schemaVersion={1}
      onChange={(next) => {
        setValues(next);
        if (captureRef) {
          captureRef.current = next;
        }
      }}
      onSave={onSave}
      validationIssues={validationIssues}
      recordReferences={
        allSections
          ? {
              sections: allSections,
              savedValues: referenceValues ?? {},
              effectiveValues: effectiveReferenceValues ?? referenceValues ?? {},
            }
          : undefined
      }
    />
  );
}

describe("RecordList", () => {
  it("shows the designed empty state with section lede and add affordance", () => {
    const section = resolveSection(makeDevicesPack(), "devices");
    render(<Harness section={section} />);

    expect(
      screen.getByText("List every device your family would need to unlock."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Device" })).toBeInTheDocument();
  });

  it("adds, duplicates, and deletes records; delete confirm names the record label; deleting the last record restores the empty state", async () => {
    const user = userEvent.setup();
    const section = resolveSection(makeDevicesPack(), "devices");
    const captureRef: { current: SectionValues | null } = { current: null };
    render(<Harness section={section} captureRef={captureRef} />);

    // Add: new record expands inline for editing.
    await user.click(screen.getByRole("button", { name: "Add Device" }));
    await user.type(screen.getByLabelText("Device name"), "Work laptop");
    expect(screen.getByRole("button", { name: "Work laptop" })).toBeInTheDocument();

    // Duplicate: a second row with the same summary label appears.
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(screen.getAllByRole("button", { name: "Work laptop" })).toHaveLength(2);
    expect(captureRef.current?.records).toHaveLength(2);

    // Delete requires confirm and the confirm names the record's label.
    await user.click(screen.getAllByRole("button", { name: "Delete" })[1]);
    expect(screen.getByText(/Delete “Work laptop”\? This cannot be undone\./)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(captureRef.current?.records).toHaveLength(2);

    await user.click(screen.getAllByRole("button", { name: "Delete" })[1]);
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(screen.getAllByRole("button", { name: "Work laptop" })).toHaveLength(1);

    // Deleting the last record shows the empty state again.
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(
      screen.getByText("List every device your family would need to unlock."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Device" })).toBeInTheDocument();
    expect(captureRef.current?.records).toHaveLength(0);
  });

  it("blocks deletion while another record references the source record", async () => {
    const user = userEvent.setup();
    const devices = makeDevicesPack().sections[0]!;
    const backups = makeSection({
      sectionKey: "backups",
      title: "Backups & Storage",
      multiRecord: true,
      groups: [
        makeGroup({
          groupKey: "backup",
          title: "Backup",
          fields: [
            makeField({ systemKey: "backupName", label: "Backup name", order: 1 }),
            makeField({
              systemKey: "backupDevice",
              label: "Device",
              type: "recordRef",
              reference: {
                sectionKey: "devices",
                displayFields: [{ systemKey: "deviceName" }],
                separator: " — ",
              },
              order: 2,
            }),
          ],
        }),
      ],
    });
    const merged = mergePackWithOverlay(makePack({ sections: [devices, backups] }));
    const deviceSection = merged.resolved.sections.find((s) => s.sectionKey === "devices")!;
    const deviceValues = makeSectionValues("devices", [
      { id: "device-1", schemaVersion: 1, values: { deviceName: "Home NAS" } },
    ]);
    const allValues: VaultValues = {
      devices: deviceValues,
      backups: makeSectionValues("backups", [
        {
          id: "backup-1",
          schemaVersion: 1,
          values: { backupName: "Family photos", backupDevice: "device-1" },
        },
      ]),
    };
    const captureRef: { current: SectionValues | null } = { current: null };

    render(
      <Harness
        section={deviceSection}
        allSections={merged.resolved.sections}
        referenceValues={allValues}
        initial={deviceValues}
        captureRef={captureRef}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/cannot be deleted because it is used by/i)).toBeInTheDocument();
    expect(screen.getByText(/Backups & Storage: Family photos/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm delete" })).not.toBeInTheDocument();
    expect(captureRef.current).toBeNull();
  });

  it("blocks deletion while an unsaved working record references the source record", async () => {
    const user = userEvent.setup();
    const devices = makeDevicesPack().sections[0]!;
    const backups = makeSection({
      sectionKey: "backups",
      title: "Backups & Storage",
      multiRecord: true,
      groups: [
        makeGroup({
          groupKey: "backup",
          title: "Backup",
          fields: [
            makeField({ systemKey: "backupName", label: "Backup name", order: 1 }),
            makeField({
              systemKey: "backupDevice",
              label: "Device",
              type: "recordRef",
              reference: {
                sectionKey: "devices",
                displayFields: [{ systemKey: "deviceName" }],
                separator: " — ",
              },
              order: 2,
            }),
          ],
        }),
      ],
    });
    const merged = mergePackWithOverlay(makePack({ sections: [devices, backups] }));
    const deviceSection = merged.resolved.sections.find((s) => s.sectionKey === "devices")!;
    const deviceValues = makeSectionValues("devices", [
      { id: "device-1", schemaVersion: 1, values: { deviceName: "Home NAS" } },
    ]);
    const savedValues: VaultValues = {
      devices: deviceValues,
      backups: makeSectionValues("backups"),
    };
    const effectiveValues: VaultValues = {
      ...savedValues,
      backups: makeSectionValues("backups", [
        {
          id: "backup-draft",
          schemaVersion: 1,
          values: { backupName: "Unsaved photos", backupDevice: "device-1" },
        },
      ]),
    };

    render(
      <Harness
        section={deviceSection}
        allSections={merged.resolved.sections}
        referenceValues={savedValues}
        effectiveReferenceValues={effectiveValues}
        initial={deviceValues}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/cannot be deleted because it is used by/i)).toBeInTheDocument();
    expect(screen.getByText(/Backups & Storage: Unsaved photos/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm delete" })).not.toBeInTheDocument();
  });

  it("labels a record without readiness-field value by its first non-empty value, else Untitled", async () => {
    const user = userEvent.setup();
    const section = resolveSection(makeDevicesPack(), "devices");
    render(<Harness section={section} />);

    await user.click(screen.getByRole("button", { name: "Add Device" }));
    expect(screen.getByRole("button", { name: "Untitled" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Unlock hint location"), "Desk drawer");
    expect(screen.getByRole("button", { name: "Desk drawer" })).toBeInTheDocument();

    // Readiness-rule field value wins over the earlier non-empty value.
    await user.type(screen.getByLabelText("Device name"), "Home PC");
    expect(screen.getByRole("button", { name: "Home PC" })).toBeInTheDocument();
  });

  it("renders a singleton section as one form directly, auto-creating the record shape", async () => {
    const user = userEvent.setup();
    const section = resolveSection(makePlanPack(), "plan");
    const captureRef: { current: SectionValues | null } = { current: null };
    render(<Harness section={section} captureRef={captureRef} />);

    // No record list chrome — the entry form is immediately editable.
    expect(screen.getByLabelText("Provider")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Provider"), "Bitwarden");
    const record = captureRef.current?.records.find((candidate) => candidate.groupKey === undefined);
    expect(record?.values.provider).toBe("Bitwarden");
  });

  it("auto-expands the first multi-record entry with a required issue and marks the rest", () => {
    const section = resolveSection(makeDevicesPack(), "devices");
    const initial: SectionValues = {
      ...makeSectionValues("devices"),
      records: [
        { id: "d1", schemaVersion: 1, values: { deviceName: "Work laptop" } },
        { id: "d2", schemaVersion: 1, values: { deviceName: "" } },
        { id: "d3", schemaVersion: 1, values: { deviceName: "" } },
      ],
    };
    render(
      <Harness
        section={section}
        initial={initial}
        validationIssues={[
          { systemKey: "deviceName", recordId: "d2", message: "Device name is required." },
          { systemKey: "deviceName", recordId: "d3", message: "Device name is required." },
        ]}
      />,
    );

    // The first offender auto-expands, surfacing its inline error…
    expect(screen.getByRole("alert")).toHaveTextContent("Device name is required.");
    // …the healthy record is untouched, and the other collapsed offender (d3)
    // is flagged so its hidden error is not lost.
    expect(screen.getByRole("button", { name: "Work laptop" })).toBeInTheDocument();
    expect(screen.getByText("Required info missing")).toBeInTheDocument();
  });

  it("renders the archived-answers disclosure and deletes an archived answer via onChange", async () => {
    const user = userEvent.setup();
    const section = resolveSection(makePlanPack(), "plan");
    const archived: ArchivedAnswer = {
      id: "plan:r1:oldField",
      sectionKey: "plan",
      recordId: "r1",
      systemKey: "oldField",
      originalLabel: "Old field",
      value: "kept value",
      reason: "This field was removed from the form definition.",
    };
    const initial: SectionValues = {
      ...makeSectionValues("plan"),
      archivedAnswers: [archived],
    };
    const captureRef: { current: SectionValues | null } = { current: null };
    render(<Harness section={section} initial={initial} captureRef={captureRef} />);

    await user.click(screen.getByRole("button", { name: "Archived data (1)" }));
    expect(screen.getByText("Old field")).toBeInTheDocument();
    expect(screen.getByText("kept value")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete permanently" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(captureRef.current?.archivedAnswers).toHaveLength(0);
  });
});

describe("RecordList save forwarding", () => {
  it("forwards onSave through the expanded record form with validation intact", async () => {
    const user = userEvent.setup();
    const section = resolveSection(makeDevicesPack(), "devices");
    const onSave = vi.fn();
    render(<Harness section={section} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Add Device" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Device name is required.");

    await user.type(screen.getByLabelText("Device name"), "Work laptop");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
