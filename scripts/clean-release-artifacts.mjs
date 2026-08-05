import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
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

const msi = resolve(bundle, "msi");
if (existsSync(msi)) rmSync(msi, { recursive: true, force: true });
const nsis = resolve(bundle, "nsis");
if (existsSync(nsis)) {
  for (const name of readdirSync(nsis)) {
    if (!name.includes(`_${version}_`)) rmSync(resolve(nsis, name), { force: true });
  }
}
console.log(`Release artifacts cleaned for NSIS ${version}.`);
