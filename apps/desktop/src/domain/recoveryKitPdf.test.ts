import { describe, expect, it } from "vitest";
import type { RecoveryKit } from "./recoveryKit";
import {
  buildRecoveryKitPdf,
  recoveryKitPdfFilename,
  recoveryKitPdfHeading,
} from "./recoveryKitPdf";

const KIT: RecoveryKit = {
  ownerName: "Dana O'Neil",
  entries: [
    {
      sectionKey: "executors",
      sectionTitle: "Digital Executors",
      heading: "Who to contact first",
      blocks: [
        {
          recordId: "executor-1",
          recordLabel: "Primary executor",
          items: [{ systemKey: "name", label: "Name", value: "Alex Example" }],
        },
      ],
    },
  ],
};

const EXPORTED_AT = new Date(2026, 7, 3); // 3 August 2026, local time

describe("Recovery Kit PDF", () => {
  it("builds a PDF payload and a safe owner-specific filename", () => {
    const bytes = buildRecoveryKitPdf(KIT, EXPORTED_AT);

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(100);
    expect(recoveryKitPdfFilename(KIT)).toBe("recovery-kit-dana-o-neil.pdf");
  });

  it("dates the exported document so a filed copy can be judged current", () => {
    const heading = recoveryKitPdfHeading(KIT, EXPORTED_AT);

    expect(heading).toContain("Dana O'Neil's vault");
    expect(heading).toContain("exported");
    // Asserted loosely on purpose: the exact wording is locale-dependent, but
    // a spelled-out month and a four-digit year must always be present so the
    // date cannot be misread as day/month in one region and month/day in
    // another.
    expect(heading).toMatch(/August/);
    expect(heading).toMatch(/2026/);
  });

  it("still dates the document when the vault has no owner name", () => {
    const heading = recoveryKitPdfHeading({ ...KIT, ownerName: null }, EXPORTED_AT);

    expect(heading).toContain("Vault snapshot");
    expect(heading).toMatch(/2026/);
  });
});
