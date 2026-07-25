import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormPack } from "../src/domain/formModel";
import { validatePack } from "../src/domain/packValidation";
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
    {
      sectionKey: "contacts",
      title: "Contacts",
      lede: "",
      multiRecord: false,
      order: 2,
      groups: [
        {
          groupKey: "contacts-details",
          title: "Details",
          repeatable: false,
          order: 1,
          fields: [
            {
              systemKey: "phone",
              label: "Phone",
              type: "phone",
              required: false,
              protected: false,
              order: 1,
            },
          ],
        },
      ],
      readinessRule: { requiredKeys: [] },
      kitMapping: { entries: [] },
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
          addSections: [
            {
              // Between "identity" (order 1) and "contacts" (order 2) so it
              // renders interleaved in the mixed view list — genuinely
              // exercises the view-index -> base-index translation.
              order: 1.5,
              section: {
                sectionKey: "walletSection",
                title: "Wallet",
                lede: "",
                multiRecord: false,
                order: 1.5,
                groups: [
                  {
                    groupKey: "wallet-details",
                    title: "Details",
                    repeatable: false,
                    order: 1,
                    fields: [
                      {
                        systemKey: "walletKey",
                        label: "Wallet key",
                        type: "text",
                        required: false,
                        protected: false,
                        order: 1,
                      },
                    ],
                  },
                ],
                readinessRule: { requiredKeys: [] },
                kitMapping: { entries: [] },
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

  it("posts the edited base pack (with modules) via savePack, with no variant argument", async () => {
    mocked.savePack.mockResolvedValue(undefined);
    render(<PackEditorApp />);
    await userEvent.click(await screen.findByRole("button", { name: /edit field Full name/i }));
    const label = screen.getByLabelText("Label");
    await userEvent.clear(label);
    await userEvent.type(label, "Legal name");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(mocked.savePack).toHaveBeenCalledTimes(1);
    const call = mocked.savePack.mock.calls[0]!;
    // savePack(base) only — no PackName/variant second argument.
    expect(call).toHaveLength(1);
    const saved = call[0];
    expect(saved.modules).toBeDefined();
    expect(saved.modules).toHaveLength(1);
    expect(saved.modules![0]!.moduleId).toBe("secrets");
    const identitySection = saved.sections.find((s) => s.sectionKey === "identity")!;
    expect(Object.keys(identitySection)).not.toContain("source");
    expect(Object.keys(identitySection)).not.toContain("removed");
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

  describe("Preview's own selection picker (Task 6)", () => {
    it("defaults the Preview picker to each module's defaultOptionId", async () => {
      render(<PackEditorApp />);
      await screen.findByText("Password manager");
      await userEvent.click(screen.getByRole("tab", { name: /preview/i }));
      const preview = screen.getByRole("tabpanel");
      const previewSelect = within(preview).getByLabelText(
        /preview selection for password manager/i,
      ) as HTMLSelectElement;
      expect(previewSelect.value).toBe("off");
      // Default option ("No") does not add Master password.
      expect(within(preview).queryByText("Master password")).not.toBeInTheDocument();
    });

    it("choosing the Preview picker's 'on' option renders that option's added field, without touching the Design overlay", async () => {
      render(<PackEditorApp />);
      await screen.findByText("Password manager");
      await userEvent.click(screen.getByRole("tab", { name: /preview/i }));
      const preview = screen.getByRole("tabpanel");
      const previewSelect = within(preview).getByLabelText(/preview selection for password manager/i);
      await userEvent.selectOptions(previewSelect, "on");

      expect(within(preview).getByText("Master password")).toBeInTheDocument();

      // Design overlay is untouched by the Preview selection.
      await userEvent.click(screen.getByRole("tab", { name: /^design$/i }));
      const designSelect = screen.getByLabelText(
        /view selection for password manager/i,
      ) as HTMLSelectElement;
      expect(designSelect.value).toBe("");
      expect(screen.queryByRole("button", { name: /edit field Master password/i })).not.toBeInTheDocument();
    });

    it("changing the Design overlay selection does not change what Preview shows", async () => {
      render(<PackEditorApp />);
      const designSelect = await screen.findByLabelText(/view selection for password manager/i);
      await userEvent.selectOptions(designSelect, "on");
      expect(await screen.findByRole("button", { name: /edit field Master password/i })).toBeInTheDocument();

      await userEvent.click(screen.getByRole("tab", { name: /preview/i }));
      const preview = screen.getByRole("tabpanel");
      const previewSelect = within(preview).getByLabelText(
        /preview selection for password manager/i,
      ) as HTMLSelectElement;
      // Preview's own picker still shows the module default, unaffected by Design.
      expect(previewSelect.value).toBe("off");
      expect(within(preview).queryByText("Master password")).not.toBeInTheDocument();
    });

    it("shows a visible message instead of a blank pane when the preview combination fails to compose", async () => {
      mocked.getPack.mockImplementation(async () => {
        const pack = clonePack();
        pack.modules![0]!.options[1]!.addFields![0]!.sectionKey = "missing-section";
        return { pack };
      });
      render(<PackEditorApp />);
      await screen.findByText("Password manager");
      await userEvent.click(screen.getByRole("tab", { name: /preview/i }));
      const preview = screen.getByRole("tabpanel");
      const previewSelect = within(preview).getByLabelText(/preview selection for password manager/i);
      await userEvent.selectOptions(previewSelect, "on");

      const message = await within(preview).findByRole("alert");
      expect(message).toHaveTextContent(/preview unavailable for this combination/i);
      expect(message).toHaveTextContent(/missing-section/i);
    });
  });

  it("switches to the JSON tab and shows the base pack", async () => {
    render(<PackEditorApp />);
    await screen.findByText("Password manager");
    await userEvent.click(screen.getByRole("tab", { name: /json/i }));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText(/"packId": "test-pack"/)).toBeInTheDocument();
  });

  describe("overlay editing (Task 3)", () => {
    // dnd-kit's KeyboardSensor computes moves from element rects; jsdom reports
    // all-zero rects, so stub them per field row (keyed on data-field-key) to
    // give the sortable a real vertical order to navigate.
    function mockFieldRects(order: string[]) {
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
        this: Element,
      ) {
        const key = this.getAttribute?.("data-field-key");
        const idx = key ? order.indexOf(key) : -1;
        const top = idx >= 0 ? idx * 40 : 0;
        return {
          top,
          bottom: top + 40,
          left: 0,
          right: 200,
          width: 200,
          height: 40,
          x: 0,
          y: top,
          toJSON() {
            return {};
          },
        } as DOMRect;
      });
    }

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

    it("does not offer an enabled Remove for a field from an overlaid-but-not-active module option (base target active)", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      // Overlay the "Yes" option into the view, but leave the active editing
      // target on Base — Master password is now visible yet owned by a
      // different, non-active layer.
      const select = await screen.findByLabelText(/view selection for password manager/i);
      await userEvent.selectOptions(select, "on");
      await screen.findByRole("button", { name: /edit field Master password/i });

      expect(
        screen.queryByRole("button", { name: /remove field Master password/i }),
      ).not.toBeInTheDocument();

      // Saving must reflect no change at all — not a silently-dropped removal.
      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(mocked.savePack).toHaveBeenCalledTimes(1);
      const saved = mocked.savePack.mock.calls[0]![0];
      const onOption = saved.modules!.find((m) => m.moduleId === "secrets")!.options.find(
        (o) => o.optionId === "on",
      )!;
      expect(onOption.removeKeys ?? []).not.toContain("masterPassword");
      const baseFieldKeys = saved.sections
        .find((s) => s.sectionKey === "identity")!
        .groups.flatMap((g) => g.fields)
        .map((f) => f.systemKey);
      expect(baseFieldKeys).toEqual(["fullName", "nickname"]);
    });

    it("drag-reorders base fields correctly with an overlay active (index translation)", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      // View order: fullName, nickname, masterPassword — buildEditorView's
      // documented tie-break keeps the pre-existing field (nickname, order 2)
      // ahead of the added one (masterPassword, also order 2).
      mockFieldRects(["fullName", "nickname", "masterPassword"]);
      render(<PackEditorApp />);
      const select = await screen.findByLabelText(/view selection for password manager/i);
      await userEvent.selectOptions(select, "on");
      await screen.findByRole("button", { name: /edit field Master password/i });

      // Dragging fullName down one slot swaps it with its immediate
      // base-sourced neighbor, nickname (see the section-nav drag test for why
      // each keydown must let dnd-kit's setTimeout(0) listener flush).
      const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
      const handle = screen.getByRole("button", { name: /drag to reorder Full name/i });
      handle.focus();
      fireEvent.keyDown(handle, { code: "Space" });
      await flush();
      fireEvent.keyDown(handle, { code: "ArrowDown" });
      await flush();
      fireEvent.keyDown(handle, { code: "Space" });
      await flush();

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

    it("does not leak view-only source/removed keys into the saved pack when editing via the property panel", async () => {
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
      expect(Object.keys(field)).not.toContain("source");
      expect(Object.keys(field)).not.toContain("removed");
    });

    it("drag-reorders base fields, skipping a module-added field interleaved between them", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      mocked.getPack.mockImplementation(async () => {
        const pack = clonePack();
        // Place masterPassword between fullName and nickname in view order:
        // fullName (order 1), masterPassword (order 1, added after — stable
        // sort keeps it right after fullName), nickname (order 2).
        pack.modules![0]!.options[1]!.addFields![0]!.order = 1;
        return { pack };
      });
      mockFieldRects(["fullName", "masterPassword", "nickname"]);
      render(<PackEditorApp />);
      const select = await screen.findByLabelText(/view selection for password manager/i);
      await userEvent.selectOptions(select, "on");
      await screen.findByRole("button", { name: /edit field Master password/i });

      // masterPassword (module-added) sits physically between the two base
      // fields; its droppable is disabled, so one ArrowDown skips it and lands
      // fullName on nickname without derailing the base-index translation.
      const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
      const handle = screen.getByRole("button", { name: /drag to reorder Full name/i });
      handle.focus();
      fireEvent.keyDown(handle, { code: "Space" });
      await flush();
      fireEvent.keyDown(handle, { code: "ArrowDown" });
      await flush();
      fireEvent.keyDown(handle, { code: "Space" });
      await flush();

      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(mocked.savePack).toHaveBeenCalledTimes(1);
      const saved = mocked.savePack.mock.calls[0]![0];
      const fields = saved.sections
        .find((s) => s.sectionKey === "identity")!
        .groups.flatMap((g) => g.fields)
        .sort((a, b) => a.order - b.order);
      expect(fields.map((f) => f.systemKey)).toEqual(["nickname", "fullName"]);
    });

    it("duplicates a base field via the Duplicate control", async () => {
      render(<PackEditorApp />);
      await userEvent.click(await screen.findByRole("button", { name: /duplicate nickname/i }));

      expect(screen.getAllByRole("button", { name: /edit field Nickname/i })).toHaveLength(2);
    });

    it("editing the Label of a module-owned field routes through the active target, not the base-only updateField", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      // Make the "Yes" option the active editing target — masterPassword is
      // one of its addFields, so edits to it should be live, not a no-op.
      await userEvent.click(await screen.findByRole("button", { name: /edit yes layer/i }));
      const select = await screen.findByLabelText(/view selection for password manager/i);
      await userEvent.selectOptions(select, "on");

      await userEvent.click(
        await screen.findByRole("button", { name: /edit field Master password/i }),
      );
      const label = screen.getByLabelText("Label");
      await userEvent.clear(label);
      await userEvent.type(label, "Vault master password");

      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(mocked.savePack).toHaveBeenCalledTimes(1);
      const saved = mocked.savePack.mock.calls[0]![0];

      const onOption = saved.modules!.find((m) => m.moduleId === "secrets")!.options.find(
        (o) => o.optionId === "on",
      )!;
      const field = onOption.addFields!.find((a) => a.field.systemKey === "masterPassword")!.field;
      expect(field.label).toBe("Vault master password");
      expect(Object.keys(field)).not.toContain("source");
      expect(Object.keys(field)).not.toContain("removed");

      // The base pack's own sections are untouched.
      const baseFieldKeys = saved.sections
        .find((s) => s.sectionKey === "identity")!
        .groups.flatMap((g) => g.fields)
        .map((f) => f.systemKey);
      expect(baseFieldKeys).toEqual(["fullName", "nickname"]);
    });

    it("adding a field with the Base target active lands in base.sections", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      const addSelect = await screen.findByLabelText(/add field to details/i);
      await userEvent.selectOptions(addSelect, "text");

      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(mocked.savePack).toHaveBeenCalledTimes(1);
      const saved = mocked.savePack.mock.calls[0]![0];
      const fieldKeys = saved.sections
        .find((s) => s.sectionKey === "identity")!
        .groups.flatMap((g) => g.fields)
        .map((f) => f.systemKey);
      expect(fieldKeys).toHaveLength(3);
      expect(fieldKeys).toEqual(expect.arrayContaining(["fullName", "nickname"]));
    });
  });

  describe("editable section nav (Task 4)", () => {
    function mockSectionRects(order: string[]) {
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
        this: Element,
      ) {
        const key = this.getAttribute?.("data-section-key");
        const idx = key ? order.indexOf(key) : -1;
        const top = idx >= 0 ? idx * 40 : 0;
        return {
          top,
          bottom: top + 40,
          left: 0,
          right: 200,
          width: 200,
          height: 40,
          x: 0,
          y: top,
          toJSON() {
            return {};
          },
        } as DOMRect;
      });
    }

    it("renames a base section and saves the new title", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      const titleInput = await screen.findByLabelText(/rename section: identity/i);
      await userEvent.clear(titleInput);
      await userEvent.type(titleInput, "Personal Info");
      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

      expect(mocked.savePack).toHaveBeenCalledTimes(1);
      const saved = mocked.savePack.mock.calls[0]![0];
      expect(saved.sections.find((s) => s.sectionKey === "identity")!.title).toBe("Personal Info");
    });

    it("drag-reorders base sections, skipping a module-added section interleaved between them", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      mockSectionRects(["identity", "walletSection", "contacts"]);
      render(<PackEditorApp />);
      const select = await screen.findByLabelText(/view selection for password manager/i);
      await userEvent.selectOptions(select, "on");
      await screen.findByLabelText(/rename section: wallet/i);

      // dnd-kit's KeyboardSensor attaches its follow-up keydown listener via a
      // setTimeout(0) inside `attach()` (to avoid re-triggering off the very
      // keydown that started the drag) — each key press below must let that
      // macrotask flush before the next one fires, or the sensor never sees it.
      const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
      const handle = screen.getByRole("button", { name: /drag to reorder identity/i });
      handle.focus();
      fireEvent.keyDown(handle, { code: "Space" });
      await flush();
      fireEvent.keyDown(handle, { code: "ArrowDown" });
      await flush();
      fireEvent.keyDown(handle, { code: "Space" });
      await flush();

      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(mocked.savePack).toHaveBeenCalledTimes(1);
      const saved = mocked.savePack.mock.calls[0]![0];
      const orderedKeys = [...saved.sections].sort((a, b) => a.order - b.order).map((s) => s.sectionKey);
      // "identity" moved past "contacts" — "walletSection" (module-added, not
      // in base.sections) sat physically between them but must not derail the
      // base-index translation.
      expect(orderedKeys).toEqual(["contacts", "identity"]);
    });

    it("records a removeSectionKeys entry for a base section when a module option is active, without touching base.sections", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      await userEvent.click(await screen.findByRole("button", { name: /edit yes layer/i }));
      const select = await screen.findByLabelText(/view selection for password manager/i);
      await userEvent.selectOptions(select, "on");

      // Two-step confirm before the removal takes effect.
      await userEvent.click(
        await screen.findByRole("button", { name: /^remove contacts in this option/i }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: /^confirm remove contacts in this option/i }),
      );

      const contactsRow = (await screen.findByLabelText(/rename section: contacts/i)).closest(
        "[data-section-key]",
      );
      expect(contactsRow).toHaveAttribute("data-removed", "true");

      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(mocked.savePack).toHaveBeenCalledTimes(1);
      const saved = mocked.savePack.mock.calls[0]![0];
      const onOption = saved.modules!.find((m) => m.moduleId === "secrets")!.options.find(
        (o) => o.optionId === "on",
      )!;
      expect(onOption.removeSectionKeys).toContain("contacts");
      expect(saved.sections.map((s) => s.sectionKey)).toEqual(
        expect.arrayContaining(["identity", "contacts"]),
      );
    });

    it("cancelling a section remove keeps the section", async () => {
      render(<PackEditorApp />);
      // Base target active by default; back out of removing a base section.
      await userEvent.click(await screen.findByRole("button", { name: /^remove section contacts/i }));
      await userEvent.click(
        screen.getByRole("button", { name: /^cancel removing section contacts/i }),
      );

      const contactsRow = (await screen.findByLabelText(/rename section: contacts/i)).closest(
        "[data-section-key]",
      );
      expect(contactsRow).not.toHaveAttribute("data-removed", "true");
      expect(
        screen.queryByRole("button", { name: /^confirm remove section contacts/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /^remove section contacts/i }),
      ).toBeInTheDocument();
    });

    it("adding a section with a module option active lands in that option's addSections, not base.sections", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      await userEvent.click(await screen.findByRole("button", { name: /edit yes layer/i }));
      await userEvent.click(await screen.findByRole("button", { name: /\+ add section/i }));

      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(mocked.savePack).toHaveBeenCalledTimes(1);
      const saved = mocked.savePack.mock.calls[0]![0];
      expect(saved.sections.map((s) => s.sectionKey)).toEqual(
        expect.arrayContaining(["identity", "contacts"]),
      );
      expect(saved.sections).toHaveLength(2);

      const onOption = saved.modules!.find((m) => m.moduleId === "secrets")!.options.find(
        (o) => o.optionId === "on",
      )!;
      // walletSection (pre-existing) + the newly added section.
      expect(onOption.addSections).toHaveLength(2);
    });

    it("tags a module-added section with its owning module, not base", async () => {
      render(<PackEditorApp />);
      const select = await screen.findByLabelText(/view selection for password manager/i);
      await userEvent.selectOptions(select, "on");

      const walletInput = await screen.findByLabelText(/rename section: wallet/i);
      const row = walletInput.closest("[data-section-key]")!;
      expect(row).toHaveAttribute("data-layer", "other");
      expect(row).toHaveTextContent(/password manager/i);
    });

    it("removing a section the active module option added itself actually removes it (not a dead removeSectionKeys entry)", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      await userEvent.click(await screen.findByRole("button", { name: /edit yes layer/i }));
      const select = await screen.findByLabelText(/view selection for password manager/i);
      await userEvent.selectOptions(select, "on");

      await userEvent.click(
        await screen.findByRole("button", { name: /^remove wallet in this option/i }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: /^confirm remove wallet in this option/i }),
      );

      expect(screen.queryByLabelText(/rename section: wallet/i)).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(mocked.savePack).toHaveBeenCalledTimes(1);
      const saved = mocked.savePack.mock.calls[0]![0];
      const onOption = saved.modules!.find((m) => m.moduleId === "secrets")!.options.find(
        (o) => o.optionId === "on",
      )!;
      expect(onOption.addSections ?? []).toHaveLength(0);
      expect(onOption.removeSectionKeys ?? []).not.toContain("walletSection");
    });
  });

  describe("module authoring + property panels (Task 5)", () => {
    it("creating a module makes it appear and the saved pack gains a valid module", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      await screen.findByText("Password manager");

      await userEvent.click(screen.getByRole("button", { name: /\+ create module/i }));
      expect(await screen.findByText("New Module")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(mocked.savePack).toHaveBeenCalledTimes(1);
      const saved = mocked.savePack.mock.calls[0]![0];

      expect(saved.modules).toHaveLength(2);
      const created = saved.modules!.find((m) => m.moduleId !== "secrets")!;
      expect(created.options.length).toBeGreaterThanOrEqual(2);
      expect(created.options.map((o) => o.optionId)).toContain(created.defaultOptionId);
      expect(validatePack(saved).ok).toBe(true);
    });

    it("editing a module's question is reflected in the saved pack", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      await userEvent.click(
        await screen.findByRole("button", { name: /edit password manager details/i }),
      );

      const question = screen.getByLabelText("Question");
      await userEvent.clear(question);
      await userEvent.type(question, "Do you use a vault app?");

      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(mocked.savePack).toHaveBeenCalledTimes(1);
      const saved = mocked.savePack.mock.calls[0]![0];
      expect(saved.modules!.find((m) => m.moduleId === "secrets")!.question).toBe(
        "Do you use a vault app?",
      );
    });

    it("editing a BASE section's lede via the section property panel is reflected in the saved base.sections", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      const lede = await screen.findByLabelText("Lede");
      await userEvent.type(lede, "Everything about your identity.");

      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(mocked.savePack).toHaveBeenCalledTimes(1);
      const saved = mocked.savePack.mock.calls[0]![0];
      expect(saved.sections.find((s) => s.sectionKey === "identity")!.lede).toBe(
        "Everything about your identity.",
      );
    });

    it("editing a MODULE-ADDED section's lede routes into that option's addSections, not base.sections", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      await userEvent.click(await screen.findByRole("button", { name: /edit yes layer/i }));
      const select = await screen.findByLabelText(/view selection for password manager/i);
      await userEvent.selectOptions(select, "on");

      const walletTitle = await screen.findByLabelText(/rename section: wallet/i);
      await userEvent.click(walletTitle);

      const lede = await screen.findByLabelText("Lede");
      await userEvent.type(lede, "Where the crypto keys live.");

      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(mocked.savePack).toHaveBeenCalledTimes(1);
      const saved = mocked.savePack.mock.calls[0]![0];

      const onOption = saved.modules!.find((m) => m.moduleId === "secrets")!.options.find(
        (o) => o.optionId === "on",
      )!;
      expect(onOption.addSections!.find((a) => a.section.sectionKey === "walletSection")!.section.lede).toBe(
        "Where the crypto keys live.",
      );
      // The base pack does not carry walletSection at all.
      expect(saved.sections.map((s) => s.sectionKey)).not.toContain("walletSection");
    });

    it("removing an option is prevented when it would leave fewer than two options", async () => {
      render(<PackEditorApp />);
      await userEvent.click(
        await screen.findByRole("button", { name: /edit password manager details/i }),
      );
      // Only two options ("No"/"Yes") exist — no enabled Remove control for either.
      expect(screen.queryByRole("button", { name: /remove option no/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /remove option yes/i })).not.toBeInTheDocument();
    });

    it("auto-corrects the default option instead of orphaning it when the default option is removed", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      await userEvent.click(
        await screen.findByRole("button", { name: /edit password manager details/i }),
      );

      await userEvent.click(screen.getByRole("button", { name: /\+ add option/i }));
      // With three options, removing the current default ("No", the module's
      // defaultOptionId) must not orphan defaultOptionId. Two-step confirm.
      await userEvent.click(screen.getByRole("button", { name: /^remove option no/i }));
      await userEvent.click(screen.getByRole("button", { name: /^confirm remove option no/i }));

      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(mocked.savePack).toHaveBeenCalledTimes(1);
      const saved = mocked.savePack.mock.calls[0]![0];
      const module = saved.modules!.find((m) => m.moduleId === "secrets")!;
      expect(module.options.map((o) => o.optionId)).toContain(module.defaultOptionId);
      expect(validatePack(saved).ok).toBe(true);
    });

    it("cancelling an option remove keeps the option", async () => {
      render(<PackEditorApp />);
      await userEvent.click(
        await screen.findByRole("button", { name: /edit password manager details/i }),
      );
      // Add a third option so Remove controls appear, then back out of removing it.
      await userEvent.click(screen.getByRole("button", { name: /\+ add option/i }));
      await userEvent.click(screen.getByRole("button", { name: /^remove option new option/i }));
      await userEvent.click(screen.getByRole("button", { name: /^cancel removing option new option/i }));

      // Prompt dismissed, the option's label field is still present, and the
      // one-click Remove control is back.
      expect(
        screen.queryByRole("button", { name: /^confirm remove option new option/i }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^remove option new option/i })).toBeInTheDocument();
    });

    it("deleting a module removes it from the saved pack and closes the panel", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      await userEvent.click(
        await screen.findByRole("button", { name: /edit password manager details/i }),
      );
      // Two-step confirm: reveal the prompt, then confirm.
      await userEvent.click(
        screen.getByRole("button", { name: /^delete module password manager$/i }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: /confirm delete module password manager/i }),
      );

      // Panel closed and the module is gone from the modules nav.
      expect(screen.queryByLabelText("Question")).not.toBeInTheDocument();
      expect(screen.queryByText("Password manager")).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(mocked.savePack).toHaveBeenCalledTimes(1);
      const saved = mocked.savePack.mock.calls[0]![0];
      expect(saved.modules ?? []).toHaveLength(0);
      expect(validatePack(saved).ok).toBe(true);
    });

    it("cancelling the delete confirmation keeps the module", async () => {
      render(<PackEditorApp />);
      await userEvent.click(
        await screen.findByRole("button", { name: /edit password manager details/i }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: /^delete module password manager$/i }),
      );
      // Back out of the confirmation.
      await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

      // Prompt dismissed, module still editable, delete button back to step one.
      expect(
        screen.queryByRole("button", { name: /confirm delete module password manager/i }),
      ).not.toBeInTheDocument();
      expect(screen.getByLabelText("Question")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /^delete module password manager$/i }),
      ).toBeInTheDocument();
    });

    it("resets the active target to Base when the active module is deleted", async () => {
      render(<PackEditorApp />);
      // Make one of the module's option layers the active editing target.
      await userEvent.click(await screen.findByRole("button", { name: /edit yes layer/i }));
      // Open that module's panel and delete it.
      await userEvent.click(
        screen.getByRole("button", { name: /edit password manager details/i }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: /^delete module password manager$/i }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: /confirm delete module password manager/i }),
      );

      // The option-layer targets vanish and the base design surface is intact
      // (no dangling active target pointing at the deleted module).
      expect(screen.queryByRole("button", { name: /edit yes layer/i })).not.toBeInTheDocument();
      expect(
        await screen.findByRole("button", { name: /edit field Full name/i }),
      ).toBeInTheDocument();
    });
  });
});
