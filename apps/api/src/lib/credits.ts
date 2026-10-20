import { and, eq, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { schema, type Database } from "@renvia/db";
import { expireBetaCredits } from "./beta.js";

type RenderRow = typeof schema.renders.$inferSelect;
type RenderInsert = typeof schema.renders.$inferInsert;

/** Postgres error for the users_credit_balance_non_negative check constraint. */
const CHECK_VIOLATION = "23514";

export class InsufficientCreditsError extends Error {
  constructor() {
    super("Not enough credits");
  }
}

/** A beta-funded charge needed more beta credits than the tester has; nothing else was touched. */
export class InsufficientBetaCreditsError extends Error {
  constructor() {
    super("Not enough beta credits");
  }
}

/**
 * Beta funding for a charge: the whole charge comes from beta credits and the job is attributed to
 * the program. Omitted, a charge is account-funded and can never reach into beta credits (the
 * users_plan_and_beta_within_balance check rolls it back instead).
 */
export interface BetaCharge {
  programId: string;
  enrollmentId: string;
}

function hasPgCode(error: unknown, code: string): boolean {
  for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
    if ((current as { code?: string }).code === code) return true;
  }
  return false;
}

function isCheckViolation(error: unknown): boolean {
  return hasPgCode(error, CHECK_VIOLATION);
}

/**
 * Takes `credits` from the balance, plan credits first. Records how many came from plan
 * credits in last_plan_debit, which the ledger row written next in the batch copies.
 */
function debitUser(db: Database, userId: string, credits: number) {
  return db
    .update(schema.users)
    .set({
      creditBalance: sql`${schema.users.creditBalance} - ${credits}`,
      // SET expressions read the row as it was, so both see the plan credits before this charge.
      planCredits: sql`${schema.users.planCredits} - least(${schema.users.planCredits}, ${credits})`,
      lastPlanDebit: sql`least(${schema.users.planCredits}, ${credits})`,
    })
    .where(eq(schema.users.id, userId));
}

/**
 * Takes `credits` from beta credits only. With too few, users_beta_credits_non_negative rolls the
 * batch back; the balance can't go negative first, since it always covers the beta credits.
 */
function debitBeta(db: Database, userId: string, credits: number) {
  return db
    .update(schema.users)
    .set({
      creditBalance: sql`${schema.users.creditBalance} - ${credits}`,
      betaCredits: sql`${schema.users.betaCredits} - ${credits}`,
    })
    .where(eq(schema.users.id, userId));
}

/** The plan-credit part of the charge just made by debitUser in this transaction. */
function chargedPlanAmount(userId: string) {
  return sql<number>`-(select ${schema.users.lastPlanDebit} from ${schema.users} where ${schema.users.id} = ${userId})`;
}

/** The plan and beta parts of an earlier charge, to return to the same buckets on refund. */
async function chargePartsOf(db: Database, where: ReturnType<typeof and>): Promise<{ plan: number; beta: number; enrollmentId: string | null }> {
  const [charge] = await db
    .select({ planAmount: schema.creditLedger.planAmount, betaAmount: schema.creditLedger.betaAmount, enrollmentId: schema.creditLedger.betaEnrollmentId })
    .from(schema.creditLedger)
    .where(where);
  return { plan: -(charge?.planAmount ?? 0), beta: -(charge?.betaAmount ?? 0), enrollmentId: charge?.enrollmentId ?? null };
}

/** A charge's debit and ledger fields: from beta credits when beta-funded, else plan credits first. */
function chargeWrites(db: Database, userId: string, credits: number, beta: BetaCharge | undefined) {
  return beta
    ? { debit: debitBeta(db, userId, credits), ledger: { userId, amount: -credits, betaAmount: -credits, betaEnrollmentId: beta.enrollmentId } }
    : { debit: debitUser(db, userId, credits), ledger: { userId, amount: -credits, planAmount: chargedPlanAmount(userId) } };
}

function chargeError(error: unknown, beta: BetaCharge | undefined): unknown {
  if (!isCheckViolation(error)) return error;
  return beta ? new InsufficientBetaCreditsError() : new InsufficientCreditsError();
}

/**
 * Puts a refunded charge's credits back in the buckets they came from. Beta credits returned to
 * someone whose enrollment has since ended expire again straight away, so they never linger.
 */
async function restoreCredits(db: Database, userId: string, credits: number, planPart: number, betaPart: number, enrollmentId: string | null) {
  await db
    .update(schema.users)
    .set({
      creditBalance: sql`${schema.users.creditBalance} + ${credits}`,
      planCredits: sql`${schema.users.planCredits} + ${planPart}`,
      betaCredits: sql`${schema.users.betaCredits} + ${betaPart}`,
    })
    .where(eq(schema.users.id, userId));
  if (betaPart > 0) await expireBetaCredits(db, userId, enrollmentId, { unlessLive: true });
}

/** A unique index refused the row — for renders, another request already used its idempotency key. */
export function isUniqueViolation(error: unknown): boolean {
  return hasPgCode(error, "23505");
}

