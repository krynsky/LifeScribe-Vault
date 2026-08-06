import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest runs with cwd = apps/desktop
const configPath = resolve(process.cwd(), "src-tauri/tauri.conf.json");
const capabilityPath = resolve(process.cwd(), "src-tauri/capabilities/default.json");

const config = JSON.parse(readFileSync(configPath, "utf-8"));
const capability = JSON.parse(readFileSync(capabilityPath, "utf-8"));

describe("tauri window configuration", () => {
  it("opens at 1440x1000 with minimum 1220x760, centered and resizable", () => {
    const window = config.app.windows[0];
    expect(window.width).toBe(1440);
    expect(window.height).toBe(1000);
    expect(window.minWidth).toBe(1220);
    expect(window.minHeight).toBe(760);
    expect(window.center).toBe(true);
    expect(window.resizable).toBe(true);
  });

  it("uses an app identifier distinct from v1 so app data can't collide", () => {
    // Identifier, not productName, is what keys app-data isolation (Tauri's
    // app_data_dir) — the display name is free to read "LifeScribe Vault"
    // even though the identifier stays versioned.
    expect(config.identifier).not.toBe("com.lifescribe.vault");
    expect(config.identifier).toMatch(/^com\.lifescribe\./);
    expect(config.productName).toBe("LifeScribe Vault");
  });
});

describe("tauri security configuration", () => {
  it("ships a strict non-null CSP with no remote origins or unsafe-eval", () => {
    const csp: string = config.app.security.csp;
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/https?:\/\/(?!ipc\.localhost)/);
  });

  it("grants only the minimal capability set — no shell, no frontend fs scope", () => {
    const permissions: string[] = capability.permissions;
    expect(permissions).toContain("core:default");
    for (const permission of permissions) {
      expect(permission).not.toMatch(/^shell:/);
      expect(permission).not.toMatch(/^fs:/);
    }
  });
});
