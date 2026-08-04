import { describe, expect, it } from "vitest";
import type { ResolvedSection } from "./formModel";
import {
  addMonths,
  readinessSummary,
  sectionHasAnyValue,
  sectionMetaAfterSave,
  sectionStatus,
} from "./readiness";
import type { SectionValues } from "./valuesStore";

function makeSection(sectionKey: string, order = 1): ResolvedSection {
  return {
    sectionKey,
    title: sectionKey,
    lede: "",
    multiRecord: false,
    order,
    groups: [],
    readinessRule: { requiredKeys: [] },
    kitMapping: { entries: [] },
  };
}

function makeValues(
  sectionKey: string,
  records: Array<Record<string, string>>,
): SectionValues {
  return {
    sectionKey,
    records: records.map((values, index) => ({
      id: `record-${index}`,
      schemaVersion: 1,
      values,
    })),
    archivedAnswers: [],
  };
}

const NOW = new Date("2026-06-11T12:00:00Z");

describe("sectionHasAnyValue", () => {
  it("requires at least one record with at least one non-empty value, in any field", () => {
    expect(sectionHasAnyValue(undefined)).toBe(false);
    expect(sectionHasAnyValue(makeValues("s", []))).toBe(false);
    expect(sectionHasAnyValue(makeValues("s", [{ a: "  " }]))).toBe(false);
    expect(sectionHasAnyValue(makeValues("s", [{ a: "" }, { b: "hi" }]))).toBe(true);
  });

  it("does not care which field is filled — no gating keys, unlike the old model", () => {
    // Any field counts; there is no per-section "required key" involved.
    expect(sectionHasAnyValue(makeValues("s", [{ anythingAtAll: "x" }]))).toBe(true);
  });
});

describe("sectionStatus", () => {
  const empty = undefined;
  const started = makeValues("s", [{ note: "Dana" }]);

  it("na overrides everything, filled or not", () => {
    expect(sectionStatus(empty, { na: true }, 12, NOW)).toBe("na");
    expect(sectionStatus(started, { na: true, completed: true }, 12, NOW)).toBe("na");
  });

  it("a section with data but not marked complete is started, never complete", () => {
    expect(sectionStatus(started, undefined, 12, NOW)).toBe("started");
    expect(
      sectionStatus(started, { lastSavedAt: "2026-06-01T00:00:00Z" }, 12, NOW),
    ).toBe("started");
  });

  it("an empty section with no decision made is not-started", () => {
    expect(sectionStatus(empty, undefined, 12, NOW)).toBe("not-started");
    expect(sectionStatus(empty, {}, 12, NOW)).toBe("not-started");
  });

  it("completed + has data + recent save/review is complete", () => {
    expect(
      sectionStatus(
        started,
        { completed: true, lastSavedAt: "2026-06-01T00:00:00Z" },
        12,
        NOW,
      ),
    ).toBe("complete");
  });

  it("completed but the section is now empty reverts to not-started, not complete", () => {
    // The user marked it complete earlier; every record has since been
    // deleted. The stale flag must not keep claiming completeness.
    expect(sectionStatus(empty, { completed: true, lastSavedAt: NOW.toISOString() }, 12, NOW)).toBe(
      "not-started",
    );
  });

  it("goes stale-complete past the review cadence", () => {
    const meta = { completed: true, lastSavedAt: "2025-01-01T00:00:00Z" };
    const status = sectionStatus(started, meta, 12, NOW);
    expect(status).toBe("stale-complete");
  });

  it("shortening the cadence makes a previously fresh completed section stale", () => {
    const meta = { completed: true, lastSavedAt: "2026-03-01T00:00:00Z" }; // ~3 months ago
    expect(sectionStatus(started, meta, 12, NOW)).toBe("complete");
    expect(sectionStatus(started, meta, 2, NOW)).toBe("stale-complete");
  });

  it("mark-reviewed clears staleness without any data edits", () => {
    const stale = { completed: true, lastSavedAt: "2025-01-01T00:00:00Z" };
    expect(sectionStatus(started, stale, 12, NOW)).toBe("stale-complete");
    const reviewed = { ...stale, lastReviewedAt: "2026-06-10T00:00:00Z" };
    expect(sectionStatus(started, reviewed, 12, NOW)).toBe("complete");
  });

  it("completed with no recorded save/review timestamp surfaces as stale-complete", () => {
    expect(sectionStatus(started, { completed: true }, 12, NOW)).toBe("stale-complete");
  });
});

