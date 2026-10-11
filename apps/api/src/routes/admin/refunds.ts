import { eq } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { Env } from "../../index.js";
import { paypalReady, paypalRequest } from "../../lib/paypal.js";
import { assertPaypalPurchaseRefundable, reversePaypalPurchaseCredits } from "../../lib/paypalSettlement.js";
import { recordAdminEvent } from "./shared.js";

export type PaymentRow = typeof schema.billingPayments.$inferSelect;

export type RefundCheck = { ok: true; payment: PaymentRow } | { ok: false; status: 404 | 409 | 503; error: string; code?: string };

/**
 * Everything that must hold before money goes back, checked both when a refund is asked for
 * and again when an approved one is executed — the payment or its credits may have changed.
 */
export async function checkRefundable(env: Env, db: Database, paymentId: string): Promise<RefundCheck> {
  if (!paypalReady(env)) return { ok: false, status: 503, error: "PayPal refunds are not configured" };
  const [payment] = await db.select().from(schema.billingPayments).where(eq(schema.billingPayments.id, paymentId)).limit(1);
  if (!payment) return { ok: false, status: 404, error: "Payment not found" };
  if (payment.provider !== "paypal" || payment.status !== "paid") return { ok: false, status: 409, error: "Only captured PayPal payments can be refunded" };
  try {
    await assertPaypalPurchaseRefundable(db, payment.id);
  } catch (error) {
    return { ok: false, status: 409, error: error instanceof Error ? error.message : "Payment is not refundable", code: "refund_manual_review" };
  }
  return { ok: true, payment };
}

/**
 * Refunds a captured PayPal payment in full and removes its unspent purchased credits.
 *
 * PayPal sits outside this database, so this can't be one transaction. The PayPal-Request-Id
 * is fixed per payment: if the response is lost and the refund is tried again, PayPal returns
 * the refund it already made instead of paying out twice.
 */
export async function refundPaypalPayment(env: Env, db: Database, payment: PaymentRow, actorId: string, detail: Record<string, unknown> = {}) {
  const response = await paypalRequest<{ id?: string }>(env, `/v2/payments/captures/${payment.providerPaymentId}/refund`, { method: "POST", headers: { "PayPal-Request-Id": `refund-${payment.id}` }, body: JSON.stringify({}) });
  if (!response.id) throw new Error("PayPal did not return a refund ID");
  await reversePaypalPurchaseCredits(db, payment.id, response.id);
  await db.update(schema.billingPayments).set({ status: "refunded", updatedAt: new Date(), providerMetadata: { ...(payment.providerMetadata ?? {}), refundId: response.id } }).where(eq(schema.billingPayments.id, payment.id));
  await recordAdminEvent(db, { actorId, action: "billing.payment", targetType: "billing_payment", targetId: payment.id, summary: `Refunded PayPal payment ${payment.providerPaymentId}`, detail: { refundId: response.id, amountCents: payment.amountCents, currency: payment.currency, ...detail } });
  return response.id;
}
