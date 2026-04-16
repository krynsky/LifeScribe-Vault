import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { api } from "../client";
import { BASE, server } from "../../test/mswServer";

const _sampleEntry = {
  service: "file_drop",
  display_name: "File Drop",
  description: "",
  category: "files",
  auth_mode: "none",
  tier: "free",
  connector_type: "file",
  supported_formats: ["txt"],
  privacy_posture: "local_only" as const,
  export_instructions: "",
  sample_file_urls: [],
  manifest_schema_version: 1,
  blocked: false,
};

describe("api.connectors", () => {
  it("lists entries + warnings", async () => {
    server.use(
      http.get(`${BASE}/connectors`, ({ request }) => {
        expect(request.headers.get("Authorization")).toBe("Bearer testtoken");
        return HttpResponse.json({ entries: [_sampleEntry], warnings: [] });
      }),
    );
    const out = await api.connectors.list();
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].service).toBe("file_drop");
    expect(out.warnings).toEqual([]);
  });

  it("throws ApiError on non-200", async () => {
    server.use(
      http.get(`${BASE}/connectors`, () => new HttpResponse("boom", { status: 500 })),
    );
    await expect(api.connectors.list()).rejects.toThrow();
  });

  it("sampleUrl builds absolute URL with encoded segments", async () => {
    const u = await api.connectors.sampleUrl("file_drop", "example.txt");
    // The mswServer sets backend to http://127.0.0.1:<port>; we just check shape.
    expect(u).toMatch(/\/connectors\/file_drop\/samples\/example\.txt$/);
  });
});