/**
 * Another request took the last slot of a usage cap between the pre-flight check and this
 * charge; nothing was charged or created. The caller answers with the cap's usual refusal.
 */
export class JobCapError extends Error {
  constructor() {
    super("A usage limit was reached");
  }
}

/** The caps a new job must still fit under when it is created; null for exempt users. */
export interface JobCaps {
  concurrent: number | null;
  daily: number | null;
  monthly: number | null;
}

/** Keys pg_advisory_xact_lock(key, hashtext(user id)): one user's job creations, one at a time. */
const JOB_CAPS_LOCK = 88420372;

const UTC_DAY_START = sql`date_trunc('day', now() at time zone 'utc') at time zone 'utc'`;
const UTC_MONTH_START = sql`date_trunc('month', now() at time zone 'utc') at time zone 'utc'`;

/**
 * The cap check, inside the transaction that creates the job. The lock serializes one user's
 * job creations across instances; the check is its own statement so its snapshot is taken after
 * the lock, and sees a job committed by the request it waited behind (see reserveBudget). A cap
 * that is full divides by zero, which rolls the whole batch back before anything is charged.
 *
 * Jobs count as getUsage counts them: failed jobs only while they still carry provider spend.
 */
function capWrites(db: Database, userId: string, caps: JobCaps, kind: "render" | "segment") {
  const counts = kind === "render"
    ? sql`
        select
          count(*) filter (where r.status in ('pending', 'processing')) as in_flight,
          count(*) filter (where r.created_at >= ${UTC_DAY_START} and (r.status <> 'failed' or r.cost_micros > 0)) as today,
          count(*) filter (where r.created_at >= ${UTC_MONTH_START} and (r.status <> 'failed' or r.cost_micros > 0)) as month
        from ${schema.renders} r join ${schema.projects} p on p.id = r.project_id
        where p.owner_id = ${userId} and (r.created_at >= ${UTC_MONTH_START} or r.status in ('pending', 'processing'))`
    : sql`
        select
          0 as in_flight,
          count(*) filter (where s.created_at >= ${UTC_DAY_START}) as today,
          count(*) as month
        from ${schema.segmentations} s
        where s.user_id = ${userId} and s.created_at >= ${UTC_MONTH_START} and (s.status <> 'failed' or s.cost_micros > 0)`;
  const full: SQL[] = [];
  if (caps.concurrent !== null) full.push(sql`in_flight >= ${caps.concurrent}`);
  if (caps.daily !== null) full.push(sql`today >= ${caps.daily}`);
  if (caps.monthly !== null) full.push(sql`month >= ${caps.monthly}`);
  if (full.length === 0) return [];
  return [
    db.execute(sql`select pg_advisory_xact_lock(${JOB_CAPS_LOCK}, hashtext(${userId}))`),
    db.execute(sql`select 1 / (case when exists (select 1 from (${counts}) c where ${sql.join(full, sql` or `)}) then 0 else 1 end) as within_caps`),
  ];
}

function jobError(error: unknown, beta: BetaCharge | undefined): unknown {
  return hasPgCode(error, "22012") ? new JobCapError() : chargeError(error, beta);
}

/** Runs `items` as one transaction and returns the rows of the job insert at `index`. */
async function runJobBatch<T>(db: Database, items: BatchItem<"pg">[], index: number): Promise<T> {
  const [first, ...rest] = items;
  const results = (await db.batch([first!, ...rest])) as unknown[];
  return (results[index] as T[])[0]!;
}

/**
 * Creates a render and charges for it in one transaction: the balance decrement, the
 * render row and its ledger entry commit together or not at all. The non-negative
 * balance constraint makes an unaffordable render roll the whole batch back, which
 * holds even when several renders are submitted at once. With `beta`, the charge comes from
 * beta credits only and the render counts against that program's budget. With `caps`, the
 * user's concurrency, daily and monthly caps are checked again inside the same transaction, so
 * parallel requests can't all pass the pre-flight and overshoot them (JobCapError).
 */
export async function createChargedRender(
  db: Database,
  userId: string,
  credits: number,
  values: Omit<RenderInsert, "id" | "creditsCharged" | "betaProgramId" | "costState">,
  beta?: BetaCharge,
  caps?: JobCaps | null,
): Promise<RenderRow> {
  const id = crypto.randomUUID();
  const guard = caps ? capWrites(db, userId, caps, "render") : [];
  const row = { ...values, id, costState: "pending" as const };
  if (credits === 0 && guard.length === 0) {
    const [created] = await db.insert(schema.renders).values(row).returning();
    return created!;
  }

  const charge = credits > 0 ? chargeWrites(db, userId, credits, beta) : null;
  try {
    return await runJobBatch<RenderRow>(db, [
      ...guard,
      ...(charge ? [charge.debit] : []),
      db.insert(schema.renders).values({ ...row, creditsCharged: credits, betaProgramId: beta?.programId ?? null }).returning(),
      ...(charge ? [db.insert(schema.creditLedger).values({ ...charge.ledger, reason: "render", renderId: id })] : []),
    ], guard.length + (charge ? 1 : 0));
  } catch (error) {
    throw jobError(error, beta);
  }
}

