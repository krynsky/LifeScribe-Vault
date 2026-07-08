/**
 * Vite dev-server plugin backing the pack editor. Dev-only.
 *   GET  /__pack        -> { hintPack, overlay } read from disk
 *   POST /__pack        -> writes credential-overlay.json + regenerated pack;
 *                          body is the edited credential FormPack (JSON)
 *   POST /__pack/backup -> copies the three source files (hint pack,
 *                          credential pack, overlay) into a timestamped
 *                          folder under scripts/pack-backups/
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCredentialPack, serializePack } from "../scripts/lib/credential-pack.mjs";
import { renderSaveArtifacts } from "../scripts/lib/save-artifacts.mjs";

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
        const packParam = url.searchParams.get("pack");
        const hintMode = packParam === "hint";

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
            const hintPack = JSON.parse(readFileSync(HINT_PATH, "utf-8"));
            if (hintMode) {
              sendJson(res, 200, { hintPack });
            } else {
              const overlay = JSON.parse(readFileSync(OVERLAY_PATH, "utf-8"));
              sendJson(res, 200, { hintPack, overlay });
            }
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
              if (hintMode) {
                // Write the edited hint pack directly, then regenerate credential pack
                // from updated hint + the existing overlay (overlay stays unchanged).
                const overlay = JSON.parse(readFileSync(OVERLAY_PATH, "utf-8"));
                writeFileSync(HINT_PATH, serializePack(editedPack));
                writeFileSync(PACK_PATH, serializePack(buildCredentialPack(editedPack, overlay)));
                sendJson(res, 200, { ok: true });
              } else {
                const hintPack = JSON.parse(readFileSync(HINT_PATH, "utf-8"));
                const { overlayJson, packJson } = renderSaveArtifacts(hintPack, editedPack);
                writeFileSync(OVERLAY_PATH, overlayJson);
                writeFileSync(PACK_PATH, packJson);
                sendJson(res, 200, { ok: true });
              }
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
