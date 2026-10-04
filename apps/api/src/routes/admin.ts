import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { and, asc, desc, eq, gte, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { createClerkClient } from "@clerk/backend";
import { createDb, schema, type Database } from "@renvia/db";
import type {
  AdminAuditAction,
  AdminAuditEvent,
  AdminAuditRange,
  AdminBulkGrantCreditsResponse,
  AdminBillingResponse,
  AdminFinancialsResponse,
  AdminOperationsQueueResponse,
  AdminCreditDirection,
  AdminCreditEntry,
  AdminCreditOrder,
  AdminCreditSort,
  AdminIncidentsResponse,
  AdminLedgerEntry,
  AdminOverviewResponse,
  AdminProject,
  AdminProjectHealth,
  AdminProjectOrder,
  AdminProjectSort,
  AdminRender,
  AdminRenderKind,
  AdminRenderOrder,
  AdminRenderSort,
  AdminSegmentation,
  AdminSegmentationMode,
  AdminSegmentationOrder,
  AdminSegmentationSort,
  AdminSettings,
  AdminUser,
  AdminUserOrder,
  AdminUserSort,
  CreditLedgerReason,
  RenderStatus,
  SegmentationStatus,
  UserRole,
} from "@renvia/types";
import type { AuthVariables, Env } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrCreateUser } from "../lib/users.js";
import { modelsFor } from "../lib/models.js";
import { getSettings, effectiveBudgetUsd, effectiveEngineMode, type AppSettingsRow } from "../lib/settings.js";
import { getUsage, resolveLimits } from "../lib/limits.js";
import { presentUploadUrl } from "../lib/storage.js";
import { cancelRender, refreshRender } from "../lib/engine.js";
import { paypalReady, paypalRequest } from "../lib/paypal.js";
import { assertPaypalPurchaseRefundable, reversePaypalPurchaseCredits } from "../lib/paypalSettlement.js";
import { runSegmentation } from "../lib/segment.js";
import { deliverIncidentNotification, recordIncidentEvent, resolveIncidentsForSource, syncOperationalIncidents } from "../lib/incidents.js";
import { replayVerifiedPaypalEvent } from "./webhooks/paypal.js";

type UserRow = typeof schema.users.$inferSelect;
type AdminContext = { Bindings: Env; Variables: AuthVariables & { admin: UserRow; db: Database } };

export const admin = new Hono<AdminContext>();

const MICROS_PER_USD = 1_000_000;

/** SQL cutoff: rows updated/created before this are "stuck". */
function stuckBeforeSql(minutes: number) {
  return sql`now() - (${minutes}::int * interval '1 minute')`;
}

function isRenderStuck(status: RenderStatus, updatedAt: Date, minutes: number): boolean {
  if (status !== "pending" && status !== "processing") return false;
  return updatedAt.getTime() < Date.now() - minutes * 60 * 1000;
}

function isSegStuck(status: SegmentationStatus, createdAt: Date, minutes: number): boolean {
  if (status !== "pending") return false;
  return createdAt.getTime() < Date.now() - minutes * 60 * 1000;
}

type AdminPermission =
  | "overview.read"
  | "users.read"
  | "users.manage"
  | "customers.manage"
  | "renders.read"
  | "renders.recover"
  | "projects.read"
  | "segmentations.read"
  | "segmentations.recover"
  | "credits.read"
  | "credits.manage"
  | "audit.read"
  | "settings.read"
  | "settings.manage"
  | "billing.read"
  | "billing.manage"
  | "incidents.read"
  | "incidents.manage";

const ROLE_PERMISSIONS: Record<UserRole, readonly AdminPermission[]> = {
  user: [],
  analyst: ["overview.read", "renders.read", "projects.read", "segmentations.read", "credits.read", "audit.read", "incidents.read"],
  support: ["overview.read", "users.read", "customers.manage", "renders.read", "renders.recover", "projects.read", "segmentations.read", "segmentations.recover", "incidents.read", "incidents.manage"],
  billing: ["overview.read", "users.read", "customers.manage", "credits.read", "credits.manage", "audit.read", "billing.read", "billing.manage", "incidents.read", "incidents.manage"],
  admin: [
    "overview.read", "users.read", "users.manage", "renders.read", "renders.recover", "projects.read", "segmentations.read", "segmentations.recover",
    "credits.read", "credits.manage", "audit.read", "settings.read", "settings.manage", "billing.read", "billing.manage", "incidents.read", "incidents.manage", "customers.manage",
  ],
};

function hasPermission(role: UserRole, permission: AdminPermission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

function denyUnless(c: { get: (key: "admin") => UserRow }, permission: AdminPermission) {
  return hasPermission(c.get("admin").role as UserRole, permission) ? null : { error: "Forbidden" };
}

/** Only active staff get past this — capability checks happen on every route below. */
const requireOperator = createMiddleware<AdminContext>(async (c, next) => {
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, c.get("auth").clerkId);
  if (!hasPermission(user.role as UserRole, "overview.read") || user.disabled) {
    return c.json({ error: "Forbidden" }, 403);
  }
  c.set("admin", user);
  c.set("db", db);
  await next();
});

admin.use("*", requireAuth, requireOperator);

// ── Shared query pieces ──────────────────────────────────────────────────────────

/** Per-user render stats; failed renders were refunded and unbilled, so they're excluded. */
function userStats(db: Database) {
  return db
    .select({
      userId: schema.projects.ownerId,
      renderCount: sql<number>`count(${schema.renders.id})::int`.as("render_count"),
      spentMicros: sql<number>`coalesce(sum(${schema.renders.costMicros}), 0)::bigint`.as("spent_micros"),
      lastRenderAt: sql<Date | null>`max(${schema.renders.createdAt})`.as("last_render_at"),
    })
    .from(schema.renders)
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .where(ne(schema.renders.status, "failed"))
    .groupBy(schema.projects.ownerId)
    .as("user_stats");
}

function selectAdminUsers(db: Database) {
  const stats = userStats(db);
  return db
    .select({
      id: schema.users.id,
      clerkId: schema.users.clerkId,
      email: schema.users.email,
      role: schema.users.role,
      creditBalance: schema.users.creditBalance,
      disabled: schema.users.disabled,
      dailyRenderLimitOverride: schema.users.dailyRenderLimitOverride,
      dailySegmentLimitOverride: schema.users.dailySegmentLimitOverride,
      monthlyRenderLimitOverride: schema.users.monthlyRenderLimitOverride,
      monthlySegmentLimitOverride: schema.users.monthlySegmentLimitOverride,
      limitsExempt: schema.users.limitsExempt,
      lastActiveAt: schema.users.lastActiveAt,
      createdAt: schema.users.createdAt,
      renderCount: sql<number>`coalesce(${stats.renderCount}, 0)::int`,
      spentMicros: sql<number>`coalesce(${stats.spentMicros}, 0)::bigint`,
      lastRenderAt: stats.lastRenderAt,
    })
    .from(schema.users)
    .leftJoin(stats, eq(stats.userId, schema.users.id));
}

type AdminUserRow = Awaited<ReturnType<ReturnType<typeof selectAdminUsers>["execute"]>>[number];

function toAdminUser({ spentMicros, lastRenderAt, lastActiveAt, createdAt, ...row }: AdminUserRow): AdminUser {
  return {
    ...row,
    spentUsd: Number(spentMicros) / MICROS_PER_USD,
    createdAt: createdAt.toISOString(),
    lastActiveAt: lastActiveAt ? new Date(lastActiveAt).toISOString() : null,
    lastRenderAt: lastRenderAt ? new Date(lastRenderAt).toISOString() : null,
  };
}

function selectAdminRenders(db: Database) {
  return db
    .select({
      render: schema.renders,
      projectId: schema.projects.id,
      projectName: schema.projects.name,
      userId: schema.users.id,
      userEmail: schema.users.email,
    })
    .from(schema.renders)
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .innerJoin(schema.users, eq(schema.projects.ownerId, schema.users.id));
}

type AdminRenderRow = Awaited<ReturnType<ReturnType<typeof selectAdminRenders>["execute"]>>[number];

async function toAdminRender(
  env: Env,
  origin: string,
  { render, projectId, projectName, userId, userEmail }: AdminRenderRow,
  stuckMinutes = 15,
): Promise<AdminRender> {
  return {
    id: render.id,
    kind: render.settings?.edit ? "edit" : "render",
    status: render.status,
    model: render.model,
    costUsd: render.costMicros / MICROS_PER_USD,
    creditsCharged: render.creditsCharged,
    prompt: render.prompt,
    style: render.style,
    aspectRatio: render.aspectRatio,
    seed: render.seed,
    viewLabel: render.viewLabel,
    sourceImageUrl: await presentUploadUrl(env, origin, render.sourceImageUrl),
    resultImageUrl: await presentUploadUrl(env, origin, render.resultImageUrl),
    errorMessage: render.errorMessage,
    falRequestId: render.falRequestId,
    stuck: isRenderStuck(render.status, render.updatedAt, stuckMinutes),
    createdAt: render.createdAt.toISOString(),
    updatedAt: render.updatedAt.toISOString(),
    projectId,
    projectName,
    userId,
    userEmail,
  };
}

async function findAdminUser(db: Database, id: string): Promise<AdminUser | null> {
  const [row] = await selectAdminUsers(db).where(eq(schema.users.id, id));
  return row ? toAdminUser(row) : null;
}

const paging = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ── Overview ─────────────────────────────────────────────────────────────────────

admin.get("/overview", async (c) => {
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
      .orderBy(desc(sql`count(${schema.renders.id})`))
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

// ── Users ────────────────────────────────────────────────────────────────────────

admin.get("/users", async (c) => {
  const denied = denyUnless(c, "users.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const { limit, offset } = paging.parse(c.req.query());
  const search = c.req.query("search")?.trim();
  const role = z.enum(["user", "analyst", "support", "billing", "admin"]).optional().parse(c.req.query("role") || undefined);
  const status = z.enum(["active", "disabled"]).optional().parse(c.req.query("status") || undefined);
  const balance = z.enum(["low", "zero"]).optional().parse(c.req.query("balance") || undefined);
  const sort = z
    .enum(["createdAt", "lastActiveAt", "lastRenderAt", "creditBalance", "renderCount", "spentUsd"])
    .default("lastActiveAt")
    .parse(c.req.query("sort") || "lastActiveAt") as AdminUserSort;
  const order = z.enum(["asc", "desc"]).default("desc").parse(c.req.query("order") || "desc") as AdminUserOrder;

  const filters: SQL[] = [];
  if (search) filters.push(ilike(schema.users.email, `%${search.replace(/[%_\\]/g, "\\$&")}%`));
  if (role) filters.push(eq(schema.users.role, role));
  if (status === "active") filters.push(eq(schema.users.disabled, false));
  if (status === "disabled") filters.push(eq(schema.users.disabled, true));
  if (balance === "low") {
    filters.push(and(eq(schema.users.role, "user"), sql`${schema.users.creditBalance} < 5`)!);
  }
  if (balance === "zero") {
    filters.push(and(eq(schema.users.role, "user"), eq(schema.users.creditBalance, 0))!);
  }
  const where = filters.length ? and(...filters) : undefined;

  const stats = userStats(db);
  const direction = order === "asc" ? asc : desc;
  const orderBy =
    sort === "creditBalance"
      ? direction(schema.users.creditBalance)
      : sort === "renderCount"
        ? direction(sql`coalesce(${stats.renderCount}, 0)`)
        : sort === "spentUsd"
          ? direction(sql`coalesce(${stats.spentMicros}, 0)`)
          : sort === "lastRenderAt"
            ? direction(stats.lastRenderAt)
            : sort === "lastActiveAt"
              ? direction(schema.users.lastActiveAt)
              : direction(schema.users.createdAt);

  const [rows, [count], [summary]] = await Promise.all([
    db
      .select({
        id: schema.users.id,
        clerkId: schema.users.clerkId,
        email: schema.users.email,
        role: schema.users.role,
        creditBalance: schema.users.creditBalance,
        disabled: schema.users.disabled,
        dailyRenderLimitOverride: schema.users.dailyRenderLimitOverride,
        dailySegmentLimitOverride: schema.users.dailySegmentLimitOverride,
        monthlyRenderLimitOverride: schema.users.monthlyRenderLimitOverride,
        monthlySegmentLimitOverride: schema.users.monthlySegmentLimitOverride,
        limitsExempt: schema.users.limitsExempt,
        lastActiveAt: schema.users.lastActiveAt,
        createdAt: schema.users.createdAt,
        renderCount: sql<number>`coalesce(${stats.renderCount}, 0)::int`,
        spentMicros: sql<number>`coalesce(${stats.spentMicros}, 0)::bigint`,
        lastRenderAt: stats.lastRenderAt,
      })
      .from(schema.users)
      .leftJoin(stats, eq(stats.userId, schema.users.id))
      .where(where)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(schema.users).where(where),
    db
      .select({
        total: sql<number>`count(*)::int`,
        admins: sql<number>`count(*) filter (where ${schema.users.role} = 'admin')::int`,
        disabled: sql<number>`count(*) filter (where ${schema.users.disabled})::int`,
        lowBalance: sql<number>`count(*) filter (where ${schema.users.role} = 'user' and ${schema.users.creditBalance} < 5)::int`,
      })
      .from(schema.users),
  ]);

  return c.json({
    users: rows.map(toAdminUser),
    total: count?.total ?? 0,
    summary: {
      total: summary?.total ?? 0,
      admins: summary?.admins ?? 0,
      disabled: summary?.disabled ?? 0,
      lowBalance: summary?.lowBalance ?? 0,
    },
  });
});

async function governance(db: Database) {
  const [row] = await db.select().from(schema.governanceSettings).where(eq(schema.governanceSettings.id, 1));
  if (row) return row;
  const [created] = await db.insert(schema.governanceSettings).values({ id: 1 }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(schema.governanceSettings).where(eq(schema.governanceSettings.id, 1)))[0]!;
}

async function requestApproval(db: Database, input: { action: "bulk_credits" | "refund" | "role_change" | "maintenance"; actorId: string; targetType: string; targetId?: string; riskValue: number; threshold: number; reason: string; payload: Record<string, unknown> }) {
  const [request] = await db.insert(schema.approvalRequests).values({ action: input.action, requestedBy: input.actorId, targetType: input.targetType, targetId: input.targetId ?? null, riskValue: input.riskValue, threshold: input.threshold, reason: input.reason, payload: input.payload }).returning();
  await db.batch([
    db.insert(schema.approvalEvents).values({ approvalId: request!.id, actorId: input.actorId, action: "requested", note: input.reason }),
    db.insert(schema.adminEvents).values({ actorId: input.actorId, action: "approval.request", targetType: input.targetType, targetId: input.targetId ?? null, summary: `Approval requested for ${input.action}`, detail: { approvalId: request!.id, riskValue: input.riskValue, threshold: input.threshold, reason: input.reason } }),
  ]);
  return request!;
}

admin.get("/governance", async (c) => {
  const denied = denyUnless(c, "settings.read"); if (denied) return c.json(denied, 403);
  const [settings, pending] = await Promise.all([governance(c.get("db")), c.get("db").select({ id: schema.approvalRequests.id, action: schema.approvalRequests.action, reason: schema.approvalRequests.reason, riskValue: schema.approvalRequests.riskValue, threshold: schema.approvalRequests.threshold, createdAt: schema.approvalRequests.createdAt, requestedBy: schema.users.email }).from(schema.approvalRequests).innerJoin(schema.users, eq(schema.approvalRequests.requestedBy, schema.users.id)).where(eq(schema.approvalRequests.status, "pending")).orderBy(desc(schema.approvalRequests.createdAt)).limit(100)]);
  return c.json({ settings, pending: pending.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })) });
});

