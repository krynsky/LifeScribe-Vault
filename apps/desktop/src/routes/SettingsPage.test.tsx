import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const VAULT_DIR = "D:\\Vaults\\Mine";

describe("SettingsPage", () => {
  it("renders the Settings heading and the Vault options section from the bundled pack", async () => {
    render(
      <SettingsPage
        selections={{ secrets: "off", "file-method": "path" }}
        onApply={vi.fn()}
        vaultDir={VAULT_DIR}
        onRelocate={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    // VaultOptions loads the bundled modules asynchronously; wait for one to appear.
    expect(await screen.findByText("Vault options")).toBeInTheDocument();
  });

  it("renders the Vault location section with the current directory", () => {
    render(
      <SettingsPage
        selections={{ secrets: "off", "file-method": "path" }}
        onApply={vi.fn()}
        vaultDir={VAULT_DIR}
        onRelocate={vi.fn()}
      />,
    );
    expect(screen.getByText("Vault location")).toBeInTheDocument();
    expect(screen.getByText(VAULT_DIR)).toBeInTheDocument();
  });
});
