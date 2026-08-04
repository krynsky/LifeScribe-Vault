import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const mockedGetVersion = vi.fn();
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => mockedGetVersion() }));

const VAULT_DIR = "D:\\Vaults\\Mine";

describe("SettingsPage", () => {
  it("renders the Settings heading and the Vault location section with the current directory", async () => {
    mockedGetVersion.mockResolvedValue("1.0.0");
    render(<SettingsPage vaultDir={VAULT_DIR} onRelocate={vi.fn()} onChangePassword={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Vault location")).toBeInTheDocument();
    expect(screen.getByText(VAULT_DIR)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /move vault/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "App version" })).toBeInTheDocument();
    // The real version read from Tauri at runtime, not a hardcoded UI string
    // that would silently drift from package.json/Cargo.toml/tauri.conf.json.
    expect(await screen.findByText("Version 1.0.0")).toBeInTheDocument();
  });

  it("shows a placeholder while the version is loading, and on failure", async () => {
    mockedGetVersion.mockReturnValue(new Promise(() => undefined));
    const { unmount } = render(
      <SettingsPage vaultDir={VAULT_DIR} onRelocate={vi.fn()} onChangePassword={vi.fn()} />,
    );
    expect(screen.getByText("Version —")).toBeInTheDocument();
    unmount();

    mockedGetVersion.mockRejectedValue(new Error("no runtime"));
    render(<SettingsPage vaultDir={VAULT_DIR} onRelocate={vi.fn()} onChangePassword={vi.fn()} />);
    // Rejects silently rather than crashing the Settings page over a label.
    expect(screen.getByText("Version —")).toBeInTheDocument();
  });

  it("presents no form options (R14)", () => {
    render(<SettingsPage vaultDir={VAULT_DIR} onRelocate={vi.fn()} onChangePassword={vi.fn()} />);
    // The old module-selection UI: a "Vault options" section of radio choices
    // with an Apply changes button. None of it may come back.
    expect(screen.queryByText("Vault options")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apply changes/i })).not.toBeInTheDocument();
  });

  it("changes the password after validating and confirming the new password", async () => {
    const user = userEvent.setup();
    const onChangePassword = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsPage
        vaultDir={VAULT_DIR}
        onRelocate={vi.fn()}
        onChangePassword={onChangePassword}
      />,
    );

    await user.type(screen.getByLabelText("Current master password"), "current-master-password");
    await user.type(screen.getByLabelText("New master password"), "replacement-master-password");
    await user.type(screen.getByLabelText("Confirm new master password"), "replacement-master-password");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(onChangePassword).toHaveBeenCalledWith(
      "current-master-password",
      "replacement-master-password",
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Your master password has been changed.");
    expect(screen.getByLabelText("Current master password")).toHaveValue("");
  });

  it("blocks a short or mismatched new password before calling the backend", async () => {
    const user = userEvent.setup();
    const onChangePassword = vi.fn();
    render(
      <SettingsPage
        vaultDir={VAULT_DIR}
        onRelocate={vi.fn()}
        onChangePassword={onChangePassword}
      />,
    );

    await user.type(screen.getByLabelText("Current master password"), "current-master-password");
    await user.type(screen.getByLabelText("New master password"), "short");
    await user.type(screen.getByLabelText("Confirm new master password"), "different");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(onChangePassword).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("at least 15 characters");
  });

  it("blocks non-matching new passwords before calling the backend", async () => {
    const user = userEvent.setup();
    const onChangePassword = vi.fn();
    render(
      <SettingsPage
        vaultDir={VAULT_DIR}
        onRelocate={vi.fn()}
        onChangePassword={onChangePassword}
      />,
    );

    await user.type(screen.getByLabelText("Current master password"), "current-master-password");
    await user.type(screen.getByLabelText("New master password"), "replacement-master-password");
    await user.type(screen.getByLabelText("Confirm new master password"), "different-master-password");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(onChangePassword).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("new passwords don't match");
  });

  it("explains when the current password is incorrect and clears that field", async () => {
    const user = userEvent.setup();
    const onChangePassword = vi.fn().mockRejectedValue("InvalidMasterPassword");
    render(
      <SettingsPage
        vaultDir={VAULT_DIR}
        onRelocate={vi.fn()}
        onChangePassword={onChangePassword}
      />,
    );

    await user.type(screen.getByLabelText("Current master password"), "wrong-current-password");
    await user.type(screen.getByLabelText("New master password"), "replacement-master-password");
    await user.type(screen.getByLabelText("Confirm new master password"), "replacement-master-password");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("current master password is incorrect");
    expect(screen.getByLabelText("Current master password")).toHaveValue("");
  });
});
