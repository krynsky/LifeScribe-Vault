import { jsPDF } from "jspdf";
import type { RecoveryKit } from "./recoveryKit";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function pdfText(value: string): string {
  return value
    .replace(/—/g, "-")
    .replace(/–/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/’/g, "'");
}

function addWrappedText(
  document: jsPDF,
  value: string,
  x: number,
  y: number,
  fontSize: number,
  maxWidth: number,
  lineHeight: number,
): number {
  document.setFontSize(fontSize);
  const lines = document.splitTextToSize(pdfText(value), maxWidth) as string[];
  for (const line of lines) {
    if (y > PAGE_HEIGHT - MARGIN) {
      document.addPage();
      y = MARGIN;
    }
    document.text(line, x, y);
    y += lineHeight;
  }
  return y;
}

/** Build the already-filtered Kit view as PDF bytes for a user-controlled export. */
export function buildRecoveryKitPdf(kit: RecoveryKit): Uint8Array {
  const document = new jsPDF({ unit: "pt", format: "letter" });
  let y = MARGIN;

  document.setFont("helvetica", "bold");
  document.setFontSize(20);
  document.text("Recovery Kit", MARGIN, y);
  y += 24;

  document.setFont("helvetica", "normal");
  y = addWrappedText(
    document,
    kit.ownerName ? `${kit.ownerName}'s vault` : "Vault snapshot",
    MARGIN,
    y,
    11,
    CONTENT_WIDTH,
    15,
  );
  y += 8;
  y = addWrappedText(
    document,
    "Snapshot of the saved data in your vault for printing, storage, and review.",
    MARGIN,
    y,
    10,
    CONTENT_WIDTH,
    14,
  );
  y += 18;

  for (const entry of kit.entries) {
    if (y > PAGE_HEIGHT - MARGIN - 60) {
      document.addPage();
      y = MARGIN;
    }
    document.setFont("helvetica", "bold");
    y = addWrappedText(document, entry.sectionTitle, MARGIN, y, 9, CONTENT_WIDTH, 13);
    y = addWrappedText(document, entry.heading, MARGIN, y + 2, 14, CONTENT_WIDTH, 18);
    y += 8;

    for (const block of entry.blocks) {
      if (block.recordLabel) {
        document.setFont("helvetica", "bold");
        y = addWrappedText(document, block.recordLabel, MARGIN, y, 11, CONTENT_WIDTH, 15);
        y += 3;
      }

      document.setFont("helvetica", "normal");
      for (const item of block.items) {
        y = addWrappedText(
          document,
          `${item.label}: ${item.value}`,
          MARGIN + 12,
          y,
          10,
          CONTENT_WIDTH - 12,
          14,
        );
      }
      y += 10;
    }
    y += 8;
  }

  return new Uint8Array(document.output("arraybuffer"));
}

export function recoveryKitPdfFilename(kit: RecoveryKit): string {
  const filenameOwner = kit.ownerName
    ? `-${kit.ownerName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`
    : "";
  return `recovery-kit${filenameOwner}.pdf`;
}
