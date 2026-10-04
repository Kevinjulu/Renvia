import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createDb, schema } from "@renvia/db";
import type { Env } from "../../index.js";
import { reversePaypalPurchaseCredits, settlePaypalCapture } from "../../lib/paypalSettlement.js";

export const paypalWebhook = new Hono<{ Bindings: Env }>();

const eventSchema = z.object({
  id: z.string().min(1),
  event_type: z.string().min(1),
  create_time: z.string().optional(),
  resource: z.record(z.unknown()).default({}),
});

type PaypalEvent = z.infer<typeof eventSchema>;
const paypalBase = (env: Env) => env.PAYPAL_ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";

function cents(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+(\.\d{1,2})?$/.test(value)) return null;
  return Math.round(Number(value) * 100);
}

function resourceString(resource: Record<string, unknown>, key: string): string | null {
  return typeof resource[key] === "string" && resource[key].trim() ? resource[key] : null;
}

function linkedId(resource: Record<string, unknown>, key: string): string | null {
  const related = resource.supplementary_data;
  if (!related || typeof related !== "object") return null;
  const ids = (related as Record<string, unknown>).related_ids;
  return ids && typeof ids === "object" ? resourceString(ids as Record<string, unknown>, key) : null;
}

function asDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

async function accessToken(env: Env): Promise<string> {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) throw new Error("PayPal credentials are not configured");
  const credentials = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const response = await fetch(`${paypalBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) throw new Error("PayPal OAuth token request failed");
  const payload = (await response.json()) as { access_token?: unknown };
  if (typeof payload.access_token !== "string") throw new Error("PayPal OAuth token response was invalid");
  return payload.access_token;
}

/** PayPal's server-side verification avoids trusting caller-provided headers or payloads. */
async function verify(env: Env, event: PaypalEvent, request: Request): Promise<boolean> {
  if (!env.PAYPAL_WEBHOOK_ID) throw new Error("PAYPAL_WEBHOOK_ID is not configured");
  const fields = {
    transmission_id: request.headers.get("paypal-transmission-id"),
    transmission_time: request.headers.get("paypal-transmission-time"),
    cert_url: request.headers.get("paypal-cert-url"),
    auth_algo: request.headers.get("paypal-auth-algo"),
    transmission_sig: request.headers.get("paypal-transmission-sig"),
  };
  if (Object.values(fields).some((value) => !value)) return false;
  const response = await fetch(`${paypalBase(env)}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken(env)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...fields, webhook_id: env.PAYPAL_WEBHOOK_ID, webhook_event: event }),
  });
  if (!response.ok) throw new Error("PayPal webhook verification request failed");
  const payload = (await response.json()) as { verification_status?: unknown };
  return payload.verification_status === "SUCCESS";
}

async function settleCaptureEvent(db: ReturnType<typeof createDb>, event: PaypalEvent): Promise<void> {
  const resource = event.resource;
  const captureId = resourceString(resource, "id");
  const orderId = linkedId(resource, "order_id");
  const amount = resource.amount;
  const amountValue = amount && typeof amount === "object" ? cents((amount as Record<string, unknown>).value) : null;
  const currency = amount && typeof amount === "object" ? resourceString(amount as Record<string, unknown>, "currency_code") : null;
  if (!captureId || !orderId || amountValue === null || !currency) throw new Error("PayPal capture has no usable order, capture, or amount");

  await settlePaypalCapture(db, { eventId: event.id, captureId, orderId, amountCents: amountValue, currency });
}

