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

  it("shows Form Editor nav item after toggling on", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText("Welcome, Dana");
    const toggle = screen.getByRole("checkbox", { name: /form editor/i });
    await user.click(toggle);
    expect(screen.getByRole("button", { name: /form editor/i })).toBeInTheDocument();
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
