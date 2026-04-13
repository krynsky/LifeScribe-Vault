import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface ApiErrorShape {
  status: number;
  message: string;
  detail?: string;
}

export class ApiError extends Error implements ApiErrorShape {
  status: number;
  detail?: string;
  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export class SidecarDownError extends Error {
  constructor() {
    super("Sidecar not responding");
  }
}

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

async function request<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  let b: BackendReady;
  try {
    b = await getBackend();
  } catch {
    throw new SidecarDownError();
  }
  let res: Response;
  try {
    res = await fetch(`http://${b.host}:${b.port}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${b.token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new SidecarDownError();
  }
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const j = (await res.json()) as { detail?: string };
      detail = j.detail;
    } catch {
      detail = await res.text();
    }
    throw new ApiError(res.status, `${method} ${path} → ${res.status}`, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface VaultManifestDTO {
  id: string;
  type: string;
  schema_version: number;
  app_version: string;
  created_at: string;
  vault_path?: string;
  [k: string]: unknown;
}

export interface VaultStatusDTO {
  open: boolean;
  manifest: VaultManifestDTO | null;
}

export interface NoteEnvelope {
  note: Record<string, unknown> & { id: string; type: string };
  body: string;
}

export interface VaultSettingsDTO {
  id: string;
  type: "VaultSettings";
  schema_version?: number;
  privacy_mode: boolean;
  [k: string]: unknown;
}

export interface JobDTO {
  job_id: string;
  status: "queued" | "running" | "completed" | "completed_with_failures" | "cancelled" | "failed";
  total: number;
  succeeded?: number;
  failed?: number;
  skipped?: number;
  cancelled?: number;
  files?: unknown[];
  started_at?: string;
  finished_at?: string | null;
}

export const api = {
  status: () => request<VaultStatusDTO>("GET", "/vault/status"),
  init: (path: string) => request<VaultStatusDTO>("POST", "/vault/init", { path }),
  open: (path: string) => request<VaultStatusDTO>("POST", "/vault/open", { path }),

  notes: (type: string) =>
    request<Array<Record<string, unknown> & { id: string; type: string }>>(
      "GET",
      `/vault/notes?type=${encodeURIComponent(type)}`,
    ),
  note: (id: string) => request<NoteEnvelope>("GET", `/vault/notes/${encodeURIComponent(id)}`),

  settings: () => request<VaultSettingsDTO>("GET", "/vault/settings"),
  saveSettings: (payload: { privacy_mode: boolean }) =>
    request<VaultSettingsDTO>("PUT", "/vault/settings", payload),

  ingest: {
    create: (files: string[]) => request<JobDTO>("POST", "/ingest/jobs", { files }),
    get: (id: string) => request<JobDTO>("GET", `/ingest/jobs/${encodeURIComponent(id)}`),
    cancel: (id: string) =>
      request<{ status: string }>("DELETE", `/ingest/jobs/${encodeURIComponent(id)}`),
  },
};

export function __resetClientCacheForTests(): void {
  cached = null;
}
