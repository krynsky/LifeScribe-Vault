import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";

describe("SettingsPage", () => {
  it("renders the Settings heading and the Vault options section from the bundled pack", async () => {
    render(<SettingsPage selections={{ secrets: "off", "file-method": "path" }} onApply={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    // VaultOptions loads the bundled modules asynchronously; wait for one to appear.
    expect(await screen.findByText("Vault options")).toBeInTheDocument();
  });
});