describe("sectionMetaAfterSave", () => {
  it("stamps lastSavedAt", () => {
    const next = sectionMetaAfterSave(undefined, makeValues("s", [{ a: "x" }]), NOW.toISOString());
    expect(next.lastSavedAt).toBe(NOW.toISOString());
  });

  it("preserves an existing completed flag when the section still has data", () => {
    const next = sectionMetaAfterSave(
      { completed: true },
      makeValues("s", [{ a: "x" }]),
      NOW.toISOString(),
    );
    expect(next.completed).toBe(true);
  });

  it("drops a completed flag when the save leaves the section empty", () => {
    const next = sectionMetaAfterSave({ completed: true }, makeValues("s", []), NOW.toISOString());
    expect(next.completed).toBeUndefined();
    expect("completed" in next).toBe(false);
  });

  it("is a no-op on completed when it was never set", () => {
    const next = sectionMetaAfterSave({ na: true }, makeValues("s", []), NOW.toISOString());
    expect(next.na).toBe(true);
    expect(next.completed).toBeUndefined();
  });
});

describe("readinessSummary", () => {
  const first = makeSection("a", 1);
  const second = makeSection("b", 2);

  it("counts complete, stale-complete, and N/A as ready; started does not count", () => {
    const summary = readinessSummary(
      [first, second],
      { a: makeValues("a", [{ x: "filled" }]) },
      { a: { completed: true, lastSavedAt: "2024-01-01T00:00:00Z" }, b: { na: true } }, // a is stale
      12,
      NOW,
    );
    expect(summary.percent).toBe(100);
    expect(summary.readySections).toBe(2);
    expect(summary.firstIncomplete).toBeNull();
  });

  it("a merely-started section (data, not marked complete) is not ready", () => {
    const summary = readinessSummary(
      [first],
      { a: makeValues("a", [{ x: "filled" }]) },
      {},
      12,
      NOW,
    );
    expect(summary.percent).toBe(0);
    expect(summary.firstIncomplete?.sectionKey).toBe("a");
  });

  it("reports the first not-ready section in pack order for the welcome CTA", () => {
    const summary = readinessSummary([second, first], {}, {}, 12, NOW);
    expect(summary.percent).toBe(0);
    expect(summary.firstIncomplete?.sectionKey).toBe("a");
  });

  it("rounds the percentage", () => {
    const third = makeSection("c", 3);
    const summary = readinessSummary(
      [first, second, third],
      { a: makeValues("a", [{ x: "filled" }]) },
      { a: { completed: true, lastSavedAt: "2026-06-01T00:00:00Z" } },
      12,
      NOW,
    );
    expect(summary.percent).toBe(33);
  });

  it("unmarking N/A drops the section back out of the ready count", () => {
    const ready = readinessSummary([first], {}, { a: { na: true } }, 12, NOW);
    expect(ready.percent).toBe(100);
    const unmarked = readinessSummary([first], {}, { a: {} }, 12, NOW);
    expect(unmarked.percent).toBe(0);
    expect(unmarked.firstIncomplete?.sectionKey).toBe("a");
  });
});

describe("addMonths", () => {
  it("adds calendar months and clamps overflowing days", () => {
    expect(addMonths(new Date("2026-01-15T00:00:00Z"), 1).toISOString()).toBe(
      "2026-02-15T00:00:00.000Z",
    );
    expect(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });
});
