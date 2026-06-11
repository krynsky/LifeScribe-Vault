import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field } from "./Field";

describe("Field", () => {
  it("associates the label with the control and renders helper text", () => {
    render(
      <Field fieldId="f1" label="Full name" helperText="As it appears on documents.">
        <input id="f1" readOnly value="" />
      </Field>,
    );
    expect(screen.getByLabelText("Full name")).toBeInTheDocument();
    expect(screen.getByText("As it appears on documents.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the error slot as an alert when an error is present", () => {
    render(
      <Field fieldId="f2" label="Email" error="Email is required.">
        <input id="f2" readOnly value="" />
      </Field>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Email is required.");
  });
});
