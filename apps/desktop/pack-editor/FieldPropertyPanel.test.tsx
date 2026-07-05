import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FieldDefinition } from "../src/domain/formModel";
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

  it("adds an option for a select field", async () => {
    const onChange = vi.fn();
    const selectField: FieldDefinition = { ...field, type: "select", options: [] };
    render(<FieldPropertyPanel field={selectField} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Option value"), "yes");
    await userEvent.type(screen.getByLabelText("Option label"), "Yes");
    await userEvent.click(screen.getByRole("button", { name: /add option/i }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: [{ value: "yes", label: "Yes" }] }),
    );
  });
});
