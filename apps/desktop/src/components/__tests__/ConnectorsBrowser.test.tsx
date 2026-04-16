import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, test } from "vitest";

import ConnectorsBrowser from "../ConnectorsBrowser";
import { BASE, server } from "../../test/mswServer";
import { renderWithProviders } from "../../test/renderWithProviders";

const ENTRIES = [
  {
    service: "file_drop",
    display_name: "File Drop",
    description: "Drop files into the app.",
    category: "files",
    auth_mode: "none",
    tier: "free",
    connector_type: "file",
    entry_point: "connectors.file_drop.connector:FileDropConnector",
    supported_formats: ["pdf", "txt"],
    privacy_posture: "local_only",
    export_instructions: "# Steps\n\n1. Drop\n2. Done",
    sample_file_urls: ["/connectors/file_drop/samples/example.txt"],
    manifest_schema_version: 1,
    blocked: false,
  },
  {
    service: "fake_remote",
    display_name: "Fake Remote",
    description: "Only for tests.",
    category: "messaging",
    auth_mode: "oauth",
    tier: "freemium",
    connector_type: "api_sync",
    entry_point: "connectors.fake_remote.connector:FakeRemoteConnector",
    supported_formats: [],
    privacy_posture: "requires_network",
    export_instructions: "",
    sample_file_urls: [],
    manifest_schema_version: 1,
    blocked: true,
  },
];

describe("ConnectorsBrowser", () => {
  test("renders catalog entries", async () => {
    server.use(
      http.get(`${BASE}/connectors`, () => HttpResponse.json({ entries: ENTRIES, warnings: [] })),
    );
    renderWithProviders(<ConnectorsBrowser />);
    expect(await screen.findByText("File Drop")).toBeInTheDocument();
    expect(screen.getByText("Fake Remote")).toBeInTheDocument();
  });

  test("shows blocked badge on requires_network when privacy on", async () => {
    server.use(
      http.get(`${BASE}/connectors`, () => HttpResponse.json({ entries: ENTRIES, warnings: [] })),
    );
    renderWithProviders(<ConnectorsBrowser />);
    // Wait for data to load
    await screen.findByText("Fake Remote");
    expect(screen.getByText(/blocked by privacy mode/i)).toBeInTheDocument();
  });

  test("expands an entry to reveal markdown-rendered export instructions", async () => {
    server.use(
      http.get(`${BASE}/connectors`, () => HttpResponse.json({ entries: ENTRIES, warnings: [] })),
    );
    const user = userEvent.setup();
    renderWithProviders(<ConnectorsBrowser />);

    const btn = await screen.findByRole("button", { name: /file drop/i });
    await user.click(btn);

    expect(screen.getByRole("heading", { name: "Steps" })).toBeInTheDocument();
  });

  test("surfaces catalog warnings", async () => {
    server.use(
      http.get(`${BASE}/connectors`, () =>
        HttpResponse.json({
          entries: ENTRIES,
          warnings: ["connectors/bad: missing manifest.toml"],
        }),
      ),
    );
    renderWithProviders(<ConnectorsBrowser />);
    expect(await screen.findByText(/1 connector failed to load/i)).toBeInTheDocument();
  });
});
