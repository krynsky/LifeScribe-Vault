import type { FormPack } from "../src/domain/formModel";

export interface PackPayload {
  hintPack: FormPack;
  overlay: unknown;
}

export async function getPack(): Promise<PackPayload> {
  const res = await fetch("/__pack");
  if (!res.ok) {
    throw new Error(`Could not load the pack (${res.status}).`);
  }
  return res.json();
}

export async function savePack(editedPack: FormPack): Promise<void> {
  const res = await fetch("/__pack", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(editedPack),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Save failed (${res.status}).`);
  }
}
