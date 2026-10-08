import { Hono } from "hono";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { schema } from "@renvia/db";
import type { AdminCreditDirection, AdminCreditEntry, AdminCreditOrder, AdminCreditSort, CreditLedgerReason } from "@renvia/types";
import { denyUnless } from "./permissions.js";
import { paging } from "./shared.js";
import type { AdminContext } from "./context.js";

export const creditsRoutes = new Hono<AdminContext>();

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

creditsRoutes.get("/credits", async (c) => {
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
