import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/vaultApi", () => ({
  readDefaultPack: vi.fn().mockRejectedValue(new Error("invoke unavailable")),
}));

import { readDefaultPack } from "../api/vaultApi";
import { loadDefaultPack } from "./loadDefaultPack";

const mockedRead = vi.mocked(readDefaultPack);

describe("loadDefaultPack", () => {
  beforeEach(() => {
    mockedRead.mockClear();
    mockedRead.mockRejectedValue(new Error("invoke unavailable"));
  });

  it("requests the hint variant by default and returns the hint pack", async () => {
    const pack = await loadDefaultPack();
    expect(mockedRead).toHaveBeenCalledWith("hint");
    expect(pack.packId).toBe("lifescribe-default");
  });

  it("requests the credential variant and returns the credential pack", async () => {
    const pack = await loadDefaultPack("credential");
    expect(mockedRead).toHaveBeenCalledWith("credential");
    expect(pack.packId).toBe("lifescribe-default-credential");
  });
});
