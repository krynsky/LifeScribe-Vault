import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import MarkdownViewer from "../MarkdownViewer";

describe("MarkdownViewer", () => {
  it("renders headings and paragraphs", () => {
    render(<MarkdownViewer body={"# Title\n\nHello **world**"} />);
    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
    expect(screen.getByText("world")).toBeInTheDocument();
  });

  it("renders GFM tables", () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |\n";
    const { container } = render(<MarkdownViewer body={md} />);
    expect(container.querySelector("table")).not.toBeNull();
    expect(screen.getByRole("cell", { name: "1" })).toBeInTheDocument();
  });

  it("sanitizes raw HTML by default", () => {
    const { container } = render(<MarkdownViewer body={"<script>alert(1)</script>\n\nOK"} />);
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText(/OK/)).toBeInTheDocument();
  });
});
