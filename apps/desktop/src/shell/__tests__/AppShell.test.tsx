import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import AppShell from "../AppShell";
import { renderWithProviders } from "../../test/renderWithProviders";

describe("AppShell", () => {
  it("renders all sidebar sections", () => {
    renderWithProviders(
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/browse" element={<div>browse content</div>} />
        </Route>
      </Routes>,
      { initialEntries: ["/browse"] },
    );
    expect(screen.getByRole("link", { name: /browse/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /import/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /logs/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByText("browse content")).toBeInTheDocument();
  });

  it("marks active section", () => {
    renderWithProviders(
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/import" element={<div>x</div>} />
        </Route>
      </Routes>,
      { initialEntries: ["/import"] },
    );
    const active = screen.getByRole("link", { name: /import/i });
    expect(active).toHaveAttribute("aria-current", "page");
  });
});
