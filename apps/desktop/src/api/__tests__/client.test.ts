import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { api } from "../client";
import { BASE, server } from "../../test/mswServer";

describe("api client", () => {
  it("lists notes by type", async () => {
    server.use(
      http.get(`${BASE}/vault/notes`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("type")).toBe("SourceRecord");
        return HttpResponse.json([{ id: "src_a", type: "SourceRecord" }]);
      }),
    );
    const out = await api.notes("SourceRecord");
    expect(out).toEqual([{ id: "src_a", type: "SourceRecord" }]);
  });

  it("fetches a single note", async () => {
    server.use(
      http.get(`${BASE}/vault/notes/src_x`, () =>
        HttpResponse.json({
          note: { id: "src_x", type: "SourceRecord" },
          body: "# hello",
        }),
      ),
    );
    const out = await api.note("src_x");
    expect(out.body).toBe("# hello");
  });

  it("reads and writes settings", async () => {
    server.use(
      http.get(`${BASE}/vault/settings`, () =>
        HttpResponse.json({ id: "settings_default", type: "VaultSettings", privacy_mode: false }),
      ),
      http.put(`${BASE}/vault/settings`, async ({ request }) => {
        const body = (await request.json()) as { privacy_mode: boolean };
        return HttpResponse.json({
          id: "settings_default",
          type: "VaultSettings",
          privacy_mode: body.privacy_mode,
        });
      }),
    );
    const got = await api.settings();
    expect(got.privacy_mode).toBe(false);
    const saved = await api.saveSettings({ privacy_mode: true });
    expect(saved.privacy_mode).toBe(true);
  });

  it("posts a job", async () => {
    server.use(
      http.post(`${BASE}/ingest/jobs`, async ({ request }) => {
        const body = (await request.json()) as { files: string[] };
        expect(body.files).toEqual(["/a.txt"]);
        return HttpResponse.json({ job_id: "job_1", status: "queued", total: 1 }, { status: 202 });
      }),
    );
    const out = await api.ingest.create(["/a.txt"]);
    expect(out.job_id).toBe("job_1");
  });

  it("throws ApiError with status on non-2xx", async () => {
    server.use(
      http.post(`${BASE}/ingest/jobs`, () =>
        HttpResponse.json({ detail: "busy" }, { status: 409 }),
      ),
    );
    await expect(api.ingest.create(["/x"])).rejects.toMatchObject({
      status: 409,
      detail: "busy",
    });
  });
});
