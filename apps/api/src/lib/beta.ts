import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { BetaFunding } from "@renvia/types";
import type { Env } from "../index.js";
import type { BetaCharge } from "./credits.js";
import { deliverIncidentNotification, openOperationalIncident } from "./incidents.js";

/**
 * The beta program's money rules (docs/beta-testing-system.md §4): beta credits are granted within
 * the program's limits, spent only by beta-funded jobs, expired exactly once, and every
 * beta-funded job's fal cost counts against the program's own hard budget.
 */

export type BetaProgramRow = typeof schema.betaPrograms.$inferSelect;
export type BetaEnrollmentRow = typeof schema.betaEnrollments.$inferSelect;

const MICROS_PER_USD = 1_000_000;

/**
 * Advisory lock classes, used as the first key of the two-key form with hashtext(program id) as
 * the second: one program's budget holds, and one program's grants and enrollments. Neither can
 * collide with the global fal budget's single-key lock, and programs never wait on each other.
 */
const BUDGET_LOCK = 88420372;
const ENROLLMENT_LOCK = 88420373;

const LIVE_STATUSES: ("active" | "suspended")[] = ["active", "suspended"];

/**
 * The program's enrollment lock, as the first statement of a batch: grants, invitations and
 * redemptions for one program then run one at a time, and each later statement's snapshot sees
 * what the previous holder committed.
 */
export function programEnrollmentLock(db: Database, programId: string) {
  return db.execute(sql`select pg_advisory_xact_lock(${ENROLLMENT_LOCK}, hashtext(${programId}))`);
}

export function programBudgetMicros(program: Pick<BetaProgramRow, "budgetUsd">): number {
  return Math.round(Number(program.budgetUsd) * MICROS_PER_USD);
}

/** When this tester's access ends: their own extension, else the program's end. */
export function effectiveEndsAt(program: Pick<BetaProgramRow, "endsAt">, enrollment: Pick<BetaEnrollmentRow, "endsAt">): Date {
  return enrollment.endsAt ?? program.endsAt;
}

export interface BetaContext {
  program: BetaProgramRow;
  enrollment: BetaEnrollmentRow;
  endsAt: Date;
  /** Beta-funded jobs are accepted now: enrollment and program active, and inside the dates. */
  running: boolean;
}

/** The user's live (active or suspended) enrollment, of which there is at most one. */
export async function liveBetaContext(db: Database, userId: string, now = new Date()): Promise<BetaContext | null> {
  const [row] = await db
    .select({ enrollment: schema.betaEnrollments, program: schema.betaPrograms })
    .from(schema.betaEnrollments)
    .innerJoin(schema.betaPrograms, eq(schema.betaPrograms.id, schema.betaEnrollments.programId))
    .where(and(eq(schema.betaEnrollments.userId, userId), inArray(schema.betaEnrollments.status, LIVE_STATUSES)))
    .limit(1);
  if (!row) return null;
  const endsAt = effectiveEndsAt(row.program, row.enrollment);
  const running = row.enrollment.status === "active" && row.program.status === "active" && row.program.startsAt <= now && now < endsAt;
  return { ...row, endsAt, running };
}

export type GrantResult =
  | { status: "granted" | "replayed"; amount: number }
  | { status: "refused"; reason: "not_found" | "not_active" | "tester_limit" | "pool_limit" };

/**
 * Grants beta credits to an active enrollment, within the program's per-tester ceiling and credit
 * pool. One batch: the program's enrollment lock, then a single statement whose ledger insert gates
 * the enrollment and balance updates, so they commit together or not at all. A retry with the same
 * key finds the earlier grant (period_key is unique per user and reason) and changes nothing.
 */
