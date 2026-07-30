import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as vaultApi from "../api/vaultApi";
import { loadDefaultPack } from "../domain/loadDefaultPack";
import { SetupScreen } from "./SetupScreen";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../api/vaultApi", () => ({
  getVaultStatus: vi.fn(),
  setVaultLocation: vi.fn(),
}));
const mocked = vi.mocked(vaultApi);

const PW = "correct horse battery staple";

// The secrets module's non-default ("on") option label is read from the real
// bundled pack rather than hard-coded, so these tests assert the true behavior
// (secrets set to "on") regardless of the exact copy. `secretsOnLabel` is that
// label; matching it selects the option that flips secrets on without coupling
// the test to the module's display wording.
let secretsOnLabel = "";

beforeAll(async () => {
  const pack = await loadDefaultPack();
  const secrets = (pack.modules ?? []).find((m) => m.moduleId === "secrets");
  const onOption = secrets?.options.find(
    (option) => option.optionId !== secrets.defaultOptionId,
  );
  secretsOnLabel = onOption?.label ?? onOption?.optionId ?? "";
});

beforeEach(() => {
  vi.clearAllMocks();
  mocked.getVaultStatus.mockResolvedValue({
    unlocked: false,
    vaultExists: false,
    vaultDir: "C:\\Users\\test\\AppData\\Roaming\\LifeScribe",
    vaultDirAvailable: true,
  });
});

/** Accept the default vault folder (step 0) and land on the identity step. */
async function goToIdentityStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /^next$/i }));
  await screen.findByLabelText("Master password");
}

async function completeStepOne(user: ReturnType<typeof userEvent.setup>) {
  // Folder step: accept the default.
  await goToIdentityStep(user);
  // Identity step.
  await user.type(screen.getByLabelText("Your name"), "Dana");
  await user.type(screen.getByLabelText("Master password"), PW);
  await user.type(screen.getByLabelText("Confirm master password"), PW);
  await user.click(screen.getByRole("checkbox", { name: /no recovery/i }));
  await user.click(screen.getByRole("button", { name: /^next$/i }));
}

describe("SetupScreen wizard", () => {
  it("opens on the folder step showing the default location", async () => {
    render(<SetupScreen onCreate={vi.fn()} onVaultFound={vi.fn()} />);

    expect(await screen.findByText(/where your vault is stored/i)).toBeInTheDocument();
    expect(screen.getByText(/C:\\Users\\test\\AppData/)).toBeInTheDocument();
    // Name/password belong to the NEXT step.
    expect(screen.queryByLabelText("Master password")).not.toBeInTheDocument();
  });

  it("choosing a folder that already holds a vault hands off to unlock", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValue("D:\\Vaults\\Existing");
    mocked.setVaultLocation.mockResolvedValue({
      unlocked: false,
      vaultExists: true,
      vaultDir: "D:\\Vaults\\Existing",
      vaultDirAvailable: true,
    });
    const onVaultFound = vi.fn();

    render(<SetupScreen onCreate={vi.fn()} onVaultFound={onVaultFound} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /change folder/i }));

    await waitFor(() => expect(onVaultFound).toHaveBeenCalledTimes(1));
    // The handoff happens before any password is asked for.
    expect(screen.queryByLabelText("Master password")).not.toBeInTheDocument();
  });

  it("choosing an empty folder advances to name and password", async () => {
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
    await user.click(await screen.findByRole("button", { name: /change folder/i }));
    await screen.findByText("D:\\Vaults\\Fresh");
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByLabelText("Master password")).toBeInTheDocument();
  });

  it("walks name/password, then one step per module, and Create emits moduleSelections", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<SetupScreen onCreate={onCreate} onVaultFound={vi.fn()} />);
    const user = userEvent.setup();
    await completeStepOne(user);
    const secretsRadio = await screen.findByRole("radio", { name: secretsOnLabel });
    await user.click(secretsRadio);
    await user.click(screen.getByRole("button", { name: /^next$/i }));
    await user.click(screen.getByRole("button", { name: /create vault/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const [password, name, selections] = onCreate.mock.calls[0];
    expect(password).toBe(PW);
    expect(name).toBe("Dana");
    expect(selections.secrets).toBe("on");
    expect(selections["file-method"]).toBe("path");
  });

  it("blocks leaving step one until the password is valid and acknowledged", async () => {
    render(<SetupScreen onCreate={vi.fn()} onVaultFound={vi.fn()} />);
    const user = userEvent.setup();
    await goToIdentityStep(user);
    await user.type(screen.getByLabelText("Master password"), "short");
    await user.type(screen.getByLabelText("Confirm master password"), "short");
    await user.click(screen.getByRole("button", { name: /^next$/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/at least 15 characters/i);
  });

  it("lets the user go Back to a previous step without losing entries", async () => {
    render(<SetupScreen onCreate={vi.fn()} onVaultFound={vi.fn()} />);
    const user = userEvent.setup();
    await completeStepOne(user);
    await screen.findByRole("radio", { name: secretsOnLabel });
    await user.click(screen.getByRole("button", { name: /^back$/i }));
    expect(screen.getByLabelText("Your name")).toHaveValue("Dana");
  });

  it("blocks mismatched passwords with a friendly error", async () => {
    render(<SetupScreen onCreate={vi.fn()} onVaultFound={vi.fn()} />);
    const user = userEvent.setup();
    await goToIdentityStep(user);
    await user.type(screen.getByLabelText("Master password"), PW);
    await user.type(screen.getByLabelText("Confirm master password"), "different but long enough");
    await user.click(screen.getByRole("checkbox", { name: /no recovery/i }));
    await user.click(screen.getByRole("button", { name: /^next$/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/don't match/i);
  });

  it("reveals and re-hides the master password with the in-field toggle", async () => {
    render(<SetupScreen onCreate={vi.fn()} onVaultFound={vi.fn()} />);
    const user = userEvent.setup();
    await goToIdentityStep(user);

    const master = screen.getByLabelText("Master password");
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

  it("presents the module question alone, with no composed-pack preview", async () => {
    render(<SetupScreen onCreate={vi.fn()} onVaultFound={vi.fn()} />);
    const user = userEvent.setup();
    await completeStepOne(user);
    await screen.findByRole("radio", { name: secretsOnLabel });

    expect(screen.queryByText("Preview this choice")).not.toBeInTheDocument();
    expect(screen.queryByText("Digital Executors")).not.toBeInTheDocument();
  });
});
