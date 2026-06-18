import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FormPack } from "../domain/formModel";
import { CreatorModePage } from "./CreatorModePage";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const MINIMAL_VALID_PACK: FormPack = {
  packId: "test",
  packVersion: "1.0.0",
  schemaVersion: 1,
  minAppVersion: "0.0.0",
  sections: [
    {
      sectionKey: "executors",
      title: "Executors",
      lede: "Who will handle your estate.",
      multiRecord: false,
      order: 1,
      groups: [
        {
          groupKey: "main",
          title: "Main",
          repeatable: false,
          order: 1,
          fields: [
            {
              systemKey: "name",
              label: "Name",
              type: "text",
              required: true,
              protected: true,
              order: 1,
            },
          ],
        },
      ],
      readinessRule: { requiredKeys: ["name"] },
      kitMapping: { entries: [] },
    },
  ],
  migrations: [],
};

describe("CreatorModePage", () => {
  it("renders the editor immediately from initialPack without loading state", () => {
    render(
      <CreatorModePage
        initialPack={MINIMAL_VALID_PACK}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("Pack Editor")).toBeInTheDocument();
    expect(screen.queryByText("Loading pack…")).not.toBeInTheDocument();
  });

  it("calls onSave with the validated pack after export + save to vault", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<CreatorModePage initialPack={MINIMAL_VALID_PACK} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /validate.*export/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save to vault/i })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: /save to vault/i }));

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ packId: "test" }),
    );
  });

  it("does not call onSave when export validation fails", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    const invalidPack: FormPack = {
      ...MINIMAL_VALID_PACK,
      sections: [
        {
          ...MINIMAL_VALID_PACK.sections[0],
          groups: [
            {
              ...MINIMAL_VALID_PACK.sections[0].groups[0],
              fields: [
                {
                  systemKey: "custom.bad",
                  label: "Bad",
                  type: "text",
                  required: false,
                  protected: false,
                  order: 1,
                },
              ],
            },
          ],
        },
      ],
    };
    render(<CreatorModePage initialPack={invalidPack} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /validate.*export/i }));
    await waitFor(() =>
      expect(screen.getByText(/export blocked/i)).toBeInTheDocument(),
    );

    expect(screen.queryByRole("button", { name: /save to vault/i })).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});
