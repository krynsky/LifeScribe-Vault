import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { VaultStatusDTO } from "@lifescribe/shared-types";

interface BackendReady {
  host: string;
  port: number;
  token: string;
}

let cached: BackendReady | null = null;

async function getBackend(): Promise<BackendReady> {
  if (cached) return cached;
  const info = await invoke<BackendReady | null>("backend_info");
  if (info) {
    cached = info;
    return info;
  }
  return await new Promise<BackendReady>((resolve) => {
    const unlistenPromise = listen<BackendReady>("backend-ready", (evt) => {
      cached = evt.payload;
      resolve(evt.payload);
      unlistenPromise.then((u) => u());
    });
  });
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const b = await getBackend();
  const res = await fetch(`http://${b.host}:${b.port}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${b.token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export const api = {
  status: () => request<VaultStatusDTO>("GET", "/vault/status"),
  init: (path: string) => request<VaultStatusDTO>("POST", "/vault/init", { path }),
  open: (path: string) => request<VaultStatusDTO>("POST", "/vault/open", { path }),
};
