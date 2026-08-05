import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import type { FormPack } from "../src/domain/formModel";
import { deriveAutoMigration } from "../src/creator/packAutoMigrate";
import { validatePack } from "../src/domain/packValidation";

const serializePack = (pack: FormPack) => `${JSON.stringify(pack, null, 2)}\n`;
const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const PACK_PATH = resolvePath("../src-tauri/resources/packs/default-pack.json");
const BACKUP_DIR = resolvePath("../scripts/pack-backups");

function backupCurrentPack(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = join(BACKUP_DIR, stamp);
  mkdirSync(directory, { recursive: true });
  copyFileSync(PACK_PATH, join(directory, basename(PACK_PATH)));
  return directory;
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

function readCurrentPack(): FormPack {
  const validation = validatePack(JSON.parse(readFileSync(PACK_PATH, "utf-8")));
  if (!validation.ok) throw new Error(`The current pack is invalid: ${validation.errors.join("; ")}`);
  return validation.pack;
}

function writePackAtomically(pack: FormPack) {
  const temporary = `${PACK_PATH}.tmp-${crypto.randomUUID()}`;
  try {
    writeFileSync(temporary, serializePack(pack), { flag: "wx" });
    renameSync(temporary, PACK_PATH);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* absent is fine */ }
    throw error;
  }
}

interface SaveRequest {
  pack: FormPack;
  previousPack: FormPack;
}

export function packEditorSavePlugin(): Plugin {
  return {
    name: "pack-editor-save",
    configureServer(server) {
      server.middlewares.use("/__pack", (request: IncomingMessage, response: ServerResponse, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (request.method === "POST" && url.pathname === "/backup") {
          try {
            sendJson(response, 200, { ok: true, dir: backupCurrentPack() });
          } catch (error) {
            sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
          }
          return;
        }
        if (request.method === "GET") {
          try {
            sendJson(response, 200, { pack: readCurrentPack() });
          } catch (error) {
            sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
          }
          return;
        }
        if (request.method !== "POST") {
          next();
          return;
        }

        let body = "";
        request.on("data", (chunk: Buffer) => { body += chunk.toString("utf-8"); });
        request.on("end", () => {
          try {
            const posted = JSON.parse(body) as SaveRequest;
            const current = readCurrentPack();
            if (JSON.stringify(posted.previousPack) !== JSON.stringify(current)) {
              sendJson(response, 409, { error: "The pack changed on disk. Reload before saving." });
              return;
            }
            const derived = deriveAutoMigration(current, posted.pack);
            if (!derived.ok) {
              sendJson(response, 400, { error: derived.error });
              return;
            }
            const backupDir = backupCurrentPack();
            writePackAtomically(derived.pack);
            sendJson(response, 200, { ok: true, pack: derived.pack, backupDir });
          } catch (error) {
            sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
          }
        });
      });
    },
  };
}
