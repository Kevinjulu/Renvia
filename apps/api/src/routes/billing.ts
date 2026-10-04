import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { createDb, schema } from "@renvia/db";
import type { BillingCatalogResponse } from "@renvia/types";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrCreateUser } from "../lib/users.js";
import { approvalUrl, paypalReady, paypalRequest, type PaypalOrder, type PaypalSubscription } from "../lib/paypal.js";
import { settlePaypalCapture } from "../lib/paypalSettlement.js";
import { allowedOrigins } from "../lib/origins.js";

/**
 * Customer billing reads. Provider write operations are intentionally absent until
 * PayPal credentials and configured credit packs are available: this keeps Studio
 * honest and prevents a browser from creating an unpayable order.
 */
export const billing = new Hono<AppContext>();

billing.use("*", requireAuth);

billing.get("/catalog", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, c.get("auth").clerkId);
  const [packs, checkouts] = await Promise.all([
    db
      .select({ sku: schema.creditPacks.sku, name: schema.creditPacks.name, currency: schema.creditPacks.currency, priceCents: schema.creditPacks.priceCents, credits: schema.creditPacks.credits })
      .from(schema.creditPacks)
      .where(eq(schema.creditPacks.isActive, true))
      .orderBy(schema.creditPacks.priceCents),
    db
      .select({ checkout: schema.billingCheckouts, sku: schema.creditPacks.sku })
      .from(schema.billingCheckouts)
      .leftJoin(schema.creditPacks, eq(schema.billingCheckouts.creditPackId, schema.creditPacks.id))
      .where(eq(schema.billingCheckouts.userId, user.id))
      .orderBy(desc(schema.billingCheckouts.createdAt))
      .limit(10),
  ]);

  const response: BillingCatalogResponse = {
    creditPacks: packs,
    recentCheckouts: checkouts.map(({ checkout, sku }) => ({
      id: checkout.id,
      kind: checkout.kind,
      provider: checkout.provider as BillingCatalogResponse["recentCheckouts"][number]["provider"],
      status: checkout.status,
      currency: checkout.currency,
      amountCents: checkout.amountCents,
      creditPackSku: sku ?? null,
      createdAt: checkout.createdAt.toISOString(),
      updatedAt: checkout.updatedAt.toISOString(),
    })),
    // Creation/capture is deliberately unavailable until all three server-only
    // values are set. A configured key without webhook verification is not enough.
    paypalCheckoutAvailable: paypalReady(c.env),
  };
  return c.json(response);
});

const checkoutRequest = z.object({ kind: z.enum(["credit_pack", "subscription"]), product: z.string().trim().min(1).max(80), idempotencyKey: z.string().uuid() });

function returnUrls(c: Parameters<typeof allowedOrigins>[0], origin: string | undefined, checkoutId: string) {
  const allowed = allowedOrigins(c);
  const safeOrigin = origin && allowed.includes(origin) ? origin : allowed.find((value) => value.startsWith("https://"));
  if (!safeOrigin) throw new Error("No approved Studio return origin is configured");
  const url = new URL("/billing", safeOrigin);
  url.searchParams.set("checkout", checkoutId);
  return { return_url: `${url.toString()}&paypal=return`, cancel_url: `${url.toString()}&paypal=cancel` };
}

/** Creates a server-priced PayPal approval flow. Capture/settlement remains server-only. */
billing.post("/checkouts/paypal", async (c) => {
  if (!paypalReady(c.env)) return c.json({ error: "PayPal checkout is not configured", code: "billing_unavailable" }, 503);
  const body = checkoutRequest.parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, c.get("auth").clerkId);
  const [existing] = await db.select().from(schema.billingCheckouts).where(and(eq(schema.billingCheckouts.userId, user.id), eq(schema.billingCheckouts.idempotencyKey, body.idempotencyKey))).limit(1);
  if (existing) return c.json({ checkoutId: existing.id, status: existing.status, approvalUrl: typeof existing.providerMetadata?.approvalUrl === "string" ? existing.providerMetadata.approvalUrl : null });

  const [product] = body.kind === "credit_pack"
    ? await db.select().from(schema.creditPacks).where(and(eq(schema.creditPacks.sku, body.product), eq(schema.creditPacks.isActive, true))).limit(1)
    : await db.select().from(schema.billingPlans).where(and(eq(schema.billingPlans.slug, body.product), eq(schema.billingPlans.isActive, true))).limit(1);
  if (!product) return c.json({ error: "Billing product is unavailable" }, 404);
  const paypalPlanId = body.kind === "subscription" ? (product as typeof schema.billingPlans.$inferSelect).paypalPlanId : null;
  if (body.kind === "subscription" && !paypalPlanId) return c.json({ error: "This plan is not available through PayPal" }, 409);
  const amountCents = product.priceCents;
  const currency = product.currency;
  const [checkout] = await db.insert(schema.billingCheckouts).values({ userId: user.id, kind: body.kind, provider: "paypal", planId: body.kind === "subscription" ? product.id : null, creditPackId: body.kind === "credit_pack" ? product.id : null, idempotencyKey: body.idempotencyKey, currency, amountCents, status: "created" }).returning();
  if (!checkout) return c.json({ error: "Could not create checkout" }, 500);
  try {
    const applicationContext = returnUrls(c.env, c.req.header("Origin"), checkout.id);
    const provider = body.kind === "credit_pack"
      ? await paypalRequest<PaypalOrder>(c.env, "/v2/checkout/orders", { method: "POST", headers: { "PayPal-Request-Id": checkout.id }, body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ reference_id: checkout.id, custom_id: checkout.id, amount: { currency_code: currency, value: (amountCents / 100).toFixed(2) } }], application_context: applicationContext }) })
      : await paypalRequest<PaypalSubscription>(c.env, "/v1/billing/subscriptions", { method: "POST", headers: { "PayPal-Request-Id": checkout.id }, body: JSON.stringify({ plan_id: paypalPlanId, custom_id: checkout.id, application_context: applicationContext }) });
    const url = approvalUrl(provider);
    await db.update(schema.billingCheckouts).set({ providerCheckoutId: provider.id, status: "pending", providerMetadata: { approvalUrl: url }, updatedAt: new Date() }).where(eq(schema.billingCheckouts.id, checkout.id));
    return c.json({ checkoutId: checkout.id, status: "pending", approvalUrl: url }, 201);
  } catch (error) {
    await db.update(schema.billingCheckouts).set({ status: "failed", providerMetadata: { error: error instanceof Error ? error.message : "PayPal order creation failed" }, updatedAt: new Date() }).where(eq(schema.billingCheckouts.id, checkout.id));
    return c.json({ error: "Could not create PayPal checkout" }, 502);
  }
});

