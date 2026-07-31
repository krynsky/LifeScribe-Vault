import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const VAULT_DIR = "D:\\Vaults\\Mine";

describe("SettingsPage", () => {
  it("renders the Settings heading and the Vault location section with the current directory", () => {
    render(<SettingsPage vaultDir={VAULT_DIR} onRelocate={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Vault location")).toBeInTheDocument();
    expect(screen.getByText(VAULT_DIR)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /move vault/i })).toBeInTheDocument();
  });

  it("presents no form options (R14)", () => {
    render(<SettingsPage vaultDir={VAULT_DIR} onRelocate={vi.fn()} />);
    // The old module-selection UI: a "Vault options" section of radio choices
    // with an Apply changes button. None of it may come back.
    expect(screen.queryByText("Vault options")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apply changes/i })).not.toBeInTheDocument();
  });
});