export async function grantBetaCredits(
  db: Database,
  input: { enrollmentId: string; amount: number; note: string; idempotencyKey: string; actorId?: string | null },
): Promise<GrantResult> {
  const { enrollmentId, amount, note, actorId = null } = input;
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("A beta grant must be a positive whole number of credits");
  const [enrollment] = await db
    .select({ programId: schema.betaEnrollments.programId, userId: schema.betaEnrollments.userId })
    .from(schema.betaEnrollments)
    .where(eq(schema.betaEnrollments.id, enrollmentId));
  if (!enrollment) return { status: "refused", reason: "not_found" };
  const key = `beta-grant:${input.idempotencyKey}`;

  const [, result] = await db.batch([
    programEnrollmentLock(db, enrollment.programId),
    db.execute<{ granted: number; replayed: boolean; status_ok: boolean; tester_ok: boolean; pool_ok: boolean }>(sql`
      with prior as (
        select 1 from credit_ledger where user_id = ${enrollment.userId} and reason = 'beta_grant' and period_key = ${key}
      ),
      state as (
        select e.id, e.user_id,
          e.status = 'active' as status_ok,
          e.credits_granted + ${amount} <= p.max_credits_per_tester as tester_ok,
          (p.credit_pool is null
            or (select coalesce(sum(o.credits_granted), 0) from beta_enrollments o where o.program_id = p.id) + ${amount} <= p.credit_pool) as pool_ok
        from beta_enrollments e
        join beta_programs p on p.id = e.program_id
        where e.id = ${enrollmentId}
      ),
      ledger as (
        insert into credit_ledger (user_id, amount, beta_amount, reason, period_key, beta_enrollment_id, note, actor_id)
        select user_id, ${amount}, ${amount}, 'beta_grant', ${key}, id, ${note}, ${actorId}
        from state
        where status_ok and tester_ok and pool_ok and not exists (select 1 from prior)
        on conflict do nothing
        returning user_id, beta_enrollment_id
      ),
      enrollment as (
        update beta_enrollments set credits_granted = credits_granted + ${amount}, updated_at = now()
        where id in (select beta_enrollment_id from ledger)
        returning id
      ),
      balance as (
        update users set credit_balance = credit_balance + ${amount}, beta_credits = beta_credits + ${amount}, updated_at = now()
        where id in (select user_id from ledger)
        returning id
      )
      select (select count(*) from ledger)::int as granted, exists (select 1 from prior) as replayed, status_ok, tester_ok, pool_ok
      from state
    `),
  ]);
  const row = result.rows[0];
  if (!row) return { status: "refused", reason: "not_found" };
  if (row.granted > 0) return { status: "granted", amount };
  if (row.replayed) return { status: "replayed", amount };
  if (!row.status_ok) return { status: "refused", reason: "not_active" };
  if (!row.tester_ok) return { status: "refused", reason: "tester_limit" };
  if (!row.pool_ok) return { status: "refused", reason: "pool_limit" };
  // The key was used by a grant that committed between our statements' snapshots.
  return { status: "replayed", amount };
}

/**
 * Removes the user's whole beta bucket and records it as beta_expiry. A single statement: the
 * update locks the user row, so a racing second call finds nothing left and writes nothing.
 * `unlessLive` leaves the credits alone while the user still has an active or suspended enrollment.
 * Returns the credits removed.
 */
export async function expireBetaCredits(db: Database, userId: string, enrollmentId: string | null, { unlessLive = false } = {}): Promise<number> {
  const result = await db.execute<{ amount: number }>(sql`
    with expired as (
      update users
      set credit_balance = credit_balance - beta_credits, beta_credits = 0, last_beta_debit = beta_credits, updated_at = now()
      where id = ${userId} and beta_credits > 0
        ${unlessLive ? sql`and not exists (select 1 from beta_enrollments e where e.user_id = ${userId} and e.status in ('active', 'suspended'))` : sql``}
      returning id, last_beta_debit
    )
    insert into credit_ledger (user_id, amount, beta_amount, reason, beta_enrollment_id)
    select id, -last_beta_debit, -last_beta_debit, 'beta_expiry',
      coalesce(${enrollmentId}::uuid, (select e.id from beta_enrollments e where e.user_id = ${userId} order by e.enrolled_at desc limit 1))
    from expired
    returning amount
  `);
  return -(result.rows[0]?.amount ?? 0);
}

/**
 * Brings a user's beta state up to date, cheaply enough to run on every /me and charged request:
 * a live enrollment past its end (or in an ended program) is completed and its credits expire;
 * leftover beta credits with no live enrollment expire. Returns the context that remains, and how
 * many credits expired so a caller holding the user row knows to re-read it. A caller that just
 * read the user can pass its `betaCredits`: at 0, a non-tester costs one indexed lookup, no write.
 */
export async function settleBetaCredits(
  db: Database,
  userId: string,
  { now = new Date(), betaCredits }: { now?: Date; betaCredits?: number } = {},
): Promise<{ context: BetaContext | null; expired: number }> {
  const context = await liveBetaContext(db, userId, now);
  if (context && (now >= context.endsAt || context.program.status === "ended")) {
    await db
      .update(schema.betaEnrollments)
      .set({ status: "completed", endedAt: now, endedReason: "ended", updatedAt: now })
      .where(and(eq(schema.betaEnrollments.id, context.enrollment.id), inArray(schema.betaEnrollments.status, LIVE_STATUSES)));
    return { context: null, expired: await expireBetaCredits(db, userId, context.enrollment.id, { unlessLive: true }) };
  }
  if (context || betaCredits === 0) return { context, expired: 0 };
  return { context: null, expired: await expireBetaCredits(db, userId, null, { unlessLive: true }) };
}

/** Budgeted fal cost of the program's beta-funded jobs that haven't failed. */
export async function programSpendMicros(db: Database, programId: string): Promise<number> {
  const result = await db.execute<{ total: string }>(sql`
    select
      coalesce((select sum(cost_micros) from renders where beta_program_id = ${programId} and status <> 'failed'), 0)
      + coalesce((select sum(cost_micros) from segmentations where beta_program_id = ${programId} and status <> 'failed'), 0) as total
  `);
  return Number(result.rows[0]?.total ?? 0);
}

/**
 * The program's counterpart of reserveBudget: a short-lived hold, taken under the program's own
 * advisory lock, that fits within the program budget after its live jobs and other holds. The
 * global reserveBudget ignores these rows, because the same job also holds the global budget.
 */
