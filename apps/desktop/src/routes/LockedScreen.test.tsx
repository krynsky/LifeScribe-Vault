import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LockedScreen } from "./LockedScreen";

describe("LockedScreen", () => {
  it("shows the no-reset messaging on a failed unlock", async () => {
    const onUnlock = vi.fn().mockRejectedValue(new Error("InvalidMasterPassword"));
    render(<LockedScreen onUnlock={onUnlock} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Master password"), "wrong password!!");
    await user.click(screen.getByRole("button", { name: "Unlock" }));

    expect(onUnlock).toHaveBeenCalledWith("wrong password!!");
    expect(screen.getByRole("alert")).toHaveTextContent(/there is no reset/i);
    // The failed entry is cleared, never left rendered.
    expect(screen.getByLabelText("Master password")).toHaveValue("");
  });

  it("unlocks with the entered password", async () => {
    const onUnlock = vi.fn().mockResolvedValue(undefined);
    render(<LockedScreen onUnlock={onUnlock} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Master password"), "right password!!");
    await user.click(screen.getByRole("button", { name: "Unlock" }));

    expect(onUnlock).toHaveBeenCalledWith("right password!!");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
