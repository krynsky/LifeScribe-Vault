import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import hintPack from "../../src-tauri/resources/packs/default-pack.json";
import overlay from "../../scripts/credential-overlay.json";
import { buildCredentialPack } from "../../scripts/lib/credential-pack.mjs";
import { renderSaveArtifacts } from "../../scripts/lib/save-artifacts.mjs";

const hint = hintPack as unknown as Record<string, unknown>;

describe("renderSaveArtifacts", () => {
  it("reproduces the committed overlay and pack for an unedited pack", () => {
    const pack = buildCredentialPack(hint, overlay);
    const { overlayJson, packJson } = renderSaveArtifacts(hint, pack);

    const committedOverlay = readFileSync(
      resolve(process.cwd(), "scripts/credential-overlay.json"),
      "utf-8",
    );
    const committedPack = readFileSync(
      resolve(process.cwd(), "src-tauri/resources/packs/default-pack-credential.json"),
      "utf-8",
    );
    expect(overlayJson).toBe(committedOverlay);
    expect(packJson).toBe(committedPack);
  });

  it("ends both artifacts with a trailing newline", () => {
    const pack = buildCredentialPack(hint, overlay);
    const { overlayJson, packJson } = renderSaveArtifacts(hint, pack);
    expect(overlayJson.endsWith("\n")).toBe(true);
    expect(packJson.endsWith("\n")).toBe(true);
  });
});
