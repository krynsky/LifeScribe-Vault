import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatInput } from "../ChatInput";

describe("ChatInput", () => {
  it("send disabled when privacy on + remote provider", async () => {
    render(
      <ChatInput
        onSend={vi.fn()}
        provider={{ id: "p", model: "m", local: false }}
        privacyMode={true}
      />,
    );
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
    expect(screen.getByText(/privacy is on/i)).toBeInTheDocument();
  });

  it("calls onSend when pressing Enter", async () => {
    const onSend = vi.fn();
    render(
      <ChatInput
        onSend={onSend}
        provider={{ id: "p", model: "m", local: true }}
        privacyMode={false}
      />,
    );
    const input = screen.getByPlaceholderText(/ask about your vault/i);
    await userEvent.type(input, "hello{Enter}");
    expect(onSend).toHaveBeenCalledWith("hello");
  });
});
