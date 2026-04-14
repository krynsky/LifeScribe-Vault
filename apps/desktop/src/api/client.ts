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
  default_chat_provider_id?: string | null;
  default_chat_model?: string | null;
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

export interface LLMProviderDTO {
  id: string;
  type: "LLMProvider";
  display_name: string;
  base_url: string;
  local: boolean;
  secret_ref: string | null;
  default_model: string | null;
  enabled: boolean;
  has_credential: boolean;
  schema_version: number;
}

export interface ModelInfoDTO {
  id: string;
  context_length?: number | null;
}

export interface ChatMessageDTO {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequestDTO {
  provider_id: string;
  model: string;
  messages: ChatMessageDTO[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatChunkDTO {
  delta: string;
  finish_reason?: string | null;
}

export interface ChatCitationDTO {
  marker: number;
  note_id: string;
  chunk_id: string;
  score: number;
  resolved: boolean;
}

export interface ChatTurnDTO {
  role: "user" | "assistant";
  content: string;
  created_at: string;
  citations: ChatCitationDTO[];
  empty_retrieval: boolean;
}

export interface ChatSessionDTO {
  id: string;
  type: "ChatSession";
  title: string;
  provider_id: string;
  model: string;
  turns: ChatTurnDTO[];
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  provider_id: string;
  model: string;
  turn_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface RetrievalChunkDTO {
  n: number;
  note_id: string;
  chunk_id: string;
  note_type: string;
  score: number;
  snippet: string;
  tags: string[];
}

export interface IndexStatusDTO {
  last_indexed_at: string;
  note_count: number;
  chunk_count: number;
  db_size_bytes: number;
  stale_notes: number;
}

export interface ReindexResultDTO {
  indexed_notes: number;
  elapsed_ms: number;
  last_indexed_at: string;
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
  saveSettings: (payload: {
    privacy_mode: boolean;
    default_chat_provider_id?: string | null;
    default_chat_model?: string | null;
  }) => request<VaultSettingsDTO>("PUT", "/vault/settings", payload),

  ingest: {
    create: (files: string[]) => request<JobDTO>("POST", "/ingest/jobs", { files }),
    get: (id: string) => request<JobDTO>("GET", `/ingest/jobs/${encodeURIComponent(id)}`),
    cancel: (id: string) =>
      request<{ status: string }>("DELETE", `/ingest/jobs/${encodeURIComponent(id)}`),
  },

  llm: {
    listProviders: () => request<LLMProviderDTO[]>("GET", "/llm/providers"),
    getProvider: (id: string) =>
      request<LLMProviderDTO>("GET", `/llm/providers/${encodeURIComponent(id)}`),
    createProvider: (body: Partial<LLMProviderDTO>) =>
      request<LLMProviderDTO>("POST", "/llm/providers", body),
    updateProvider: (id: string, body: Partial<LLMProviderDTO>) =>
      request<LLMProviderDTO>("PUT", `/llm/providers/${encodeURIComponent(id)}`, body),
    deleteProvider: (id: string) =>
      request<void>("DELETE", `/llm/providers/${encodeURIComponent(id)}`),
    setCredential: (id: string, value: string) =>
      request<void>("PUT", `/llm/providers/${encodeURIComponent(id)}/credential`, { value }),
    deleteCredential: (id: string) =>
      request<void>("DELETE", `/llm/providers/${encodeURIComponent(id)}/credential`),
    listModels: (id: string) =>
      request<ModelInfoDTO[]>("GET", `/llm/providers/${encodeURIComponent(id)}/models`),
    chat: (req: ChatRequestDTO) =>
      request<{ content: string; finish_reason: string | null }>("POST", "/llm/chat", req),
  },

  chat: {
    listSessions: () => request<ChatSessionSummary[]>("GET", "/chat/sessions"),
    getSession: (id: string) =>
      request<ChatSessionDTO>("GET", `/chat/sessions/${encodeURIComponent(id)}`),
    deleteSession: (id: string) =>
      request<void>("DELETE", `/chat/sessions/${encodeURIComponent(id)}`),
    reindex: () => request<ReindexResultDTO>("POST", "/chat/reindex"),
    indexStatus: () => request<IndexStatusDTO>("GET", "/chat/index/status"),
  },

  retrieval: {
    search: (body: { query: string; k?: number }) =>
      request<{ chunks: RetrievalChunkDTO[]; index_last_updated_at: string }>(
        "POST",
        "/retrieval/search",
        { k: 6, ...body },
      ),
  },
};

/** Resolves to the backend base URL, waiting for the sidecar to start if needed. */
export async function backendUrl(): Promise<string> {
  const b = await getBackend();
  return `http://${b.host}:${b.port}`;
}

/** Resolves to the bearer token, waiting for the sidecar to start if needed. */
export async function backendToken(): Promise<string> {
  const b = await getBackend();
  return b.token;
}

export function __resetClientCacheForTests(): void {
  cached = null;
}

/** @internal — expose cached backend for tests */
export function __setClientCacheForTests(info: {
  host: string;
  port: number;
  token: string;
}): void {
  cached = info;
}
