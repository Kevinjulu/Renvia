/** A render never reports real progress mid-flight, so this fakes a plausible curve from elapsed time. */
const PROGRESS_CEILING = 92;

export interface ProgressJob {
  status: string;
  createdAt: string;
  updatedAt: string;
}

export function jobProgress(job: ProgressJob, now: number): number {
  if (job.status === "succeeded" || job.status === "failed") return 100;
  const anchor = job.status === "processing" ? job.updatedAt : job.createdAt;
  const elapsedSeconds = Math.max(0, (now - new Date(anchor).getTime()) / 1000);
  const base = job.status === "pending" ? 6 : 15;
  return Math.min(PROGRESS_CEILING, base + (PROGRESS_CEILING - base) * (1 - Math.exp(-elapsedSeconds / 18)));
}
