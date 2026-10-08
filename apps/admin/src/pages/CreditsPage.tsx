import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AdminCreditOrder, AdminCreditSort } from "@renvia/types";
import { ArrowDown, ArrowDownRight, ArrowUp, ArrowUpRight, Search, Wallet, X } from "lucide-react";
import { EmptyState, ErrorNote, Pagination, Skeleton } from "../components/ui";
import { PageHero } from "../components/PageHero";
import { useAdminApi } from "../lib/api";
import { formatCreditReason } from "../lib/labels";
import { formatNumber } from "../lib/format";
import { navForPath } from "../lib/nav";
import { useLoad } from "../lib/useLoad";
import { PAGE_SIZE, type ReasonFilter, type DirectionFilter, DIRECTIONS, SORTABLE, groupByDay, reasonBarColor, reasonDotColor } from "./credits/helpers";
import { FlowStat } from "./credits/FlowStat";
import { LedgerRow } from "./credits/LedgerRow";

export function CreditsPage() {
  const api = useAdminApi();
  const [params, setParams] = useSearchParams();

  const search = params.get("search") ?? "";
  const reason = (params.get("reason") ?? "") as ReasonFilter;
  const direction = (params.get("direction") ?? "") as DirectionFilter;
  const userId = params.get("userId") ?? "";
  const sort = (params.get("sort") ?? "createdAt") as AdminCreditSort;
  const order = (params.get("order") ?? "desc") as AdminCreditOrder;
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
  }, [search, reason, direction, userId, sort, order, offset]);

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
      api.listCredits({
        search: search || undefined,
        reason: reason || undefined,
        direction: direction || undefined,
        userId: userId || undefined,
        sort,
        order,
        limit: PAGE_SIZE,
        offset,
      }),
    [api, search, reason, direction, userId, sort, order, offset],
  );

  const groups = useMemo(() => groupByDay(data?.entries ?? []), [data]);

  const flowTotal = (data?.summary.granted ?? 0) + (data?.summary.spent ?? 0) || 1;
  const grantedShare = ((data?.summary.granted ?? 0) / flowTotal) * 100;
  const spentShare = ((data?.summary.spent ?? 0) / flowTotal) * 100;

  return (
    <>
      <PageHero title={navForPath("/credits").title} description={navForPath("/credits").description} image={navForPath("/credits").banner} />

      {error && !data && <ErrorNote onRetry={reload}>{error}</ErrorNote>}

      {!data ? (
        <div className="space-y-6">
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      ) : (
        <div className={`space-y-6 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}

          {/* Flow hero — one composition, not a StatCard grid */}
          <section className="overflow-hidden rounded-2xl border border-hairline bg-canvas shadow-card">
            <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="border-b border-hairline p-6 lg:border-b-0 lg:border-r">
                <p className="text-[11px] font-medium uppercase tracking-wide text-faint">Outstanding balances</p>
                <p className="mt-3 font-display text-4xl font-bold tabular-nums tracking-tight text-primary">
                  {formatNumber(data.summary.outstanding)}
                </p>
                <p className="mt-2 text-sm text-muted">Credits currently held across all users</p>

                <div className="mt-6">
                  <div className="flex h-3 overflow-hidden rounded-full bg-surface-muted">
                    {data.summary.granted > 0 && (
                      <div className="bg-emerald-500" style={{ width: `${grantedShare}%` }} title={`Granted: ${data.summary.granted}`} />
                    )}
                    {data.summary.spent > 0 && (
                      <div className="bg-[#c45c26]" style={{ width: `${spentShare}%` }} title={`Spent: ${data.summary.spent}`} />
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                    <span className="inline-flex items-center gap-1.5 text-emerald-700">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      Granted {formatNumber(data.summary.granted)}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[#8a3d14]">
                      <span className="h-2 w-2 rounded-full bg-[#c45c26]" />
                      Spent {formatNumber(data.summary.spent)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-px bg-hairline">
                <FlowStat
                  label="Credits in"
                  value={formatNumber(data.summary.granted)}
                  icon={ArrowDownRight}
                  tone="in"
                  active={direction === "in"}
                  onClick={() => patchParams({ direction: direction === "in" ? undefined : "in" })}
                />
                <FlowStat
                  label="Credits out"
                  value={formatNumber(data.summary.spent)}
                  icon={ArrowUpRight}
                  tone="out"
                  active={direction === "out"}
                  onClick={() => patchParams({ direction: direction === "out" ? undefined : "out" })}
                />
                <FlowStat
                  label="Net · 7 days"
                  value={`${data.summary.netLast7Days > 0 ? "+" : ""}${formatNumber(data.summary.netLast7Days)}`}
                  tone={data.summary.netLast7Days >= 0 ? "in" : "out"}
                  className="col-span-2"
                />
              </div>
            </div>
          </section>

          {/* Reason mix — clickable breakdown, not chip row clone */}
          {data.summary.byReason.length > 0 && (
            <section className="rounded-2xl border border-hairline bg-canvas p-5 shadow-card">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-faint">By reason</p>
                {reason && (
                  <button type="button" onClick={() => patchParams({ reason: undefined })} className="text-xs font-medium text-muted hover:text-primary">
                    Clear reason
                  </button>
                )}
              </div>
              <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-surface-muted">
                {(() => {
                  const totalWeight = data.summary.byReason.reduce((sum, item) => sum + Math.max(Math.abs(item.totalAmount), item.count), 0) || 1;
                  return data.summary.byReason.map((row) => {
                    const weight = Math.max(Math.abs(row.totalAmount), row.count);
                    const share = (weight / totalWeight) * 100;
                    return (
                      <button
                        key={row.reason}
                        type="button"
                        title={`${formatCreditReason(row.reason)}: ${row.count}`}
                        onClick={() => patchParams({ reason: reason === row.reason ? undefined : row.reason })}
                        className={`transition ${reason && reason !== row.reason ? "opacity-30" : ""} ${reasonBarColor(row.reason)}`}
                        style={{ width: `${Math.max(share, 2)}%` }}
                      />
                    );
                  });
                })()}
              </div>
              <ul className="mt-4 flex flex-wrap gap-2">
                {data.summary.byReason.map((row) => (
                  <li key={row.reason}>
                    <button
                      type="button"
                      onClick={() => patchParams({ reason: reason === row.reason ? undefined : row.reason })}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition ${
                        reason === row.reason
                          ? "border-primary bg-primary text-white"
                          : "border-hairline bg-surface text-secondary hover:border-hairline-strong hover:text-primary"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${reasonDotColor(row.reason)}`} />
                      {formatCreditReason(row.reason)}
                      <span className={reason === row.reason ? "text-white/70" : "text-faint"}>{formatNumber(row.count)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Ledger feed */}
          <section className="rounded-2xl border border-hairline bg-canvas shadow-card">
            <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-5 py-4">
              <div className="flex items-center gap-2">
                <Wallet size={16} className="text-muted" />
                <h2 className="text-sm font-semibold text-primary">
                  {formatNumber(data.total)} {data.total === 1 ? "entry" : "entries"}
                </h2>
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                  <input
                    type="search"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Search user, note, actor…"
                    aria-label="Search ledger"
                    className="w-56 rounded-lg border border-hairline bg-surface py-1.5 pl-8 pr-3 text-sm outline-none transition focus:border-blueprint focus:bg-canvas focus:ring-2 focus:ring-blueprint/15"
                  />
                </div>
                <div className="flex gap-1 rounded-lg bg-surface-muted p-0.5">
                  {DIRECTIONS.map(({ value, label }) => (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={direction === value}
                      onClick={() => patchParams({ direction: value || undefined })}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                        direction === value ? "bg-canvas text-primary shadow-card" : "text-muted hover:text-primary"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1 rounded-lg bg-surface-muted p-0.5">
                  {SORTABLE.map((column) => (
                    <button
                      key={column.key}
                      type="button"
                      onClick={() => {
                        if (sort === column.key) patchParams({ sort: column.key, order: order === "asc" ? "desc" : "asc" });
                        else patchParams({ sort: column.key, order: "desc" });
                      }}
                      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                        sort === column.key ? "bg-canvas text-primary shadow-card" : "text-muted hover:text-primary"
                      }`}
                    >
                      {column.label}
                      {sort === column.key ? order === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} /> : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {userId && (
              <div className="border-b border-hairline px-5 py-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-2.5 py-1 text-xs font-medium text-primary">
                  <Link to={`/users/${userId}`} className="hover:text-blueprint">
                    User {userId.slice(0, 8)}…
                  </Link>
                  <button
                    type="button"
                    onClick={() => patchParams({ userId: undefined })}
                    className="grid h-4 w-4 place-items-center rounded text-muted hover:bg-surface-muted"
                    aria-label="Clear user filter"
                  >
                    <X size={11} />
                  </button>
                </span>
              </div>
            )}

            {data.entries.length === 0 ? (
              <div className="p-5">
                <EmptyState icon={Wallet}>
                  {search || reason || direction || userId ? "No ledger entries match these filters." : "No credit activity yet."}
                </EmptyState>
              </div>
            ) : (
              <div>
                {groups.map((group) => (
                  <div key={group.day} className="border-b border-hairline last:border-b-0">
                    <div className="sticky top-0 z-[1] flex items-center justify-between gap-3 bg-surface/95 px-5 py-2 backdrop-blur">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">{group.label}</p>
                      <p className="text-[11px] tabular-nums text-muted">
                        Net{" "}
                        <span className={group.net >= 0 ? "text-emerald-700" : "text-[#8a3d14]"}>
                          {group.net > 0 ? "+" : ""}
                          {formatNumber(group.net)}
                        </span>
                      </p>
                    </div>
                    <ul>
                      {group.entries.map((entry) => (
                        <LedgerRow
                          key={entry.id}
                          entry={entry}
                          open={expanded === entry.id}
                          onToggle={() => setExpanded((current) => (current === entry.id ? null : entry.id))}
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
