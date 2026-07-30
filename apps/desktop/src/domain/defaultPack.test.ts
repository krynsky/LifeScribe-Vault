/**
 * Shipped default pack (U6): structural guarantees over the authored
 * content (copy quality is reviewed manually in-app) plus a render smoke
 * test through the generic RecordList renderer.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { RecordList } from "../components/RecordList";
import type { SectionValues } from "./valuesStore";
import type {
  FieldDefinition,
  FormPack,
  PackSection,
  ResolvedSection,
  VisibleWhen,
} from "./formModel";
import { mergePackWithOverlay } from "./packMerge";
import { validatePack } from "./packValidation";
import { makeSectionValues } from "./testing/fixtures";

// Vitest runs with cwd = apps/desktop
const DEFAULT_PACK_PATH = resolve(process.cwd(), "src-tauri/resources/packs/default-pack.json");

const EXPECTED_SECTION_KEYS = [
  "digital-executors",
  "password-manager",
  "devices",
  "financial-accounts",
  "subscriptions",
  "online-accounts",
  "documents",
  "backups",
  "platform-legacy",
];

const V1_PROVIDER_VALUES = [
  "1Password",
  "Bitwarden",
  "Dashlane",
  "Keeper",
  "LastPass",
  "NordPass",
  "Proton Pass",
  "Apple Passwords / iCloud Keychain",
  "Google Password Manager",
  "Microsoft Edge / Microsoft Authenticator",
  "Other",
];

function loadShippedPack(): FormPack {
  const result = validatePack(JSON.parse(readFileSync(DEFAULT_PACK_PATH, "utf-8")));
  expect(result.errors).toEqual([]);
  if (!result.ok) {
    throw new Error("shipped pack failed validation");
  }
  return result.pack;
}

const pack = loadShippedPack();

function sectionByKey(sectionKey: string): PackSection {
  const section = pack.sections.find((candidate) => candidate.sectionKey === sectionKey);
  if (!section) {
    throw new Error(`pack has no section ${sectionKey}`);
  }
  return section;
}

function allFields(section: PackSection): FieldDefinition[] {
  return section.groups.flatMap((group) => group.fields);
}

function fieldKeys(section: PackSection): Set<string> {
  return new Set(allFields(section).map((field) => field.systemKey));
}

describe("shipped default pack", () => {
  it("passes validatePack with a stable packId and schemaVersion 1", () => {
    expect(pack.packId).toBe("lifescribe-default");
    expect(pack.schemaVersion).toBe(1);
    expect(pack.migrations).toEqual([]);
  });

  it("ships exactly the nine guided sections in order", () => {
    const ordered = [...pack.sections].sort((left, right) => left.order - right.order);
    expect(ordered.map((section) => section.sectionKey)).toEqual(EXPECTED_SECTION_KEYS);
    expect(pack.sections).toHaveLength(9);
  });

  it("every section has a non-empty caring lede and a kit mapping heading", () => {
    for (const section of pack.sections) {
      expect(section.lede.trim().length, section.sectionKey).toBeGreaterThan(40);
      expect(section.kitMapping.entries.length, section.sectionKey).toBeGreaterThan(0);
      for (const entry of section.kitMapping.entries) {
        expect(entry.heading.trim().length).toBeGreaterThan(0);
        expect(entry.fields.length).toBeGreaterThan(0);
      }
    }
  });

  it("every readiness key references an existing protected field in its own section", () => {
    for (const section of pack.sections) {
      expect(section.readinessRule.requiredKeys.length, section.sectionKey).toBeGreaterThan(0);
      const fields = new Map(allFields(section).map((field) => [field.systemKey, field]));
      for (const key of section.readinessRule.requiredKeys) {
        const field = fields.get(key);
        expect(field, `${section.sectionKey}.${key}`).toBeDefined();
        expect(field?.protected, `${section.sectionKey}.${key} must be protected`).toBe(true);
        expect(field?.required, `${section.sectionKey}.${key} must be required`).toBe(true);
      }
    }
  });

  it("every kit mapping field exists in its own section", () => {
    for (const section of pack.sections) {
      const keys = fieldKeys(section);
      for (const entry of section.kitMapping.entries) {
        for (const key of entry.fields) {
          expect(keys.has(key), `${section.sectionKey} kit field ${key}`).toBe(true);
        }
      }
    }
  });

  it("every visibleWhen conditional references an existing field in its own section", () => {
    for (const section of pack.sections) {
      const keys = fieldKeys(section);
      for (const field of allFields(section)) {
        const condition: VisibleWhen | undefined = field.visibleWhen;
        if (condition) {
          expect(
            keys.has(condition.field),
            `${section.sectionKey}.${field.systemKey} visibleWhen -> ${condition.field}`,
          ).toBe(true);
        }
      }
    }
  });

  it("digital executors repeat through one repeatable executor group with a role conditional", () => {
    const executors = sectionByKey("digital-executors");
    expect(executors.groups).toHaveLength(1);
    expect(executors.groups[0].groupKey).toBe("executor");
    expect(executors.groups[0].repeatable).toBe(true);
    const stepIn = allFields(executors).find((field) => field.systemKey === "executorStepIn");
    expect(stepIn?.visibleWhen).toEqual({ field: "executorRole", equals: "backup" });
    expect(executors.readinessRule.requiredKeys).toEqual(["executorName", "executorRole"]);
  });

  it("platform legacy is a singleton with three fixed (non-repeatable) platform groups", () => {
    const platform = sectionByKey("platform-legacy");
    expect(platform.multiRecord).toBe(false);
    expect(platform.groups.map((group) => group.groupKey)).toEqual([
      "apple",
      "google",
      "facebook",
    ]);
    for (const group of platform.groups) {
      expect(group.repeatable, group.groupKey).toBe(false);
    }
    expect(platform.readinessRule.requiredKeys).toEqual([
      "appleLegacyStatus",
      "googleLegacyStatus",
      "facebookLegacyStatus",
    ]);
  });

  it("the password manager provider list carries v1's options including Other, with the Other conditional", () => {
    const plan = sectionByKey("password-manager");
    expect(plan.multiRecord).toBe(false);
    const provider = allFields(plan).find(
      (field) => field.systemKey === "passwordManagerProvider",
    );
    expect(provider?.options?.map((option) => option.value)).toEqual(V1_PROVIDER_VALUES);
    const other = allFields(plan).find(
      (field) => field.systemKey === "passwordManagerOtherProvider",
    );
    expect(other?.visibleWhen).toEqual({
      field: "passwordManagerProvider",
      equals: "Other",
    });
  });

  it("kit mappings flow pointer/instruction fields only — no field invites a secret", () => {
    // Structural proxy for "no secret slots": no kit-mapped field label
    // names a password/PIN/code value itself (locations and notes are fine).
    const forbidden = /^(password|master password|pin|passcode|secret|seed phrase|recovery code)$/i;
    for (const section of pack.sections) {
      const fields = new Map(allFields(section).map((field) => [field.systemKey, field]));
      for (const entry of section.kitMapping.entries) {
        for (const key of entry.fields) {
          const label = fields.get(key)?.label ?? "";
          expect(forbidden.test(label.trim()), `${section.sectionKey}.${key}`).toBe(false);
        }
      }
    }
  });
});

describe("shipped default pack: the three permanent optional fields", () => {
  function kitKeys(section: PackSection): string[] {
    return section.kitMapping.entries.flatMap((entry) => entry.fields);
  }

  it("ships no modules array", () => {
    expect("modules" in (pack as unknown as Record<string, unknown>)).toBe(false);
  });

  it.each([
    ["password-manager", "passwordManagerMasterPassword", "text"],
    ["devices", "devicePin", "text"],
    ["documents", "documentDigitalFile", "file"],
  ])("%s carries %s as an ordinary optional field", (sectionKey, systemKey, type) => {
    const section = sectionByKey(sectionKey);
    const field = allFields(section).find((candidate) => candidate.systemKey === systemKey);
    expect(field, `${sectionKey}.${systemKey}`).toBeDefined();
    expect(field?.type).toBe(type);
    expect(field?.required).toBe(false);
    expect(field?.protected).toBe(false);
    expect((field?.helperText ?? "").trim().length).toBeGreaterThan(0);
  });

  it("password manager and device fields live in the plan and device groups", () => {
    const planGroup = sectionByKey("password-manager").groups.find((g) => g.groupKey === "plan");
    expect(planGroup?.fields.map((f) => f.systemKey)).toContain(
      "passwordManagerMasterPassword",
    );
    const deviceGroup = sectionByKey("devices").groups.find((g) => g.groupKey === "device");
    expect(deviceGroup?.fields.map((f) => f.systemKey)).toContain("devicePin");
    const docGroup = sectionByKey("documents").groups.find((g) => g.groupKey === "document");
    expect(docGroup?.fields.map((f) => f.systemKey)).toContain("documentDigitalFile");
  });

  it("a Documents record can carry both a digital location and an attached copy", () => {
    const keys = fieldKeys(sectionByKey("documents"));
    expect(keys.has("documentDigitalLocation")).toBe(true);
    expect(keys.has("documentDigitalFile")).toBe(true);
  });

  it("the Documents kit mapping lists the attached copy", () => {
    expect(kitKeys(sectionByKey("documents"))).toContain("documentDigitalFile");
  });

  it("no section's kit mapping can route a live credential to the printed Kit", () => {
    for (const section of pack.sections) {
      const keys = kitKeys(section);
      expect(keys, section.sectionKey).not.toContain("passwordManagerMasterPassword");
      expect(keys, section.sectionKey).not.toContain("devicePin");
    }
  });

  it("section readiness is unchanged by the newly permanent fields", () => {
    expect(
      Object.fromEntries(
        pack.sections.map((section) => [
          section.sectionKey,
          section.readinessRule.requiredKeys,
        ]),
      ),
    ).toEqual({
      "digital-executors": ["executorName", "executorRole"],
      "password-manager": ["passwordManagerProvider"],
      devices: ["deviceName"],
      "financial-accounts": ["accountInstitution"],
      subscriptions: ["subscriptionName"],
      "online-accounts": ["onlineServiceName"],
      documents: ["documentTitle"],
      backups: ["backupLocation"],
      "platform-legacy": [
        "appleLegacyStatus",
        "googleLegacyStatus",
        "facebookLegacyStatus",
      ],
    });
  });
});

/** Minimal stateful harness — RecordList is a controlled component. */
function SectionHarness({ section }: { section: ResolvedSection }) {
  const [values, setValues] = useState<SectionValues>(() =>
    makeSectionValues(section.sectionKey),
  );
  return createElement(RecordList, {
    section,
    values,
    schemaVersion: pack.schemaVersion,
    onChange: setValues,
  });
}

describe("shipped default pack renders through RecordList", () => {
  afterEach(cleanup);

  it("every section renders and shows its first field label", async () => {
    const { resolved, notices } = mergePackWithOverlay(pack);
    expect(notices).toEqual([]);

    for (const section of resolved.sections) {
      const user = userEvent.setup();
      const view = render(createElement(SectionHarness, { section }));

      // Multi-record sections (and repeatable groups) start at an empty
      // state — add the first record to reveal the entry form.
      const firstGroup = [...section.groups].sort((a, b) => a.order - b.order)[0];
      const addButton = screen.queryByRole("button", { name: `Add ${firstGroup.title}` });
      if (addButton) {
        await user.click(addButton);
      }

      const firstField = [...firstGroup.fields].sort((a, b) => a.order - b.order)[0];
      expect(
        screen.getAllByLabelText(firstField.label).length,
        `${section.sectionKey} first field "${firstField.label}"`,
      ).toBeGreaterThan(0);

      view.unmount();
    }
  });
});
