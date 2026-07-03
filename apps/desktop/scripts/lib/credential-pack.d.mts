// Type surface for the pure credential-pack transform (see credential-pack.mjs).
// Kept intentionally loose: callers treat packs as opaque JSON.
export function buildCredentialPack(hintPack: unknown, overlay: unknown): unknown;
export function serializePack(pack: unknown): string;
