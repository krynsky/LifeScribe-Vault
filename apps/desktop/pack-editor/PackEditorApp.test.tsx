import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIELD_TYPES } from "../src/domain/formModel";
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
};

function clonePack(): FormPack {
  return JSON.parse(JSON.stringify(basePack)) as FormPack;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.getPack.mockImplementation(async () => ({ pack: clonePack() }));
});

// The drag tests spy on getBoundingClientRect; without this the stub leaks into
// every later test in the file.
afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * dnd-kit's KeyboardSensor computes moves from element rects; jsdom reports
 * all-zero rects, so stub them per row (keyed on `attr`) to give the sortable a
 * real vertical order to navigate.
 */
function mockRowRects(attr: string, order: string[]) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const key = this.getAttribute?.(attr);
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

/**
 * Drives a dnd-kit keyboard drag one slot in `direction`. Each key press must
 * let a macrotask flush: KeyboardSensor attaches its follow-up keydown listener
 * via a setTimeout(0) inside `attach()`.
 */
async function keyboardDrag(handle: HTMLElement, direction: "ArrowDown" | "ArrowUp") {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  handle.focus();
  fireEvent.keyDown(handle, { code: "Space" });
  await flush();
  fireEvent.keyDown(handle, { code: direction });
  await flush();
  fireEvent.keyDown(handle, { code: "Space" });
  await flush();
}

/** The single pack handed to the most recent savePack call. */
function savedPack(): FormPack {
  expect(mocked.savePack).toHaveBeenCalledTimes(1);
  return mocked.savePack.mock.calls[0]![0];
}

async function save() {
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
}

