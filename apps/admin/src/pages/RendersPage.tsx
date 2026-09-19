import { useSearchParams } from "react-router-dom";
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
  const offset = Number(params.get("offset") ?? 0);

  const { data, error, loading, reload } = useLoad(
    () => api.listRenders({ status: status || undefined, limit: PAGE_SIZE, offset }),
    [api, status, offset],
  );

  return (
    <>
      <PageHeader title="Renders" description="Every render and edit, newest first — including failures and their errors." />
      <Card
        title={data ? `${formatNumber(data.total)} ${data.total === 1 ? "render" : "renders"}` : "Renders"}
        actions={
          <div className="flex gap-1 rounded-lg bg-surface-muted p-1" role="group" aria-label="Filter by status">
            {STATUSES.map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={status === option.value}
                onClick={() => setParams(option.value ? { status: option.value } : {})}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  status === option.value ? "bg-canvas text-primary shadow-sm" : "text-muted hover:text-primary"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      >
        {error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}
        {data && data.renders.length === 0 ? (
          <EmptyState>No renders{status ? ` with status “${status}”` : ""}.</EmptyState>
        ) : (
          data && (
            <div className={loading ? "opacity-60 transition-opacity" : ""}>
              <RenderTable renders={data.renders} />
              <Pagination
                offset={offset}
                limit={PAGE_SIZE}
                total={data.total}
                onChange={(next) => setParams({ ...(status ? { status } : {}), ...(next ? { offset: String(next) } : {}) })}
              />
            </div>
          )
        )}
      </Card>
    </>
  );
}
