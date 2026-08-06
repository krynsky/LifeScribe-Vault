import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = resolve(repository, "apps/desktop/src-tauri/target/release/bundle");
const version = JSON.parse(
  readFileSync(resolve(repository, "apps/desktop/package.json"), "utf-8"),
).version;

if (!bundle.startsWith(`${repository}${sep}`) || basename(bundle) !== "bundle") {
  throw new Error("Refusing to clean outside the release bundle directory.");
}

const removed = [];
const msi = resolve(bundle, "msi");
if (existsSync(msi)) {
  rmSync(msi, { recursive: true, force: true });
  removed.push("msi");
}
const nsis = resolve(bundle, "nsis");
if (existsSync(nsis)) {
  rmSync(nsis, { recursive: true, force: true });
  removed.push("nsis");
}
const dmg = resolve(bundle, "dmg");
if (existsSync(dmg)) {
  rmSync(dmg, { recursive: true, force: true });
  removed.push("dmg");
}

console.log(
  removed.length > 0
    ? `Release artifacts cleaned (${removed.join(", ")}) for ${version}.`
    : `No stale release artifacts found for ${version}.`,
);
