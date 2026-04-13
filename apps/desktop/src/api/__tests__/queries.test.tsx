import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { useNote, useNotes, useSettings } from "../queries";
import { BASE, server } from "../../test/mswServer";
import { makeQueryClient } from "../../test/renderWithProviders";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";

function wrapper(client = makeQueryClient()) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("queries", () => {
  it("useNotes loads and caches", async () => {
    server.use(
      http.get(`${BASE}/vault/notes`, () =>
        HttpResponse.json([{ id: "src_1", type: "SourceRecord" }]),
      ),
    );
    const { result } = renderHook(() => useNotes("SourceRecord"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "src_1", type: "SourceRecord" }]);
  });

  it("useNote loads envelope", async () => {
    server.use(
      http.get(`${BASE}/vault/notes/src_1`, () =>
        HttpResponse.json({ note: { id: "src_1", type: "SourceRecord" }, body: "# hi" }),
      ),
    );
    const { result } = renderHook(() => useNote("src_1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.body).toBe("# hi");
  });

  it("useSettings returns defaults", async () => {
    server.use(
      http.get(`${BASE}/vault/settings`, () =>
        HttpResponse.json({ id: "settings_default", type: "VaultSettings", privacy_mode: false }),
      ),
    );
    const { result } = renderHook(() => useSettings(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.privacy_mode).toBe(false);
  });
});
