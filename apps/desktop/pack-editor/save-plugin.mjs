/**
 * Vite dev-server plugin backing the pack editor. Dev-only.
 *   GET  /__pack  -> { hintPack, overlay } read from disk
 *   POST /__pack  -> writes credential-overlay.json + regenerated pack;
 *                    body is the edited credential FormPack (JSON)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderSaveArtifacts } from "../scripts/lib/save-artifacts.mjs";

const resolvePath = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const HINT_PATH = resolvePath("../src-tauri/resources/packs/default-pack.json");
const OVERLAY_PATH = resolvePath("../scripts/credential-overlay.json");
const PACK_PATH = resolvePath(
  "../src-tauri/resources/packs/default-pack-credential.json",
);

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
        if (req.method === "GET") {
          try {
            const hintPack = JSON.parse(readFileSync(HINT_PATH, "utf-8"));
            const overlay = JSON.parse(readFileSync(OVERLAY_PATH, "utf-8"));
            sendJson(res, 200, { hintPack, overlay });
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
              const hintPack = JSON.parse(readFileSync(HINT_PATH, "utf-8"));
              const { overlayJson, packJson } = renderSaveArtifacts(
                hintPack,
                editedPack,
              );
              writeFileSync(OVERLAY_PATH, overlayJson);
              writeFileSync(PACK_PATH, packJson);
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
