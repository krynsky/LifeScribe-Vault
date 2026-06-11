import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ArchivedAnswer } from "../domain/valuesStore";
import { ArchivedAnswers } from "./ArchivedAnswers";

const answers: ArchivedAnswer[] = [
  {
    id: "plan:r1:legacyKey",
    sectionKey: "plan",
    recordId: "r1",
    systemKey: "legacyKey",
    originalLabel: "Legacy field",
    value: "old answer",
    reason: "This field was removed from the form definition.",
  },
  {
    id: "plan:r1:unlabeled",
    sectionKey: "plan",
    recordId: "r1",
    systemKey: "fallback.key",
    originalLabel: "",
    value: "another answer",
    reason: "The “extras” group was removed from this section.",
  },
];

describe("ArchivedAnswers", () => {
  it("renders nothing when there are no archived answers", () => {
    const { container } = render(
      <ArchivedAnswers archivedAnswers={[]} onDeleteArchived={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a collapsed disclosure with label, read-only value, and reason", async () => {
    const user = userEvent.setup();
    render(<ArchivedAnswers archivedAnswers={answers} onDeleteArchived={vi.fn()} />);

    // Collapsed by default.
    expect(screen.queryByText("old answer")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archived data (2)" }));
    expect(screen.getByText("Legacy field")).toBeInTheDocument();
    expect(screen.getByText("old answer")).toBeInTheDocument();
    expect(
      screen.getByText("This field was removed from the form definition."),
    ).toBeInTheDocument();
    // Values are read-only text, not editable controls.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    // systemKey is the fallback label when no original label survives.
    expect(screen.getByText("fallback.key")).toBeInTheDocument();
  });

  it("only deletes after an explicit confirm", async () => {
    const user = userEvent.setup();
    const onDeleteArchived = vi.fn();
    render(<ArchivedAnswers archivedAnswers={answers} onDeleteArchived={onDeleteArchived} />);

    await user.click(screen.getByRole("button", { name: "Archived data (2)" }));
    await user.click(screen.getAllByRole("button", { name: "Delete permanently" })[0]);
    expect(onDeleteArchived).not.toHaveBeenCalled();
    expect(screen.getByText(/Permanently delete the archived answer for/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDeleteArchived).not.toHaveBeenCalled();

    await user.click(screen.getAllByRole("button", { name: "Delete permanently" })[0]);
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(onDeleteArchived).toHaveBeenCalledExactlyOnceWith("plan:r1:legacyKey");
  });
});
