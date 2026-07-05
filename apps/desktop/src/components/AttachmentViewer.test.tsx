import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vaultApi from "../api/vaultApi";
import { AttachmentViewer } from "./AttachmentViewer";

vi.mock("../api/vaultApi", () => ({ readAttachment: vi.fn() }));
const mocked = vi.mocked(vaultApi);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.readAttachment.mockResolvedValue(new Uint8Array([1, 2, 3]));
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe("AttachmentViewer", () => {
  it("renders an image for image file names", async () => {
    render(<AttachmentViewer attachmentId="a1" fileName="photo.png" onClose={vi.fn()} />);
    expect(await screen.findByRole("img", { name: /photo\.png/i })).toBeInTheDocument();
    expect(mocked.readAttachment).toHaveBeenCalledWith("a1");
  });

  it("shows a no-preview message for unknown types", async () => {
    render(<AttachmentViewer attachmentId="a2" fileName="archive.zip" onClose={vi.fn()} />);
    expect(await screen.findByText(/no inline preview/i)).toBeInTheDocument();
  });
});
