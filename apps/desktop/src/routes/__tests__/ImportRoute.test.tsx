import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import ImportRoute from "../ImportRoute";
import { BASE, server } from "../../test/mswServer";
import { openDialogMock, dragDropHandlers } from "../../test/mockTauri";
import { renderWithProviders } from "../../test/renderWithProviders";

describe("ImportRoute", () => {
  it("picker → job → terminal polling", async () => {
    openDialogMock.mockResolvedValueOnce(["/a.txt", "/b.txt"]);
    let poll = 0;
    server.use(
      http.post(`${BASE}/ingest/jobs`, () =>
        HttpResponse.json({ job_id: "job_x", status: "queued", total: 2 }, { status: 202 }),
      ),
      http.get(`${BASE}/ingest/jobs/job_x`, () => {
        poll += 1;
        return HttpResponse.json({
          job_id: "job_x",
          status: poll > 1 ? "completed" : "running",
          total: 2,
          succeeded: poll > 1 ? 2 : 1,
          failed: 0,
          skipped: 0,
        });
      }),
    );
    renderWithProviders(<ImportRoute />, { initialEntries: ["/import"] });
    await userEvent.click(screen.getByRole("button", { name: /add files/i }));
    await waitFor(() => expect(screen.getByText(/job_x/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/completed/i)).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it("drag-drop triggers job", async () => {
    server.use(
      http.post(`${BASE}/ingest/jobs`, () =>
        HttpResponse.json({ job_id: "job_y", status: "queued", total: 1 }, { status: 202 }),
      ),
      http.get(`${BASE}/ingest/jobs/job_y`, () =>
        HttpResponse.json({
          job_id: "job_y",
          status: "completed",
          total: 1,
          succeeded: 1,
          failed: 0,
          skipped: 0,
        }),
      ),
    );
    renderWithProviders(<ImportRoute />, { initialEntries: ["/import"] });
    await act(async () => {});
    const handler = [...dragDropHandlers][0];
    await act(async () => handler({ payload: { type: "drop", paths: ["/z.txt"] } }));
    await waitFor(() => expect(screen.getByText(/job_y/)).toBeInTheDocument());
  });

  it("409 shows busy banner", async () => {
    openDialogMock.mockResolvedValueOnce(["/a.txt"]);
    server.use(
      http.post(`${BASE}/ingest/jobs`, () =>
        HttpResponse.json({ detail: "job running" }, { status: 409 }),
      ),
    );
    renderWithProviders(<ImportRoute />, { initialEntries: ["/import"] });
    await userEvent.click(screen.getByRole("button", { name: /add files/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/already running/i));
  });
});
