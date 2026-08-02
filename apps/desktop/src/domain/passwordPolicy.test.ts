import { describe, expect, it } from "vitest";
import { masterPasswordLengthError } from "./passwordPolicy";

describe("masterPasswordLengthError", () => {
  it("counts user-visible Unicode characters consistently with the Rust backend", () => {
    expect(masterPasswordLengthError("🔐".repeat(15))).toBeNull();
    expect(masterPasswordLengthError("🔐".repeat(14))).toContain("at least 15 characters");
  });
});
