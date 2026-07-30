import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FormModule } from "../domain/formModel";
import { ModuleQuestion } from "./ModuleQuestion";

const module: FormModule = {
  moduleId: "secrets",
  title: "Store passwords",
  question: "Hold your actual passwords & PINs, or only where to find them?",
  helperText: "You can change this later.",
  defaultOptionId: "off",
  order: 1,
  options: [
    { optionId: "off", label: "Locations only" },
    { optionId: "on", label: "Store the actual passwords" },
  ],
};

describe("ModuleQuestion", () => {
  it("renders the question, helper text, and one radio per option, marking the selection", () => {
    render(<ModuleQuestion module={module} selected="off" onChange={vi.fn()} />);
    expect(screen.getByText(module.question)).toBeInTheDocument();
    expect(screen.getByText("You can change this later.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /locations only/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /store the actual passwords/i })).not.toBeChecked();
  });

  it("fires onChange with the option id when a different option is chosen", async () => {
    const onChange = vi.fn();
    render(<ModuleQuestion module={module} selected="off" onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: /store the actual passwords/i }));
    expect(onChange).toHaveBeenCalledWith("on");
  });

  it("falls back to the optionId as the label when an option has none", () => {
    const noLabel: FormModule = { ...module, options: [{ optionId: "off" }, { optionId: "on" }] };
    render(<ModuleQuestion module={noLabel} selected="off" onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "off" })).toBeInTheDocument();
  });
});
