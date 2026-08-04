import type { SectionStatus } from "../domain/readiness";

const STATUS_LABELS: Record<SectionStatus, string> = {
  "not-started": "Not started",
  started: "Started",
  complete: "Complete",
  "stale-complete": "Review due",
  na: "Doesn't apply",
};

export interface StatusBadgeProps {
  status: SectionStatus;
}

/** Checklist status badge: not-started / started / complete / stale-complete / N/A. */
export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`status-badge status-badge--${status}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
