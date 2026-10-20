import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { thumbnailUrl, type AdminOverviewResponse } from "@renvia/types";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Coins,
  Cpu,
  Gauge as GaugeIcon,
  HardDrive,
  ImageIcon,
  Info,
  RefreshCw,
  ShieldAlert,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
import { AreaChart, CHART, Donut, Gauge, HBar, Sparkline } from "../components/charts";
import { Card, EmptyState, ErrorNote, Pill, Skeleton } from "../components/ui";
import { useAdmin } from "../lib/useAdmin";
import { useAdminApi } from "../lib/api";
import { formatCreditReason } from "../lib/labels";
import { formatModel, formatNumber, formatPercent, formatRelative, formatUsd } from "../lib/format";
import { ADMIN_NAV } from "../lib/nav";
import { useLoad } from "../lib/useLoad";

const MODE_LABEL = { mock: "Mock (free)", dev: "Dev (cheap model)", prod: "Production" } as const;
const CORE_POLL_MS = 30_000;
const LIGHT_POLL_MS = 2 * 60_000;
const HEAVY_POLL_MS = 5 * 60_000;

type Days = 7 | 14 | 30;
const RANGES: { days: Days; label: string }[] = [
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
];

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const formatBytes = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(bytes >= 1e8 ? 0 : 1)} MB`);

/**
 * Loads one Overview section on its own schedule. A role without access never makes the request,
 * and a section that fails shows its own error without blanking the page.
 */
function useSection<T>(allowed: boolean, load: () => Promise<T>, pollMs: number) {
  const state = useLoad<T | null>(() => (allowed ? load() : Promise.resolve(null)), [allowed], allowed ? pollMs : 0);
  return state;
}

export function OverviewPage() {
  const api = useAdminApi();
  const me = useAdmin();
  const can = (path: string) => ADMIN_NAV.find((item) => item.to === path)?.roles.includes(me.role as never) ?? false;
  const [days, setDays] = useState<Days>(14);

  const core = useLoad(() => api.getOverview(), [api], CORE_POLL_MS);
  const financials = useSection(can("/financials"), api.getFinancials, HEAVY_POLL_MS);
  const billing = useSection(can("/billing"), api.getBilling, HEAVY_POLL_MS);
  const incidents = useSection(can("/incidents"), () => api.getIncidents(), LIGHT_POLL_MS);
  const approvals = useSection(can("/approvals"), api.listApprovals, LIGHT_POLL_MS);
  const security = useSection(can("/security"), api.getSecurityOverview, HEAVY_POLL_MS);
  const performance = useSection(can("/performance"), () => api.getPerformanceSummary("7d"), HEAVY_POLL_MS);
  const failures = useSection(can("/performance"), () => api.getPerformanceFailures("7d"), HEAVY_POLL_MS);
  const credits = useSection(can("/credits"), () => api.listCredits({ limit: 8 }), LIGHT_POLL_MS);

  const reloadAll = () => {
    for (const section of [core, financials, billing, incidents, approvals, security, performance, failures, credits]) section.reload();
  };

  const data = core.data;
  if (core.error && !data) return <ErrorNote onRetry={core.reload}>{core.error}</ErrorNote>;

  return (
    <div className="-mx-1">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold leading-tight tracking-tight text-primary">Overview</h1>
          <p className="mt-0.5 flex items-center gap-2 text-xs text-muted">
            <span className="relative flex h-2 w-2" aria-hidden="true"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
            Live · {core.lastUpdated ? `updated ${formatRelative(core.lastUpdated.toISOString())}` : "loading"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Date range" className="inline-flex rounded-xl border border-hairline bg-canvas p-0.5">
            {RANGES.map((range) => (
              <button key={range.days} type="button" aria-pressed={days === range.days} onClick={() => setDays(range.days)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${days === range.days ? "bg-ink-950 text-white" : "text-muted hover:text-primary"}`}>{range.label}</button>
            ))}
          </div>
          <button type="button" onClick={reloadAll} className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-canvas px-3 py-2 text-xs font-medium text-secondary transition hover:text-primary" aria-label="Refresh all sections">
            <RefreshCw size={13} className={core.loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </header>

      {!data ? <OverviewSkeleton /> : (
        <div className={`space-y-4 transition-opacity ${core.loading ? "opacity-70" : ""}`}>
          {data.alerts.length > 0 && <AlertChips alerts={data.alerts} />}

          <KpiRow data={data} days={days} revenue={financials.data} />

          <div className="grid gap-4 xl:grid-cols-12">
            <Card title="Trends" icon={BarChart3} className="xl:col-span-8" actions={<span className="text-xs text-faint">Last {days} days · UTC</span>}>
              <MainChart data={data} days={days} financials={financials.data} financialsError={financials.error} />
            </Card>
            <div className="xl:col-span-4"><LivePanel data={data} /></div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Card title="Pipeline" icon={Activity} actions={<Link to="/renders" className="text-xs font-medium text-muted hover:text-primary">Renders</Link>}>
              <Pipeline data={data} />
            </Card>
            <Card title="Spend by model" icon={Cpu} actions={<span className="text-xs text-faint">All time</span>}>
              {data.spend.byModel.length === 0 ? <EmptyState icon={Cpu}>No spend yet.</EmptyState> : (
                <HBar rows={data.spend.byModel.slice(0, 7).map((row) => ({ label: formatModel(row.model), value: row.spentUsd, display: formatUsd(row.spentUsd), detail: `${formatNumber(row.renders)} renders` }))} />
              )}
            </Card>
            {can("/security") ? (
              <Card title="Signups vs held" icon={ShieldAlert} actions={<Link to="/security" className="text-xs font-medium text-muted hover:text-primary">Security</Link>} className="md:col-span-2 xl:col-span-1">
                <SecurityPanel state={security} days={days} />
              </Card>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <NeedsYou
              incidents={incidents.data} approvals={approvals.data} billing={billing.data} security={security.data}
              errors={[incidents.error, approvals.error, billing.error].filter(Boolean) as string[]}
              show={{ incidents: can("/incidents"), approvals: can("/approvals"), billing: can("/billing"), security: can("/security") }}
            />
            {can("/performance") && (
              <Card title="Latency & failures" icon={GaugeIcon} actions={<span className="text-xs text-faint">Last 7 days</span>}>
                <PerformancePanel summary={performance} failures={failures} />
              </Card>
            )}
            <div className="space-y-4 md:col-span-2 xl:col-span-1">
              <Card title="Storage" icon={HardDrive} actions={<Link to="/settings" className="text-xs font-medium text-muted hover:text-primary">Cap</Link>}>
                <StoragePanel storage={data.storage} />
              </Card>
              <Card title="Top users" icon={Trophy}>
                <TopUsers users={data.topUsers} />
              </Card>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-12">
            <Card title="Recent failures" icon={AlertTriangle} className="xl:col-span-7" actions={<Link to="/renders?status=failed" className="text-xs font-medium text-muted hover:text-primary">View all</Link>}>
              <RecentFailures failures={data.recentFailures} />
            </Card>
            {can("/credits") && (
              <Card title="Recent credit activity" icon={Coins} className="xl:col-span-5" actions={<Link to="/credits" className="text-xs font-medium text-muted hover:text-primary">Ledger</Link>}>
                {credits.error && !credits.data ? <ErrorNote onRetry={credits.reload}>{credits.error}</ErrorNote> : !credits.data ? <Skeleton className="h-40" /> : credits.data.entries.length === 0 ? <EmptyState icon={Coins}>No credit activity yet.</EmptyState> : (
                  <ul className="divide-y divide-hairline">
                    {credits.data.entries.map((entry) => (
                      <li key={entry.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                        <span className={`w-12 shrink-0 text-right text-sm font-semibold tabular-nums ${entry.amount >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{entry.amount > 0 ? "+" : ""}{formatNumber(entry.amount)}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm text-primary">{formatCreditReason(entry.reason)}</span><Link to={`/users/${entry.userId}`} className="block truncate text-xs text-muted hover:text-blueprint">{entry.userEmail}</Link></span>
                        <time className="shrink-0 text-xs text-faint">{formatRelative(entry.createdAt)}</time>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-32 rounded-2xl" />)}</div>
      <div className="grid gap-4 xl:grid-cols-12"><Skeleton className="h-80 rounded-2xl xl:col-span-8" /><Skeleton className="h-80 rounded-2xl xl:col-span-4" /></div>
      <div className="grid gap-4 md:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-64 rounded-2xl" />)}</div>
    </div>
  );
}

function AlertChips({ alerts }: { alerts: AdminOverviewResponse["alerts"] }) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Needs attention">
      {alerts.map((alert) => {
        const tone = alert.severity === "critical" ? "border-rose-200 bg-rose-50 text-rose-800" : alert.severity === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-hairline bg-canvas text-secondary";
        const Icon = alert.severity === "info" ? Info : AlertTriangle;
        return (
          <li key={alert.id} className="min-w-0 max-w-full">
            <Link to={alert.href} title={alert.message} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition hover:opacity-90 ${tone}`}>
              <Icon size={14} className="shrink-0" strokeWidth={2} />
              <span className="min-w-0 truncate">{alert.message}</span>
              <ArrowRight size={12} className="shrink-0 opacity-60" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// ── KPI row ────────────────────────────────────────────────────────────────────

function Delta({ current, previous, invert = false }: { current: number; previous: number; invert?: boolean }) {
  if (previous <= 0 && current <= 0) return <span className="text-xs text-faint">no change</span>;
  if (previous <= 0) return <span className="text-xs text-faint">new</span>;
  const change = (current - previous) / previous;
  if (Math.abs(change) < 0.005) return <span className="text-xs text-faint">flat vs prior</span>;
  const up = change > 0;
  const good = invert ? !up : up;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${good ? "text-emerald-600" : "text-rose-500"}`}><Arrow size={13} aria-hidden="true" />{Math.abs(Math.round(change * 100))}%<span className="sr-only"> {up ? "up" : "down"} versus the prior period</span></span>;
}

function Kpi({ label, value, detail, delta, spark, color }: { label: string; value: ReactNode; detail?: ReactNode; delta?: ReactNode; spark?: number[]; color?: string }) {
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-hairline bg-canvas p-4 shadow-card">
      <p className="truncate text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <div className="mt-2 flex items-baseline gap-2"><p className="text-[26px] font-bold leading-none tabular-nums tracking-tight text-primary">{value}</p>{delta}</div>
      <div className="mt-2 min-h-[32px]">{spark && <Sparkline values={spark} color={color} />}</div>
      {detail && <p className="mt-1.5 truncate text-xs text-muted">{detail}</p>}
    </div>
  );
}

function windowed(data: AdminOverviewResponse, days: Days) {
  const current = data.daily.slice(-days);
  // 7- and 14-day windows compare with the days just before them; 30 uses the server's prior 30.
  const previous = days === 30 ? null : data.daily.slice(-days * 2, -days);
  const total = (pick: (day: AdminOverviewResponse["daily"][number]) => number) => sum(current.map(pick));
  const before = (pick: (day: AdminOverviewResponse["daily"][number]) => number, key: keyof AdminOverviewResponse["previousPeriod"]) => (previous ? sum(previous.map(pick)) : data.previousPeriod[key]);
  return { current, total, before };
}

function KpiRow({ data, days, revenue }: { data: AdminOverviewResponse; days: Days; revenue: import("@renvia/types").AdminFinancialsResponse | null }) {
  const { current, total, before } = windowed(data, days);
  const renders = total((day) => day.renders);
  const spend = total((day) => day.spentUsd);
  const signups = total((day) => day.signups);
  const success = 1 - data.renders.failureRate;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      <Kpi label="Customers" value={formatNumber(data.users.total)} delta={<Delta current={signups} previous={before((day) => day.signups, "signups")} />} spark={current.map((day) => day.signups)} detail={`${formatNumber(signups)} new in ${days}d${data.users.disabled ? ` · ${data.users.disabled} disabled` : ""}`} />
      <Kpi label={`Renders · ${days}d`} value={formatNumber(renders)} delta={<Delta current={renders} previous={before((day) => day.renders, "renders")} />} spark={current.map((day) => day.renders)} color={CHART.emerald} detail={`${formatNumber(data.renders.today)} today · ${formatNumber(data.renders.total)} all time`} />
      <Kpi label="Success rate" value={data.renders.byStatus.succeeded + data.renders.byStatus.failed > 0 ? formatPercent(success) : "—"} detail={`${data.renders.byStatus.failed} failed · ${data.renders.byStatus.processing + data.renders.byStatus.pending} in flight`} color={success < 0.9 ? CHART.rose : CHART.emerald} spark={undefined} />
      {revenue ? (
        <Kpi label="Net revenue · 30d" value={formatUsd(revenue.revenue.netUsd)} spark={revenue.daily.map((day) => day.revenueUsd - day.refundsUsd)} color={CHART.emerald} detail={`MRR ${formatUsd(revenue.revenue.mrrUsd)}`} />
      ) : (
        <Kpi label={`Segmentations · ${days}d`} value={formatNumber(total((day) => day.segmentations))} delta={<Delta current={total((day) => day.segmentations)} previous={before((day) => day.segmentations, "segmentations")} />} spark={current.map((day) => day.segmentations)} detail={`${formatPercent(data.segmentations.failureRate)} failure rate`} />
      )}
      <Kpi label={`fal spend · ${days}d`} value={formatUsd(spend)} delta={<Delta current={spend} previous={before((day) => day.spentUsd, "spentUsd")} invert />} spark={current.map((day) => day.spentUsd)} color={CHART.amber} detail={`${formatUsd(data.spend.spentUsd)} of ${formatUsd(data.spend.budgetUsd)} budget`} />
      <Kpi label="Credits held" value={formatNumber(data.credits.outstanding)} detail={`${formatNumber(data.credits.grantedLast7Days)} granted · ${formatNumber(data.credits.spentLast7Days)} used this week`} />
    </div>
  );
}

// ── Main chart ─────────────────────────────────────────────────────────────────

type Tab = "renders" | "spend" | "signups" | "revenue";

function MainChart({ data, days, financials, financialsError }: { data: AdminOverviewResponse; days: Days; financials: import("@renvia/types").AdminFinancialsResponse | null; financialsError: string | null }) {
  const [tab, setTab] = useState<Tab>("renders");
  const slice = data.daily.slice(-days);
  const tabs: { id: Tab; label: string }[] = [
    { id: "renders", label: "Renders" },
    { id: "spend", label: "fal spend" },
    { id: "signups", label: "Signups" },
    ...(financials || financialsError ? [{ id: "revenue" as const, label: "Revenue vs cost" }] : []),
  ];
  const active = tabs.some((item) => item.id === tab) ? tab : "renders";
  const labels = slice.map((day) => day.date);
  const money = (value: number) => (value >= 100 ? `$${Math.round(value)}` : formatUsd(value));
  const count = (value: number) => formatNumber(Math.round(value));

  const content = useMemo(() => {
    if (active === "revenue") {
      const rows = (financials?.daily ?? []).slice(-days);
      return { days: rows.map((row) => row.day), series: [
        { name: "Revenue", color: CHART.emerald, values: rows.map((row) => row.revenueUsd), format: money },
        { name: "Estimated fal cost", color: CHART.amber, values: rows.map((row) => row.estimatedCostUsd), format: money },
      ], caption: `Revenue and estimated cost per day, last ${days} days` };
    }
    if (active === "spend") return { days: labels, series: [{ name: "fal spend", color: CHART.amber, values: slice.map((day) => day.spentUsd), format: money }], caption: `fal spend per day, last ${days} days` };
    if (active === "signups") return { days: labels, series: [{ name: "Signups", color: CHART.blue, values: slice.map((day) => day.signups), format: count }], caption: `Signups per day, last ${days} days` };
    return { days: labels, series: [
      { name: "Renders", color: CHART.blue, values: slice.map((day) => day.renders), format: count },
      { name: "Segmentations", color: CHART.grey, values: slice.map((day) => day.segmentations), format: count },
    ], caption: `Renders and segmentations per day, last ${days} days` };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, days, data.daily, financials]);

  return (
    <div>
      <div role="tablist" aria-label="Chart" className="mb-3 flex flex-wrap gap-1">
        {tabs.map((item) => <button key={item.id} role="tab" type="button" aria-selected={active === item.id} onClick={() => setTab(item.id)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${active === item.id ? "bg-blueprint-soft text-blueprint" : "text-muted hover:text-primary"}`}>{item.label}</button>)}
      </div>
      {active === "revenue" && !financials ? <ErrorNote>{financialsError ?? "Loading financials…"}</ErrorNote> : content.series.every((item) => item.values.every((value) => value === 0)) ? <EmptyState icon={BarChart3}>Nothing recorded in this period.</EmptyState> : <AreaChart days={content.days} series={content.series} caption={content.caption} />}
    </div>
  );
}

// ── Live panel ─────────────────────────────────────────────────────────────────

function LivePanel({ data }: { data: AdminOverviewResponse }) {
  const ratio = data.spend.budgetUsd > 0 ? data.spend.spentUsd / data.spend.budgetUsd : 0;
  const fal = data.falAccount;
  const lowBalance = fal.status === "ok" && fal.balanceUsd !== null && fal.balanceUsd < 5;
  return (
    <Card title="Live now" icon={Users} className="h-full" actions={<Pill tone={data.spend.mode === "prod" ? "amber" : "neutral"}>{MODE_LABEL[data.spend.mode]}</Pill>}>
      <div className="grid grid-cols-3 gap-2 text-center">
        <LiveStat label="Now" value={data.users.activeNow} tone="text-emerald-700" />
        <LiveStat label="1 hour" value={data.users.activeLastHour} tone="text-blueprint" />
        <LiveStat label="24 hours" value={data.users.activeLast24Hours} tone="text-primary" />
      </div>
      {data.activity.activeNow.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {data.activity.activeNow.slice(0, 5).map((user) => <li key={user.id}><Link to={`/users/${user.id}`} className="flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs transition hover:bg-emerald-100"><span className="truncate font-medium text-emerald-900">{user.email}</span><span className="shrink-0 text-emerald-700">{formatRelative(user.lastActiveAt)}</span></Link></li>)}
        </ul>
      ) : <p className="mt-3 text-xs text-muted">No signed-in customers in the last five minutes.</p>}

      <div className="mt-4 border-t border-hairline pt-4">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted"><Wallet size={13} aria-hidden="true" /> Tracked fal budget</div>
        <div className="flex flex-col items-center"><Gauge ratio={ratio} warning={data.spend.budgetWarningPercent / 100} critical={data.spend.budgetCriticalPercent / 100} label="fal spend against budget" /></div>
        <p className="-mt-1 text-center text-xs text-muted tabular-nums">{formatUsd(data.spend.spentUsd)} of {formatUsd(data.spend.budgetUsd)} · {formatUsd(Math.max(0, data.spend.budgetUsd - data.spend.spentUsd))} left</p>
        <p className={`mt-2 text-center text-xs ${lowBalance ? "font-semibold text-rose-700" : "text-muted"}`}>
          {fal.status === "ok" ? `fal balance ${fal.balanceUsd === null ? "—" : formatUsd(fal.balanceUsd)} · billed ${formatUsd(fal.spentLast30DaysUsd)} in 30d` : fal.status === "error" ? "fal billing unavailable" : "fal balance not configured"}
        </p>
      </div>
    </Card>
  );
}

function LiveStat({ label, value, text, tone }: { label: string; value?: number; text?: string; tone: string }) {
  return <div className="rounded-xl border border-hairline bg-surface px-2 py-2.5"><p className={`text-xl font-bold tabular-nums ${tone}`}>{text ?? formatNumber(value ?? 0)}</p><p className="mt-0.5 text-[11px] text-muted">{label}</p></div>;
}

// ── Panels ─────────────────────────────────────────────────────────────────────

function Pipeline({ data }: { data: AdminOverviewResponse }) {
  const { byStatus, stuckCount, stuckTimeoutMinutes, total } = data.renders;
  const slices = [
    { label: "Succeeded", value: byStatus.succeeded, color: CHART.emerald },
    { label: "Failed", value: byStatus.failed, color: CHART.rose },
    { label: "Processing", value: byStatus.processing, color: CHART.blue },
    { label: "Pending", value: byStatus.pending, color: CHART.grey },
  ];
  return (
    <div>
      <div className="flex items-center gap-5">
        <Donut slices={slices} centerLabel="renders" centerValue={formatNumber(total)} />
        <ul className="min-w-0 flex-1 space-y-2">
          {slices.map((slice) => <li key={slice.label} className="flex items-center justify-between gap-2 text-sm"><span className="flex items-center gap-2 text-secondary"><span className="h-2 w-2 rounded-full" style={{ background: slice.color }} aria-hidden="true" />{slice.label}</span><span className="font-medium tabular-nums text-primary">{formatNumber(slice.value)}</span></li>)}
        </ul>
      </div>
      {stuckCount > 0 && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{stuckCount} stuck over {stuckTimeoutMinutes} minutes</p>}
      <p className="mt-3 text-xs text-muted">Segmentations: {formatNumber(data.segmentations.byStatus.succeeded)} done · {formatNumber(data.segmentations.byStatus.failed)} failed · {formatNumber(data.segmentations.byStatus.pending)} pending</p>
    </div>
  );
}

function SecurityPanel({ state, days }: { state: ReturnType<typeof useSection<import("@renvia/types").AdminSecurityOverview>>; days: Days }) {
  if (state.error && !state.data) return <ErrorNote onRetry={state.reload}>{state.error}</ErrorNote>;
  if (!state.data) return <Skeleton className="h-48" />;
  // Security keeps 14 days; a 30-day Overview range shows all it has.
  const rows = state.data.daily.slice(-Math.min(days, 14));
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
        <span><b className="tabular-nums text-primary">{formatNumber(state.data.heldFreeAccounts)}</b> held free accounts</span>
        <span><b className="tabular-nums text-primary">{formatNumber(state.data.statuses.review_required)}</b> awaiting review</span>
      </div>
      {rows.every((row) => row.signups === 0) ? <EmptyState icon={ShieldAlert}>No signup checks in this period.</EmptyState> : (
        <AreaChart days={rows.map((row) => row.date)} caption="Signup checks and held accounts per day" series={[
          { name: "Signups", color: CHART.blue, values: rows.map((row) => row.signups), format: (value) => formatNumber(Math.round(value)) },
          { name: "Held", color: CHART.rose, values: rows.map((row) => row.held), format: (value) => formatNumber(Math.round(value)) },
        ]} />
      )}
    </div>
  );
}

function NeedsYou({ incidents, approvals, billing, security, errors, show }: {
  incidents: import("@renvia/types").AdminIncidentsResponse | null;
  approvals: import("@renvia/types").AdminApprovalsResponse | null;
  billing: import("@renvia/types").AdminBillingResponse | null;
  security: import("@renvia/types").AdminSecurityOverview | null;
  errors: string[];
  show: { incidents: boolean; approvals: boolean; billing: boolean; security: boolean };
}) {
  const rows: { to: string; label: string; value: number; detail?: string; hot?: boolean }[] = [];
  if (show.incidents && incidents) {
    rows.push({ to: "/incidents", label: "Open incidents", value: incidents.summary.open, detail: incidents.summary.criticalOpen ? `${incidents.summary.criticalOpen} critical` : undefined, hot: incidents.summary.criticalOpen > 0 });
    rows.push({ to: "/incidents", label: "Failed notifications", value: incidents.summary.failedNotifications, hot: incidents.summary.failedNotifications > 0 });
  }
  if (show.approvals && approvals) rows.push({ to: "/approvals", label: "Approvals waiting", value: approvals.open.length, hot: approvals.open.length > 0 });
  if (show.billing && billing) {
    rows.push({ to: "/billing", label: "Failed webhooks", value: billing.summary.failedWebhooks, hot: billing.summary.failedWebhooks > 0 });
    rows.push({ to: "/billing", label: "Pending webhooks", value: billing.summary.pendingWebhooks });
  }
  if (show.security && security) rows.push({ to: "/security", label: "Free accounts awaiting review", value: security.statuses.review_required, hot: security.statuses.review_required > 0 });
  const syncedAt = incidents?.sync.lastSuccessAt;
  return (
    <Card title="Needs you" icon={Bell}>
      {rows.length === 0 ? (errors.length ? <ErrorNote>{errors[0]!}</ErrorNote> : <Skeleton className="h-40" />) : (
        <ul className="divide-y divide-hairline">
          {rows.map((row) => (
            <li key={row.label}>
              <Link to={row.to} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-surface">
                <span className={`min-w-8 rounded-md px-2 py-0.5 text-center text-sm font-bold tabular-nums ${row.hot ? "bg-rose-50 text-rose-700" : "bg-surface-muted text-secondary"}`}>{formatNumber(row.value)}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm text-primary">{row.label}</span>{row.detail && <span className="block text-xs text-rose-600">{row.detail}</span>}</span>
                <ArrowRight size={13} className="shrink-0 text-faint" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {show.incidents && incidents && <p className="mt-3 text-xs text-faint">Incident sync last succeeded {formatRelative(syncedAt ?? null)}.</p>}
    </Card>
  );
}

const ms = (value: number | null | undefined) => (value == null ? "—" : value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`);

function PerformancePanel({ summary, failures }: { summary: ReturnType<typeof useSection<import("@renvia/types").AdminPerformanceSummaryResponse>>; failures: ReturnType<typeof useSection<import("@renvia/types").AdminPerformanceFailuresResponse>> }) {
  if (summary.error && !summary.data) return <ErrorNote onRetry={summary.reload}>{summary.error}</ErrorNote>;
  if (!summary.data) return <Skeleton className="h-48" />;
  const totals = summary.data.totals;
  // Older renders have no lifecycle events, so fall back to the estimated timing for them.
  const latency = totals.endToEnd.samples > 0 ? totals.endToEnd : totals.estimatedEndToEnd;
  const categories = (failures.data?.byCategory ?? []).slice().sort((a, b) => b.count - a.count).slice(0, 5);
  return (
    <div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <LiveStat label="p50" text={ms(latency.p50Ms)} tone="text-primary" />
        <LiveStat label="p95" text={ms(latency.p95Ms)} tone="text-primary" />
        <LiveStat label="Success" text={totals.successRate === null ? "—" : formatPercent(totals.successRate)} tone={totals.successRate !== null && totals.successRate < 0.9 ? "text-rose-700" : "text-emerald-700"} />
      </div>
      <p className="mb-3 mt-2 text-xs text-faint">{formatNumber(latency.samples)} timed jobs · {formatNumber(totals.total)} total</p>
      {failures.error && !failures.data ? <ErrorNote onRetry={failures.reload}>{failures.error}</ErrorNote> : categories.length === 0 ? <p className="text-xs text-muted">No failures in this period.</p> : (
        <HBar color={CHART.rose} rows={categories.map((row) => ({ label: row.category.replace(/_/g, " "), value: row.count, display: formatNumber(row.count) }))} />
      )}
    </div>
  );
}

function StoragePanel({ storage }: { storage: AdminOverviewResponse["storage"] }) {
  const ratio = storage.capBytes > 0 ? storage.usedBytes / storage.capBytes : 0;
  const kinds = Object.entries(storage.byKind).filter(([, bytes]) => bytes > 0).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <div className="flex flex-col items-center"><Gauge ratio={ratio} warning={0.7} critical={0.9} label="Image storage against cap" size={150} /></div>
      <p className="-mt-1 text-center text-xs tabular-nums text-muted">{formatBytes(storage.usedBytes)} of {formatBytes(storage.capBytes)} · {formatNumber(storage.objects)} files</p>
      {kinds.length > 0 && <p className="mt-2 text-center text-xs text-faint">{kinds.map(([kind, bytes]) => `${kind} ${formatBytes(bytes)}`).join(" · ")}</p>}
    </div>
  );
}

function TopUsers({ users }: { users: AdminOverviewResponse["topUsers"] }) {
  if (users.length === 0) return <EmptyState icon={Users}>No renders yet.</EmptyState>;
  return (
    <ul className="space-y-1">
      {users.map((user, index) => (
        <li key={user.id}>
          <Link to={`/users/${user.id}`} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-1.5 transition hover:bg-surface">
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-bold ${index === 0 ? "bg-glow-soft text-[#8a5a17]" : "bg-surface-muted text-secondary"}`}>{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-primary">{user.email}</span>
            <span className="shrink-0 text-right text-xs tabular-nums"><span className="block font-medium text-primary">{formatNumber(user.renders)}</span><span className="text-faint">{formatUsd(user.spentUsd)}</span></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function RecentFailures({ failures }: { failures: AdminOverviewResponse["recentFailures"] }) {
  if (failures.length === 0) return <EmptyState icon={ImageIcon}>No failed renders.</EmptyState>;
  return (
    <ul className="divide-y divide-hairline">
      {failures.map((failure) => (
        <li key={failure.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
          <span className="block h-11 w-14 shrink-0 overflow-hidden rounded-lg border border-hairline bg-surface-muted"><img src={thumbnailUrl(failure.sourceImageUrl)} alt="" loading="lazy" className="h-full w-full object-cover opacity-70" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/users/${failure.userId}`} className="truncate text-sm font-medium text-primary hover:text-blueprint">{failure.userEmail}</Link>
              <Pill tone={failure.kind === "edit" ? "amber" : "neutral"}>{failure.kind === "edit" ? "Edit" : "Render"}</Pill>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted">{failure.projectName}</p>
            <p className="mt-1 line-clamp-2 text-xs text-rose-600">{failure.errorMessage || "No error message"}</p>
          </div>
          <time className="shrink-0 text-xs text-faint">{formatRelative(failure.createdAt)}</time>
        </li>
      ))}
    </ul>
  );
}
