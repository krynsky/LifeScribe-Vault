import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vaultApi from "../api/vaultApi";
import { open as openFilePicker } from "@tauri-apps/plugin-dialog";
import { FileField } from "./FileField";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../api/vaultApi", () => ({
  addAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  readAttachment: vi.fn(),
  openAttachmentExternal: vi.fn(),
}));
const mocked = vi.mocked(vaultApi);
const mockedPicker = vi.mocked(openFilePicker);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FileField", () => {
  it("attaches a picked file", async () => {
    mockedPicker.mockResolvedValue("/tmp/will.pdf");
    mocked.addAttachment.mockResolvedValue({ id: "att1", fileName: "will.pdf", sizeBytes: 10 });
    const onAttach = vi.fn();
    render(<FileField fieldId="f1" attachment={null} onAttach={onAttach} onRemove={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /attach file/i }));

    expect(mocked.addAttachment).toHaveBeenCalledWith("/tmp/will.pdf");
    expect(onAttach).toHaveBeenCalledWith({ id: "att1", fileName: "will.pdf", sizeBytes: 10 });
  });

  it("remove clears the ref WITHOUT deleting the ciphertext file", async () => {
    // The saved snapshot may still reference the file; deletion happens only
    // after a save commits (Dashboard) or via the unlock-time orphan sweep.
    const onRemove = vi.fn();
    render(
      <FileField
        fieldId="f1"
        attachment={{ id: "att1", fileName: "will.pdf", sizeBytes: 10 }}
        onAttach={vi.fn()}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByText("will.pdf")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(mocked.deleteAttachment).not.toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalled();
  });

  it("replace attaches the new file WITHOUT deleting the previous ciphertext", async () => {
    mockedPicker.mockResolvedValue("/tmp/new-will.pdf");
    mocked.addAttachment.mockResolvedValue({ id: "att2", fileName: "new-will.pdf", sizeBytes: 20 });
    const onAttach = vi.fn();
    render(
      <FileField
        fieldId="f1"
        attachment={{ id: "att1", fileName: "will.pdf", sizeBytes: 10 }}
        onAttach={onAttach}
        onRemove={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /replace/i }));
    expect(mocked.deleteAttachment).not.toHaveBeenCalled();
    expect(onAttach).toHaveBeenCalledWith({ id: "att2", fileName: "new-will.pdf", sizeBytes: 20 });
  });

  it("shows the viewer when View is clicked", async () => {
    mocked.readAttachment.mockResolvedValue(new Uint8Array([1]));
    globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
    globalThis.URL.revokeObjectURL = vi.fn();
    render(
      <FileField
        fieldId="f1"
        attachment={{ id: "att1", fileName: "photo.png", sizeBytes: 10 }}
        onAttach={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /view/i }));
    expect(await screen.findByRole("dialog", { name: /view photo\.png/i })).toBeInTheDocument();
  });
});
