import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AdminSegmentationOrder, AdminSegmentationSort } from "@renvia/types";
import { AlertTriangle, ArrowDown, ArrowUp, Scan, Search, Timer, Wallet, X } from "lucide-react";
import { Card, EmptyState, ErrorNote, Pagination, Pill, Skeleton, StatCard, StatusBadge } from "../components/ui";
import { PageHero } from "../components/PageHero";
import { useAdminApi } from "../lib/api";
import { formatDateTime, formatModel, formatNumber, formatUsd } from "../lib/format";
import { navForPath } from "../lib/nav";
import { useLoad } from "../lib/useLoad";
import { PAGE_SIZE, type StatusFilter, type ModeFilter, STATUSES, MODES, SORTABLE } from "./segmentations/helpers";
import { FilterChip, FilterGroup } from "../components/FilterControls";
import { RowActions } from "./segmentations/RowActions";
import { SegmentationDetailDrawer } from "./segmentations/SegmentationDetailDrawer";

export function SegmentationsPage() {
  const api = useAdminApi();
  const [params, setParams] = useSearchParams();

  const search = params.get("search") ?? "";
  const status = (params.get("status") ?? "") as StatusFilter;
  const mode = (params.get("mode") ?? "") as ModeFilter;
  const stuck = params.get("stuck") === "1";
  const model = params.get("model") ?? "";
  const userId = params.get("userId") ?? "";
  const sort = (params.get("sort") ?? "createdAt") as AdminSegmentationSort;
  const order = (params.get("order") ?? "desc") as AdminSegmentationOrder;
  const offset = Number(params.get("offset") ?? 0);
  const detailId = params.get("detail");

  const [draft, setDraft] = useState(search);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [recoveringId, setRecoveringId] = useState<string | null>(null);

  useEffect(() => {
    if (draft === search) return;
    const timeout = setTimeout(() => {
      patchParams({ search: draft || undefined, offset: undefined });
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const patchParams = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (!("offset" in patch)) next.delete("offset");
    setParams(next);
  };

  const openDetail = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("detail", id);
    setParams(next);
  };

  const { data, error, loading, reload } = useLoad(
    () =>
      api.listSegmentations({
        search: search || undefined,
        status: status || undefined,
        mode: mode || undefined,
        stuck: stuck || undefined,
        model: model || undefined,
        userId: userId || undefined,
        sort,
        order,
        limit: PAGE_SIZE,
        offset,
      }),
    [api, search, status, mode, stuck, model, userId, sort, order, offset],
  );

  const toggleSort = (key: AdminSegmentationSort) => {
    if (sort === key) patchParams({ sort: key, order: order === "asc" ? "desc" : "asc" });
    else patchParams({ sort: key, order: "desc" });
  };

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500);
    } catch {
      /* ignore */
    }
  };
  const recover = async (id: string) => {
    setRecoveringId(id);
    try { await api.recoverSegmentation(id); await reload(); }
    finally { setRecoveringId(null); }
  };

  return (
    <>
      <PageHero title={navForPath("/segmentations").title} description={navForPath("/segmentations").description} image={navForPath("/segmentations").banner} />

      {error && !data && <ErrorNote onRetry={reload}>{error}</ErrorNote>}

      {!data ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-32 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      ) : (
        <div className={`space-y-6 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Total" value={formatNumber(data.summary.total)} icon={Scan} accent="blue" />
            <StatCard
              label="Pending"
              value={formatNumber(data.summary.pending)}
              icon={Timer}
              accent={data.summary.pending > 0 ? "blue" : "neutral"}
            />
            <StatCard
              label="Stuck"
              value={formatNumber(data.summary.stuckCount)}
              icon={AlertTriangle}
              accent={data.summary.stuckCount > 0 ? "rose" : "neutral"}
              detail={`Pending over ${data.summary.stuckTimeoutMinutes}m`}
            />
            <StatCard
              label="Failed"
              value={formatNumber(data.summary.failed)}
              icon={AlertTriangle}
              accent={data.summary.failed > 0 ? "rose" : "neutral"}
            />
            <StatCard label="Spend" value={formatUsd(data.summary.spentUsd)} icon={Wallet} accent="amber" detail="Non-failed" />
          </div>

          <Card
            icon={Scan}
            title={`${formatNumber(data.total)} ${data.total === 1 ? "segmentation" : "segmentations"}`}
            actions={
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  type="search"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Search email, prompt, model…"
                  aria-label="Search segmentations"
                  className="w-72 rounded-xl border border-hairline bg-surface py-2 pl-9 pr-3 text-sm outline-none transition focus:border-blueprint focus:bg-canvas focus:ring-2 focus:ring-blueprint/15"
                />
              </div>
            }
          >
            <div className="mb-4 flex flex-wrap gap-4">
              <FilterGroup label="Status">
                {STATUSES.map(({ value, label }) => (
                  <FilterChip key={label} active={status === value} onClick={() => patchParams({ status: value || undefined })}>
                    {label}
                  </FilterChip>
                ))}
              </FilterGroup>
              <FilterGroup label="Mode">
                {MODES.map(({ value, label }) => (
                  <FilterChip key={label} active={mode === value} onClick={() => patchParams({ mode: value || undefined })}>
                    {label}
                  </FilterChip>
                ))}
              </FilterGroup>
              <FilterGroup label="Health">
                <FilterChip active={!stuck} onClick={() => patchParams({ stuck: undefined })}>
                  All
                </FilterChip>
                <FilterChip active={stuck} onClick={() => patchParams({ stuck: "1" })}>
                  Stuck only
                </FilterChip>
              </FilterGroup>
              {data.summary.models.length > 0 && (
                <FilterGroup label="Model">
                  <FilterChip active={!model} onClick={() => patchParams({ model: undefined })}>
                    All
                  </FilterChip>
                  {data.summary.models.map((entry) => (
                    <FilterChip key={entry.model} active={model === entry.model} onClick={() => patchParams({ model: entry.model })}>
                      {formatModel(entry.model)}
                    </FilterChip>
                  ))}
                </FilterGroup>
              )}
            </div>

            {userId && (
              <div className="mb-4">
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-canvas px-2.5 py-1.5 text-xs font-medium text-primary shadow-card">
                  <Link to={`/users/${userId}`} className="hover:text-blueprint">
                    User {userId.slice(0, 8)}…
                  </Link>
                  <button
                    type="button"
                    onClick={() => patchParams({ userId: undefined })}
                    className="grid h-5 w-5 place-items-center rounded-md text-muted hover:bg-surface-muted"
                    aria-label="Clear user filter"
                  >
                    <X size={12} />
                  </button>
                </span>
              </div>
            )}

            {data.segmentations.length === 0 ? (
              <EmptyState icon={Scan}>
                {search || status || mode || stuck || model || userId ? "No segmentations match these filters." : "No segmentations yet."}
              </EmptyState>
            ) : (
              <>
                <div className="-mx-5 overflow-x-auto">
                  <table className="w-full min-w-[1080px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-hairline text-xs font-medium uppercase tracking-wide text-faint">
                        <th className="px-5 py-3 font-medium">Image</th>
                        <th className="px-5 py-3 font-medium">User</th>
                        <th className="px-5 py-3 font-medium">Selection</th>
                        <th className="px-5 py-3 font-medium">Model</th>
                        {SORTABLE.map((column) => (
                          <th key={column.key} className="px-5 py-3 font-medium">
                            <button
                              type="button"
                              onClick={() => toggleSort(column.key)}
                              className="inline-flex items-center gap-1 transition hover:text-primary"
                            >
                              {column.label}
                              {sort === column.key ? order === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null}
                            </button>
                          </th>
                        ))}
                        <th className="px-5 py-3 font-medium">Status</th>
                        <th className="px-5 py-3 font-medium">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {data.segmentations.map((item) => (
                        <tr
                          key={item.id}
                          className={`cursor-pointer align-top transition hover:bg-surface ${detailId === item.id ? "bg-surface" : ""}`}
                          onClick={() => openDetail(item.id)}
                        >
                          <td className="px-5 py-3">
                            <span className="block h-12 w-16 overflow-hidden rounded-lg border border-hairline bg-surface-muted">
                              <img src={item.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                            </span>
                          </td>
                          <td className="px-5 py-3" onClick={(event) => event.stopPropagation()}>
                            <Link to={`/users/${item.userId}`} className="text-primary hover:text-blueprint">
                              {item.userEmail}
                            </Link>
                          </td>
                          <td className="max-w-[240px] px-5 py-3">
                            <div className="flex items-center gap-1.5">
                              <Pill tone={item.mode === "prompt" ? "blue" : "neutral"}>
                                {item.mode === "prompt" ? "Prompt" : "Click"}
                              </Pill>
                            </div>
                            <p className="mt-1 text-sm text-primary">
                              {item.prompt ? (
                                <span className="line-clamp-2">{item.prompt}</span>
                              ) : item.point ? (
                                <span className="tabular-nums text-muted">
                                  {Math.round(item.point.x)}, {Math.round(item.point.y)}
                                </span>
                              ) : (
                                <span className="text-faint">—</span>
                              )}
                            </p>
                            {item.errorMessage && <p className="mt-1 line-clamp-2 text-xs text-rose-600">{item.errorMessage}</p>}
                          </td>
                          <td className="px-5 py-3 font-mono text-xs text-secondary">{formatModel(item.model)}</td>
                          <td className="whitespace-nowrap px-5 py-3 text-xs text-muted">{formatDateTime(item.createdAt)}</td>
                          <td className="px-5 py-3 tabular-nums">{formatUsd(item.costUsd)}</td>
                          <td className="px-5 py-3 tabular-nums text-muted">{formatNumber(item.creditsCharged)}</td>
                          <td className="px-5 py-3 tabular-nums text-muted">
                            {item.objectCount === null ? "—" : formatNumber(item.objectCount)}
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex flex-wrap gap-1.5">
                              <StatusBadge status={item.status} />
                              {item.stuck && <Pill tone="red">Stuck</Pill>}
                            </div>
                          </td>
                          <td className="px-5 py-3" onClick={(event) => event.stopPropagation()}>
                            <RowActions
                              item={item}
                              copied={copiedId === item.id}
                              onOpen={() => openDetail(item.id)}
                              onCopyId={() => void copyText(item.id, item.id)}
                              onCopyError={item.errorMessage ? () => void copyText(item.id, item.errorMessage!) : undefined}
                              onRecover={(item.status === "failed" || item.stuck) ? () => void recover(item.id) : undefined}
                              recovering={recoveringId === item.id}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  offset={offset}
                  limit={PAGE_SIZE}
                  total={data.total}
                  onChange={(next) => {
                    const nextParams = new URLSearchParams(params);
                    if (next) nextParams.set("offset", String(next));
                    else nextParams.delete("offset");
                    setParams(nextParams);
                  }}
                />
              </>
            )}
          </Card>
        </div>
      )}

      {detailId && (
        <SegmentationDetailDrawer
          segmentationId={detailId}
          onClose={() => {
            const next = new URLSearchParams(params);
            next.delete("detail");
            setParams(next);
          }}
        />
      )}
    </>
  );
}
