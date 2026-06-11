import { describe, expect, it } from "vitest";
import type { ResolvedSection } from "./formModel";
import {
  addMonths,
  isSectionFilled,
  readinessSummary,
  sectionStatus,
} from "./readiness";
import type { SectionValues } from "./valuesStore";

function makeSection(
  sectionKey: string,
  requiredKeys: string[],
  order = 1,
): ResolvedSection {
  return {
    sectionKey,
    title: sectionKey,
    lede: "",
    multiRecord: false,
    order,
    groups: [],
    readinessRule: { requiredKeys },
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

describe("isSectionFilled", () => {
  const section = makeSection("executors", ["executorName"]);

  it("requires at least one record with every readiness key non-empty", () => {
    expect(isSectionFilled(section, undefined)).toBe(false);
    expect(isSectionFilled(section, makeValues("executors", []))).toBe(false);
    expect(isSectionFilled(section, makeValues("executors", [{ executorName: "  " }]))).toBe(
      false,
    );
    expect(
      isSectionFilled(section, makeValues("executors", [{ executorName: "Dana" }])),
    ).toBe(true);
    // One complete record among incomplete ones is enough.
    expect(
      isSectionFilled(
        section,
        makeValues("executors", [{ executorName: "" }, { executorName: "Dana" }]),
      ),
    ).toBe(true);
  });

  it("with no readiness keys, any record with any non-empty value counts", () => {
    const open = makeSection("notes", []);
    expect(isSectionFilled(open, makeValues("notes", [{}]))).toBe(false);
    expect(isSectionFilled(open, makeValues("notes", [{ note: "hi" }]))).toBe(true);
  });
});

describe("sectionStatus", () => {
  const section = makeSection("executors", ["executorName"]);
  const filled = makeValues("executors", [{ executorName: "Dana" }]);

  it("N/A marks a section complete toward readiness regardless of data", () => {
    expect(sectionStatus(section, undefined, { na: true }, 12, NOW)).toBe("na");
    expect(sectionStatus(section, filled, { na: true }, 12, NOW)).toBe("na");
  });

  it("unmarking N/A returns an empty section to incomplete", () => {
    expect(sectionStatus(section, undefined, { na: true }, 12, NOW)).toBe("na");
    expect(sectionStatus(section, undefined, {}, 12, NOW)).toBe("incomplete");
  });

  it("filled + recent save is complete; empty is incomplete", () => {
    expect(
      sectionStatus(section, filled, { lastSavedAt: "2026-06-01T00:00:00Z" }, 12, NOW),
    ).toBe("complete");
    expect(sectionStatus(section, undefined, {}, 12, NOW)).toBe("incomplete");
  });

  it("goes stale-complete (distinct from incomplete) past the review cadence", () => {
    const meta = { lastSavedAt: "2025-01-01T00:00:00Z" };
    const status = sectionStatus(section, filled, meta, 12, NOW);
    expect(status).toBe("stale-complete");
    expect(status).not.toBe("incomplete");
  });

  it("shortening the cadence makes a previously fresh section stale", () => {
    const meta = { lastSavedAt: "2026-03-01T00:00:00Z" }; // ~3 months ago
    expect(sectionStatus(section, filled, meta, 12, NOW)).toBe("complete");
    expect(sectionStatus(section, filled, meta, 2, NOW)).toBe("stale-complete");
  });

  it("mark-reviewed clears staleness without any data edits", () => {
    const stale = { lastSavedAt: "2025-01-01T00:00:00Z" };
    expect(sectionStatus(section, filled, stale, 12, NOW)).toBe("stale-complete");
    const reviewed = { ...stale, lastReviewedAt: "2026-06-10T00:00:00Z" };
    expect(sectionStatus(section, filled, reviewed, 12, NOW)).toBe("complete");
  });

  it("a save also resets the staleness clock", () => {
    const reSaved = {
      lastReviewedAt: "2025-01-01T00:00:00Z",
      lastSavedAt: "2026-06-10T00:00:00Z",
    };
    expect(sectionStatus(section, filled, reSaved, 12, NOW)).toBe("complete");
  });

  it("filled data without any save/review timestamp surfaces as stale-complete", () => {
    expect(sectionStatus(section, filled, undefined, 12, NOW)).toBe("stale-complete");
  });
});

describe("readinessSummary", () => {
  const first = makeSection("a", ["x"], 1);
  const second = makeSection("b", ["y"], 2);

  it("counts complete, stale-complete, and N/A sections as ready", () => {
    const summary = readinessSummary(
      [first, second],
      { a: makeValues("a", [{ x: "filled" }]) },
      { a: { lastSavedAt: "2024-01-01T00:00:00Z" }, b: { na: true } }, // a is stale
      12,
      NOW,
    );
    expect(summary.percent).toBe(100);
    expect(summary.readySections).toBe(2);
    expect(summary.firstIncomplete).toBeNull();
  });

  it("reports the first incomplete section in pack order for the welcome CTA", () => {
    const summary = readinessSummary([second, first], {}, {}, 12, NOW);
    expect(summary.percent).toBe(0);
    expect(summary.firstIncomplete?.sectionKey).toBe("a");
  });

  it("rounds the percentage", () => {
    const third = makeSection("c", ["z"], 3);
    const summary = readinessSummary(
      [first, second, third],
      { a: makeValues("a", [{ x: "filled" }]) },
      { a: { lastSavedAt: "2026-06-01T00:00:00Z" } },
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
