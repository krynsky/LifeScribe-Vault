import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import DropZone from "../components/DropZone";
import JobProgress from "../components/JobProgress";
import { ApiError } from "../api/client";
import { useCancelJob, useCreateJob, useJob } from "../api/queries";

export default function ImportRoute() {
  const [activeJobId, setActiveJobId] = useState<string | undefined>();
  const [banner, setBanner] = useState<string | null>(null);
  const createJob = useCreateJob();
  const cancelJob = useCancelJob();
  const job = useJob(activeJobId);

  async function submit(files: string[]) {
    if (!files.length) return;
    setBanner(null);
    try {
      const res = await createJob.mutateAsync(files);
      setActiveJobId(res.job_id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setBanner("A job is already running. Cancel it or wait for it to finish.");
      } else {
        setBanner((e as Error).message);
      }
    }
  }

  async function pick() {
    const picked = (await openDialog({ multiple: true })) as string[] | string | null;
    if (!picked) return;
    const arr = Array.isArray(picked) ? picked : [picked];
    await submit(arr);
  }

  const running =
    job.data &&
    !["completed", "completed_with_failures", "cancelled", "failed"].includes(job.data.status);

  return (
    <div>
      <h1>Import</h1>
      {banner && (
        <div
          role="alert"
          style={{ background: "#fde", padding: 10, borderRadius: 6, marginBottom: 12 }}
        >
          {banner}
        </div>
      )}
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <button type="button" onClick={pick} disabled={!!running}>
          Add files…
        </button>
      </div>
      <DropZone
        onPaths={(paths) => {
          if (running) {
            setBanner("A job is already running.");
            return;
          }
          submit(paths);
        }}
      />
      {job.data && (
        <div style={{ marginTop: 16 }}>
          <JobProgress
            job={job.data}
            onCancel={() => activeJobId && cancelJob.mutate(activeJobId)}
            cancelling={cancelJob.isPending}
          />
        </div>
      )}
    </div>
  );
}
