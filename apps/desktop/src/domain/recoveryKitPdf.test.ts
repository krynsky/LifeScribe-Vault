import { describe, expect, it } from "vitest";
import type { RecoveryKit } from "./recoveryKit";
import { buildRecoveryKitPdf, recoveryKitPdfFilename } from "./recoveryKitPdf";

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

describe("Recovery Kit PDF", () => {
  it("builds a PDF payload and a safe owner-specific filename", () => {
    const bytes = buildRecoveryKitPdf(KIT);

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(100);
    expect(recoveryKitPdfFilename(KIT)).toBe("recovery-kit-dana-o-neil.pdf");
  });
});
