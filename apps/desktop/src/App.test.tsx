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
}));

const mocked = vi.mocked(vaultApi);

const SETUP_PASSWORD = "correct horse battery staple";

/**
 * Drive the setup wizard: fill step 0 (name + password + acknowledgment),
 * then advance through each module step to the final Create action. When
 * `chooseSecrets` is set, the secrets module's "on" option is selected on its
 * step. The wizard shows one module per step (secrets, then file-method).
 */
async function completeSetupWizard(
  user: ReturnType<typeof userEvent.setup>,
  options: { chooseSecrets?: boolean } = {},
) {
  await user.type(screen.getByLabelText("Your name"), "Dana");
  await user.type(screen.getByLabelText("Master password"), SETUP_PASSWORD);
  await user.type(screen.getByLabelText("Confirm master password"), SETUP_PASSWORD);
  await user.click(screen.getByLabelText(/I understand there is no recovery/i));
  await user.click(screen.getByRole("button", { name: /^next$/i }));

  // Step 1: secrets module.
  if (options.chooseSecrets) {
    await user.click(screen.getByRole("radio", { name: /store the actual passwords/i }));
  }
  await user.click(screen.getByRole("button", { name: /^next$/i }));

  // Step 2 (final): file-method module — Create the vault.
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
    const [snapshot, baseGeneration] = mocked.saveVaultSnapshot.mock.calls[0];
    expect((snapshot as { profile: { formMode: string } }).profile.formMode).toBe(
      "credential",
    );
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
