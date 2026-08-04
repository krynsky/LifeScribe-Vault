/**
 * Recovery Kit page states (U7): empty, fresh-with-timestamp, stale banner,
 * Save Kit committing new kit meta, plus print and PDF export actions.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { save as saveFilePicker } from "@tauri-apps/plugin-dialog";
import { writePdfExport } from "../api/vaultApi";
import { computeKitFingerprint } from "../domain/recoveryKit";
import type { KitMeta } from "../domain/snapshot";
import {
  makeField,
  makeGroup,
  makeRecord,
  makeSection,
  makeSectionValues,
  makeVaultValues,
} from "../domain/testing/fixtures";
import type { VaultValues } from "../domain/valuesStore";
import { RecoveryKitPage } from "./RecoveryKitPage";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

vi.mock("../api/vaultApi", () => ({
  writePdfExport: vi.fn(),
}));

vi.mock("../domain/recoveryKitPdf", () => ({
  buildRecoveryKitPdf: vi.fn(() => new Uint8Array([37, 80, 68, 70, 45])),
  recoveryKitPdfFilename: vi.fn(() => "recovery-kit-dana.pdf"),
}));

const SECTIONS = [
  makeSection({
    sectionKey: "plan",
    title: "Password Plan",
    order: 1,
    groups: [
      makeGroup({
        groupKey: "main",
        order: 1,
        fields: [
          makeField({ systemKey: "provider", label: "Provider", protected: true, order: 1 }),
          makeField({ systemKey: "accessNotes", label: "Access notes", order: 2 }),
          // Populated but NOT kit-mapped: must never render.
          makeField({ systemKey: "privateNotes", label: "Private notes", order: 3 }),
        ],
      }),
    ],
    readinessRule: { requiredKeys: ["provider"] },
    kitMapping: {
      entries: [{ heading: "Password manager", fields: ["provider", "accessNotes"] }],
    },
  }),
];

function populatedValues(): VaultValues {
  return makeVaultValues([
    makeSectionValues("plan", [
      makeRecord({
        id: "plan-1",
        values: {
          provider: "1Password",
          accessNotes: "Emergency kit in the fire safe",
          privateNotes: "never in the kit",
        },
      }),
    ]),
  ]);
}

function renderPage(overrides: {
  values?: VaultValues;
  kitMeta?: KitMeta | null;
  saving?: boolean;
  onSaveKit?: (meta: KitMeta) => void;
} = {}) {
  const onSaveKit = overrides.onSaveKit ?? vi.fn();
  const utils = render(
    <RecoveryKitPage
      sections={SECTIONS}
      values={overrides.values ?? populatedValues()}
      sectionMeta={{}}
      profile={{ ownerName: "Dana" }}
      kitMeta={overrides.kitMeta ?? null}
      saving={overrides.saving ?? false}
      onSaveKit={onSaveKit}
    />,
  );
  return { onSaveKit, ...utils };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RecoveryKitPage states", () => {
  it("shows the empty state when no kit-mapped values exist", () => {
    renderPage({ values: {} });
    expect(
      screen.getByText(
        "Your Recovery Kit will appear here once you complete at least one guided section.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Kit" })).not.toBeInTheDocument();
  });

  it("renders the kit from current values with the owner header and 'Not saved yet'", () => {
    renderPage();
    expect(screen.queryByText(/generated /)).not.toBeInTheDocument();
    expect(screen.getByText("Not saved yet")).toBeInTheDocument();
    expect(screen.getByText("Password manager")).toBeInTheDocument();
    expect(screen.getByText("1Password")).toBeInTheDocument();
    expect(screen.getByText("Emergency kit in the fire safe")).toBeInTheDocument();
    // Structural guarantee at the view layer too: unmapped value never renders.
    expect(screen.queryByText("never in the kit")).not.toBeInTheDocument();
    expect(screen.queryByText("Private notes")).not.toBeInTheDocument();
  });

  it("fresh state: shows 'Last updated' and no stale banner when the fingerprint matches", () => {
    const fingerprint = computeKitFingerprint(SECTIONS, populatedValues(), {});
    renderPage({ kitMeta: { lastGeneratedAt: "2026-06-11T10:00:00Z", fingerprint } });
    expect(screen.getByText(/Last updated /)).toBeInTheDocument();
    expect(
      screen.queryByText(/Your vault data has changed since this Kit was last saved/),
    ).not.toBeInTheDocument();
  });

  it("stale state: shows the banner when vault data changed since the Kit was saved", () => {
    renderPage({
      kitMeta: { lastGeneratedAt: "2026-06-11T10:00:00Z", fingerprint: "deadbeef" },
    });
    expect(
      screen.getByText(
        "Your vault data has changed since this Kit was last saved — this view reflects your latest data.",
      ),
    ).toBeInTheDocument();
  });

  it("Save Kit invokes the save callback with the new kit meta (current fingerprint)", async () => {
    const user = userEvent.setup();
    const { onSaveKit } = renderPage({
      kitMeta: { lastGeneratedAt: "2026-06-11T10:00:00Z", fingerprint: "deadbeef" },
    });
    await user.click(screen.getByRole("button", { name: "Save Kit" }));

    expect(onSaveKit).toHaveBeenCalledTimes(1);
    const meta = (onSaveKit as ReturnType<typeof vi.fn>).mock.calls[0][0] as KitMeta;
    expect(meta.fingerprint).toBe(computeKitFingerprint(SECTIONS, populatedValues(), {}));
    expect(Number.isNaN(new Date(meta.lastGeneratedAt).getTime())).toBe(false);
  });

  it("disables Save Kit while a save is in flight", () => {
    renderPage({ saving: true });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("offers print and PDF export actions but no copy affordance", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export PDF" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
  });

  it("prints the current Kit", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Print" }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it("exports the current Kit through the native save flow", async () => {
    vi.mocked(saveFilePicker).mockResolvedValue("C:\\Exports\\recovery-kit-dana.pdf");
    vi.mocked(writePdfExport).mockResolvedValue();
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(saveFilePicker).toHaveBeenCalledWith({
      defaultPath: "recovery-kit-dana.pdf",
      filters: [{ name: "PDF document", extensions: ["pdf"] }],
    });
    expect(writePdfExport).toHaveBeenCalledWith(
      "C:\\Exports\\recovery-kit-dana.pdf",
      new Uint8Array([37, 80, 68, 70, 45]),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "PDF saved to: C:\\Exports\\recovery-kit-dana.pdf",
    );
  });

  it("shows a useful error when the PDF write fails", async () => {
    vi.mocked(saveFilePicker).mockResolvedValue("C:\\Exports\\recovery-kit-dana.pdf");
    vi.mocked(writePdfExport).mockRejectedValue(new Error("StorageError"));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The PDF could not be saved. Choose another location and try again.",
    );
  });
});
