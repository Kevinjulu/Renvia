import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { BillingEntitlement } from "./billing.js";
import { getBillingEntitlement } from "./billing.js";

/**
 * Monthly plan credits.
 *
 * users.credit_balance is the one spendable total. users.plan_credits is the part of it that
 * came from the plan's monthly allowance: spent first, and removed when the next period starts.
 * Everything else in the balance (purchases, admin grants) never expires.
 *
 * A period runs from one signup anniversary to the next. Each period starts exactly once: the
 * plan_grant ledger row is keyed by user and period start, and every other write in the batch
 * only applies if that row was inserted by this batch. Running a renewal twice, or from two
 * places at once, grants once.
 */

const ledger = schema.creditLedger;
const users = schema.users;
const entitlements = schema.userEntitlements;

/** `anchor` moved by whole months, keeping its day of month (clamped to the month's end) and time. */
export function addMonthsClamped(anchor: Date, months: number): Date {
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(anchor.getUTCDate(), lastDay), anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds()));
}

/** The credit period containing `now`: from the latest signup anniversary to the next one. */
export function creditPeriodFor(signup: Date, now: Date): { start: Date; next: Date } {
  if (now < signup) return { start: signup, next: addMonthsClamped(signup, 1) };
  let months = (now.getUTCFullYear() - signup.getUTCFullYear()) * 12 + (now.getUTCMonth() - signup.getUTCMonth());
  // A missed renewal catches up to the current period only: never one grant per missed month.
  while (months > 0 && addMonthsClamped(signup, months) > now) months -= 1;
  return { start: addMonthsClamped(signup, months), next: addMonthsClamped(signup, months + 1) };
}

export function periodKey(start: Date): string {
  return start.toISOString();
}

/**
 * When Renvia itself grants this user's monthly credits, and from what date. The Free plan and
 * admin-granted plans renew on the signup anniversary. A yearly plan, or one paid a period at a
 * time, renews monthly from when it started, until its paid period ends. A monthly subscription
 * that renews itself gets its credits with each payment instead (null here).
 */
export function creditSchedule(billing: BillingEntitlement, now = new Date()): "signup" | { anchor: Date; until: Date } | null {
  if (billing.override !== null || billing.basePlan.interval === "none") return "signup";
  const { entitlement } = billing;
  if (!entitlement.currentPeriodStart || !entitlement.currentPeriodEnd || entitlement.currentPeriodEnd <= now) return null;
  if (entitlement.billingInterval === "year" || !entitlement.providerSubscriptionId) {
    return { anchor: entitlement.currentPeriodStart, until: entitlement.currentPeriodEnd };
  }
  return null;
}

export function grantsMonthlyCredits(billing: BillingEntitlement, now = new Date()): boolean {
  return creditSchedule(billing, now) !== null;
}

