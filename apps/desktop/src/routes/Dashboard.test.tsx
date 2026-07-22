import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vaultApi from "../api/vaultApi";
import { Dashboard } from "./Dashboard";
import { INACTIVITY_LOCK_MS } from "./lockPolicy";

vi.mock("../api/vaultApi", () => ({
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
  // Attachment commands — sweep runs silently; not asserted in Dashboard tests.
  addAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  sweepOrphanedAttachments: vi.fn().mockResolvedValue(0),
  // Backup commands — not asserted in Dashboard tests.
  createBackup: vi.fn(),
  restoreBackup: vi.fn(),
}));

const mocked = vi.mocked(vaultApi);

const SECTION_KEY = "digital-executors";

function emptyDraftResponse() {
  return { draft: null, corrupt: false, staleGeneration: false, stashedAt: null };
}

function draftPayloadFor(name: string): vaultApi.DraftPayload {
  return {
    draftFormat: 1,
    savedAt: "2026-06-11T09:30:00Z",
    sections: [
      {
        sectionKey: SECTION_KEY,
        values: {
          sectionKey: SECTION_KEY,
          records: [
            {
              id: "draft-record-1",
              groupKey: "executor",
              schemaVersion: 1,
              values: { executorName: name },
            },
          ],
          archivedAnswers: [],
        },
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.loadVaultSnapshot.mockRejectedValue("NotFound");
  mocked.takeDraft.mockResolvedValue(emptyDraftResponse());
  mocked.discardDraft.mockResolvedValue(undefined);
  mocked.stashDraft.mockResolvedValue(undefined);
  mocked.lockVault.mockResolvedValue({ unlocked: false, vaultExists: true });
  mocked.saveVaultSnapshot.mockResolvedValue({ generation: 1 });
});

afterEach(() => {
  vi.useRealTimers();
});

function renderDashboard() {
  const onLocked = vi.fn();
  const utils = render(<Dashboard ownerNameHint="Dana" onLocked={onLocked} />);
  return { onLocked, ...utils };
}

function sidebarSectionButton() {
  return screen.getByRole("button", { name: /^Digital Executors/ });
}

async function openSectionAndTypeName(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(sidebarSectionButton());
  await user.click(screen.getByRole("button", { name: "Add Executor" }));
  await user.type(screen.getByLabelText("Full name"), name);
  await user.selectOptions(screen.getByLabelText("Role"), "primary");
}

describe("Dashboard checklist and saving", () => {
  it("reflects saved data only: transient edits never move the badge, a save does", async () => {
    renderDashboard();
    await screen.findByText("Welcome, Dana");

    // Fresh vault: section incomplete, 0% readiness.
    expect(within(sidebarSectionButton()).getByText("To do")).toBeInTheDocument();
    expect(screen.getAllByText("0%").length).toBeGreaterThan(0);

    const user = userEvent.setup();
    await openSectionAndTypeName(user, "Dana Estate");

    // Transient edit: badge and percentage unchanged.
    expect(within(sidebarSectionButton()).getByText("To do")).toBeInTheDocument();
    expect(screen.getAllByText("0%").length).toBeGreaterThan(0);
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));

    // Saved: checklist status and overall percentage update together.
    expect(mocked.saveVaultSnapshot).toHaveBeenCalledTimes(1);
    const [snapshot, baseGeneration] = mocked.saveVaultSnapshot.mock.calls[0];
    expect(baseGeneration).toBe(0);
    const values = snapshot.values as Record<string, { records: Array<{ values: Record<string, string> }> }>;
    expect(values[SECTION_KEY].records[0].values.executorName).toBe("Dana Estate");
    expect(await within(sidebarSectionButton()).findByText("Complete")).toBeInTheDocument();
    // 1 of the pack's 8 sections ready -> 13% overall readiness.
    expect(screen.getAllByText("13%").length).toBeGreaterThan(0);
  });

  it("blocks a save with missing required fields and lists them", async () => {
    renderDashboard();
    await screen.findByText("Welcome, Dana");

    const user = userEvent.setup();
    await user.click(sidebarSectionButton());
    await user.click(screen.getByRole("button", { name: "Add Executor" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(mocked.saveVaultSnapshot).not.toHaveBeenCalled();
    expect(screen.getByText("Full name is required.")).toBeInTheDocument();
  });
});

describe("Dashboard N/A flow", () => {
  it("marks a section complete via N/A (with confirm) and back to incomplete on unmark", async () => {
    renderDashboard();
    await screen.findByText("Welcome, Dana");

    const user = userEvent.setup();
    await user.click(sidebarSectionButton());
    await user.click(screen.getByRole("button", { name: "Doesn't apply to me" }));

    // One inline confirmation before anything changes.
    expect(screen.getByText("This section will count as complete.")).toBeInTheDocument();
    expect(mocked.saveVaultSnapshot).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(mocked.saveVaultSnapshot).toHaveBeenCalledTimes(1);
    const [snapshot] = mocked.saveVaultSnapshot.mock.calls[0];
    expect(
      (snapshot.sectionMeta as Record<string, { na?: boolean }>)[SECTION_KEY].na,
    ).toBe(true);
    expect(await within(sidebarSectionButton()).findByText("Doesn't apply")).toBeInTheDocument();
    // 1 of 8 sections ready (via N/A) -> 13% overall readiness.
    expect(screen.getAllByText("13%").length).toBeGreaterThan(0);

    mocked.saveVaultSnapshot.mockResolvedValue({ generation: 2 });
    await user.click(screen.getByRole("button", { name: "It applies to me after all" }));
    expect(await within(sidebarSectionButton()).findByText("To do")).toBeInTheDocument();
    expect(screen.getAllByText("0%").length).toBeGreaterThan(0);
  });
});

describe("Dashboard draft restore", () => {
  it("offers a stashed draft on a fresh unlock and restores it intact", async () => {
    mocked.takeDraft.mockResolvedValue({
      draft: draftPayloadFor("Dana Estate"),
      corrupt: false,
      staleGeneration: false,
      stashedAt: "2026-06-11T09:30:00Z",
    });
    renderDashboard();

    // Navigated to the draft's owning section with the banner shown.
    expect(
      await screen.findByText(/Unsaved changes from .* were restored\.?$/),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Digital Executors" })).toBeInTheDocument();
    // The draft record is present (collapsed summary row labeled by its
    // protected-field value).
    expect(screen.getByRole("button", { name: "Dana Estate" })).toBeInTheDocument();

    // Discard reverts to saved data and purges the stash.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(mocked.discardDraft).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Dana Estate" })).not.toBeInTheDocument();
    expect(screen.queryByText(/were restored/)).not.toBeInTheDocument();
  });

  it("warns when the draft was stashed against an older vault generation", async () => {
    mocked.takeDraft.mockResolvedValue({
      draft: draftPayloadFor("Dana Estate"),
      corrupt: false,
      staleGeneration: true,
      stashedAt: "2026-06-11T09:30:00Z",
    });
    renderDashboard();

    expect(
      await screen.findByText(/the vault changed since this draft was set aside/i),
    ).toBeInTheDocument();
  });

  it("surfaces a corrupt stash as a notice and proceeds normally", async () => {
    mocked.takeDraft.mockResolvedValue({
      draft: null,
      corrupt: true,
      staleGeneration: false,
      stashedAt: null,
    });
    renderDashboard();

    expect(
      await screen.findByText(/draft from a previous session could not be recovered/i),
    ).toBeInTheDocument();
    // Unlock proceeded normally: the welcome state is rendered.
    expect(screen.getByText("Welcome, Dana")).toBeInTheDocument();
  });
});

describe("Dashboard recovered-save banner", () => {
  it("shows a persistent dismiss-only warning when the load recovered an older save", async () => {
    mocked.loadVaultSnapshot.mockResolvedValue({
      snapshot: { profile: { ownerName: "Dana" } },
      generation: 4,
      recovered: true,
    });
    renderDashboard();

    const banner = await screen.findByText(/an earlier good save was recovered/i);
    expect(banner).toBeInTheDocument();
    expect(screen.getByText(/consider creating a backup now/i)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/an earlier good save was recovered/i)).not.toBeInTheDocument();
  });
});

describe("Dashboard snapshot conflict", () => {
  it("shows the conflict banner and save-again issues a fresh load + CAS retry", async () => {
    mocked.saveVaultSnapshot.mockRejectedValueOnce("SnapshotConflict");
    renderDashboard();
    await screen.findByText("Welcome, Dana");

    const user = userEvent.setup();
    await openSectionAndTypeName(user, "Dana Estate");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Edits stay in the form; the banner offers save-again / discard.
    expect(await screen.findByText(/The vault was updated since/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Dana Estate")).toBeInTheDocument();

    // Save again: fresh load, then a new CAS attempt from that generation.
    mocked.loadVaultSnapshot.mockResolvedValue({
      snapshot: { profile: { ownerName: "Dana" } },
      generation: 5,
      recovered: false,
    });
    mocked.saveVaultSnapshot.mockResolvedValue({ generation: 6 });
    await user.click(screen.getByRole("button", { name: "Save again" }));

    expect(mocked.loadVaultSnapshot).toHaveBeenCalledTimes(2); // mount + save-again
    const calls = mocked.saveVaultSnapshot.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[1]).toBe(5);
    const values = lastCall[0].values as Record<string, { records: Array<{ values: Record<string, string> }> }>;
    expect(values[SECTION_KEY].records[0].values.executorName).toBe("Dana Estate");
    expect(screen.queryByText(/The vault was updated since/)).not.toBeInTheDocument();
    expect(await within(sidebarSectionButton()).findByText("Complete")).toBeInTheDocument();
  });
});

describe("Dashboard Recovery Kit", () => {
  function kitSidebarButton() {
    return screen.getByRole("button", { name: /^Recovery Kit/ });
  }

  /** Expand the saved executor record if the section collapsed it. */
  async function expandRecord(user: ReturnType<typeof userEvent.setup>, summary: string) {
    if (!screen.queryByLabelText("Full name")) {
      await user.click(screen.getByRole("button", { name: summary }));
    }
  }

  async function saveExecutorAndKit(user: ReturnType<typeof userEvent.setup>) {
    await openSectionAndTypeName(user, "Dana Estate");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await within(sidebarSectionButton()).findByText("Complete");

    mocked.saveVaultSnapshot.mockResolvedValue({ generation: 2 });
    await user.click(kitSidebarButton());
    await user.click(screen.getByRole("button", { name: "Save Kit" }));
    expect(await screen.findByText(/Last updated /)).toBeInTheDocument();
  }

  it("saves kit meta via the snapshot path; a contributing edit flags stale and Save Kit clears it", async () => {
    renderDashboard();
    await screen.findByText("Welcome, Dana");
    const user = userEvent.setup();

    // A never-saved Kit carries no badge, even once it has content.
    await openSectionAndTypeName(user, "Dana Estate");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await within(sidebarSectionButton()).findByText("Complete");
    expect(screen.queryByText("Kit out of date")).not.toBeInTheDocument();

    // Regenerate-on-view: the kit reflects saved values; commit it.
    await user.click(kitSidebarButton());
    expect(screen.getByText("Not saved yet")).toBeInTheDocument();
    expect(screen.getAllByText("Dana Estate").length).toBeGreaterThan(0);
    mocked.saveVaultSnapshot.mockResolvedValue({ generation: 2 });
    await user.click(screen.getByRole("button", { name: "Save Kit" }));

    // The kitMeta staleness anchor went through the normal CAS save path.
    const saveCalls = mocked.saveVaultSnapshot.mock.calls;
    const kitSnapshot = saveCalls[saveCalls.length - 1][0] as {
      kitMeta?: { lastGeneratedAt: string; fingerprint: string };
    };
    expect(kitSnapshot.kitMeta?.fingerprint).toEqual(expect.any(String));
    expect(kitSnapshot.kitMeta?.lastGeneratedAt).toEqual(expect.any(String));
    expect(await screen.findByText(/Last updated /)).toBeInTheDocument();
    expect(screen.queryByText("Kit out of date")).not.toBeInTheDocument();

    // Editing a contributing (kit-mapped) field flags the Kit stale.
    mocked.saveVaultSnapshot.mockResolvedValue({ generation: 3 });
    await user.click(sidebarSectionButton());
    await expandRecord(user, "Dana Estate");
    const nameInput = screen.getByLabelText("Full name");
    await user.clear(nameInput);
    await user.type(nameInput, "Dana Updated");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Kit out of date")).toBeInTheDocument();

    // The Kit page shows the stale banner; regenerating clears staleness.
    await user.click(kitSidebarButton());
    expect(
      screen.getByText(
        "Your vault data has changed since this Kit was last saved — this view reflects your latest data.",
      ),
    ).toBeInTheDocument();
    mocked.saveVaultSnapshot.mockResolvedValue({ generation: 4 });
    await user.click(screen.getByRole("button", { name: "Save Kit" }));
    expect(screen.queryByText("Kit out of date")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/has changed since this Kit was last saved/),
    ).not.toBeInTheDocument();
  });

  it("editing a NON-contributing field does not flag the Kit stale", async () => {
    renderDashboard();
    await screen.findByText("Welcome, Dana");
    const user = userEvent.setup();
    await saveExecutorAndKit(user);

    // executorAddress is populated but not in the kit mapping.
    mocked.saveVaultSnapshot.mockResolvedValue({ generation: 3 });
    await user.click(sidebarSectionButton());
    await expandRecord(user, "Dana Estate");
    await user.type(screen.getByLabelText("Address"), "12 Elm Street");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.queryByText("Kit out of date")).not.toBeInTheDocument();
  });
});

describe("Form Editor sidebar toggle", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("hides Form Editor nav item when toggle is off (default)", async () => {
    renderDashboard();
    await screen.findByText("Welcome, Dana");
    expect(screen.queryByRole("button", { name: /form editor/i })).not.toBeInTheDocument();
  });

  it("persists toggle state to localStorage", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText("Welcome, Dana");
    const toggle = screen.getByRole("checkbox", { name: /form editor/i });
    await user.click(toggle);
    expect(localStorage.getItem("lifescribe.packEditorEnabled")).toBe("true");
    await user.click(toggle);
    expect(localStorage.getItem("lifescribe.packEditorEnabled")).toBe("false");
  });
});

