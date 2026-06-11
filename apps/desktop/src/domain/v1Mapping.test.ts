import { describe, expect, it } from "vitest";
import {
  buildDryRunReport,
  mapV1ToV2,
  mergeImportedValues,
  type V1AttachmentImported,
  type V1Snapshot,
} from "./v1Mapping";
import type { VaultValues } from "./valuesStore";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const noAttachments: V1AttachmentImported[] = [];

function minimalSnapshot(): V1Snapshot {
  return {
    profile: { ownerName: "Alice" },
    people: [],
    passwordManagerPlans: [],
    documents: [],
    backups: [],
    attachments: [],
  };
}

// ---------------------------------------------------------------------------
// buildDryRunReport
// ---------------------------------------------------------------------------

describe("buildDryRunReport", () => {
  it("returns empty sections and zero counts for a minimal vault", () => {
    const report = buildDryRunReport(minimalSnapshot(), noAttachments);
    expect(report.sections).toHaveLength(0);
    expect(report.totalAttachments).toBe(0);
    expect(report.customFieldCount).toBe(0);
    expect(report.ownerName).toBe("Alice");
  });

  it("counts primary and backup executors but ignores other roles", () => {
    const snapshot: V1Snapshot = {
      ...minimalSnapshot(),
      people: [
        { id: "p1", role: "primary_executor", fullName: "Bob" },
        { id: "p2", role: "backup_executor", fullName: "Carol" },
        { id: "p3", role: "witness", fullName: "Dave" },
      ],
    };
    const report = buildDryRunReport(snapshot, noAttachments);
    const executors = report.sections.find((s) => s.sectionKey === "digital-executors");
    expect(executors).toBeDefined();
    expect(executors!.itemCount).toBe(2);
  });

  it("counts only one item for password-manager even with multiple plans", () => {
    const snapshot: V1Snapshot = {
      ...minimalSnapshot(),
      passwordManagerPlans: [
        { id: "pm1", provider: "1Password" },
        { id: "pm2", provider: "Bitwarden" },
      ],
    };
    const report = buildDryRunReport(snapshot, noAttachments);
    const pm = report.sections.find((s) => s.sectionKey === "password-manager");
    expect(pm).toBeDefined();
    expect(pm!.itemCount).toBe(1);
    expect(pm!.unmappableFields).toContain("extra plans (only first imported)");
  });

  it("counts documents and backups correctly", () => {
    const snapshot: V1Snapshot = {
      ...minimalSnapshot(),
      documents: [
        { id: "d1", title: "Will" },
        { id: "d2", title: "Trust" },
      ],
      backups: [{ id: "b1", label: "USB drive" }],
    };
    const report = buildDryRunReport(snapshot, noAttachments);
    expect(report.sections.find((s) => s.sectionKey === "documents")?.itemCount).toBe(2);
    expect(report.sections.find((s) => s.sectionKey === "backups")?.itemCount).toBe(1);
  });

  it("counts attachments from the id map, not the snapshot", () => {
    const attachments: V1AttachmentImported[] = [
      { v1Id: "a1", v2Id: "b1", fileName: "will.pdf", sizeBytes: 1024 },
    ];
    const report = buildDryRunReport(minimalSnapshot(), attachments);
    expect(report.totalAttachments).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// mapV1ToV2 — executor mapping
// ---------------------------------------------------------------------------

describe("mapV1ToV2 — executors", () => {
  it("maps primary_executor role to 'primary'", () => {
    const snapshot: V1Snapshot = {
      ...minimalSnapshot(),
      people: [{ id: "p1", role: "primary_executor", fullName: "Bob Smith" }],
    };
    const { sections } = mapV1ToV2(snapshot, noAttachments);
    const executors = sections.find((s) => s.sectionKey === "digital-executors");
    expect(executors?.records).toHaveLength(1);
    expect(executors!.records[0].values["executorRole"]).toBe("primary");
    expect(executors!.records[0].values["executorName"]).toBe("Bob Smith");
  });

  it("maps backup_executor role to 'backup'", () => {
    const snapshot: V1Snapshot = {
      ...minimalSnapshot(),
      people: [{ id: "p2", role: "backup_executor", fullName: "Carol" }],
    };
    const { sections } = mapV1ToV2(snapshot, noAttachments);
    const executors = sections.find((s) => s.sectionKey === "digital-executors");
    expect(executors!.records[0].values["executorRole"]).toBe("backup");
  });

  it("ignores people with roles other than primary/backup executor", () => {
    const snapshot: V1Snapshot = {
      ...minimalSnapshot(),
      people: [
        { id: "p1", role: "witness", fullName: "Dave" },
        { id: "p2", role: "attorney", fullName: "Eve" },
      ],
    };
    const { sections } = mapV1ToV2(snapshot, noAttachments);
    expect(sections.find((s) => s.sectionKey === "digital-executors")).toBeUndefined();
  });

  it("maps v1 contact field to executorResponsibilities", () => {
    const snapshot: V1Snapshot = {
      ...minimalSnapshot(),
      people: [
        {
          id: "p1",
          role: "primary_executor",
          fullName: "Bob",
          contact: "bob@example.com",
        },
      ],
    };
    const { sections } = mapV1ToV2(snapshot, noAttachments);
    const record = sections.find((s) => s.sectionKey === "digital-executors")!.records[0];
    expect(record.values["executorResponsibilities"]).toBe("bob@example.com");
  });

  it("maps informed boolean to string value", () => {
    const snapshot: V1Snapshot = {
      ...minimalSnapshot(),
      people: [{ id: "p1", role: "primary_executor", fullName: "Bob", informed: true }],
    };
    const { sections } = mapV1ToV2(snapshot, noAttachments);
    const record = sections.find((s) => s.sectionKey === "digital-executors")!.records[0];
    expect(record.values["executorInformed"]).toBe("informed");
  });
});

// ---------------------------------------------------------------------------
// mapV1ToV2 — password manager mapping
// ---------------------------------------------------------------------------

describe("mapV1ToV2 — password manager", () => {
  it("maps first plan only", () => {
    const snapshot: V1Snapshot = {
      ...minimalSnapshot(),
      passwordManagerPlans: [
        { id: "pm1", provider: "1Password", accountIdentifier: "me@example.com" },
        { id: "pm2", provider: "Bitwarden" },
      ],
    };
    const { sections } = mapV1ToV2(snapshot, noAttachments);
    const pm = sections.find((s) => s.sectionKey === "password-manager");
    expect(pm?.records).toHaveLength(1);
    expect(pm!.records[0].values["passwordManagerProvider"]).toBe("1Password");
    expect(pm!.records[0].values["passwordManagerAccountIdentifier"]).toBe("me@example.com");
  });
});

// ---------------------------------------------------------------------------
// mapV1ToV2 — document mapping
// ---------------------------------------------------------------------------

describe("mapV1ToV2 — documents", () => {
  it("maps v1 location to documentPhysicalLocation", () => {
    const snapshot: V1Snapshot = {
      ...minimalSnapshot(),
      documents: [{ id: "d1", title: "Will", location: "Home safe" }],
    };
    const { sections } = mapV1ToV2(snapshot, noAttachments);
    const docs = sections.find((s) => s.sectionKey === "documents");
    expect(docs!.records[0].values["documentPhysicalLocation"]).toBe("Home safe");
    expect(docs!.records[0].values["documentTitle"]).toBe("Will");
  });

  it("remaps v1 attachment ids to v2 ids in document records", () => {
    const attachments: V1AttachmentImported[] = [
      { v1Id: "old-uuid", v2Id: "new-uuid", fileName: "will.pdf", sizeBytes: 512 },
    ];
    const snapshot: V1Snapshot = {
      ...minimalSnapshot(),
      documents: [{ id: "d1", title: "Will", attachmentIds: ["old-uuid"] }],
    };
    const { sections } = mapV1ToV2(snapshot, attachments);
    const record = sections.find((s) => s.sectionKey === "documents")!.records[0];
    expect(record.attachments).toHaveLength(1);
    expect(record.attachments![0].id).toBe("new-uuid");
    expect(record.attachments![0].fileName).toBe("will.pdf");
  });

  it("omits unknown attachment ids silently", () => {
    const snapshot: V1Snapshot = {
      ...minimalSnapshot(),
      documents: [{ id: "d1", title: "Will", attachmentIds: ["missing-uuid"] }],
    };
    const { sections } = mapV1ToV2(snapshot, noAttachments);
    const record = sections.find((s) => s.sectionKey === "documents")!.records[0];
    expect(record.attachments ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// mapV1ToV2 — backup mapping
// ---------------------------------------------------------------------------

describe("mapV1ToV2 — backups", () => {
  it("maps v1 kind to backupType", () => {
    const snapshot: V1Snapshot = {
      ...minimalSnapshot(),
      backups: [{ id: "bk1", label: "USB", kind: "external-drive" }],
    };
    const { sections } = mapV1ToV2(snapshot, noAttachments);
    const bk = sections.find((s) => s.sectionKey === "backups");
    expect(bk!.records[0].values["backupType"]).toBe("external-drive");
    expect(bk!.records[0].values["backupLabel"]).toBe("USB");
  });
});

// ---------------------------------------------------------------------------
// mergeImportedValues
// ---------------------------------------------------------------------------

describe("mergeImportedValues", () => {
  it("appends to an empty vault", () => {
    const existing: VaultValues = {};
    const snapshot: V1Snapshot = {
      ...minimalSnapshot(),
      people: [{ id: "p1", role: "primary_executor", fullName: "Bob" }],
    };
    const { sections } = mapV1ToV2(snapshot, noAttachments);
    const merged = mergeImportedValues(existing, sections, []);
    expect(merged["digital-executors"].records).toHaveLength(1);
  });

  it("appends to an existing section without clobbering", () => {
    const existing: VaultValues = {
      "digital-executors": {
        sectionKey: "digital-executors",
        records: [{ id: "existing", schemaVersion: 1, values: { executorName: "Alice" } }],
        archivedAnswers: [],
      },
    };
    const snapshot: V1Snapshot = {
      ...minimalSnapshot(),
      people: [{ id: "p1", role: "primary_executor", fullName: "Bob" }],
    };
    const { sections } = mapV1ToV2(snapshot, noAttachments);
    const merged = mergeImportedValues(existing, sections, []);
    expect(merged["digital-executors"].records).toHaveLength(2);
    expect(merged["digital-executors"].records[0].id).toBe("existing");
  });

  it("clears a section when listed in clearSections", () => {
    const existing: VaultValues = {
      "password-manager": {
        sectionKey: "password-manager",
        records: [
          { id: "old", schemaVersion: 1, values: { passwordManagerProvider: "LastPass" } },
        ],
        archivedAnswers: [],
      },
    };
    const snapshot: V1Snapshot = {
      ...minimalSnapshot(),
      passwordManagerPlans: [{ id: "pm1", provider: "1Password" }],
    };
    const { sections } = mapV1ToV2(snapshot, noAttachments);
    const merged = mergeImportedValues(existing, sections, ["password-manager"]);
    expect(merged["password-manager"].records).toHaveLength(1);
    expect(merged["password-manager"].records[0].values["passwordManagerProvider"]).toBe("1Password");
  });

  it("does not mutate the existing VaultValues", () => {
    const existing: VaultValues = {};
    const snapshot: V1Snapshot = {
      ...minimalSnapshot(),
      backups: [{ id: "bk1", label: "USB" }],
    };
    const { sections } = mapV1ToV2(snapshot, noAttachments);
    mergeImportedValues(existing, sections, []);
    expect(existing).toEqual({});
  });
});
