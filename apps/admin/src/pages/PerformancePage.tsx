import { Link, useSearchParams } from "react-router-dom";
import { Activity, AlertTriangle, Clock, Coins, Gauge, Scan } from "lucide-react";
import type { AdminFailureCategory, AdminLatencyStats, AdminPerformanceRange, AdminPerformanceTimeseriesResponse } from "@renvia/types";
import { Card, EmptyState, ErrorNote, Pill, Skeleton, StatCard } from "../components/ui";
import { PageHero } from "../components/PageHero";
import { useAdminApi } from "../lib/api";
import { formatModel, formatNumber, formatPercent, formatRelative, formatUsd } from "../lib/format";
import { navForPath } from "../lib/nav";
import { useLoad } from "../lib/useLoad";

const RANGES: { value: AdminPerformanceRange; label: string }[] = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

const JOB_LABELS: Record<string, string> = {
  photo: "Photo render",
  drawing: "Drawing render",
  references: "Reference render",
  fidelity: "Strict fidelity",
  edit: "Edit",
  "edit-references": "Edit with references",
  upscale: "Upscale",
  selection: "Auto select",
};

const CATEGORY_LABELS: Record<AdminFailureCategory, string> = {
  cancelled: "Cancelled",
  timeout: "Timeout",
  submission: "Never submitted",
  provider_output: "Empty provider result",
  content_policy: "Content policy",
  storage: "Storage",
  invalid_input: "Invalid input",
  provider: "Provider",
  internal: "Internal",
};

