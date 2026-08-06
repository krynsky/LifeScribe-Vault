import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HelpPage } from "./HelpPage";

describe("HelpPage", () => {
  it("renders the user guide's heading and section content", () => {
    render(<HelpPage />);

    expect(
      screen.getByRole("heading", { name: /LifeScribe Vault — User Guide/i, level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Getting Started", level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Recovery Kit", level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/There is no password reset\./),
    ).toBeInTheDocument();
  });
});
