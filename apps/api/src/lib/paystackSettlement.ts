import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { Env } from "../index.js";
import { transactionPlanCode, type PaystackTransaction } from "./paystack.js";
import { settleCreditPack } from "./paypalSettlement.js";
import { settlePlanPayment } from "./subscriptions.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Applies a successful Paystack charge, from the verify call on return or the signed webhook,
 * whichever comes first. A first payment carries the Renvia checkout ID as its reference; a
 * subscription's later charges are matched to the customer's Paystack plan instead.
 */
export async function settlePaystackTransaction(env: Env, db: Database, transaction: PaystackTransaction, eventId?: string): Promise<void> {
  if (transaction.status !== "success") throw new Error(`Paystack transaction ${transaction.reference} is ${transaction.status}, not success`);
  const providerPaymentId = String(transaction.id);
  const paidAt = transaction.paid_at ? new Date(transaction.paid_at) : new Date();
  const customerCode = transaction.customer?.customer_code ?? null;
  const planCode = transactionPlanCode(transaction);

  const [checkout] = UUID.test(transaction.reference)
    ? await db.select().from(schema.billingCheckouts).where(and(eq(schema.billingCheckouts.id, transaction.reference), eq(schema.billingCheckouts.provider, "paystack"))).limit(1)
    : [];

  if (checkout) {
    if (checkout.currency !== transaction.currency || checkout.amountCents !== transaction.amount) {
      throw new Error("Paystack charge amount does not match the Renvia checkout");
    }
    if (checkout.kind === "credit_pack") {
      return settleCreditPack(db, checkout, {
        provider: "paystack",
        providerPaymentId,
        amountCents: transaction.amount,
        currency: transaction.currency,
        metadata: { reference: transaction.reference, channel: transaction.authorization?.channel ?? null, eventId: eventId ?? null },
        note: `Paystack payment ${transaction.reference}`,
      });
    }
    const [plan] = checkout.planId ? await db.select().from(schema.billingPlans).where(eq(schema.billingPlans.id, checkout.planId)).limit(1) : [];
    if (!plan) throw new Error("Paystack checkout references a missing plan");
    await settlePlanPayment(env, db, {
      userId: checkout.userId,
      plan,
      interval: checkout.billingInterval ?? "month",
      provider: "paystack",
      providerPaymentId,
      amountCents: transaction.amount,
      currency: transaction.currency,
      checkoutId: checkout.id,
      paidAt,
      // The subscription code arrives in its own subscription.create event.
      providerSubscriptionId: null,
      autoRenews: Boolean(planCode),
      providerCustomerId: customerCode,
      subscriptionMetadata: planCode ? { planCode } : {},
      eventId,
    });
    return;
  }

  // A renewal charged by a Paystack subscription.
  if (!planCode || !customerCode) throw new Error(`Paystack charge ${transaction.reference} matches no Renvia checkout or subscription`);
  const [entitlement] = await db
    .select()
    .from(schema.userEntitlements)
    .where(and(eq(schema.userEntitlements.provider, "paystack"), eq(schema.userEntitlements.providerCustomerId, customerCode)))
    .limit(1);
  if (!entitlement) throw new Error("No Renvia subscription matches this Paystack customer");
  const metadata = entitlement.providerMetadata ?? {};
  if (metadata.amountCents !== transaction.amount || metadata.currency !== transaction.currency) {
    throw new Error("Paystack renewal amount does not match the subscription");
  }
  const [plan] = await db.select().from(schema.billingPlans).where(eq(schema.billingPlans.id, entitlement.planId)).limit(1);
  if (!plan) throw new Error("Paystack subscription references a missing plan");
  await settlePlanPayment(env, db, {
    userId: entitlement.userId,
    plan,
    interval: entitlement.billingInterval ?? "month",
    provider: "paystack",
    providerPaymentId,
    amountCents: transaction.amount,
    currency: transaction.currency,
    checkoutId: null,
    paidAt,
    providerSubscriptionId: entitlement.providerSubscriptionId,
    autoRenews: true,
    providerCustomerId: customerCode,
    eventId,
  });
}
