import { describe, expect, it } from "vitest";
import { compareSemver, isValidSemver } from "./semver";

describe("semantic versions", () => {
  it("validates the release versions the app accepts", () => {
    expect(isValidSemver("1.0.0")).toBe(true);
    expect(isValidSemver("2.1.0-beta.2+build.7")).toBe(true);
    expect(isValidSemver("1.0")).toBe(false);
    expect(isValidSemver("1.01.0")).toBe(false);
    expect(isValidSemver("banana")).toBe(false);
  });

  it("compares core and prerelease versions using SemVer precedence", () => {
    expect(compareSemver("1.10.0", "1.2.0")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0", "1.0.0-beta.2")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0-beta.11", "1.0.0-beta.2")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0+one", "1.0.0+two")).toBe(0);
  });
});
