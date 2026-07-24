import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormPack } from "../src/domain/formModel";
import * as api from "./api";
import { PackEditorApp } from "./PackEditorApp";

vi.mock("./api", () => ({ getPack: vi.fn(), savePack: vi.fn(), backupPacks: vi.fn() }));
const mocked = vi.mocked(api);

const basePack: FormPack = {
  packId: "test-pack",
  packVersion: "1.0.0",
  schemaVersion: 1,
  minAppVersion: "0.0.0",
  migrations: [],
  sections: [
    {
      sectionKey: "identity",
      title: "Identity",
      lede: "",
      multiRecord: false,
      order: 1,
      groups: [
        {
          groupKey: "identity-details",
          title: "Details",
          repeatable: false,
          order: 1,
          fields: [
            {
              systemKey: "fullName",
              label: "Full name",
              type: "text",
              required: true,
              protected: true,
              order: 1,
            },
            {
              systemKey: "nickname",
              label: "Nickname",
              type: "text",
              required: false,
              protected: false,
              order: 2,
            },
          ],
        },
      ],
      readinessRule: { requiredKeys: ["fullName"] },
      kitMapping: { entries: [{ heading: "Identity", fields: ["fullName"] }] },
    },
  ],
  modules: [
    {
      moduleId: "secrets",
      title: "Password manager",
      question: "Do you use a password manager?",
      options: [
        { optionId: "off", label: "No" },
        {
          optionId: "on",
          label: "Yes",
          addFields: [
            {
              sectionKey: "identity",
              groupKey: "identity-details",
              order: 2,
              field: {
                systemKey: "masterPassword",
                label: "Master password",
                type: "text",
                required: false,
                protected: false,
                order: 2,
              },
            },
          ],
        },
      ],
      defaultOptionId: "off",
      order: 1,
    },
  ],
};

function clonePack(): FormPack {
  return JSON.parse(JSON.stringify(basePack)) as FormPack;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.getPack.mockImplementation(async () => ({ pack: clonePack() }));
});

