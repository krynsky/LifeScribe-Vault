import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import NoteList from "../NoteList";
import { renderWithProviders } from "../../test/renderWithProviders";

const rows = [
  { id: "src_a", type: "SourceRecord", title: "Alpha", subtitle: "a.txt" },
  { id: "src_b", type: "SourceRecord", title: "Beta", subtitle: "b.txt" },
];

describe("NoteList", () => {
  it("renders rows and fires onSelect on click", async () => {
    const onSelect = vi.fn();
    renderWithProviders(<NoteList rows={rows} onSelect={onSelect} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Alpha"));
    expect(onSelect).toHaveBeenCalledWith("src_a");
  });

  it("filters rows client-side", async () => {
    renderWithProviders(<NoteList rows={rows} onSelect={() => {}} />);
    const filter = screen.getByRole("searchbox");
    await userEvent.type(filter, "Beta");
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("shows empty-state when no rows", () => {
    renderWithProviders(<NoteList rows={[]} onSelect={() => {}} emptyLabel="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });
});
