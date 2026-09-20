import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { and, asc, desc, eq, gte, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { createDb, schema, type Database } from "@renvia/db";
import type {
  AdminAuditAction,
  AdminAuditEvent,
  AdminAuditRange,
  AdminBulkGrantCreditsResponse,
  AdminCreditDirection,
  AdminCreditEntry,
  AdminCreditOrder,
  AdminCreditSort,
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
} from "@renvia/types";
import type { AuthVariables, Env } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrCreateUser } from "../lib/users.js";
import { modelsFor } from "../lib/models.js";
import { getSettings, effectiveBudgetUsd, effectiveEngineMode, type AppSettingsRow } from "../lib/settings.js";

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

/** Only active admins get past this — the role lives in our users table, not in Clerk. */
const requireAdmin = createMiddleware<AdminContext>(async (c, next) => {
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, c.get("auth").clerkId);
  if (user.role !== "admin" || user.disabled) {
    return c.json({ error: "Forbidden" }, 403);
  }
  c.set("admin", user);
  c.set("db", db);
  await next();
});

admin.use("*", requireAuth, requireAdmin);

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
      createdAt: schema.users.createdAt,
      renderCount: sql<number>`coalesce(${stats.renderCount}, 0)::int`,
      spentMicros: sql<number>`coalesce(${stats.spentMicros}, 0)::bigint`,
      lastRenderAt: stats.lastRenderAt,
    })
    .from(schema.users)
    .leftJoin(stats, eq(stats.userId, schema.users.id));
}

type AdminUserRow = Awaited<ReturnType<ReturnType<typeof selectAdminUsers>["execute"]>>[number];

