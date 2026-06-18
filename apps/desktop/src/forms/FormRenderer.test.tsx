import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { FieldDefinition, FormPack, PackSection, ResolvedSection, UserOverlay } from "../domain/formModel";
import { mergePackWithOverlay } from "../domain/packMerge";
import {
  makeField,
  makeGroup,
  makePack,
  makePlanPack,
  makeRecord,
  makeSection,
  makeSectionValues,
  makeVaultValues,
} from "../domain/testing/fixtures";
import type { SectionValues, VaultValues } from "../domain/valuesStore";
import { FormRenderer } from "./FormRenderer";

function resolveSection(
  pack: FormPack,
  sectionKey: string,
  overlay?: UserOverlay,
  values?: VaultValues,
): ResolvedSection {
  const { resolved } = mergePackWithOverlay(pack, overlay, values);
  const section = resolved.sections.find((candidate) => candidate.sectionKey === sectionKey);
  if (!section) {
    throw new Error(`no resolved section ${sectionKey}`);
  }
  return section;
}

interface HarnessProps {
  section: ResolvedSection;
  initial?: SectionValues;
  onSave?: (values: SectionValues) => void;
  captureRef?: { current: SectionValues | null };
}

function Harness({ section, initial, onSave, captureRef }: HarnessProps) {
  const [values, setValues] = useState<SectionValues>(
    initial ?? makeSectionValues(section.sectionKey),
  );
  return (
    <FormRenderer
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
    />
  );
}

function makeSixTypesPack(): FormPack {
  return makePack({
    sections: [
      makeSection({
        sectionKey: "profile",
        title: "Profile",
        groups: [
          makeGroup({
            groupKey: "identity",
            title: "Identity",
            order: 1,
            fields: [
              makeField({ systemKey: "fullName", label: "Full name", type: "text", order: 1 }),
              makeField({ systemKey: "bio", label: "Bio", type: "textarea", order: 2 }),
              makeField({ systemKey: "birthDate", label: "Birth date", type: "date", order: 3 }),
            ],
          }),
          makeGroup({
            groupKey: "reach",
            title: "How to reach them",
            order: 2,
            fields: [
              makeField({
                systemKey: "role",
                label: "Role",
                type: "select",
                options: [
                  { value: "primary", label: "Primary" },
                  { value: "backup", label: "Backup" },
                ],
                order: 1,
              }),
              makeField({ systemKey: "email", label: "Email", type: "email", order: 2 }),
              makeField({ systemKey: "phone", label: "Phone", type: "phone", order: 3 }),
            ],
          }),
        ],
      }),
    ],
  });
}

