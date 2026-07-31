import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FieldDefinition } from "../../domain/formModel";
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
    expect(screen.queryByText(/required for section readiness/i)).not.toBeInTheDocument();
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
    const checkbox = screen.getByRole("checkbox", { name: /required for section readiness/i });
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
    expect(screen.getByRole("checkbox", { name: /required for section readiness/i })).toBeChecked();
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
});
