import type { FormPack } from "../src/domain/formModel";

export interface PackPayload {
  pack: FormPack;
}

export async function getPack(): Promise<PackPayload> {
  const res = await fetch("/__pack");
  if (!res.ok) {
    throw new Error(`Could not load the pack (${res.status}).`);
  }
  return res.json();
}

/**
 * Copy the three pack source files (hint pack, credential pack, overlay)
 * into a timestamped folder under scripts/pack-backups/. Returns the folder.
 * The credential pack and overlay are frozen legacy artifacts — no longer
 * regenerated on save (a later plan retires them) — but backup still copies
 * them for continuity.
 */
export async function backupPacks(): Promise<string> {
  const res = await fetch("/__pack/backup", { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as { dir?: string; error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `Backup failed (${res.status}).`);
  }
  return body.dir ?? "";
}

export async function savePack(base: FormPack, previousPack: FormPack): Promise<FormPack | undefined> {
  const res = await fetch("/__pack", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pack: base, previousPack }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Save failed (${res.status}).`);
  }
  const body = (await res.json()) as { pack: FormPack };
  return body.pack;
}
