import { Link } from "react-router-dom";
import { AlertTriangle, ImageIcon, X } from "lucide-react";
import { RenderTable } from "../../components/RenderTable";
import { EmptyState, ErrorNote, Skeleton } from "../../components/ui";
import { useAdminApi } from "../../lib/api";
import { formatNumber, formatRelative, formatUsd } from "../../lib/format";
import { useLoad } from "../../lib/useLoad";
import { HealthPills, MiniStat } from "./parts";

export function ProjectDetailDrawer({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const api = useAdminApi();
  const { data, error, loading, reload } = useLoad(() => api.getProject(projectId), [api, projectId]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink-950/40 backdrop-blur-sm">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close detail" onClick={onClose} />
      <aside
        role="dialog"
        aria-labelledby="project-detail-title"
        className="relative flex h-full w-full max-w-xl flex-col border-l border-hairline bg-canvas shadow-lift"
      >
        <div className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-faint">Project</p>
            <h2 id="project-detail-title" className="mt-0.5 truncate text-lg font-semibold text-primary">
              {data?.project.name ?? "Loading…"}
            </h2>
            {data && (
              <p className="mt-0.5 truncate font-mono text-[11px] text-faint">{data.project.id}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-muted"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className={`flex-1 overflow-y-auto px-5 py-5 ${loading ? "opacity-60" : ""}`}>
          {error && !data && <ErrorNote onRetry={reload}>{error}</ErrorNote>}
          {!data && !error && (
            <div className="space-y-4">
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-64 rounded-2xl" />
            </div>
          )}
          {data && (
            <div className="space-y-6">
              {error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}

              <div className="flex items-start gap-4">
                <span className="block h-20 w-28 shrink-0 overflow-hidden rounded-xl border border-hairline bg-surface-muted">
                  {data.project.thumbnailUrl ? (
                    <img src={data.project.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </span>
                <div className="min-w-0 space-y-2">
                  <p className="text-sm text-muted">
                    Owner{" "}
                    <Link to={`/users/${data.project.ownerId}`} className="font-medium text-primary hover:text-blueprint">
                      {data.project.ownerEmail}
                    </Link>
                  </p>
                  <HealthPills project={data.project} />
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    <span>Created {formatRelative(data.project.createdAt)}</span>
                    <span>Updated {formatRelative(data.project.updatedAt)}</span>
                    <span>Last render {formatRelative(data.project.lastRenderAt)}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MiniStat label="Renders" value={formatNumber(data.project.renderCount)} />
                <MiniStat label="Failures" value={formatNumber(data.project.failedCount)} />
                <MiniStat label="In flight" value={formatNumber(data.project.inFlightCount)} />
                <MiniStat label="Spend" value={formatUsd(data.project.spentUsd)} />
              </div>

              <div className="flex flex-wrap gap-2">
                <Link
                  to={`/renders?projectId=${data.project.id}`}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-canvas px-3.5 py-2 text-sm font-medium text-primary shadow-card transition hover:border-hairline-strong hover:bg-surface"
                >
                  <ImageIcon size={15} /> All renders
                </Link>
                {data.project.failedCount > 0 && (
                  <Link
                    to={`/renders?projectId=${data.project.id}&status=failed`}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-canvas px-3.5 py-2 text-sm font-medium text-primary shadow-card transition hover:border-hairline-strong hover:bg-surface"
                  >
                    <AlertTriangle size={15} /> Failed only
                  </Link>
                )}
                <Link
                  to={`/users/${data.project.ownerId}`}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-white transition hover:bg-ink-800"
                >
                  Open owner
                </Link>
              </div>

              <div>
                <h3 className="mb-3 text-sm font-semibold text-primary">Recent renders</h3>
                {data.renders.length === 0 ? (
                  <EmptyState icon={ImageIcon}>No renders in this project.</EmptyState>
                ) : (
                  <div className="-mx-5">
                    <RenderTable renders={data.renders} showUser={false} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
