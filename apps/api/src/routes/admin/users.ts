import { Hono } from "hono";
import { and, asc, desc, eq, ilike, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@renvia/db";
import type { AdminUserOrder, AdminUserSort } from "@renvia/types";
import { denyUnless } from "./permissions.js";
import { userStats, toAdminUser, paging } from "./shared.js";
import type { AdminContext } from "./context.js";

export const usersRoutes = new Hono<AdminContext>();

usersRoutes.get("/users", async (c) => {
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
