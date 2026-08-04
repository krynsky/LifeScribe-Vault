import { describe, it, expect } from "vitest";
import { collectAttachmentIds, droppedAttachmentIds } from "./attachmentRefs";
import type { SectionValues, VaultValues } from "./valuesStore";

function section(
  sectionKey: string,
  attachments: { recordId: string; ids: string[] }[],
): SectionValues {
  return {
    sectionKey,
    records: attachments.map(({ recordId, ids }) => ({
      id: recordId,
      schemaVersion: 1,
      values: Object.fromEntries(ids.map((id, i) => [`file_${i}`, id])),
      attachments: ids.map((id) => ({ id, fileName: `${id}.pdf`, sizeBytes: 1 })),
    })),
    archivedAnswers: [],
  };
}

describe("collectAttachmentIds", () => {
  it("collects ids across sections and records; empty when none", () => {
    expect(collectAttachmentIds([])).toEqual([]);
    const sections = [
      section("documents", [{ recordId: "r1", ids: ["a", "b"] }]),
      section("devices", [
        { recordId: "r2", ids: [] },
        { recordId: "r3", ids: ["c"] },
      ]),
    ];
    expect(collectAttachmentIds(sections)).toEqual(["a", "b", "c"]);
  });

  it("collects attachment ids retained by archived answers", () => {
    const archived = section("documents", []);
    archived.archivedAnswers.push({
      id: "documents:r1:file",
      sectionKey: "documents",
      recordId: "r1",
      systemKey: "file",
      originalLabel: "File",
      value: "archived-file",
      reason: "The field was removed.",
      attachment: { id: "archived-file", fileName: "will.pdf", sizeBytes: 12 },
    });

    expect(collectAttachmentIds([archived])).toEqual(["archived-file"]);
  });
});

describe("droppedAttachmentIds", () => {
  const before: VaultValues = {
    documents: section("documents", [{ recordId: "r1", ids: ["a", "b"] }]),
    devices: section("devices", [{ recordId: "r2", ids: ["c"] }]),
  };

  it("returns ids no longer referenced after the save", () => {
    const after: VaultValues = {
      documents: section("documents", [{ recordId: "r1", ids: ["b"] }]),
      // devices section (and its record) removed entirely.
    };
    expect(droppedAttachmentIds(before, after).sort()).toEqual(["a", "c"]);
  });

  it("returns nothing when references are unchanged or only added", () => {
    expect(droppedAttachmentIds(before, before)).toEqual([]);
    const withNew: VaultValues = {
      ...before,
      documents: section("documents", [{ recordId: "r1", ids: ["a", "b", "new"] }]),
    };
    expect(droppedAttachmentIds(before, withNew)).toEqual([]);
  });

  it("keeps an id that moved to a different section", () => {
    const moved: VaultValues = {
      documents: section("documents", [{ recordId: "r1", ids: ["b"] }]),
      devices: section("devices", [{ recordId: "r2", ids: ["c", "a"] }]),
    };
    expect(droppedAttachmentIds(before, moved)).toEqual([]);
  });

  it("does not drop an id moved from an active record into archived data", () => {
    const archived = section("documents", []);
    archived.archivedAnswers.push({
      id: "documents:r1:file_0",
      sectionKey: "documents",
      recordId: "r1",
      systemKey: "file_0",
      originalLabel: "File",
      value: "a",
      reason: "The field was removed.",
      attachment: { id: "a", fileName: "a.pdf", sizeBytes: 1 },
    });
    const after: VaultValues = { ...before, documents: archived };

    expect(droppedAttachmentIds(before, after).sort()).toEqual(["b"]);
  });
});
