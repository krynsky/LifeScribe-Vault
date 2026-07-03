import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SetupScreen } from "./SetupScreen";

const STRONG_PASSWORD = "correct horse battery staple";

async function fillPasswords(password = STRONG_PASSWORD, confirm = password) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Your name"), "Dana");
  await user.type(screen.getByLabelText("Master password"), password);
  await user.type(screen.getByLabelText("Confirm master password"), confirm);
  return user;
}

describe("SetupScreen", () => {
  it("keeps Create disabled until the no-recovery acknowledgment is checked", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<SetupScreen onCreate={onCreate} />);

    const user = await fillPasswords();
    const createButton = screen.getByRole("button", { name: "Create vault" });
    expect(createButton).toBeDisabled();

    await user.click(
      screen.getByLabelText(/I understand there is no recovery/i),
    );
    expect(createButton).toBeEnabled();

    await user.click(createButton);
    expect(onCreate).toHaveBeenCalledWith(STRONG_PASSWORD, "Dana", "hint");
  });

  it("blocks mismatched passwords with a friendly error", async () => {
    const onCreate = vi.fn();
    render(<SetupScreen onCreate={onCreate} />);

    const user = await fillPasswords(STRONG_PASSWORD, "different but long enough");
    await user.click(screen.getByLabelText(/I understand there is no recovery/i));
    await user.click(screen.getByRole("button", { name: "Create vault" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/don't match/i);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("blocks short master passwords", async () => {
    const onCreate = vi.fn();
    render(<SetupScreen onCreate={onCreate} />);

    const user = await fillPasswords("short pw");
    await user.click(screen.getByLabelText(/I understand there is no recovery/i));
    await user.click(screen.getByRole("button", { name: "Create vault" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/at least 15 characters/i);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("reveals and re-hides the master password with the in-field toggle", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<SetupScreen onCreate={onCreate} />);
    const user = userEvent.setup();

    const master = screen.getByLabelText("Master password");
    expect(master).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Show master password" }));
    expect(master).toHaveAttribute("type", "text");
    // Toggling one field does not reveal the other.
    expect(screen.getByLabelText("Confirm master password")).toHaveAttribute(
      "type",
      "password",
    );

    await user.click(screen.getByRole("button", { name: "Hide master password" }));
    expect(master).toHaveAttribute("type", "password");
  });

  it("passes the chosen form mode to onCreate (defaults to hint)", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<SetupScreen onCreate={onCreate} />);

    const user = await fillPasswords();
    await user.click(screen.getByLabelText(/I understand there is no recovery/i));
    await user.click(screen.getByLabelText(/store the actual secrets/i));
    await user.click(screen.getByRole("button", { name: /create/i }));

    expect(onCreate).toHaveBeenCalledWith(STRONG_PASSWORD, "Dana", "credential");
  });
});
