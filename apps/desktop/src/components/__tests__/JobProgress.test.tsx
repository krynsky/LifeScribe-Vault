import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import JobProgress from "../JobProgress";
import { renderWithProviders } from "../../test/renderWithProviders";
import type { JobDTO } from "../../api/client";

const running: JobDTO = {
  job_id: "job_1",
  status: "running",
  total: 3,
  succeeded: 1,
  failed: 0,
  skipped: 0,
  cancelled: 0,
};

describe("JobProgress", () => {
  it("shows counters", () => {
    renderWithProviders(<JobProgress job={running} onCancel={() => {}} />);
    expect(screen.getByText(/running/i)).toBeInTheDocument();
  });

  it("calls onCancel when cancel clicked", async () => {
    const onCancel = vi.fn();
    renderWithProviders(<JobProgress job={running} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("hides cancel button at terminal state", () => {
    renderWithProviders(
      <JobProgress job={{ ...running, status: "completed" }} onCancel={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });
});
