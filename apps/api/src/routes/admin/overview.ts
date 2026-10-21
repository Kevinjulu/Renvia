import { Hono } from "hono";
import { and, asc, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { schema } from "@renvia/db";
import type { AdminOverviewResponse, RenderStatus } from "@renvia/types";
import { getSettings, effectiveBudgetUsd, effectiveEngineMode } from "../../lib/settings.js";
import { effectiveMaintenance } from "../../lib/studioControl.js";
import { BYTES_PER_MB, storageUsage } from "../../lib/storage.js";
import { falAccount } from "../../lib/falAccount.js";
import { denyUnless } from "./permissions.js";
import { MICROS_PER_USD, stuckBeforeSql, selectAdminRenders, toAdminRender, creditFlow, balanceBreakdown } from "./shared.js";
import type { AdminContext } from "./context.js";

export const overviewRoutes = new Hono<AdminContext>();

const lastWeek = creditFlow(sql`now() - interval '7 days'`, "Last7Days");

overviewRoutes.get("/overview", async (c) => {
  const denied = denyUnless(c, "overview.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const settings = await getSettings(db);
  const startOfToday = sql`date_trunc('day', now() at time zone 'utc') at time zone 'utc'`;

  const [
    [users],
    statusRows,
    [today],
    modelRows,
    [credits],
    dailyRows,
    topRows,
    [stuck],
    [projects],
    segStatusRows,
    [segToday],
    [segSpend],
    failureRows,
    activeNowRows,
  ] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        newLast7Days: sql<number>`count(*) filter (where ${schema.users.createdAt} >= now() - interval '7 days')::int`,
        activeNow: sql<number>`count(*) filter (where ${schema.users.role} = 'user' and not ${schema.users.disabled} and ${schema.users.lastActiveAt} >= now() - interval '5 minutes')::int`,
        activeLastHour: sql<number>`count(*) filter (where ${schema.users.role} = 'user' and not ${schema.users.disabled} and ${schema.users.lastActiveAt} >= now() - interval '1 hour')::int`,
        activeLast24Hours: sql<number>`count(*) filter (where ${schema.users.role} = 'user' and not ${schema.users.disabled} and ${schema.users.lastActiveAt} >= now() - interval '24 hours')::int`,
        activeLast7Days: sql<number>`count(*) filter (where ${schema.users.role} = 'user' and not ${schema.users.disabled} and ${schema.users.lastActiveAt} >= now() - interval '7 days')::int`,
        disabled: sql<number>`count(*) filter (where ${schema.users.disabled})::int`,
        ...balanceBreakdown(),
      })
      .from(schema.users),
    db
      .select({ status: schema.renders.status, count: sql<number>`count(*)::int` })
      .from(schema.renders)
      .groupBy(schema.renders.status),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.renders)
      .where(gte(schema.renders.createdAt, startOfToday)),
    db
      .select({
        model: sql<string>`coalesce(${schema.renders.model}, 'unknown')`,
        renders: sql<number>`count(*)::int`,
        spentMicros: sql<number>`coalesce(sum(${schema.renders.costMicros}), 0)::bigint`,
      })
      .from(schema.renders)
      .where(ne(schema.renders.status, "failed"))
      .groupBy(schema.renders.model)
      .orderBy(desc(sql`sum(${schema.renders.costMicros})`)),
    db
      .select({
        ...creditFlow(),
        grantedLast7Days: lastWeek.granted,
        spentLast7Days: lastWeek.spent,
      })
      .from(schema.creditLedger),
    // 60 days in one query: the newest 30 are returned as `daily`, the 30 before them
    // are only summed into `previousPeriod` so the page can show period-over-period deltas.
    db.execute<{ date: string; renders: number; spent_micros: string; segmentations: number; signups: number }>(sql`
      with days as (
        select day::date as d
        from generate_series((now() at time zone 'utc')::date - 59, (now() at time zone 'utc')::date, interval '1 day') as day
      ),
      r as (
        select (created_at at time zone 'utc')::date as d, count(*)::int as renders, coalesce(sum(cost_micros), 0)::bigint as spent_micros
        from renders where created_at >= (now() at time zone 'utc')::date - 59 group by 1
      ),
      s as (
        select (created_at at time zone 'utc')::date as d, count(*)::int as segmentations
        from segmentations where created_at >= (now() at time zone 'utc')::date - 59 group by 1
      ),
      u as (
        select (created_at at time zone 'utc')::date as d, count(*)::int as signups
        from users where role = 'user' and created_at >= (now() at time zone 'utc')::date - 59 group by 1
      )
      select to_char(days.d, 'YYYY-MM-DD') as date,
             coalesce(r.renders, 0) as renders,
             coalesce(r.spent_micros, 0)::bigint as spent_micros,
             coalesce(s.segmentations, 0) as segmentations,
             coalesce(u.signups, 0) as signups
      from days left join r using (d) left join s using (d) left join u using (d)
      order by days.d`),
    db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        renders: sql<number>`count(${schema.renders.id})::int`,
        spentMicros: sql<number>`coalesce(sum(${schema.renders.costMicros}), 0)::bigint`,
      })
      .from(schema.renders)
      .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
      .innerJoin(schema.users, eq(schema.projects.ownerId, schema.users.id))
      .where(ne(schema.renders.status, "failed"))
      .groupBy(schema.users.id, schema.users.email)
      // Ties (same render count) break by spend, then email, so the ranking is stable.
      .orderBy(desc(sql`count(${schema.renders.id})`), desc(sql`sum(${schema.renders.costMicros})`), asc(schema.users.email), asc(schema.users.id))
      .limit(5),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.renders)
      .where(
        and(
          inArray(schema.renders.status, ["pending", "processing"]),
          sql`${schema.renders.updatedAt} < ${stuckBeforeSql(settings.stuckTimeoutMinutes)}`,
        ),
      ),
    db
      .select({
        total: sql<number>`count(*)::int`,
        activeLast7Days: sql<number>`count(*) filter (where ${schema.projects.updatedAt} >= now() - interval '7 days')::int`,
      })
      .from(schema.projects),
    db
      .select({ status: schema.segmentations.status, count: sql<number>`count(*)::int` })
      .from(schema.segmentations)
      .groupBy(schema.segmentations.status),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.segmentations)
      .where(gte(schema.segmentations.createdAt, startOfToday)),
    db
      .select({
        spentMicros: sql<number>`coalesce(sum(${schema.segmentations.costMicros}), 0)::bigint`,
      })
      .from(schema.segmentations)
      .where(ne(schema.segmentations.status, "failed")),
    selectAdminRenders(db)
      .where(eq(schema.renders.status, "failed"))
      .orderBy(desc(schema.renders.createdAt))
      .limit(8),
    db
      .select({ id: schema.users.id, email: schema.users.email, lastActiveAt: schema.users.lastActiveAt })
      .from(schema.users)
      .where(and(eq(schema.users.role, "user"), eq(schema.users.disabled, false), gte(schema.users.lastActiveAt, sql`now() - interval '5 minutes'`)))
      .orderBy(desc(schema.users.lastActiveAt))
      .limit(8),
  ]);

  const byStatus: Record<RenderStatus, number> = { pending: 0, processing: 0, succeeded: 0, failed: 0 };
  for (const row of statusRows) byStatus[row.status] = row.count;
  const totalRenders = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
  const finished = byStatus.succeeded + byStatus.failed;
  const failureRate = finished > 0 ? byStatus.failed / finished : 0;
  // The configured FAL budget pays for both render and segmentation calls. Keep
  // this single number aligned with Settings and do not present render-only cost
  // as the remaining provider-token budget.
  const spentMicros =
    modelRows.reduce((sum, row) => sum + Number(row.spentMicros), 0) +
    Number(segSpend?.spentMicros ?? 0);
  const mode = effectiveEngineMode(c.env, settings);
  const spentUsd = spentMicros / MICROS_PER_USD;
  const budgetUsd = effectiveBudgetUsd(c.env, settings);
  const budgetRatio = budgetUsd > 0 ? spentUsd / budgetUsd : 0;
  const stuckCount = stuck?.count ?? 0;

  const segByStatus: Record<"pending" | "succeeded" | "failed", number> = { pending: 0, succeeded: 0, failed: 0 };
  for (const row of segStatusRows) {
    if (row.status === "pending" || row.status === "succeeded" || row.status === "failed") {
      segByStatus[row.status] = row.count;
    }
  }
  const segTotal = Object.values(segByStatus).reduce((sum, count) => sum + count, 0);
  const segFinished = segByStatus.succeeded + segByStatus.failed;

  const alerts: AdminOverviewResponse["alerts"] = [];
  const maintenance = await effectiveMaintenance(db, settings);
  if (maintenance.renders || maintenance.selections) {
    alerts.push({
      id: "maintenance",
      severity: "critical",
      message: maintenance.message?.trim()
        ? maintenance.message.trim()
        : `Maintenance is on — ${[
            maintenance.renders ? "renders" : null,
            maintenance.selections ? "segmentations" : null,
          ]
            .filter(Boolean)
            .join(" & ")} paused for non-admins.`,
      href: "/settings",
    });
  }
  const warningRatio = settings.budgetWarningPercent / 100;
  const criticalRatio = settings.budgetCriticalPercent / 100;
  if (budgetRatio >= criticalRatio) {
    alerts.push({
      id: "budget_critical",
      severity: "critical",
      message: `Budget nearly exhausted — ${formatUsdAlert(spentUsd)} of ${formatUsdAlert(budgetUsd)} used.`,
      href: "/settings",
    });
  } else if (budgetRatio >= warningRatio) {
    alerts.push({
      id: "budget_warning",
      severity: "warning",
      message: `Budget at ${Math.round(budgetRatio * 100)}% — ${formatUsdAlert(Math.max(0, budgetUsd - spentUsd))} remaining.`,
      href: "/settings",
    });
  }
  if (failureRate >= 0.1 && finished >= 5) {
    alerts.push({
      id: "failure_rate",
      severity: "warning",
      message: `Failure rate is ${Math.round(failureRate * 100)}% across ${finished} finished renders.`,
      href: "/renders?status=failed",
    });
  }
  if (stuckCount > 0) {
    alerts.push({
      id: "stuck_renders",
      severity: "critical",
      message: `${stuckCount} ${stuckCount === 1 ? "render has" : "renders have"} been pending or processing for over ${settings.stuckTimeoutMinutes} minutes.`,
      href: "/renders?status=processing",
    });
  }
  // Storage past R2's free tier is billed, so warn well before the cap refuses new work.
  const storage = await storageUsage(db);
  const storageRatio = storage.usedBytes / (settings.storageCapMb * BYTES_PER_MB);
  if (storageRatio >= 0.9) {
    alerts.push({ id: "storage_critical", severity: "critical", message: `Image storage is at ${Math.round(storageRatio * 100)}% of its ${(settings.storageCapMb / 1000).toFixed(1)} GB cap — new uploads and renders are refused once it's full.`, href: "/settings" });
  } else if (storageRatio >= 0.7) {
    alerts.push({ id: "storage_warning", severity: "warning", message: `Image storage is at ${Math.round(storageRatio * 100)}% of its ${(settings.storageCapMb / 1000).toFixed(1)} GB cap.`, href: "/settings" });
  }
  const fal = await falAccount(c.env);
  if (fal.status === "ok" && fal.balanceUsd !== null && fal.balanceUsd < 5) {
    alerts.push({
      id: "fal_balance_low",
      severity: fal.balanceUsd < 2 ? "critical" : "warning",
      message: `fal account balance is ${formatUsdAlert(fal.balanceUsd)} — top up before fal starts rejecting renders.`,
      href: "/settings",
    });
  }
  if (mode !== "prod") {
    alerts.push({
      id: "engine_mode",
      severity: "info",
      message: `Render engine is in ${mode} mode — not charging production models.`,
      href: "/settings",
    });
  }

  const recentFailures = await Promise.all(failureRows.map(async (row) => {
    const render = await toAdminRender(c.env, new URL(c.req.url).origin, row, settings.stuckTimeoutMinutes);
    return {
      id: render.id,
      kind: render.kind,
      userId: render.userId,
      userEmail: render.userEmail,
      projectName: render.projectName,
      errorMessage: render.errorMessage,
      sourceImageUrl: render.sourceImageUrl,
      createdAt: render.createdAt,
    };
  }));

  const allDays = dailyRows.rows.map((row) => ({
    date: row.date,
    renders: Number(row.renders),
    spentUsd: Number(row.spent_micros) / MICROS_PER_USD,
    segmentations: Number(row.segmentations),
    signups: Number(row.signups),
  }));
  const daily = allDays.slice(-30);
  const previousPeriod = allDays.slice(0, -30).reduce(
    (sum, day) => ({ renders: sum.renders + day.renders, spentUsd: sum.spentUsd + day.spentUsd, segmentations: sum.segmentations + day.segmentations, signups: sum.signups + day.signups }),
    { renders: 0, spentUsd: 0, segmentations: 0, signups: 0 },
  );

  const response: AdminOverviewResponse = {
    users: { total: users!.total, newLast7Days: users!.newLast7Days, activeNow: users!.activeNow, activeLastHour: users!.activeLastHour, activeLast24Hours: users!.activeLast24Hours, activeLast7Days: users!.activeLast7Days, disabled: users!.disabled },
    activity: { measuredAt: new Date().toISOString(), activeNow: activeNowRows.filter((row) => row.lastActiveAt).map((row) => ({ id: row.id, email: row.email, lastActiveAt: row.lastActiveAt!.toISOString() })) },
    renders: {
      total: totalRenders,
      today: today?.count ?? 0,
      byStatus,
      failureRate,
      stuckCount,
      stuckTimeoutMinutes: settings.stuckTimeoutMinutes,
    },
    spend: {
      mode,
      spentUsd,
      budgetUsd,
      budgetWarningPercent: settings.budgetWarningPercent,
      budgetCriticalPercent: settings.budgetCriticalPercent,
      byModel: modelRows.map((row) => ({
        model: row.model,
        renders: row.renders,
        spentUsd: Number(row.spentMicros) / MICROS_PER_USD,
      })),
    },
    credits: { outstanding: users!.outstanding, outstandingBreakdown: { plan: users!.plan, beta: users!.beta, permanent: users!.permanent }, granted: credits?.granted ?? 0, spent: credits?.spent ?? 0, expired: credits?.expired ?? 0, removed: credits?.removed ?? 0, grantedLast7Days: credits?.grantedLast7Days ?? 0, spentLast7Days: credits?.spentLast7Days ?? 0 },
    tokenUsage: {
      provider: "fal",
      configured: Boolean(c.env.FAL_KEY?.trim()),
      budgetUsd,
      spentUsd,
      remainingUsd: Math.max(0, budgetUsd - spentUsd),
      usedPercent: budgetUsd > 0 ? Math.min(100, Math.round(budgetRatio * 1000) / 10) : null,
      measuredAt: new Date().toISOString(),
    },
    falAccount: fal,
    daily,
    previousPeriod,
    topUsers: topRows.map((row) => ({
      id: row.id,
      email: row.email,
      renders: row.renders,
      spentUsd: Number(row.spentMicros) / MICROS_PER_USD,
    })),
    projects: { total: projects?.total ?? 0, activeLast7Days: projects?.activeLast7Days ?? 0 },
    segmentations: {
      total: segTotal,
      today: segToday?.count ?? 0,
      byStatus: segByStatus,
      failureRate: segFinished > 0 ? segByStatus.failed / segFinished : 0,
      spentUsd: Number(segSpend?.spentMicros ?? 0) / MICROS_PER_USD,
    },
    storage: { usedBytes: storage.usedBytes, capBytes: settings.storageCapMb * BYTES_PER_MB, objects: storage.objects, byKind: storage.byKind },
    recentFailures,
    alerts,
  };
  return c.json(response);
});

/** Tiny formatter for alert copy — avoids pulling admin format helpers into the API. */
function formatUsdAlert(value: number): string {
  return `$${value.toFixed(2)}`;
}