admin.put("/governance", async (c) => {
  const denied = denyUnless(c, "settings.manage"); if (denied) return c.json(denied, 403);
  const body = z.object({ bulkCreditApprovalThreshold: z.number().int().min(0).max(1_000_000), refundApprovalThresholdCents: z.number().int().min(0).max(10_000_000), roleChangeApprovalThreshold: z.number().int().min(0).max(100), maintenanceApprovalThreshold: z.number().int().min(0).max(100), reason: z.string().trim().min(1).max(300) }).parse(await c.req.json());
  const [updated] = await c.get("db").insert(schema.governanceSettings).values({ id: 1, ...body, updatedBy: c.get("admin").id, updatedAt: new Date() }).onConflictDoUpdate({ target: schema.governanceSettings.id, set: { ...body, updatedBy: c.get("admin").id, updatedAt: new Date() } }).returning();
  await recordAdminEvent(c.get("db"), { actorId: c.get("admin").id, action: "settings.update", targetType: "governance_settings", targetId: "1", summary: "Updated high-risk action thresholds", detail: { ...body } });
  return c.json(updated);
});

admin.post("/users/bulk-credits", async (c) => {
  const denied = denyUnless(c, "credits.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const adminUser = c.get("admin");
  const body = z
    .object({
      userIds: z.array(z.string().uuid()).min(1).max(100),
      amount: z.number().int().min(1).max(10_000),
      note: z.string().trim().min(1).max(200),
    })
    .parse(await c.req.json());

  const uniqueIds = [...new Set(body.userIds)];
  const existing = await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, uniqueIds));
  if (existing.length !== uniqueIds.length) return c.json({ error: "One or more selected users no longer exist" }, 404);
  const rules = await governance(db);
  const riskValue = body.amount * existing.length;
  if (rules.bulkCreditApprovalThreshold > 0 && riskValue >= rules.bulkCreditApprovalThreshold) {
    const approval = await requestApproval(db, { action: "bulk_credits", actorId: adminUser.id, targetType: "users", riskValue, threshold: rules.bulkCreditApprovalThreshold, reason: body.note, payload: { userIds: uniqueIds, amount: body.amount, note: body.note } });
    return c.json({ pendingApproval: true, approvalId: approval.id, updated: 0 }, 202);
  }
  const settings = await getSettings(db);
  if (settings.maxCreditBalance !== null) {
    const balances = await db.select({ id: schema.users.id, creditBalance: schema.users.creditBalance }).from(schema.users).where(inArray(schema.users.id, uniqueIds));
    const aboveCap = balances.find((user) => user.creditBalance + body.amount > settings.maxCreditBalance!);
    if (aboveCap) {
      return c.json({ error: `A selected balance would exceed the ${settings.maxCreditBalance}-credit cap`, code: "balance_cap" }, 400);
    }
  }

  // Neon executes a batch as one transaction. The ledger rows and the audit event
  // therefore cannot be separated from a partially completed bulk grant.
  const writes = existing.flatMap((user) => [
    db.update(schema.users).set({ creditBalance: sql`${schema.users.creditBalance} + ${body.amount}` }).where(eq(schema.users.id, user.id)),
    db.insert(schema.creditLedger).values({ userId: user.id, amount: body.amount, reason: "admin_grant", note: body.note, actorId: adminUser.id }),
  ]);
  const [firstWrite, ...remainingWrites] = writes;
  if (!firstWrite) return c.json({ error: "No users selected" }, 400);
  await db.batch([
    firstWrite,
    ...remainingWrites,
    db.insert(schema.adminEvents).values({
      actorId: adminUser.id,
      action: "credits.adjust",
      targetType: "users",
      targetId: null,
      summary: `Granted ${body.amount} credits to ${existing.length} users`,
      detail: { amount: body.amount, note: body.note, userIds: existing.map((user) => user.id), emails: existing.map((user) => user.email) },
    }),
  ]);

  const response: AdminBulkGrantCreditsResponse = { updated: existing.length };
  return c.json(response);
});

admin.post("/approvals/:id/approve", async (c) => {
  const denied = denyUnless(c, "settings.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db"); const approver = c.get("admin"); const id = z.string().uuid().parse(c.req.param("id"));
  const [request] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, id));
  if (!request) return c.json({ error: "Approval request not found" }, 404);
  if (request.status !== "pending") return c.json({ error: "Approval request is no longer pending" }, 409);
  if (request.requestedBy === approver.id) return c.json({ error: "A requester cannot approve their own action", code: "self_approval" }, 403);
  if (approver.role !== "admin") return c.json({ error: "A second administrator must approve this action" }, 403);
  const note = z.object({ note: z.string().trim().max(300).optional() }).parse(await c.req.json()).note ?? null;
  await db.batch([
    db.update(schema.approvalRequests).set({ status: "approved", approvedBy: approver.id, approvedAt: new Date(), decisionNote: note }).where(eq(schema.approvalRequests.id, id)),
    db.insert(schema.approvalEvents).values({ approvalId: id, actorId: approver.id, action: "approved", note }),
    db.insert(schema.adminEvents).values({ actorId: approver.id, action: "approval.approve", targetType: request.targetType, targetId: request.targetId, summary: `Approved ${request.action}`, detail: { approvalId: id } }),
  ]);
  // Approval is intentionally separate from execution. This prevents a review click from triggering a provider refund or a bulk mutation.
  return c.json({ id, status: "approved" });
});

admin.post("/approvals/:id/reject", async (c) => {
  const denied = denyUnless(c, "settings.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db"); const actor = c.get("admin"); const id = z.string().uuid().parse(c.req.param("id"));
  const { note } = z.object({ note: z.string().trim().min(1).max(300) }).parse(await c.req.json());
  const [request] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, id));
  if (!request) return c.json({ error: "Approval request not found" }, 404);
  if (request.status !== "pending") return c.json({ error: "Approval request is no longer pending" }, 409);
  if (request.requestedBy === actor.id) return c.json({ error: "A requester cannot reject their own action", code: "self_approval" }, 403);
  await db.batch([
    db.update(schema.approvalRequests).set({ status: "rejected", approvedBy: actor.id, approvedAt: new Date(), decisionNote: note }).where(eq(schema.approvalRequests.id, id)),
    db.insert(schema.approvalEvents).values({ approvalId: id, actorId: actor.id, action: "rejected", note }),
    db.insert(schema.adminEvents).values({ actorId: actor.id, action: "approval.reject", targetType: request.targetType, targetId: request.targetId, summary: `Rejected ${request.action}`, detail: { approvalId: id, note } }),
  ]);
  return c.json({ id, status: "rejected" });
});

admin.post("/approvals/:id/execute", async (c) => {
  const denied = denyUnless(c, "credits.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db"); const actor = c.get("admin"); const id = z.string().uuid().parse(c.req.param("id"));
  const [request] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, id));
  if (!request) return c.json({ error: "Approval request not found" }, 404);
  if (request.status !== "approved") return c.json({ error: "Approval request must be approved before execution" }, 409);
  if (request.action === "role_change") {
    const payload = z.object({ id: z.string().uuid(), role: z.enum(["user", "analyst", "support", "billing", "admin"]), confirmEmail: z.string().email() }).parse(request.payload);
    const target = await findAdminUser(db, payload.id);
    if (!target) return c.json({ error: "Target user no longer exists" }, 409);
    if (target.id === actor.id || payload.confirmEmail.toLowerCase() !== target.email.toLowerCase()) return c.json({ error: "Role change confirmation is no longer valid" }, 409);
    if (payload.role === "admin" && target.disabled) return c.json({ error: "Enable the account before promoting them to admin" }, 409);
    if (payload.role === "user" && target.role === "admin") {
      const [count] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.users).where(and(eq(schema.users.role, "admin"), eq(schema.users.disabled, false)));
      if ((count?.count ?? 0) <= 1) return c.json({ error: "Can't demote the last active admin" }, 409);
    }
    await db.batch([db.update(schema.users).set({ role: payload.role, updatedAt: new Date() }).where(eq(schema.users.id, target.id)), db.update(schema.approvalRequests).set({ status: "executed", executedAt: new Date() }).where(eq(schema.approvalRequests.id, id)), db.insert(schema.approvalEvents).values({ approvalId: id, actorId: actor.id, action: "executed" }), db.insert(schema.adminEvents).values({ actorId: actor.id, action: "approval.execute", targetType: "user", targetId: target.id, summary: `Executed approved role change for ${target.email}`, detail: { approvalId: id, role: payload.role } })]);
    return c.json({ id, status: "executed" });
  }
  if (request.action !== "bulk_credits") return c.json({ error: "This approved action is executed from its protected operation" }, 409);
  const payload = z.object({ userIds: z.array(z.string().uuid()).min(1).max(100), amount: z.number().int().min(1).max(10_000), note: z.string().min(1).max(200) }).parse(request.payload);
  const users = await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, payload.userIds));
  if (users.length !== payload.userIds.length) return c.json({ error: "A target user no longer exists; create a new approval request" }, 409);
  const writes = users.flatMap((user) => [db.update(schema.users).set({ creditBalance: sql`${schema.users.creditBalance} + ${payload.amount}` }).where(eq(schema.users.id, user.id)), db.insert(schema.creditLedger).values({ userId: user.id, amount: payload.amount, reason: "admin_grant", note: payload.note, actorId: actor.id })]);
  const [firstWrite, ...remainingWrites] = writes;
  await db.batch([firstWrite!, ...remainingWrites, db.update(schema.approvalRequests).set({ status: "executed", executedAt: new Date() }).where(eq(schema.approvalRequests.id, id)), db.insert(schema.approvalEvents).values({ approvalId: id, actorId: actor.id, action: "executed" }), db.insert(schema.adminEvents).values({ actorId: actor.id, action: "approval.execute", targetType: "users", summary: `Executed approved bulk credit grant to ${users.length} users`, detail: { approvalId: id, amount: payload.amount } })]);
  return c.json({ id, status: "executed", updated: users.length });
});

admin.get("/users/:id", async (c) => {
  const denied = denyUnless(c, "users.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const [user, settings] = await Promise.all([findAdminUser(db, id), getSettings(db)]);
  if (!user) return c.json({ error: "Not found" }, 404);

  const actor = alias(schema.users, "actor");
  const [ledgerRows, renderRows, notes, tags, projects, payments, entitlement, failures] = await Promise.all([
    db
      .select({ entry: schema.creditLedger, actorEmail: actor.email })
      .from(schema.creditLedger)
      .leftJoin(actor, eq(schema.creditLedger.actorId, actor.id))
      .where(eq(schema.creditLedger.userId, id))
      .orderBy(desc(schema.creditLedger.createdAt))
      .limit(50),
    selectAdminRenders(db).where(eq(schema.users.id, id)).orderBy(desc(schema.renders.createdAt)).limit(20),
    db.select({ id: schema.customerNotes.id, body: schema.customerNotes.body, createdAt: schema.customerNotes.createdAt, authorEmail: actor.email })
      .from(schema.customerNotes).innerJoin(actor, eq(schema.customerNotes.authorId, actor.id)).where(eq(schema.customerNotes.userId, id)).orderBy(desc(schema.customerNotes.createdAt)).limit(50),
    db.select({ id: schema.customerTags.id, label: schema.customerTags.label, createdAt: schema.customerTags.createdAt })
      .from(schema.customerTags).where(eq(schema.customerTags.userId, id)).orderBy(asc(schema.customerTags.label)),
    db.select({ id: schema.projects.id, name: schema.projects.name, createdAt: schema.projects.createdAt, updatedAt: schema.projects.updatedAt })
      .from(schema.projects).where(eq(schema.projects.ownerId, id)).orderBy(desc(schema.projects.updatedAt)).limit(20),
    db.select({ id: schema.billingPayments.id, provider: schema.billingPayments.provider, status: schema.billingPayments.status, amountCents: schema.billingPayments.amountCents, currency: schema.billingPayments.currency, createdAt: schema.billingPayments.createdAt, paidAt: schema.billingPayments.paidAt })
      .from(schema.billingPayments).where(eq(schema.billingPayments.userId, id)).orderBy(desc(schema.billingPayments.createdAt)).limit(50),
    db.select({ status: schema.userEntitlements.status, currentPeriodEnd: schema.userEntitlements.currentPeriodEnd, planName: schema.billingPlans.name, planSlug: schema.billingPlans.slug })
      .from(schema.userEntitlements).leftJoin(schema.billingPlans, eq(schema.userEntitlements.planId, schema.billingPlans.id)).where(eq(schema.userEntitlements.userId, id)).limit(1),
    db.select({ id: schema.renders.id, errorMessage: schema.renders.errorMessage, createdAt: schema.renders.updatedAt, projectName: schema.projects.name })
      .from(schema.renders).innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id)).where(and(eq(schema.projects.ownerId, id), eq(schema.renders.status, "failed"))).orderBy(desc(schema.renders.updatedAt)).limit(20),
  ]);

  const ledger: AdminLedgerEntry[] = ledgerRows.map(({ entry, actorEmail }) => ({
    id: entry.id,
    amount: entry.amount,
    reason: entry.reason,
    renderId: entry.renderId,
    segmentationId: entry.segmentationId,
    note: entry.note,
    createdAt: entry.createdAt.toISOString(),
    actorEmail,
  }));
  const [userRow] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  return c.json({
    user,
    ledger,
    renders: await Promise.all(renderRows.map((row) => toAdminRender(c.env, new URL(c.req.url).origin, row, settings.stuckTimeoutMinutes))),
    limits: resolveLimits(userRow!, settings),
    usage: await getUsage(db, user.id),
    notes: notes.map((note) => ({ ...note, createdAt: note.createdAt.toISOString() })),
    tags: tags.map((tag) => ({ ...tag, createdAt: tag.createdAt.toISOString() })),
    projects: projects.map((project) => ({ ...project, createdAt: project.createdAt.toISOString(), updatedAt: project.updatedAt.toISOString() })),
    payments: payments.map((payment) => ({ ...payment, createdAt: payment.createdAt.toISOString(), paidAt: payment.paidAt?.toISOString() ?? null })),
    entitlement: entitlement[0] ? { ...entitlement[0], currentPeriodEnd: entitlement[0].currentPeriodEnd?.toISOString() ?? null } : null,
    recentErrors: failures.map((failure) => ({ ...failure, createdAt: failure.createdAt.toISOString() })),
  });
});

