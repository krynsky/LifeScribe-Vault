import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import LogsRoute from "../LogsRoute";
import { BASE, server } from "../../test/mswServer";
import { renderWithProviders } from "../../test/renderWithProviders";

describe("LogsRoute", () => {
  it("lists jobs and navigates to viewer", async () => {
    server.use(
      http.get(`${BASE}/vault/notes`, () =>
        HttpResponse.json([
          {
            id: "job_20260412",
            type: "IngestJobLog",
            status: "completed",
            started_at: "2026-04-12T14:00:00Z",
            total: 3,
            succeeded: 3,
          },
        ]),
      ),
    );
    renderWithProviders(
      <Routes>
        <Route path="/logs" element={<LogsRoute />} />
        <Route path="/logs/:id" element={<div>viewer</div>} />
      </Routes>,
      { initialEntries: ["/logs"] },
    );
    await waitFor(() => expect(screen.getByText(/job_20260412/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/job_20260412/));
    await waitFor(() => expect(screen.getByText("viewer")).toBeInTheDocument());
  });
});
