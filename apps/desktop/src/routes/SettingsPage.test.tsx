import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";

describe("SettingsPage", () => {
  it("renders the Settings heading and the Vault options section from the bundled pack", async () => {
    render(<SettingsPage selections={{ secrets: "off", "file-method": "path" }} onApply={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    // VaultOptions loads the bundled modules asynchronously; wait for one to appear.
    expect(await screen.findByText("Vault options")).toBeInTheDocument();
  });

  it("calls onBack when the Back control is clicked", async () => {
    const onBack = vi.fn();
    render(<SettingsPage selections={{}} onApply={vi.fn()} onBack={onBack} />);
    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