const customerNoteSchema = z.object({ body: z.string().trim().min(1).max(2000) });
admin.post("/users/:id/notes", async (c) => {
  const denied = denyUnless(c, "customers.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db"); const userId = z.string().uuid().parse(c.req.param("id"));
  const { body } = customerNoteSchema.parse(await c.req.json());
  if (!(await findAdminUser(db, userId))) return c.json({ error: "Not found" }, 404);
  const [note] = await db.insert(schema.customerNotes).values({ userId, authorId: c.get("admin").id, body }).returning();
  await recordAdminEvent(db, { actorId: c.get("admin").id, action: "customer.note", targetType: "user", targetId: userId, summary: "Added internal customer note", detail: { noteId: note!.id } });
  return c.json({ id: note!.id });
});

const customerTagSchema = z.object({ label: z.string().trim().min(1).max(50) });
admin.post("/users/:id/tags", async (c) => {
  const denied = denyUnless(c, "customers.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db"); const userId = z.string().uuid().parse(c.req.param("id"));
  const { label } = customerTagSchema.parse(await c.req.json());
  if (!(await findAdminUser(db, userId))) return c.json({ error: "Not found" }, 404);
  const normalizedLabel = label.toLocaleLowerCase();
  await db.insert(schema.customerTags).values({ userId, label, normalizedLabel, createdBy: c.get("admin").id }).onConflictDoNothing();
  await recordAdminEvent(db, { actorId: c.get("admin").id, action: "customer.tag", targetType: "user", targetId: userId, summary: `Tagged customer: ${label}`, detail: { label } });
  return c.json({ ok: true });
});

admin.post("/users/:id/revoke-sessions", async (c) => {
  const denied = denyUnless(c, "users.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db"); const userId = z.string().uuid().parse(c.req.param("id"));
  const body = z.object({ reason: z.string().trim().min(1).max(300), confirmEmail: z.string().trim().email() }).parse(await c.req.json());
  const target = await findAdminUser(db, userId); const actor = c.get("admin");
  if (!target) return c.json({ error: "Not found" }, 404);
  if (target.id === actor.id) return c.json({ error: "You cannot revoke your own sessions here", code: "self_revoke" }, 400);
  if (body.confirmEmail.toLowerCase() !== target.email.toLowerCase()) return c.json({ error: "Type the user's email exactly to confirm", code: "confirm_email_mismatch" }, 400);
  const clerk = createClerkClient({ secretKey: c.env.CLERK_SECRET_KEY });
  const sessions = await clerk.sessions.getSessionList({ userId: target.clerkId, status: "active", limit: 100 });
  await Promise.all(sessions.data.map((session) => clerk.sessions.revokeSession(session.id)));
  await recordAdminEvent(db, { actorId: actor.id, action: "user.session_revoke", targetType: "user", targetId: target.id, summary: `Revoked ${sessions.data.length} session(s) for ${target.email}`, detail: { reason: body.reason, sessionCount: sessions.data.length } });
  return c.json({ revoked: sessions.data.length });
});

const grantSchema = z.object({
  amount: z
    .number()
    .int()
    .refine((value) => value !== 0, "Amount can't be zero")
    .refine((value) => Math.abs(value) <= 10_000, "At most 10,000 credits per adjustment"),
  note: z.string().trim().min(1).max(200),
});

/** Postgres check violation: the users_credit_balance_non_negative constraint. */
function isCheckViolation(error: unknown): boolean {
  for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
    if ((current as { code?: string }).code === "23514") return true;
  }
  return false;
}

async function recordAdminEvent(
  db: Database,
  input: {
    actorId: string;
    action: AdminAuditAction;
    targetType: string;
    targetId?: string | null;
    summary: string;
    detail?: Record<string, unknown>;
  },
) {
  await db.insert(schema.adminEvents).values({
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    summary: input.summary,
    detail: input.detail ?? null,
  });
}

admin.post("/users/:id/credits", async (c) => {
  const denied = denyUnless(c, "credits.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const { amount, note } = grantSchema.parse(await c.req.json());
  const adminUser = c.get("admin");
  const target = await findAdminUser(db, id);
  if (!target) return c.json({ error: "Not found" }, 404);

  // The balance ceiling applies to grants only — a removal is always allowed.
  if (amount > 0) {
    const settings = await getSettings(db);
    if (settings.maxCreditBalance !== null && target.creditBalance + amount > settings.maxCreditBalance) {
      return c.json(
        {
          error: `That would take the balance past the ${settings.maxCreditBalance}-credit cap`,
          code: "balance_cap",
          limit: settings.maxCreditBalance,
          used: target.creditBalance,
        },
        400,
      );
    }
  }

  try {
    // Balance and ledger entry commit together; a removal past zero rolls both back.
    const [updated] = await db.batch([
      db
        .update(schema.users)
        .set({ creditBalance: sql`${schema.users.creditBalance} + ${amount}` })
        .where(eq(schema.users.id, id))
        .returning({ id: schema.users.id }),
      db.insert(schema.creditLedger).values({ userId: id, amount, reason: "admin_grant", note, actorId: adminUser.id }),
      db.insert(schema.adminEvents).values({
        actorId: adminUser.id,
        action: "credits.adjust",
        targetType: "user",
        targetId: id,
        summary: `${amount > 0 ? "Granted" : "Removed"} ${Math.abs(amount)} credits for ${target.email}`,
        detail: { amount, note, email: target.email },
      }),
    ]);
    if (updated.length === 0) return c.json({ error: "Not found" }, 404);
  } catch (error) {
    if (isCheckViolation(error)) {
      return c.json({ error: "That would take the balance below zero", code: "balance_negative" }, 400);
    }
    // The ledger's user foreign key fails for an unknown id.
    if ((error as { code?: string }).code === "23503") return c.json({ error: "Not found" }, 404);
    throw error;
  }

  return c.json({ user: await findAdminUser(db, id) });
});

const updateUserSchema = z
  .object({
    disabled: z.boolean().optional(),
    role: z.enum(["user", "analyst", "support", "billing", "admin"]).optional(),
    confirmEmail: z.string().trim().email().optional(),
    reason: z.string().trim().min(1).max(300).optional(),
    // 0 blocks the user outright; null clears the override so the global setting applies.
    dailyRenderLimitOverride: z.number().int().min(0).max(10_000).nullable().optional(),
    dailySegmentLimitOverride: z.number().int().min(0).max(10_000).nullable().optional(),
    monthlyRenderLimitOverride: z.number().int().min(0).max(100_000).nullable().optional(),
    monthlySegmentLimitOverride: z.number().int().min(0).max(100_000).nullable().optional(),
    limitsExempt: z.boolean().optional(),
  })
  .refine(
    (body) => Object.keys(body).some((key) => key !== "confirmEmail" && body[key as keyof typeof body] !== undefined),
    "Nothing to update",
  )
  .superRefine((body, ctx) => {
    if (body.role !== undefined && !body.confirmEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "confirmEmail is required when changing role",
        path: ["confirmEmail"],
      });
    }
    if ((body.role !== undefined || body.disabled !== undefined) && !body.reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A reason is required for account or role changes", path: ["reason"] });
    }
  });

/** Audit wording for each per-user override. */
const LIMIT_OVERRIDE_LABELS = [
  ["dailyRenderLimitOverride", "daily renders"],
  ["dailySegmentLimitOverride", "daily selections"],
  ["monthlyRenderLimitOverride", "monthly renders"],
  ["monthlySegmentLimitOverride", "monthly selections"],
] as const;

