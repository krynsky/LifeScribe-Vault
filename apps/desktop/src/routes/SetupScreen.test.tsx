import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vaultApi from "../api/vaultApi";
import { SetupScreen } from "./SetupScreen";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../api/vaultApi", () => ({
  getVaultStatus: vi.fn(),
  setVaultLocation: vi.fn(),
}));
const mocked = vi.mocked(vaultApi);

const PW = "correct horse battery staple";

beforeEach(() => {
  vi.clearAllMocks();
  mocked.getVaultStatus.mockResolvedValue({
    unlocked: false,
    vaultExists: false,
    vaultDir: "C:\\Users\\test\\AppData\\Roaming\\LifeScribe",
    vaultDirAvailable: true,
  });
});

/** Fill everything the single setup screen requires, short of pressing Create. */
async function fillIdentity(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Your name"), "Dana");
  await user.type(screen.getByLabelText("Master password"), PW);
  await user.type(screen.getByLabelText("Confirm master password"), PW);
  await user.click(screen.getByRole("checkbox", { name: /no recovery/i }));
}

describe("SetupScreen", () => {
  it("presents folder, name and password on one screen with no wizard steps", async () => {
    render(<SetupScreen onCreate={vi.fn()} onVaultFound={vi.fn()} />);

    expect(await screen.findByText(/where your vault is stored/i)).toBeInTheDocument();
    expect(screen.getByText(/C:\\Users\\test\\AppData/)).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toBeInTheDocument();
    expect(screen.getByLabelText("Master password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm master password")).toBeInTheDocument();
    // One screen: the only progression control is Create vault.
    expect(screen.queryByRole("button", { name: /^next$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^back$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create vault/i })).toBeInTheDocument();
  });

  it("asks no module questions", async () => {
    render(<SetupScreen onCreate={vi.fn()} onVaultFound={vi.fn()} />);
    await screen.findByLabelText("Master password");

    // Module questions were radio groups; the collapsed screen has none.
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByText(/store the actual passwords/i)).not.toBeInTheDocument();
  });

  it("shows the default folder and updates it when another is chosen", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValue("D:\\Vaults\\Fresh");
    mocked.setVaultLocation.mockResolvedValue({
      unlocked: false,
      vaultExists: false,
      vaultDir: "D:\\Vaults\\Fresh",
      vaultDirAvailable: true,
    });

    render(<SetupScreen onCreate={vi.fn()} onVaultFound={vi.fn()} />);
    const user = userEvent.setup();
    expect(await screen.findByText(/C:\\Users\\test\\AppData/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /change folder/i }));

    expect(await screen.findByText("D:\\Vaults\\Fresh")).toBeInTheDocument();
  });

  it("choosing a folder that already holds a vault hands off to unlock before any password is typed", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValue("D:\\Vaults\\Existing");
    mocked.setVaultLocation.mockResolvedValue({
      unlocked: false,
      vaultExists: true,
      vaultDir: "D:\\Vaults\\Existing",
      vaultDirAvailable: true,
    });
    const onVaultFound = vi.fn();
    const onCreate = vi.fn();

    render(<SetupScreen onCreate={onCreate} onVaultFound={onVaultFound} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /change folder/i }));

    await waitFor(() => expect(onVaultFound).toHaveBeenCalledTimes(1));
    // The handoff is immediate — nothing was typed and no vault was created.
    expect(screen.getByLabelText("Master password")).toHaveValue("");
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("blocks a master password shorter than 15 characters", async () => {
    const onCreate = vi.fn();
    render(<SetupScreen onCreate={onCreate} onVaultFound={vi.fn()} />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Master password"), "short");
    await user.type(screen.getByLabelText("Confirm master password"), "short");
    await user.click(screen.getByRole("checkbox", { name: /no recovery/i }));
    await user.click(screen.getByRole("button", { name: /create vault/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/at least 15 characters/i);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("blocks mismatched passwords with a friendly error", async () => {
    const onCreate = vi.fn();
    render(<SetupScreen onCreate={onCreate} onVaultFound={vi.fn()} />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Master password"), PW);
    await user.type(
      screen.getByLabelText("Confirm master password"),
      "different but long enough",
    );
    await user.click(screen.getByRole("checkbox", { name: /no recovery/i }));
    await user.click(screen.getByRole("button", { name: /create vault/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/don't match/i);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("blocks creation until the no-recovery acknowledgment is checked", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<SetupScreen onCreate={onCreate} onVaultFound={vi.fn()} />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Your name"), "Dana");
    await user.type(screen.getByLabelText("Master password"), PW);
    await user.type(screen.getByLabelText("Confirm master password"), PW);

    const create = screen.getByRole("button", { name: /create vault/i });
    expect(create).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /no recovery/i }));
    expect(create).toBeEnabled();
  });

  it("reveals and re-hides each password field independently", async () => {
    render(<SetupScreen onCreate={vi.fn()} onVaultFound={vi.fn()} />);
    const user = userEvent.setup();

    const master = await screen.findByLabelText("Master password");
    expect(master).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Show master password" }));
    expect(master).toHaveAttribute("type", "text");
    // Toggling one field does not reveal the other.
    expect(screen.getByLabelText("Confirm master password")).toHaveAttribute(
      "type",
      "password",
    );

    await user.click(screen.getByRole("button", { name: "Hide master password" }));
    expect(master).toHaveAttribute("type", "password");
  });

  it("creates the vault with the master password and owner name only", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<SetupScreen onCreate={onCreate} onVaultFound={vi.fn()} />);
    const user = userEvent.setup();

    await fillIdentity(user);
    await user.click(screen.getByRole("button", { name: /create vault/i }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith(PW, "Dana");
    expect(onCreate.mock.calls[0]).toHaveLength(2);
  });
});
