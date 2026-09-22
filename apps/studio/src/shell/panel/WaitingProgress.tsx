import { useEffect, useState } from "react";
import { jobProgress, type ProgressJob } from "../../canvas/utils/renderProgress";
import { useArchitectureFact } from "./useArchitectureFact";

const TICK_MS = 1000;

function elapsedLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest.toString().padStart(2, "0")}s`;
}

interface WaitingProgressProps {
  job: ProgressJob;
  label: string;
  onCancel?: () => void;
  isCancelling?: boolean;
}

/** Progress bar plus a rotating architecture fact, so a slow render/edit still feels alive. */
export function WaitingProgress({ job, label, onCancel, isCancelling = false }: WaitingProgressProps) {
  const [now, setNow] = useState(() => Date.now());
  const fact = useArchitectureFact(true);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(tick);
  }, []);

  const progress = Math.round(jobProgress(job, now));
  const elapsedSeconds = Math.max(0, Math.round((now - new Date(job.createdAt).getTime()) / 1000));

  return (
    <div className="waiting-progress">
      <div className="waiting-progress-head">
        <span>
          {label} <b>{progress}%</b>
        </span>
        <span className="waiting-progress-time">{elapsedLabel(elapsedSeconds)}</span>
      </div>
      <i className="waiting-progress-bar">
        <em style={{ width: `${progress}%` }} />
      </i>
      <div className="waiting-progress-footer">
        <p className="waiting-progress-fact" key={fact}>
          <span aria-hidden="true">✦</span> {fact}
        </p>
        {onCancel && (
          <button type="button" className="waiting-progress-cancel" onClick={onCancel} disabled={isCancelling}>
            {isCancelling ? "Cancelling…" : "Cancel"}
          </button>
        )}
      </div>
    </div>
  );
}
