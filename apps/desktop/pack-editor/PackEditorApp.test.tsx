import { fireEvent, render, screen, within } from "@testing-library/react";
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

    it("reorders base fields correctly with an overlay active (index translation)", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      const select = await screen.findByLabelText(/view selection for password manager/i);
      await userEvent.selectOptions(select, "on");

      // View order: fullName, nickname, masterPassword — buildEditorView's
      // documented tie-break keeps the pre-existing field (nickname, order 2)
      // ahead of the added one (masterPassword, also order 2). Moving
      // fullName down swaps it with its immediate base-sourced neighbor,
      // nickname.
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

    it("disables the move button toward an immediate module-owned neighbor (interleaved fields)", async () => {
      mocked.getPack.mockImplementation(async () => {
        const pack = clonePack();
        // Place masterPassword between fullName and nickname in view order:
        // fullName (order 1), masterPassword (order 1, added after — stable
        // sort keeps it right after fullName), nickname (order 2).
        pack.modules![0]!.options[1]!.addFields![0]!.order = 1;
        return { pack };
      });
      render(<PackEditorApp />);
      const select = await screen.findByLabelText(/view selection for password manager/i);
      await userEvent.selectOptions(select, "on");
      await screen.findByRole("button", { name: /edit field Master password/i });

      const moveDown = screen.getByRole("button", { name: /move field Full name down/i });
      expect(moveDown).toBeDisabled();
    });

    it("duplicates a base field via the Duplicate control", async () => {
      render(<PackEditorApp />);
      await userEvent.click(await screen.findByRole("button", { name: /duplicate nickname/i }));

      expect(screen.getAllByRole("button", { name: /edit field Nickname/i })).toHaveLength(2);
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

      const removeButton = await screen.findByRole("button", { name: /remove contacts in this option/i });
      await userEvent.click(removeButton);

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

      const removeButton = await screen.findByRole("button", { name: /remove wallet in this option/i });
      await userEvent.click(removeButton);

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
});
