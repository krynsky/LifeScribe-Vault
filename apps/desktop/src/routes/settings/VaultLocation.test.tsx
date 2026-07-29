import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VaultLocation } from "./VaultLocation";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

// A Windows path, held in a JS string constant rather than written inline as a
// JSX attribute: JSX attribute literals do not process `\\` escapes, so an
// inline "D:\\Vaults\\Mine" would render two backslashes and never match the
// single-backslash query below.
const VAULT_DIR = "D:\\Vaults\\Mine";

describe("VaultLocation", () => {
  it("shows the current vault directory", () => {
    render(<VaultLocation vaultDir={VAULT_DIR} onRelocate={vi.fn()} />);
    expect(screen.getByText(VAULT_DIR)).toBeInTheDocument();
  });

  it("warns that the vault will lock, and relocates only after confirming", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValue("E:\\NewHome");
    const onRelocate = vi.fn().mockResolvedValue(undefined);

    render(<VaultLocation vaultDir={VAULT_DIR} onRelocate={onRelocate} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /move vault/i }));

    // Confirmation states the cost before anything happens.
    expect(await screen.findByText(/will lock/i)).toBeInTheDocument();
    expect(onRelocate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^move and lock$/i }));
    expect(onRelocate).toHaveBeenCalledWith("E:\\NewHome");
  });

  it("cancelling the confirmation does not relocate", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValue("E:\\NewHome");
    const onRelocate = vi.fn();

    render(<VaultLocation vaultDir={VAULT_DIR} onRelocate={onRelocate} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /move vault/i }));
    await user.click(await screen.findByRole("button", { name: /cancel/i }));

    expect(onRelocate).not.toHaveBeenCalled();
  });
});
