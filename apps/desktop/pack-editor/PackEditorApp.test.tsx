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

describe("PackEditorApp", () => {
  it("loads the credential form and shows a credential-only field", async () => {
    render(<PackEditorApp />);
    await userEvent.click(
      await screen.findByRole("button", { name: /password manager/i }),
    );
    const preview = await screen.findByRole("region", { name: "Preview" });
    expect(within(preview).getByText("Master password")).toBeInTheDocument();
  });

  it("edits a field label and saves the edited pack", async () => {
    mocked.savePack.mockResolvedValue(undefined);
    render(<PackEditorApp />);

    await userEvent.click(
      await screen.findByRole("button", { name: /password manager/i }),
    );
    const labelInput = await screen.findByDisplayValue("Master password");
    await userEvent.clear(labelInput);
    await userEvent.type(labelInput, "Vault master password");

    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(mocked.savePack).toHaveBeenCalledTimes(1);
    const savedPack = mocked.savePack.mock.calls[0]![0];
    const pm = savedPack.sections.find((s) => s.sectionKey === "password-manager")!;
    const field = pm.groups
      .flatMap((g) => g.fields)
      .find((f) => f.systemKey === "passwordManagerMasterPassword")!;
    expect(field.label).toBe("Vault master password");
  });

  it("blocks save and shows an error when the pack is invalid", async () => {
    mocked.savePack.mockResolvedValue(undefined);
    render(<PackEditorApp />);
    await userEvent.click(
      await screen.findByRole("button", { name: /password manager/i }),
    );
    const labelInput = await screen.findByDisplayValue("Master password");
    await userEvent.clear(labelInput); // empty label -> validatePack fails

    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(mocked.savePack).not.toHaveBeenCalled();
  });

  it("removes an added field (the master password) from the form", async () => {
    render(<PackEditorApp />);
    await userEvent.click(
      await screen.findByRole("button", { name: /password manager/i }),
    );
    const labelInput = await screen.findByDisplayValue("Master password");
    const editor = labelInput.closest(".inline-field-editor") as HTMLElement;
    await userEvent.click(
      within(editor).getByRole("button", { name: /remove field/i }),
    );

    expect(screen.queryByDisplayValue("Master password")).not.toBeInTheDocument();
  });
});
