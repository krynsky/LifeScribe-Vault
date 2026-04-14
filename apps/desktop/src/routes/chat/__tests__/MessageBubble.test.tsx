import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { MessageBubble } from "../MessageBubble";

describe("MessageBubble", () => {
  it("renders [N] tokens as citation chips", () => {
    render(
      <MemoryRouter>
        <MessageBubble
          role="assistant"
          content="According to [1], planning is a priority."
          citations={[{ marker: 1, note_id: "doc_a", chunk_id: "cc", score: -8, resolved: true }]}
        />
      </MemoryRouter>,
    );
    const chip = screen.getByRole("link", { name: /1/ });
    expect(chip).toHaveAttribute("href", "/browse/doc_a?chunk=cc");
  });

  it("flags unresolved markers", () => {
    render(
      <MemoryRouter>
        <MessageBubble
          role="assistant"
          content="answer [7]"
          citations={[{ marker: 7, note_id: "", chunk_id: "", score: 0, resolved: false }]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTitle(/unresolved/i)).toBeInTheDocument();
  });
});
