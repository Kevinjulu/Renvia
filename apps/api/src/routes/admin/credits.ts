import { Hono } from "hono";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { schema } from "@renvia/db";
import type { AdminCreditDirection, AdminCreditEntry, AdminCreditOrder, AdminCreditSort, CreditLedgerReason } from "@renvia/types";
import { denyUnless } from "./permissions.js";
import { paging, creditFlow, balanceBreakdown } from "./shared.js";
import type { AdminContext } from "./context.js";

export const creditsRoutes = new Hono<AdminContext>();

/** Every ledger reason, so the filter can reach plan and beta rows too. A missing one fails to compile. */
const REASON_MAP: Record<CreditLedgerReason, true> = {
  signup_bonus: true, initial_grant: true, admin_grant: true, render: true, render_refund: true, segment: true, segment_refund: true,
  purchase: true, purchase_refund: true, subscription_grant: true, subscription_expiry: true,
  plan_grant: true, plan_expiry: true, promo_expiry: true, beta_grant: true, beta_expiry: true,
};
const CREDIT_REASONS = Object.keys(REASON_MAP) as [CreditLedgerReason, ...CreditLedgerReason[]];

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
    db.select(balanceBreakdown()).from(schema.users),
    db
      .select({
        ...creditFlow(),
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
      // Reason breaks ties, so reasons with the same count always come back in the same order.
      .orderBy(desc(sql`count(*)`), schema.creditLedger.reason),
  ]);

  return c.json({
    entries: rows.map(({ entry, userEmail, actorEmail }) => toAdminCreditEntry(entry, userEmail, actorEmail)),
    total: count?.total ?? 0,
    summary: {
      outstanding: balances?.outstanding ?? 0,
      outstandingBreakdown: { plan: balances?.plan ?? 0, beta: balances?.beta ?? 0, permanent: balances?.permanent ?? 0 },
      granted: flow?.granted ?? 0,
      spent: flow?.spent ?? 0,
      expired: flow?.expired ?? 0,
      removed: flow?.removed ?? 0,
      netLast7Days: flow?.netLast7Days ?? 0,
      byReason: reasonRows.map((row) => ({
        reason: row.reason as CreditLedgerReason,
        count: row.count,
        totalAmount: row.totalAmount,
      })),
    },
  });
});
