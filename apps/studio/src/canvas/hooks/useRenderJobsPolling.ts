import { useEffect } from "react";
import { useApiClient } from "../../lib/apiClient";
import { useRenderJobsStore } from "./useRenderJobsStore";

const POLL_INTERVAL_MS = 2500;

/** Polls every non-terminal render job until it succeeds or fails. */
export function useRenderJobsPolling() {
  const apiClient = useApiClient();
  const jobs = useRenderJobsStore((state) => state.jobs);
  const updateJob = useRenderJobsStore((state) => state.updateJob);

  const pendingIds = jobs
    .filter((job) => job.status === "pending" || job.status === "processing")
    .map((job) => job.id)
    .join(",");

  useEffect(() => {
    if (!pendingIds) return;

    let cancelled = false;
    const poll = () => {
      pendingIds.split(",").forEach((id) => {
        apiClient
          .getRender(id)
          .then(({ job }) => {
            if (!cancelled) updateJob(id, job);
          })
          .catch(() => {
            // Transient network/API errors are retried on the next tick.
          });
      });
    };

    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingIds]);
}