/** 850 ms · 12.3 s · 2m 05s */
function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`;
}

/** Measured percentiles when there are any, otherwise the timestamp estimate, marked "~". */
function bestLatency(measured: AdminLatencyStats, estimated: AdminLatencyStats): { stats: AdminLatencyStats; estimated: boolean } {
  return measured.samples > 0 ? { stats: measured, estimated: false } : { stats: estimated, estimated: estimated.samples > 0 };
}

function LatencyCell({ stats, estimated = false }: { stats: AdminLatencyStats; estimated?: boolean }) {
  if (stats.samples === 0) return <span className="text-faint">—</span>;
  const prefix = estimated ? "~" : "";
  return (
    <span title={`${stats.samples} sample${stats.samples === 1 ? "" : "s"}${estimated ? ", estimated from timestamps" : ""}${stats.weak ? " — too few for reliable percentiles" : ""}`}>
      <span className="tabular-nums">{prefix}{formatDuration(stats.p50Ms)}</span>
      <span className="text-faint"> / {prefix}{formatDuration(stats.p95Ms)}</span>
      {stats.weak && <span className="ml-1 text-[10px] font-semibold uppercase text-amber-700">low n</span>}
    </span>
  );
}

export function PerformancePage() {
  const api = useAdminApi();
  const [params, setParams] = useSearchParams();
  const range = (RANGES.some((item) => item.value === params.get("range")) ? params.get("range") : "7d") as AdminPerformanceRange;
  const nav = navForPath("/performance");

  // Recent numbers move quickly; history only needs an occasional refresh.
  const summary = useLoad(() => api.getPerformanceSummary(range), [api, range], 60_000);
  const series = useLoad(() => api.getPerformanceTimeseries(range), [api, range], 300_000);
  const failures = useLoad(() => api.getPerformanceFailures(range), [api, range], 60_000);
  const data = summary.data;

  const setRange = (value: AdminPerformanceRange) => {
    const next = new URLSearchParams(params);
    next.set("range", value);
    setParams(next);
  };

  return (
    <>
      <PageHero
        title={nav.title}
        description={nav.description}
        image={nav.banner}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {summary.lastUpdated && <span className="text-xs text-white/70">Updated {formatRelative(summary.lastUpdated.toISOString())}</span>}
            <div className="inline-flex rounded-xl border border-white/25 bg-white/10 p-0.5 backdrop-blur" role="group" aria-label="Time range">
              {RANGES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={range === item.value}
                  onClick={() => setRange(item.value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${range === item.value ? "bg-white text-ink-950" : "text-white hover:bg-white/15"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {summary.error && !data && <ErrorNote onRetry={summary.reload}>{summary.error}</ErrorNote>}

      {!data ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((key) => <Skeleton key={key} className="h-32 rounded-2xl" />)}</div>
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : (
        <div className={`space-y-6 transition-opacity ${summary.loading ? "opacity-60" : ""}`}>
          {data.coverage.withEvents < data.coverage.total && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {formatNumber(data.coverage.total - data.coverage.withEvents)} of {formatNumber(data.coverage.total)} renders in this range predate lifecycle tracking. Their times are
              estimated from when they were created and last updated, and shown with “~”.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Success rate"
              value={data.totals.successRate === null ? "—" : formatPercent(data.totals.successRate)}
              icon={Activity}
              accent={data.totals.successRate !== null && data.totals.successRate < 0.9 ? "rose" : "emerald"}
              detail={`${formatNumber(data.totals.succeeded)} ok · ${formatNumber(data.totals.failed)} failed · ${formatNumber(data.totals.cancelled)} cancelled`}
            />
            <TimeCard measured={data.totals.endToEnd} estimated={data.totals.estimatedEndToEnd} />
            <StatCard
              label="Cost per result"
              value={data.totals.costPerSuccessUsd === null ? "—" : formatUsd(data.totals.costPerSuccessUsd)}
              icon={Coins}
              accent="amber"
              detail={`${formatUsd(data.totals.generationUsd)} generation · ${formatUsd(data.totals.upscaleUsd)} upscale (estimated)`}
            />
            <StatCard
              label="In flight · upscale failures"
              value={`${formatNumber(data.totals.inFlight)} · ${formatNumber(data.totals.upscaleFailed)}`}
              icon={AlertTriangle}
              accent={data.totals.upscaleFailed > 0 ? "rose" : "neutral"}
              detail="Upscale failures kept their standard result and were refunded"
            />
          </div>

          <Card title="Volume and speed" icon={Clock}>
            {series.data ? <VolumeChart series={series.data} /> : series.error ? <ErrorNote onRetry={series.reload}>{series.error}</ErrorNote> : <Skeleton className="h-40" />}
          </Card>

          <Card title="By job type and model" icon={Gauge} bodyClassName="p-0">
            {data.rows.length === 0 ? (
              <div className="p-5"><EmptyState icon={Gauge}>No renders in this range.</EmptyState></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] text-left text-sm">
                  <caption className="sr-only">Render jobs grouped by job type, output resolution and model. Times are median / 95th percentile.</caption>
                  <thead>
                    <tr className="border-b border-hairline text-xs uppercase tracking-wide text-faint">
                      <th className="px-5 py-3">Job</th>
                      <th className="px-3 py-3">Model</th>
                      <th className="px-3 py-3 text-right">Jobs</th>
                      <th className="px-3 py-3 text-right">Success</th>
                      <th className="px-3 py-3">End to end p50 / p95</th>
                      <th className="px-3 py-3">Provider p50 / p95</th>
                      <th className="px-3 py-3">Upscale p50 / p95</th>
                      <th className="px-3 py-3 text-right">Cost / result</th>
                      <th className="px-5 py-3 text-right">Generation · upscale</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {data.rows.map((row) => {
                      const e2e = bestLatency(row.endToEnd, row.estimatedEndToEnd);
                      return (
                        <tr key={`${row.jobType}|${row.outputResolution}|${row.model}`}>
                          <td className="px-5 py-3">
                            <span className="font-medium text-primary">{JOB_LABELS[row.jobType] ?? row.jobType}</span>
                            {row.outputResolution && <Pill tone="blue">{row.outputResolution.toUpperCase()}</Pill>}
                          </td>
                          <td className="px-3 py-3">
                            <Link to={`/renders?model=${encodeURIComponent(row.model)}`} className="text-blueprint hover:underline">{formatModel(row.model)}</Link>
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">{formatNumber(row.total)}</td>
                          <td className={`px-3 py-3 text-right tabular-nums ${row.successRate !== null && row.successRate < 0.9 ? "text-rose-600" : ""}`}>
                            {row.successRate === null ? "—" : formatPercent(row.successRate)}
                          </td>
                          <td className="px-3 py-3"><LatencyCell stats={e2e.stats} estimated={e2e.estimated} /></td>
                          <td className="px-3 py-3"><LatencyCell stats={row.provider} /></td>
                          <td className="px-3 py-3"><LatencyCell stats={row.upscale} /></td>
                          <td className="px-3 py-3 text-right tabular-nums">{row.costPerSuccessUsd === null ? "—" : formatUsd(row.costPerSuccessUsd)}</td>
                          <td className="px-5 py-3 text-right tabular-nums text-muted">{formatUsd(row.generationUsd)} · {formatUsd(row.upscaleUsd)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Failure groups" icon={AlertTriangle} className="lg:col-span-2" bodyClassName="p-0">
              {failures.error && !failures.data ? (
                <div className="p-5"><ErrorNote onRetry={failures.reload}>{failures.error}</ErrorNote></div>
              ) : !failures.data ? (
                <div className="p-5"><Skeleton className="h-40" /></div>
              ) : failures.data.groups.length === 0 ? (
                <div className="p-5"><EmptyState icon={AlertTriangle}>No failures in this range.</EmptyState></div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 border-b border-hairline px-5 py-3">
                    {failures.data.byCategory.map((row) => (
                      <Pill key={row.category} tone={row.category === "cancelled" ? "neutral" : "red"}>{CATEGORY_LABELS[row.category]} · {formatNumber(row.count)}</Pill>
                    ))}
                  </div>
                  <ul className="divide-y divide-hairline">
                    {failures.data.groups.slice(0, 25).map((group) => (
                      <li key={group.fingerprint} className="flex items-start gap-4 px-5 py-3">
                        <span className="w-10 shrink-0 text-right text-lg font-semibold tabular-nums text-primary">{formatNumber(group.count)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-primary" title={group.message}>{group.message}</span>
                          <span className="mt-0.5 block text-xs text-muted">
                            {CATEGORY_LABELS[group.category]} · {group.source === "upscale" ? "Upscale pass" : JOB_LABELS[group.jobType] ?? group.jobType} · {formatModel(group.model)} ·{" "}
                            {formatNumber(group.affectedUsers)} user{group.affectedUsers === 1 ? "" : "s"} · last {formatRelative(group.lastSeen)}
                          </span>
                        </span>
                        <Link
                          to={`/${group.source === "segmentation" ? "segmentations" : "renders"}?detail=${group.sampleId}`}
                          className="shrink-0 text-xs font-medium text-blueprint hover:underline"
                        >
                          Latest
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>

            <Card title="Auto select" icon={Scan}>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div><dt className="text-muted">Selections</dt><dd className="font-semibold tabular-nums">{formatNumber(data.segmentations.total)}</dd></div>
                <div><dt className="text-muted">Failure rate</dt><dd className="font-semibold tabular-nums">{data.segmentations.failureRate === null ? "—" : formatPercent(data.segmentations.failureRate)}</dd></div>
                <div><dt className="text-muted">Pending</dt><dd className="font-semibold tabular-nums">{formatNumber(data.segmentations.pending)}</dd></div>
                <div><dt className="text-muted">Estimated cost</dt><dd className="font-semibold tabular-nums">{formatUsd(data.segmentations.costUsd)}</dd></div>
              </dl>
              <p className="mt-4 text-xs text-faint">Selections finish inside one request, so they have no separate timing yet.</p>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function TimeCard({ measured, estimated }: { measured: AdminLatencyStats; estimated: AdminLatencyStats }) {
  const best = bestLatency(measured, estimated);
  const prefix = best.estimated ? "~" : "";
  return (
    <StatCard
      label="Time to result · p50"
      value={best.stats.samples ? `${prefix}${formatDuration(best.stats.p50Ms)}` : "—"}
      icon={Clock}
      accent="blue"
      detail={
        best.stats.samples
          ? `p95 ${prefix}${formatDuration(best.stats.p95Ms)} · ${formatNumber(best.stats.samples)} ${best.estimated ? "estimated" : "measured"}${best.stats.weak ? " · few samples" : ""}`
          : "No finished renders"
      }
    />
  );
}

/** Stacked bars of finished jobs per bucket, with the median time underneath each. */
function VolumeChart({ series }: { series: AdminPerformanceTimeseriesResponse }) {
  const max = Math.max(1, ...series.points.map((point) => point.total));
  const label = (iso: string) =>
    series.bucket === "hour"
      ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric" })
      : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const busiest = series.points.reduce((best, point) => (point.total > best.total ? point : best), series.points[0]!);
  const totals = series.points.reduce((sum, point) => ({ total: sum.total + point.total, failed: sum.failed + point.failed }), { total: 0, failed: 0 });

  return (
    <figure>
      <div className="flex h-40 items-end gap-[3px]" aria-hidden="true">
        {series.points.map((point) => {
          const ok = point.total - point.failed;
          return (
            <div
              key={point.start}
              className="flex min-w-0 flex-1 flex-col justify-end"
              title={`${label(point.start)} — ${point.total} jobs, ${point.failed} failed, median ${formatDuration(point.p50Ms)}, ${formatUsd(point.costUsd)}`}
            >
              {point.failed > 0 && <div className="rounded-t-sm bg-rose-400" style={{ height: `${(point.failed / max) * 160}px` }} />}
              {ok > 0 && <div className={`${point.failed > 0 ? "" : "rounded-t-sm"} bg-blueprint`} style={{ height: `${(ok / max) * 160}px` }} />}
              {point.total === 0 && <div className="h-px bg-hairline" />}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-faint">
        <span>{label(series.points[0]!.start)}</span>
        <span>{label(series.points.at(-1)!.start)}</span>
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span><span className="mr-1 inline-block size-2 rounded-sm bg-blueprint" />Finished or running</span>
        <span><span className="mr-1 inline-block size-2 rounded-sm bg-rose-400" />Failed</span>
        <span>
          {formatNumber(totals.total)} jobs, {formatNumber(totals.failed)} failed. Busiest {series.bucket}: {label(busiest.start)} with {formatNumber(busiest.total)}
          {busiest.p50Ms !== null ? `, median ${formatDuration(busiest.p50Ms)}` : ""}.
        </span>
      </figcaption>
    </figure>
  );
}
