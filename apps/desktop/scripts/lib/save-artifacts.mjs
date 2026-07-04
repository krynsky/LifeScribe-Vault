/**
 * Pure: hint pack + edited credential pack -> the exact file contents to write
 * for a save (overlay JSON + regenerated pack JSON). DEV/ADMIN TOOLING.
 */
import { buildCredentialPack, serializePack } from "./credential-pack.mjs";
import { deriveOverlay } from "./derive-overlay.mjs";

export function renderSaveArtifacts(hintPack, editedPack) {
  const overlay = deriveOverlay(hintPack, editedPack);
  const overlayJson = `${JSON.stringify(overlay, null, 2)}\n`;
  const packJson = serializePack(buildCredentialPack(hintPack, overlay));
  return { overlayJson, packJson };
}
