import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createDb, schema } from "@renvia/db";
import type { Env } from "../../index.js";

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

function linkedOrderId(resource: Record<string, unknown>): string | null {
  const related = resource.supplementary_data;
  if (!related || typeof related !== "object") return null;
  const ids = (related as Record<string, unknown>).related_ids;
  return ids && typeof ids === "object" ? resourceString(ids as Record<string, unknown>, "order_id") : null;
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

async function settleCapture(db: ReturnType<typeof createDb>, event: PaypalEvent): Promise<void> {
  const resource = event.resource;
  const captureId = resourceString(resource, "id");
  const orderId = linkedOrderId(resource);
  const amount = resource.amount;
  const amountValue = amount && typeof amount === "object" ? cents((amount as Record<string, unknown>).value) : null;
  const currency = amount && typeof amount === "object" ? resourceString(amount as Record<string, unknown>, "currency_code") : null;
  if (!captureId || !orderId || amountValue === null || !currency) throw new Error("PayPal capture has no usable order, capture, or amount");

  const [checkout] = await db.select().from(schema.billingCheckouts).where(and(eq(schema.billingCheckouts.provider, "paypal"), eq(schema.billingCheckouts.providerCheckoutId, orderId))).limit(1);
  if (!checkout) throw new Error("No Renvia PayPal checkout matches this order");
  if (checkout.currency !== currency || checkout.amountCents !== amountValue) throw new Error("PayPal capture amount does not match the Renvia checkout");

  const [existingPayment] = await db.select({ id: schema.billingPayments.id }).from(schema.billingPayments).where(and(eq(schema.billingPayments.provider, "paypal"), eq(schema.billingPayments.providerPaymentId, captureId))).limit(1);
  if (existingPayment) return; // A duplicate delivery has already settled this capture.
  const paymentWrite = db.insert(schema.billingPayments).values({ checkoutId: checkout.id, userId: checkout.userId, provider: "paypal", providerPaymentId: captureId, status: "paid", currency, amountCents: amountValue, paidAt: new Date(), providerMetadata: { orderId, eventId: event.id } });
  const checkoutWrite = db.update(schema.billingCheckouts).set({ status: "paid", updatedAt: new Date() }).where(eq(schema.billingCheckouts.id, checkout.id));
  if (checkout.kind === "credit_pack") {
    const [pack] = await db.select().from(schema.creditPacks).where(eq(schema.creditPacks.id, checkout.creditPackId!)).limit(1);
    if (!pack) throw new Error("PayPal checkout references a missing credit pack");
    await db.batch([
      paymentWrite,
      checkoutWrite,
      db.update(schema.users).set({ creditBalance: sql`${schema.users.creditBalance} + ${pack.credits}` }).where(eq(schema.users.id, checkout.userId)),
      db.insert(schema.creditLedger).values({ userId: checkout.userId, amount: pack.credits, reason: "purchase", note: `PayPal capture ${captureId}` }),
    ]);
  } else {
    const [plan] = await db.select().from(schema.billingPlans).where(eq(schema.billingPlans.id, checkout.planId!)).limit(1);
    if (!plan) throw new Error("PayPal checkout references a missing billing plan");
    if (plan.monthlyCredits > 0) {
      await db.batch([
        paymentWrite, checkoutWrite,
        db.update(schema.userEntitlements).set({ planId: plan.id, status: "active", provider: "paypal", monthlyCreditsRemaining: plan.monthlyCredits, updatedAt: new Date() }).where(eq(schema.userEntitlements.userId, checkout.userId)),
        db.update(schema.users).set({ creditBalance: sql`${schema.users.creditBalance} + ${plan.monthlyCredits}` }).where(eq(schema.users.id, checkout.userId)),
        db.insert(schema.creditLedger).values({ userId: checkout.userId, amount: plan.monthlyCredits, reason: "subscription_grant", note: `PayPal capture ${captureId}` }),
      ]);
    } else {
      await db.batch([paymentWrite, checkoutWrite, db.update(schema.userEntitlements).set({ planId: plan.id, status: "active", provider: "paypal", monthlyCreditsRemaining: 0, updatedAt: new Date() }).where(eq(schema.userEntitlements.userId, checkout.userId))]);
    }
  }
}

async function processEvent(db: ReturnType<typeof createDb>, event: PaypalEvent): Promise<void> {
  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") return settleCapture(db, event);
  if (event.event_type === "PAYMENT.CAPTURE.REFUNDED") {
    const captureId = resourceString(event.resource, "id");
    if (!captureId) throw new Error("PayPal refund has no capture id");
    await db.update(schema.billingPayments).set({ status: "refunded", updatedAt: new Date() }).where(and(eq(schema.billingPayments.provider, "paypal"), eq(schema.billingPayments.providerPaymentId, captureId)));
  }
  // Subscription status is retained as an external event until checkout creation
  // is enabled; this deliberately avoids granting access from an unmatched ID.
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
