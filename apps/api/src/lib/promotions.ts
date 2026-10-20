import { sql } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { Env } from "../index.js";
import type { BillingEntitlement } from "./billing.js";
import { isFreeAllowance } from "./freeAllowance.js";
import { deliverIncidentNotification, openOperationalIncident } from "./incidents.js";
import type { AppSettingsRow } from "./settings.js";

/**
 * The promotional budget: a monthly ceiling (app_settings.promo_budget_usd) on the fal spend of
 * jobs paid from the Free plan's allowance, inside the global fal budget. When it's used up only
 * those jobs are refused; bought credits, admin grants, paid plans and beta credits keep working
 * for as long as the global budget allows. Months are UTC calendar months.
 */

const MICROS_PER_USD = 1_000_000;
/** pg_advisory_xact_lock key for promotional holds; reserveBudget uses 88420371. */
const PROMO_LOCK = 88420373;
const UTC_MONTH_START = sql`date_trunc('month', now() at time zone 'utc') at time zone 'utc'`;

type UserRow = typeof schema.users.$inferSelect;
export type FundingPool = (typeof schema.renders.$inferSelect)["fundingPool"];

export function promoBudgetMicros(settings: AppSettingsRow): number | null {
  return settings.promoBudgetUsd === null ? null : Math.round(Number(settings.promoBudgetUsd) * MICROS_PER_USD);
}

/**
 * A job is paid from the Free allowance when the account is on the Free plan with no admin-granted
 * plan and its plan credits (spent first) cover the whole charge. One that reaches into bought or
 * granted credits is account-funded.
 */
export function isPromoFunded(billing: BillingEntitlement, user: Pick<UserRow, "planCredits">, credits: number): boolean {
  return credits > 0 && isFreeAllowance(billing) && user.planCredits >= credits;
}

/** This month's promotional spend: promo-funded jobs (a failed one counts what it still carries). */
export async function promoSpendMicros(db: Database): Promise<number> {
  const result = await db.execute<{ total: string }>(sql`
    select
      coalesce((select sum(cost_micros) from renders where funding_pool = 'promo' and created_at >= ${UTC_MONTH_START}), 0)
      + coalesce((select sum(cost_micros) from segmentations where funding_pool = 'promo' and created_at >= ${UTC_MONTH_START}), 0) as total
  `);
  return Number(result.rows[0]?.total ?? 0);
}

/**
 * reserveBudget's promotional counterpart: a short-lived hold that fits within this month's
 * promotional budget after its jobs and other holds. The global reserveBudget ignores these rows,
 * because the same job also holds the global budget.
 */
export async function reservePromoBudget(db: Database, costMicros: number, budgetMicros: number): Promise<string | null> {
  if (costMicros === 0) return "free";
  const id = crypto.randomUUID();
  // Lock and check are separate statements of one transaction, as in reserveBudget.
  const [, result] = await db.batch([
    db.execute(sql`select pg_advisory_xact_lock(${PROMO_LOCK})`),
    db.execute<{ reserved: boolean }>(sql`
      with cleared as (
        delete from ${schema.budgetReservations} where pool = 'promo' and created_at < now() - interval '15 minutes' returning id
      ),
      spent as (
        select
          coalesce((select sum(cost_micros) from renders where funding_pool = 'promo' and created_at >= ${UTC_MONTH_START}), 0)
          + coalesce((select sum(cost_micros) from segmentations where funding_pool = 'promo' and created_at >= ${UTC_MONTH_START}), 0)
          + coalesce((select sum(cost_micros) from budget_reservations where pool = 'promo' and created_at >= now() - interval '15 minutes'), 0)
          + 0 * (select count(*) from cleared) as total
      ),
      reserved as (
        insert into budget_reservations (id, cost_micros, pool)
        select ${id}::uuid, ${costMicros}, 'promo'
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
 * Tells operators how this month's promotional budget stands: an incident at the warning and
 * critical thresholds, and at 100% (or when a job was refused because nothing more fits).
 * Repeats bump the open incident; only a new one goes to the ops webhook. Never fails the job.
 */
export async function reportPromoSpend(env: Env, db: Database, settings: AppSettingsRow, exhausted = false): Promise<void> {
  const budget = promoBudgetMicros(settings);
  if (budget === null) return;
  try {
    const spent = await promoSpendMicros(db);
    const percent = budget > 0 ? (spent * 100) / budget : 100;
    const month = new Date().toISOString().slice(0, 7);
    const levels = [settings.promoWarningPercent, settings.promoCriticalPercent].filter((level) => percent >= level);
    if (percent >= 100 || exhausted) levels.push(100);
    for (const level of levels) {
      const full = level === 100;
      const { incident, created } = await openOperationalIncident(db, {
        fingerprint: `promo-budget:${month}:${level}`,
        sourceType: "system",
        sourceId: `promo-budget:${month}`,
        severity: full ? "high" : level >= settings.promoCriticalPercent ? "medium" : "low",
        title: full ? "Promotional budget used up" : `Promotional budget at ${level}%`,
        summary: `$${(spent / MICROS_PER_USD).toFixed(2)} of this month's $${Number(settings.promoBudgetUsd).toFixed(2)} promotional budget is committed. ${full ? "Jobs paid from the Free allowance are refused until next month or until an operator raises it; paid and purchased usage is unaffected." : "Raising it is a manual admin decision."}`,
        context: { month, spentMicros: spent, budgetMicros: budget, level },
      });
      if (created) await deliverIncidentNotification(env, db, incident, full ? "Promotional budget used up" : "Promotional budget warning");
    }
  } catch (error) {
    console.error("promotional budget warning not recorded", error);
  }
}

export type PromoFunding = { ok: true; pool: FundingPool; hold: string | null } | { ok: false };

/**
 * Which pool a charged job is paid from, taking the promotional hold for a promo-funded one.
 * Beta-funded jobs are the beta program's. The caller releases `hold` once the job row exists.
 */
export async function fundPromo(
  env: Env,
  db: Database,
  settings: AppSettingsRow,
  billing: BillingEntitlement,
  user: Pick<UserRow, "planCredits">,
  credits: number,
  costMicros: number,
  betaFunded: boolean,
): Promise<PromoFunding> {
  if (betaFunded) return { ok: true, pool: "beta", hold: null };
  if (!isPromoFunded(billing, user, credits)) return { ok: true, pool: "account", hold: null };
  const budget = promoBudgetMicros(settings);
  if (budget === null) return { ok: true, pool: "promo", hold: null };
  const hold = await reservePromoBudget(db, costMicros, budget);
  if (!hold) {
    await reportPromoSpend(env, db, settings, true);
    return { ok: false };
  }
  return { ok: true, pool: "promo", hold };
}
