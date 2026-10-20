import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@renvia/db";
import type { AdminSecurityOverview, AdminSecurityQueueItem, FreeAllowanceStatus } from "@renvia/types";
import { promoSpendMicros } from "../../lib/promotions.js";
import { getSettings } from "../../lib/settings.js";
import { denyUnless } from "./permissions.js";
import { MICROS_PER_USD, paging } from "./shared.js";
import type { AdminContext } from "./context.js";

/**
 * The Security page: how the free-credit checks are working (overview) and the accounts waiting
 * on a decision (queue). Read-only; decisions are made on each account's page
 * (freeAllowance.ts). Analysts see emails masked.
 */
export const securityRoutes = new Hono<AdminContext>();

const STATUSES: FreeAllowanceStatus[] = ["approved", "pending", "verification_required", "review_required", "denied"];
const UTC_DAY_START = sql`date_trunc('day', now() at time zone 'utc') at time zone 'utc'`;
/** The Free plan is in force: the Free base plan with no admin-granted plan running. */
const ON_FREE_PLAN = sql`(
  (select ${schema.billingPlans.interval} from ${schema.billingPlans} where ${schema.billingPlans.id} = ${schema.userEntitlements.planId}) = 'none'
  and (${schema.userEntitlements.overridePlanId} is null or (${schema.userEntitlements.overrideEndsAt} is not null and ${schema.userEntitlements.overrideEndsAt} <= now()))
)`;

