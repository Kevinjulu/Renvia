import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search, Shield, ScrollText, UserRound, X } from "lucide-react";
import { EmptyState, ErrorNote, Pagination, Skeleton } from "../components/ui";
import { PageHero } from "../components/PageHero";
import { useAdminApi } from "../lib/api";
import { formatNumber, formatRelative } from "../lib/format";
import { navForPath } from "../lib/nav";
import { useLoad } from "../lib/useLoad";
import { PAGE_SIZE, type ActionFilter, type RangeFilter, ACTIONS, RANGES, groupByDay } from "./audit/helpers";
import { SummaryCell } from "./audit/SummaryCell";
import { FilterPills } from "./audit/parts";
import { AuditRow } from "./audit/AuditRow";

export function AuditPage() {
  const api = useAdminApi();
  const [params, setParams] = useSearchParams();

  const search = params.get("search") ?? "";
  const action = (params.get("action") ?? "") as ActionFilter;
  const actorId = params.get("actorId") ?? "";
  const range = (params.get("range") ?? "") as RangeFilter;
  const offset = Number(params.get("offset") ?? 0);
  const [draft, setDraft] = useState(search);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (draft === search) return;
    const timeout = setTimeout(() => {
      patchParams({ search: draft || undefined, offset: undefined });
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  useEffect(() => {
    setExpanded(null);
  }, [search, action, actorId, range, offset]);

  const patchParams = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (!("offset" in patch)) next.delete("offset");
    setParams(next);
  };

  const { data, error, loading, reload, lastUpdated } = useLoad(
    () =>
      api.listAudit({
        search: search || undefined,
        action: action || undefined,
        actorId: actorId || undefined,
        range: range || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    [api, search, action, actorId, range, offset], 20_000,
  );

  const groups = useMemo(() => groupByDay(data?.events ?? []), [data]);
  const selectedActor = data?.summary.actors.find((actor) => actor.id === actorId);

  return (
    <>
      <PageHero title={navForPath("/audit").title} description={navForPath("/audit").description} image={navForPath("/audit").banner} actions={lastUpdated ? <span className="text-xs text-white/70">Live · updated {formatRelative(lastUpdated.toISOString())}</span> : undefined} />

      {error && !data && <ErrorNote onRetry={reload}>{error}</ErrorNote>}

      {!data ? (
        <div className="space-y-6">
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      ) : (
        <div className={`space-y-6 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}

          {/* Accountability strip — not a StatCard grid */}
          <section className="overflow-hidden rounded-2xl border border-hairline bg-canvas shadow-card">
            <div className="grid gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-4">
              <SummaryCell
                label="Events"
                value={formatNumber(data.summary.total)}
                detail={`${formatNumber(data.summary.last7Days)} in last 7 days`}
                active={!action && !range}
                onClick={() => patchParams({ action: undefined, range: undefined })}
              />
              <SummaryCell
                label="Credits"
                value={formatNumber(data.summary.byAction["credits.adjust"])}
                detail="Grants & removals"
                active={action === "credits.adjust"}
                onClick={() => patchParams({ action: action === "credits.adjust" ? undefined : "credits.adjust" })}
                accent="amber"
              />
              <SummaryCell
                label="Users"
                value={formatNumber(data.summary.byAction["user.update"])}
                detail="Role & disable"
                active={action === "user.update"}
                onClick={() => patchParams({ action: action === "user.update" ? undefined : "user.update" })}
                accent="blue"
              />
              <SummaryCell
                label="Settings"
                value={formatNumber(data.summary.byAction["settings.update"])}
                detail={
                  data.summary.lastSettingsAt ? `Last ${formatRelative(data.summary.lastSettingsAt)}` : "No changes yet"
                }
                active={action === "settings.update"}
                onClick={() => patchParams({ action: action === "settings.update" ? undefined : "settings.update" })}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline px-5 py-3 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5">
                <Shield size={12} />
                {formatNumber(data.summary.uniqueActors)} {data.summary.uniqueActors === 1 ? "operator" : "operators"}
              </span>
              {data.summary.lastSettingsAt && (
                <Link to="/settings" className="hover:text-blueprint">
                  Open settings
                </Link>
              )}
            </div>
          </section>

          {/* Feed */}
          <section className="rounded-2xl border border-hairline bg-canvas shadow-card">
            <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-5 py-4">
              <div className="flex items-center gap-2">
                <ScrollText size={16} className="text-muted" />
                <h2 className="text-sm font-semibold text-primary">
                  {formatNumber(data.total)} {data.total === 1 ? "event" : "events"}
                </h2>
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                  <input
                    type="search"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Search summary, actor, target…"
                    aria-label="Search audit log"
                    className="w-56 rounded-lg border border-hairline bg-surface py-1.5 pl-8 pr-3 text-sm outline-none transition focus:border-blueprint focus:bg-canvas focus:ring-2 focus:ring-blueprint/15"
                  />
                </div>
                <FilterPills
                  options={ACTIONS}
                  value={action}
                  onChange={(value) => patchParams({ action: value || undefined })}
                />
                <FilterPills
                  options={RANGES}
                  value={range}
                  onChange={(value) => patchParams({ range: value || undefined })}
                />
              </div>
            </div>

            {data.summary.actors.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-5 py-3">
                <span className="text-[11px] font-medium uppercase tracking-wide text-faint">Actor</span>
                <button
                  type="button"
                  onClick={() => patchParams({ actorId: undefined })}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                    !actorId ? "border-primary bg-primary text-white" : "border-hairline bg-surface text-secondary hover:text-primary"
                  }`}
                >
                  All
                </button>
                {data.summary.actors.map((actor) => (
                  <button
                    key={actor.id}
                    type="button"
                    onClick={() => patchParams({ actorId: actorId === actor.id ? undefined : actor.id })}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                      actorId === actor.id
                        ? "border-primary bg-primary text-white"
                        : "border-hairline bg-surface text-secondary hover:text-primary"
                    }`}
                  >
                    <UserRound size={11} />
                    {actor.email}
                    <span className={actorId === actor.id ? "text-white/70" : "text-faint"}>{formatNumber(actor.count)}</span>
                  </button>
                ))}
              </div>
            )}

            {(selectedActor || actorId) && (
              <div className="border-b border-hairline px-5 py-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-2.5 py-1 text-xs font-medium text-primary">
                  Actor {selectedActor?.email ?? `${actorId.slice(0, 8)}…`}
                  <button
                    type="button"
                    onClick={() => patchParams({ actorId: undefined })}
                    className="grid h-4 w-4 place-items-center rounded text-muted hover:bg-surface-muted"
                    aria-label="Clear actor filter"
                  >
                    <X size={11} />
                  </button>
                </span>
              </div>
            )}

            {data.events.length === 0 ? (
              <div className="p-5">
                <EmptyState icon={ScrollText}>
                  {search || action || actorId || range
                    ? "No events match these filters."
                    : "No admin actions recorded yet. Adjustments and settings changes will appear here."}
                </EmptyState>
              </div>
            ) : (
              <div>
                {groups.map((group) => (
                  <div key={group.day} className="border-b border-hairline last:border-b-0">
                    <div className="sticky top-0 z-[1] flex items-center justify-between gap-3 bg-surface/95 px-5 py-2 backdrop-blur">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">{group.label}</p>
                      <p className="text-[11px] tabular-nums text-muted">
                        {formatNumber(group.entries.length)} {group.entries.length === 1 ? "event" : "events"}
                      </p>
                    </div>
                    <ul className="relative">
                      <span className="absolute bottom-3 left-[2.15rem] top-3 w-px bg-hairline" aria-hidden="true" />
                      {group.entries.map((event) => (
                        <AuditRow
                          key={event.id}
                          event={event}
                          open={expanded === event.id}
                          onToggle={() => setExpanded((current) => (current === event.id ? null : event.id))}
                          onFilterActor={() => patchParams({ actorId: event.actorId })}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
                <div className="px-5">
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
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
