import { Link, useSearchParams } from "react-router-dom";
import { ImageIcon, X } from "lucide-react";
import type { RenderStatus } from "@renvia/types";
import { RenderTable } from "../components/RenderTable";
import { Card, EmptyState, ErrorNote, PageHeader, Pagination } from "../components/ui";
import { useAdminApi } from "../lib/api";
import { formatNumber } from "../lib/format";
import { useLoad } from "../lib/useLoad";

const PAGE_SIZE = 25;
const STATUSES: { value: RenderStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "processing", label: "Processing" },
  { value: "pending", label: "Pending" },
];

export function RendersPage() {
  const api = useAdminApi();
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") ?? "") as RenderStatus | "";
  const projectId = params.get("projectId") ?? "";
  const offset = Number(params.get("offset") ?? 0);

  const { data, error, loading, reload } = useLoad(
    () =>
      api.listRenders({
        status: status || undefined,
        projectId: projectId || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    [api, status, projectId, offset],
  );

  const patchParams = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (!("offset" in patch)) next.delete("offset");
    setParams(next);
  };

  return (
    <>
      <PageHeader
        title="Renders"
        description="Every render and edit, newest first — including failures and their errors."
        actions={
          projectId ? (
            <button
              type="button"
              onClick={() => patchParams({ projectId: undefined })}
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-canvas px-3 py-2 text-sm font-medium text-primary shadow-card transition hover:bg-surface"
            >
              Project {projectId.slice(0, 8)}…
              <X size={14} />
            </button>
          ) : undefined
        }
      />
      <Card
        icon={ImageIcon}
        title={data ? `${formatNumber(data.total)} ${data.total === 1 ? "render" : "renders"}` : "Renders"}
        actions={
          <div className="flex gap-1 rounded-xl bg-surface-muted p-1" role="group" aria-label="Filter by status">
            {STATUSES.map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={status === option.value}
                onClick={() => patchParams({ status: option.value || undefined })}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  status === option.value ? "bg-canvas text-primary shadow-card" : "text-muted hover:text-primary"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      >
        {error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}
        {projectId && (
          <p className="mb-3 text-sm text-muted">
            Filtered to project{" "}
            <Link to={`/projects?detail=${projectId}`} className="font-medium text-primary hover:text-blueprint">
              {projectId.slice(0, 8)}…
            </Link>
          </p>
        )}
        {data && data.renders.length === 0 ? (
          <EmptyState icon={ImageIcon}>
            No renders{status ? ` with status “${status}”` : ""}
            {projectId ? " for this project" : ""}.
          </EmptyState>
        ) : (
          data && (
            <div className={loading ? "opacity-60 transition-opacity" : ""}>
              <RenderTable renders={data.renders} />
              <Pagination
                offset={offset}
                limit={PAGE_SIZE}
                total={data.total}
                onChange={(next) => patchParams({ offset: next ? String(next) : undefined })}
              />
            </div>
          )
        )}
      </Card>
    </>
  );
}
