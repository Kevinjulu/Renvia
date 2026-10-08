import { Hono } from "hono";
import { and, asc, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { schema } from "@renvia/db";
import type { AdminOverviewResponse, RenderStatus } from "@renvia/types";
import { getSettings, effectiveBudgetUsd, effectiveEngineMode } from "../../lib/settings.js";
import { denyUnless } from "./permissions.js";
import { MICROS_PER_USD, stuckBeforeSql, selectAdminRenders, toAdminRender } from "./shared.js";
import type { AdminContext } from "./context.js";

export const overviewRoutes = new Hono<AdminContext>();

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
        outstanding: sql<number>`coalesce(sum(${schema.users.creditBalance}), 0)::int`,
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
        granted: sql<number>`coalesce(sum(${schema.creditLedger.amount}) filter (where ${schema.creditLedger.amount} > 0 and ${schema.creditLedger.reason} not in ('render_refund', 'segment_refund')), 0)::int`,
        spent: sql<number>`coalesce(-sum(${schema.creditLedger.amount}) filter (where ${schema.creditLedger.reason} in ('render', 'render_refund', 'segment', 'segment_refund')), 0)::int`,
        grantedLast7Days: sql<number>`coalesce(sum(${schema.creditLedger.amount}) filter (where ${schema.creditLedger.amount} > 0 and ${schema.creditLedger.createdAt} >= now() - interval '7 days' and ${schema.creditLedger.reason} not in ('render_refund', 'segment_refund')), 0)::int`,
        spentLast7Days: sql<number>`coalesce(-sum(${schema.creditLedger.amount}) filter (where ${schema.creditLedger.amount} < 0 and ${schema.creditLedger.createdAt} >= now() - interval '7 days'), 0)::int`,
      })
      .from(schema.creditLedger),
    db.execute<{ date: string; renders: number; spent_micros: string }>(sql`
      select to_char(day, 'YYYY-MM-DD') as date,
             count(r.id)::int as renders,
             coalesce(sum(r.cost_micros) filter (where r.status <> 'failed'), 0)::bigint as spent_micros
      from generate_series((now() at time zone 'utc')::date - 13, (now() at time zone 'utc')::date, interval '1 day') as day
      left join renders r on (r.created_at at time zone 'utc')::date = day::date
      group by day order by day`),
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
  if (settings.maintenanceRenders || settings.maintenanceSegments) {
    alerts.push({
      id: "maintenance",
      severity: "critical",
      message: settings.maintenanceMessage?.trim()
        ? settings.maintenanceMessage.trim()
        : `Maintenance is on — ${[
            settings.maintenanceRenders ? "renders" : null,
            settings.maintenanceSegments ? "segmentations" : null,
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
    credits: { outstanding: users!.outstanding, granted: credits?.granted ?? 0, spent: credits?.spent ?? 0, grantedLast7Days: credits?.grantedLast7Days ?? 0, spentLast7Days: credits?.spentLast7Days ?? 0 },
    tokenUsage: {
      provider: "fal",
      configured: Boolean(c.env.FAL_KEY?.trim()),
      budgetUsd,
      spentUsd,
      remainingUsd: Math.max(0, budgetUsd - spentUsd),
      usedPercent: budgetUsd > 0 ? Math.min(100, Math.round(budgetRatio * 1000) / 10) : null,
      measuredAt: new Date().toISOString(),
    },
    daily: dailyRows.rows.map((row) => ({
      date: row.date,
      renders: Number(row.renders),
      spentUsd: Number(row.spent_micros) / MICROS_PER_USD,
    })),
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
    recentFailures,
    alerts,
  };
  return c.json(response);
});

/** Tiny formatter for alert copy — avoids pulling admin format helpers into the API. */
function formatUsdAlert(value: number): string {
  return `$${value.toFixed(2)}`;
}
