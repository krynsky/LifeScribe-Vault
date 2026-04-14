import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

export const BASE = "http://127.0.0.1:9999";

export const server = setupServer(
  http.get(`${BASE}/vault/status`, () =>
    HttpResponse.json({ open: true, manifest: { id: "vault_x", type: "VaultManifest" } }),
  ),
);
