import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import BrowseRoute from "../BrowseRoute";
import { BASE, server } from "../../test/mswServer";
import { renderWithProviders } from "../../test/renderWithProviders";

describe("BrowseRoute", () => {
  it("lists SourceRecord notes and navigates to viewer on click", async () => {
    server.use(
      http.get(`${BASE}/vault/notes`, () =>
        HttpResponse.json([
          { id: "src_alpha", type: "SourceRecord", original_filename: "a.txt" },
        ]),
      ),
    );
    renderWithProviders(
      <Routes>
        <Route path="/browse" element={<BrowseRoute />} />
        <Route path="/browse/:id" element={<div>viewer</div>} />
      </Routes>,
      { initialEntries: ["/browse"] },
    );
    await waitFor(() => expect(screen.getByText(/a\.txt/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/a\.txt/));
    await waitFor(() => expect(screen.getByText("viewer")).toBeInTheDocument());
  });

  it("shows error banner on 500", async () => {
    server.use(http.get(`${BASE}/vault/notes`, () => new HttpResponse(null, { status: 500 })));
    renderWithProviders(<BrowseRoute />, { initialEntries: ["/browse"] });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
