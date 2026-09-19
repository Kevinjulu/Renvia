import { Link, useSearchParams } from "react-router-dom";
import type { SegmentationStatus } from "@renvia/types";
import { Scan } from "lucide-react";
import { Card, EmptyState, ErrorNote, PageHeader, Pagination, StatusBadge, Table } from "../components/ui";
import { useAdminApi } from "../lib/api";
import { formatDateTime, formatModel, formatNumber, formatUsd } from "../lib/format";
import { useLoad } from "../lib/useLoad";

const PAGE_SIZE = 25;

const STATUSES: { value: SegmentationStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending" },
];

export function SegmentationsPage() {
  const api = useAdminApi();
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") ?? "") as SegmentationStatus | "";
  const offset = Number(params.get("offset") ?? 0);

  const { data, error, loading, reload } = useLoad(
    () => api.listSegmentations({ status: status || undefined, limit: PAGE_SIZE, offset }),
    [api, status, offset],
  );

  return (
    <>
      <PageHeader title="Segmentations" description="Automatic selections made while editing a render." />
      <Card
        icon={Scan}
        title={data ? `${formatNumber(data.total)} ${data.total === 1 ? "segmentation" : "segmentations"}` : "Segmentations"}
        actions={
          <div className="flex gap-1 rounded-xl bg-surface-muted p-1" role="group" aria-label="Filter by status">
            {STATUSES.map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={status === option.value}
                onClick={() => setParams(option.value ? { status: option.value } : {})}
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
        {data && data.segmentations.length === 0 ? (
          <EmptyState icon={Scan}>No segmentations{status ? ` with status “${status}”` : ""}.</EmptyState>
        ) : (
          data && (
            <div className={loading ? "opacity-60 transition-opacity" : ""}>
              <Table head={["Image", "User", "Selection", "Model", "Cost", "Status", "Created"]}>
                {data.segmentations.map((item) => (
                  <tr key={item.id} className="align-top transition hover:bg-surface">
                    <td className="px-5 py-3">
                      <a
                        href={item.imageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block h-12 w-16 overflow-hidden rounded-lg border border-hairline bg-surface-muted"
                      >
                        <img src={item.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                      </a>
                    </td>
                    <td className="px-5 py-3">
                      <Link to={`/users/${item.userId}`} className="text-primary hover:text-blueprint">
                        {item.userEmail}
                      </Link>
                    </td>
                    <td className="max-w-[240px] px-5 py-3">
                      <p className="text-sm text-primary">
                        {item.prompt ? (
                          <span className="line-clamp-2">{item.prompt}</span>
                        ) : item.point ? (
                          <span className="tabular-nums text-muted">
                            Click · {Math.round(item.point.x)}, {Math.round(item.point.y)}
                          </span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </p>
                      {item.objectCount !== null && (
                        <p className="mt-1 text-xs text-muted">
                          {formatNumber(item.objectCount)} {item.objectCount === 1 ? "object" : "objects"}
                        </p>
                      )}
                      {item.errorMessage && <p className="mt-1 line-clamp-2 text-xs text-rose-600">{item.errorMessage}</p>}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-secondary">{formatModel(item.model)}</td>
                    <td className="px-5 py-3 tabular-nums">
                      {formatUsd(item.costUsd)}
                      <p className="text-xs text-faint">
                        {item.creditsCharged} {item.creditsCharged === 1 ? "credit" : "credits"}
                      </p>
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-xs text-muted">{formatDateTime(item.createdAt)}</td>
                  </tr>
                ))}
              </Table>
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