admin.patch("/users/:id", async (c) => {
  const denied = denyUnless(c, "users.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const body = updateUserSchema.parse(await c.req.json());
  const adminUser = c.get("admin");

  // Guard against an admin locking themselves (and possibly everyone) out.
  if (id === adminUser.id && (body.disabled === true || body.role === "user")) {
    return c.json({ error: "You can't disable or demote your own account", code: "self_lockout" }, 400);
  }

  const before = await findAdminUser(db, id);
  if (!before) return c.json({ error: "Not found" }, 404);

  if (body.role !== undefined && body.role !== before.role) {
    const rules = await governance(db);
    if (rules.roleChangeApprovalThreshold > 0 && 1 >= rules.roleChangeApprovalThreshold) {
      const approval = await requestApproval(db, { action: "role_change", actorId: adminUser.id, targetType: "user", targetId: id, riskValue: 1, threshold: rules.roleChangeApprovalThreshold, reason: body.reason!, payload: { id, role: body.role, confirmEmail: body.confirmEmail } });
      return c.json({ pendingApproval: true, approvalId: approval.id }, 202);
    }
    const typed = body.confirmEmail?.trim().toLowerCase() ?? "";
    if (typed !== before.email.trim().toLowerCase()) {
      return c.json(
        { error: "Type the user's email exactly to confirm the role change", code: "confirm_email_mismatch" },
        400,
      );
    }
    if (body.role === "admin" && before.disabled) {
      return c.json(
        { error: "Enable the account before promoting them to admin", code: "disabled_user" },
        400,
      );
    }
    if (body.role === "user" && before.role === "admin") {
      const [adminCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.users)
        .where(and(eq(schema.users.role, "admin"), eq(schema.users.disabled, false)));
      if ((adminCount?.count ?? 0) <= 1) {
        return c.json(
          { error: "Can't demote the last active admin — promote someone else first", code: "last_admin" },
          400,
        );
      }
    }
  }

  const [updated] = await db
    .update(schema.users)
    .set({
      ...(body.disabled !== undefined ? { disabled: body.disabled } : {}),
      ...(body.role !== undefined ? { role: body.role } : {}),
      ...(body.limitsExempt !== undefined ? { limitsExempt: body.limitsExempt } : {}),
      ...(body.dailyRenderLimitOverride !== undefined ? { dailyRenderLimitOverride: body.dailyRenderLimitOverride } : {}),
      ...(body.dailySegmentLimitOverride !== undefined ? { dailySegmentLimitOverride: body.dailySegmentLimitOverride } : {}),
      ...(body.monthlyRenderLimitOverride !== undefined ? { monthlyRenderLimitOverride: body.monthlyRenderLimitOverride } : {}),
      ...(body.monthlySegmentLimitOverride !== undefined ? { monthlySegmentLimitOverride: body.monthlySegmentLimitOverride } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, id))
    .returning({ id: schema.users.id });
  if (!updated) return c.json({ error: "Not found" }, 404);

  const user = await findAdminUser(db, id);
  const parts: string[] = [];
  if (body.disabled !== undefined && body.disabled !== before.disabled) {
    parts.push(body.disabled ? "disabled account" : "enabled account");
  }
  if (body.role !== undefined && body.role !== before.role) {
    parts.push(body.role === "admin" ? "promoted to admin" : "demoted to user");
  }
  if (body.limitsExempt !== undefined && body.limitsExempt !== before.limitsExempt) {
    parts.push(body.limitsExempt ? "exempted from limits" : "limits re-applied");
  }
  for (const [key, label] of LIMIT_OVERRIDE_LABELS) {
    const next = body[key];
    if (next !== undefined && next !== before[key]) {
      parts.push(next === null ? `${label} override cleared` : `${label} override set to ${next}`);
    }
  }
  await recordAdminEvent(db, {
    actorId: adminUser.id,
    action: "user.update",
    targetType: "user",
    targetId: id,
    summary: `${before.email}: ${parts.join(", ") || "updated"}`,
    detail: {
      before: {
        role: before.role,
        disabled: before.disabled,
        limitsExempt: before.limitsExempt,
        dailyRenderLimitOverride: before.dailyRenderLimitOverride,
        dailySegmentLimitOverride: before.dailySegmentLimitOverride,
        monthlyRenderLimitOverride: before.monthlyRenderLimitOverride,
        monthlySegmentLimitOverride: before.monthlySegmentLimitOverride,
      },
      after: { role: body.role, disabled: body.disabled, limitsExempt: body.limitsExempt,
        dailyRenderLimitOverride: body.dailyRenderLimitOverride,
        dailySegmentLimitOverride: body.dailySegmentLimitOverride,
        monthlyRenderLimitOverride: body.monthlyRenderLimitOverride,
        monthlySegmentLimitOverride: body.monthlySegmentLimitOverride,
      },
      confirmEmail: body.confirmEmail ?? null,
      reason: body.reason ?? null,
    },
  });

  return c.json({ user });
});

// ── Renders ──────────────────────────────────────────────────────────────────────

admin.get("/renders", async (c) => {
  const denied = denyUnless(c, "renders.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const settings = await getSettings(db);
  const stuckMinutes = settings.stuckTimeoutMinutes;
  const stuckCutoff = stuckBeforeSql(stuckMinutes);
  const { limit, offset } = paging.parse(c.req.query());
  const status = z.enum(["pending", "processing", "succeeded", "failed"]).optional().parse(c.req.query("status") || undefined);
  const kind = z.enum(["render", "edit"]).optional().parse(c.req.query("kind") || undefined) as AdminRenderKind | undefined;
  const stuck = c.req.query("stuck") === "1" || c.req.query("stuck") === "true";
  const userId = z.string().uuid().optional().parse(c.req.query("userId") || undefined);
  const projectId = z.string().uuid().optional().parse(c.req.query("projectId") || undefined);
  const model = c.req.query("model")?.trim() || undefined;
  const search = c.req.query("search")?.trim();
  const sort = z
    .enum(["createdAt", "costUsd", "creditsCharged"])
    .default("createdAt")
    .parse(c.req.query("sort") || "createdAt") as AdminRenderSort;
  const order = z.enum(["asc", "desc"]).default("desc").parse(c.req.query("order") || "desc") as AdminRenderOrder;

  const filters: SQL[] = [];
  if (status) filters.push(eq(schema.renders.status, status));
  if (userId) filters.push(eq(schema.users.id, userId));
  if (projectId) filters.push(eq(schema.renders.projectId, projectId));
  if (model) filters.push(eq(schema.renders.model, model));
  if (kind === "edit") filters.push(sql`${schema.renders.settings}->'edit' is not null`);
  if (kind === "render") filters.push(sql`${schema.renders.settings}->'edit' is null`);
  if (stuck) {
    filters.push(and(inArray(schema.renders.status, ["pending", "processing"]), sql`${schema.renders.updatedAt} < ${stuckCutoff}`)!);
  }
  if (search) {
    const escaped = `%${search.replace(/[%_\\]/g, "\\$&")}%`;
    filters.push(
      or(
        ilike(schema.users.email, escaped),
        ilike(schema.projects.name, escaped),
        ilike(schema.renders.prompt, escaped),
        ilike(schema.renders.model, escaped),
      )!,
    );
  }
  const where = filters.length ? and(...filters) : undefined;

  const direction = order === "asc" ? asc : desc;
  const orderBy =
    sort === "costUsd"
      ? direction(schema.renders.costMicros)
      : sort === "creditsCharged"
        ? direction(schema.renders.creditsCharged)
        : direction(schema.renders.createdAt);

  const [rows, [count], statusRows, [stuckRow], [spendRow], modelRows] = await Promise.all([
    selectAdminRenders(db).where(where).orderBy(orderBy).limit(limit).offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.renders)
      .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
      .innerJoin(schema.users, eq(schema.projects.ownerId, schema.users.id))
      .where(where),
    db
      .select({ status: schema.renders.status, count: sql<number>`count(*)::int` })
      .from(schema.renders)
      .groupBy(schema.renders.status),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.renders)
      .where(and(inArray(schema.renders.status, ["pending", "processing"]), sql`${schema.renders.updatedAt} < ${stuckCutoff}`)),
    db
      .select({
        spentMicros: sql<number>`coalesce(sum(${schema.renders.costMicros}) filter (where ${schema.renders.status} <> 'failed'), 0)::bigint`,
      })
      .from(schema.renders),
    db
      .select({
        model: schema.renders.model,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.renders)
      .where(sql`${schema.renders.model} is not null`)
      .groupBy(schema.renders.model)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
  ]);

  const byStatus: Record<RenderStatus, number> = { pending: 0, processing: 0, succeeded: 0, failed: 0 };
  for (const row of statusRows) byStatus[row.status] = row.count;
  const inFlight = byStatus.pending + byStatus.processing;

  return c.json({
    renders: await Promise.all(rows.map((row) => toAdminRender(c.env, new URL(c.req.url).origin, row, stuckMinutes))),
    total: count?.total ?? 0,
    summary: {
      total: byStatus.pending + byStatus.processing + byStatus.succeeded + byStatus.failed,
      byStatus,
      inFlight,
      stuckCount: stuckRow?.count ?? 0,
      stuckTimeoutMinutes: stuckMinutes,
      failed: byStatus.failed,
      spentUsd: Number(spendRow?.spentMicros ?? 0) / MICROS_PER_USD,
      models: modelRows
        .filter((row): row is { model: string; count: number } => row.model !== null)
        .map((row) => ({ model: row.model, count: row.count })),
    },
  });
});

admin.get("/renders/:id", async (c) => {
  const denied = denyUnless(c, "renders.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const settings = await getSettings(db);
  const [row] = await selectAdminRenders(db).where(eq(schema.renders.id, id));
  if (!row) return c.json({ error: "Render not found" }, 404);
  return c.json({ render: await toAdminRender(c.env, new URL(c.req.url).origin, row, settings.stuckTimeoutMinutes) });
});

/**
 * Operator recovery uses the same idempotent engine paths as customer polling.
 * It never fabricates a result or a refund: refresh asks fal for the authoritative
 * state; cancel is best-effort at fal and records the normal failed/refund outcome.
 */
admin.post("/renders/:id/refresh", async (c) => {
  const denied = denyUnless(c, "renders.recover"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const [render] = await db.select().from(schema.renders).where(eq(schema.renders.id, id)).limit(1);
  if (!render) return c.json({ error: "Render not found" }, 404);
  const refreshed = await refreshRender(c.env, db, render, new URL(c.req.url).origin);
  await recordAdminEvent(db, {
    actorId: c.get("admin").id,
    action: "render.refresh",
    targetType: "render",
    targetId: id,
    summary: `Refreshed render ${id}`,
    detail: { statusBefore: render.status, statusAfter: refreshed.status },
  });
  if (refreshed.status === "succeeded") {
    await resolveIncidentsForSource(db, "render", id, c.get("admin").id, "Render refresh completed successfully");
  }
  const settings = await getSettings(db);
  const [row] = await selectAdminRenders(db).where(eq(schema.renders.id, id));
  return c.json({ render: row ? await toAdminRender(c.env, new URL(c.req.url).origin, row, settings.stuckTimeoutMinutes) : refreshed });
});

admin.post("/renders/:id/cancel", async (c) => {
  const denied = denyUnless(c, "renders.recover"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const [render] = await db.select().from(schema.renders).where(eq(schema.renders.id, id)).limit(1);
  if (!render) return c.json({ error: "Render not found" }, 404);
  if (render.status !== "pending" && render.status !== "processing") {
    return c.json({ error: "Only pending or processing renders can be cancelled" }, 409);
  }
  const cancelled = await cancelRender(c.env, db, render);
  await recordAdminEvent(db, {
    actorId: c.get("admin").id,
    action: "render.cancel",
    targetType: "render",
    targetId: id,
    summary: `Cancelled render ${id}`,
    detail: { statusBefore: render.status, statusAfter: cancelled.status, creditsCharged: render.creditsCharged },
  });
  await resolveIncidentsForSource(db, "render", id, c.get("admin").id, "Render was intentionally cancelled by an operator");
  const settings = await getSettings(db);
  const [row] = await selectAdminRenders(db).where(eq(schema.renders.id, id));
  return c.json({ render: row ? await toAdminRender(c.env, new URL(c.req.url).origin, row, settings.stuckTimeoutMinutes) : cancelled });
});

// ── Settings ─────────────────────────────────────────────────────────────────────

async function toAdminSettings(env: Env, db: Database, row: AppSettingsRow): Promise<AdminSettings> {
  const [[renderSpend], [segSpend], updaterRows, changeRows] = await Promise.all([
    db
      .select({
        spentMicros: sql<number>`coalesce(sum(${schema.renders.costMicros}), 0)::bigint`,
      })
      .from(schema.renders)
      .where(ne(schema.renders.status, "failed")),
    db
      .select({
        spentMicros: sql<number>`coalesce(sum(${schema.segmentations.costMicros}), 0)::bigint`,
      })
      .from(schema.segmentations)
      .where(ne(schema.segmentations.status, "failed")),
    row.updatedBy
      ? db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, row.updatedBy))
      : Promise.resolve([] as { email: string }[]),
    db
      .select({
        event: schema.adminEvents,
        actorEmail: schema.users.email,
      })
      .from(schema.adminEvents)
      .innerJoin(schema.users, eq(schema.adminEvents.actorId, schema.users.id))
      .where(eq(schema.adminEvents.action, "settings.update"))
      .orderBy(desc(schema.adminEvents.createdAt))
      .limit(8),
  ]);

  const envMode = env.FAL_MODE?.trim() || null;
  const envBudgetRaw = Number(env.FAL_BUDGET_USD);
  const envBudgetUsd = Number.isFinite(envBudgetRaw) && envBudgetRaw > 0 ? envBudgetRaw : null;
  const effectiveMode = effectiveEngineMode(env, row);

  return {
    signupBonusCredits: row.signupBonusCredits,
    dailyRenderLimit: row.dailyRenderLimit,
    dailySegmentLimit: row.dailySegmentLimit,
    monthlyRenderLimit: row.monthlyRenderLimit,
    monthlySegmentLimit: row.monthlySegmentLimit,
    maxCreditBalance: row.maxCreditBalance,
    maxProjectsPerUser: row.maxProjectsPerUser,
    maxUploadMb: row.maxUploadMb,
    maxReferenceImages: row.maxReferenceImages,
    maxPromptChars: row.maxPromptChars,
    maxSelectionPromptChars: row.maxSelectionPromptChars,
    lowCreditThreshold: row.lowCreditThreshold,
    messageInsufficientCredits: row.messageInsufficientCredits,
    messageDailyLimit: row.messageDailyLimit,
    messageMonthlyLimit: row.messageMonthlyLimit,
    messageBudgetExhausted: row.messageBudgetExhausted,
    messageAccountDisabled: row.messageAccountDisabled,
    creditsPerImage: row.creditsPerImage,
    creditsPerSelection: row.creditsPerSelection,
    maintenanceRenders: row.maintenanceRenders,
    maintenanceSegments: row.maintenanceSegments,
    maintenanceMessage: row.maintenanceMessage,
    budgetWarningPercent: row.budgetWarningPercent,
    budgetCriticalPercent: row.budgetCriticalPercent,
    stuckTimeoutMinutes: row.stuckTimeoutMinutes,
    falMode: row.falMode,
    falBudgetUsd: row.falBudgetUsd === null ? null : Number(row.falBudgetUsd),
    effectiveMode,
    effectiveBudgetUsd: effectiveBudgetUsd(env, row),
    spentUsd: (Number(renderSpend?.spentMicros ?? 0) + Number(segSpend?.spentMicros ?? 0)) / MICROS_PER_USD,
    envMode,
    envBudgetUsd,
    health: {
      falKeyConfigured: Boolean(env.FAL_KEY?.trim()),
      storageConfigured: Boolean(
        env.NEON_STORAGE_ACCESS_KEY_ID?.trim() &&
          env.NEON_STORAGE_SECRET_ACCESS_KEY?.trim() &&
          env.NEON_STORAGE_ENDPOINT?.trim() &&
          env.NEON_STORAGE_BUCKET?.trim(),
      ),
    },
    models: modelsFor(effectiveMode),
    updatedAt: row.updatedAt.toISOString(),
    updatedByEmail: updaterRows[0]?.email ?? null,
    recentChanges: changeRows.map(({ event, actorEmail }) => ({
      id: event.id,
      actorEmail,
      summary: event.summary,
      detail: event.detail,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

admin.get("/settings", async (c) => {
  const denied = denyUnless(c, "settings.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  return c.json(await toAdminSettings(c.env, db, await getSettings(db)));
});

const updateSettingsSchema = z
  .object({
    signupBonusCredits: z.number().int().min(0).max(1000).optional(),
    dailyRenderLimit: z.number().int().min(1).max(10_000).nullable().optional(),
    dailySegmentLimit: z.number().int().min(1).max(10_000).nullable().optional(),
    monthlyRenderLimit: z.number().int().min(1).max(100_000).nullable().optional(),
    monthlySegmentLimit: z.number().int().min(1).max(100_000).nullable().optional(),
    maxCreditBalance: z.number().int().min(1).max(1_000_000).nullable().optional(),
    maxProjectsPerUser: z.number().int().min(1).max(10_000).nullable().optional(),
    maxUploadMb: z.number().int().min(1).max(100).optional(),
    maxReferenceImages: z.number().int().min(0).max(16).optional(),
    maxPromptChars: z.number().int().min(50).max(8000).optional(),
    maxSelectionPromptChars: z.number().int().min(10).max(1000).optional(),
    lowCreditThreshold: z.number().int().min(0).max(1000).optional(),
    messageInsufficientCredits: z.string().trim().max(280).nullable().optional(),
    messageDailyLimit: z.string().trim().max(280).nullable().optional(),
    messageMonthlyLimit: z.string().trim().max(280).nullable().optional(),
    messageBudgetExhausted: z.string().trim().max(280).nullable().optional(),
    messageAccountDisabled: z.string().trim().max(280).nullable().optional(),
    creditsPerImage: z.number().int().min(0).max(100).optional(),
    creditsPerSelection: z.number().int().min(0).max(100).optional(),
    maintenanceRenders: z.boolean().optional(),
    maintenanceSegments: z.boolean().optional(),
    maintenanceMessage: z.string().trim().max(280).nullable().optional(),
    budgetWarningPercent: z.number().int().min(1).max(99).optional(),
    budgetCriticalPercent: z.number().int().min(2).max(100).optional(),
    stuckTimeoutMinutes: z.number().int().min(1).max(1440).optional(),
    falMode: z.enum(["mock", "dev", "prod"]).nullable().optional(),
    falBudgetUsd: z.number().min(0).max(10_000).nullable().optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.budgetWarningPercent !== undefined && body.budgetCriticalPercent !== undefined) {
      if (body.budgetCriticalPercent <= body.budgetWarningPercent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Critical percent must be greater than warning percent",
          path: ["budgetCriticalPercent"],
        });
      }
    }
  });

admin.put("/settings", async (c) => {
  const denied = denyUnless(c, "settings.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const body = updateSettingsSchema.parse(await c.req.json());
  const adminUser = c.get("admin");
  const before = await getSettings(db); // ensures the row exists

  const warning = body.budgetWarningPercent ?? before.budgetWarningPercent;
  const critical = body.budgetCriticalPercent ?? before.budgetCriticalPercent;
  if (critical <= warning) {
    return c.json({ error: "Critical percent must be greater than warning percent" }, 400);
  }

  const [updated] = await db
    .update(schema.appSettings)
    .set({
      ...body,
      falBudgetUsd: body.falBudgetUsd === undefined ? undefined : body.falBudgetUsd === null ? null : body.falBudgetUsd.toFixed(2),
      updatedAt: new Date(),
      updatedBy: adminUser.id,
    })
    .where(eq(schema.appSettings.id, 1))
    .returning();

  const changed = Object.keys(body).filter((key) => body[key as keyof typeof body] !== undefined);
  await recordAdminEvent(db, {
    actorId: adminUser.id,
    action: "settings.update",
    targetType: "settings",
    targetId: "1",
    summary: `Updated settings: ${changed.join(", ") || "no fields"}`,
    detail: {
      before: {
        signupBonusCredits: before.signupBonusCredits,
        dailyRenderLimit: before.dailyRenderLimit,
        dailySegmentLimit: before.dailySegmentLimit,
        monthlyRenderLimit: before.monthlyRenderLimit,
        monthlySegmentLimit: before.monthlySegmentLimit,
        maxCreditBalance: before.maxCreditBalance,
        maxProjectsPerUser: before.maxProjectsPerUser,
        maxUploadMb: before.maxUploadMb,
        maxReferenceImages: before.maxReferenceImages,
        maxPromptChars: before.maxPromptChars,
        maxSelectionPromptChars: before.maxSelectionPromptChars,
        lowCreditThreshold: before.lowCreditThreshold,
        messageInsufficientCredits: before.messageInsufficientCredits,
        messageDailyLimit: before.messageDailyLimit,
        messageMonthlyLimit: before.messageMonthlyLimit,
        messageBudgetExhausted: before.messageBudgetExhausted,
        messageAccountDisabled: before.messageAccountDisabled,
        creditsPerImage: before.creditsPerImage,
        creditsPerSelection: before.creditsPerSelection,
        maintenanceRenders: before.maintenanceRenders,
        maintenanceSegments: before.maintenanceSegments,
        maintenanceMessage: before.maintenanceMessage,
        budgetWarningPercent: before.budgetWarningPercent,
        budgetCriticalPercent: before.budgetCriticalPercent,
        stuckTimeoutMinutes: before.stuckTimeoutMinutes,
        falMode: before.falMode,
        falBudgetUsd: before.falBudgetUsd === null ? null : Number(before.falBudgetUsd),
      },
      after: body,
    },
  });

  return c.json(await toAdminSettings(c.env, db, updated!));
});

// ── Projects ─────────────────────────────────────────────────────────────────────

const HIGH_SPEND_MICROS = 1_000_000; // $1

function projectRenderStats(db: Database) {
  return db
    .select({
      projectId: schema.renders.projectId,
      renderCount: sql<number>`count(*) filter (where ${schema.renders.status} <> 'failed')::int`.as("render_count"),
      failedCount: sql<number>`count(*) filter (where ${schema.renders.status} = 'failed')::int`.as("failed_count"),
      inFlightCount: sql<number>`count(*) filter (where ${schema.renders.status} in ('pending', 'processing'))::int`.as(
        "in_flight_count",
      ),
      totalRenders: sql<number>`count(*)::int`.as("total_renders"),
      spentMicros: sql<number>`coalesce(sum(${schema.renders.costMicros}) filter (where ${schema.renders.status} <> 'failed'), 0)::bigint`.as(
        "spent_micros",
      ),
      lastRenderAt: sql<Date | null>`max(${schema.renders.createdAt})`.as("last_render_at"),
    })
    .from(schema.renders)
    .groupBy(schema.renders.projectId)
    .as("project_render_stats");
}

type ProjectStats = ReturnType<typeof projectRenderStats>;

async function toAdminProject(env: Env, origin: string, row: {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  ownerId: string;
  ownerEmail: string;
  createdAt: Date;
  updatedAt: Date;
  renderCount: number;
  failedCount: number;
  inFlightCount: number;
  spentMicros: number;
  lastRenderAt: Date | null;
}): Promise<AdminProject> {
  return {
    id: row.id,
    name: row.name,
    thumbnailUrl: await presentUploadUrl(env, origin, row.thumbnailUrl),
    ownerId: row.ownerId,
    ownerEmail: row.ownerEmail,
    renderCount: row.renderCount,
    failedCount: row.failedCount,
    inFlightCount: row.inFlightCount,
    spentUsd: Number(row.spentMicros) / MICROS_PER_USD,
    lastRenderAt: row.lastRenderAt ? new Date(row.lastRenderAt).toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function projectSelect(db: Database, stats: ProjectStats) {
  return db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      thumbnailUrl: schema.projects.thumbnailUrl,
      ownerId: schema.users.id,
      ownerEmail: schema.users.email,
      createdAt: schema.projects.createdAt,
      updatedAt: schema.projects.updatedAt,
      renderCount: sql<number>`coalesce(${stats.renderCount}, 0)::int`,
      failedCount: sql<number>`coalesce(${stats.failedCount}, 0)::int`,
      inFlightCount: sql<number>`coalesce(${stats.inFlightCount}, 0)::int`,
      spentMicros: sql<number>`coalesce(${stats.spentMicros}, 0)::bigint`,
      lastRenderAt: stats.lastRenderAt,
    })
    .from(schema.projects)
    .innerJoin(schema.users, eq(schema.projects.ownerId, schema.users.id))
    .leftJoin(stats, eq(stats.projectId, schema.projects.id));
}

admin.get("/projects", async (c) => {
  const denied = denyUnless(c, "projects.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const { limit, offset } = paging.parse(c.req.query());
  const search = c.req.query("search")?.trim();
  const health = z
    .enum(["active", "failures", "inflight", "never", "high_spend"])
    .optional()
    .parse(c.req.query("health") || undefined) as AdminProjectHealth | undefined;
  const sort = z
    .enum(["updatedAt", "createdAt", "lastRenderAt", "renderCount", "spentUsd", "failedCount"])
    .default("updatedAt")
    .parse(c.req.query("sort") || "updatedAt") as AdminProjectSort;
  const order = z.enum(["asc", "desc"]).default("desc").parse(c.req.query("order") || "desc") as AdminProjectOrder;

  const stats = projectRenderStats(db);
  const filters: SQL[] = [];
  if (search) {
    const escaped = `%${search.replace(/[%_\\]/g, "\\$&")}%`;
    filters.push(or(ilike(schema.projects.name, escaped), ilike(schema.users.email, escaped))!);
  }
  if (health === "active") {
    filters.push(
      or(
        gte(schema.projects.updatedAt, sql`now() - interval '7 days'`),
        gte(stats.lastRenderAt, sql`now() - interval '7 days'`),
      )!,
    );
  }
  if (health === "failures") filters.push(sql`coalesce(${stats.failedCount}, 0) > 0`);
  if (health === "inflight") filters.push(sql`coalesce(${stats.inFlightCount}, 0) > 0`);
  if (health === "never") filters.push(sql`coalesce(${stats.totalRenders}, 0) = 0`);
  if (health === "high_spend") filters.push(sql`coalesce(${stats.spentMicros}, 0) >= ${HIGH_SPEND_MICROS}`);
  const where = filters.length ? and(...filters) : undefined;

  const direction = order === "asc" ? asc : desc;
  const orderBy =
    sort === "createdAt"
      ? direction(schema.projects.createdAt)
      : sort === "lastRenderAt"
        ? direction(stats.lastRenderAt)
        : sort === "renderCount"
          ? direction(sql`coalesce(${stats.renderCount}, 0)`)
          : sort === "spentUsd"
            ? direction(sql`coalesce(${stats.spentMicros}, 0)`)
            : sort === "failedCount"
              ? direction(sql`coalesce(${stats.failedCount}, 0)`)
              : direction(schema.projects.updatedAt);

  const [rows, [count], [summary]] = await Promise.all([
    projectSelect(db, stats).where(where).orderBy(orderBy).limit(limit).offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.projects)
      .innerJoin(schema.users, eq(schema.projects.ownerId, schema.users.id))
      .leftJoin(stats, eq(stats.projectId, schema.projects.id))
      .where(where),
    db
      .select({
        total: sql<number>`count(*)::int`,
        activeLast7Days: sql<number>`count(*) filter (where ${schema.projects.updatedAt} >= now() - interval '7 days' or ${stats.lastRenderAt} >= now() - interval '7 days')::int`,
        withFailures: sql<number>`count(*) filter (where coalesce(${stats.failedCount}, 0) > 0)::int`,
        neverRendered: sql<number>`count(*) filter (where coalesce(${stats.totalRenders}, 0) = 0)::int`,
        spentMicros: sql<number>`coalesce(sum(${stats.spentMicros}), 0)::bigint`,
      })
      .from(schema.projects)
      .leftJoin(stats, eq(stats.projectId, schema.projects.id)),
  ]);

  return c.json({
    projects: await Promise.all(rows.map((row) => toAdminProject(c.env, new URL(c.req.url).origin, row))),
    total: count?.total ?? 0,
    summary: {
      total: summary?.total ?? 0,
      activeLast7Days: summary?.activeLast7Days ?? 0,
      withFailures: summary?.withFailures ?? 0,
      neverRendered: summary?.neverRendered ?? 0,
      spentUsd: Number(summary?.spentMicros ?? 0) / MICROS_PER_USD,
    },
  });
});

admin.get("/projects/:id", async (c) => {
  const denied = denyUnless(c, "projects.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const settings = await getSettings(db);
  const stats = projectRenderStats(db);
  const [row] = await projectSelect(db, stats).where(eq(schema.projects.id, id));
  if (!row) return c.json({ error: "Project not found" }, 404);

  const renders = await selectAdminRenders(db)
    .where(eq(schema.renders.projectId, id))
    .orderBy(desc(schema.renders.createdAt))
    .limit(25);

  return c.json({
    project: await toAdminProject(c.env, new URL(c.req.url).origin, row),
    renders: await Promise.all(renders.map((render) => toAdminRender(c.env, new URL(c.req.url).origin, render, settings.stuckTimeoutMinutes))),
  });
});

// ── Credits ledger ───────────────────────────────────────────────────────────────

const CREDIT_REASONS = [
  "signup_bonus",
  "initial_grant",
  "admin_grant",
  "render",
  "render_refund",
  "segment",
  "segment_refund",
  "purchase",
  "purchase_refund",
  "subscription_grant",
  "subscription_expiry",
] as const satisfies readonly CreditLedgerReason[];

function toAdminCreditEntry(
  entry: typeof schema.creditLedger.$inferSelect,
  userEmail: string,
  actorEmail: string | null,
): AdminCreditEntry {
  return {
    id: entry.id,
    userId: entry.userId,
    userEmail,
    amount: entry.amount,
    reason: entry.reason,
    renderId: entry.renderId,
    segmentationId: entry.segmentationId,
    note: entry.note,
    actorEmail,
    createdAt: entry.createdAt.toISOString(),
  };
}

admin.get("/credits", async (c) => {
  const denied = denyUnless(c, "credits.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const { limit, offset } = paging.parse(c.req.query());
  const reason = z.enum(CREDIT_REASONS).optional().parse(c.req.query("reason") || undefined);
  const direction = z.enum(["in", "out"]).optional().parse(c.req.query("direction") || undefined) as AdminCreditDirection | undefined;
  const userId = z.string().uuid().optional().parse(c.req.query("userId") || undefined);
  const search = c.req.query("search")?.trim();
  const sort = z
    .enum(["createdAt", "amount"])
    .default("createdAt")
    .parse(c.req.query("sort") || "createdAt") as AdminCreditSort;
  const order = z.enum(["asc", "desc"]).default("desc").parse(c.req.query("order") || "desc") as AdminCreditOrder;

  const actor = alias(schema.users, "actor");
  const filters: SQL[] = [];
  if (reason) filters.push(eq(schema.creditLedger.reason, reason));
  if (userId) filters.push(eq(schema.creditLedger.userId, userId));
  if (direction === "in") filters.push(sql`${schema.creditLedger.amount} > 0`);
  if (direction === "out") filters.push(sql`${schema.creditLedger.amount} < 0`);
  if (search) {
    const escaped = `%${search.replace(/[%_\\]/g, "\\$&")}%`;
    filters.push(or(ilike(schema.users.email, escaped), ilike(schema.creditLedger.note, escaped), ilike(actor.email, escaped))!);
  }
  const where = filters.length ? and(...filters) : undefined;

  const directionFn = order === "asc" ? asc : desc;
  const orderBy = sort === "amount" ? directionFn(schema.creditLedger.amount) : directionFn(schema.creditLedger.createdAt);

  const [rows, [count], [balances], [flow], reasonRows] = await Promise.all([
    db
      .select({
        entry: schema.creditLedger,
        userEmail: schema.users.email,
        actorEmail: actor.email,
      })
      .from(schema.creditLedger)
      .innerJoin(schema.users, eq(schema.creditLedger.userId, schema.users.id))
      .leftJoin(actor, eq(schema.creditLedger.actorId, actor.id))
      .where(where)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.creditLedger)
      .innerJoin(schema.users, eq(schema.creditLedger.userId, schema.users.id))
      .leftJoin(actor, eq(schema.creditLedger.actorId, actor.id))
      .where(where),
    db.select({ outstanding: sql<number>`coalesce(sum(${schema.users.creditBalance}), 0)::int` }).from(schema.users),
    db
      .select({
        granted: sql<number>`coalesce(sum(${schema.creditLedger.amount}) filter (where ${schema.creditLedger.amount} > 0), 0)::int`,
        spent: sql<number>`coalesce(sum(abs(${schema.creditLedger.amount})) filter (where ${schema.creditLedger.amount} < 0), 0)::int`,
        netLast7Days: sql<number>`coalesce(sum(${schema.creditLedger.amount}) filter (where ${schema.creditLedger.createdAt} >= now() - interval '7 days'), 0)::int`,
      })
      .from(schema.creditLedger),
    db
      .select({
        reason: schema.creditLedger.reason,
        count: sql<number>`count(*)::int`,
        totalAmount: sql<number>`coalesce(sum(${schema.creditLedger.amount}), 0)::int`,
      })
      .from(schema.creditLedger)
      .groupBy(schema.creditLedger.reason)
      .orderBy(desc(sql`count(*)`)),
  ]);

  return c.json({
    entries: rows.map(({ entry, userEmail, actorEmail }) => toAdminCreditEntry(entry, userEmail, actorEmail)),
    total: count?.total ?? 0,
    summary: {
      outstanding: balances?.outstanding ?? 0,
      granted: flow?.granted ?? 0,
      spent: flow?.spent ?? 0,
      netLast7Days: flow?.netLast7Days ?? 0,
      byReason: reasonRows.map((row) => ({
        reason: row.reason as CreditLedgerReason,
        count: row.count,
        totalAmount: row.totalAmount,
      })),
    },
  });
});

// ── Billing operations ──────────────────────────────────────────────────────────

admin.get("/billing", async (c) => {
  const denied = denyUnless(c, "billing.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const [plans, payments, webhooks, [totals]] = await Promise.all([
    db
      .select({ id: schema.billingPlans.id, name: schema.billingPlans.name, slug: schema.billingPlans.slug, priceCents: schema.billingPlans.priceCents, currency: schema.billingPlans.currency, active: schema.billingPlans.isActive, subscribers: sql<number>`count(${schema.userEntitlements.id})::int` })
      .from(schema.billingPlans)
      .leftJoin(schema.userEntitlements, and(eq(schema.userEntitlements.planId, schema.billingPlans.id), eq(schema.userEntitlements.status, "active")))
      .groupBy(schema.billingPlans.id)
      .orderBy(asc(schema.billingPlans.priceCents)),
    db
      .select({ id: schema.billingPayments.id, userId: schema.billingPayments.userId, userEmail: schema.users.email, provider: schema.billingPayments.provider, providerPaymentId: schema.billingPayments.providerPaymentId, status: schema.billingPayments.status, amountCents: schema.billingPayments.amountCents, currency: schema.billingPayments.currency, createdAt: schema.billingPayments.createdAt, paidAt: schema.billingPayments.paidAt })
      .from(schema.billingPayments).innerJoin(schema.users, eq(schema.billingPayments.userId, schema.users.id)).orderBy(desc(schema.billingPayments.createdAt)).limit(30),
    db
      .select({ id: schema.billingWebhookEvents.id, provider: schema.billingWebhookEvents.provider, eventType: schema.billingWebhookEvents.eventType, processedAt: schema.billingWebhookEvents.processedAt, failedAt: schema.billingWebhookEvents.failedAt, attempts: schema.billingWebhookEvents.attempts, failureMessage: schema.billingWebhookEvents.failureMessage, createdAt: schema.billingWebhookEvents.createdAt })
      .from(schema.billingWebhookEvents).orderBy(desc(schema.billingWebhookEvents.createdAt)).limit(30),
    db.select({ paid: sql<number>`coalesce(sum(${schema.billingPayments.amountCents}) filter (where ${schema.billingPayments.status} = 'paid'), 0)::int`, refunded: sql<number>`coalesce(sum(${schema.billingPayments.amountCents}) filter (where ${schema.billingPayments.status} = 'refunded'), 0)::int` }).from(schema.billingPayments),
  ]);
  const response: AdminBillingResponse = {
    summary: {
      paidUsd: (totals?.paid ?? 0) / 100,
      refundedUsd: (totals?.refunded ?? 0) / 100,
      pendingWebhooks: webhooks.filter((event) => !event.processedAt && !event.failedAt).length,
      failedWebhooks: webhooks.filter((event) => Boolean(event.failedAt)).length,
    },
    plans: plans.map((plan) => ({ ...plan, active: plan.active })),
    payments: payments.map((payment) => ({ ...payment, createdAt: payment.createdAt.toISOString(), paidAt: payment.paidAt?.toISOString() ?? null })),
    webhooks: webhooks.map((event) => ({ id: event.id, provider: event.provider, eventType: event.eventType, status: event.processedAt ? "processed" : event.failedAt ? "failed" : "pending", attempts: event.attempts, failureMessage: event.failureMessage, createdAt: event.createdAt.toISOString() })),
  };
  return c.json(response);
});

/** Financial truth: captured provider money is separated from internally tracked FAL estimates. */
admin.get("/financials", async (c) => {
  const denied = denyUnless(c, "billing.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db"); const settings = await getSettings(db);
  const [payments, costs, models, customerRevenue, customerCosts, products, entitlements, [allTimeSpend]] = await Promise.all([
    db.select({ userId: schema.billingPayments.userId, amount: schema.billingPayments.amountCents, status: schema.billingPayments.status, createdAt: schema.billingPayments.createdAt, checkoutId: schema.billingPayments.checkoutId }).from(schema.billingPayments).where(gte(schema.billingPayments.createdAt, sql`now() - interval '30 days'`)),
    db.select({ day: sql<string>`to_char(date_trunc('day', ${schema.renders.createdAt}), 'YYYY-MM-DD')`, cost: sql<number>`coalesce(sum(${schema.renders.costMicros}), 0)::bigint` }).from(schema.renders).where(and(gte(schema.renders.createdAt, sql`now() - interval '30 days'`), ne(schema.renders.status, "failed"))).groupBy(sql`date_trunc('day', ${schema.renders.createdAt})`).orderBy(asc(sql`date_trunc('day', ${schema.renders.createdAt})`)),
    db.select({ label: schema.renders.model, cost: sql<number>`coalesce(sum(${schema.renders.costMicros}), 0)::bigint`, renders: sql<number>`count(*)::int` }).from(schema.renders).where(and(gte(schema.renders.createdAt, sql`now() - interval '30 days'`), ne(schema.renders.status, "failed"))).groupBy(schema.renders.model).orderBy(desc(sql`sum(${schema.renders.costMicros})`)),
    db.select({ userId: schema.users.id, email: schema.users.email, revenue: sql<number>`coalesce(sum(${schema.billingPayments.amountCents}) filter (where ${schema.billingPayments.status} = 'paid'),0)::int` }).from(schema.users).leftJoin(schema.billingPayments, eq(schema.billingPayments.userId, schema.users.id)).groupBy(schema.users.id, schema.users.email),
    db.select({ userId: schema.projects.ownerId, cost: sql<number>`coalesce(sum(${schema.renders.costMicros}),0)::bigint` }).from(schema.renders).innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id)).where(and(gte(schema.renders.createdAt, sql`now() - interval '30 days'`), ne(schema.renders.status, "failed"))).groupBy(schema.projects.ownerId),
    db.select({ amount: schema.billingPayments.amountCents, status: schema.billingPayments.status, plan: schema.billingPlans.name, pack: schema.creditPacks.name }).from(schema.billingPayments).leftJoin(schema.billingCheckouts, eq(schema.billingPayments.checkoutId, schema.billingCheckouts.id)).leftJoin(schema.billingPlans, eq(schema.billingCheckouts.planId, schema.billingPlans.id)).leftJoin(schema.creditPacks, eq(schema.billingCheckouts.creditPackId, schema.creditPacks.id)).where(gte(schema.billingPayments.createdAt, sql`now() - interval '30 days'`)),
    db.select({ price: schema.billingPlans.priceCents, status: schema.userEntitlements.status }).from(schema.userEntitlements).innerJoin(schema.billingPlans, eq(schema.userEntitlements.planId, schema.billingPlans.id)),
    db.select({ spentMicros: sql<number>`coalesce(sum(${schema.renders.costMicros}) filter (where ${schema.renders.status} <> 'failed'),0)::bigint` }).from(schema.renders),
  ]);
  const paid = payments.filter((payment) => payment.status === "paid").reduce((sum, payment) => sum + payment.amount, 0) / 100;
  const refunded = payments.filter((payment) => payment.status === "refunded").reduce((sum, payment) => sum + payment.amount, 0) / 100;
  // Neon/Postgres returns bigint aggregates as strings. Convert before arithmetic:
  // adding them directly concatenates digits and produces fictional financial totals.
  const micros = (value: number | string | null | undefined) => Number(value ?? 0);
  const estimatedCost = costs.reduce((sum, row) => sum + micros(row.cost), 0) / MICROS_PER_USD;
  const dailyBurnUsd = costs.filter((row) => row.day >= new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)).reduce((sum, row) => sum + micros(row.cost), 0) / MICROS_PER_USD / 7;
  const budget = effectiveBudgetUsd(c.env, settings);
  const dailyPayments = new Map<string, { revenueUsd: number; refundsUsd: number; failedPayments: number }>();
  for (const payment of payments) {
    const day = payment.createdAt.toISOString().slice(0, 10); const current = dailyPayments.get(day) ?? { revenueUsd: 0, refundsUsd: 0, failedPayments: 0 };
    if (payment.status === "paid") current.revenueUsd += payment.amount / 100;
    if (payment.status === "refunded") current.refundsUsd += payment.amount / 100;
    if (payment.status === "failed") current.failedPayments += 1;
    dailyPayments.set(day, current);
  }
  const byProduct = (key: "plan" | "pack") => Object.entries(products.reduce<Record<string, number>>((all, item) => { const label = item[key] ?? "Unattributed"; if (item.status === "paid") all[label] = (all[label] ?? 0) + item.amount / 100; return all; }, {})).map(([label, revenueUsd]) => ({ label, revenueUsd, estimatedCostUsd: 0, marginUsd: revenueUsd }));
  const costByCustomer = new Map(customerCosts.map((row) => [row.userId, micros(row.cost) / MICROS_PER_USD]));
  const response: AdminFinancialsResponse = {
    revenue: { capturedUsd: paid, refundedUsd: refunded, netUsd: paid - refunded, mrrUsd: entitlements.filter((item) => item.status === "active").reduce((sum, item) => sum + item.price / 100, 0), failedPayments: payments.filter((payment) => payment.status === "failed").length, conversionRate: payments.length ? payments.filter((payment) => payment.status === "paid").length / payments.length : 0, churnedSubscribers: entitlements.filter((item) => item.status === "canceled" || item.status === "expired").length },
    estimatedCost: { falUsd: estimatedCost, dailyBurnUsd, trackedBudgetUsd: budget, projectedBudgetExhaustion: budget !== null && dailyBurnUsd > 0 ? new Date(Date.now() + Math.max(0, budget - (micros(allTimeSpend?.spentMicros) / MICROS_PER_USD)) / dailyBurnUsd * 86_400_000).toISOString() : null, reconciliationStatus: "not_connected" },
    margins: { byPlan: byProduct("plan"), byPack: byProduct("pack"), byModel: models.map((row) => ({ label: row.label ?? "Unknown model", estimatedCostUsd: micros(row.cost) / MICROS_PER_USD, renders: row.renders })), byCustomer: customerRevenue.map((row) => ({ userId: row.userId, email: row.email, revenueUsd: row.revenue / 100, estimatedCostUsd: costByCustomer.get(row.userId) ?? 0, marginUsd: row.revenue / 100 - (costByCustomer.get(row.userId) ?? 0) })).sort((a, b) => b.revenueUsd - a.revenueUsd).slice(0, 50) },
    daily: [...new Set([...costs.map((row) => row.day), ...dailyPayments.keys()])].sort().map((day) => { const cost = micros(costs.find((row) => row.day === day)?.cost); const money = dailyPayments.get(day) ?? { revenueUsd: 0, refundsUsd: 0, failedPayments: 0 }; return { day, estimatedCostUsd: cost / MICROS_PER_USD, ...money }; }),
  };
  return c.json(response);
});

/** Compact, role-filtered queue for the operator currently signed in. */
admin.get("/operations/queue", async (c) => {
  const db = c.get("db"); const actor = c.get("admin");
  const [incidents, approvals, renders, segmentations] = await Promise.all([
    hasPermission(actor.role as UserRole, "incidents.read") ? db.select({ id: schema.incidents.id, title: schema.incidents.title, severity: schema.incidents.severity, status: schema.incidents.status, updatedAt: schema.incidents.updatedAt }).from(schema.incidents).where(and(eq(schema.incidents.ownerId, actor.id), ne(schema.incidents.status, "resolved"))).orderBy(desc(schema.incidents.updatedAt)).limit(20) : Promise.resolve([]),
    hasPermission(actor.role as UserRole, "settings.read") ? db.select({ id: schema.approvalRequests.id, action: schema.approvalRequests.action, reason: schema.approvalRequests.reason, requestedBy: schema.users.email, createdAt: schema.approvalRequests.createdAt }).from(schema.approvalRequests).innerJoin(schema.users, eq(schema.approvalRequests.requestedBy, schema.users.id)).where(eq(schema.approvalRequests.status, "pending")).orderBy(desc(schema.approvalRequests.createdAt)).limit(20) : Promise.resolve([]),
    hasPermission(actor.role as UserRole, "renders.read") ? db.select({ id: schema.renders.id, label: schema.projects.name, userId: schema.projects.ownerId, createdAt: schema.renders.updatedAt }).from(schema.renders).innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id)).where(eq(schema.renders.status, "failed")).orderBy(desc(schema.renders.updatedAt)).limit(20) : Promise.resolve([]),
    hasPermission(actor.role as UserRole, "segmentations.read") ? db.select({ id: schema.segmentations.id, userId: schema.segmentations.userId, createdAt: schema.segmentations.createdAt }).from(schema.segmentations).where(eq(schema.segmentations.status, "failed")).orderBy(desc(schema.segmentations.createdAt)).limit(20) : Promise.resolve([]),
  ]);
  const response: AdminOperationsQueueResponse = { assignedIncidents: incidents.map((row) => ({ ...row, severity: row.severity as AdminOperationsQueueResponse["assignedIncidents"][number]["severity"], status: row.status as AdminOperationsQueueResponse["assignedIncidents"][number]["status"], updatedAt: row.updatedAt.toISOString() })), pendingApprovals: approvals.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })), failedJobs: [...renders.map((row) => ({ ...row, type: "render" as const, createdAt: row.createdAt.toISOString() })), ...segmentations.map((row) => ({ ...row, label: "Selection", type: "segmentation" as const, createdAt: row.createdAt.toISOString() }))].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20) };
  return c.json(response);
});