function toAdminUser({ spentMicros, lastRenderAt, createdAt, ...row }: AdminUserRow): AdminUser {
  return {
    ...row,
    spentUsd: Number(spentMicros) / MICROS_PER_USD,
    createdAt: createdAt.toISOString(),
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

function toAdminRender(
  { render, projectId, projectName, userId, userEmail }: AdminRenderRow,
  stuckMinutes = 15,
): AdminRender {
  return {
    id: render.id,
    kind: render.settings?.edit ? "edit" : "render",
    status: render.status,
    model: render.model,
    costUsd: render.costMicros / MICROS_PER_USD,
    creditsCharged: render.creditsCharged,
    prompt: render.prompt,
    style: render.style,
    resolution: render.resolution,
    viewLabel: render.viewLabel,
    sourceImageUrl: render.sourceImageUrl,
    resultImageUrl: render.resultImageUrl,
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
  ] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        newLast7Days: sql<number>`count(*) filter (where ${schema.users.createdAt} >= now() - interval '7 days')::int`,
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
        granted: sql<number>`coalesce(sum(${schema.creditLedger.amount}) filter (where ${schema.creditLedger.amount} > 0 and ${schema.creditLedger.reason} <> 'render_refund'), 0)::int`,
        spent: sql<number>`coalesce(-sum(${schema.creditLedger.amount}) filter (where ${schema.creditLedger.reason} in ('render', 'render_refund', 'segment', 'segment_refund')), 0)::int`,
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
  ]);

  const byStatus: Record<RenderStatus, number> = { pending: 0, processing: 0, succeeded: 0, failed: 0 };
  for (const row of statusRows) byStatus[row.status] = row.count;
  const totalRenders = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
  const finished = byStatus.succeeded + byStatus.failed;
  const failureRate = finished > 0 ? byStatus.failed / finished : 0;
  const spentMicros = modelRows.reduce((sum, row) => sum + Number(row.spentMicros), 0);
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

  const response: AdminOverviewResponse = {
    users: { total: users!.total, newLast7Days: users!.newLast7Days, disabled: users!.disabled },
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
    credits: { outstanding: users!.outstanding, granted: credits?.granted ?? 0, spent: credits?.spent ?? 0 },
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
    recentFailures: failureRows.map((row) => {
      const render = toAdminRender(row, settings.stuckTimeoutMinutes);
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
    }),
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
  const db = c.get("db");
  const { limit, offset } = paging.parse(c.req.query());
  const search = c.req.query("search")?.trim();
  const role = z.enum(["user", "admin"]).optional().parse(c.req.query("role") || undefined);
  const status = z.enum(["active", "disabled"]).optional().parse(c.req.query("status") || undefined);
  const balance = z.enum(["low", "zero"]).optional().parse(c.req.query("balance") || undefined);
  const sort = z
    .enum(["createdAt", "lastRenderAt", "creditBalance", "renderCount", "spentUsd"])
    .default("createdAt")
    .parse(c.req.query("sort") || "createdAt") as AdminUserSort;
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

admin.post("/users/bulk-credits", async (c) => {
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
  if (existing.length === 0) return c.json({ error: "No matching users" }, 404);

  for (const user of existing) {
    await db.batch([
      db
        .update(schema.users)
        .set({ creditBalance: sql`${schema.users.creditBalance} + ${body.amount}` })
        .where(eq(schema.users.id, user.id)),
      db.insert(schema.creditLedger).values({
        userId: user.id,
        amount: body.amount,
        reason: "admin_grant",
        note: body.note,
        actorId: adminUser.id,
      }),
    ]);
  }

  await recordAdminEvent(db, {
    actorId: adminUser.id,
    action: "credits.adjust",
    targetType: "users",
    targetId: null,
    summary: `Granted ${body.amount} credits to ${existing.length} users`,
    detail: { amount: body.amount, note: body.note, userIds: existing.map((user) => user.id), emails: existing.map((user) => user.email) },
  });

  const response: AdminBulkGrantCreditsResponse = { updated: existing.length };
  return c.json(response);
});

admin.get("/users/:id", async (c) => {
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const [user, settings] = await Promise.all([findAdminUser(db, id), getSettings(db)]);
  if (!user) return c.json({ error: "Not found" }, 404);

  const actor = alias(schema.users, "actor");
  const [ledgerRows, renderRows] = await Promise.all([
    db
      .select({ entry: schema.creditLedger, actorEmail: actor.email })
      .from(schema.creditLedger)
      .leftJoin(actor, eq(schema.creditLedger.actorId, actor.id))
      .where(eq(schema.creditLedger.userId, id))
      .orderBy(desc(schema.creditLedger.createdAt))
      .limit(50),
    selectAdminRenders(db).where(eq(schema.users.id, id)).orderBy(desc(schema.renders.createdAt)).limit(20),
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
  return c.json({
    user,
    ledger,
    renders: renderRows.map((row) => toAdminRender(row, settings.stuckTimeoutMinutes)),
  });
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
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const { amount, note } = grantSchema.parse(await c.req.json());
  const adminUser = c.get("admin");

  try {
    // Balance and ledger entry commit together; a removal past zero rolls both back.
    const [updated] = await db.batch([
      db
        .update(schema.users)
        .set({ creditBalance: sql`${schema.users.creditBalance} + ${amount}` })
        .where(eq(schema.users.id, id))
        .returning({ id: schema.users.id }),
      db.insert(schema.creditLedger).values({ userId: id, amount, reason: "admin_grant", note, actorId: adminUser.id }),
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

  const user = await findAdminUser(db, id);
  await recordAdminEvent(db, {
    actorId: adminUser.id,
    action: "credits.adjust",
    targetType: "user",
    targetId: id,
    summary: `${amount > 0 ? "Granted" : "Removed"} ${Math.abs(amount)} credits for ${user?.email ?? id}`,
    detail: { amount, note, email: user?.email ?? null },
  });

  return c.json({ user });
});

const updateUserSchema = z
  .object({ disabled: z.boolean().optional(), role: z.enum(["user", "admin"]).optional() })
  .refine((body) => body.disabled !== undefined || body.role !== undefined, "Nothing to update");

admin.patch("/users/:id", async (c) => {
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

  const [updated] = await db
    .update(schema.users)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(schema.users.id, id))
    .returning({ id: schema.users.id });
  if (!updated) return c.json({ error: "Not found" }, 404);

  const user = await findAdminUser(db, id);
  const parts: string[] = [];
  if (body.disabled !== undefined && body.disabled !== before.disabled) {
    parts.push(body.disabled ? "disabled account" : "enabled account");
  }
  if (body.role !== undefined && body.role !== before.role) {
    parts.push(`role → ${body.role}`);
  }
  await recordAdminEvent(db, {
    actorId: adminUser.id,
    action: "user.update",
    targetType: "user",
    targetId: id,
    summary: `${before.email}: ${parts.join(", ") || "updated"}`,
    detail: { before: { role: before.role, disabled: before.disabled }, after: body },
  });

  return c.json({ user });
});

// ── Renders ──────────────────────────────────────────────────────────────────────

admin.get("/renders", async (c) => {
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
    renders: rows.map((row) => toAdminRender(row, stuckMinutes)),
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
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const settings = await getSettings(db);
  const [row] = await selectAdminRenders(db).where(eq(schema.renders.id, id));
  if (!row) return c.json({ error: "Render not found" }, 404);
  return c.json({ render: toAdminRender(row, settings.stuckTimeoutMinutes) });
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
  const db = c.get("db");
  return c.json(await toAdminSettings(c.env, db, await getSettings(db)));
});

const updateSettingsSchema = z
  .object({
    signupBonusCredits: z.number().int().min(0).max(1000).optional(),
    dailyRenderLimit: z.number().int().min(1).max(10_000).nullable().optional(),
    dailySegmentLimit: z.number().int().min(1).max(10_000).nullable().optional(),
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

function toAdminProject(row: {
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
}): AdminProject {
  return {
    id: row.id,
    name: row.name,
    thumbnailUrl: row.thumbnailUrl,
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
    projects: rows.map(toAdminProject),
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
    project: toAdminProject(row),
    renders: renders.map((render) => toAdminRender(render, settings.stuckTimeoutMinutes)),
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
  const db = c.get("db");
  const { limit, offset } = paging.parse(c.req.query());
  const action = z
    .enum(["credits.adjust", "user.update", "settings.update"])
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