describe("Inline form editor", () => {
  beforeEach(() => {
    localStorage.setItem("lifescribe.packEditorEnabled", "true");
  });

  afterEach(() => {
    localStorage.clear();
  });

  async function openSectionAndEnterEdit(user: ReturnType<typeof userEvent.setup>) {
    renderDashboard();
    await screen.findByText("Welcome, Dana");
    await user.click(sidebarSectionButton());
    const editBtn = await screen.findByRole("button", { name: "Edit this form" });
    await user.click(editBtn);
  }

  it("shows 'Edit this form' on a section when Form Editor is enabled and enters editing state", async () => {
    const user = userEvent.setup();
    await openSectionAndEnterEdit(user);
    expect(screen.getByRole("button", { name: "Save form changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done editing" })).toBeInTheDocument();
    // Fill-mode "Edit this form" is gone while editing
    expect(screen.queryByRole("button", { name: "Edit this form" })).not.toBeInTheDocument();
  });

  it("'Done editing' cancels and returns to fill view without saving", async () => {
    const user = userEvent.setup();
    await openSectionAndEnterEdit(user);
    await user.click(screen.getByRole("button", { name: "Done editing" }));
    expect(screen.queryByRole("button", { name: "Save form changes" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit this form" })).toBeInTheDocument();
    expect(mocked.saveVaultSnapshot).not.toHaveBeenCalled();
  });

  it("'Save form changes' persists the pack via saveVaultSnapshot with customPack set", async () => {
    const user = userEvent.setup();
    await openSectionAndEnterEdit(user);
    await user.click(screen.getByRole("button", { name: "Save form changes" }));
    expect(mocked.saveVaultSnapshot).toHaveBeenCalled();
    const [snapshot] = mocked.saveVaultSnapshot.mock.calls[0];
    expect((snapshot as Record<string, unknown>).customPack).toBeDefined();
  });

  it("turning the Form Editor toggle off mid-edit exits editing state", async () => {
    const user = userEvent.setup();
    await openSectionAndEnterEdit(user);
    const toggle = screen.getByRole("checkbox", { name: /form editor/i });
    await user.click(toggle);
    expect(screen.queryByRole("button", { name: "Save form changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Done editing" })).not.toBeInTheDocument();
  });

  it("a saveVaultSnapshot failure keeps the user in editing state", async () => {
    mocked.saveVaultSnapshot.mockRejectedValueOnce(new Error("disk full"));
    const user = userEvent.setup();
    await openSectionAndEnterEdit(user);
    await user.click(screen.getByRole("button", { name: "Save form changes" }));
    expect(await screen.findByRole("button", { name: "Save form changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done editing" })).toBeInTheDocument();
  });
});

describe("Section multi-record toggle", () => {
  beforeEach(() => {
    localStorage.setItem("lifescribe.packEditorEnabled", "true");
  });

  afterEach(() => {
    localStorage.clear();
  });

  // Password Manager Plan is a true single-record section (no multiRecord,
  // no repeatable group) — the clean case for turning "add individual
  // entries" on the way Financial Accounts already works.
  async function editPasswordManagerSection(user: ReturnType<typeof userEvent.setup>) {
    renderDashboard();
    await screen.findByText("Welcome, Dana");
    await user.click(screen.getByRole("button", { name: /^Password Manager Plan/ }));
    await user.click(await screen.findByRole("button", { name: "Edit this form" }));
  }

  it("shows an unchecked 'allow multiple entries' toggle for a single-record section", async () => {
    const user = userEvent.setup();
    await editPasswordManagerSection(user);
    const toggle = screen.getByRole("checkbox", { name: /allow multiple entries/i });
    expect(toggle).not.toBeChecked();
    // The entry-name input only appears once multi-record is on.
    expect(screen.queryByLabelText(/entry name/i)).not.toBeInTheDocument();
  });

  it("turns the section multi-record with a custom entry name, persisted in customPack", async () => {
    const user = userEvent.setup();
    await editPasswordManagerSection(user);

    await user.click(screen.getByRole("checkbox", { name: /allow multiple entries/i }));

    const entryName = await screen.findByLabelText(/entry name/i);
    await user.clear(entryName);
    await user.type(entryName, "Login");

    await user.click(screen.getByRole("button", { name: "Save form changes" }));

    expect(mocked.saveVaultSnapshot).toHaveBeenCalled();
    const [snapshot] = mocked.saveVaultSnapshot.mock.calls[0];
    const customPack = (snapshot as Record<string, unknown>).customPack as
      | import("../domain/formModel").FormPack
      | undefined;
    expect(customPack).toBeDefined();
    const section = customPack!.sections.find((s) => s.sectionKey === "password-manager")!;
    expect(section.multiRecord).toBe(true);
    // RecordList reads groups[0].title for the "Add …" button.
    expect(section.groups[0]!.title).toBe("Login");
  });
});

describe("Form structure editor — end-to-end", () => {
  beforeEach(() => {
    localStorage.setItem("lifescribe.packEditorEnabled", "true");
  });

  afterEach(() => {
    localStorage.clear();
  });

  /**
   * Helper: render, wait for welcome, navigate to Digital Executors, enter
   * editing. The master-detail structure editor is section-level and renders
   * every field regardless of whether any records exist, so no record needs to
   * be added first.
   */
  async function openSectionInEditMode(user: ReturnType<typeof userEvent.setup>) {
    renderDashboard();
    await screen.findByText("Welcome, Dana");
    await user.click(sidebarSectionButton());
    const editBtn = await screen.findByRole("button", { name: "Edit this form" });
    await user.click(editBtn);
  }

  // ---------------------------------------------------------------------------
  // Scenario 1: Label edit persists in the snapshot's customPack (R2, R6)
  // ---------------------------------------------------------------------------
  it("label change is persisted in customPack after Save form changes", async () => {
    const user = userEvent.setup();
    await openSectionInEditMode(user);

    // Select the protected "Full name" field so it loads into the property panel.
    await user.click(screen.getByRole("button", { name: "Edit field Full name" }));

    // The panel's Label input is pre-filled with the field's current label.
    const labelInput = screen.getByLabelText("Label");
    expect((labelInput as HTMLInputElement).value).toBe("Full name");

    await user.clear(labelInput);
    await user.type(labelInput, "Legal full name");

    await user.click(screen.getByRole("button", { name: "Save form changes" }));
    expect(mocked.saveVaultSnapshot).toHaveBeenCalled();

    const [snapshot] = mocked.saveVaultSnapshot.mock.calls[0];
    const snapshotRecord = snapshot as Record<string, unknown>;
    const customPack = snapshotRecord.customPack as import("../domain/formModel").FormPack | undefined;
    expect(customPack).toBeDefined();

    // Find the digital-executors section in the saved customPack.
    const executorsSection = customPack!.sections.find(
      (s) => s.sectionKey === "digital-executors",
    );
    expect(executorsSection).toBeDefined();

    // At least one field in the section should have the updated label.
    const allFields = executorsSection!.groups.flatMap((g) => g.fields);
    const renamedField = allFields.find((f) => f.label === "Legal full name");
    expect(renamedField).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Scenario 2: Added field appears in the customPack after Save form changes (R3)
  // ---------------------------------------------------------------------------
  it("added field appears in customPack after Save form changes", async () => {
    const user = userEvent.setup();
    await openSectionInEditMode(user);

    // Each group offers a type-picker <select> labeled "Add field to <group>".
    const addSelect = screen.getByLabelText(/Add field to Executor/i);
    await user.selectOptions(addSelect, "text");

    await user.click(screen.getByRole("button", { name: "Save form changes" }));
    expect(mocked.saveVaultSnapshot).toHaveBeenCalled();

    const [snapshot] = mocked.saveVaultSnapshot.mock.calls[0];
    const snapshotRecord = snapshot as Record<string, unknown>;
    const customPack = snapshotRecord.customPack as import("../domain/formModel").FormPack | undefined;
    expect(customPack).toBeDefined();

    const executorsSection = customPack!.sections.find(
      (s) => s.sectionKey === "digital-executors",
    );
    expect(executorsSection).toBeDefined();

    const executorGroup = executorsSection!.groups.find((g) => g.groupKey === "executor");
    expect(executorGroup).toBeDefined();

    // Default pack has 10 fields in the executor group; after adding one it should have 11.
    expect(executorGroup!.fields.length).toBeGreaterThanOrEqual(11);
  });

  // ---------------------------------------------------------------------------
  // Scenario 3: Protected field has no Remove button in editing state (R4)
  // ---------------------------------------------------------------------------
  it("protected fields have no Remove field button while in editing state", async () => {
    const user = userEvent.setup();
    await openSectionInEditMode(user);

    // "Full name" (executorName) and "Role" (executorRole) are protected — the
    // FieldList omits their delete adorner. A non-protected field ("Relationship")
    // still exposes one, confirming the mechanism is active.
    expect(screen.queryByRole("button", { name: "Remove field Full name" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove field Role" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Remove field Relationship" }),
    ).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Scenario 4: Retype-with-data auto-migration emits a retypeField step (R5)
  // ---------------------------------------------------------------------------
  it("changing a non-protected field type emits a retypeField migration step in customPack", async () => {
    const user = userEvent.setup();
    await openSectionInEditMode(user);

    // Select "Relationship" (systemKey executorRelationship, default type "text")
    // to load it into the property panel, then change its Type to "textarea".
    await user.click(screen.getByRole("button", { name: "Edit field Relationship" }));
    const typeSelect = screen.getByLabelText("Type");
    await user.selectOptions(typeSelect, "textarea");

    await user.click(screen.getByRole("button", { name: "Save form changes" }));
    expect(mocked.saveVaultSnapshot).toHaveBeenCalled();

    const [snapshot] = mocked.saveVaultSnapshot.mock.calls[0];
    const snapshotRecord = snapshot as Record<string, unknown>;
    const customPack = snapshotRecord.customPack as import("../domain/formModel").FormPack | undefined;
    expect(customPack).toBeDefined();

    // schemaVersion should be bumped from 1 to 2 because a retypeField migration was derived.
    expect(customPack!.schemaVersion).toBe(2);

    // The migrations array should contain a step with a retypeField operation.
    const steps = customPack!.migrations;
    expect(steps.length).toBeGreaterThanOrEqual(1);
    const lastStep = steps[steps.length - 1];
    const retypeOp = lastStep.operations.find((op) => op.op === "retypeField");
    expect(retypeOp).toBeDefined();
    expect(retypeOp).toMatchObject({
      op: "retypeField",
      sectionKey: "digital-executors",
      systemKey: "executorRelationship",
      toType: "textarea",
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 5: Turning the toggle off hides ALL editing affordances (R1)
  // ---------------------------------------------------------------------------
  it("turning the Form Editor toggle off hides all editing affordances", async () => {
    const user = userEvent.setup();
    await openSectionInEditMode(user);

    // Confirm we are in editing state with the structure editor visible.
    expect(screen.getByRole("button", { name: "Save form changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done editing" })).toBeInTheDocument();
    expect(document.querySelector(".section-structure-editor")).toBeInTheDocument();

    // Turn the Form Editor toggle off.
    const toggle = screen.getByRole("checkbox", { name: /form editor/i });
    await user.click(toggle);

    // All editing affordances must be gone.
    expect(screen.queryByRole("button", { name: "Save form changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Done editing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit this form" })).not.toBeInTheDocument();
    // The structure editor must be unmounted.
    expect(document.querySelector(".section-structure-editor")).not.toBeInTheDocument();
    // Group-level add-field controls should also be absent.
    expect(screen.queryByLabelText(/Add field to/i)).not.toBeInTheDocument();
  });
});

describe("Dashboard formModeHint — credential pack on load", () => {
  it("loads the credential pack when the snapshot profile has formMode: credential", async () => {
    mocked.loadVaultSnapshot.mockResolvedValue({
      snapshot: {
        profile: { ownerName: "Mark", reviewCadenceMonths: 12, formMode: "credential" },
      },
      generation: 1,
      recovered: false,
    });
    const onLocked = vi.fn();
    render(<Dashboard ownerNameHint="Mark" formModeHint="credential" onLocked={onLocked} />);
    await screen.findByText("Welcome, Mark");

    // Navigate to the Password Manager Plan section (credential-pack-only section)
    await userEvent.click(screen.getByRole("button", { name: /password manager plan/i }));
    // "Master password" is a field *label* exclusive to the credential pack.
    // getByLabelText looks for a form control associated with that label string.
    expect(await screen.findByLabelText("Master password")).toBeInTheDocument();
  });

  it("carries the onboarding formMode hint into a fresh vault's profile", async () => {
    // Fresh vault: no snapshot persisted yet (loadVaultSnapshot rejects NotFound
    // via the default beforeEach). The ONLY source of formMode is the onboarding
    // hint prop. The loaded profile — not just the pack — must reflect it, or the
    // first save will persist "hint" and silently discard the user's choice.
    const onLocked = vi.fn();
    render(<Dashboard ownerNameHint="Mark" formModeHint="credential" onLocked={onLocked} />);
    await screen.findByText("Welcome, Mark");

    // Sidebar reads the profile mode. In credential mode the toggle offers the
    // *reverse* switch. If the profile were stuck on "hint", this button would
    // instead read "Switch to store actual secrets".
    expect(
      screen.getByRole("button", { name: "Switch to locations only" }),
    ).toBeInTheDocument();

    // And the credential-only field renders, confirming pack and profile agree.
    await userEvent.click(screen.getByRole("button", { name: /password manager plan/i }));
    expect(await screen.findByLabelText("Master password")).toBeInTheDocument();
  });
});

describe("Dashboard mode switch", () => {
  it("switches from hint to credential mode: saves snapshot with formMode=credential and no customPack", async () => {
    // Snapshot with hint mode, a customPack (to verify customPack is cleared on switch),
    // and saved field values (to verify values round-trip through the switch unchanged).
    mocked.loadVaultSnapshot.mockResolvedValue({
      snapshot: {
        profile: { ownerName: "Mark", reviewCadenceMonths: 12, formMode: "hint" },
        customPack: {
          schemaVersion: 1,
          migrations: [],
          sections: [],
        },
        values: {
          [SECTION_KEY]: {
            sectionKey: SECTION_KEY,
            records: [
              {
                id: "record-1",
                groupKey: "executor",
                schemaVersion: 1,
                values: { executorName: "Mark Estate" },
              },
            ],
            archivedAnswers: [],
          },
        },
      },
      generation: 3,
      recovered: false,
    });
    mocked.saveVaultSnapshot.mockResolvedValue({ generation: 4 });

    const onLocked = vi.fn();
    render(<Dashboard ownerNameHint="Mark" formModeHint="hint" onLocked={onLocked} />);
    await screen.findByText("Welcome, Mark");

    // Find and click the mode switch button
    const switchBtn = screen.getByRole("button", { name: "Switch to store actual secrets" });
    await userEvent.click(switchBtn);

    // Confirm dialog should appear
    const confirmBtn = screen.getByRole("button", { name: "Confirm" });
    await userEvent.click(confirmBtn);

    expect(mocked.saveVaultSnapshot).toHaveBeenCalledTimes(1);
    const [snapshot, baseGeneration] = mocked.saveVaultSnapshot.mock.calls[0];
    expect(baseGeneration).toBe(3);
    const snapshotRecord = snapshot as Record<string, unknown>;
    const profile = snapshotRecord.profile as Record<string, unknown>;
    expect(profile.formMode).toBe("credential");
    expect(snapshotRecord.customPack).toBeUndefined();
    // Field-level user data must survive the mode switch unchanged.
    const values = snapshotRecord.values as Record<
      string,
      { records: Array<{ values: Record<string, string> }> }
    >;
    expect(values[SECTION_KEY].records[0].values.executorName).toBe("Mark Estate");
  });

  it("a save failure during mode switch shows the error banner and closes the dialog", async () => {
    mocked.loadVaultSnapshot.mockResolvedValue({
      snapshot: {
        profile: { ownerName: "Mark", reviewCadenceMonths: 12, formMode: "hint" },
      },
      generation: 3,
      recovered: false,
    });
    mocked.saveVaultSnapshot.mockRejectedValueOnce(new Error("conflict"));

    const onLocked = vi.fn();
    render(<Dashboard ownerNameHint="Mark" formModeHint="hint" onLocked={onLocked} />);
    await screen.findByText("Welcome, Mark");

    await userEvent.click(screen.getByRole("button", { name: "Switch to store actual secrets" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    // Mode switch saves through the shared persist path, so it surfaces the
    // common save-error banner.
    expect(
      await screen.findByText("Your changes could not be saved. Please try again."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Confirm form detail change" })).not.toBeInTheDocument();
  });

  it("switches from credential to hint mode: saves snapshot with formMode=hint", async () => {
    mocked.loadVaultSnapshot.mockResolvedValue({
      snapshot: {
        profile: { ownerName: "Mark", reviewCadenceMonths: 12, formMode: "credential" },
      },
      generation: 2,
      recovered: false,
    });
    mocked.saveVaultSnapshot.mockResolvedValue({ generation: 3 });

    const onLocked = vi.fn();
    render(<Dashboard ownerNameHint="Mark" formModeHint="credential" onLocked={onLocked} />);
    await screen.findByText("Welcome, Mark");

    const switchBtn = screen.getByRole("button", { name: "Switch to locations only" });
    await userEvent.click(switchBtn);

    const confirmBtn = screen.getByRole("button", { name: "Confirm" });
    await userEvent.click(confirmBtn);

    expect(mocked.saveVaultSnapshot).toHaveBeenCalledTimes(1);
    const [snapshot, baseGeneration] = mocked.saveVaultSnapshot.mock.calls[0];
    expect(baseGeneration).toBe(2);
    const snapshotRecord = snapshot as Record<string, unknown>;
    const profile = snapshotRecord.profile as Record<string, unknown>;
    expect(profile.formMode).toBe("hint");
    expect(snapshotRecord.customPack).toBeUndefined();
  });

  it("Cancel button dismisses the dialog without saving", async () => {
    mocked.loadVaultSnapshot.mockResolvedValue({
      snapshot: {
        profile: { ownerName: "Mark", reviewCadenceMonths: 12, formMode: "hint" },
      },
      generation: 1,
      recovered: false,
    });

    const onLocked = vi.fn();
    render(<Dashboard ownerNameHint="Mark" formModeHint="hint" onLocked={onLocked} />);
    await screen.findByText("Welcome, Mark");

    await userEvent.click(screen.getByRole("button", { name: "Switch to store actual secrets" }));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(mocked.saveVaultSnapshot).not.toHaveBeenCalled();
  });
});

describe("Dashboard auto-lock", () => {
  async function flushMount() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  function makeDirty(name: string) {
    fireEvent.click(sidebarSectionButton());
    fireEvent.click(screen.getByRole("button", { name: "Add Executor" }));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: name } });
  }

  it("stashes the dirty draft and then locks when the inactivity timer fires", async () => {
    vi.useFakeTimers();
    const { onLocked } = renderDashboard();
    await flushMount();
    makeDirty("Dana Estate");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INACTIVITY_LOCK_MS);
    });

    expect(mocked.stashDraft).toHaveBeenCalledTimes(1);
    expect(mocked.lockVault).toHaveBeenCalledTimes(1);
    // Stash strictly BEFORE lock (the key must still exist for the stash).
    expect(mocked.stashDraft.mock.invocationCallOrder[0]).toBeLessThan(
      mocked.lockVault.mock.invocationCallOrder[0],
    );
    const payload = mocked.stashDraft.mock.calls[0][0] as {
      sections: Array<{ sectionKey: string; values: { records: Array<{ values: Record<string, string> }> } }>;
    };
    expect(payload.sections[0].sectionKey).toBe(SECTION_KEY);
    expect(payload.sections[0].values.records[0].values.executorName).toBe("Dana Estate");
    expect(onLocked).toHaveBeenCalledTimes(1);
  });

  it("locks without stashing when nothing is dirty", async () => {
    vi.useFakeTimers();
    const { onLocked } = renderDashboard();
    await flushMount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INACTIVITY_LOCK_MS);
    });

    expect(mocked.stashDraft).not.toHaveBeenCalled();
    expect(mocked.lockVault).toHaveBeenCalledTimes(1);
    expect(onLocked).toHaveBeenCalledTimes(1);
  });

  it("user activity resets the timer; unmounting (locked) makes it inert", async () => {
    vi.useFakeTimers();
    const { onLocked, unmount } = renderDashboard();
    await flushMount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INACTIVITY_LOCK_MS - 60_000);
    });
    // Activity one minute before the deadline pushes it out again.
    act(() => {
      window.dispatchEvent(new Event("pointermove"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INACTIVITY_LOCK_MS - 60_000);
    });
    expect(mocked.lockVault).not.toHaveBeenCalled();
    expect(onLocked).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mocked.lockVault).toHaveBeenCalledTimes(1);
    expect(onLocked).toHaveBeenCalledTimes(1);

    // Once locked the dashboard unmounts — the timer is gone with it.
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INACTIVITY_LOCK_MS * 3);
    });
    expect(mocked.lockVault).toHaveBeenCalledTimes(1);
  });

  it("round-trips the stashed draft back into the section on the next unlock", async () => {
    vi.useFakeTimers();
    const first = renderDashboard();
    await flushMount();
    makeDirty("Dana Estate");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INACTIVITY_LOCK_MS);
    });
    const stashed = mocked.stashDraft.mock.calls[0][0];
    first.unmount();
    vi.useRealTimers();

    // Next session: the same payload comes back from take_draft.
    mocked.takeDraft.mockResolvedValue({
      draft: stashed,
      corrupt: false,
      staleGeneration: false,
      stashedAt: "2026-06-11T09:30:00Z",
    });
    renderDashboard();
    expect(await screen.findByText(/were restored/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dana Estate" })).toBeInTheDocument();
  });
});
