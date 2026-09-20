import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { and, asc, desc, eq, gte, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { createDb, schema, type Database } from "@renvia/db";
import type {
  AdminAuditAction,
  AdminAuditEvent,
  AdminBulkGrantCreditsResponse,
  AdminCreditEntry,
  AdminLedgerEntry,
  AdminOverviewResponse,
  AdminProject,
  AdminRender,
  AdminSegmentation,
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
import { getSettings, effectiveBudgetUsd, effectiveEngineMode, type AppSettingsRow } from "../lib/settings.js";

type UserRow = typeof schema.users.$inferSelect;
type AdminContext = { Bindings: Env; Variables: AuthVariables & { admin: UserRow; db: Database } };

export const admin = new Hono<AdminContext>();

const MICROS_PER_USD = 1_000_000;

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
      projectName: schema.projects.name,
      userId: schema.users.id,
      userEmail: schema.users.email,
    })
    .from(schema.renders)
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .innerJoin(schema.users, eq(schema.projects.ownerId, schema.users.id));
}

type AdminRenderRow = Awaited<ReturnType<ReturnType<typeof selectAdminRenders>["execute"]>>[number];

function toAdminRender({ render, projectName, userId, userEmail }: AdminRenderRow): AdminRender {
  return {
    id: render.id,
    kind: render.settings?.edit ? "edit" : "render",
    status: render.status,
    model: render.model,
    costUsd: render.costMicros / MICROS_PER_USD,
    creditsCharged: render.creditsCharged,
    prompt: render.prompt,
    style: render.style,
    viewLabel: render.viewLabel,
    sourceImageUrl: render.sourceImageUrl,
    resultImageUrl: render.resultImageUrl,
    errorMessage: render.errorMessage,
    createdAt: render.createdAt.toISOString(),
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
          sql`${schema.renders.updatedAt} < now() - interval '15 minutes'`,
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
  if (budgetRatio >= 0.9) {
    alerts.push({
      id: "budget_critical",
      severity: "critical",
      message: `Budget nearly exhausted — ${formatUsdAlert(spentUsd)} of ${formatUsdAlert(budgetUsd)} used.`,
      href: "/settings",
    });
  } else if (budgetRatio >= 0.7) {
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
      message: `${stuckCount} ${stuckCount === 1 ? "render has" : "renders have"} been pending or processing for over 15 minutes.`,
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
    },
    spend: {
      mode,
      spentUsd,
      budgetUsd,
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
      const render = toAdminRender(row);
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
  const user = await findAdminUser(db, id);
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
  return c.json({ user, ledger, renders: renderRows.map(toAdminRender) });
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
  const { limit, offset } = paging.parse(c.req.query());
  const status = z.enum(["pending", "processing", "succeeded", "failed"]).optional().parse(c.req.query("status") || undefined);
  const userId = z.string().uuid().optional().parse(c.req.query("userId") || undefined);

  const filters: SQL[] = [];
  if (status) filters.push(eq(schema.renders.status, status));
  if (userId) filters.push(eq(schema.users.id, userId));
  const where = filters.length ? and(...filters) : undefined;

  const [rows, [count]] = await Promise.all([
    selectAdminRenders(db).where(where).orderBy(desc(schema.renders.createdAt)).limit(limit).offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.renders)
      .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
      .innerJoin(schema.users, eq(schema.projects.ownerId, schema.users.id))
      .where(where),
  ]);
  return c.json({ renders: rows.map(toAdminRender), total: count?.total ?? 0 });
});

// ── Settings ─────────────────────────────────────────────────────────────────────

function toAdminSettings(env: Env, row: AppSettingsRow): AdminSettings {
  return {
    signupBonusCredits: row.signupBonusCredits,
    dailyRenderLimit: row.dailyRenderLimit,
    falMode: row.falMode,
    falBudgetUsd: row.falBudgetUsd === null ? null : Number(row.falBudgetUsd),
    effectiveMode: effectiveEngineMode(env, row),
    effectiveBudgetUsd: effectiveBudgetUsd(env, row),
    updatedAt: row.updatedAt.toISOString(),
  };
}

admin.get("/settings", async (c) => {
  return c.json(toAdminSettings(c.env, await getSettings(c.get("db"))));
});

const updateSettingsSchema = z
  .object({
    signupBonusCredits: z.number().int().min(0).max(1000).optional(),
    dailyRenderLimit: z.number().int().min(1).max(10_000).nullable().optional(),
    falMode: z.enum(["mock", "dev", "prod"]).nullable().optional(),
    falBudgetUsd: z.number().min(0).max(10_000).nullable().optional(),
  })
  .strict();

admin.put("/settings", async (c) => {
  const db = c.get("db");
  const body = updateSettingsSchema.parse(await c.req.json());
  const adminUser = c.get("admin");
  const before = await getSettings(db); // ensures the row exists

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
        falMode: before.falMode,
        falBudgetUsd: before.falBudgetUsd === null ? null : Number(before.falBudgetUsd),
      },
      after: body,
    },
  });

  return c.json(toAdminSettings(c.env, updated!));
});

// ── Projects ─────────────────────────────────────────────────────────────────────

