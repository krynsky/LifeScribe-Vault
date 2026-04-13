import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import NoteViewerRoute from "../NoteViewerRoute";
import { BASE, server } from "../../test/mswServer";
import { renderWithProviders } from "../../test/renderWithProviders";

describe("NoteViewerRoute", () => {
  it("renders frontmatter and Markdown body", async () => {
    server.use(
      http.get(`${BASE}/vault/notes/src_alpha`, () =>
        HttpResponse.json({
          note: { id: "src_alpha", type: "SourceRecord", original_filename: "a.txt" },
          body: "# Title\n\nHello",
        }),
      ),
    );
    renderWithProviders(
      <Routes>
        <Route path="/browse/:id" element={<NoteViewerRoute />} />
      </Routes>,
      { initialEntries: ["/browse/src_alpha"] },
    );
    await waitFor(() => expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument());
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText(/src_alpha/)).toBeInTheDocument();
  });

  it("shows not-found on 404", async () => {
    server.use(
      http.get(`${BASE}/vault/notes/src_missing`, () =>
        HttpResponse.json({ detail: "gone" }, { status: 404 }),
      ),
    );
    renderWithProviders(
      <Routes>
        <Route path="/browse/:id" element={<NoteViewerRoute />} />
      </Routes>,
      { initialEntries: ["/browse/src_missing"] },
    );
    await waitFor(() => expect(screen.getByText(/not found/i)).toBeInTheDocument());
  });
});
