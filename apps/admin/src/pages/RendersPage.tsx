import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AdminRenderOrder, AdminRenderSort } from "@renvia/types";
import { Activity, AlertTriangle, ArrowDown, ArrowUp, ImageIcon, Search, Timer, Wallet } from "lucide-react";
import { Card, EmptyState, ErrorNote, Pagination, Pill, Skeleton, StatCard, StatusBadge } from "../components/ui";
import { PageHero } from "../components/PageHero";
import { useAdminApi } from "../lib/api";
import { formatDateTime, formatModel, formatNumber, formatUsd } from "../lib/format";
import { navForPath } from "../lib/nav";
import { useLoad } from "../lib/useLoad";
import { PAGE_SIZE, type StatusFilter, type KindFilter, STATUSES, KINDS, SORTABLE } from "./renders/helpers";
import { FilterGroup, FilterChip, ScopeChip } from "./renders/parts";
import { RowActions } from "./renders/RowActions";
import { RenderDetailDrawer } from "./renders/RenderDetailDrawer";

export function RendersPage() {
  const api = useAdminApi();
  const [params, setParams] = useSearchParams();

  const search = params.get("search") ?? "";
  const status = (params.get("status") ?? "") as StatusFilter;
  const kind = (params.get("kind") ?? "") as KindFilter;
  const stuck = params.get("stuck") === "1";
  const model = params.get("model") ?? "";
  const userId = params.get("userId") ?? "";
  const projectId = params.get("projectId") ?? "";
  const sort = (params.get("sort") ?? "createdAt") as AdminRenderSort;
  const order = (params.get("order") ?? "desc") as AdminRenderOrder;
  const offset = Number(params.get("offset") ?? 0);
  const detailId = params.get("detail");

  const [draft, setDraft] = useState(search);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
      api.listRenders({
        search: search || undefined,
        status: status || undefined,
        kind: kind || undefined,
        stuck: stuck || undefined,
        model: model || undefined,
        userId: userId || undefined,
        projectId: projectId || undefined,
        sort,
        order,
        limit: PAGE_SIZE,
        offset,
      }),
    [api, search, status, kind, stuck, model, userId, projectId, sort, order, offset], 20_000,
  );

  const toggleSort = (key: AdminRenderSort) => {
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

  return (
    <>
      <PageHero title={navForPath("/renders").title} description={navForPath("/renders").description} image={navForPath("/renders").banner} />

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
            <StatCard label="Total" value={formatNumber(data.summary.total)} icon={ImageIcon} accent="blue" />
            <StatCard
              label="In flight"
              value={formatNumber(data.summary.inFlight)}
              icon={Activity}
              accent={data.summary.inFlight > 0 ? "blue" : "neutral"}
              detail={`${data.summary.byStatus.pending} pending · ${data.summary.byStatus.processing} processing`}
            />
            <StatCard
              label="Stuck"
              value={formatNumber(data.summary.stuckCount)}
              icon={Timer}
              accent={data.summary.stuckCount > 0 ? "rose" : "neutral"}
              detail={`Pending/processing over ${data.summary.stuckTimeoutMinutes}m`}
            />
            <StatCard
              label="Failed"
              value={formatNumber(data.summary.failed)}
              icon={AlertTriangle}
              accent={data.summary.failed > 0 ? "rose" : "neutral"}
            />
            <StatCard label="Spend" value={formatUsd(data.summary.spentUsd)} icon={Wallet} accent="amber" detail="Non-failed renders" />
          </div>

          <Card
            icon={ImageIcon}
            title={`${formatNumber(data.total)} ${data.total === 1 ? "render" : "renders"}`}
            actions={
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  type="search"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Search email, project, prompt, model…"
                  aria-label="Search renders"
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
              <FilterGroup label="Kind">
                {KINDS.map(({ value, label }) => (
                  <FilterChip key={label} active={kind === value} onClick={() => patchParams({ kind: value || undefined })}>
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

            {(projectId || userId) && (
              <div className="mb-4 flex flex-wrap gap-2">
                {projectId && (
                  <ScopeChip
                    label={`Project ${projectId.slice(0, 8)}…`}
                    to={`/projects?detail=${projectId}`}
                    onClear={() => patchParams({ projectId: undefined })}
                  />
                )}
                {userId && (
                  <ScopeChip label={`User ${userId.slice(0, 8)}…`} to={`/users/${userId}`} onClear={() => patchParams({ userId: undefined })} />
                )}
              </div>
            )}

            {data.renders.length === 0 ? (
              <EmptyState icon={ImageIcon}>
                {search || status || kind || stuck || model || projectId || userId
                  ? "No renders match these filters."
                  : "No renders yet."}
              </EmptyState>
            ) : (
              <>
                <div className="-mx-5 overflow-x-auto">
                  <table className="w-full min-w-[1100px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-hairline text-xs font-medium uppercase tracking-wide text-faint">
                        <th className="px-5 py-3 font-medium">Image</th>
                        <th className="px-5 py-3 font-medium">User</th>
                        <th className="px-5 py-3 font-medium">Details</th>
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
                      {data.renders.map((render) => (
                        <tr
                          key={render.id}
                          className={`cursor-pointer align-top transition hover:bg-surface ${detailId === render.id ? "bg-surface" : ""}`}
                          onClick={() => openDetail(render.id)}
                        >
                          <td className="px-5 py-3">
                            <span className="block h-12 w-16 overflow-hidden rounded-lg border border-hairline bg-surface-muted">
                              <img
                                src={render.resultImageUrl ?? render.sourceImageUrl}
                                alt=""
                                loading="lazy"
                                className={`h-full w-full object-cover ${render.resultImageUrl ? "" : "opacity-40"}`}
                              />
                            </span>
                          </td>
                          <td className="px-5 py-3" onClick={(event) => event.stopPropagation()}>
                            <Link to={`/users/${render.userId}`} className="text-primary hover:text-blueprint">
                              {render.userEmail}
                            </Link>
                            <p className="text-xs text-faint">{render.projectName}</p>
                          </td>
                          <td className="max-w-[260px] px-5 py-3">
                            <div className="flex items-center gap-1.5">
                              <Pill tone={render.kind === "edit" ? "amber" : "neutral"}>
                                {render.kind === "edit" ? "Edit" : "Render"}
                              </Pill>
                              <span className="truncate text-xs text-muted">
                                {[render.viewLabel, render.style].filter(Boolean).join(" · ")}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs text-secondary" title={render.prompt}>
                              {render.prompt || <span className="text-faint">No prompt</span>}
                            </p>
                            {render.errorMessage && (
                              <p className="mt-1 line-clamp-2 text-xs text-red-600">{render.errorMessage}</p>
                            )}
                          </td>
                          <td className="px-5 py-3 font-mono text-xs text-secondary">{formatModel(render.model)}</td>
                          <td className="whitespace-nowrap px-5 py-3 text-xs text-muted">{formatDateTime(render.createdAt)}</td>
                          <td className="px-5 py-3 tabular-nums">{formatUsd(render.costUsd)}</td>
                          <td className="px-5 py-3 tabular-nums text-muted">{formatNumber(render.creditsCharged)}</td>
                          <td className="px-5 py-3">
                            <div className="flex flex-wrap gap-1.5">
                              <StatusBadge status={render.status} />
                              {render.stuck && <Pill tone="red">Stuck</Pill>}
                            </div>
                          </td>
                          <td className="px-5 py-3" onClick={(event) => event.stopPropagation()}>
                            <RowActions
                              render={render}
                              copied={copiedId === render.id}
                              onOpen={() => openDetail(render.id)}
                              onCopyId={() => void copyText(render.id, render.id)}
                              onCopyError={
                                render.errorMessage ? () => void copyText(render.id, render.errorMessage!) : undefined
                              }
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
        <RenderDetailDrawer
          renderId={detailId}
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
