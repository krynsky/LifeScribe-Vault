import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import SettingsRoute from "../SettingsRoute";
import { BASE, server } from "../../test/mswServer";
import { renderWithProviders } from "../../test/renderWithProviders";

describe("SettingsRoute", () => {
  it("prefills from server and saves changes", async () => {
    let current = { id: "settings_default", type: "VaultSettings", privacy_mode: false };
    server.use(
      http.get(`${BASE}/vault/settings`, () => HttpResponse.json(current)),
      http.put(`${BASE}/vault/settings`, async ({ request }) => {
        const body = (await request.json()) as { privacy_mode: boolean };
        current = { ...current, privacy_mode: body.privacy_mode };
        return HttpResponse.json(current);
      }),
    );
    renderWithProviders(<SettingsRoute />, { initialEntries: ["/settings"] });
    const toggle = await screen.findByRole("checkbox", { name: /privacy/i });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(screen.getByText(/saved/i)).toBeInTheDocument());
  });
});