/** Captures an approved one-off Order and immediately settles it; the later webhook is idempotent. */
billing.post("/checkouts/:id/capture", async (c) => {
  if (!paypalReady(c.env)) return c.json({ error: "PayPal checkout is not configured" }, 503);
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, c.get("auth").clerkId);
  const [checkout] = await db.select().from(schema.billingCheckouts).where(and(eq(schema.billingCheckouts.id, c.req.param("id")), eq(schema.billingCheckouts.userId, user.id), eq(schema.billingCheckouts.provider, "paypal"))).limit(1);
  if (!checkout) return c.json({ error: "Checkout not found" }, 404);
  if (checkout.kind !== "credit_pack") return c.json({ error: "Subscriptions are activated by verified provider events" }, 409);
  if (checkout.status === "paid") return c.json({ checkoutId: checkout.id, status: "paid" });
  if (!checkout.providerCheckoutId) return c.json({ error: "Checkout has no provider order" }, 409);
  try {
    const order = await paypalRequest<{ purchase_units?: { payments?: { captures?: { id?: string; amount?: unknown }[] } }[] }>(c.env, `/v2/checkout/orders/${checkout.providerCheckoutId}/capture`, { method: "POST", headers: { "PayPal-Request-Id": checkout.id } });
    const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
    if (!capture?.id || !capture.amount || typeof capture.amount !== "object") throw new Error("PayPal capture response was incomplete");
    const amount = capture.amount as Record<string, unknown>;
    const value = typeof amount.value === "string" ? Number(amount.value) : NaN;
    const currency = typeof amount.currency_code === "string" ? amount.currency_code : null;
    if (!Number.isFinite(value) || !currency) throw new Error("PayPal capture response had an invalid amount");
    await settlePaypalCapture(db, { eventId: `capture:${capture.id}`, captureId: capture.id, orderId: checkout.providerCheckoutId, amountCents: Math.round(value * 100), currency });
    return c.json({ checkoutId: checkout.id, status: "paid" });
  } catch (error) {
    // A network failure may occur after PayPal captured the order. Keep it pending so
    // its signed webhook can settle it; never mark a potentially paid order failed.
    await db.update(schema.billingCheckouts).set({ status: "pending", providerMetadata: { ...(checkout.providerMetadata ?? {}), captureError: error instanceof Error ? error.message : "Capture failed" }, updatedAt: new Date() }).where(eq(schema.billingCheckouts.id, checkout.id));
    return c.json({ error: error instanceof Error ? error.message : "Could not capture PayPal payment" }, 502);
  }
});

/** Cancels a current subscription at PayPal; entitlement status changes only after its signed webhook. */
billing.post("/subscriptions/:id/cancel", async (c) => {
  if (!paypalReady(c.env)) return c.json({ error: "PayPal checkout is not configured" }, 503);
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, c.get("auth").clerkId);
  const [entitlement] = await db.select().from(schema.userEntitlements).where(and(
    eq(schema.userEntitlements.id, c.req.param("id")),
    eq(schema.userEntitlements.userId, user.id),
    eq(schema.userEntitlements.provider, "paypal"),
  )).limit(1);
  if (!entitlement?.providerSubscriptionId || entitlement.status !== "active") return c.json({ error: "Active PayPal subscription not found" }, 404);
  try {
    await paypalRequest(c.env, `/v1/billing/subscriptions/${entitlement.providerSubscriptionId}/cancel`, { method: "POST", body: JSON.stringify({ reason: "Cancelled by customer in Renvia" }) });
    return c.json({ status: "cancellation_requested" });
  } catch {
    return c.json({ error: "Could not cancel PayPal subscription" }, 502);
  }
});
