/**
 * Pure: hint pack + edited credential pack -> the exact file contents to write
 * for a save (overlay JSON + regenerated pack JSON). DEV/ADMIN TOOLING.
 */
import { buildCredentialPack, serializePack } from "./credential-pack.mjs";
import { deriveOverlay } from "./derive-overlay.mjs";

/**
 * Serialize the overlay to match the hand-authored credential-overlay.json:
 * 2-space indent, trailing LF, but arrays whose elements are all primitives
 * (e.g. kitAdditions' systemKey lists) stay collapsed onto a single line.
 */
function serializeOverlay(overlay) {
  const json = JSON.stringify(
    overlay,
    (_key, value) => {
      if (
        Array.isArray(value) &&
        value.every((item) => item === null || typeof item !== "object")
      ) {
        // Marker-wrap so we can restore a compact single-line form afterwards.
        return { __inlineArray: JSON.stringify(value) };
      }
      return value;
    },
    2,
  );
  const restored = json.replace(
    /\{\s*"__inlineArray": ("(?:[^"\\]|\\.)*")\s*\}/g,
    (_match, encoded) => JSON.parse(encoded),
  );
  return `${restored}\n`;
}

export function renderSaveArtifacts(hintPack, editedPack) {
  const overlay = deriveOverlay(hintPack, editedPack);
  const overlayJson = serializeOverlay(overlay);
  const packJson = serializePack(buildCredentialPack(hintPack, overlay));
  return { overlayJson, packJson };
}
