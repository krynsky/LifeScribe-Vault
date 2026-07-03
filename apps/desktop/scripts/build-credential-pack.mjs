#!/usr/bin/env node
/**
 * CLI: regenerate resources/packs/default-pack-credential.json from the hint
 * pack + credential-overlay.json. Dev/admin only.
 *
 *   npm --prefix apps/desktop run build:credential-pack
 *
 * Edit credential-overlay.json (not the generated JSON), re-run this, commit.
 * The drift-guard test fails if the committed pack and this output disagree.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildCredentialPack, serializePack } from "./lib/credential-pack.mjs";

const resolve = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const HINT_PATH = resolve("../src-tauri/resources/packs/default-pack.json");
const OVERLAY_PATH = resolve("./credential-overlay.json");
const OUT_PATH = resolve("../src-tauri/resources/packs/default-pack-credential.json");

const hintPack = JSON.parse(readFileSync(HINT_PATH, "utf-8"));
const overlay = JSON.parse(readFileSync(OVERLAY_PATH, "utf-8"));

const output = serializePack(buildCredentialPack(hintPack, overlay));
writeFileSync(OUT_PATH, output);
console.log(`Wrote ${OUT_PATH}`);
