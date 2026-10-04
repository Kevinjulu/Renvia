import { and, eq, sql } from "drizzle-orm";
import { createDb, schema } from "@renvia/db";

export type PaypalCapture = {
  eventId: string;
  captureId: string;
  orderId: string;
  amountCents: number;
  currency: string;
};

/**
 * Records a successful one-off PayPal capture and grants its credits exactly once.
 * The provider capture ID is unique, and every write below is batched together, so
 * the synchronous return flow and the verified webhook can safely race each other.
 */
export async function settlePaypalCapture(db: ReturnType<typeof createDb>, capture: PaypalCapture): Promise<void> {
  const [checkout] = await db.select().from(schema.billingCheckouts).where(and(
    eq(schema.billingCheckouts.provider, "paypal"),
    eq(schema.billingCheckouts.providerCheckoutId, capture.orderId),
  )).limit(1);
  if (!checkout) throw new Error("No Renvia PayPal checkout matches this order");
  if (checkout.kind !== "credit_pack") throw new Error("A subscription cannot be settled as a one-off capture");
  if (checkout.currency !== capture.currency || checkout.amountCents !== capture.amountCents) {
    throw new Error("PayPal capture amount does not match the Renvia checkout");
  }
  const [existing] = await db.select({ id: schema.billingPayments.id }).from(schema.billingPayments).where(and(
    eq(schema.billingPayments.provider, "paypal"),
    eq(schema.billingPayments.providerPaymentId, capture.captureId),
  )).limit(1);
  if (existing) return;
  const [pack] = await db.select().from(schema.creditPacks).where(eq(schema.creditPacks.id, checkout.creditPackId!)).limit(1);
  if (!pack) throw new Error("PayPal checkout references a missing credit pack");

  const paymentId = crypto.randomUUID();
  await db.batch([
    db.insert(schema.billingPayments).values({
      id: paymentId,
      checkoutId: checkout.id,
      userId: checkout.userId,
      provider: "paypal",
      providerPaymentId: capture.captureId,
      status: "paid",
      currency: capture.currency,
      amountCents: capture.amountCents,
      paidAt: new Date(),
      providerMetadata: { orderId: capture.orderId, eventId: capture.eventId },
    }),
    db.insert(schema.billingInvoices).values({
      userId: checkout.userId,
      paymentId,
      provider: "paypal",
      providerInvoiceId: capture.captureId,
      number: `PAYPAL-${capture.captureId}`,
      status: "paid",
      currency: capture.currency,
      amountCents: capture.amountCents,
    }),
    db.update(schema.billingCheckouts).set({ status: "paid", updatedAt: new Date() }).where(eq(schema.billingCheckouts.id, checkout.id)),
    db.update(schema.users).set({ creditBalance: sql`${schema.users.creditBalance} + ${pack.credits}` }).where(eq(schema.users.id, checkout.userId)),
    db.insert(schema.creditLedger).values({
      userId: checkout.userId,
      paymentId,
      amount: pack.credits,
      reason: "purchase",
      note: `PayPal capture ${capture.captureId}`,
    }),
  ]);
}

/** Refunds are only permitted while the credits purchased by that payment remain unused. */
export async function assertPaypalPurchaseRefundable(db: ReturnType<typeof createDb>, paymentId: string): Promise<void> {
  const [grant] = await db.select().from(schema.creditLedger).where(and(
    eq(schema.creditLedger.paymentId, paymentId),
    eq(schema.creditLedger.reason, "purchase"),
  )).limit(1);
  if (!grant) throw new Error("The payment has no reversible credit purchase");
  const [alreadyReversed] = await db.select({ id: schema.creditLedger.id }).from(schema.creditLedger).where(and(
    eq(schema.creditLedger.paymentId, paymentId),
    eq(schema.creditLedger.reason, "purchase_refund"),
  )).limit(1);
  if (alreadyReversed) throw new Error("This payment has already had its credits reversed");
  const [user] = await db.select({ creditBalance: schema.users.creditBalance }).from(schema.users).where(eq(schema.users.id, grant.userId)).limit(1);
  if (!user || user.creditBalance < grant.amount) {
    throw new Error("Refund requires manual review because purchased credits have already been used");
  }
}

/** Applies the local reversal after PayPal has confirmed a refund. */
export async function reversePaypalPurchaseCredits(db: ReturnType<typeof createDb>, paymentId: string, refundId: string): Promise<void> {
  const [grant] = await db.select().from(schema.creditLedger).where(and(
    eq(schema.creditLedger.paymentId, paymentId),
    eq(schema.creditLedger.reason, "purchase"),
  )).limit(1);
  if (!grant) throw new Error("The payment has no reversible credit purchase");
  const [alreadyReversed] = await db.select({ id: schema.creditLedger.id }).from(schema.creditLedger).where(and(
    eq(schema.creditLedger.paymentId, paymentId),
    eq(schema.creditLedger.reason, "purchase_refund"),
  )).limit(1);
  if (alreadyReversed) return;
  const [user] = await db.select({ creditBalance: schema.users.creditBalance }).from(schema.users).where(eq(schema.users.id, grant.userId)).limit(1);
  if (!user || user.creditBalance < grant.amount) throw new Error("Refund requires manual review because purchased credits have already been used");
  await db.batch([
    db.update(schema.users).set({ creditBalance: sql`${schema.users.creditBalance} - ${grant.amount}` }).where(eq(schema.users.id, grant.userId)),
    db.insert(schema.creditLedger).values({ userId: grant.userId, paymentId, amount: -grant.amount, reason: "purchase_refund", note: `PayPal refund ${refundId}` }),
  ]);
}
