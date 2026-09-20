import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  AdminSegmentation,
  AdminSegmentationMode,
  AdminSegmentationOrder,
  AdminSegmentationSort,
  SegmentationStatus,
} from "@renvia/types";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Cpu,
  ImageIcon,
  MoreHorizontal,
  MousePointerClick,
  Scan,
  Search,
  Timer,
  Type,
  Wallet,
  X,
} from "lucide-react";
import { Card, EmptyState, ErrorNote, Pagination, Pill, Skeleton, StatCard, StatusBadge } from "../components/ui";
import { PageHero } from "../components/PageHero";
import { useAdminApi } from "../lib/api";
import { formatDateTime, formatModel, formatNumber, formatUsd } from "../lib/format";
import { navForPath } from "../lib/nav";
import { useLoad } from "../lib/useLoad";

const PAGE_SIZE = 25;

type StatusFilter = "" | SegmentationStatus;
type ModeFilter = "" | AdminSegmentationMode;

const STATUSES: { value: StatusFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending" },
];

const MODES: { value: ModeFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "prompt", label: "Prompt" },
  { value: "click", label: "Click" },
];

const SORTABLE: { key: AdminSegmentationSort; label: string }[] = [
  { key: "createdAt", label: "Created" },
  { key: "costUsd", label: "Cost" },
  { key: "creditsCharged", label: "Credits" },
  { key: "objectCount", label: "Objects" },
];

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
  item,
  copied,
  onOpen,
  onCopyId,
  onCopyError,
}: {
  item: AdminSegmentation;
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
        aria-label={`Actions for segmentation ${item.id.slice(0, 8)}`}
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
              to={`/users/${item.userId}`}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
              onClick={() => setOpen(false)}
            >
              Open user
            </Link>
            <a
              href={item.imageUrl}
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

function SegmentationDetailDrawer({ segmentationId, onClose }: { segmentationId: string; onClose: () => void }) {
  const api = useAdminApi();
  const { data, error, loading, reload } = useLoad(() => api.getSegmentation(segmentationId), [api, segmentationId]);
  const item = data?.segmentation;
  const [copied, setCopied] = useState(false);

  const copyId = async () => {
    if (!item) return;
    try {
      await navigator.clipboard.writeText(item.id);
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
        aria-labelledby="segmentation-detail-title"
        className="relative flex h-full w-full max-w-xl flex-col border-l border-hairline bg-canvas shadow-lift"
      >
        <div className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-faint">Segmentation</p>
            <h2 id="segmentation-detail-title" className="mt-0.5 truncate text-lg font-semibold text-primary">
              {item ? (item.mode === "prompt" ? "Prompt selection" : "Click selection") : "Loading…"}
            </h2>
            {item && <p className="mt-0.5 truncate font-mono text-[11px] text-faint">{item.id}</p>}
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
          {error && !item && <ErrorNote onRetry={reload}>{error}</ErrorNote>}
          {!item && !error && (
            <div className="space-y-4">
              <Skeleton className="h-48 rounded-2xl" />
              <Skeleton className="h-64 rounded-2xl" />
            </div>
          )}
          {item && (
            <div className="space-y-6">
              {error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}

              <a
                href={item.imageUrl}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-xl border border-hairline bg-surface-muted"
              >
                <img src={item.imageUrl} alt="" className="aspect-[4/3] w-full object-cover" />
              </a>

              <div className="flex flex-wrap gap-1.5">
                <StatusBadge status={item.status} />
                <Pill tone={item.mode === "prompt" ? "blue" : "neutral"}>
                  {item.mode === "prompt" ? (
                    <span className="inline-flex items-center gap-1">
                      <Type size={11} /> Prompt
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <MousePointerClick size={11} /> Click
                    </span>
                  )}
                </Pill>
                {item.stuck && <Pill tone="red">Stuck</Pill>}
              </div>

              {item.errorMessage && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700">{item.errorMessage}</div>
              )}

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <DetailField label="User">
                  <Link to={`/users/${item.userId}`} className="text-primary hover:text-blueprint">
                    {item.userEmail}
                  </Link>
                </DetailField>
                <DetailField label="Model">
                  <span className="inline-flex items-center gap-1 font-mono text-xs">
                    <Cpu size={12} /> {formatModel(item.model)}
                  </span>
                </DetailField>
                <DetailField label="Cost">{formatUsd(item.costUsd)}</DetailField>
                <DetailField label="Credits">{formatNumber(item.creditsCharged)}</DetailField>
                <DetailField label="Objects">{item.objectCount === null ? "—" : formatNumber(item.objectCount)}</DetailField>
                <DetailField label="Created">{formatDateTime(item.createdAt)}</DetailField>
                {item.point && (
                  <DetailField label="Click point">
                    <span className="tabular-nums">
                      {Math.round(item.point.x)}, {Math.round(item.point.y)}
                    </span>
                  </DetailField>
                )}
              </dl>

              {item.prompt && (
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">Prompt</p>
                  <p className="whitespace-pre-wrap rounded-xl border border-hairline bg-surface px-3.5 py-3 text-sm text-secondary">
                    {item.prompt}
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Link
                  to={`/users/${item.userId}`}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-white transition hover:bg-ink-800"
                >
                  Open user
                </Link>
                <a
                  href={item.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-canvas px-3.5 py-2 text-sm font-medium text-primary shadow-card transition hover:bg-surface"
                >
                  <ImageIcon size={15} /> Open image
                </a>
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
