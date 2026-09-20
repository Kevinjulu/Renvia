import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AdminProject, AdminProjectHealth, AdminProjectOrder, AdminProjectSort } from "@renvia/types";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CircleOff,
  Copy,
  FolderKanban,
  ImageIcon,
  MoreHorizontal,
  Search,
  Wallet,
  X,
} from "lucide-react";
import { RenderTable } from "../components/RenderTable";
import { Card, EmptyState, ErrorNote, Pagination, Pill, Skeleton, StatCard } from "../components/ui";
import { PageHero } from "../components/PageHero";
import { useAdminApi } from "../lib/api";
import { formatNumber, formatRelative, formatUsd } from "../lib/format";
import { navForPath } from "../lib/nav";
import { useLoad } from "../lib/useLoad";

const PAGE_SIZE = 25;

type HealthFilter = "" | AdminProjectHealth;

const HEALTH: { value: HealthFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "failures", label: "Has failures" },
  { value: "inflight", label: "In flight" },
  { value: "never", label: "Never rendered" },
  { value: "high_spend", label: "High spend" },
];

const SORTABLE: { key: AdminProjectSort; label: string }[] = [
  { key: "renderCount", label: "Renders" },
  { key: "failedCount", label: "Failures" },
  { key: "spentUsd", label: "Spend" },
  { key: "lastRenderAt", label: "Last render" },
  { key: "updatedAt", label: "Updated" },
];

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

function HealthPills({ project }: { project: AdminProject }) {
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

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <div className="flex flex-wrap gap-1 rounded-xl bg-surface-muted p-1">{children}</div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
        active ? "bg-canvas text-primary shadow-card" : "text-muted hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}

function RowActions({
  project,
  copied,
  onOpen,
  onCopy,
}: {
  project: AdminProject;
  copied: boolean;
  onOpen: () => void;
  onCopy: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex justify-end">
      <button
        type="button"
        aria-label={`Actions for ${project.name}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-primary"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-xl border border-hairline bg-canvas py-1 shadow-lift">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpen();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
            >
              Open detail
            </button>
            <Link
              to={`/users/${project.ownerId}`}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
              onClick={() => setOpen(false)}
            >
              Open owner
            </Link>
            <Link
              to={`/renders?projectId=${project.id}`}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
              onClick={() => setOpen(false)}
            >
              <ImageIcon size={14} /> View renders
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onCopy();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied ID" : "Copy ID"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ProjectDetailDrawer({ projectId, onClose }: { projectId: string; onClose: () => void }) {
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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-primary">{value}</p>
    </div>
  );
}
