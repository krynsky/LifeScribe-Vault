import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import defaultPack from "../src-tauri/resources/packs/default-pack.json";
import overlay from "../scripts/credential-overlay.json";
import type { FormPack } from "../src/domain/formModel";
import * as api from "./api";
import { PackEditorApp } from "./PackEditorApp";

const hintPack = defaultPack as unknown as FormPack;

vi.mock("./api", () => ({ getPack: vi.fn(), savePack: vi.fn() }));
const mocked = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.getPack.mockResolvedValue({ hintPack, overlay });
});

async function openPasswordManager() {
  render(<PackEditorApp />);
  await userEvent.click(await screen.findByRole("button", { name: /password manager plan/i }));
}

describe("PackEditorApp", () => {
  it("lists the credential-only field row after loading", async () => {
    await openPasswordManager();
    expect(
      await screen.findByRole("button", { name: /edit field Master password/i }),
    ).toBeInTheDocument();
  });

  it("selecting a field edits it in the property panel and saves", async () => {
    mocked.savePack.mockResolvedValue(undefined);
    await openPasswordManager();
    await userEvent.click(await screen.findByRole("button", { name: /edit field Master password/i }));

    const label = screen.getByLabelText("Label");
    await userEvent.clear(label);
    await userEvent.type(label, "Vault master password");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(mocked.savePack).toHaveBeenCalledTimes(1);
    const saved = mocked.savePack.mock.calls[0]![0];
    const field = saved.sections
      .find((s) => s.sectionKey === "password-manager")!
      .groups.flatMap((g) => g.fields)
      .find((f) => f.systemKey === "passwordManagerMasterPassword")!;
    expect(field.label).toBe("Vault master password");
  });

  it("blocks save with an alert when a label is emptied", async () => {
    mocked.savePack.mockResolvedValue(undefined);
    await openPasswordManager();
    await userEvent.click(await screen.findByRole("button", { name: /edit field Master password/i }));
    await userEvent.clear(screen.getByLabelText("Label"));
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(mocked.savePack).not.toHaveBeenCalled();
  });

  it("removes an added field", async () => {
    await openPasswordManager();
    await userEvent.click(
      screen.getByRole("button", { name: /remove field Master password/i }),
    );
    expect(
      screen.queryByRole("button", { name: /edit field Master password/i }),
    ).not.toBeInTheDocument();
  });

  it("switches to the Preview tab and shows the field read-only", async () => {
    await openPasswordManager();
    await userEvent.click(screen.getByRole("tab", { name: /preview/i }));
    const preview = screen.getByRole("tabpanel");
    expect(within(preview).getByText("Master password")).toBeInTheDocument();
  });

  it("switches to the JSON tab and shows the derived overlay", async () => {
    await openPasswordManager();
    await userEvent.click(screen.getByRole("tab", { name: /json/i }));
    const panel = screen.getByRole("tabpanel");
    expect(
      within(panel).getByText(/"packId": "lifescribe-default-credential"/),
    ).toBeInTheDocument();
  });
});
