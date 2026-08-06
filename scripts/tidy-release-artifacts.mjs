import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = resolve(repository, "apps/desktop/src-tauri/target/release/bundle");
const desktop = JSON.parse(
  readFileSync(resolve(repository, "apps/desktop/package.json"), "utf-8"),
);
const tauri = JSON.parse(
  readFileSync(resolve(repository, "apps/desktop/src-tauri/tauri.conf.json"), "utf-8"),
);

if (!bundle.startsWith(`${repository}${sep}`) || basename(bundle) !== "bundle") {
  throw new Error("Refusing to tidy outside the release bundle directory.");
}

// Tauri's bundlers can leave helper files alongside the installer itself —
// e.g. the macOS dmg target drops `bundle_dmg.sh` and a copy of `icon.icns`
// next to the .dmg. release-check.mjs's "exactly one artifact" contract
// treats those as failures, so remove anything that isn't the expected
// installer before that check runs.
const isMac = process.platform === "darwin";
const targetDir = isMac ? "dmg" : "nsis";
const expected = isMac
  ? `${tauri.productName}_${desktop.version}_aarch64.dmg`
  : `${tauri.productName}_${desktop.version}_x64-setup.exe`;

const targetPath = resolve(bundle, targetDir);
if (!targetPath.startsWith(`${bundle}${sep}`) || basename(dirname(targetPath)) !== "bundle") {
  throw new Error("Refusing to tidy outside the release bundle directory.");
}

const removed = [];
if (existsSync(targetPath)) {
  for (const name of readdirSync(targetPath)) {
    if (name === expected) continue;
    const entryPath = resolve(targetPath, name);
    rmSync(entryPath, { recursive: statSync(entryPath).isDirectory(), force: true });
    removed.push(name);
  }
}

console.log(
  removed.length > 0
    ? `Tidied non-installer artifacts from ${targetDir}/ (${removed.join(", ")}).`
    : `No stray artifacts found in ${targetDir}/.`,
);
