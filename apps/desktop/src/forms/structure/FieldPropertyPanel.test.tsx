import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { FieldDefinition } from "../../domain/formModel";
import { makeField, makeGroup, makeSection } from "../../domain/testing/fixtures";
import { FieldPropertyPanel } from "./FieldPropertyPanel";

const field: FieldDefinition = {
  systemKey: "demoField",
  label: "Demo",
  helperText: "help",
  type: "text",
  required: false,
  protected: false,
  order: 1,
};

function StatefulPanel({
  initialField,
  onChange,
  sections,
  currentSectionKey,
}: {
  initialField: FieldDefinition;
  onChange: (field: FieldDefinition) => void;
  sections?: Parameters<typeof FieldPropertyPanel>[0]["sections"];
  currentSectionKey?: string;
}) {
  const [current, setCurrent] = useState(initialField);
  return (
    <FieldPropertyPanel
      field={current}
      onChange={(next) => {
        setCurrent(next);
        onChange(next);
      }}
      sections={sections}
      currentSectionKey={currentSectionKey}
    />
  );
}

describe("FieldPropertyPanel", () => {
  it("shows an empty prompt when no field is selected", () => {
    render(<FieldPropertyPanel field={null} onChange={vi.fn()} />);
    expect(screen.getByText(/select a field/i)).toBeInTheDocument();
  });

  it("emits label edits", async () => {
    const onChange = vi.fn();
    render(<FieldPropertyPanel field={field} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Label"), "!");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: "Demo!" }),
    );
  });

  it("changes the type", async () => {
    const onChange = vi.fn();
    render(<FieldPropertyPanel field={field} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText("Type"), "textarea");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "textarea" }),
    );
  });

  it("hides the readiness-anchor control when the caller offers no section context", () => {
    render(<FieldPropertyPanel field={field} onChange={vi.fn()} />);
    expect(screen.queryByText(/identifying field/i)).not.toBeInTheDocument();
  });

  it("shows the readiness-anchor checkbox unchecked, and emits the toggle on click", async () => {
    const onToggle = vi.fn();
    render(
      <FieldPropertyPanel
        field={field}
        onChange={vi.fn()}
        isReadinessAnchor={false}
        onToggleReadinessAnchor={onToggle}
      />,
    );
    const checkbox = screen.getByRole("checkbox", { name: /identifying field/i });
    expect(checkbox).not.toBeChecked();
    await userEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("shows the readiness-anchor checkbox checked when the field is already an anchor", () => {
    render(
      <FieldPropertyPanel
        field={field}
        onChange={vi.fn()}
        isReadinessAnchor={true}
        onToggleReadinessAnchor={vi.fn()}
      />,
    );
    expect(screen.getByRole("checkbox", { name: /identifying field/i })).toBeChecked();
  });

  it("adds an option from a single Value input, auto-generating the stored value", async () => {
    const onChange = vi.fn();
    const selectField: FieldDefinition = { ...field, type: "select", options: [] };
    render(<FieldPropertyPanel field={selectField} onChange={onChange} />);
    // The creator types only the human-readable text (labeled "Value"); there
    // is no separate machine-value input to fill in.
    expect(screen.queryByLabelText("Option value")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Value"), "Checking Account");
    await userEvent.click(screen.getByRole("button", { name: /add option/i }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        options: [{ value: "checking-account", label: "Checking Account" }],
      }),
    );
  });

  it("auto-generates a unique stored value when a new option would collide", async () => {
    const onChange = vi.fn();
    const selectField: FieldDefinition = {
      ...field,
      type: "select",
      options: [{ value: "checking-account", label: "Checking Account" }],
    };
    render(<FieldPropertyPanel field={selectField} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Value"), "Checking account");
    await userEvent.click(screen.getByRole("button", { name: /add option/i }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        options: [
          { value: "checking-account", label: "Checking Account" },
          { value: "checking-account-2", label: "Checking account" },
        ],
      }),
    );
  });

  it("configures a recordRef source, display order, formatting, and separator", async () => {
    const onChange = vi.fn();
    const recordRefField: FieldDefinition = {
      ...field,
      type: "recordRef",
      reference: {
        sectionKey: "accounts",
        displayFields: [
          { systemKey: "institution" },
          { systemKey: "accountNumber" },
        ],
        separator: " — ",
      },
    };
    const accounts = makeSection({
      sectionKey: "accounts",
      title: "Financial Accounts",
      groups: [
        makeGroup({
          groupKey: "account",
          fields: [
            makeField({ systemKey: "institution", label: "Institution", order: 1 }),
            makeField({ systemKey: "accountName", label: "Account name", order: 2 }),
            makeField({ systemKey: "accountNumber", label: "Account number", order: 3 }),
          ],
        }),
      ],
    });
    const current = makeSection({ sectionKey: "subscriptions", title: "Subscriptions" });

    render(
      <StatefulPanel
        initialField={recordRefField}
        onChange={onChange}
        sections={[accounts, current]}
        currentSectionKey="subscriptions"
      />,
    );

    expect(screen.getByLabelText("Source section")).toHaveValue("accounts");
    await userEvent.click(screen.getAllByRole("button", { name: "Move up" })[1]);
    await userEvent.click(screen.getByRole("checkbox", { name: "Include Account name" }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reference: expect.objectContaining({
          displayFields: [
            { systemKey: "accountNumber" },
            { systemKey: "institution" },
            { systemKey: "accountName" },
          ],
        }),
      }),
    );

    await userEvent.selectOptions(screen.getByLabelText("Format Account number"), "last4");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reference: expect.objectContaining({
          displayFields: [
            { systemKey: "accountNumber", format: "last4" },
            { systemKey: "institution" },
            { systemKey: "accountName" },
          ],
        }),
      }),
    );

    await userEvent.clear(screen.getByLabelText("Separator"));
    await userEvent.type(screen.getByLabelText("Separator"), " / ");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reference: expect.objectContaining({ separator: " / " }),
      }),
    );
  });

  it("creates a valid default reference when a field changes to recordRef", async () => {
    const onChange = vi.fn();
    const accounts = makeSection({
      sectionKey: "accounts",
      title: "Financial Accounts",
      groups: [
        makeGroup({
          groupKey: "account",
          fields: [makeField({ systemKey: "institution", label: "Institution" })],
        }),
      ],
    });
    const current = makeSection({ sectionKey: "subscriptions", title: "Subscriptions" });
    render(
      <StatefulPanel
        initialField={field}
        onChange={onChange}
        sections={[accounts, current]}
        currentSectionKey="subscriptions"
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText("Type"), "recordRef");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "recordRef",
        reference: {
          sectionKey: "accounts",
          displayFields: [{ systemKey: "institution" }],
          separator: " — ",
        },
      }),
    );
  });
});