/**
 * A refund is deliberately blocked once its purchased credits have been spent. This
 * avoids a money refund while retaining consumed Renvia service; those cases need a
 * documented manual support decision instead of an unsafe automatic reversal.
 */
admin.post("/billing/payments/:id/refund", async (c) => {
  const denied = denyUnless(c, "billing.manage"); if (denied) return c.json(denied, 403);
  if (!paypalReady(c.env)) return c.json({ error: "PayPal refunds are not configured" }, 503);
  const db = c.get("db");
  const paymentId = z.string().uuid().parse(c.req.param("id"));
  const [payment] = await db.select().from(schema.billingPayments).where(eq(schema.billingPayments.id, paymentId)).limit(1);
  if (!payment) return c.json({ error: "Payment not found" }, 404);
  if (payment.provider !== "paypal" || payment.status !== "paid") return c.json({ error: "Only captured PayPal payments can be refunded" }, 409);
  try {
    await assertPaypalPurchaseRefundable(db, payment.id);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Payment is not refundable", code: "refund_manual_review" }, 409);
  }
  try {
    const response = await paypalRequest<{ id?: string }>(c.env, `/v2/payments/captures/${payment.providerPaymentId}/refund`, { method: "POST", headers: { "PayPal-Request-Id": `refund-${payment.id}` }, body: JSON.stringify({}) });
    if (!response.id) throw new Error("PayPal did not return a refund ID");
    await reversePaypalPurchaseCredits(db, payment.id, response.id);
    await db.update(schema.billingPayments).set({ status: "refunded", updatedAt: new Date(), providerMetadata: { ...(payment.providerMetadata ?? {}), refundId: response.id } }).where(eq(schema.billingPayments.id, payment.id));
    await recordAdminEvent(db, { actorId: c.get("admin").id, action: "billing.payment", targetType: "billing_payment", targetId: payment.id, summary: `Refunded PayPal payment ${payment.providerPaymentId}`, detail: { refundId: response.id, amountCents: payment.amountCents, currency: payment.currency } });
    return c.json({ id: payment.id, status: "refunded" });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Could not refund payment" }, 502);
  }
});