describe("PackEditorApp", () => {
  it("offers no way to create, edit, or delete a module (R11)", async () => {
    render(<PackEditorApp />);
    await screen.findByRole("button", { name: /edit field Full name/i });

    expect(screen.queryByRole("button", { name: /create module/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /modules/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/module/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/view selection for/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^base$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /layer/i })).not.toBeInTheDocument();
  });

  it("renders one section's property panel directly, with no origin label or locked notice (R12)", async () => {
    render(<PackEditorApp />);
    // The default (no field selected) panel edits the active section itself.
    expect(await screen.findByLabelText("Section title")).toHaveValue("Identity");
    expect(screen.queryByText(/switch the active target/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^from /i)).not.toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();

    const identityRow = screen.getByLabelText(/rename section: identity/i).closest("[data-section-key]")!;
    expect(identityRow).not.toHaveAttribute("data-layer");
    expect(identityRow).not.toHaveAttribute("data-removed");
  });

  it("renders the Preview tab with no module selectors (R13)", async () => {
    render(<PackEditorApp />);
    await screen.findByRole("button", { name: /edit field Full name/i });
    await userEvent.click(screen.getByRole("tab", { name: /preview/i }));

    const preview = screen.getByRole("tabpanel");
    expect(within(preview).getByText("Full name")).toBeInTheDocument();
    expect(within(preview).queryByLabelText(/preview selection for/i)).not.toBeInTheDocument();
    expect(within(preview).queryByRole("combobox")).not.toBeInTheDocument();
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
    const call = mocked.savePack.mock.calls[0]!;
    // savePack(pack) only — no variant second argument.
    expect(call).toHaveLength(2);
    expect(call[1]).toEqual(basePack);
    const field = call[0].sections
      .find((s) => s.sectionKey === "identity")!
      .groups.flatMap((g) => g.fields)
      .find((f) => f.systemKey === "fullName")!;
    expect(field.label).toBe("Legal name");
  });

  it("adds a field and persists it to the saved pack", async () => {
    mocked.savePack.mockResolvedValue(undefined);
    render(<PackEditorApp />);
    const addSelect = await screen.findByLabelText(/add field to details/i);
    await userEvent.selectOptions(addSelect, "text");

    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(mocked.savePack).toHaveBeenCalledTimes(1);
    const fieldKeys = mocked.savePack.mock.calls[0]![0].sections
      .find((s) => s.sectionKey === "identity")!
      .groups.flatMap((g) => g.fields)
      .map((f) => f.systemKey);
    expect(fieldKeys).toHaveLength(3);
    expect(fieldKeys).toEqual(expect.arrayContaining(["fullName", "nickname"]));
  });

  it("removes a field and persists its removal to the saved pack", async () => {
    mocked.savePack.mockResolvedValue(undefined);
    render(<PackEditorApp />);
    await userEvent.click(await screen.findByRole("button", { name: /remove field Nickname/i }));
    expect(screen.queryByRole("button", { name: /edit field Nickname/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(mocked.savePack).toHaveBeenCalledTimes(1);
    const fieldKeys = mocked.savePack.mock.calls[0]![0].sections
      .find((s) => s.sectionKey === "identity")!
      .groups.flatMap((g) => g.fields)
      .map((f) => f.systemKey);
    expect(fieldKeys).toEqual(["fullName"]);
  });

  it("offers no Remove control for a protected field", async () => {
    render(<PackEditorApp />);
    await screen.findByRole("button", { name: /edit field Full name/i });
    expect(
      screen.queryByRole("button", { name: /remove field Full name/i }),
    ).not.toBeInTheDocument();
  });

  it("does not offer duplicate controls", async () => {
    render(<PackEditorApp />);
    await screen.findByRole("button", { name: /edit field Full name/i });
    expect(screen.queryByRole("button", { name: /duplicate/i })).not.toBeInTheDocument();
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
    await screen.findByRole("button", { name: /edit field Full name/i });
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
    await screen.findByRole("button", { name: /edit field Full name/i });
    await userEvent.click(screen.getByRole("button", { name: /back up packs/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
  });

  it("switches to the JSON tab and shows the pack", async () => {
    render(<PackEditorApp />);
    await screen.findByRole("button", { name: /edit field Full name/i });
    await userEvent.click(screen.getByRole("tab", { name: /json/i }));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText(/"packId": "test-pack"/)).toBeInTheDocument();
  });

  it("shows Design-tab edits in the JSON tab", async () => {
    render(<PackEditorApp />);
    const titleInput = await screen.findByLabelText(/rename section: identity/i);
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Personal Info");

    await userEvent.click(screen.getByRole("tab", { name: /json/i }));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText(/"title": "Personal Info"/)).toBeInTheDocument();
    expect(within(panel).queryByText(/"title": "Identity"/)).not.toBeInTheDocument();
  });

  it("reloads the pack from disk after a successful save", async () => {
    mocked.savePack.mockResolvedValue(undefined);
    render(<PackEditorApp />);
    const titleInput = await screen.findByLabelText(/rename section: identity/i);
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Draft title");

    // The reload returns the on-disk pack, so the editor drops the local edit
    // and shows what was actually persisted.
    await save();

    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(mocked.getPack).toHaveBeenCalledTimes(2);
    expect(await screen.findByLabelText(/rename section: identity/i)).toHaveValue("Identity");
  });

  it("shows an alert when the save fails", async () => {
    mocked.savePack.mockRejectedValue(new Error("pack file is read-only"));
    render(<PackEditorApp />);
    await screen.findByRole("button", { name: /edit field Full name/i });
    await save();

    expect(await screen.findByRole("alert")).toHaveTextContent("pack file is read-only");
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
  });

  describe("field editing", () => {
    it("drag-reorders fields and persists the new order", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      mockRowRects("data-field-key", ["fullName", "nickname"]);
      render(<PackEditorApp />);
      await screen.findByRole("button", { name: /edit field Full name/i });

      await keyboardDrag(
        screen.getByRole("button", { name: /drag to reorder Full name/i }),
        "ArrowDown",
      );

      await save();
      const fields = savedPack()
        .sections.find((s) => s.sectionKey === "identity")!
        .groups.flatMap((g) => g.fields)
        .sort((a, b) => a.order - b.order);
      expect(fields.map((f) => f.systemKey)).toEqual(["nickname", "fullName"]);
    });

    // Each type is a real menu choice a pack author picks; the add path stores
    // whatever type it was given, so one assertion per type is the cheap way to
    // catch a type dropped from the menu or mangled on the way to the pack.
    it.each(FIELD_TYPES)("adds a %s field to the group it was added from", async (type) => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      await userEvent.selectOptions(await screen.findByLabelText(/add field to details/i), type);

      if (type === "select") {
        // validatePack rejects an optionless select, so authoring one is a
        // two-step flow: add the field, then give it at least one option.
        await userEvent.click(screen.getByRole("button", { name: /edit field New Field/i }));
        await userEvent.type(screen.getByLabelText("Value"), "Checking");
        await userEvent.click(screen.getByRole("button", { name: /add option/i }));
      }

      await save();
      const groups = savedPack().sections.find((s) => s.sectionKey === "identity")!.groups;
      const added = groups
        .find((g) => g.groupKey === "identity-details")!
        .fields.find((f) => f.label === "New Field")!;
      expect(added.type).toBe(type);
      expect(added.required).toBe(false);
      expect(added.protected).toBe(false);
    });

    it("adds a field to the active section's own group, not another section's", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      // Focusing a section row in the nav makes it active.
      await userEvent.click(await screen.findByLabelText(/rename section: contacts/i));
      await userEvent.selectOptions(await screen.findByLabelText(/add field to details/i), "email");

      await save();
      const saved = savedPack();
      expect(
        saved.sections
          .find((s) => s.sectionKey === "contacts")!
          .groups.flatMap((g) => g.fields)
          .map((f) => f.label),
      ).toEqual(["Phone", "New Field"]);
      expect(
        saved.sections
          .find((s) => s.sectionKey === "identity")!
          .groups.flatMap((g) => g.fields),
      ).toHaveLength(2);
    });

    it("changing a field's type persists to the saved pack", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      await userEvent.click(await screen.findByRole("button", { name: /edit field Nickname/i }));
      await userEvent.selectOptions(screen.getByLabelText("Type"), "textarea");

      await save();
      const field = savedPack()
        .sections.find((s) => s.sectionKey === "identity")!
        .groups.flatMap((g) => g.fields)
        .find((f) => f.systemKey === "nickname")!;
      expect(field.type).toBe("textarea");
    });

    it("marking a field required persists to the saved pack", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      await userEvent.click(await screen.findByRole("button", { name: /edit field Nickname/i }));
      await userEvent.click(screen.getByLabelText("Required"));

      await save();
      const field = savedPack()
        .sections.find((s) => s.sectionKey === "identity")!
        .groups.flatMap((g) => g.fields)
        .find((f) => f.systemKey === "nickname")!;
      expect(field.required).toBe(true);
    });

    it("marking a field as the readiness anchor persists it to the saved pack", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      await userEvent.click(await screen.findByRole("button", { name: /edit field Nickname/i }));
      const checkbox = screen.getByRole("checkbox", { name: /identifying field/i });
      expect(checkbox).not.toBeChecked();
      await userEvent.click(checkbox);

      await save();
      const section = savedPack().sections.find((s) => s.sectionKey === "identity")!;
      const field = section.groups.flatMap((g) => g.fields).find((f) => f.systemKey === "nickname")!;
      expect(field.protected).toBe(true);
      expect(field.required).toBe(true);
      expect(section.readinessRule.requiredKeys).toEqual(["fullName", "nickname"]);
    });

    it("refuses to demote an existing protected field", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      await userEvent.click(await screen.findByRole("button", { name: /edit field Full name/i }));
      const checkbox = screen.getByRole("checkbox", { name: /identifying field/i });
      expect(checkbox).toBeChecked();
      await userEvent.click(checkbox);

      await save();
      expect(mocked.savePack).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(/must remain protected/i);
    });
  });

  describe("section nav", () => {
    it("renames a section and saves the new title", async () => {
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

    it("adds a section and saves it", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      await userEvent.click(await screen.findByRole("button", { name: /\+ add section/i }));

      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(mocked.savePack).toHaveBeenCalledTimes(1);
      const saved = mocked.savePack.mock.calls[0]![0];
      expect(saved.sections).toHaveLength(3);
      expect(saved.sections.map((s) => s.title)).toContain("New Section");
    });

    it("removes a section through its two-step confirmation and saves without it", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      await userEvent.click(await screen.findByLabelText(/rename section: contacts/i));
      await userEvent.click(
        await screen.findByRole("button", { name: /^remove section contacts/i }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: /^confirm remove section contacts/i }),
      );

      expect(screen.queryByLabelText(/rename section: contacts/i)).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(mocked.savePack).toHaveBeenCalledTimes(1);
      const saved = mocked.savePack.mock.calls[0]![0];
      expect(saved.sections.map((s) => s.sectionKey)).toEqual(["identity"]);
    });

    it("cancelling a section remove keeps the section", async () => {
      render(<PackEditorApp />);
      await userEvent.click(await screen.findByLabelText(/rename section: contacts/i));
      await userEvent.click(
        await screen.findByRole("button", { name: /^remove section contacts/i }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: /^cancel remove section contacts/i }),
      );

      expect(await screen.findByLabelText(/rename section: contacts/i)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /^confirm remove section contacts/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /^remove section contacts/i }),
      ).toBeInTheDocument();
    });

    it("selecting a section opens that section's property panel and fields", async () => {
      render(<PackEditorApp />);
      expect(await screen.findByLabelText("Section title")).toHaveValue("Identity");
      expect(screen.getByRole("button", { name: /edit field Full name/i })).toBeInTheDocument();

      await userEvent.click(screen.getByLabelText(/rename section: contacts/i));

      expect(screen.getByLabelText("Section title")).toHaveValue("Contacts");
      expect(screen.getByRole("button", { name: /edit field Phone/i })).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /edit field Full name/i }),
      ).not.toBeInTheDocument();
    });

    it("adding a section selects it so the panel edits the new section", async () => {
      render(<PackEditorApp />);
      await userEvent.click(await screen.findByRole("button", { name: /\+ add section/i }));

      expect(screen.getByLabelText("Section title")).toHaveValue("New Section");
      expect(screen.getByLabelText(/rename section: New Section/i).closest("li")).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    it("drag-reorders sections and persists the new order", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      mockRowRects("data-section-key", ["identity", "contacts"]);
      render(<PackEditorApp />);
      await screen.findByLabelText(/rename section: identity/i);

      await keyboardDrag(
        screen.getByRole("button", { name: /drag to reorder Identity/i }),
        "ArrowDown",
      );

      await save();
      const sections = [...savedPack().sections].sort((a, b) => a.order - b.order);
      expect(sections.map((s) => s.sectionKey)).toEqual(["contacts", "identity"]);
    });

    it("toggling multiple records on is reflected in the saved pack", async () => {
      mocked.savePack.mockResolvedValue(undefined);
      render(<PackEditorApp />);
      await userEvent.click(await screen.findByLabelText(/allows multiple records/i));

      await save();
      expect(savedPack().sections.find((s) => s.sectionKey === "identity")!.multiRecord).toBe(true);
    });

    it("editing a section's lede is reflected in the saved pack", async () => {
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
  });
});
