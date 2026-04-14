import { useMutation, useQuery, useQueryClient, UseQueryOptions } from "@tanstack/react-query";

import {
  api,
  ChatSessionDTO,
  ChatSessionSummary,
  IndexStatusDTO,
  JobDTO,
  LLMProviderDTO,
  ModelInfoDTO,
  NoteEnvelope,
  ReindexResultDTO,
  VaultSettingsDTO,
} from "./client";

const TERMINAL: ReadonlyArray<JobDTO["status"]> = [
  "completed",
  "completed_with_failures",
  "cancelled",
  "failed",
];

export function useNotes(
  type: string,
  opts?: Omit<
    UseQueryOptions<Array<Record<string, unknown> & { id: string; type: string }>>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["notes", type],
    queryFn: () => api.notes(type),
    ...opts,
  });
}

export function useNote(id: string | undefined) {
  return useQuery<NoteEnvelope>({
    queryKey: ["note", id],
    queryFn: () => api.note(id as string),
    enabled: !!id,
  });
}

export function useJob(id: string | undefined) {
  return useQuery<JobDTO>({
    queryKey: ["job", id],
    queryFn: () => api.ingest.get(id as string),
    enabled: !!id,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return 500;
      return TERMINAL.includes(data.status) ? false : 500;
    },
  });
}

export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (files: string[]) => api.ingest.create(files),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes", "SourceRecord"] });
      qc.invalidateQueries({ queryKey: ["notes", "IngestJobLog"] });
    },
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.ingest.cancel(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["job", id] });
    },
  });
}

export function useSettings() {
  return useQuery<VaultSettingsDTO>({
    queryKey: ["settings"],
    queryFn: () => api.settings(),
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { privacy_mode: boolean }) => api.saveSettings(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
}

export function useLLMProviders() {
  return useQuery<LLMProviderDTO[]>({
    queryKey: ["llm", "providers"],
    queryFn: () => api.llm.listProviders(),
  });
}

export function useLLMProvider(id: string | undefined) {
  return useQuery<LLMProviderDTO>({
    queryKey: ["llm", "provider", id],
    queryFn: () => api.llm.getProvider(id as string),
    enabled: !!id,
  });
}

export function useCreateLLMProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<LLMProviderDTO>) => api.llm.createProvider(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["llm", "providers"] }),
  });
}

export function useUpdateLLMProvider(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<LLMProviderDTO>) => api.llm.updateProvider(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["llm", "providers"] });
      qc.invalidateQueries({ queryKey: ["llm", "provider", id] });
      qc.invalidateQueries({ queryKey: ["llm", "models", id] });
    },
  });
}

export function useDeleteLLMProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.llm.deleteProvider(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["llm", "providers"] }),
  });
}

export function useSetLLMCredential(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: string) => api.llm.setCredential(id, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["llm", "provider", id] });
      qc.invalidateQueries({ queryKey: ["llm", "models", id] });
    },
  });
}

export function useDeleteLLMCredential(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.llm.deleteCredential(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["llm", "provider", id] });
      qc.invalidateQueries({ queryKey: ["llm", "models", id] });
    },
  });
}

export function useLLMModels(id: string | undefined) {
  return useQuery<ModelInfoDTO[]>({
    queryKey: ["llm", "models", id],
    queryFn: () => api.llm.listModels(id as string),
    enabled: !!id,
  });
}

export function useChatSessions() {
  return useQuery<ChatSessionSummary[]>({
    queryKey: ["chat", "sessions"],
    queryFn: () => api.chat.listSessions(),
  });
}

export function useChatSession(id: string | undefined) {
  return useQuery<ChatSessionDTO>({
    queryKey: ["chat", "session", id],
    queryFn: () => api.chat.getSession(id as string),
    enabled: !!id,
  });
}

export function useDeleteChatSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.chat.deleteSession(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat", "sessions"] }),
  });
}

export function useReindex() {
  const qc = useQueryClient();
  return useMutation<ReindexResultDTO, Error, void>({
    mutationFn: () => api.chat.reindex(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat", "index-status"] }),
  });
}

export function useIndexStatus() {
  return useQuery<IndexStatusDTO>({
    queryKey: ["chat", "index-status"],
    queryFn: () => api.chat.indexStatus(),
  });
}