/** Replays only a previously signature-verified stored PayPal event. */
admin.post("/billing/webhooks/:id/replay", async (c) => {
  const denied = denyUnless(c, "billing.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const [event] = await db.select().from(schema.billingWebhookEvents).where(eq(schema.billingWebhookEvents.id, id)).limit(1);
  if (!event) return c.json({ error: "Webhook event not found" }, 404);
  if (event.provider !== "paypal" || event.verificationStatus !== "verified") return c.json({ error: "Only previously verified PayPal events can be replayed" }, 409);
  try {
    await replayVerifiedPaypalEvent(db, event.payload);
    await db.update(schema.billingWebhookEvents).set({ processedAt: new Date(), failedAt: null, failureMessage: null, attempts: sql`${schema.billingWebhookEvents.attempts} + 1`, lastAttemptAt: new Date() }).where(eq(schema.billingWebhookEvents.id, event.id));
    await resolveIncidentsForSource(db, "webhook", event.id, c.get("admin").id, "Verified webhook replay completed successfully");
    await recordAdminEvent(db, { actorId: c.get("admin").id, action: "billing.webhook", targetType: "billing_webhook", targetId: event.id, summary: `Replayed PayPal event ${event.eventType}`, detail: { providerEventId: event.providerEventId } });
    return c.json({ id: event.id, status: "processed" });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Webhook replay failed";
    await db.update(schema.billingWebhookEvents).set({ failedAt: new Date(), failureMessage: message, attempts: sql`${schema.billingWebhookEvents.attempts} + 1`, lastAttemptAt: new Date() }).where(eq(schema.billingWebhookEvents.id, event.id));
    return c.json({ error: message }, 502);
  }
});

// ── Segmentations ────────────────────────────────────────────────────────────────

function toAdminSegmentation(
  segmentation: typeof schema.segmentations.$inferSelect,
  userEmail: string,
  stuckMinutes = 15,
): AdminSegmentation {
  const mode: AdminSegmentationMode = segmentation.prompt ? "prompt" : "click";
  return {
    id: segmentation.id,
    userId: segmentation.userId,
    userEmail,
    imageUrl: segmentation.imageUrl,
    prompt: segmentation.prompt,
    point: segmentation.point,
    mode,
    status: segmentation.status as SegmentationStatus,
    objectCount: segmentation.objectCount,
    model: segmentation.model,
    costUsd: segmentation.costMicros / MICROS_PER_USD,
    creditsCharged: segmentation.creditsCharged,
    errorMessage: segmentation.errorMessage,
    stuck: isSegStuck(segmentation.status as SegmentationStatus, segmentation.createdAt, stuckMinutes),
    createdAt: segmentation.createdAt.toISOString(),
  };
}

admin.get("/segmentations", async (c) => {
  const denied = denyUnless(c, "segmentations.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const settings = await getSettings(db);
  const stuckMinutes = settings.stuckTimeoutMinutes;
  const { limit, offset } = paging.parse(c.req.query());
  const status = z.enum(["pending", "succeeded", "failed"]).optional().parse(c.req.query("status") || undefined);
  const mode = z.enum(["prompt", "click"]).optional().parse(c.req.query("mode") || undefined) as AdminSegmentationMode | undefined;
  const stuck = c.req.query("stuck") === "1" || c.req.query("stuck") === "true";
  const userId = z.string().uuid().optional().parse(c.req.query("userId") || undefined);
  const model = c.req.query("model")?.trim() || undefined;
  const search = c.req.query("search")?.trim();
  const sort = z
    .enum(["createdAt", "costUsd", "creditsCharged", "objectCount"])
    .default("createdAt")
    .parse(c.req.query("sort") || "createdAt") as AdminSegmentationSort;
  const order = z.enum(["asc", "desc"]).default("desc").parse(c.req.query("order") || "desc") as AdminSegmentationOrder;

  const filters: SQL[] = [];
  if (status) filters.push(eq(schema.segmentations.status, status));
  if (userId) filters.push(eq(schema.segmentations.userId, userId));
  if (model) filters.push(eq(schema.segmentations.model, model));
  if (mode === "prompt") filters.push(sql`${schema.segmentations.prompt} is not null`);
  if (mode === "click") filters.push(sql`${schema.segmentations.prompt} is null`);
  if (stuck) {
    filters.push(
      and(eq(schema.segmentations.status, "pending"), sql`${schema.segmentations.createdAt} < ${stuckBeforeSql(stuckMinutes)}`)!,
    );
  }
  if (search) {
    const escaped = `%${search.replace(/[%_\\]/g, "\\$&")}%`;
    filters.push(or(ilike(schema.users.email, escaped), ilike(schema.segmentations.prompt, escaped), ilike(schema.segmentations.model, escaped))!);
  }
  const where = filters.length ? and(...filters) : undefined;

  const direction = order === "asc" ? asc : desc;
  const orderBy =
    sort === "costUsd"
      ? direction(schema.segmentations.costMicros)
      : sort === "creditsCharged"
        ? direction(schema.segmentations.creditsCharged)
        : sort === "objectCount"
          ? direction(schema.segmentations.objectCount)
          : direction(schema.segmentations.createdAt);

  const [rows, [count], statusRows, [stuckRow], [spendRow], modelRows] = await Promise.all([
    db
      .select({
        segmentation: schema.segmentations,
        userEmail: schema.users.email,
      })
      .from(schema.segmentations)
      .innerJoin(schema.users, eq(schema.segmentations.userId, schema.users.id))
      .where(where)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.segmentations)
      .innerJoin(schema.users, eq(schema.segmentations.userId, schema.users.id))
      .where(where),
    db
      .select({ status: schema.segmentations.status, count: sql<number>`count(*)::int` })
      .from(schema.segmentations)
      .groupBy(schema.segmentations.status),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.segmentations)
      .where(
        and(eq(schema.segmentations.status, "pending"), sql`${schema.segmentations.createdAt} < ${stuckBeforeSql(stuckMinutes)}`),
      ),
    db
      .select({
        spentMicros: sql<number>`coalesce(sum(${schema.segmentations.costMicros}) filter (where ${schema.segmentations.status} <> 'failed'), 0)::bigint`,
      })
      .from(schema.segmentations),
    db
      .select({
        model: schema.segmentations.model,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.segmentations)
      .groupBy(schema.segmentations.model)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
  ]);

  const byStatus: Record<SegmentationStatus, number> = { pending: 0, succeeded: 0, failed: 0 };
  for (const row of statusRows) byStatus[row.status as SegmentationStatus] = row.count;

  return c.json({
    segmentations: rows.map(({ segmentation, userEmail }) => toAdminSegmentation(segmentation, userEmail, stuckMinutes)),
    total: count?.total ?? 0,
    summary: {
      total: byStatus.pending + byStatus.succeeded + byStatus.failed,
      byStatus,
      pending: byStatus.pending,
      stuckCount: stuckRow?.count ?? 0,
      stuckTimeoutMinutes: stuckMinutes,
      failed: byStatus.failed,
      spentUsd: Number(spendRow?.spentMicros ?? 0) / MICROS_PER_USD,
      models: modelRows.map((row) => ({ model: row.model, count: row.count })),
    },
  });
});

admin.get("/segmentations/:id", async (c) => {
  const denied = denyUnless(c, "segmentations.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const settings = await getSettings(db);
  const id = z.string().uuid().parse(c.req.param("id"));
  const [row] = await db
    .select({
      segmentation: schema.segmentations,
      userEmail: schema.users.email,
    })
    .from(schema.segmentations)
    .innerJoin(schema.users, eq(schema.segmentations.userId, schema.users.id))
    .where(eq(schema.segmentations.id, id));
  if (!row) return c.json({ error: "Segmentation not found" }, 404);
  return c.json({
    segmentation: toAdminSegmentation(row.segmentation, row.userEmail, settings.stuckTimeoutMinutes),
  });
});

/** Retries a failed or stuck automatic selection without silently charging the customer again. */
admin.post("/segmentations/:id/recover", async (c) => {
  const denied = denyUnless(c, "segmentations.recover"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const [segmentation] = await db.select().from(schema.segmentations).where(eq(schema.segmentations.id, id)).limit(1);
  if (!segmentation) return c.json({ error: "Segmentation not found" }, 404);
  const settings = await getSettings(db);
  const stuck = isSegStuck(segmentation.status as SegmentationStatus, segmentation.createdAt, settings.stuckTimeoutMinutes);
  if (segmentation.status !== "failed" && !stuck) return c.json({ error: "Only failed or stuck segmentations can be recovered" }, 409);
  const [pending] = await db.update(schema.segmentations).set({ status: "pending", errorMessage: null }).where(eq(schema.segmentations.id, id)).returning();
  const result = await runSegmentation(c.env, db, pending!, new URL(c.req.url).origin, effectiveEngineMode(c.env, settings));
  await recordAdminEvent(db, {
    actorId: c.get("admin").id,
    action: "segmentation.recover",
    targetType: "segmentation",
    targetId: id,
    summary: `Recovered segmentation ${id}`,
    detail: { statusBefore: segmentation.status, statusAfter: result.segmentation.status },
  });
  if (result.segmentation.status === "succeeded") {
    await resolveIncidentsForSource(db, "segmentation", id, c.get("admin").id, "Segmentation recovery completed successfully");
  }
  const [owner] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, result.segmentation.userId)).limit(1);
  return c.json({ segmentation: toAdminSegmentation(result.segmentation, owner?.email ?? "Unknown", settings.stuckTimeoutMinutes) });
});

// ── Incident center ──────────────────────────────────────────────────────────────

async function incidentResponse(db: Database, status?: "open" | "acknowledged" | "resolved"): Promise<AdminIncidentsResponse> {
  const incidents = await db.select().from(schema.incidents).where(status ? eq(schema.incidents.status, status) : undefined).orderBy(desc(schema.incidents.lastSeenAt)).limit(100);
  const ids = incidents.map((incident) => incident.id);
  const [events, notifications, staff, allIncidents] = await Promise.all([
    ids.length ? db.select().from(schema.incidentEvents).where(inArray(schema.incidentEvents.incidentId, ids)).orderBy(desc(schema.incidentEvents.createdAt)) : Promise.resolve([]),
    ids.length ? db.select().from(schema.incidentNotifications).where(inArray(schema.incidentNotifications.incidentId, ids)).orderBy(desc(schema.incidentNotifications.attemptedAt)) : Promise.resolve([]),
    db.select({ id: schema.users.id, email: schema.users.email, role: schema.users.role }).from(schema.users).where(and(inArray(schema.users.role, ["support", "billing", "admin"]), eq(schema.users.disabled, false))).orderBy(asc(schema.users.email)),
    db.select({ status: schema.incidents.status, severity: schema.incidents.severity, count: sql<number>`count(*)::int` }).from(schema.incidents).groupBy(schema.incidents.status, schema.incidents.severity),
  ]);
  const peopleIds = new Set<string>();
  for (const incident of incidents) [incident.ownerId, incident.acknowledgedBy, incident.resolvedBy].forEach((id) => { if (id) peopleIds.add(id); });
  for (const event of events) if (event.actorId) peopleIds.add(event.actorId);
  const people = peopleIds.size ? await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, [...peopleIds])) : [];
  const emailById = new Map(people.map((person) => [person.id, person.email]));
  const eventsByIncident = new Map<string, typeof events>();
  for (const event of events) eventsByIncident.set(event.incidentId, [...(eventsByIncident.get(event.incidentId) ?? []), event]);
  const notificationsByIncident = new Map<string, typeof notifications>();
  for (const notification of notifications) notificationsByIncident.set(notification.incidentId, [...(notificationsByIncident.get(notification.incidentId) ?? []), notification]);
  const summary = { open: 0, acknowledged: 0, resolved: 0, criticalOpen: 0, failedNotifications: 0 };
  for (const row of allIncidents) {
    summary[row.status as "open" | "acknowledged" | "resolved"] += row.count;
    if ((row.status === "open" || row.status === "acknowledged") && row.severity === "critical") summary.criticalOpen += row.count;
  }
  summary.failedNotifications = notifications.filter((notification) => notification.status === "failed").length;
  return {
    incidents: incidents.map((incident) => ({
      id: incident.id,
      sourceType: incident.sourceType as AdminIncidentsResponse["incidents"][number]["sourceType"],
      sourceId: incident.sourceId,
      severity: incident.severity as AdminIncidentsResponse["incidents"][number]["severity"],
      status: incident.status as AdminIncidentsResponse["incidents"][number]["status"],
      title: incident.title,
      summary: incident.summary,
      context: incident.context ?? null,
      ownerId: incident.ownerId,
      ownerEmail: incident.ownerId ? emailById.get(incident.ownerId) ?? null : null,
      acknowledgement: incident.acknowledgedAt ? { at: incident.acknowledgedAt.toISOString(), byEmail: incident.acknowledgedBy ? emailById.get(incident.acknowledgedBy) ?? null : null } : null,
      resolution: incident.resolvedAt ? { at: incident.resolvedAt.toISOString(), byEmail: incident.resolvedBy ? emailById.get(incident.resolvedBy) ?? null : null, note: incident.resolutionNote } : null,
      occurrenceCount: incident.occurrenceCount,
      firstSeenAt: incident.firstSeenAt.toISOString(),
      lastSeenAt: incident.lastSeenAt.toISOString(),
      events: (eventsByIncident.get(incident.id) ?? []).slice(0, 8).map((event) => ({ id: event.id, action: event.action as AdminIncidentsResponse["incidents"][number]["events"][number]["action"], note: event.note, actorEmail: event.actorId ? emailById.get(event.actorId) ?? null : null, createdAt: event.createdAt.toISOString() })),
      notifications: (notificationsByIncident.get(incident.id) ?? []).slice(0, 5).map((notification) => ({ id: notification.id, status: notification.status as "delivered" | "failed" | "skipped", destination: notification.destination, failureMessage: notification.failureMessage, attemptedAt: notification.attemptedAt.toISOString(), deliveredAt: notification.deliveredAt?.toISOString() ?? null })),
    })),
    staff,
    summary,
  };
}

