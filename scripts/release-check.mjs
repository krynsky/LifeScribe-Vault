import { existsSync, readFileSync, readdirSync } from "node:fs";
const root = new URL("../", import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), "utf-8"));
const desktop = readJson("apps/desktop/package.json");
const tauri = readJson("apps/desktop/src-tauri/tauri.conf.json");
const lock = readJson("package-lock.json");
const cargo = readFileSync(new URL("apps/desktop/src-tauri/Cargo.toml", root), "utf-8");
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const versions = [desktop.version, tauri.version, cargoVersion, lock.packages?.["apps/desktop"]?.version];

const failures = [];
if (new Set(versions).size !== 1 || versions.some((value) => !value)) {
  failures.push(`Version mismatch: package, Tauri, Cargo, lock = ${versions.join(", ")}`);
}
if (tauri.identifier !== "com.lifescribe.vault.v2") {
  failures.push(`Frozen app identifier changed: ${tauri.identifier}`);
}
if (JSON.stringify(tauri.bundle?.targets) !== JSON.stringify(["nsis"])) {
  failures.push("The public release channel must remain the single tested NSIS target.");
}
if (existsSync(new URL("apps/desktop/package-lock.json", root))) {
  failures.push("Obsolete nested package-lock.json exists; use the workspace root lockfile only.");
}

const bundle = new URL("apps/desktop/src-tauri/target/release/bundle/nsis", root);
const prebuild = process.argv.includes("--prebuild");
if (!prebuild) {
  const expected = `LifeScribe Vault 2_${desktop.version}_x64-setup.exe`;
  if (!existsSync(bundle)) {
    failures.push("NSIS output directory is missing; run the release build first.");
  } else {
    const artifacts = readdirSync(bundle);
    if (!artifacts.includes(expected)) failures.push(`Expected installer is missing: ${expected}`);
    const unexpected = artifacts.filter((name) => name !== expected);
    if (unexpected.length > 0) failures.push(`Unexpected NSIS artifacts: ${unexpected.join(", ")}`);
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log(
  `Release ${prebuild ? "manifest" : "artifact"} contract OK: LifeScribe Vault ${desktop.version}, NSIS, ${tauri.identifier}`,
);
