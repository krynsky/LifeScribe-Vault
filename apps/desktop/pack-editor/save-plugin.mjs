/**
 * Vite dev-server plugin backing the pack editor. Dev-only.
 *   GET  /__pack        -> { pack } (the base pack) read from disk
 *   POST /__pack        -> writes the edited base FormPack (with its modules)
 *                          straight to default-pack.json
 *   POST /__pack/backup -> copies the three source files (hint pack,
 *                          credential pack, overlay) into a timestamped
 *                          folder under scripts/pack-backups/
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serializePack } from "../scripts/lib/credential-pack.mjs";

const resolvePath = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const HINT_PATH = resolvePath("../src-tauri/resources/packs/default-pack.json");
const OVERLAY_PATH = resolvePath("../scripts/credential-overlay.json");
const PACK_PATH = resolvePath(
  "../src-tauri/resources/packs/default-pack-credential.json",
);
const BACKUP_DIR = resolvePath("../scripts/pack-backups");

/** Copy the three pack source files into pack-backups/<timestamp>/. */
function backupPackFiles() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(BACKUP_DIR, stamp);
  mkdirSync(dir, { recursive: true });
  for (const source of [HINT_PATH, OVERLAY_PATH, PACK_PATH]) {
    copyFileSync(source, join(dir, basename(source)));
  }
  return dir;
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

export function packEditorSavePlugin() {
  return {
    name: "pack-editor-save",
    configureServer(server) {
      server.middlewares.use("/__pack", (req, res, next) => {
        const url = new URL(req.url, "http://localhost");

        if (req.method === "POST" && url.pathname === "/backup") {
          try {
            const dir = backupPackFiles();
            sendJson(res, 200, { ok: true, dir });
          } catch (error) {
            sendJson(res, 500, { error: String(error?.message ?? error) });
          }
          return;
        }

        if (req.method === "GET") {
          try {
            const pack = JSON.parse(readFileSync(HINT_PATH, "utf-8"));
            sendJson(res, 200, { pack });
          } catch (error) {
            sendJson(res, 500, { error: String(error?.message ?? error) });
          }
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => {
            body += chunk;
          });
          req.on("end", () => {
            try {
              const editedPack = JSON.parse(body);
              // Write the edited base pack (with its modules) straight to disk.
              writeFileSync(HINT_PATH, serializePack(editedPack));
              sendJson(res, 200, { ok: true });
            } catch (error) {
              sendJson(res, 400, { error: String(error?.message ?? error) });
            }
          });
          return;
        }
        next();
      });
    },
  };
}
