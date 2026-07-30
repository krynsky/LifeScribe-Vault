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

  it("loads the single base pack by default", async () => {
    const pack = await loadDefaultPack();
    expect(mockedRead).toHaveBeenCalledWith();
    expect(pack.packId).toBe("lifescribe-default");
  });

  it("ignores the (now-vestigial) mode argument and still returns the base pack", async () => {
    const pack = await loadDefaultPack("credential");
    expect(mockedRead).toHaveBeenCalledWith();
    expect(pack.packId).toBe("lifescribe-default");
  });
});
