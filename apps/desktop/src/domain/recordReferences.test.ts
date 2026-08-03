import { describe, expect, it } from "vitest";
import type { FieldDefinition, PackSection } from "./formModel";
import {
  defaultRecordReference,
  findRecordReferenceUsages,
  recordReferenceLabel,
  recordReferenceSourceFields,
  recordSummaryLabel,
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

describe("record reference labels and credential keys", () => {
  const deviceRecord = {
    id: "device-1",
    schemaVersion: 1,
    values: { deviceName: "Mom's iPhone", devicePin: "480215" },
  };

  it("drops a credential display field from the composed label", () => {
    const label = recordReferenceLabel(deviceRecord, {
      reference: {
        sectionKey: "devices",
        displayFields: [{ systemKey: "deviceName" }, { systemKey: "devicePin" }],
        separator: " — ",
      },
    });
    expect(label).toBe("Mom's iPhone");
  });

  it("falls back to Untitled rather than printing a credential-only label", () => {
    const label = recordReferenceLabel(deviceRecord, {
      reference: {
        sectionKey: "devices",
        displayFields: [{ systemKey: "devicePin" }],
        separator: " — ",
      },
    });
    expect(label).toBe("Untitled record");
  });

  it("masking a credential with last4 still does not print it", () => {
    const label = recordReferenceLabel(deviceRecord, {
      reference: {
        sectionKey: "devices",
        displayFields: [{ systemKey: "devicePin", format: "last4" }],
        separator: " — ",
      },
    });
    expect(label).not.toContain("0215");
  });

  it("omits empty optional parts from a configured record summary label", () => {
    const fields: FieldDefinition[] = [
      {
        systemKey: "accountInstitution",
        label: "Bank or Institution",
        type: "text",
        required: true,
        protected: true,
        order: 1,
      },
      {
        systemKey: "accountName",
        label: "Account Name",
        type: "text",
        required: false,
        protected: false,
        order: 2,
      },
    ];

    expect(
      recordSummaryLabel(
        {
          id: "account-1",
          schemaVersion: 1,
          values: { accountInstitution: "Chase", accountName: "" },
        },
        fields,
        {
          readinessRule: { requiredKeys: ["accountInstitution"] },
          recordLabel: {
            fields: ["accountInstitution", "accountName"],
            separator: " — ",
          },
        },
      ),
    ).toBe("Chase");
  });

  it("never falls back to a credential for a record summary label", () => {
    const fields: FieldDefinition[] = [
      {
        systemKey: "deviceName",
        label: "Device name",
        type: "text",
        required: false,
        protected: false,
        order: 1,
      },
      {
        systemKey: "devicePin",
        label: "PIN or Password",
        type: "text",
        required: false,
        protected: false,
        order: 2,
      },
    ];

    const label = recordSummaryLabel(
      {
        id: "device-1",
        schemaVersion: 1,
        values: { deviceName: "", devicePin: "480215" },
      },
      fields,
      {
        readinessRule: { requiredKeys: ["deviceName"] },
        recordLabel: {
          fields: ["deviceName", "devicePin"],
          separator: " — ",
        },
      },
    );

    expect(label).toBe("Untitled");
    expect(label).not.toContain("480215");
  });

  it("never offers a credential key as a selectable display field", () => {
    const source = {
      sectionKey: "devices",
      title: "Devices",
      readinessRule: { requiredKeys: ["deviceName"] },
      groups: [
        {
          fields: [
            {
              systemKey: "deviceName",
              label: "Device name",
              type: "text" as const,
              required: true,
              protected: true,
              order: 1,
            },
            {
              systemKey: "devicePin",
              label: "PIN or Password",
              type: "text" as const,
              required: false,
              protected: false,
              order: 2,
            },
          ],
        },
      ],
    };
    expect(recordReferenceSourceFields(source).map((field) => field.systemKey)).toEqual([
      "deviceName",
    ]);
  });

  it("never auto-selects a credential key when seeding a new reference", () => {
    const pinFirst: PackSection = {
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
              systemKey: "devicePin",
              label: "PIN or Password",
              type: "text",
              required: false,
              protected: false,
              order: 1,
            },
            {
              systemKey: "deviceName",
              label: "Device name",
              type: "text",
              required: false,
              protected: false,
              order: 2,
            },
          ],
        },
      ],
      // No readiness key to steer it, so it falls back to the first field —
      // which must skip the credential.
      readinessRule: { requiredKeys: [] },
      kitMapping: { entries: [] },
    };
    expect(defaultRecordReference(pinFirst)?.displayFields).toEqual([{ systemKey: "deviceName" }]);
  });
});
