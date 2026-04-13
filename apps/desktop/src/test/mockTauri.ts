import { vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({
    host: "127.0.0.1",
    port: 9999,
    token: "testtoken",
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

export const dragDropHandlers = new Set<(e: unknown) => void>();

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    onDragDropEvent: (cb: (e: unknown) => void) => {
      dragDropHandlers.add(cb);
      return Promise.resolve(() => dragDropHandlers.delete(cb));
    },
  }),
}));

export const openDialogMock = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openDialogMock(...args),
}));