export async function reserveProgramBudget(db: Database, programId: string, costMicros: number, budgetMicros: number): Promise<string | null> {
  if (costMicros === 0) return "free";
  const id = crypto.randomUUID();
  // Lock and check are separate statements of one transaction, as in reserveBudget: the check's
  // snapshot is then taken after the lock, so it sees the hold of whoever held it before.
  const [, result] = await db.batch([
    db.execute(sql`select pg_advisory_xact_lock(${BUDGET_LOCK}, hashtext(${programId}))`),
    db.execute<{ reserved: boolean }>(sql`
      with cleared as (
        delete from budget_reservations
        where beta_program_id = ${programId}::uuid and created_at < now() - interval '15 minutes'
        returning id
      ),
      spent as (
        select
          coalesce((select sum(cost_micros) from renders where beta_program_id = ${programId} and status <> 'failed'), 0)
          + coalesce((select sum(cost_micros) from segmentations where beta_program_id = ${programId} and status <> 'failed'), 0)
          + coalesce((select sum(cost_micros) from budget_reservations where beta_program_id = ${programId}::uuid and created_at >= now() - interval '15 minutes'), 0)
          + 0 * (select count(*) from cleared) as total
      ),
      reserved as (
        insert into budget_reservations (id, cost_micros, beta_program_id)
        select ${id}::uuid, ${costMicros}, ${programId}::uuid
        from spent
        where total + ${costMicros} <= ${budgetMicros}
        returning id
      )
      select exists (select 1 from reserved) as reserved
    `),
  ]);
  return result.rows[0]?.reserved ? id : null;
}

/**
 * Tells operators how the program's budget stands: an operational incident once spend reaches the
 * warning threshold, and another at 100% (or whenever a job was refused because nothing more fits).
 * Repeats bump the open incident; only a new one goes to the ops webhook.
 */
export async function noteProgramSpend(
  db: Database,
  program: BetaProgramRow,
  { env, exhausted = false }: { env?: Env; exhausted?: boolean } = {},
): Promise<void> {
  const budget = programBudgetMicros(program);
  const spent = await programSpendMicros(db, program.id);
  const percent = budget > 0 ? (spent * 100) / budget : 100;
  const levels = [
    ...(percent >= program.budgetWarningPercent ? [program.budgetWarningPercent] : []),
    ...(percent >= 100 || exhausted ? [100] : []),
  ];
  for (const level of levels) {
    const full = level === 100;
    const spentUsd = (spent / MICROS_PER_USD).toFixed(2);
    const { incident, created } = await openOperationalIncident(db, {
      fingerprint: `beta-budget:${program.id}:${level}`,
      sourceType: "system",
      sourceId: program.id,
      severity: full ? "high" : "medium",
      title: full ? `Beta budget exhausted: ${program.name}` : `Beta budget at ${level}%: ${program.name}`,
      summary: `$${spentUsd} of the $${Number(program.budgetUsd).toFixed(2)} beta budget is committed. ${full ? "New beta-funded jobs are refused until an operator raises the budget." : "Raising it is a manual admin decision."}`,
      context: { programId: program.id, spentMicros: spent, budgetMicros: budget, level },
    });
    if (created && env) await deliverIncidentNotification(env, db, incident, full ? "Beta budget exhausted" : "Beta budget warning");
  }
}

export type JobFunding =
  | { ok: true; charge: BetaCharge | undefined; hold: string | null; program: BetaProgramRow | null }
  | { ok: false; code: "beta_unavailable" | "beta_budget_exhausted" };

const ACCOUNT_FUNDED: JobFunding = { ok: true, charge: undefined, hold: null, program: null };

/**
 * Decides who pays for a charged job (docs/beta-testing-system.md §4.1) and, for a beta-funded
 * one, takes the program budget hold. A tester's job is beta-funded unless they asked for
 * "account"; one that can't be beta-funded is refused, never quietly charged to their own credits.
 * The caller releases `hold` (with releaseBudgetReservation) once the job row exists.
 */
export async function fundJob(
  env: Env,
  db: Database,
  context: BetaContext | null,
  requested: BetaFunding | undefined,
  credits: number,
  costMicros: number,
): Promise<JobFunding> {
  if (credits === 0 || requested === "account") return ACCOUNT_FUNDED;
  if (!context) return requested === "beta" ? { ok: false, code: "beta_unavailable" } : ACCOUNT_FUNDED;
  if (!context.running) return { ok: false, code: "beta_unavailable" };
  const hold = await reserveProgramBudget(db, context.program.id, costMicros, programBudgetMicros(context.program));
  if (!hold) {
    await reportProgramSpend(env, db, context.program, true);
    return { ok: false, code: "beta_budget_exhausted" };
  }
  return { ok: true, charge: { programId: context.program.id, enrollmentId: context.enrollment.id }, hold, program: context.program };
}

/** noteProgramSpend for request paths: a failure to raise the warning never fails the job. */
export async function reportProgramSpend(env: Env, db: Database, program: BetaProgramRow, exhausted = false): Promise<void> {
  try {
    await noteProgramSpend(db, program, { env, exhausted });
  } catch (error) {
    console.error("beta budget warning not recorded", error);
  }
}