async function activateSubscription(db: ReturnType<typeof createDb>, event: PaypalEvent): Promise<void> {
  const subscriptionId = resourceString(event.resource, "id");
  if (!subscriptionId) throw new Error("PayPal subscription event has no subscription ID");
  const checkoutId = resourceString(event.resource, "custom_id");
  const [checkout] = await db.select().from(schema.billingCheckouts).where(checkoutId
    ? and(eq(schema.billingCheckouts.id, checkoutId), eq(schema.billingCheckouts.kind, "subscription"))
    : and(eq(schema.billingCheckouts.provider, "paypal"), eq(schema.billingCheckouts.providerCheckoutId, subscriptionId)),
  ).limit(1);
  if (!checkout || !checkout.planId) throw new Error("No Renvia subscription checkout matches this PayPal subscription");
  const info = event.resource.billing_info;
  const periodEnd = info && typeof info === "object" ? asDate((info as Record<string, unknown>).next_billing_time) : null;
  await db.batch([
    db.update(schema.billingCheckouts).set({ providerCheckoutId: subscriptionId, status: "pending", updatedAt: new Date() }).where(eq(schema.billingCheckouts.id, checkout.id)),
    db.update(schema.userEntitlements).set({ planId: checkout.planId, status: "active", provider: "paypal", providerSubscriptionId: subscriptionId, currentPeriodStart: asDate(event.create_time) ?? new Date(), currentPeriodEnd: periodEnd, nextCreditGrantAt: periodEnd, cancelAtPeriodEnd: false, updatedAt: new Date() }).where(eq(schema.userEntitlements.userId, checkout.userId)),
  ]);
}

async function settleSubscriptionPayment(db: ReturnType<typeof createDb>, event: PaypalEvent): Promise<void> {
  const paymentId = resourceString(event.resource, "id");
  const subscriptionId = linkedId(event.resource, "subscription_id") ?? resourceString(event.resource, "billing_agreement_id");
  const amount = event.resource.amount;
  const amountCents = amount && typeof amount === "object" ? cents((amount as Record<string, unknown>).value) : null;
  const currency = amount && typeof amount === "object" ? resourceString(amount as Record<string, unknown>, "currency_code") : null;
  if (!paymentId || !subscriptionId || amountCents === null || !currency) throw new Error("PayPal subscription payment is incomplete");
  const [existing] = await db.select({ id: schema.billingPayments.id }).from(schema.billingPayments).where(and(eq(schema.billingPayments.provider, "paypal"), eq(schema.billingPayments.providerPaymentId, paymentId))).limit(1);
  if (existing) return;
  const [entitlement] = await db.select().from(schema.userEntitlements).where(and(eq(schema.userEntitlements.provider, "paypal"), eq(schema.userEntitlements.providerSubscriptionId, subscriptionId))).limit(1);
  if (!entitlement) throw new Error("No active Renvia entitlement matches this PayPal subscription");
  const [plan] = await db.select().from(schema.billingPlans).where(eq(schema.billingPlans.id, entitlement.planId)).limit(1);
  if (!plan || plan.currency !== currency || plan.priceCents !== amountCents) throw new Error("PayPal subscription payment does not match the Renvia plan");
  const [checkout] = await db.select().from(schema.billingCheckouts).where(eq(schema.billingCheckouts.providerCheckoutId, subscriptionId)).limit(1);
  const recordId = crypto.randomUUID();
  await db.batch([
    db.insert(schema.billingPayments).values({ id: recordId, checkoutId: checkout?.id ?? null, userId: entitlement.userId, provider: "paypal", providerPaymentId: paymentId, status: "paid", currency, amountCents, paidAt: new Date(), providerMetadata: { subscriptionId, eventId: event.id } }),
    db.insert(schema.billingInvoices).values({ userId: entitlement.userId, paymentId: recordId, provider: "paypal", providerInvoiceId: paymentId, number: `PAYPAL-${paymentId}`, status: "paid", currency, amountCents }),
    db.update(schema.billingCheckouts).set({ status: "paid", updatedAt: new Date() }).where(eq(schema.billingCheckouts.providerCheckoutId, subscriptionId)),
    db.update(schema.userEntitlements).set({ status: "active", monthlyCreditsRemaining: plan.monthlyCredits, updatedAt: new Date() }).where(eq(schema.userEntitlements.id, entitlement.id)),
    db.update(schema.users).set({ creditBalance: sql`${schema.users.creditBalance} + ${plan.monthlyCredits}` }).where(eq(schema.users.id, entitlement.userId)),
    db.insert(schema.creditLedger).values({ userId: entitlement.userId, paymentId: recordId, amount: plan.monthlyCredits, reason: "subscription_grant", note: `PayPal subscription payment ${paymentId}` }),
  ]);
}

async function updateSubscriptionStatus(db: ReturnType<typeof createDb>, event: PaypalEvent, status: "past_due" | "canceled" | "expired"): Promise<void> {
  const subscriptionId = resourceString(event.resource, "id");
  if (!subscriptionId) throw new Error("PayPal subscription event has no subscription ID");
  await db.update(schema.userEntitlements).set({ status, cancelAtPeriodEnd: status === "canceled", updatedAt: new Date() }).where(and(eq(schema.userEntitlements.provider, "paypal"), eq(schema.userEntitlements.providerSubscriptionId, subscriptionId)));
}

