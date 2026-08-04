import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FieldGroup } from "../../domain/formModel";
import { FieldList } from "./FieldList";

const groups: FieldGroup[] = [
  {
    groupKey: "g1",
    title: "Group one",
    repeatable: false,
    order: 1,
    fields: [
      { systemKey: "hintOne", label: "Hint one", type: "text", required: false, protected: false, order: 1 },
      { systemKey: "field_added", label: "Added", type: "text", required: false, protected: false, order: 2 },
    ],
  },
];

function renderList(overrides = {}) {
  const props = {
    groups,
    selectedKey: null as string | null,
    lockedKeys: new Set(["hintOne"]),
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onAdd: vi.fn(),
    onReorder: vi.fn(),
    ...overrides,
  };
  render(<FieldList {...props} />);
  return props;
}

describe("FieldList", () => {
  it("selects a field when its row is clicked", async () => {
    const props = renderList();
    await userEvent.click(screen.getByRole("button", { name: /edit field Hint one/i }));
    expect(props.onSelect).toHaveBeenCalledWith("hintOne");
  });

  it("does not offer a duplicate control", () => {
    renderList();
    expect(screen.queryByRole("button", { name: /duplicate/i })).toBeNull();
  });

  it("offers delete only for added (non-hint) fields", () => {
    renderList();
    const hintRow = screen.getByRole("button", { name: /edit field Hint one/i }).closest(".field-row")!;
    const addedRow = screen.getByRole("button", { name: /edit field Added/i }).closest(".field-row")!;
    expect(within(hintRow as HTMLElement).queryByRole("button", { name: /remove field/i })).toBeNull();
    expect(within(addedRow as HTMLElement).getByRole("button", { name: /remove field/i })).toBeInTheDocument();
  });

  it("adds a field of the chosen type", async () => {
    const props = renderList();
    await userEvent.selectOptions(screen.getByLabelText(/add field to Group one/i), "textarea");
    expect(props.onAdd).toHaveBeenCalledWith("g1", "textarea");
  });
});
