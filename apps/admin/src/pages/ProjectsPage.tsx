import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AdminProjectOrder, AdminProjectSort } from "@renvia/types";
import { Activity, AlertTriangle, ArrowDown, ArrowUp, CircleOff, FolderKanban, Search, Wallet } from "lucide-react";
import { Card, EmptyState, ErrorNote, Pagination, Skeleton, StatCard } from "../components/ui";
import { PageHero } from "../components/PageHero";
import { useAdminApi } from "../lib/api";
import { formatNumber, formatRelative, formatUsd } from "../lib/format";
import { navForPath } from "../lib/nav";
import { useLoad } from "../lib/useLoad";
import { PAGE_SIZE, type HealthFilter, HEALTH, SORTABLE } from "./projects/helpers";
import { HealthPills, FilterGroup, FilterChip } from "./projects/parts";
import { RowActions } from "./projects/RowActions";
import { ProjectDetailDrawer } from "./projects/ProjectDetailDrawer";

export function ProjectsPage() {
  const api = useAdminApi();
  const [params, setParams] = useSearchParams();

  const search = params.get("search") ?? "";
  const health = (params.get("health") ?? "") as HealthFilter;
  const sort = (params.get("sort") ?? "updatedAt") as AdminProjectSort;
  const order = (params.get("order") ?? "desc") as AdminProjectOrder;
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

  const { data, error, loading, reload } = useLoad(
    () =>
      api.listProjects({
        search: search || undefined,
        health: health || undefined,
        sort,
        order,
        limit: PAGE_SIZE,
        offset,
      }),
    [api, search, health, sort, order, offset],
  );

  const openDetail = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("detail", id);
    setParams(next);
  };

  const toggleSort = (key: AdminProjectSort) => {
    if (sort === key) patchParams({ sort: key, order: order === "asc" ? "desc" : "asc" });
    else patchParams({ sort: key, order: "desc" });
  };

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <PageHero title={navForPath("/projects").title} description={navForPath("/projects").description} image={navForPath("/projects").banner} />

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
            <StatCard label="Total" value={formatNumber(data.summary.total)} icon={FolderKanban} accent="blue" />
            <StatCard
              label="Active"
              value={formatNumber(data.summary.activeLast7Days)}
              icon={Activity}
              accent="emerald"
              detail="Updated or rendered in 7d"
            />
            <StatCard
              label="With failures"
              value={formatNumber(data.summary.withFailures)}
              icon={AlertTriangle}
              accent={data.summary.withFailures > 0 ? "rose" : "neutral"}
            />
            <StatCard
              label="Never rendered"
              value={formatNumber(data.summary.neverRendered)}
              icon={CircleOff}
              accent="neutral"
            />
            <StatCard label="Spend" value={formatUsd(data.summary.spentUsd)} icon={Wallet} accent="amber" detail="Non-failed renders" />
          </div>

          <Card
            icon={FolderKanban}
            title={`${formatNumber(data.total)} ${data.total === 1 ? "project" : "projects"}`}
            actions={
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  type="search"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Search name or owner…"
                  aria-label="Search projects"
                  className="w-64 rounded-xl border border-hairline bg-surface py-2 pl-9 pr-3 text-sm outline-none transition focus:border-blueprint focus:bg-canvas focus:ring-2 focus:ring-blueprint/15"
                />
              </div>
            }
          >
            <div className="mb-4">
              <FilterGroup label="Health">
                {HEALTH.map(({ value, label }) => (
                  <FilterChip key={label} active={health === value} onClick={() => patchParams({ health: value || undefined })}>
                    {label}
                  </FilterChip>
                ))}
              </FilterGroup>
            </div>

            {data.projects.length === 0 ? (
              <EmptyState icon={FolderKanban}>
                {search || health ? "No projects match these filters." : "No projects yet."}
              </EmptyState>
            ) : (
              <>
                <div className="-mx-5 overflow-x-auto">
                  <table className="w-full min-w-[1040px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-hairline text-xs font-medium uppercase tracking-wide text-faint">
                        <th className="px-5 py-3 font-medium">Project</th>
                        <th className="px-5 py-3 font-medium">Owner</th>
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
                        <th className="px-5 py-3 font-medium">Health</th>
                        <th className="px-5 py-3 font-medium">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {data.projects.map((project) => (
                        <tr
                          key={project.id}
                          className={`cursor-pointer transition hover:bg-surface ${detailId === project.id ? "bg-surface" : ""}`}
                          onClick={() => openDetail(project.id)}
                        >
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-3">
                              <span className="block h-11 w-14 shrink-0 overflow-hidden rounded-lg border border-hairline bg-surface-muted">
                                {project.thumbnailUrl ? (
                                  <img src={project.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                                ) : null}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate font-medium text-primary">{project.name}</p>
                                <p className="truncate font-mono text-[11px] text-faint">{project.id.slice(0, 8)}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3" onClick={(event) => event.stopPropagation()}>
                            <Link to={`/users/${project.ownerId}`} className="text-primary hover:text-blueprint">
                              {project.ownerEmail}
                            </Link>
                          </td>
                          <td className="px-5 py-3 tabular-nums">{formatNumber(project.renderCount)}</td>
                          <td className="px-5 py-3 tabular-nums">{formatNumber(project.failedCount)}</td>
                          <td className="px-5 py-3 tabular-nums">{formatUsd(project.spentUsd)}</td>
                          <td className="px-5 py-3 text-muted">{formatRelative(project.lastRenderAt)}</td>
                          <td className="px-5 py-3 text-muted">{formatRelative(project.updatedAt)}</td>
                          <td className="px-5 py-3">
                            <HealthPills project={project} />
                          </td>
                          <td className="px-5 py-3" onClick={(event) => event.stopPropagation()}>
                            <RowActions
                              project={project}
                              copied={copiedId === project.id}
                              onOpen={() => openDetail(project.id)}
                              onCopy={() => void copyId(project.id)}
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
        <ProjectDetailDrawer
          projectId={detailId}
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
