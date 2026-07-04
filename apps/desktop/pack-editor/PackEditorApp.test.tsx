import { render, screen } from "@testing-library/react";
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
    expect(await screen.findByText("Master password")).toBeInTheDocument();
  });
});
