import { eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { schema, type Database } from "@renvia/db";
import type { AdminAuditAction, AdminRender, AdminUser, RenderStatus, SegmentationStatus } from "@renvia/types";
import type { Env } from "../../index.js";
import { presentUploadUrl } from "../../lib/storage.js";

export const MICROS_PER_USD = 1_000_000;

/** SQL cutoff: rows updated/created before this are "stuck". */
export function stuckBeforeSql(minutes: number) {
  return sql`now() - (${minutes}::int * interval '1 minute')`;
}

export function isRenderStuck(status: RenderStatus, updatedAt: Date, minutes: number): boolean {
  if (status !== "pending" && status !== "processing") return false;
  return updatedAt.getTime() < Date.now() - minutes * 60 * 1000;
}

export function isSegStuck(status: SegmentationStatus, createdAt: Date, minutes: number): boolean {
  if (status !== "pending") return false;
  return createdAt.getTime() < Date.now() - minutes * 60 * 1000;
}

// ── Shared query pieces ──────────────────────────────────────────────────────────

/**
 * Per-user render stats. Failed renders were refunded, so they aren't counted as renders, but any
 * provider spend they still carry (cancelled or timed out after fal took them) is.
 */
export function userStats(db: Database) {
  return db
    .select({
      userId: schema.projects.ownerId,
      renderCount: sql<number>`count(*) filter (where ${schema.renders.status} <> 'failed')::int`.as("render_count"),
      spentMicros: sql<number>`coalesce(sum(${schema.renders.costMicros}), 0)::bigint`.as("spent_micros"),
      lastRenderAt: sql<Date | null>`max(${schema.renders.createdAt}) filter (where ${schema.renders.status} <> 'failed')`.as("last_render_at"),
    })
    .from(schema.renders)
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .groupBy(schema.projects.ownerId)
    .as("user_stats");
}

const REFUND_REASONS = sql`('render_refund', 'segment_refund')`;
const SPEND_REASONS = sql`('render', 'render_refund', 'segment', 'segment_refund')`;
const EXPIRY_REASONS = sql`('plan_expiry', 'promo_expiry', 'beta_expiry', 'subscription_expiry')`;

/**
 * The one definition of credit movement the admin shows, so every page agrees. Over the ledger,
 * granted - spent - expired - removed = the credits users hold now:
 *  - granted: everything that added credits except refunds of a charge (plans, beta, purchases, admin)
 *  - spent: charges net of their refunds
 *  - expired: plan, beta and signup credits that ran out
 *  - removed: credits an admin took away or a purchase refund reversed
 * `since` limits it to a window; omitted, it is all time.
 */
export function creditFlow(since?: SQL, suffix = "") {
  const amount = schema.creditLedger.amount;
  const reason = schema.creditLedger.reason;
  const inWindow = since ? sql` and ${schema.creditLedger.createdAt} >= ${since}` : sql``;
  return {
    granted: sql<number>`coalesce(sum(${amount}) filter (where ${amount} > 0 and ${reason} not in ${REFUND_REASONS}${inWindow}), 0)::int`.as(`granted${suffix}`),
    spent: sql<number>`coalesce(-sum(${amount}) filter (where ${reason} in ${SPEND_REASONS}${inWindow}), 0)::int`.as(`spent${suffix}`),
    expired: sql<number>`coalesce(-sum(${amount}) filter (where ${reason} in ${EXPIRY_REASONS}${inWindow}), 0)::int`.as(`expired${suffix}`),
    removed: sql<number>`coalesce(-sum(${amount}) filter (where ${amount} < 0 and ${reason} in ('admin_grant', 'purchase_refund')${inWindow}), 0)::int`.as(`removed${suffix}`),
  };
}

/** What the balances are made of: plan credits (expire at renewal), beta credits (expire with the enrollment) and the rest. */
export function balanceBreakdown() {
  const u = schema.users;
  return {
    outstanding: sql<number>`coalesce(sum(${u.creditBalance}), 0)::int`,
    plan: sql<number>`coalesce(sum(${u.planCredits}), 0)::int`,
    beta: sql<number>`coalesce(sum(${u.betaCredits}), 0)::int`,
    permanent: sql<number>`coalesce(sum(${u.creditBalance} - ${u.planCredits} - ${u.betaCredits}), 0)::int`,
  };
}

/** Per-user credits granted and spent, from the ledger (same definitions as creditFlow). */
export function userCreditStats(db: Database) {
  return db
    .select({ userId: schema.creditLedger.userId, ...creditFlow() })
    .from(schema.creditLedger)
    .groupBy(schema.creditLedger.userId)
    .as("user_credit_stats");
}

export function selectAdminUsers(db: Database) {
  const stats = userStats(db);
  const credit = userCreditStats(db);
  return db
    .select({
      id: schema.users.id,
      clerkId: schema.users.clerkId,
      email: schema.users.email,
      role: schema.users.role,
      creditBalance: schema.users.creditBalance,
      planCredits: schema.users.planCredits,
      betaCredits: schema.users.betaCredits,
      creditsGranted: sql<number>`coalesce(${credit.granted}, 0)::int`,
      creditsSpent: sql<number>`coalesce(${credit.spent}, 0)::int`,
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
    .leftJoin(credit, eq(credit.userId, schema.users.id));
}

export type AdminUserRow = Awaited<ReturnType<ReturnType<typeof selectAdminUsers>["execute"]>>[number];

export function toAdminUser({ spentMicros, lastRenderAt, lastActiveAt, createdAt, ...row }: AdminUserRow): AdminUser {
  return {
    ...row,
    spentUsd: Number(spentMicros) / MICROS_PER_USD,
    createdAt: createdAt.toISOString(),
    lastActiveAt: lastActiveAt ? new Date(lastActiveAt).toISOString() : null,
    lastRenderAt: lastRenderAt ? new Date(lastRenderAt).toISOString() : null,
  };
}

export function selectAdminRenders(db: Database) {
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

export type AdminRenderRow = Awaited<ReturnType<ReturnType<typeof selectAdminRenders>["execute"]>>[number];

export async function toAdminRender(
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

export async function findAdminUser(db: Database, id: string): Promise<AdminUser | null> {
  const [row] = await selectAdminUsers(db).where(eq(schema.users.id, id));
  return row ? toAdminUser(row) : null;
}

export const paging = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export interface AdminEventInput {
  actorId: string;
  action: AdminAuditAction;
  targetType: string;
  targetId?: string | null;
  summary: string;
  detail?: Record<string, unknown>;
}

/**
 * The audit insert as an unexecuted query, to put in the same `db.batch` as the change it
 * records: the batch is one transaction, so a change can't commit without its audit row.
 */
export function adminEventInsert(db: Database, input: AdminEventInput) {
  return db.insert(schema.adminEvents).values({
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    summary: input.summary,
    detail: input.detail ?? null,
  });
}

/**
 * Records an action on its own. Only for actions whose effect lives outside this database
 * (fal, PayPal, Clerk) and so can't share a transaction with it; local changes use
 * adminEventInsert inside their batch.
 */
export async function recordAdminEvent(db: Database, input: AdminEventInput) {
  await adminEventInsert(db, input);
}

/**
 * A batch statement that aborts the whole batch when any of these users' balances is above
 * the cap. Put it after the balance updates: a concurrent grant waits on their row locks and
 * then sees the committed balance, so two grants can't both slip under the cap. The divisor
 * depends on the data, so Postgres can't fold the division away at plan time.
 */
export function balanceCapGuard(db: Database, userIds: string[], cap: number) {
  return db.execute(sql`select 1 / (case when exists (
    select 1 from ${schema.users} where ${inArray(schema.users.id, userIds)} and ${schema.users.creditBalance} > ${cap}
  ) then 0 else 1 end) as within_cap`);
}

/** The error balanceCapGuard raises (division_by_zero), wherever the driver nests it. */
export function isBalanceCapViolation(error: unknown): boolean {
  for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
    if ((current as { code?: string }).code === "22012") return true;
  }
  return false;
}
