import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AdminRender, AdminRenderKind, AdminRenderOrder, AdminRenderSort, RenderStatus } from "@renvia/types";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Cpu,
  FolderKanban,
  ImageIcon,
  MoreHorizontal,
  Search,
  Timer,
  Wallet,
  X,
} from "lucide-react";
import { Card, EmptyState, ErrorNote, PageHeader, Pagination, Pill, Skeleton, StatCard, StatusBadge } from "../components/ui";
import { useAdminApi } from "../lib/api";
import { formatDateTime, formatModel, formatNumber, formatRelative, formatUsd } from "../lib/format";
import { useLoad } from "../lib/useLoad";

const PAGE_SIZE = 25;

type StatusFilter = "" | RenderStatus;
type KindFilter = "" | AdminRenderKind;

const STATUSES: { value: StatusFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "processing", label: "Processing" },
  { value: "pending", label: "Pending" },
];

const KINDS: { value: KindFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "render", label: "Render" },
  { value: "edit", label: "Edit" },
];

const SORTABLE: { key: AdminRenderSort; label: string }[] = [
  { key: "createdAt", label: "Created" },
  { key: "costUsd", label: "Cost" },
  { key: "creditsCharged", label: "Credits" },
];

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
    [api, search, status, kind, stuck, model, userId, projectId, sort, order, offset],
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
      <PageHeader title="Renders" description="Pipeline triage — failures, stuck jobs, spend, and full render detail." />

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
              detail="Pending/processing over 15m"
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

function ScopeChip({ label, to, onClear }: { label: string; to: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-canvas px-2.5 py-1.5 text-xs font-medium text-primary shadow-card">
      <Link to={to} className="hover:text-blueprint">
        {label}
      </Link>
      <button type="button" onClick={onClear} className="grid h-5 w-5 place-items-center rounded-md text-muted hover:bg-surface-muted" aria-label="Clear filter">
        <X size={12} />
      </button>
    </span>
  );
}

