import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FormPack } from "./formModel";
import { useComposedPreview } from "./useComposedPreview";

function packWithSecretsModule(): FormPack {
  return {
    packId: "p", packVersion: "1.0.0", schemaVersion: 1, minAppVersion: "0.0.0", migrations: [],
    sections: [
      {
        sectionKey: "identity", title: "Identity", lede: "", multiRecord: false, order: 1,
        groups: [{ groupKey: "g", title: "Details", repeatable: false, order: 1, fields: [
          { systemKey: "fullName", label: "Full name", type: "text", required: true, protected: true, order: 1 },
        ]}],
        readinessRule: { requiredKeys: ["fullName"] }, kitMapping: { entries: [{ heading: "Identity", fields: ["fullName"] }] },
      },
    ],
    modules: [{
      moduleId: "secrets", title: "Store passwords", question: "?", defaultOptionId: "off", order: 1,
      options: [
        { optionId: "off" },
        { optionId: "on", addFields: [{ sectionKey: "identity", groupKey: "g", order: 2, field: {
          systemKey: "masterPassword", label: "Master password", type: "text", required: false, protected: false, order: 2 } }] },
      ],
    }],
  };
}

describe("useComposedPreview", () => {
  it("returns composed sections and no error for a valid combination", () => {
    const base = packWithSecretsModule();
    const { result } = renderHook(() => useComposedPreview(base, { secrets: "on" }));
    expect(result.current.error).toBe("");
    const keys = result.current.sections.flatMap((s) => s.groups.flatMap((g) => g.fields.map((f) => f.systemKey)));
    expect(keys).toContain("masterPassword");
  });

  it("returns an error and empty sections when the combination is invalid", () => {
    const base = packWithSecretsModule();
    base.modules![0].options[1].addFields![0].sectionKey = "missing-section";
    const { result } = renderHook(() => useComposedPreview(base, { secrets: "on" }));
    expect(result.current.error).not.toBe("");
    expect(result.current.sections).toEqual([]);
  });

  it("returns empty sections and no error when base is null", () => {
    const { result } = renderHook(() => useComposedPreview(null, {}));
    expect(result.current).toEqual({ sections: [], error: "" });
  });
});
