import { and, eq, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { BillingInterval } from "@renvia/types";
import type { Env } from "../index.js";
import { ensureEntitlement, STARTER_PLAN_SLUG, type BillingPlanRow, type EntitlementRow } from "./billing.js";
import { addMonthsClamped, creditPeriodFor, startPaidPeriod } from "./planCredits.js";
import { paypalReady, paypalRequest } from "./paypal.js";
import { paystackReady, paystackRequest } from "./paystack.js";

/**
 * Paid plans, whoever bills them.
 *
 * A plan starts, renews or switches only when a payment is recorded here; provider events
 * that don't move money (a subscription "activated" or "created") just keep references.
 * Payments are keyed by the provider's payment id, so a webhook and the browser's return
 * flow can both report the same payment and it counts once.
 *
 * Credits: a monthly subscription that renews itself gets its allowance with each payment.
 * A yearly plan, or one paid a period at a time (M-Pesa, or a card without a Paystack plan),
 * gets it monthly from when it started, while the paid period lasts (see planCredits).
 */

export type PaidProvider = "paypal" | "paystack";

export interface PlanPayment {
  userId: string;
  plan: BillingPlanRow;
  interval: BillingInterval;
  provider: PaidProvider;
  providerPaymentId: string;
  amountCents: number;
  currency: string;
  checkoutId: string | null;
  paidAt: Date;
  /** The provider subscription that charges again, once known. */
  providerSubscriptionId: string | null;
  /** True when the provider will charge again without the customer acting. */
  autoRenews: boolean;
  providerCustomerId?: string | null;
  /** Kept on the entitlement, merged over what's there for the same provider. */
  subscriptionMetadata?: Record<string, unknown>;
  eventId?: string;
}

export function intervalMonths(interval: BillingInterval) {
  return interval === "year" ? 12 : 1;
}

/** The price of a plan for a billing period; null when it isn't sold for that period. */
export function planPriceCents(plan: Pick<BillingPlanRow, "priceCents" | "yearlyPriceCents">, interval: BillingInterval): number | null {
  return interval === "year" ? plan.yearlyPriceCents : plan.priceCents;
}

type CreditPeriod = { start: string; next: string };

function isCreditPeriod(value: unknown): value is CreditPeriod {
  return Boolean(value && typeof value === "object" && typeof (value as CreditPeriod).start === "string" && typeof (value as CreditPeriod).next === "string");
}

async function startCredits(db: Database, userId: string, plan: BillingPlanRow, period: CreditPeriod) {
  await startPaidPeriod(db, { userId, allowance: plan.monthlyCredits, start: new Date(period.start), next: new Date(period.next) });
}

/** Records a paid plan payment and applies it: starts, renews, extends or switches the plan. */
export async function settlePlanPayment(env: Env, db: Database, payment: PlanPayment): Promise<{ duplicate: boolean }> {
  const [existing] = await db
    .select({ metadata: schema.billingPayments.providerMetadata })
    .from(schema.billingPayments)
    .where(and(eq(schema.billingPayments.provider, payment.provider), eq(schema.billingPayments.providerPaymentId, payment.providerPaymentId)))
    .limit(1);
  if (existing) {
    // A replay finishes a credit grant an earlier attempt recorded but didn't get to.
    const period = existing.metadata?.creditPeriod;
    if (isCreditPeriod(period)) await startCredits(db, payment.userId, payment.plan, period);
    return { duplicate: true };
  }

  const { entitlement } = await ensureEntitlement(db, payment.userId);
  const months = intervalMonths(payment.interval);
  // Paying again for the plan and period already running extends it from its current end.
  const continuing =
    entitlement.planId === payment.plan.id &&
    (entitlement.billingInterval ?? "month") === payment.interval &&
    entitlement.status !== "expired" &&
    entitlement.currentPeriodEnd !== null &&
    entitlement.currentPeriodEnd > payment.paidAt;
  const periodStart = continuing ? entitlement.currentPeriodStart ?? payment.paidAt : payment.paidAt;
  const periodEnd = addMonthsClamped(continuing ? entitlement.currentPeriodEnd! : payment.paidAt, months);
  const perPayment = payment.interval === "month" && payment.autoRenews;
  const creditPeriod: CreditPeriod | null = perPayment
    ? { start: payment.paidAt.toISOString(), next: periodEnd.toISOString() }
    : continuing
      ? null
      : { start: payment.paidAt.toISOString(), next: addMonthsClamped(payment.paidAt, 1).toISOString() };

  const sameProvider = entitlement.provider === payment.provider;
  const subscriptionId = payment.providerSubscriptionId ?? (continuing && sameProvider ? entitlement.providerSubscriptionId : null);
  // A different subscription that would keep charging after this one replaces it.
  const replaced =
    entitlement.providerSubscriptionId && entitlement.providerSubscriptionId !== subscriptionId && (entitlement.provider === "paypal" || entitlement.provider === "paystack")
      ? entitlement
      : null;

  const paymentId = crypto.randomUUID();
  try {
    await db.batch([
      db.insert(schema.billingPayments).values({
        id: paymentId,
        checkoutId: payment.checkoutId,
        userId: payment.userId,
        provider: payment.provider,
        providerPaymentId: payment.providerPaymentId,
        status: "paid",
        currency: payment.currency,
        amountCents: payment.amountCents,
        paidAt: payment.paidAt,
        providerMetadata: { eventId: payment.eventId ?? null, plan: payment.plan.slug, interval: payment.interval, subscriptionId, creditPeriod },
      }),
      db.insert(schema.billingInvoices).values({
        userId: payment.userId,
        paymentId,
        provider: payment.provider,
        providerInvoiceId: payment.providerPaymentId,
        number: `${payment.provider.toUpperCase()}-${payment.providerPaymentId}`,
        status: "paid",
        currency: payment.currency,
        amountCents: payment.amountCents,
      }),
      ...(payment.checkoutId
        ? [db.update(schema.billingCheckouts).set({ status: "paid", updatedAt: new Date() }).where(eq(schema.billingCheckouts.id, payment.checkoutId))]
        : []),
      db
        .update(schema.userEntitlements)
        .set({
          planId: payment.plan.id,
          status: "active",
          provider: payment.provider,
          providerSubscriptionId: subscriptionId,
          providerCustomerId: payment.providerCustomerId ?? (sameProvider ? entitlement.providerCustomerId : null),
          providerMetadata: {
            ...(sameProvider && continuing ? entitlement.providerMetadata ?? {} : {}),
            ...payment.subscriptionMetadata,
            amountCents: payment.amountCents,
            currency: payment.currency,
          },
          billingInterval: payment.interval,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: !payment.autoRenews,
          updatedAt: new Date(),
        })
        .where(eq(schema.userEntitlements.id, entitlement.id)),
    ]);
  } catch (error) {
    // The same payment recorded at the same moment by the other path.
    if ((error as { code?: string }).code === "23505") return { duplicate: true };
    throw error;
  }

  if (creditPeriod) await startCredits(db, payment.userId, payment.plan, creditPeriod);
  if (replaced) {
    await cancelProviderSubscription(env, replaced).catch((error: unknown) =>
      console.error("could not cancel the replaced subscription", replaced.providerSubscriptionId, error instanceof Error ? error.message : error),
    );
  }
  return { duplicate: false };
}

/** Asks the provider to stop charging. The plan itself runs to the end of its paid period. */
export async function cancelProviderSubscription(env: Env, entitlement: Pick<EntitlementRow, "provider" | "providerSubscriptionId" | "providerMetadata">): Promise<void> {
  const id = entitlement.providerSubscriptionId;
  if (!id) return;
  if (entitlement.provider === "paypal") {
    if (!paypalReady(env)) throw new Error("PayPal is not configured");
    await paypalRequest(env, `/v1/billing/subscriptions/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason: "Cancelled in Renvia" }) }).catch((error: unknown) => {
      // PayPal answers a successful cancel with 204 and no body, which paypalRequest reports as a failure.
      if (!(error instanceof Error && error.message.includes("(204)"))) throw error;
    });
    return;
  }
  if (entitlement.provider === "paystack") {
    if (!paystackReady(env)) throw new Error("Paystack is not configured");
    const token = entitlement.providerMetadata?.emailToken;
    if (typeof token !== "string") throw new Error("This Paystack subscription has no email token to cancel it with");
    await paystackRequest(env, "/subscription/disable", { method: "POST", body: JSON.stringify({ code: id, token }) });
  }
}

/** Days an auto-renewing subscription may run past its period end while a renewal payment is late. */
const RENEWAL_GRACE_DAYS = 7;

/**
 * Returns accounts whose paid period is over to the Free plan: subscriptions that were
 * cancelled, failed or paid a period at a time, at their period end; ones that should have
 * renewed, a grace week later. Unspent plan credits go with the plan; purchased credits stay.
 * Run daily.
 */
export async function endLapsedSubscriptions(db: Database, now = new Date(), limit = 200): Promise<{ ended: number }> {
  const [starter] = await db.select().from(schema.billingPlans).where(eq(schema.billingPlans.slug, STARTER_PLAN_SLUG)).limit(1);
  if (!starter) throw new Error("Starter billing plan is not configured");
  const e = schema.userEntitlements;
  const graceCutoff = new Date(now.getTime() - RENEWAL_GRACE_DAYS * 86_400_000);
  const lapsed = await db
    .select({ entitlement: e, signup: schema.users.createdAt, planCredits: schema.users.planCredits })
    .from(e)
    .innerJoin(schema.users, eq(schema.users.id, e.userId))
    .where(
      and(
        ne(e.planId, starter.id),
        isNotNull(e.currentPeriodEnd),
        or(
          and(lte(e.currentPeriodEnd, now), or(eq(e.cancelAtPeriodEnd, true), ne(e.status, "active"), sql`${e.providerSubscriptionId} is null`)),
          lte(e.currentPeriodEnd, graceCutoff),
        ),
      ),
    )
    .limit(limit);

  let ended = 0;
  for (const { entitlement, signup, planCredits } of lapsed) {
    // Free credits resume on the next signup anniversary; this period's were replaced by the plan's.
    const { start, next } = creditPeriodFor(signup, now);
    const [moved] = await db
      .update(e)
      .set({
        planId: starter.id,
        status: "active",
        provider: null,
        providerSubscriptionId: null,
        providerMetadata: null,
        billingInterval: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        creditPeriodStart: start,
        nextCreditGrantAt: next,
        updatedAt: now,
      })
      .where(and(eq(e.id, entitlement.id), eq(e.currentPeriodEnd, entitlement.currentPeriodEnd!)))
      .returning({ id: e.id });
    if (!moved) continue;
    ended += 1;
    if (planCredits > 0) {
      await db.batch([
        db
          .update(schema.users)
          .set({ creditBalance: sql`greatest(0, ${schema.users.creditBalance} - ${planCredits})`, planCredits: 0 })
          .where(and(eq(schema.users.id, entitlement.userId), eq(schema.users.planCredits, planCredits))),
        db.insert(schema.creditLedger).values({
          userId: entitlement.userId,
          amount: -planCredits,
          planAmount: -planCredits,
          reason: "plan_expiry",
          note: "Paid plan ended",
          periodKey: `lapse:${entitlement.currentPeriodEnd!.toISOString()}`,
        }).onConflictDoNothing(),
      ]);
    }
  }
  return { ended };
}
