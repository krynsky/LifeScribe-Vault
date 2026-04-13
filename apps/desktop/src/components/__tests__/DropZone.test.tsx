import { act, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DropZone from "../DropZone";
import { renderWithProviders } from "../../test/renderWithProviders";
import { dragDropHandlers } from "../../test/mockTauri";

describe("DropZone", () => {
  it("shows label and forwards dropped paths", async () => {
    const onPaths = vi.fn();
    renderWithProviders(<DropZone onPaths={onPaths} label="Drop stuff" />);
    expect(screen.getByText("Drop stuff")).toBeInTheDocument();

    await act(async () => {});
    const handler = [...dragDropHandlers][0];
    expect(handler).toBeDefined();

    await act(async () => {
      handler({ payload: { type: "drop", paths: ["/a.txt", "/b.pdf"] } });
    });
    expect(onPaths).toHaveBeenCalledWith(["/a.txt", "/b.pdf"]);
  });
});
