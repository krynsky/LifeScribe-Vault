import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentList } from "./AttachmentList";

// Mock Tauri dialog and vault API.
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../api/vaultApi", () => ({
  addAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
}));

import { open as openFilePicker } from "@tauri-apps/plugin-dialog";
import * as vaultApi from "../api/vaultApi";
const mockOpen = vi.mocked(openFilePicker);
const mockAdd = vi.mocked(vaultApi.addAttachment);
const mockDelete = vi.mocked(vaultApi.deleteAttachment);

const sampleAttachment = { id: "att-001", fileName: "will.pdf", sizeBytes: 10240 };

beforeEach(() => {
  vi.clearAllMocks();
  mockDelete.mockResolvedValue(undefined);
});

describe("AttachmentList", () => {
  it("renders existing attachments with name and size", () => {
    const onAdd = vi.fn();
    const onDelete = vi.fn();
    render(<AttachmentList attachments={[sampleAttachment]} onAdd={onAdd} onDelete={onDelete} />);
    expect(screen.getByText("will.pdf")).toBeInTheDocument();
    expect(screen.getByText("10.0 KB")).toBeInTheDocument();
  });

  it("calls onAdd after selecting a file", async () => {
    mockOpen.mockResolvedValue("/home/user/will.pdf");
    mockAdd.mockResolvedValue({ id: "new-id", fileName: "will.pdf", sizeBytes: 1234 });

    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<AttachmentList attachments={[]} onAdd={onAdd} onDelete={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Add file" }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({
      id: "new-id",
      fileName: "will.pdf",
      sizeBytes: 1234,
    }));
    expect(mockAdd).toHaveBeenCalledWith("/home/user/will.pdf");
  });

  it("does nothing when file picker is dismissed", async () => {
    mockOpen.mockResolvedValue(null);
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<AttachmentList attachments={[]} onAdd={onAdd} onDelete={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Add file" }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("shows error when addAttachment rejects", async () => {
    mockOpen.mockResolvedValue("/bad/path.txt");
    mockAdd.mockRejectedValue(new Error("StorageError"));
    const user = userEvent.setup();
    render(<AttachmentList attachments={[]} onAdd={vi.fn()} onDelete={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Add file" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/Could not add the file/),
    );
  });

  it("shows delete confirm then calls onDelete", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<AttachmentList attachments={[sampleAttachment]} onAdd={vi.fn()} onDelete={onDelete} />);

    await user.click(screen.getByRole("button", { name: /Remove will\.pdf/i }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/This cannot be undone/);

    await user.click(screen.getAllByRole("button", { name: "Remove" })[0]);

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("att-001"));
    expect(mockDelete).toHaveBeenCalledWith("att-001");
  });

  it("cancel closes the confirm without deleting", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<AttachmentList attachments={[sampleAttachment]} onAdd={vi.fn()} onDelete={onDelete} />);

    await user.click(screen.getByRole("button", { name: /Remove will\.pdf/i }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
