import type { FormPack } from "../src/domain/formModel";

export type PackName = "credential" | "hint";

export interface PackPayload {
  hintPack: FormPack;
  /** Present for credential mode; absent for hint mode. */
  overlay?: unknown;
}

export async function getPack(packName: PackName = "credential"): Promise<PackPayload> {
  const url = packName === "hint" ? "/__pack?pack=hint" : "/__pack";
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Could not load the pack (${res.status}).`);
  }
  return res.json();
}

export async function savePack(editedPack: FormPack, packName: PackName = "credential"): Promise<void> {
  const url = packName === "hint" ? "/__pack?pack=hint" : "/__pack";
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(editedPack),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Save failed (${res.status}).`);
  }
}