function RowActions({
  render,
  copied,
  onOpen,
  onCopyId,
  onCopyError,
}: {
  render: AdminRender;
  copied: boolean;
  onOpen: () => void;
  onCopyId: () => void;
  onCopyError?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex justify-end">
      <button
        type="button"
        aria-label={`Actions for render ${render.id.slice(0, 8)}`}
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
              to={`/users/${render.userId}`}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
              onClick={() => setOpen(false)}
            >
              Open user
            </Link>
            <Link
              to={`/projects?detail=${render.projectId}`}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
              onClick={() => setOpen(false)}
            >
              <FolderKanban size={14} /> Open project
            </Link>
            <a
              href={render.resultImageUrl ?? render.sourceImageUrl}
              target="_blank"
              rel="noreferrer"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
              onClick={() => setOpen(false)}
            >
              <ImageIcon size={14} /> Open image
            </a>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onCopyId();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy ID"}
            </button>
            {onCopyError && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onCopyError();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
              >
                <Copy size={14} /> Copy error
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function RenderDetailDrawer({ renderId, onClose }: { renderId: string; onClose: () => void }) {
  const api = useAdminApi();
  const { data, error, loading, reload } = useLoad(() => api.getRender(renderId), [api, renderId]);
  const render = data?.render;
  const [copied, setCopied] = useState(false);

  const copyId = async () => {
    if (!render) return;
    try {
      await navigator.clipboard.writeText(render.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink-950/40 backdrop-blur-sm">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close detail" onClick={onClose} />
      <aside
        role="dialog"
        aria-labelledby="render-detail-title"
        className="relative flex h-full w-full max-w-xl flex-col border-l border-hairline bg-canvas shadow-lift"
      >
        <div className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-faint">Render</p>
            <h2 id="render-detail-title" className="mt-0.5 truncate text-lg font-semibold text-primary">
              {render ? (render.kind === "edit" ? "Edit" : "Render") : "Loading…"}
            </h2>
            {render && <p className="mt-0.5 truncate font-mono text-[11px] text-faint">{render.id}</p>}
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
          {error && !render && <ErrorNote onRetry={reload}>{error}</ErrorNote>}
          {!render && !error && (
            <div className="space-y-4">
              <Skeleton className="h-40 rounded-2xl" />
              <Skeleton className="h-64 rounded-2xl" />
            </div>
          )}
          {render && (
            <div className="space-y-6">
              {error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}

              <div className="grid grid-cols-2 gap-3">
                <a
                  href={render.sourceImageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-xl border border-hairline bg-surface-muted"
                >
                  <img src={render.sourceImageUrl} alt="" className="aspect-[4/3] w-full object-cover" />
                  <p className="px-2.5 py-1.5 text-[11px] font-medium text-muted">Source</p>
                </a>
                <a
                  href={render.resultImageUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className={`block overflow-hidden rounded-xl border border-hairline bg-surface-muted ${render.resultImageUrl ? "" : "pointer-events-none"}`}
                >
                  {render.resultImageUrl ? (
                    <img src={render.resultImageUrl} alt="" className="aspect-[4/3] w-full object-cover" />
                  ) : (
                    <div className="grid aspect-[4/3] place-items-center text-xs text-faint">No result</div>
                  )}
                  <p className="px-2.5 py-1.5 text-[11px] font-medium text-muted">Result</p>
                </a>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <StatusBadge status={render.status} />
                <Pill tone={render.kind === "edit" ? "amber" : "neutral"}>{render.kind === "edit" ? "Edit" : "Render"}</Pill>
                {render.stuck && <Pill tone="red">Stuck</Pill>}
              </div>

              {render.errorMessage && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700">
                  {render.errorMessage}
                </div>
              )}

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <DetailField label="User">
                  <Link to={`/users/${render.userId}`} className="text-primary hover:text-blueprint">
                    {render.userEmail}
                  </Link>
                </DetailField>
                <DetailField label="Project">
                  <Link to={`/projects?detail=${render.projectId}`} className="text-primary hover:text-blueprint">
                    {render.projectName}
                  </Link>
                </DetailField>
                <DetailField label="Model">
                  <span className="inline-flex items-center gap-1 font-mono text-xs">
                    <Cpu size={12} /> {formatModel(render.model)}
                  </span>
                </DetailField>
                <DetailField label="Resolution">{render.resolution}</DetailField>
                <DetailField label="Style">{render.style}</DetailField>
                <DetailField label="View">{render.viewLabel || "—"}</DetailField>
                <DetailField label="Cost">{formatUsd(render.costUsd)}</DetailField>
                <DetailField label="Credits">{formatNumber(render.creditsCharged)}</DetailField>
                <DetailField label="Created">{formatDateTime(render.createdAt)}</DetailField>
                <DetailField label="Updated">{formatRelative(render.updatedAt)}</DetailField>
                <DetailField label="fal request">
                  <span className="break-all font-mono text-xs">{render.falRequestId || "—"}</span>
                </DetailField>
              </dl>

              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">Prompt</p>
                <p className="whitespace-pre-wrap rounded-xl border border-hairline bg-surface px-3.5 py-3 text-sm text-secondary">
                  {render.prompt || "No prompt"}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Link
                  to={`/users/${render.userId}`}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-white transition hover:bg-ink-800"
                >
                  Open user
                </Link>
                <Link
                  to={`/projects?detail=${render.projectId}`}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-canvas px-3.5 py-2 text-sm font-medium text-primary shadow-card transition hover:bg-surface"
                >
                  Open project
                </Link>
                <button
                  type="button"
                  onClick={() => void copyId()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-canvas px-3.5 py-2 text-sm font-medium text-primary shadow-card transition hover:bg-surface"
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  {copied ? "Copied ID" : "Copy ID"}
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface px-3 py-2.5">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-1 text-primary">{children}</dd>
    </div>
  );
}
