import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { open as openFolderPicker } from "@tauri-apps/plugin-dialog";
import { VaultUnavailableScreen } from "./VaultUnavailableScreen";
import * as vaultApi from "../api/vaultApi";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../api/vaultApi", () => ({ setVaultLocation: vi.fn() }));

const mockedOpen = vi.mocked(openFolderPicker);
const mockedApi = vi.mocked(vaultApi);

// Hoisted deliberately: a JSX attribute literal does not process escapes, so an
// inline `vaultDir="E:\\Vault"` would render two backslashes while a
// getByText("E:\\Vault") JS literal queries one.
const VAULT_DIR = "E:\\Vault";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("VaultUnavailableScreen", () => {
  it("names the folder it cannot reach and never suggests the vault is gone", () => {
    render(<VaultUnavailableScreen vaultDir={VAULT_DIR} onRetry={vi.fn()} onRelocated={vi.fn()} />);

    expect(screen.getByText(VAULT_DIR)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /choose folder/i })).toBeInTheDocument();
    expect(screen.getByText(/nothing has been changed or deleted/i)).toBeInTheDocument();
  });

  it("Retry re-checks status", async () => {
    const onRetry = vi.fn();
    render(<VaultUnavailableScreen vaultDir={VAULT_DIR} onRetry={onRetry} onRelocated={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("Choose folder records the new location and re-checks status", async () => {
    const onRelocated = vi.fn();
    mockedOpen.mockResolvedValue("F:\\Moved");
    mockedApi.setVaultLocation.mockResolvedValue({
      unlocked: false,
      vaultExists: true,
      vaultDir: "F:\\Moved",
      vaultDirAvailable: true,
    });
    render(<VaultUnavailableScreen vaultDir={VAULT_DIR} onRetry={vi.fn()} onRelocated={onRelocated} />);

    await userEvent.click(screen.getByRole("button", { name: /choose folder/i }));

    expect(mockedApi.setVaultLocation).toHaveBeenCalledWith("F:\\Moved");
    expect(onRelocated).toHaveBeenCalledTimes(1);
  });

  it("keeps the user here with an explanation when the chosen folder is unusable", async () => {
    const onRelocated = vi.fn();
    mockedOpen.mockResolvedValue("F:\\Moved");
    mockedApi.setVaultLocation.mockRejectedValue("VaultDirUnwritable");
    render(<VaultUnavailableScreen vaultDir={VAULT_DIR} onRetry={vi.fn()} onRelocated={onRelocated} />);

    await userEvent.click(screen.getByRole("button", { name: /choose folder/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/can't be used/i);
    expect(onRelocated).not.toHaveBeenCalled();
  });

  it("does nothing when the folder picker is dismissed", async () => {
    const onRelocated = vi.fn();
    mockedOpen.mockResolvedValue(null);
    render(<VaultUnavailableScreen vaultDir={VAULT_DIR} onRetry={vi.fn()} onRelocated={onRelocated} />);

    await userEvent.click(screen.getByRole("button", { name: /choose folder/i }));

    expect(mockedApi.setVaultLocation).not.toHaveBeenCalled();
    expect(onRelocated).not.toHaveBeenCalled();
  });
});
