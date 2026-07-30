import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as vaultApi from "./api/vaultApi";

vi.mock("./api/vaultApi", () => ({
  getVaultStatus: vi.fn(),
  createVault: vi.fn(),
  unlockVault: vi.fn(),
  lockVault: vi.fn(),
  saveVaultSnapshot: vi.fn(),
  loadVaultSnapshot: vi.fn(),
  stashDraft: vi.fn(),
  takeDraft: vi.fn(),
  discardDraft: vi.fn(),
  copyVaultValue: vi.fn(),
  // loadDefaultPack falls back to the static bundled pack when this mock
  // yields no JSON string — tests always run against the shipped pack.
  readDefaultPack: vi.fn(),
  // Attachment commands — sweep runs silently; not asserted in App-level tests.
  addAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  sweepOrphanedAttachments: vi.fn().mockResolvedValue(0),
  // Backup commands — not asserted in App-level tests.
  createBackup: vi.fn(),
  restoreBackup: vi.fn(),
  // Vault location — the setup wizard's folder step only calls these when the
  // user picks a folder; App-level tests accept the default.
  setVaultLocation: vi.fn(),
  checkVaultLocation: vi.fn(),
  relocateVault: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const mocked = vi.mocked(vaultApi);

const SETUP_PASSWORD = "correct horse battery staple";

/**
 * Drive the setup wizard: accept the default vault folder (step 0), fill step 1
 * (name + password + acknowledgment), then advance through each module step to
 * the final Create action. When `chooseSecrets` is set, the secrets module's
 * "on" option is selected on its step. The wizard shows one module per step
 * (secrets, then file-method).
 */
async function completeSetupWizard(
  user: ReturnType<typeof userEvent.setup>,
  options: { chooseSecrets?: boolean } = {},
) {
  // Step 0: vault folder — keep the default.
  await user.click(await screen.findByRole("button", { name: /^next$/i }));
  await user.type(await screen.findByLabelText("Your name"), "Dana");
  await user.type(screen.getByLabelText("Master password"), SETUP_PASSWORD);
  await user.type(screen.getByLabelText("Confirm master password"), SETUP_PASSWORD);
  await user.click(screen.getByLabelText(/I understand there is no recovery/i));
  await user.click(screen.getByRole("button", { name: /^next$/i }));

  // Step 2: secrets module.
  if (options.chooseSecrets) {
    await user.click(screen.getByRole("radio", { name: /store the actual passwords/i }));
  }
  await user.click(screen.getByRole("button", { name: /^next$/i }));

  // Step 3 (final): file-method module — Create the vault.
  await user.click(screen.getByRole("button", { name: "Create vault" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.loadVaultSnapshot.mockRejectedValue("NotFound");
  mocked.takeDraft.mockResolvedValue({
    draft: null,
    corrupt: false,
    staleGeneration: false,
    stashedAt: null,
  });
  mocked.discardDraft.mockResolvedValue(undefined);
  mocked.saveVaultSnapshot.mockResolvedValue({ generation: 1 });
});

describe("App", () => {
  it("renders the loading placeholder while the status loads", () => {
    mocked.getVaultStatus.mockReturnValue(new Promise(() => undefined));
    render(<App />);
    expect(screen.getByText("LifeScribe Vault")).toBeInTheDocument();
    expect(screen.getByText("Preparing your vault…")).toBeInTheDocument();
  });

  it("walks setup through to the dashboard welcome state", async () => {
    mocked.getVaultStatus.mockResolvedValue({ unlocked: false, vaultExists: false, vaultDir: "C:\\Users\\test\\AppData\\Roaming\\LifeScribe", vaultDirAvailable: true });
    mocked.createVault.mockResolvedValue({ unlocked: true, vaultExists: true, vaultDir: "C:\\Users\\test\\AppData\\Roaming\\LifeScribe", vaultDirAvailable: true });
    render(<App />);

    expect(await screen.findByText("Let's set up your vault")).toBeInTheDocument();

    const user = userEvent.setup();
    await completeSetupWizard(user);

    expect(mocked.createVault).toHaveBeenCalledWith(
      "correct horse battery staple",
      "Dana",
    );
    // Dashboard welcome state: warm orientation, 0% framed encouragingly,
    // a single primary CTA toward the first incomplete section.
    expect(await screen.findByText("Welcome, Dana")).toBeInTheDocument();
    expect(screen.getAllByText("0%").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /Start with Digital Executors/ }),
    ).toBeInTheDocument();
    // Checklist entry shows pack sections plus the tool stubs.
    expect(screen.getByRole("button", { name: /^Digital Executors/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recovery Kit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Backup" })).toBeInTheDocument();
  });

  it("persists the chosen form mode into an initial snapshot on create", async () => {
    mocked.getVaultStatus.mockResolvedValue({ unlocked: false, vaultExists: false, vaultDir: "C:\\Users\\test\\AppData\\Roaming\\LifeScribe", vaultDirAvailable: true });
    mocked.createVault.mockResolvedValue({ unlocked: true, vaultExists: true, vaultDir: "C:\\Users\\test\\AppData\\Roaming\\LifeScribe", vaultDirAvailable: true });
    render(<App />);

    expect(await screen.findByText("Let's set up your vault")).toBeInTheDocument();

    const user = userEvent.setup();
    // Choose the secrets ("credential") option at onboarding.
    await completeSetupWizard(user, { chooseSecrets: true });

    // The onboarding choice is written straight into a generation-0 CAS save,
    // so it survives a relaunch even before the user enters any data.
    expect(mocked.saveVaultSnapshot).toHaveBeenCalled();
    const [, baseGeneration] = mocked.saveVaultSnapshot.mock.calls[0];
    expect(baseGeneration).toBe(0);
  });

  it("resets the Form Editor preference to off when a new vault is created", async () => {
    // A previous vault on this machine left the editor enabled; a new vault
    // must not inherit it (localStorage is app-global, not vault-scoped).
    localStorage.setItem("lifescribe.packEditorEnabled", "true");
    mocked.getVaultStatus.mockResolvedValue({ unlocked: false, vaultExists: false, vaultDir: "C:\\Users\\test\\AppData\\Roaming\\LifeScribe", vaultDirAvailable: true });
    mocked.createVault.mockResolvedValue({ unlocked: true, vaultExists: true, vaultDir: "C:\\Users\\test\\AppData\\Roaming\\LifeScribe", vaultDirAvailable: true });
    render(<App />);

    expect(await screen.findByText("Let's set up your vault")).toBeInTheDocument();
    const user = userEvent.setup();
    await completeSetupWizard(user);

    await screen.findByText("Welcome, Dana");
    expect(localStorage.getItem("lifescribe.packEditorEnabled")).not.toBe("true");
    // The Form Editor toggle is off, so its nav item is absent.
    expect(
      screen.queryByRole("button", { name: /form editor/i }),
    ).not.toBeInTheDocument();
    localStorage.clear();
  });

  it("shows the locked screen for an existing vault and reaches the dashboard on unlock", async () => {
    mocked.getVaultStatus.mockResolvedValue({ unlocked: false, vaultExists: true, vaultDir: "C:\\Users\\test\\AppData\\Roaming\\LifeScribe", vaultDirAvailable: true });
    mocked.unlockVault.mockResolvedValue({ unlocked: true, vaultExists: true, vaultDir: "C:\\Users\\test\\AppData\\Roaming\\LifeScribe", vaultDirAvailable: true });
    render(<App />);

    expect(await screen.findByText("Vault locked")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Master password"), "right password!!");
    await user.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await screen.findByText(/Welcome/)).toBeInTheDocument();
  });

  it("moving the vault from Settings lands on the locked screen carrying the notice", async () => {
    const HERE = "C:\\Users\\test\\AppData\\Roaming\\LifeScribe";
    mocked.getVaultStatus.mockResolvedValue({ unlocked: false, vaultExists: true, vaultDir: HERE, vaultDirAvailable: true });
    mocked.unlockVault.mockResolvedValue({ unlocked: true, vaultExists: true, vaultDir: HERE, vaultDirAvailable: true });
    mocked.lockVault.mockResolvedValue({ unlocked: false, vaultExists: true, vaultDir: HERE, vaultDirAvailable: true });
    // The move succeeded but the old copies survived — the user must be told.
    mocked.relocateVault.mockResolvedValue({ vaultDir: "E:\\NewHome", originalsRemoved: false });
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValue("E:\\NewHome");

    render(<App />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Master password"), "right password!!");
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    await screen.findByText(/Welcome/);

    await user.click(screen.getByRole("button", { name: /^Settings$/ }));
    await screen.findByRole("heading", { name: "Settings" });
    await user.click(screen.getByRole("button", { name: /move vault/i }));
    await user.click(await screen.findByRole("button", { name: /^move and lock$/i }));

    // Back on the locked screen, with the leftover-copies warning actually
    // rendered — not merely built and dropped.
    expect(await screen.findByText("Vault locked")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      /old copies could not be removed automatically/i,
    );
    expect(screen.getByRole("status")).toHaveTextContent("E:\\NewHome");

    // A successful unlock clears it, so it never outlives the move it describes.
    await user.type(screen.getByLabelText("Master password"), "right password!!");
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    await screen.findByText(/Welcome/);
    expect(screen.queryByText(/old copies could not be removed/i)).not.toBeInTheDocument();
  });

  it("an unreachable vault folder outranks every other status", async () => {
    // vaultExists is true, so without the availability check this would route to
    // the locked screen; if the backend had fallen back to the default folder it
    // would route to first-run setup. Neither is acceptable — name the folder.
    const AWAY = "E:\\Vault";
    mocked.getVaultStatus
      .mockResolvedValueOnce({ unlocked: false, vaultExists: true, vaultDir: AWAY, vaultDirAvailable: false })
      .mockResolvedValueOnce({ unlocked: false, vaultExists: true, vaultDir: AWAY, vaultDirAvailable: true });
    render(<App />);

    expect(await screen.findByText("Your vault folder can't be reached")).toBeInTheDocument();
    expect(screen.getByText(AWAY)).toBeInTheDocument();
    expect(screen.queryByText("Vault locked")).not.toBeInTheDocument();
    expect(screen.queryByText("Let's set up your vault")).not.toBeInTheDocument();

    // Drive reconnected: Retry re-checks and hands off to unlock.
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Vault locked")).toBeInTheDocument();
  });

  it("an unlocked vault whose folder vanished still shows the recovery screen", async () => {
    mocked.getVaultStatus.mockResolvedValue({
      unlocked: true,
      vaultExists: true,
      vaultDir: "E:\\Vault",
      vaultDirAvailable: false,
    });
    render(<App />);

    expect(await screen.findByText("Your vault folder can't be reached")).toBeInTheDocument();
    expect(screen.queryByText(/Welcome/)).not.toBeInTheDocument();
  });

  it("a wrong password still says so rather than routing to the recovery screen", async () => {
    // The unlock path re-checks availability on failure; that must NOT swallow a
    // genuine password error.
    const HERE = "C:\\Users\\test\\AppData\\Roaming\\LifeScribe";
    mocked.getVaultStatus.mockResolvedValue({ unlocked: false, vaultExists: true, vaultDir: HERE, vaultDirAvailable: true });
    mocked.unlockVault.mockRejectedValue(new Error("InvalidMasterPassword"));
    render(<App />);

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Master password"), "wrong password!!");
    await user.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await screen.findByText(/didn't unlock the vault/i)).toBeInTheDocument();
    expect(screen.queryByText("Your vault folder can't be reached")).not.toBeInTheDocument();
  });

  it("an unlock that fails because the folder vanished shows the recovery screen, not a corruption warning", async () => {
    // The drive was unplugged after the locked screen appeared, so the vault is
    // intact — "restore from a backup" would be the worst possible advice.
    const AWAY = "E:\\Vault";
    mocked.getVaultStatus
      .mockResolvedValueOnce({ unlocked: false, vaultExists: true, vaultDir: AWAY, vaultDirAvailable: true })
      .mockResolvedValue({ unlocked: false, vaultExists: true, vaultDir: AWAY, vaultDirAvailable: false });
    mocked.unlockVault.mockRejectedValue(new Error("CorruptVault"));
    render(<App />);

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Master password"), "right password!!");
    await user.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await screen.findByText("Your vault folder can't be reached")).toBeInTheDocument();
    expect(screen.getByText(AWAY)).toBeInTheDocument();
    expect(screen.queryByText(/restore from a backup/i)).not.toBeInTheDocument();
  });

  it("says why setup handed off to the unlock screen when the chosen folder already holds a vault", async () => {
    const HERE = "C:\\Users\\test\\AppData\\Roaming\\LifeScribe";
    mocked.getVaultStatus.mockResolvedValue({ unlocked: false, vaultExists: false, vaultDir: HERE, vaultDirAvailable: true });
    mocked.setVaultLocation.mockResolvedValue({ unlocked: false, vaultExists: true, vaultDir: "E:\\Existing", vaultDirAvailable: true });
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValue("E:\\Existing");

    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /change folder/i }));

    expect(await screen.findByText("Vault locked")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/already holds a vault/i);
  });

  it("surfaces a status error with a retry", async () => {
    mocked.getVaultStatus
      .mockRejectedValueOnce("StorageError")
      .mockResolvedValueOnce({ unlocked: false, vaultExists: false, vaultDir: "C:\\Users\\test\\AppData\\Roaming\\LifeScribe", vaultDirAvailable: true });
    render(<App />);

    expect(await screen.findByText("Vault status unavailable")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Let's set up your vault")).toBeInTheDocument();
  });
});