describe("PackEditorApp", () => {
  it("no longer shows the old hint/credential pack selector", async () => {
    render(<PackEditorApp />);
    await screen.findByText("Password manager");
    expect(screen.queryByText(/credential/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/locations only/i)).not.toBeInTheDocument();
  });

  it("lists modules in a side panel by title", async () => {
    render(<PackEditorApp />);
    expect(await screen.findByText("Password manager")).toBeInTheDocument();
  });

  it("choosing a module option overlays its added field into the view", async () => {
    render(<PackEditorApp />);
    const select = await screen.findByLabelText(/view selection for password manager/i);
    expect(
      screen.queryByRole("button", { name: /edit field Master password/i }),
    ).not.toBeInTheDocument();

    await userEvent.selectOptions(select, "on");

    expect(
      await screen.findByRole("button", { name: /edit field Master password/i }),
    ).toBeInTheDocument();
  });

  it("marks the active editing target and moves it back to Base", async () => {
    render(<PackEditorApp />);
    await screen.findByText("Password manager");

    const baseButton = screen.getByRole("button", { name: /^base$/i });
    expect(baseButton).toHaveAttribute("aria-current", "true");

    const editOnLayer = screen.getByRole("button", { name: /edit yes layer/i });
    expect(editOnLayer).not.toHaveAttribute("aria-current", "true");

    await userEvent.click(editOnLayer);
    expect(editOnLayer).toHaveAttribute("aria-current", "true");
    expect(baseButton).not.toHaveAttribute("aria-current", "true");

    await userEvent.click(baseButton);
    expect(baseButton).toHaveAttribute("aria-current", "true");
    expect(editOnLayer).not.toHaveAttribute("aria-current", "true");
  });

  it("selecting a base field edits it in the property panel and saves", async () => {
    mocked.savePack.mockResolvedValue(undefined);
    render(<PackEditorApp />);
    await userEvent.click(await screen.findByRole("button", { name: /edit field Full name/i }));

    const label = screen.getByLabelText("Label");
    await userEvent.clear(label);
    await userEvent.type(label, "Legal name");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(mocked.savePack).toHaveBeenCalledTimes(1);
    const saved = mocked.savePack.mock.calls[0]![0];
    const field = saved.sections
      .find((s) => s.sectionKey === "identity")!
      .groups.flatMap((g) => g.fields)
      .find((f) => f.systemKey === "fullName")!;
    expect(field.label).toBe("Legal name");
  });

  it("removes an added base field", async () => {
    render(<PackEditorApp />);
    await userEvent.click(
      await screen.findByRole("button", { name: /remove field Nickname/i }),
    );
    expect(
      screen.queryByRole("button", { name: /edit field Nickname/i }),
    ).not.toBeInTheDocument();
  });

  it("blocks save with an alert when a label is emptied", async () => {
    mocked.savePack.mockResolvedValue(undefined);
    render(<PackEditorApp />);
    await userEvent.click(await screen.findByRole("button", { name: /edit field Full name/i }));
    await userEvent.clear(screen.getByLabelText("Label"));
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(mocked.savePack).not.toHaveBeenCalled();
  });

  it("backs up the pack files and reports the backup folder", async () => {
    mocked.backupPacks.mockResolvedValue("scripts/pack-backups/2026-07-05T00-00-00-000Z");
    render(<PackEditorApp />);
    await screen.findByText("Password manager");
    await userEvent.click(screen.getByRole("button", { name: /back up packs/i }));

    expect(mocked.backupPacks).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(/Backed up to scripts\/pack-backups\/2026-07-05T00-00-00-000Z/),
    ).toBeInTheDocument();
    expect(mocked.savePack).not.toHaveBeenCalled();
  });

  it("shows an alert when the backup fails", async () => {
    mocked.backupPacks.mockRejectedValue(new Error("disk full"));
    render(<PackEditorApp />);
    await screen.findByText("Password manager");
    await userEvent.click(screen.getByRole("button", { name: /back up packs/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
  });

  it("switches to the Preview tab and shows the base field read-only", async () => {
    render(<PackEditorApp />);
    await screen.findByText("Password manager");
    await userEvent.click(screen.getByRole("tab", { name: /preview/i }));
    const preview = screen.getByRole("tabpanel");
    expect(within(preview).getByText("Full name")).toBeInTheDocument();
  });

  it("Preview reflects an overlaid module option", async () => {
    render(<PackEditorApp />);
    const select = await screen.findByLabelText(/view selection for password manager/i);
    await userEvent.selectOptions(select, "on");

    await userEvent.click(screen.getByRole("tab", { name: /preview/i }));
    const preview = screen.getByRole("tabpanel");
    expect(within(preview).getByText("Master password")).toBeInTheDocument();
  });

  it("switches to the JSON tab and shows the base pack", async () => {
    render(<PackEditorApp />);
    await screen.findByText("Password manager");
    await userEvent.click(screen.getByRole("tab", { name: /json/i }));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText(/"packId": "test-pack"/)).toBeInTheDocument();
  });

  describe("overlay editing (Task 3)", () => {
    it("adding a field with a module option active lands in that option's addFields, not base.sections", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      await userEvent.click(await screen.findByRole("button", { name: /edit yes layer/i }));

      const select = await screen.findByLabelText(/view selection for password manager/i);
      await userEvent.selectOptions(select, "on");

      const addSelect = await screen.findByLabelText(/add field to details/i);
      await userEvent.selectOptions(addSelect, "text");

      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(mocked.savePack).toHaveBeenCalledTimes(1);
      const saved = mocked.savePack.mock.calls[0]![0];

      const baseFieldKeys = saved.sections
        .find((s) => s.sectionKey === "identity")!
        .groups.flatMap((g) => g.fields)
        .map((f) => f.systemKey);
      // The two original base fields only — nothing new landed in base.sections.
      expect(baseFieldKeys).toEqual(["fullName", "nickname"]);

      const onOption = saved.modules!.find((m) => m.moduleId === "secrets")!.options.find(
        (o) => o.optionId === "on",
      )!;
      // masterPassword (pre-existing) + the newly added field.
      expect(onOption.addFields).toHaveLength(2);
    });

    it("removing a base field with a module option active records a removeKey and shows it struck through", async () => {
      render(<PackEditorApp />);
      await userEvent.click(await screen.findByRole("button", { name: /edit yes layer/i }));
      const select = await screen.findByLabelText(/view selection for password manager/i);
      await userEvent.selectOptions(select, "on");

      const removeButton = await screen.findByRole("button", { name: /remove field Nickname/i });
      await userEvent.click(removeButton);

      const nicknameRow = (await screen.findByRole("button", { name: /edit field Nickname/i })).closest(
        "[data-removed]",
      );
      expect(nicknameRow).toHaveAttribute("data-removed", "true");
    });

    it("selecting a field owned by a different layer shows a switch-target message instead of a dead editable panel", async () => {
      render(<PackEditorApp />);
      const select = await screen.findByLabelText(/view selection for password manager/i);
      await userEvent.selectOptions(select, "on");

      await userEvent.click(await screen.findByRole("button", { name: /edit field Master password/i }));

      expect(screen.queryByLabelText("Label")).not.toBeInTheDocument();
      const message = screen.getByText(/switch the active target to edit it/i);
      expect(message).toHaveTextContent(/password manager/i);
    });

    it("reorders base fields correctly with an overlay active (index translation)", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      const select = await screen.findByLabelText(/view selection for password manager/i);
      await userEvent.selectOptions(select, "on");

      // View order: fullName (base), masterPassword (module), nickname (base).
      await screen.findByRole("button", { name: /edit field Master password/i });
      const moveDown = screen.getByRole("button", { name: /move field Full name down/i });
      await userEvent.click(moveDown);

      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(mocked.savePack).toHaveBeenCalledTimes(1);
      const saved = mocked.savePack.mock.calls[0]![0];
      const fields = saved.sections
        .find((s) => s.sectionKey === "identity")!
        .groups.flatMap((g) => g.fields)
        .sort((a, b) => a.order - b.order);
      expect(fields.map((f) => f.systemKey)).toEqual(["nickname", "fullName"]);
    });

    it("renders a warnings notice from buildEditorView", async () => {
      mocked.getPack.mockImplementation(async () => {
        const pack = clonePack();
        pack.modules![0]!.options[1]!.addFields![0]!.sectionKey = "missing-section";
        return { pack };
      });
      render(<PackEditorApp />);
      const select = await screen.findByLabelText(/view selection for password manager/i);
      await userEvent.selectOptions(select, "on");

      expect(await screen.findByText(/could not be placed/i)).toBeInTheDocument();
    });
  });
});