admin.get("/incidents", async (c) => {
  const denied = denyUnless(c, "incidents.read"); if (denied) return c.json(denied, 403);
  const status = z.enum(["open", "acknowledged", "resolved"]).optional().parse(c.req.query("status") || undefined);
  return c.json(await incidentResponse(c.get("db"), status));
});

admin.post("/incidents/sync", async (c) => {
  const denied = denyUnless(c, "incidents.manage"); if (denied) return c.json(denied, 403);
  return c.json(await syncOperationalIncidents(c.env, c.get("db")));
});

async function managedIncident(c: { get: (key: "db") => Database }, id: string) {
  const [incident] = await c.get("db").select().from(schema.incidents).where(eq(schema.incidents.id, id)).limit(1);
  return incident;
}

admin.post("/incidents/:id/assign", async (c) => {
  const denied = denyUnless(c, "incidents.manage"); if (denied) return c.json(denied, 403);
  const id = z.string().uuid().parse(c.req.param("id"));
  const { ownerId } = z.object({ ownerId: z.string().uuid().nullable() }).parse(await c.req.json());
  const incident = await managedIncident(c, id); if (!incident) return c.json({ error: "Incident not found" }, 404);
  if (ownerId) {
    const [owner] = await c.get("db").select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.id, ownerId), eq(schema.users.disabled, false), inArray(schema.users.role, ["support", "billing", "admin"]))).limit(1);
    if (!owner) return c.json({ error: "Owner must be active operations staff" }, 409);
  }
  await c.get("db").update(schema.incidents).set({ ownerId, updatedAt: new Date() }).where(eq(schema.incidents.id, id));
  await recordIncidentEvent(c.get("db"), id, "assigned", c.get("admin").id, ownerId ? "Incident owner changed" : "Incident unassigned", { ownerId });
  await recordAdminEvent(c.get("db"), { actorId: c.get("admin").id, action: "incident.update", targetType: "incident", targetId: id, summary: ownerId ? "Assigned incident" : "Unassigned incident", detail: { ownerId } });
  return c.json({ id, ownerId });
});

