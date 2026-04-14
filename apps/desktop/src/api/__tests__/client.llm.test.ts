import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { api } from "../client";
import { BASE, server } from "../../test/mswServer";

describe("api.llm", () => {
  it("lists providers", async () => {
    server.use(
      http.get(`${BASE}/llm/providers`, ({ request }) => {
        expect(request.headers.get("Authorization")).toBe("Bearer testtoken");
        return HttpResponse.json([
          {
            id: "llm_a",
            type: "LLMProvider",
            display_name: "A",
            base_url: "http://127.0.0.1:1234/v1",
            local: true,
            secret_ref: null,
            default_model: null,
            enabled: true,
            has_credential: false,
            schema_version: 1,
          },
        ]);
      }),
    );
    const out = await api.llm.listProviders();
    expect(out[0].id).toBe("llm_a");
  });

  it("sends credential PUT with JSON body", async () => {
    let capturedBody: unknown = null;
    server.use(
      http.put(`${BASE}/llm/providers/llm_a/credential`, async ({ request }) => {
        capturedBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await api.llm.setCredential("llm_a", "pat");
    expect(capturedBody).toEqual({ value: "pat" });
  });

  it("chat returns parsed JSON", async () => {
    server.use(
      http.post(`${BASE}/llm/chat`, () =>
        HttpResponse.json({ content: "hi", finish_reason: "stop" }),
      ),
    );
    const r = await api.llm.chat({
      provider_id: "llm_a",
      model: "m",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r).toEqual({ content: "hi", finish_reason: "stop" });
  });
});
