import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { BASE, server } from "../../../test/mswServer";
import { renderWithProviders } from "../../../test/renderWithProviders";
import { SessionsList } from "../SessionsList";

describe("SessionsList", () => {
  it("shows sessions and triggers onSelect", async () => {
    server.use(
      http.get(`${BASE}/chat/sessions`, () =>
        HttpResponse.json([
          {
            id: "chat_a",
            title: "first chat",
            provider_id: "p",
            model: "m",
            turn_count: 2,
            created_at: "2026-04-14T00:00:00Z",
            updated_at: "2026-04-14T00:01:00Z",
          },
        ]),
      ),
    );
    const onSelect = vi.fn();
    const onNewChat = vi.fn();
    renderWithProviders(
      <SessionsList activeId={undefined} onSelect={onSelect} onNewChat={onNewChat} />,
    );
    const item = await screen.findByText("first chat");
    await userEvent.click(item);
    expect(onSelect).toHaveBeenCalledWith("chat_a");
  });
});
