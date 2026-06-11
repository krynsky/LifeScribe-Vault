import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders the loading placeholder", () => {
    render(<App />);
    expect(screen.getByText("LifeScribe Vault")).toBeInTheDocument();
    expect(screen.getByText("Preparing your vault…")).toBeInTheDocument();
  });
});
