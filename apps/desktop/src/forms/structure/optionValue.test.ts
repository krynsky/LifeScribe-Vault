import { describe, expect, it } from "vitest";
import { slugifyOptionValue, uniqueOptionValue } from "./optionValue";

describe("slugifyOptionValue", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugifyOptionValue("Checking Account")).toBe("checking-account");
  });

  it("strips special characters and collapses separator runs", () => {
    expect(slugifyOptionValue("Joint (Savings) — #1")).toBe("joint-savings-1");
  });

  it("trims leading and trailing separators", () => {
    expect(slugifyOptionValue("  Primary!  ")).toBe("primary");
  });

  it("folds accented characters to ASCII", () => {
    expect(slugifyOptionValue("Crédit Agricole")).toBe("credit-agricole");
  });

  it("falls back to 'option' when nothing usable remains", () => {
    expect(slugifyOptionValue("!!!")).toBe("option");
    expect(slugifyOptionValue("   ")).toBe("option");
  });
});

describe("uniqueOptionValue", () => {
  it("returns the plain slug when it is not already taken", () => {
    expect(uniqueOptionValue("Checking Account", [])).toBe("checking-account");
  });

  it("suffixes -2 when the slug collides with an existing value", () => {
    expect(uniqueOptionValue("Checking Account", ["checking-account"])).toBe("checking-account-2");
  });

  it("skips to the next free suffix when earlier ones are taken", () => {
    expect(
      uniqueOptionValue("Checking Account", ["checking-account", "checking-account-2"]),
    ).toBe("checking-account-3");
  });

  it("deduplicates labels that slugify identically (different casing/punctuation)", () => {
    // "Checking account" and "Checking Account!" both slugify to the same base.
    expect(uniqueOptionValue("Checking Account!", ["checking-account"])).toBe("checking-account-2");
  });

  it("deduplicates the all-special-character fallback", () => {
    expect(uniqueOptionValue("???", ["option"])).toBe("option-2");
  });
});
