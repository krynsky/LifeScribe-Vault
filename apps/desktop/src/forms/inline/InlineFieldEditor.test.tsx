import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FieldDefinition } from "../../domain/formModel";
import { InlineFieldEditor } from "./InlineFieldEditor";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeField(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    systemKey: "test_field",
    label: "Test Label",
    type: "text",
    required: false,
    protected: false,
    order: 1,
    ...overrides,
  };
}

/** Always returns vi.fn() mocks so callers can call .mock on them. */
function makeProps(field: FieldDefinition) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onChange = vi.fn() as unknown as ReturnType<typeof vi.fn> & ((updated: FieldDefinition) => void);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onRemove = vi.fn() as unknown as ReturnType<typeof vi.fn> & (() => void);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onMoveUp = vi.fn() as unknown as ReturnType<typeof vi.fn> & (() => void);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onMoveDown = vi.fn() as unknown as ReturnType<typeof vi.fn> & (() => void);
  return { field, onChange, onRemove, onMoveUp, onMoveDown };
}

// ---------------------------------------------------------------------------
// 1. Happy path — label change
// ---------------------------------------------------------------------------

describe("InlineFieldEditor", () => {
  it("calls onChange with updated label when the label input changes", () => {
    const field = makeField({ label: "Original" });
    const props = makeProps(field);

    render(<InlineFieldEditor {...props} />);

    const labelInput = screen.getByDisplayValue("Original");
    // Use fireEvent for controlled-input testing — avoids re-render coupling with mocked onChange.
    fireEvent.change(labelInput, { target: { value: "Updated Label" } });

    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Updated Label" }),
    );
  });

  // -------------------------------------------------------------------------
  // 2. Happy path — required checkbox
  // -------------------------------------------------------------------------

  it("calls onChange with required toggled when the required checkbox is clicked", async () => {
    const user = userEvent.setup();
    const field = makeField({ required: false });
    const props = makeProps(field);

    render(<InlineFieldEditor {...props} />);

    const checkbox = screen.getByRole("checkbox", { name: /required/i });
    await user.click(checkbox);

    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ required: true }),
    );
  });

  // -------------------------------------------------------------------------
  // 3. Happy path — select field options editor visible, add option
  // -------------------------------------------------------------------------

  it("shows the options editor for select-type fields and calls onChange when an option is added", async () => {
    const user = userEvent.setup();
    const field = makeField({
      type: "select",
      options: [{ value: "existing", label: "Existing Option" }],
    });
    const props = makeProps(field);

    render(<InlineFieldEditor {...props} />);

    // The existing option should be visible.
    expect(screen.getByText(/Existing Option/)).toBeInTheDocument();

    // Fill in the two add-option inputs.
    const valueInput = screen.getByLabelText("Option value");
    const labelInput = screen.getByLabelText("Option label");
    await user.type(valueInput, "new_val");
    await user.type(labelInput, "New Option");
    await user.click(screen.getByRole("button", { name: /^Add$/i }));

    const calls = props.onChange.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall).toBeDefined();
    expect(lastCall![0].options).toContainEqual({
      value: "new_val",
      label: "New Option",
    });
  });

  // -------------------------------------------------------------------------
  // 4. Edge case — protected field
  // -------------------------------------------------------------------------

  it("does not render a remove button for protected fields", () => {
    const field = makeField({ protected: true, required: true });
    const props = makeProps(field);

    render(<InlineFieldEditor {...props} />);

    expect(
      screen.queryByRole("button", { name: /remove field/i }),
    ).not.toBeInTheDocument();
  });

  it("disables the required checkbox for protected fields", () => {
    const field = makeField({ protected: true, required: true });
    const props = makeProps(field);

    render(<InlineFieldEditor {...props} />);

    const checkbox = screen.getByRole("checkbox", { name: /required/i });
    expect(checkbox).toBeDisabled();
  });

  // -------------------------------------------------------------------------
  // 5. Edge case — type change to select
  // -------------------------------------------------------------------------

  it("calls onChange when the field type is changed to select", async () => {
    const user = userEvent.setup();
    const field = makeField({ type: "text" });
    const props = makeProps(field);

    render(<InlineFieldEditor {...props} />);

    const typeSelect = screen.getByRole("combobox");
    await user.selectOptions(typeSelect, "select");

    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ type: "select" }),
    );
  });

  // -------------------------------------------------------------------------
  // 6. Accessibility — aria-labels on move and remove buttons
  // -------------------------------------------------------------------------

  it("has aria-label on move-up, move-down, and remove buttons", () => {
    const field = makeField();
    const props = makeProps(field);

    render(<InlineFieldEditor {...props} />);

    expect(
      screen.getByRole("button", { name: "Move field up" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Move field down" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove field" }),
    ).toBeInTheDocument();
  });
});
