import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createDb, schema, type Database } from "@renvia/db";
import type { Env } from "../../index.js";
import { paystackReady, verifyPaystackSignature, type PaystackTransaction } from "../../lib/paystack.js";
import { settlePaystackTransaction } from "../../lib/paystackSettlement.js";

export const paystackWebhook = new Hono<{ Bindings: Env }>();

const eventSchema = z.object({ event: z.string().min(1), data: z.record(z.unknown()).default({}) });
type PaystackEvent = z.infer<typeof eventSchema>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nested(data: Record<string, unknown>, key: string, field: string): string | null {
  const inner = data[key];
  return inner && typeof inner === "object" ? text((inner as Record<string, unknown>)[field]) : null;
}

/** Paystack sends no event ID, so one is built from the event and the object it concerns. */
function eventId(event: PaystackEvent): string {
  const { data } = event;
  const subject = data.id ?? data.subscription_code ?? data.invoice_code ?? data.reference ?? nested(data, "subscription", "subscription_code");
  return `${event.event}:${String(subject ?? "unknown")}`;
}

async function processEvent(env: Env, db: Database, event: PaystackEvent, id: string): Promise<void> {
  const { data } = event;
  const entitlements = schema.userEntitlements;
  switch (event.event) {
    case "charge.success":
      return settlePaystackTransaction(env, db, data as unknown as PaystackTransaction, id);
    case "subscription.create": {
      const code = text(data.subscription_code);
      const customer = nested(data, "customer", "customer_code");
      if (!code || !customer) throw new Error("Paystack subscription event has no subscription or customer code");
      const [entitlement] = await db.select().from(entitlements).where(and(eq(entitlements.provider, "paystack"), eq(entitlements.providerCustomerId, customer))).limit(1);
      // Usually follows its first charge; until that is recorded there is nothing to attach to, so Paystack retries.
      if (!entitlement) throw new Error("No Renvia subscription matches this Paystack customer yet");
      await db
        .update(entitlements)
        .set({
          providerSubscriptionId: code,
          providerMetadata: { ...(entitlement.providerMetadata ?? {}), emailToken: text(data.email_token) },
          cancelAtPeriodEnd: false,
          updatedAt: new Date(),
        })
        .where(eq(entitlements.id, entitlement.id));
      return;
    }
    case "subscription.not_renew":
    case "subscription.disable": {
      const code = text(data.subscription_code);
      if (!code) throw new Error("Paystack subscription event has no subscription code");
      await db
        .update(entitlements)
        .set({ cancelAtPeriodEnd: true, ...(event.event === "subscription.disable" ? { status: "canceled" as const } : {}), updatedAt: new Date() })
        .where(and(eq(entitlements.provider, "paystack"), eq(entitlements.providerSubscriptionId, code)));
      return;
    }
    case "invoice.payment_failed": {
      const code = nested(data, "subscription", "subscription_code");
      if (!code) return;
      await db
        .update(entitlements)
        .set({ status: "past_due", updatedAt: new Date() })
        .where(and(eq(entitlements.provider, "paystack"), eq(entitlements.providerSubscriptionId, code)));
      return;
    }
    default:
      return;
  }
}

/** Reprocesses an already signature-verified, stored event during operator recovery. */
export async function replayVerifiedPaystackEvent(env: Env, db: Database, payload: unknown): Promise<void> {
  const parsed = eventSchema.safeParse(payload);
  if (!parsed.success) throw new Error("Stored Paystack event payload is invalid");
  await processEvent(env, db, parsed.data, eventId(parsed.data));
}

paystackWebhook.post("/", async (c) => {
  if (!paystackReady(c.env)) return c.json({ error: "Webhook verification unavailable" }, 503);
  const raw = await c.req.text();
  if (!(await verifyPaystackSignature(c.env, raw, c.req.header("x-paystack-signature")))) return c.json({ error: "Invalid Paystack signature" }, 400);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: "Invalid Paystack webhook payload" }, 400);
  }
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid Paystack webhook payload" }, 400);

  const db = createDb(c.env.DATABASE_URL);
  const id = eventId(parsed.data);
  const events = schema.billingWebhookEvents;
  const match = and(eq(events.provider, "paystack"), eq(events.providerEventId, id));
  const [known] = await db.select().from(events).where(match).limit(1);
  if (known?.processedAt) return c.json({ received: true, duplicate: true });
  if (!known) {
    await db.insert(events).values({ provider: "paystack", providerEventId: id, eventType: parsed.data.event, payload: parsed.data, verificationStatus: "verified", attempts: 1, lastAttemptAt: new Date() }).onConflictDoNothing();
  } else {
    await db.update(events).set({ attempts: sql`${events.attempts} + 1`, lastAttemptAt: new Date(), failedAt: null, failureMessage: null }).where(eq(events.id, known.id));
  }
  try {
    await processEvent(c.env, db, parsed.data, id);
    await db.update(events).set({ processedAt: new Date(), failedAt: null, failureMessage: null }).where(match);
    return c.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Paystack event processing failed";
    await db.update(events).set({ failedAt: new Date(), failureMessage: message }).where(match);
    console.error("Paystack webhook processing failed", message);
    return c.json({ error: "Paystack event processing failed" }, 500);
  }
});