admin.get("/projects", async (c) => {
  const db = c.get("db");
  const { limit, offset } = paging.parse(c.req.query());
  const search = c.req.query("search")?.trim();
  const escaped = search ? `%${search.replace(/[%_\\]/g, "\\$&")}%` : null;
  const where = escaped ? or(ilike(schema.projects.name, escaped), ilike(schema.users.email, escaped)) : undefined;

  const renderStats = db
    .select({
      projectId: schema.renders.projectId,
      renderCount: sql<number>`count(*) filter (where ${schema.renders.status} <> 'failed')::int`.as("render_count"),
      spentMicros: sql<number>`coalesce(sum(${schema.renders.costMicros}) filter (where ${schema.renders.status} <> 'failed'), 0)::bigint`.as("spent_micros"),
      lastRenderAt: sql<Date | null>`max(${schema.renders.createdAt})`.as("last_render_at"),
    })
    .from(schema.renders)
    .groupBy(schema.renders.projectId)
    .as("project_render_stats");

  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: schema.projects.id,
        name: schema.projects.name,
        thumbnailUrl: schema.projects.thumbnailUrl,
        ownerId: schema.users.id,
        ownerEmail: schema.users.email,
        createdAt: schema.projects.createdAt,
        updatedAt: schema.projects.updatedAt,
        renderCount: sql<number>`coalesce(${renderStats.renderCount}, 0)::int`,
        spentMicros: sql<number>`coalesce(${renderStats.spentMicros}, 0)::bigint`,
        lastRenderAt: renderStats.lastRenderAt,
      })
      .from(schema.projects)
      .innerJoin(schema.users, eq(schema.projects.ownerId, schema.users.id))
      .leftJoin(renderStats, eq(renderStats.projectId, schema.projects.id))
      .where(where)
      .orderBy(desc(schema.projects.updatedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.projects)
      .innerJoin(schema.users, eq(schema.projects.ownerId, schema.users.id))
      .where(where),
  ]);

  const projects: AdminProject[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    thumbnailUrl: row.thumbnailUrl,
    ownerId: row.ownerId,
    ownerEmail: row.ownerEmail,
    renderCount: row.renderCount,
    spentUsd: Number(row.spentMicros) / MICROS_PER_USD,
    lastRenderAt: row.lastRenderAt ? new Date(row.lastRenderAt).toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  return c.json({ projects, total: count?.total ?? 0 });
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

admin.get("/credits", async (c) => {
  const db = c.get("db");
  const { limit, offset } = paging.parse(c.req.query());
  const reason = z.enum(CREDIT_REASONS).optional().parse(c.req.query("reason") || undefined);
  const userId = z.string().uuid().optional().parse(c.req.query("userId") || undefined);

  const actor = alias(schema.users, "actor");
  const filters: SQL[] = [];
  if (reason) filters.push(eq(schema.creditLedger.reason, reason));
  if (userId) filters.push(eq(schema.creditLedger.userId, userId));
  const where = filters.length ? and(...filters) : undefined;

  const [rows, [count]] = await Promise.all([
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
      .orderBy(desc(schema.creditLedger.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(schema.creditLedger).where(where),
  ]);

  const entries: AdminCreditEntry[] = rows.map(({ entry, userEmail, actorEmail }) => ({
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
  }));

  return c.json({ entries, total: count?.total ?? 0 });
});

// ── Segmentations ────────────────────────────────────────────────────────────────

admin.get("/segmentations", async (c) => {
  const db = c.get("db");
  const { limit, offset } = paging.parse(c.req.query());
  const status = z.enum(["pending", "succeeded", "failed"]).optional().parse(c.req.query("status") || undefined);
  const userId = z.string().uuid().optional().parse(c.req.query("userId") || undefined);

  const filters: SQL[] = [];
  if (status) filters.push(eq(schema.segmentations.status, status));
  if (userId) filters.push(eq(schema.segmentations.userId, userId));
  const where = filters.length ? and(...filters) : undefined;

  const [rows, [count]] = await Promise.all([
    db
      .select({
        segmentation: schema.segmentations,
        userEmail: schema.users.email,
      })
      .from(schema.segmentations)
      .innerJoin(schema.users, eq(schema.segmentations.userId, schema.users.id))
      .where(where)
      .orderBy(desc(schema.segmentations.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(schema.segmentations).where(where),
  ]);

  const segmentations: AdminSegmentation[] = rows.map(({ segmentation, userEmail }) => ({
    id: segmentation.id,
    userId: segmentation.userId,
    userEmail,
    imageUrl: segmentation.imageUrl,
    prompt: segmentation.prompt,
    point: segmentation.point,
    status: segmentation.status as SegmentationStatus,
    objectCount: segmentation.objectCount,
    model: segmentation.model,
    costUsd: segmentation.costMicros / MICROS_PER_USD,
    creditsCharged: segmentation.creditsCharged,
    errorMessage: segmentation.errorMessage,
    createdAt: segmentation.createdAt.toISOString(),
  }));

  return c.json({ segmentations, total: count?.total ?? 0 });
});

// ── Audit ────────────────────────────────────────────────────────────────────────

admin.get("/audit", async (c) => {
  const db = c.get("db");
  const { limit, offset } = paging.parse(c.req.query());
  const action = z
    .enum(["credits.adjust", "user.update", "settings.update"])
    .optional()
    .parse(c.req.query("action") || undefined);

  const where = action ? eq(schema.adminEvents.action, action) : undefined;

  const [rows, [count]] = await Promise.all([
    db
      .select({
        event: schema.adminEvents,
        actorEmail: schema.users.email,
      })
      .from(schema.adminEvents)
      .innerJoin(schema.users, eq(schema.adminEvents.actorId, schema.users.id))
      .where(where)
      .orderBy(desc(schema.adminEvents.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(schema.adminEvents).where(where),
  ]);

  const events: AdminAuditEvent[] = rows.map(({ event, actorEmail }) => ({
    id: event.id,
    actorId: event.actorId,
    actorEmail,
    action: event.action as AdminAuditAction,
    targetType: event.targetType,
    targetId: event.targetId,
    summary: event.summary,
    detail: event.detail,
    createdAt: event.createdAt.toISOString(),
  }));

  return c.json({ events, total: count?.total ?? 0 });
});