admin.post("/incidents/:id/acknowledge", async (c) => {
  const denied = denyUnless(c, "incidents.manage"); if (denied) return c.json(denied, 403);
  const id = z.string().uuid().parse(c.req.param("id"));
  const { note } = z.object({ note: z.string().trim().max(500).optional() }).parse(await c.req.json());
  const incident = await managedIncident(c, id); if (!incident) return c.json({ error: "Incident not found" }, 404);
  if (incident.status === "resolved") return c.json({ error: "Resolved incidents cannot be acknowledged" }, 409);
  await c.get("db").update(schema.incidents).set({ status: "acknowledged", acknowledgedAt: new Date(), acknowledgedBy: c.get("admin").id, updatedAt: new Date() }).where(eq(schema.incidents.id, id));
  await recordIncidentEvent(c.get("db"), id, "acknowledged", c.get("admin").id, note ?? "Incident acknowledged");
  await recordAdminEvent(c.get("db"), { actorId: c.get("admin").id, action: "incident.update", targetType: "incident", targetId: id, summary: "Acknowledged incident" });
  return c.json({ id, status: "acknowledged" });
});

admin.post("/incidents/:id/severity", async (c) => {
  const denied = denyUnless(c, "incidents.manage"); if (denied) return c.json(denied, 403);
  const id = z.string().uuid().parse(c.req.param("id"));
  const { severity } = z.object({ severity: z.enum(["low", "medium", "high", "critical"]) }).parse(await c.req.json());
  const incident = await managedIncident(c, id); if (!incident) return c.json({ error: "Incident not found" }, 404);
  await c.get("db").update(schema.incidents).set({ severity, updatedAt: new Date() }).where(eq(schema.incidents.id, id));
  await recordIncidentEvent(c.get("db"), id, "reopened", c.get("admin").id, `Severity set to ${severity}`, { severity });
  return c.json({ id, severity });
});

admin.post("/incidents/:id/resolve", async (c) => {
  const denied = denyUnless(c, "incidents.manage"); if (denied) return c.json(denied, 403);
  const id = z.string().uuid().parse(c.req.param("id"));
  const { note } = z.object({ note: z.string().trim().min(3).max(1000) }).parse(await c.req.json());
  const incident = await managedIncident(c, id); if (!incident) return c.json({ error: "Incident not found" }, 404);
  await c.get("db").update(schema.incidents).set({ status: "resolved", resolvedAt: new Date(), resolvedBy: c.get("admin").id, resolutionNote: note, updatedAt: new Date() }).where(eq(schema.incidents.id, id));
  await recordIncidentEvent(c.get("db"), id, "resolved", c.get("admin").id, note);
  await recordAdminEvent(c.get("db"), { actorId: c.get("admin").id, action: "incident.update", targetType: "incident", targetId: id, summary: "Resolved incident", detail: { note } });
  return c.json({ id, status: "resolved" });
});

admin.post("/incidents/:id/notify", async (c) => {
  const denied = denyUnless(c, "incidents.manage"); if (denied) return c.json(denied, 403);
  const id = z.string().uuid().parse(c.req.param("id"));
  const incident = await managedIncident(c, id); if (!incident) return c.json({ error: "Incident not found" }, 404);
  const status = await deliverIncidentNotification(c.env, c.get("db"), incident, "Operator requested notification retry");
  return c.json({ id, notification: status });
});

// ── Audit ────────────────────────────────────────────────────────────────────────

function toAdminAuditEvent(event: typeof schema.adminEvents.$inferSelect, actorEmail: string): AdminAuditEvent {
  return {
    id: event.id,
    actorId: event.actorId,
    actorEmail,
    action: event.action as AdminAuditAction,
    targetType: event.targetType,
    targetId: event.targetId,
    summary: event.summary,
    detail: event.detail,
    createdAt: event.createdAt.toISOString(),
  };
}

admin.get("/audit", async (c) => {
  const denied = denyUnless(c, "audit.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const { limit, offset } = paging.parse(c.req.query());
  const action = z
    .enum(["credits.adjust", "user.update", "settings.update", "render.refresh", "render.cancel", "segmentation.recover", "incident.update", "billing.webhook", "billing.payment", "billing.entitlement", "customer.note", "customer.tag", "user.session_revoke", "approval.request", "approval.approve", "approval.reject", "approval.execute", "audit.export"])
    .optional()
    .parse(c.req.query("action") || undefined) as AdminAuditAction | undefined;
  const actorId = z.string().uuid().optional().parse(c.req.query("actorId") || undefined);
  const range = z.enum(["today", "7d", "30d"]).optional().parse(c.req.query("range") || undefined) as AdminAuditRange | undefined;
  const search = c.req.query("search")?.trim();

  const actor = schema.users;
  const targetUser = alias(schema.users, "audit_target");
  /** target_id is text (user uuids or "1" for settings) — compare as text to avoid uuid=text errors. */
  const targetJoinOn = and(
    eq(schema.adminEvents.targetType, "user"),
    sql`${schema.adminEvents.targetId} = ${targetUser.id}::text`,
  );

  const filters: SQL[] = [];
  if (action) filters.push(eq(schema.adminEvents.action, action));
  if (actorId) filters.push(eq(schema.adminEvents.actorId, actorId));
  if (range === "today") {
    filters.push(gte(schema.adminEvents.createdAt, sql`date_trunc('day', now() at time zone 'utc') at time zone 'utc'`));
  } else if (range === "7d") {
    filters.push(gte(schema.adminEvents.createdAt, sql`now() - interval '7 days'`));
  } else if (range === "30d") {
    filters.push(gte(schema.adminEvents.createdAt, sql`now() - interval '30 days'`));
  }
  if (search) {
    const escaped = `%${search.replace(/[%_\\]/g, "\\$&")}%`;
    filters.push(or(ilike(schema.adminEvents.summary, escaped), ilike(actor.email, escaped), ilike(targetUser.email, escaped))!);
  }
  const where = filters.length ? and(...filters) : undefined;

  // Only join the target user when searching by email; otherwise keep the list query simple.
  const listBase = db
    .select({
      event: schema.adminEvents,
      actorEmail: actor.email,
    })
    .from(schema.adminEvents)
    .innerJoin(actor, eq(schema.adminEvents.actorId, actor.id));
  const listQuery = search ? listBase.leftJoin(targetUser, targetJoinOn) : listBase;

  const countBase = db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.adminEvents)
    .innerJoin(actor, eq(schema.adminEvents.actorId, actor.id));
  const countQuery = search ? countBase.leftJoin(targetUser, targetJoinOn) : countBase;

  const [rows, [count], [totals], actionRows, actorRows, [lastSettings]] = await Promise.all([
    listQuery.where(where).orderBy(desc(schema.adminEvents.createdAt)).limit(limit).offset(offset),
    countQuery.where(where),
    db
      .select({
        total: sql<number>`count(*)::int`,
        last7Days: sql<number>`count(*) filter (where ${schema.adminEvents.createdAt} >= now() - interval '7 days')::int`,
        uniqueActors: sql<number>`count(distinct ${schema.adminEvents.actorId})::int`,
      })
      .from(schema.adminEvents),
    db
      .select({
        action: schema.adminEvents.action,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.adminEvents)
      .groupBy(schema.adminEvents.action),
    db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.adminEvents)
      .innerJoin(schema.users, eq(schema.adminEvents.actorId, schema.users.id))
      .groupBy(schema.users.id, schema.users.email)
      .orderBy(desc(sql`count(*)`))
      .limit(20),
    db
      .select({ createdAt: schema.adminEvents.createdAt })
      .from(schema.adminEvents)
      .where(eq(schema.adminEvents.action, "settings.update"))
      .orderBy(desc(schema.adminEvents.createdAt))
      .limit(1),
  ]);

  const byAction: Record<AdminAuditAction, number> = {
    "credits.adjust": 0,
    "user.update": 0,
    "settings.update": 0,
    "render.refresh": 0,
    "render.cancel": 0,
    "segmentation.recover": 0,
    "incident.update": 0,
    "billing.webhook": 0,
    "billing.payment": 0,
    "billing.entitlement": 0,
    "customer.note": 0,
    "customer.tag": 0,
    "user.session_revoke": 0,
    "approval.request": 0,
    "approval.approve": 0,
    "approval.reject": 0,
    "approval.execute": 0,
    "audit.export": 0,
  };
  for (const row of actionRows) {
    if (row.action in byAction) byAction[row.action as AdminAuditAction] = row.count;
  }

  return c.json({
    events: rows.map(({ event, actorEmail }) => toAdminAuditEvent(event, actorEmail)),
    total: count?.total ?? 0,
    summary: {
      total: totals?.total ?? 0,
      last7Days: totals?.last7Days ?? 0,
      byAction,
      uniqueActors: totals?.uniqueActors ?? 0,
      lastSettingsAt: lastSettings?.createdAt ? lastSettings.createdAt.toISOString() : null,
      actors: actorRows.map((row) => ({ id: row.id, email: row.email, count: row.count })),
    },
  });
});

/** Creates a retained CSV snapshot; later reads return the exact stored bytes, not a regenerated report. */
admin.post("/audit/exports", async (c) => {
  const denied = denyUnless(c, "audit.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db"); const { reason } = z.object({ reason: z.string().trim().min(1).max(300) }).parse(await c.req.json());
  const actor = alias(schema.users, "audit_export_actor");
  const rows = await db.select({ id: schema.adminEvents.id, createdAt: schema.adminEvents.createdAt, action: schema.adminEvents.action, actorEmail: actor.email, targetType: schema.adminEvents.targetType, targetId: schema.adminEvents.targetId, summary: schema.adminEvents.summary }).from(schema.adminEvents).innerJoin(actor, eq(schema.adminEvents.actorId, actor.id)).orderBy(asc(schema.adminEvents.createdAt));
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const content = ["id,created_at,action,actor_email,target_type,target_id,summary", ...rows.map((row) => [row.id, row.createdAt.toISOString(), row.action, row.actorEmail, row.targetType, row.targetId, row.summary].map(escape).join(","))].join("\n");
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const [exported] = await db.insert(schema.auditExports).values({ requestedBy: c.get("admin").id, reason, sha256, content }).returning();
  await recordAdminEvent(db, { actorId: c.get("admin").id, action: "audit.export", targetType: "audit_export", targetId: exported!.id, summary: `Created immutable audit export (${rows.length} rows)`, detail: { sha256, reason } });
  return c.json({ id: exported!.id, sha256, rows: rows.length });
});

admin.get("/audit/exports/:id", async (c) => {
  const denied = denyUnless(c, "audit.read"); if (denied) return c.json(denied, 403);
  const id = z.string().uuid().parse(c.req.param("id"));
  const [exported] = await c.get("db").select().from(schema.auditExports).where(eq(schema.auditExports.id, id));
  if (!exported) return c.json({ error: "Audit export not found" }, 404);
  c.header("Content-Type", "text/csv; charset=utf-8"); c.header("Content-Disposition", `attachment; filename=renvia-audit-${id}.csv`); c.header("X-Content-SHA256", exported.sha256);
  return c.body(exported.content);
});