type SegmentationRow = typeof schema.segmentations.$inferSelect;
type SegmentationInsert = typeof schema.segmentations.$inferInsert;

/**
 * Creates a segmentation and charges for it in one transaction — same pattern as renders,
 * including the in-transaction daily and monthly caps.
 */
export async function createChargedSegmentation(
  db: Database,
  userId: string,
  credits: number,
  values: Omit<SegmentationInsert, "id" | "creditsCharged" | "userId" | "betaProgramId">,
  beta?: BetaCharge,
  caps?: JobCaps | null,
): Promise<SegmentationRow> {
  const id = crypto.randomUUID();
  const guard = caps ? capWrites(db, userId, caps, "segment") : [];
  if (credits === 0 && guard.length === 0) {
    const [created] = await db.insert(schema.segmentations).values({ ...values, id, userId }).returning();
    return created!;
  }

  const charge = credits > 0 ? chargeWrites(db, userId, credits, beta) : null;
  try {
    return await runJobBatch<SegmentationRow>(db, [
      ...guard,
      ...(charge ? [charge.debit] : []),
      db.insert(schema.segmentations).values({ ...values, id, userId, creditsCharged: credits, betaProgramId: beta?.programId ?? null }).returning(),
      ...(charge ? [db.insert(schema.creditLedger).values({ ...charge.ledger, reason: "segment", segmentationId: id })] : []),
    ], guard.length + (charge ? 1 : 0));
  } catch (error) {
    throw jobError(error, beta);
  }
}

/**
 * Returns a failed/empty segmentation's credits. Unique (segmentation_id, reason) keeps it idempotent.
 */
export async function refundSegmentationIfNeeded(
  db: Database,
  segmentation: SegmentationRow,
): Promise<SegmentationRow> {
  if (segmentation.creditsCharged <= 0) return segmentation;
  if (segmentation.status !== "failed" && !(segmentation.status === "succeeded" && (segmentation.objectCount ?? 0) === 0)) {
    return segmentation;
  }

  const parts = await chargePartsOf(db, and(eq(schema.creditLedger.segmentationId, segmentation.id), eq(schema.creditLedger.reason, "segment")));
  const [refund] = await db
    .insert(schema.creditLedger)
    .values({
      userId: segmentation.userId,
      amount: segmentation.creditsCharged,
      planAmount: parts.plan,
      betaAmount: parts.beta,
      betaEnrollmentId: parts.enrollmentId,
      reason: "segment_refund",
      segmentationId: segmentation.id,
    })
    .onConflictDoNothing()
    .returning({ id: schema.creditLedger.id });
  if (refund) await restoreCredits(db, segmentation.userId, segmentation.creditsCharged, parts.plan, parts.beta, parts.enrollmentId);
  return segmentation;
}

/**
 * Returns a failed render's credits. The ledger's unique (render_id, reason) index makes
 * this idempotent: racing refreshes and the fal webhook can all call it, but only the
 * first inserts the refund row and restores the balance.
 */
export async function refundIfFailed(db: Database, render: RenderRow): Promise<RenderRow> {
  if (render.status !== "failed") return render;
  await refundRender(db, render, render.creditsCharged);
  return render;
}

/**
 * Gives `credits` of a render's charge back, at most once per render (same unique index as
 * refundIfFailed). Used on its own when only part of a render failed: a render whose upscale
 * pass failed keeps its standard result and returns the upscale's share.
 */
export async function refundRender(db: Database, render: RenderRow, credits: number): Promise<void> {
  if (credits <= 0) return;

  const [project] = await db
    .select({ ownerId: schema.projects.ownerId })
    .from(schema.projects)
    .where(eq(schema.projects.id, render.projectId));
  if (!project) return;

  // Plan credits spent on it go back to plan credits; they still expire at the next renewal.
  // A partial refund returns plan credits first, never more than the charge took from them.
  // Beta credits likewise go back to the beta bucket (a beta-funded charge took nothing else).
  const parts = await chargePartsOf(db, and(eq(schema.creditLedger.renderId, render.id), eq(schema.creditLedger.reason, "render")));
  const planPart = Math.min(credits, parts.plan);
  const betaPart = Math.min(credits - planPart, parts.beta);
  const [refund] = await db
    .insert(schema.creditLedger)
    .values({ userId: project.ownerId, amount: credits, planAmount: planPart, betaAmount: betaPart, betaEnrollmentId: parts.enrollmentId, reason: "render_refund", renderId: render.id })
    .onConflictDoNothing()
    .returning({ id: schema.creditLedger.id });
  if (refund) await restoreCredits(db, project.ownerId, credits, planPart, betaPart, parts.enrollmentId);
}