/** Credits that never expire: purchases (net of refunds) and admin grants (net of removals). */
async function permanentCredits(db: Database, userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${ledger.amount}) filter (where ${ledger.reason} in ('purchase', 'purchase_refund', 'admin_grant')), 0)::int` })
    .from(ledger)
    .where(eq(ledger.userId, userId));
  return Math.max(0, Number(row?.total ?? 0));
}

type PeriodStart = { userId: string; allowance: number; start: Date; next: Date };

/** True once the plan_grant row with this id exists, i.e. this batch started the period. */
const startedHere = (grantId: string) => sql`exists (select 1 from ${ledger} where ${ledger.id} = ${grantId})`;

function entitlementWrite(db: Database, { userId, allowance, start, next }: PeriodStart, grantId: string) {
  return db
    .update(entitlements)
    .set({ creditPeriodStart: start, nextCreditGrantAt: next, periodCreditsGranted: allowance, updatedAt: new Date() })
    .where(and(eq(entitlements.userId, userId), startedHere(grantId)));
}

function grantRow(db: Database, { userId, allowance, start }: PeriodStart, grantId: string) {
  return db
    .insert(ledger)
    .values({ id: grantId, userId, amount: allowance, planAmount: allowance, reason: "plan_grant", periodKey: periodKey(start) })
    .onConflictDoNothing();
}

/**
 * Records the credits the period start just removed (copied from last_plan_debit), if any.
 * Raw SQL because the row is conditional: Drizzle's insert-from-select needs every column.
 */
function removedCreditsRow(db: Database, { userId, start }: PeriodStart, grantId: string, reason: "plan_expiry" | "promo_expiry", fromPlanCredits: boolean) {
  return db.execute(sql`
    insert into ${ledger} (${sql.identifier("user_id")}, ${sql.identifier("amount")}, ${sql.identifier("plan_amount")}, ${sql.identifier("reason")}, ${sql.identifier("period_key")})
    select ${users.id}, -${users.lastPlanDebit}, ${fromPlanCredits ? sql`-${users.lastPlanDebit}` : sql`0`}, ${reason}, ${periodKey(start)}
    from ${users}
    where ${users.id} = ${userId} and ${users.lastPlanDebit} > 0 and ${startedHere(grantId)}`);
}

/**
 * The first period. Credits that never expire are kept; anything else still in the balance
 * (signup or starting credits) is replaced by the first allowance, recorded as promo_expiry.
 */
async function startFirstPeriod(db: Database, period: PeriodStart): Promise<void> {
  const keep = await permanentCredits(db, period.userId);
  const grantId = crypto.randomUUID();
  await db.batch([
    grantRow(db, period, grantId),
    db
      .update(users)
      .set({
        // SET expressions all read the row as it was, so last_plan_debit gets the old balance.
        lastPlanDebit: sql`${users.creditBalance} - least(${users.creditBalance}, ${keep})`,
        creditBalance: sql`least(${users.creditBalance}, ${keep}) + ${period.allowance}`,
        planCredits: period.allowance,
      })
      .where(and(eq(users.id, period.userId), startedHere(grantId))),
    removedCreditsRow(db, period, grantId, "promo_expiry", false),
    entitlementWrite(db, period, grantId),
  ]);
}

/** A later period: unspent plan credits expire and the allowance is granted again. */
async function renewPeriod(db: Database, period: PeriodStart): Promise<void> {
  const grantId = crypto.randomUUID();
  await db.batch([
    grantRow(db, period, grantId),
    db
      .update(users)
      .set({
        lastPlanDebit: users.planCredits,
        creditBalance: sql`${users.creditBalance} - ${users.planCredits} + ${period.allowance}`,
        planCredits: period.allowance,
      })
      .where(and(eq(users.id, period.userId), startedHere(grantId))),
    removedCreditsRow(db, period, grantId, "plan_expiry", true),
    entitlementWrite(db, period, grantId),
  ]);
}

/**
 * Starts the current credit period if it hasn't started yet. Cheap when nothing is due: it
 * only reads what `billing` already holds. Returns true when it changed the user's balance.
 */
export async function ensureCreditPeriod(db: Database, userId: string, signup: Date, billing: BillingEntitlement, now = new Date()): Promise<boolean> {
  const schedule = creditSchedule(billing, now);
  if (!schedule) return false;
  const { entitlement } = billing;
  if (entitlement.creditPeriodStart && entitlement.nextCreditGrantAt && entitlement.nextCreditGrantAt > now) return false;
  const { start, next } = creditPeriodFor(schedule === "signup" ? signup : schedule.anchor, now);
  // A paid period that has ended earns no further month; the lapse sweep moves it to Free.
  if (schedule !== "signup" && start >= schedule.until) return false;
  const period = { userId, allowance: billing.plan.monthlyCredits, start, next };
  if (entitlement.creditPeriodStart) await renewPeriod(db, period);
  else await startFirstPeriod(db, period);
  return true;
}

/**
 * A paid subscription's renewal: its payment starts the next period. Safe to repeat for the
 * same period (a replayed webhook grants nothing new).
 */
export async function startPaidPeriod(db: Database, period: PeriodStart): Promise<void> {
  const [row] = await db.select({ start: entitlements.creditPeriodStart }).from(entitlements).where(eq(entitlements.userId, period.userId));
  if (row?.start) await renewPeriod(db, period);
  else await startFirstPeriod(db, period);
}

/**
 * After an upgrade within a period: grants only the difference between the new allowance and
 * the highest already granted in this period. Repeated upgrades and downgrades never add more
 * than the highest allowance reached. The difference is computed by the statement that records
 * the new high-water mark, so two concurrent top-ups can't both grant it.
 */
export async function topUpPlanCredits(db: Database, userId: string, allowance: number): Promise<number> {
  const [row] = await db.select({ start: entitlements.creditPeriodStart }).from(entitlements).where(eq(entitlements.userId, userId));
  if (!row?.start) return 0;
  const inPeriod = and(eq(entitlements.userId, userId), eq(entitlements.creditPeriodStart, row.start));
  const topup = sql`coalesce((select ${entitlements.lastTopup} from ${entitlements} where ${inPeriod}), 0)`;
  const [, , added] = await db.batch([
    db
      .update(entitlements)
      .set({
        lastTopup: sql`greatest(0, ${allowance} - ${entitlements.periodCreditsGranted})`,
        periodCreditsGranted: sql`greatest(${entitlements.periodCreditsGranted}, ${allowance})`,
        updatedAt: new Date(),
      })
      .where(inPeriod),
    db
      .update(users)
      .set({ creditBalance: sql`${users.creditBalance} + ${topup}`, planCredits: sql`${users.planCredits} + ${topup}` })
      .where(eq(users.id, userId)),
    db.execute<{ amount: number }>(sql`
      insert into ${ledger} (${sql.identifier("user_id")}, ${sql.identifier("amount")}, ${sql.identifier("plan_amount")}, ${sql.identifier("reason")}, ${sql.identifier("note")})
      select ${entitlements.userId}, ${entitlements.lastTopup}, ${entitlements.lastTopup}, 'plan_grant', 'Plan upgrade top-up'
      from ${entitlements}
      where ${inPeriod} and ${entitlements.lastTopup} > 0
      returning ${sql.identifier("amount")}`),
  ]);
  return Number(added.rows[0]?.amount ?? 0);
}

/** Starts every due period. Run daily; users who sign in are also renewed on their next request. */
export async function renewDueCreditPeriods(db: Database, now = new Date(), limit = 500): Promise<{ renewed: number }> {
  const due = await db
    .select({ id: users.id, createdAt: users.createdAt })
    .from(users)
    .innerJoin(entitlements, eq(entitlements.userId, users.id))
    .where(or(isNull(entitlements.creditPeriodStart), lte(entitlements.nextCreditGrantAt, now)))
    .limit(limit);
  let renewed = 0;
  for (const user of due) {
    const billing = await getBillingEntitlement(db, user.id);
    if (billing && (await ensureCreditPeriod(db, user.id, user.createdAt, billing, now))) renewed += 1;
  }
  return { renewed };
}

