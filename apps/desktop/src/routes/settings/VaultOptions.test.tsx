import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FormPack } from "../../domain/formModel";
import { VaultOptions } from "./VaultOptions";

function packWithTwoModules(): FormPack {
  return {
    packId: "p", packVersion: "1.0.0", schemaVersion: 1, minAppVersion: "0.0.0", migrations: [], sections: [],
    modules: [
      { moduleId: "secrets", title: "Store passwords", question: "?", defaultOptionId: "off", order: 1,
        options: [{ optionId: "off", label: "Locations only" }, { optionId: "on", label: "Store the actual passwords" }] },
      { moduleId: "file-method", title: "File handling", question: "?", defaultOptionId: "path", order: 2,
        options: [{ optionId: "path", label: "Point to location" }, { optionId: "attach", label: "Attach files" }] },
    ],
  };
}

describe("VaultOptions", () => {
  it("renders a question per module and disables Apply until a selection differs", async () => {
    const onApply = vi.fn();
    render(<VaultOptions base={packWithTwoModules()} selections={{ secrets: "off", "file-method": "path" }} onApply={onApply} />);
    expect(screen.getByText("Store passwords")).toBeInTheDocument();
    expect(screen.getByText("File handling")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /apply changes/i })).toBeDisabled();

    await userEvent.click(screen.getByRole("radio", { name: /store the actual passwords/i }));
    expect(screen.getByRole("button", { name: /apply changes/i })).toBeEnabled();
  });

  it("confirms, then calls onApply with the working selections", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(<VaultOptions base={packWithTwoModules()} selections={{ secrets: "off", "file-method": "path" }} onApply={onApply} />);
    await userEvent.click(screen.getByRole("radio", { name: /attach files/i }));
    await userEvent.click(screen.getByRole("button", { name: /apply changes/i }));
    await userEvent.click(screen.getByRole("button", { name: /^confirm/i }));
    expect(onApply).toHaveBeenCalledWith({ secrets: "off", "file-method": "attach" });
  });

  it("shows an empty state when the pack has no modules", () => {
    const noModules: FormPack = { ...packWithTwoModules(), modules: [] };
    render(<VaultOptions base={noModules} selections={{}} onApply={vi.fn()} />);
    expect(screen.getByText(/no vault options/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apply changes/i })).not.toBeInTheDocument();
  });
});
