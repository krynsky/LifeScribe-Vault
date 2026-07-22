import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { open as openPicker } from "@tauri-apps/plugin-dialog";
import { PathField } from "./PathField";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const mockedOpen = vi.mocked(openPicker);

/** Stateful wrapper so the controlled input reflects typed/picked updates. */
function ControlledPathField({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <PathField fieldId="f1" value={value} onChange={setValue} />;
}

beforeEach(() => {
  mockedOpen.mockReset();
});

describe("PathField", () => {
  it("shows the current value in an editable text input", () => {
    render(<ControlledPathField initial="/home/dana/estate" />);
    expect(screen.getByRole("textbox")).toHaveValue("/home/dana/estate");
  });

  it("typing a path updates the value", async () => {
    render(<ControlledPathField />);
    await userEvent.type(screen.getByRole("textbox"), "/mnt/vault");
    expect(screen.getByRole("textbox")).toHaveValue("/mnt/vault");
  });

  it("'Choose folder…' opens the native directory picker and stores the chosen path", async () => {
    mockedOpen.mockResolvedValue("C:\\Users\\Dana\\Estate");
    const onChange = vi.fn();
    render(<PathField fieldId="f1" value="" onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: /choose folder/i }));

    expect(mockedOpen).toHaveBeenCalledWith({ directory: true, multiple: false });
    expect(onChange).toHaveBeenCalledWith("C:\\Users\\Dana\\Estate");
  });

  it("'Choose file…' opens the native file picker and stores the chosen path", async () => {
    mockedOpen.mockResolvedValue("C:\\Users\\Dana\\will.pdf");
    const onChange = vi.fn();
    render(<PathField fieldId="f1" value="" onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: /choose file/i }));

    expect(mockedOpen).toHaveBeenCalledWith({ directory: false, multiple: false });
    expect(onChange).toHaveBeenCalledWith("C:\\Users\\Dana\\will.pdf");
  });

  it("does not change the value when the picker is cancelled (returns null)", async () => {
    mockedOpen.mockResolvedValue(null);
    const onChange = vi.fn();
    render(<PathField fieldId="f1" value="C:\\Keep" onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: /choose folder/i }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("surfaces a picker error without throwing", async () => {
    mockedOpen.mockRejectedValue(new Error("dialog unavailable"));
    render(<PathField fieldId="f1" value="" onChange={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /choose folder/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("dialog unavailable");
  });
});
