import type { AdminProject } from "@renvia/types";
import { Pill } from "../../components/ui";

export function HealthPills({ project }: { project: AdminProject }) {
  if (project.failedCount === 0 && project.inFlightCount === 0 && project.renderCount === 0) {
    return <Pill tone="neutral">Never rendered</Pill>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {project.failedCount > 0 && <Pill tone="red">{project.failedCount} failed</Pill>}
      {project.inFlightCount > 0 && <Pill tone="blue">{project.inFlightCount} in flight</Pill>}
      {project.failedCount === 0 && project.inFlightCount === 0 && <Pill tone="emerald">Healthy</Pill>}
    </div>
  );
}

export function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-primary">{value}</p>
    </div>
  );
}
