import { Link } from "react-router-dom";
import type { AdminOverviewResponse } from "@renvia/types";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Coins,
  Cpu,
  FolderKanban,
  ImageIcon,
  Info,
  Scan,
  Settings,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
import { DailyChart } from "../components/DailyChart";
import { Card, EmptyState, ErrorNote, PageHeader, Pill, Skeleton, StatCard } from "../components/ui";
import { useAdminApi } from "../lib/api";
import { formatModel, formatNumber, formatPercent, formatRelative, formatUsd } from "../lib/format";
import { useLoad } from "../lib/useLoad";

const MODE_LABEL = { mock: "Mock (free)", dev: "Dev (cheap model)", prod: "Production" } as const;

export function OverviewPage() {
  const api = useAdminApi();
  const { data, error, loading, reload } = useLoad(() => api.getOverview(), [api]);

  if (error && !data) return <ErrorNote onRetry={reload}>{error}</ErrorNote>;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Usage, spend and pipeline health across the workspace."
        actions={
          data ? (
            <div className="flex flex-wrap gap-2">
              <Link
                to="/renders?status=failed"
                className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-canvas px-3.5 py-2 text-sm font-medium text-primary shadow-card transition hover:border-hairline-strong hover:bg-surface"
              >
                Failed renders
              </Link>
              <Link
                to="/settings"
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-white transition hover:bg-ink-800"
              >
                <Settings size={15} strokeWidth={2} />
                Settings
              </Link>
            </div>
          ) : undefined
        }
      />

      {!data ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-32 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : (
        <div className={`space-y-6 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {data.alerts.length > 0 && <AlertStrip alerts={data.alerts} />}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Users"
              value={formatNumber(data.users.total)}
              icon={Users}
              accent="blue"
              trend={data.users.newLast7Days > 0 ? { value: `${data.users.newLast7Days} this week`, direction: "up" } : undefined}
              detail={data.users.disabled ? `${data.users.disabled} disabled` : "All active"}
            />
            <StatCard
              label="Renders"
              value={formatNumber(data.renders.total)}
              icon={ImageIcon}
              accent="emerald"
              detail={`${formatNumber(data.renders.today)} today`}
            />
            <StatCard
              label="Failure rate"
              value={formatPercent(data.renders.failureRate)}
              icon={AlertTriangle}
              accent={data.renders.failureRate >= 0.1 ? "rose" : "neutral"}
              detail={`${data.renders.byStatus.failed} failed · ${data.renders.byStatus.processing + data.renders.byStatus.pending} in flight`}
            />
            <StatCard
              label="Credits held"
              value={formatNumber(data.credits.outstanding)}
              icon={Coins}
              accent="amber"
              detail={`${formatNumber(data.credits.granted)} granted · ${formatNumber(data.credits.spent)} spent`}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Projects"
              value={formatNumber(data.projects.total)}
              icon={FolderKanban}
              accent="neutral"
              detail={`${formatNumber(data.projects.activeLast7Days)} active this week`}
            />
            <StatCard
              label="Segmentations"
              value={formatNumber(data.segmentations.total)}
              icon={Scan}
              accent="blue"
              detail={`${formatNumber(data.segmentations.today)} today · ${formatUsd(data.segmentations.spentUsd)} spend`}
            />
            <StatCard
              label="In flight"
              value={formatNumber(data.renders.byStatus.processing + data.renders.byStatus.pending)}
              icon={Activity}
              accent={data.renders.stuckCount > 0 ? "rose" : "neutral"}
              detail={
                data.renders.stuckCount > 0
                  ? `${data.renders.stuckCount} stuck over 15m`
                  : `${data.renders.byStatus.processing} processing · ${data.renders.byStatus.pending} pending`
              }
            />
            <StatCard
              label="Seg. failure rate"
              value={formatPercent(data.segmentations.failureRate)}
              icon={Scan}
              accent={data.segmentations.failureRate >= 0.1 ? "rose" : "neutral"}
              detail={`${data.segmentations.byStatus.failed} failed · ${data.segmentations.byStatus.succeeded} succeeded`}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card
              title="fal spend"
              icon={Wallet}
              className="lg:col-span-2"
              actions={<Pill tone={data.spend.mode === "prod" ? "amber" : "neutral"}>{MODE_LABEL[data.spend.mode]}</Pill>}
            >
              <BudgetMeter spent={data.spend.spentUsd} budget={data.spend.budgetUsd} />
            </Card>

            <Card title="Pipeline" icon={Activity}>
              <PipelineHealth byStatus={data.renders.byStatus} stuckCount={data.renders.stuckCount} />
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Renders per day · last 14 days" icon={BarChart3} className="lg:col-span-2">
              {data.daily.every((day) => day.renders === 0) ? (
                <EmptyState icon={BarChart3}>No renders in the last 14 days.</EmptyState>
              ) : (
                <DailyChart days={data.daily} />
              )}
            </Card>

            <Card title="Top users" icon={Trophy}>
              {data.topUsers.length === 0 ? (
                <EmptyState icon={Users}>No renders yet.</EmptyState>
              ) : (
                <ul className="space-y-1">
                  {data.topUsers.map((user, index) => (
                    <li key={user.id}>
                      <Link
                        to={`/users/${user.id}`}
                        className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-surface"
                      >
                        <span
                          className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-bold ${
                            index === 0
                              ? "bg-glow-soft text-[#8a5a17]"
                              : index === 1
                                ? "bg-surface-muted text-secondary"
                                : index === 2
                                  ? "bg-glow-soft/60 text-[#a06a1f]"
                                  : "bg-surface-muted text-faint"
                          }`}
                        >
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-primary">{user.email}</span>
                        <span className="shrink-0 text-right text-xs tabular-nums">
                          <span className="block font-medium text-primary">{formatNumber(user.renders)}</span>
                          <span className="text-faint">{formatUsd(user.spentUsd)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card
              title="Recent failures"
              icon={AlertTriangle}
              className="lg:col-span-2"
              actions={
                <Link to="/renders?status=failed" className="text-xs font-medium text-muted transition hover:text-primary">
                  View all
                </Link>
              }
            >
              {data.recentFailures.length === 0 ? (
                <EmptyState icon={ImageIcon}>No failed renders.</EmptyState>
              ) : (
                <ul className="divide-y divide-hairline">
                  {data.recentFailures.map((failure) => (
                    <li key={failure.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <span className="block h-11 w-14 shrink-0 overflow-hidden rounded-lg border border-hairline bg-surface-muted">
                        <img src={failure.sourceImageUrl} alt="" loading="lazy" className="h-full w-full object-cover opacity-70" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link to={`/users/${failure.userId}`} className="truncate text-sm font-medium text-primary hover:text-blueprint">
                            {failure.userEmail}
                          </Link>
                          <Pill tone={failure.kind === "edit" ? "amber" : "neutral"}>{failure.kind === "edit" ? "Edit" : "Render"}</Pill>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted">{failure.projectName}</p>
                        <p className="mt-1 line-clamp-2 text-xs text-rose-600">{failure.errorMessage || "No error message"}</p>
                      </div>
                      <time className="shrink-0 text-xs text-faint">{formatRelative(failure.createdAt)}</time>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Quick actions" icon={ArrowRight}>
              <ul className="space-y-1">
                <QuickAction to="/settings" label="Engine & budget" detail="Mode, caps, signup bonus" />
                <QuickAction to="/renders?status=failed" label="Triage failures" detail={`${formatNumber(data.renders.byStatus.failed)} failed`} />
                <QuickAction to="/users" label="Manage users" detail="Credits, roles, disable" />
                <QuickAction to="/credits" label="Credit ledger" detail="Grants, spends, refunds" />
                <QuickAction to="/segmentations" label="Segmentations" detail={`${formatNumber(data.segmentations.total)} total`} />
                <QuickAction to="/projects" label="Projects" detail={`${formatNumber(data.projects.total)} total`} />
              </ul>
            </Card>
          </div>

          <Card title="Spend by model" icon={Cpu}>
            {data.spend.byModel.length === 0 ? (
              <EmptyState icon={Cpu}>No spend yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-hairline text-sm">
                {data.spend.byModel.map((row) => (
                  <li key={row.model} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="rounded-md bg-surface-muted px-2 py-1 font-mono text-xs text-secondary">{formatModel(row.model)}</span>
                    <span className="tabular-nums text-muted">
                      {formatNumber(row.renders)} renders · <span className="font-medium text-primary">{formatUsd(row.spentUsd)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function AlertStrip({ alerts }: { alerts: AdminOverviewResponse["alerts"] }) {
  return (
    <ul className="space-y-2" aria-label="Needs attention">
      {alerts.map((alert) => {
        const tone =
          alert.severity === "critical"
            ? "border-rose-200 bg-rose-50 text-rose-800"
            : alert.severity === "warning"
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-hairline bg-canvas text-secondary";
        const Icon = alert.severity === "info" ? Info : AlertTriangle;
        return (
          <li key={alert.id}>
            <Link
              to={alert.href}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm transition hover:opacity-90 ${tone}`}
            >
              <Icon size={16} className="shrink-0" strokeWidth={2} />
              <span className="min-w-0 flex-1 font-medium">{alert.message}</span>
              <ArrowRight size={14} className="shrink-0 opacity-60" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function PipelineHealth({
  byStatus,
  stuckCount,
}: {
  byStatus: AdminOverviewResponse["renders"]["byStatus"];
  stuckCount: number;
}) {
  const total = Object.values(byStatus).reduce((sum, count) => sum + count, 0) || 1;
  const rows: { key: keyof typeof byStatus; label: string; color: string }[] = [
    { key: "succeeded", label: "Succeeded", color: "bg-emerald-500" },
    { key: "failed", label: "Failed", color: "bg-rose-500" },
    { key: "processing", label: "Processing", color: "bg-blueprint" },
    { key: "pending", label: "Pending", color: "bg-faint" },
  ];

  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-muted">
        {rows.map((row) =>
          byStatus[row.key] > 0 ? (
            <div
              key={row.key}
              className={row.color}
              style={{ width: `${(byStatus[row.key] / total) * 100}%` }}
              title={`${row.label}: ${byStatus[row.key]}`}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-4 space-y-2.5">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-secondary">
              <span className={`h-2 w-2 rounded-full ${row.color}`} />
              {row.label}
            </span>
            <span className="tabular-nums font-medium text-primary">{formatNumber(byStatus[row.key])}</span>
          </li>
        ))}
      </ul>
      {stuckCount > 0 && (
        <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
          {stuckCount} stuck over 15 minutes
        </p>
      )}
    </div>
  );
}

function QuickAction({ to, label, detail }: { to: string; label: string; detail: string }) {
  return (
    <li>
      <Link to={to} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-surface">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-primary">{label}</span>
          <span className="block text-xs text-muted">{detail}</span>
        </span>
        <ArrowRight size={14} className="shrink-0 text-faint" />
      </Link>
    </li>
  );
}

function BudgetMeter({ spent, budget }: { spent: number; budget: number }) {
  const ratio = budget > 0 ? Math.min(1, spent / budget) : 1;
  const tone = ratio >= 0.9 ? "bg-rose-500" : ratio >= 0.7 ? "bg-glow" : "bg-accent-sheen";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-2xl font-bold tabular-nums text-primary">
          {formatUsd(spent)} <span className="text-base font-normal text-muted">of {formatUsd(budget)}</span>
        </p>
        <p className="text-sm tabular-nums text-muted">{formatUsd(Math.max(0, budget - spent))} left</p>
      </div>
      <div
        className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-muted"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-valuenow={spent}
        aria-label="fal spend against budget"
      >
        <div className={`h-full rounded-full transition-all duration-500 ${tone}`} style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="mt-2 text-xs text-faint">
        Estimated from model prices. Renders stop with “budget used up” once spend reaches the cap.
      </p>
    </div>
  );
}
