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
}));

const mocked = vi.mocked(vaultApi);

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
    mocked.getVaultStatus.mockResolvedValue({ unlocked: false, vaultExists: false });
    mocked.createVault.mockResolvedValue({ unlocked: true, vaultExists: true });
    render(<App />);

    expect(await screen.findByText("Let's set up your vault")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Your name"), "Dana");
    await user.type(
      screen.getByLabelText("Master password"),
      "correct horse battery staple",
    );
    await user.type(
      screen.getByLabelText("Confirm master password"),
      "correct horse battery staple",
    );
    await user.click(screen.getByLabelText(/I understand there is no recovery/i));
    await user.click(screen.getByRole("button", { name: "Create vault" }));

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

  it("shows the locked screen for an existing vault and reaches the dashboard on unlock", async () => {
    mocked.getVaultStatus.mockResolvedValue({ unlocked: false, vaultExists: true });
    mocked.unlockVault.mockResolvedValue({ unlocked: true, vaultExists: true });
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
      .mockResolvedValueOnce({ unlocked: false, vaultExists: false });
    render(<App />);

    expect(await screen.findByText("Vault status unavailable")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Let's set up your vault")).toBeInTheDocument();
  });
});