async function processEvent(db: ReturnType<typeof createDb>, event: PaypalEvent): Promise<void> {
  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    if (linkedId(event.resource, "subscription_id")) return settleSubscriptionPayment(db, event);
    return settleCaptureEvent(db, event);
  }
  if (event.event_type === "PAYMENT.SALE.COMPLETED") return settleSubscriptionPayment(db, event);
  if (event.event_type === "PAYMENT.CAPTURE.REFUNDED") {
    const captureId = linkedId(event.resource, "capture_id");
    const refundId = resourceString(event.resource, "id");
    if (!captureId || !refundId) throw new Error("PayPal refund has no capture reference");
    const [payment] = await db.select({ id: schema.billingPayments.id }).from(schema.billingPayments).where(and(eq(schema.billingPayments.provider, "paypal"), eq(schema.billingPayments.providerPaymentId, captureId))).limit(1);
    if (!payment) throw new Error("PayPal refund does not match a Renvia payment");
    await reversePaypalPurchaseCredits(db, payment.id, refundId);
    await db.update(schema.billingPayments).set({ status: "refunded", updatedAt: new Date() }).where(eq(schema.billingPayments.id, payment.id));
  }
  if (event.event_type === "BILLING.SUBSCRIPTION.ACTIVATED") return activateSubscription(db, event);
  if (event.event_type === "BILLING.SUBSCRIPTION.SUSPENDED" || event.event_type === "BILLING.SUBSCRIPTION.PAYMENT.FAILED") return updateSubscriptionStatus(db, event, "past_due");
  if (event.event_type === "BILLING.SUBSCRIPTION.CANCELLED") return updateSubscriptionStatus(db, event, "canceled");
  if (event.event_type === "BILLING.SUBSCRIPTION.EXPIRED") return updateSubscriptionStatus(db, event, "expired");
}

paypalWebhook.post("/", async (c) => {
  const parsed = eventSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid PayPal webhook payload" }, 400);
  let verified: boolean;
  try {
    verified = await verify(c.env, parsed.data, c.req.raw);
  } catch (error) {
    console.error("PayPal webhook verification unavailable", error);
    return c.json({ error: "Webhook verification unavailable" }, 503);
  }
  if (!verified) return c.json({ error: "Invalid PayPal signature" }, 400);

  const db = createDb(c.env.DATABASE_URL);
  const [known] = await db.select().from(schema.billingWebhookEvents).where(and(eq(schema.billingWebhookEvents.provider, "paypal"), eq(schema.billingWebhookEvents.providerEventId, parsed.data.id))).limit(1);
  if (known?.processedAt) return c.json({ received: true, duplicate: true });
  if (!known) {
    await db.insert(schema.billingWebhookEvents).values({ provider: "paypal", providerEventId: parsed.data.id, eventType: parsed.data.event_type, payload: parsed.data, verificationStatus: "verified", attempts: 1, lastAttemptAt: new Date() }).onConflictDoNothing();
  } else {
    await db.update(schema.billingWebhookEvents).set({ attempts: sql`${schema.billingWebhookEvents.attempts} + 1`, lastAttemptAt: new Date(), verificationStatus: "verified", failedAt: null, failureMessage: null }).where(eq(schema.billingWebhookEvents.id, known.id));
  }
  try {
    await processEvent(db, parsed.data);
    await db.update(schema.billingWebhookEvents).set({ processedAt: new Date(), failedAt: null, failureMessage: null }).where(and(eq(schema.billingWebhookEvents.provider, "paypal"), eq(schema.billingWebhookEvents.providerEventId, parsed.data.id)));
    return c.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "PayPal event processing failed";
    await db.update(schema.billingWebhookEvents).set({ failedAt: new Date(), failureMessage: message }).where(and(eq(schema.billingWebhookEvents.provider, "paypal"), eq(schema.billingWebhookEvents.providerEventId, parsed.data.id)));
    console.error("PayPal webhook processing failed", message);
    return c.json({ error: "PayPal event processing failed" }, 500);
  }
});
