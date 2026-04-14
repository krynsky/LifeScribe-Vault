import type { JobDTO } from "../api/client";
import styles from "./JobProgress.module.css";

const TERMINAL: ReadonlyArray<JobDTO["status"]> = [
  "completed",
  "completed_with_failures",
  "cancelled",
  "failed",
];

interface Props {
  job: JobDTO;
  onCancel: () => void;
  cancelling?: boolean;
}

export default function JobProgress({ job, onCancel, cancelling = false }: Props) {
  const terminal = TERMINAL.includes(job.status);
  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.jobId}>{job.job_id}</span>
        <span className={styles.status} data-status={job.status}>
          {job.status.replace(/_/g, " ")}
        </span>
      </div>
      <div className={styles.counters}>
        <Counter label="✓" value={job.succeeded ?? 0} tone="ok" />
        <Counter label="✗" value={job.failed ?? 0} tone={(job.failed ?? 0) > 0 ? "bad" : "muted"} />
        <Counter label="⏭" value={job.skipped ?? 0} tone="muted" />
        <Counter label="Σ" value={job.total} tone="muted" />
      </div>
      {!terminal && (
        <button type="button" className={styles.cancel} onClick={onCancel} disabled={cancelling}>
          {cancelling ? "Cancelling…" : "Cancel"}
        </button>
      )}
    </div>
  );
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "bad" | "muted";
}) {
  return (
    <div className={styles.counter} data-tone={tone}>
      <span className={styles.counterLabel}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
