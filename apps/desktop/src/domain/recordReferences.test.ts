import { describe, expect, it } from "vitest";
import type { FieldDefinition, PackSection } from "./formModel";
import {
  findRecordReferenceUsages,
  resolveRecordReference,
} from "./recordReferences";
import type { VaultValues } from "./valuesStore";

const sections: PackSection[] = [
  {
    sectionKey: "devices",
    title: "Devices",
    lede: "",
    multiRecord: true,
    order: 1,
    groups: [
      {
        groupKey: "device",
        title: "Device",
        repeatable: false,
        order: 1,
        fields: [
          {
            systemKey: "deviceName",
            label: "Device name",
            type: "text",
            required: true,
            protected: true,
            order: 1,
          },
        ],
      },
    ],
    readinessRule: { requiredKeys: ["deviceName"] },
    kitMapping: { entries: [] },
  },
  {
    sectionKey: "backups",
    title: "Backups & Storage",
    lede: "",
    multiRecord: true,
    order: 2,
    groups: [
      {
        groupKey: "backup",
        title: "Backup",
        repeatable: false,
        order: 1,
        fields: [
          {
            systemKey: "backupDevice",
            label: "Device",
            type: "recordRef",
            required: true,
            protected: true,
            reference: {
              sectionKey: "devices",
              displayFields: [{ systemKey: "deviceName" }],
              separator: " — ",
            },
            order: 1,
          },
        ],
      },
    ],
    readinessRule: { requiredKeys: ["backupDevice"] },
    kitMapping: { entries: [] },
  },
];

const values: VaultValues = {
  devices: {
    sectionKey: "devices",
    archivedAnswers: [],
    records: [
      {
        id: "device-1",
        schemaVersion: 1,
        values: { deviceName: "Home NAS" },
      },
      {
        id: "device-2",
        schemaVersion: 1,
        values: { deviceName: "Home NAS" },
      },
    ],
  },
  backups: {
    sectionKey: "backups",
    archivedAnswers: [],
    records: [
      {
        id: "backup-1",
        schemaVersion: 1,
        values: { backupDevice: "device-1" },
      },
    ],
  },
};

describe("record references", () => {
  it("uses stable record ids while allowing duplicate display labels", () => {
    const field = sections[1]!.groups[0]!.fields[0]!;

    expect(resolveRecordReference(field, sections, values)).toEqual({
      options: [
        { value: "device-1", label: "Home NAS" },
        { value: "device-2", label: "Home NAS" },
      ],
      unavailableValue: null,
    });
  });

  it("omits empty parts and masks configured values to their last four characters", () => {
    const field: FieldDefinition = {
      systemKey: "paymentAccount",
      label: "Payment method",
      type: "recordRef",
      required: false,
      protected: false,
      reference: {
        sectionKey: "accounts",
        displayFields: [
          { systemKey: "institution" },
          { systemKey: "nickname" },
          { systemKey: "number", format: "last4" },
        ],
        separator: " — ",
      },
      order: 1,
    };
    const accountSections: PackSection[] = [
      {
        ...sections[0]!,
        sectionKey: "accounts",
        groups: [
          {
            ...sections[0]!.groups[0]!,
            fields: [
              { ...sections[0]!.groups[0]!.fields[0]!, systemKey: "institution" },
              {
                ...sections[0]!.groups[0]!.fields[0]!,
                systemKey: "nickname",
                required: false,
                protected: false,
              },
              {
                ...sections[0]!.groups[0]!.fields[0]!,
                systemKey: "number",
                required: false,
                protected: false,
              },
            ],
          },
        ],
        readinessRule: { requiredKeys: ["institution"] },
      },
    ];
    const accountValues: VaultValues = {
      accounts: {
        sectionKey: "accounts",
        archivedAnswers: [],
        records: [
          {
            id: "account-1",
            schemaVersion: 1,
            values: { institution: "Chase", nickname: "", number: "123456789" },
          },
        ],
      },
    };

    expect(resolveRecordReference(field, accountSections, accountValues).options).toEqual([
      { value: "account-1", label: "Chase — •••• 6789" },
    ]);
  });

  it("preserves an unavailable saved reference instead of silently clearing it", () => {
    const field = sections[1]!.groups[0]!.fields[0]!;

    expect(resolveRecordReference(field, sections, values, "missing-device")).toEqual({
      options: [
        { value: "device-1", label: "Home NAS" },
        { value: "device-2", label: "Home NAS" },
      ],
      unavailableValue: "missing-device",
    });
  });

  it("finds inbound references with human-readable section and record labels", () => {
    expect(findRecordReferenceUsages("devices", "device-1", sections, values)).toEqual([
      {
        sectionKey: "backups",
        sectionTitle: "Backups & Storage",
        recordId: "backup-1",
        recordLabel: "Home NAS",
        fieldSystemKey: "backupDevice",
        fieldLabel: "Device",
      },
    ]);
  });
});