/** "architect@gmail.com" → "ar•••@gmail.com". */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 2)}•••@${domain}`;
}

securityRoutes.get("/security/overview", async (c) => {
  const denied = denyUnless(c, "security.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const [settings, statusRows, heldRows, weekRows, todayRows, dailyRows, linkRows, closedRows, promoSpent] = await Promise.all([
    getSettings(db),
    db.select({ status: schema.userEntitlements.freeAllowanceStatus, count: sql<number>`count(*)::int` }).from(schema.userEntitlements).groupBy(schema.userEntitlements.freeAllowanceStatus),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.userEntitlements)
      .where(and(sql`${schema.userEntitlements.freeAllowanceStatus} in ('verification_required', 'review_required', 'denied')`, ON_FREE_PLAN)),
    db.execute<{ signups: number; approved: number; verification: number; review: number; would_hold: number; claims_passed: number; claims_failed: number; operator: number }>(sql`
      select
        count(*) filter (where kind = 'signup')::int as signups,
        count(*) filter (where kind = 'signup' and outcome = 'approved')::int as approved,
        count(*) filter (where kind = 'signup' and outcome = 'verification_required')::int as verification,
        count(*) filter (where kind = 'signup' and outcome = 'review_required')::int as review,
        count(*) filter (where kind = 'signup' and mode = 'observe' and outcome <> 'approved')::int as would_hold,
        count(*) filter (where kind = 'claim' and outcome = 'approved')::int as claims_passed,
        count(*) filter (where kind = 'claim' and outcome <> 'approved')::int as claims_failed,
        count(*) filter (where kind = 'operator')::int as operator
      from ${schema.freeAllowanceAssessments} where created_at > now() - interval '7 days'`),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.freeAllowanceAssessments)
      .where(and(eq(schema.freeAllowanceAssessments.kind, "signup"), eq(schema.freeAllowanceAssessments.outcome, "approved"), sql`${schema.freeAllowanceAssessments.decidedBy} is null`, sql`${schema.freeAllowanceAssessments.createdAt} >= ${UTC_DAY_START}`)),
    db.execute<{ date: string; signups: number; held: number }>(sql`
      select to_char(day, 'YYYY-MM-DD') as date,
             count(a.id)::int as signups,
             count(a.id) filter (where a.outcome <> 'approved')::int as held
      from generate_series((now() at time zone 'utc')::date - 13, (now() at time zone 'utc')::date, interval '1 day') as day
      left join ${schema.freeAllowanceAssessments} a on a.kind = 'signup' and (a.created_at at time zone 'utc')::date = day::date
      group by day order by day`),
    db.select({ kind: schema.securityLinks.kind, count: sql<number>`count(*)::int` }).from(schema.securityLinks).groupBy(schema.securityLinks.kind),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.users).where(sql`${schema.users.closedAt} is not null`),
    promoSpendMicros(db),
  ]);

  const week = weekRows.rows[0];
  const statuses = Object.fromEntries(STATUSES.map((status) => [status, statusRows.find((row) => row.status === status)?.count ?? 0])) as Record<FreeAllowanceStatus, number>;
  const overview: AdminSecurityOverview = {
    mode: settings.freeAllowanceMode,
    signalsEnabled: settings.securitySignalsEnabled,
    securityHashKeyConfigured: (c.env.SECURITY_HASH_KEY?.trim().length ?? 0) >= 32,
    turnstileConfigured: Boolean(c.env.TURNSTILE_SECRET_KEY?.trim()),
    clerkWebhookConfigured: Boolean(c.env.CLERK_WEBHOOK_SECRET?.trim()),
    statuses,
    heldFreeAccounts: heldRows[0]?.count ?? 0,
    last7Days: {
      signups: week?.signups ?? 0,
      approved: week?.approved ?? 0,
      verificationRequired: week?.verification ?? 0,
      reviewRequired: week?.review ?? 0,
      wouldHold: week?.would_hold ?? 0,
      claimsPassed: week?.claims_passed ?? 0,
      claimsFailed: week?.claims_failed ?? 0,
      operatorDecisions: week?.operator ?? 0,
    },
    approvalsToday: todayRows[0]?.count ?? 0,
    dailyApprovalLimit: settings.freeAllowanceDailyApprovals,
    daily: dailyRows.rows.map((row) => ({ date: row.date, signups: Number(row.signups), held: Number(row.held) })),
    promo: { spentUsd: promoSpent / MICROS_PER_USD, budgetUsd: settings.promoBudgetUsd === null ? null : Number(settings.promoBudgetUsd) },
    links: { devices: linkRows.find((row) => row.kind === "device")?.count ?? 0, networks: linkRows.find((row) => row.kind === "network")?.count ?? 0 },
    closedAccounts: closedRows[0]?.count ?? 0,
  };
  return c.json(overview);
});

securityRoutes.get("/security/queue", async (c) => {
  const denied = denyUnless(c, "security.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const { limit, offset } = paging.parse(c.req.query());
  const status = z.enum(["review_required", "verification_required", "denied"]).default("review_required").parse(c.req.query("status") || undefined);
  const masked = c.get("admin").role === "analyst";
  const where = eq(schema.userEntitlements.freeAllowanceStatus, status);
  const latestScore = sql<number | null>`(select a.score from ${schema.freeAllowanceAssessments} a where a.user_id = ${schema.users.id} and a.score is not null order by a.created_at desc limit 1)`;
  const [rows, [count]] = await Promise.all([
    db
      .select({
        userId: schema.users.id,
        email: schema.users.email,
        status: schema.userEntitlements.freeAllowanceStatus,
        reason: schema.userEntitlements.freeAllowanceReason,
        decidedAt: schema.userEntitlements.freeAllowanceDecidedAt,
        createdAt: schema.users.createdAt,
        creditBalance: schema.users.creditBalance,
        freePlan: sql<boolean>`${ON_FREE_PLAN}`,
        score: latestScore,
      })
      .from(schema.userEntitlements)
      .innerJoin(schema.users, eq(schema.users.id, schema.userEntitlements.userId))
      .where(where)
      // Oldest decision first: the longest-waiting accounts come up first.
      .orderBy(sql`${schema.userEntitlements.freeAllowanceDecidedAt} asc nulls first`, desc(schema.users.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(schema.userEntitlements).where(where),
  ]);
  const items: AdminSecurityQueueItem[] = rows.map((row) => ({
    userId: row.userId,
    email: masked ? maskEmail(row.email) : row.email,
    status: row.status,
    reason: row.reason,
    score: row.score === null ? null : Number(row.score),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    creditBalance: row.creditBalance,
    freePlan: Boolean(row.freePlan),
  }));
  return c.json({ items, total: count?.total ?? 0 });
});
