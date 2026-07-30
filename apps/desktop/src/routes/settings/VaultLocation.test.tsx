import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VaultLocation } from "./VaultLocation";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
// The chosen folder is pre-flighted through the Rust check before the
// confirmation appears. Defaults to "usable" so the tests that are not about a
// rejected folder read the same as they did before the check existed.
vi.mock("../../api/vaultApi", () => ({
  checkVaultLocation: vi.fn().mockResolvedValue(undefined),
}));

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

  it("names the nesting mistake and never locks the vault over it", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { checkVaultLocation } = await import("../../api/vaultApi");
    vi.mocked(open).mockResolvedValue("D:\\Vaults\\Mine\\Inner");
    vi.mocked(checkVaultLocation).mockRejectedValueOnce(new Error("InvalidVaultLocation"));
    const onRelocate = vi.fn();

    render(<VaultLocation vaultDir={VAULT_DIR} onRelocate={onRelocate} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /move vault/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/inside — or contains —/i);
    // No confirmation, so no lock and no password re-entry for a fixable mistake.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onRelocate).not.toHaveBeenCalled();
  });

  it("explains a destination that already holds a vault", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { checkVaultLocation } = await import("../../api/vaultApi");
    vi.mocked(open).mockResolvedValue("E:\\Existing");
    vi.mocked(checkVaultLocation).mockRejectedValueOnce(new Error("VaultAlreadyExists"));
    const onRelocate = vi.fn();

    render(<VaultLocation vaultDir={VAULT_DIR} onRelocate={onRelocate} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /move vault/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already holds a vault/i);
    expect(onRelocate).not.toHaveBeenCalled();
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