describe("FormRenderer", () => {
  it("renders two groups with all six field types and round-trips values through onChange", async () => {
    const user = userEvent.setup();
    const section = resolveSection(makeSixTypesPack(), "profile");
    const captureRef: { current: SectionValues | null } = { current: null };
    render(<Harness section={section} captureRef={captureRef} />);

    expect(screen.getByText("Identity")).toBeInTheDocument();
    expect(screen.getByText("How to reach them")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Full name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Bio"), "Trusted person");
    fireEvent.change(screen.getByLabelText("Birth date"), { target: { value: "1990-12-10" } });
    await user.selectOptions(screen.getByLabelText("Role"), "primary");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Phone"), "555-0100");

    // Controlled round-trip: the inputs display what the store holds.
    expect(screen.getByLabelText("Full name")).toHaveValue("Ada Lovelace");
    expect(screen.getByLabelText("Bio")).toHaveValue("Trusted person");
    expect(screen.getByLabelText("Birth date")).toHaveValue("1990-12-10");
    expect(screen.getByLabelText("Role")).toHaveValue("primary");
    expect(screen.getByLabelText("Email")).toHaveValue("ada@example.com");
    expect(screen.getByLabelText("Phone")).toHaveValue("555-0100");

    const record = captureRef.current?.records.find((candidate) => candidate.groupKey === undefined);
    expect(record?.values).toEqual({
      fullName: "Ada Lovelace",
      bio: "Trusted person",
      birthDate: "1990-12-10",
      role: "primary",
      email: "ada@example.com",
      phone: "555-0100",
    });
  });

  it("reveals the conditional field on Other, hides it on switch-away, and restores the typed value", async () => {
    const user = userEvent.setup();
    const section = resolveSection(makePlanPack(), "plan");
    const captureRef: { current: SectionValues | null } = { current: null };
    render(<Harness section={section} captureRef={captureRef} />);

    expect(screen.queryByLabelText("Other provider")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Provider"), "Other");
    await user.type(screen.getByLabelText("Other provider"), "Acme Keys");

    await user.selectOptions(screen.getByLabelText("Provider"), "1Password");
    expect(screen.queryByLabelText("Other provider")).not.toBeInTheDocument();
    // Hidden-but-populated value is retained in the record, never cleared.
    const record = captureRef.current?.records.find((candidate) => candidate.groupKey === undefined);
    expect(record?.values.otherProvider).toBe("Acme Keys");

    await user.selectOptions(screen.getByLabelText("Provider"), "Other");
    expect(screen.getByLabelText("Other provider")).toHaveValue("Acme Keys");
  });

  it("blocks save with an inline message for a required visible field", async () => {
    const user = userEvent.setup();
    const section = resolveSection(makePlanPack(), "plan");
    const onSave = vi.fn();
    render(<Harness section={section} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Provider is required.");

    await user.selectOptions(screen.getByLabelText("Provider"), "Bitwarden");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("does not block save on a required field hidden by an unsatisfied condition", async () => {
    const user = userEvent.setup();
    const pack = makePack({
      sections: [
        makeSection({
          sectionKey: "setup",
          groups: [
            makeGroup({
              groupKey: "main",
              fields: [
                makeField({
                  systemKey: "mode",
                  label: "Mode",
                  type: "select",
                  options: [
                    { value: "simple", label: "Simple" },
                    { value: "advanced", label: "Advanced" },
                  ],
                  order: 1,
                }),
                makeField({
                  systemKey: "detail",
                  label: "Detail",
                  required: true,
                  visibleWhen: { field: "mode", equals: "advanced" },
                  order: 2,
                }),
              ],
            }),
          ],
        }),
      ],
    });
    const section = resolveSection(pack, "setup");
    const onSave = vi.fn();
    render(<Harness section={section} onSave={onSave} />);

    // Condition unsatisfied -> required+hidden validates as not-required.
    expect(screen.queryByLabelText("Detail")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);

    // Once visible, the same field blocks save again.
    await user.selectOptions(screen.getByLabelText("Mode"), "advanced");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Detail is required.");
  });

  it("reflects an overlay relabel from mergePackWithOverlay in the rendered entry form", () => {
    const overlay: UserOverlay = {
      sections: [
        { sectionKey: "plan", relabels: { notes: { label: "Family notes" } } },
      ],
    };
    const section = resolveSection(makePlanPack(), "plan", overlay);
    render(<Harness section={section} />);

    expect(screen.getByLabelText("Family notes")).toBeInTheDocument();
    expect(screen.queryByLabelText("Notes")).not.toBeInTheDocument();
  });

  it("renders hostile pack labels and helper text as inert literal text", () => {
    const hostileLabel = '<script>alert("pwn")</script>';
    const hostileHelper = '<img src=x onerror="alert(1)">';
    const pack = makePack({
      sections: [
        makeSection({
          sectionKey: "hostile",
          groups: [
            makeGroup({
              groupKey: "main",
              title: "<script>group</script>",
              fields: [
                makeField({
                  systemKey: "victim",
                  label: hostileLabel,
                  helperText: hostileHelper,
                  order: 1,
                }),
              ],
            }),
          ],
        }),
      ],
    });
    const section = resolveSection(pack, "hostile");
    const { container } = render(<Harness section={section} />);

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(hostileLabel)).toBeInTheDocument();
    expect(screen.getByText(hostileHelper)).toBeInTheDocument();
  });

  it("never renders or validates overlay-hidden fields", async () => {
    const user = userEvent.setup();
    const overlay: UserOverlay = {
      sections: [{ sectionKey: "plan", hiddenFields: ["notes"] }],
    };
    const section = resolveSection(makePlanPack(), "plan", overlay);
    const notesField = section.groups
      .flatMap((group) => group.fields)
      .find((field) => field.systemKey === "notes");
    expect(notesField?.hidden).toBe(true);

    const onSave = vi.fn();
    render(<Harness section={section} onSave={onSave} />);

    expect(screen.queryByLabelText("Notes")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Provider"), "Bitwarden");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("renders a flagged previous-answer select value read-only inline with a marker", () => {
    const pack = makePlanPack();
    const values = makeVaultValues([
      makeSectionValues("plan", [makeRecord({ id: "r1", values: { provider: "LegacyPass" } })]),
    ]);
    const section = resolveSection(pack, "plan", undefined, values);
    render(<Harness section={section} initial={values.plan} />);

    expect(screen.getByText(/Previous answer/)).toHaveTextContent("LegacyPass");
    // The select itself shows no current choice; the stored value is intact.
    expect(screen.getByLabelText("Provider")).toHaveValue("");
  });

  it("supports add/duplicate/delete for repeatable groups inside a section form", async () => {
    const user = userEvent.setup();
    const section = resolveSection(makePlanPack(), "plan");
    const captureRef: { current: SectionValues | null } = { current: null };
    render(<Harness section={section} captureRef={captureRef} />);

    expect(screen.getByText("No Contact added yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add Contact" }));
    await user.type(screen.getByLabelText("Contact name"), "June Park");
    expect(screen.getByRole("button", { name: "June Park" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(screen.getAllByRole("button", { name: "June Park" })).toHaveLength(2);
    expect(
      captureRef.current?.records.filter((record) => record.groupKey === "contact"),
    ).toHaveLength(2);

    await user.click(screen.getAllByRole("button", { name: "Delete" })[1]);
    expect(screen.getByText(/Delete “June Park”\?/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(screen.getAllByRole("button", { name: "June Park" })).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Inline editing mode tests
// ---------------------------------------------------------------------------

/** Minimal pack/section fixtures used for editing-mode tests. */
function makeEditingFixtures(): { pack: FormPack; packSection: PackSection; section: ResolvedSection } {
  const pack = makePack({
    sections: [
      makeSection({
        sectionKey: "profile",
        title: "Profile",
        groups: [
          makeGroup({
            groupKey: "identity",
            title: "Identity",
            order: 1,
            fields: [
              makeField({ systemKey: "fullName", label: "Full name", type: "text", order: 1 }),
              makeField({ systemKey: "role", label: "Role", type: "select", options: [{ value: "primary", label: "Primary" }], order: 2 }),
            ],
          }),
        ],
      }),
    ],
  });
  const packSection = pack.sections[0]!;
  const section = resolveSection(pack, "profile");
  return { pack, packSection, section };
}

describe("FormRenderer — editing mode", () => {
  it("(regression) renders without editing prop — no inline-field-editor elements", () => {
    const { section, packSection } = makeEditingFixtures();
    const values = makeSectionValues("profile");
    const { container } = render(
      <FormRenderer
        section={section}
        values={values}
        schemaVersion={1}
        onChange={vi.fn()}
        packSection={packSection}
      />,
    );
    expect(container.querySelector(".inline-field-editor")).toBeNull();
    expect(container.querySelector(".inline-group-controls")).toBeNull();
  });

  it("editing=true renders InlineFieldEditor for each pack field", () => {
    const { section, packSection } = makeEditingFixtures();
    const values = makeSectionValues("profile");
    const { container } = render(
      <FormRenderer
        section={section}
        values={values}
        schemaVersion={1}
        onChange={vi.fn()}
        editing={true}
        packSection={packSection}
        onEditField={vi.fn()}
        onRemoveField={vi.fn()}
        onMoveField={vi.fn()}
        onAddField={vi.fn()}
        onEditGroupTitle={vi.fn()}
      />,
    );
    // One InlineFieldEditor per field (2 fields in this fixture).
    const editors = container.querySelectorAll(".inline-field-editor");
    expect(editors.length).toBe(2);
    // InlineGroupControls rendered for the non-repeatable group.
    expect(container.querySelector(".inline-group-controls")).toBeTruthy();
  });

  it("clicking Add field in InlineGroupControls calls onAddField with correct args", async () => {
    const user = userEvent.setup();
    const { section, packSection } = makeEditingFixtures();
    const values = makeSectionValues("profile");
    const onAddField = vi.fn();
    render(
      <FormRenderer
        section={section}
        values={values}
        schemaVersion={1}
        onChange={vi.fn()}
        editing={true}
        packSection={packSection}
        onAddField={onAddField}
        onEditField={vi.fn()}
        onRemoveField={vi.fn()}
        onMoveField={vi.fn()}
        onEditGroupTitle={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Add field/i }));
    expect(onAddField).toHaveBeenCalledWith("profile", "identity");
  });

  it("onChange from InlineFieldEditor calls onEditField with correct args", () => {
    const { section, packSection } = makeEditingFixtures();
    const values = makeSectionValues("profile");
    const onEditField = vi.fn();
    render(
      <FormRenderer
        section={section}
        values={values}
        schemaVersion={1}
        onChange={vi.fn()}
        editing={true}
        packSection={packSection}
        onEditField={onEditField}
        onRemoveField={vi.fn()}
        onMoveField={vi.fn()}
        onAddField={vi.fn()}
        onEditGroupTitle={vi.fn()}
      />,
    );
    // The InlineFieldEditor renders a "Label" input for each field.
    // Find the first one (for "Full name") and fire a single change event.
    const labelInputs = screen.getAllByRole("textbox", { name: /^Label$/i });
    fireEvent.change(labelInputs[0]!, { target: { value: "Full Name Updated" } });
    expect(onEditField).toHaveBeenCalledWith(
      "profile",
      "identity",
      expect.objectContaining<Partial<FieldDefinition>>({ systemKey: "fullName", label: "Full Name Updated" }),
    );
  });

  it("repeatable group in editing mode renders record CRUD AND InlineGroupControls", async () => {
    const user = userEvent.setup();
    const pack = makePack({
      sections: [
        makeSection({
          sectionKey: "contacts",
          title: "Contacts",
          groups: [
            makeGroup({
              groupKey: "contact",
              title: "Contact",
              repeatable: true,
              order: 1,
              fields: [
                makeField({ systemKey: "name", label: "Name", type: "text", order: 1 }),
              ],
            }),
          ],
        }),
      ],
    });
    const packSection = pack.sections[0]!;
    const section = resolveSection(pack, "contacts");
    const values = makeSectionValues("contacts");
    const onAddField = vi.fn();
    const { container } = render(
      <FormRenderer
        section={section}
        values={values}
        schemaVersion={1}
        onChange={vi.fn()}
        editing={true}
        packSection={packSection}
        onAddField={onAddField}
        onEditField={vi.fn()}
        onRemoveField={vi.fn()}
        onMoveField={vi.fn()}
        onEditGroupTitle={vi.fn()}
      />,
    );
    // Record CRUD: "Add Contact" button still present.
    expect(screen.getByRole("button", { name: "Add Contact" })).toBeInTheDocument();
    // InlineGroupControls also present.
    expect(container.querySelector(".inline-group-controls")).toBeTruthy();
    // Clicking "Add field" still calls onAddField with the repeatable group's key.
    await user.click(screen.getByRole("button", { name: /Add field/i }));
    expect(onAddField).toHaveBeenCalledWith("contacts", "contact");
  });
});
