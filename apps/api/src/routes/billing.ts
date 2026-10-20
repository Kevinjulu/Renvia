import { and, asc, desc, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { createDb, schema, type Database } from "@renvia/db";
import type { BillingCatalogResponse, BillingInterval, BillingPlanOffer, CreateCheckoutResponse, PaymentMethod } from "@renvia/types";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { requireActiveAccount } from "../middleware/activeAccount.js";
import { rateLimit } from "../lib/rateLimit.js";
import { getOrCreateUser } from "../lib/users.js";
import { approvalUrl, paypalReady, paypalRequest, type PaypalOrder, type PaypalSubscription } from "../lib/paypal.js";
import { settlePaypalCapture } from "../lib/paypalSettlement.js";
import { kesPerUsd, paystackCharge, paystackReady, paystackRequest, type PaystackTransaction } from "../lib/paystack.js";
import { settlePaystackTransaction } from "../lib/paystackSettlement.js";
import { ensureEntitlement, STARTER_PLAN_SLUG, type BillingPlanRow } from "../lib/billing.js";
import { cancelProviderSubscription, planPriceCents } from "../lib/subscriptions.js";
import { allowedOrigins } from "../lib/origins.js";

/**
 * Customer billing: the plans and packs on sale, checkout through PayPal or Paystack (card and
 * M-Pesa), and cancelling. Prices always come from the server. A payment method is offered
 * only once its credentials are configured, so the Studio never opens an unpayable checkout.
 */
export const billing = new Hono<AppContext>();

billing.use("*", requireAuth);

function methodsAvailable(env: AppContext["Bindings"]): Record<PaymentMethod, boolean> {
  const paystack = paystackReady(env);
  return {
    paypal: paypalReady(env),
    card: paystack && (env.PAYSTACK_CARD_CURRENCY === "USD" || kesPerUsd(env) !== null),
    mpesa: paystack && kesPerUsd(env) !== null,
  };
}

/** The billing periods each payment method can sell this plan for. */
function payableFor(plan: BillingPlanRow, methods: Record<PaymentMethod, boolean>): Record<PaymentMethod, BillingInterval[]> {
  const intervals = (check: (interval: BillingInterval) => boolean) => (["month", "year"] as const).filter((interval) => planPriceCents(plan, interval) !== null && check(interval));
  return {
    paypal: methods.paypal ? intervals((interval) => Boolean(interval === "year" ? plan.paypalYearlyPlanId : plan.paypalPlanId)) : [],
    card: methods.card ? intervals(() => true) : [],
    mpesa: methods.mpesa ? intervals(() => true) : [],
  };
}

billing.get("/catalog", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, c.get("auth").clerkId);
  const [plans, packs, checkouts] = await Promise.all([
    db.select().from(schema.billingPlans).where(eq(schema.billingPlans.isActive, true)).orderBy(asc(schema.billingPlans.priceCents)),
    db
      .select({ sku: schema.creditPacks.sku, name: schema.creditPacks.name, currency: schema.creditPacks.currency, priceCents: schema.creditPacks.priceCents, credits: schema.creditPacks.credits })
      .from(schema.creditPacks)
      .where(eq(schema.creditPacks.isActive, true))
      .orderBy(schema.creditPacks.priceCents),
    db
      .select({ checkout: schema.billingCheckouts, sku: schema.creditPacks.sku, planName: schema.billingPlans.name })
      .from(schema.billingCheckouts)
      .leftJoin(schema.creditPacks, eq(schema.billingCheckouts.creditPackId, schema.creditPacks.id))
      .leftJoin(schema.billingPlans, eq(schema.billingCheckouts.planId, schema.billingPlans.id))
      .where(eq(schema.billingCheckouts.userId, user.id))
      .orderBy(desc(schema.billingCheckouts.createdAt))
      .limit(10),
  ]);
  const methods = methodsAvailable(c.env);

  const response: BillingCatalogResponse = {
    plans: plans.map((plan): BillingPlanOffer => ({
      slug: plan.slug,
      name: plan.name,
      description: plan.description,
      currency: plan.currency,
      priceCents: plan.priceCents,
      yearlyPriceCents: plan.yearlyPriceCents,
      monthlyCredits: plan.monthlyCredits,
      dailyRenderLimit: plan.dailyRenderLimit,
      maxProjects: plan.maxProjects,
      concurrentRenderLimit: plan.concurrentRenderLimit,
      payable: plan.interval === "none" ? { paypal: [], card: [], mpesa: [] } : payableFor(plan, methods),
      cardAutoRenews: { month: Boolean(plan.paystackPlanCode), year: Boolean(plan.paystackYearlyPlanCode) },
    })),
    creditPacks: packs,
    recentCheckouts: checkouts.map(({ checkout, sku, planName }) => ({
      id: checkout.id,
      kind: checkout.kind,
      provider: checkout.provider as BillingCatalogResponse["recentCheckouts"][number]["provider"],
      status: checkout.status,
      currency: checkout.currency,
      amountCents: checkout.amountCents,
      creditPackSku: sku ?? null,
      planName: checkout.kind === "subscription" ? planName ?? null : null,
      billingInterval: checkout.billingInterval ?? null,
      createdAt: checkout.createdAt.toISOString(),
      updatedAt: checkout.updatedAt.toISOString(),
    })),
    paypalCheckoutAvailable: methods.paypal,
    paymentMethods: methods,
    kesPerUsd: methods.mpesa || methods.card ? kesPerUsd(c.env) : null,
    cardCurrency: methods.card ? (c.env.PAYSTACK_CARD_CURRENCY === "USD" ? "USD" : "KES") : null,
    salesContactEmail: c.env.SALES_CONTACT_EMAIL?.trim() || null,
  };
  return c.json(response);
});

const checkoutRequest = z
  .object({
    kind: z.enum(["credit_pack", "subscription"]),
    product: z.string().trim().min(1).max(80),
    interval: z.enum(["month", "year"]).optional(),
    method: z.enum(["paypal", "card", "mpesa"]).default("paypal"),
    idempotencyKey: z.string().uuid(),
  })
  .refine((body) => body.kind === "credit_pack" || body.interval, { message: "A subscription needs a billing interval", path: ["interval"] });

/** Where the provider sends the customer back to: the Studio's billing page, on an approved origin. */
function returnUrl(c: Context<AppContext>, checkoutId: string, provider: "paypal" | "paystack") {
  const allowed = allowedOrigins(c.env);
  const origin = c.req.header("Origin");
  const safeOrigin = origin && allowed.includes(origin) ? origin : allowed.find((value) => value.startsWith("https://"));
  if (!safeOrigin) throw new Error("No approved Studio return origin is configured");
  const url = new URL("/billing", safeOrigin);
  url.searchParams.set("checkout", checkoutId);
  url.searchParams.set("provider", provider);
  return url;
}

async function startCheckout(c: Context<AppContext>, input: z.infer<typeof checkoutRequest>) {
  const methods = methodsAvailable(c.env);
  if (!methods[input.method]) return c.json({ error: "This payment method isn't available yet", code: "billing_unavailable" }, 503);
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, c.get("auth").clerkId);
  const provider = input.method === "paypal" ? "paypal" : "paystack";
  const [existing] = await db.select().from(schema.billingCheckouts).where(and(eq(schema.billingCheckouts.userId, user.id), eq(schema.billingCheckouts.idempotencyKey, input.idempotencyKey))).limit(1);
  if (existing) {
    const response: CreateCheckoutResponse = { checkoutId: existing.id, status: existing.status, approvalUrl: typeof existing.providerMetadata?.approvalUrl === "string" ? existing.providerMetadata.approvalUrl : null };
    return c.json(response);
  }

  let product: { id: string; priceCents: number; currency: string; plan: BillingPlanRow | null };
  const interval: BillingInterval | null = input.kind === "subscription" ? input.interval! : null;
  if (input.kind === "credit_pack") {
    const [pack] = await db.select().from(schema.creditPacks).where(and(eq(schema.creditPacks.sku, input.product), eq(schema.creditPacks.isActive, true))).limit(1);
    if (!pack) return c.json({ error: "Billing product is unavailable" }, 404);
    product = { id: pack.id, priceCents: pack.priceCents, currency: pack.currency, plan: null };
  } else {
    const [plan] = await db.select().from(schema.billingPlans).where(and(eq(schema.billingPlans.slug, input.product), eq(schema.billingPlans.isActive, true))).limit(1);
    if (!plan || plan.slug === STARTER_PLAN_SLUG || plan.interval === "none") return c.json({ error: "Billing product is unavailable" }, 404);
    const price = planPriceCents(plan, interval!);
    if (price === null) return c.json({ error: `${plan.name} isn't sold ${interval === "year" ? "yearly" : "monthly"}` }, 409);
    if (!payableFor(plan, methods)[input.method].includes(interval!)) return c.json({ error: "This plan can't be paid that way yet", code: "billing_unavailable" }, 409);
    const { entitlement } = await ensureEntitlement(db, user.id);
    if (entitlement.planId === plan.id && (entitlement.billingInterval ?? "month") === interval && entitlement.status === "active" && entitlement.providerSubscriptionId && !entitlement.cancelAtPeriodEnd) {
      return c.json({ error: `You're already on ${plan.name}, and it renews automatically.`, code: "already_subscribed" }, 409);
    }
    product = { id: plan.id, priceCents: price, currency: plan.currency, plan };
  }

  // What will actually be charged, in the currency the provider charges in.
  let charge = { currency: product.currency, amountCents: product.priceCents };
  const paystackPlanCode = provider === "paystack" && input.method === "card" && product.plan ? (interval === "year" ? product.plan.paystackYearlyPlanCode : product.plan.paystackPlanCode) : null;
  if (provider === "paystack") {
    if (paystackPlanCode) {
      // A Paystack plan bills its own amount, so the checkout records that.
      const paystackPlan = await paystackRequest<{ amount: number; currency: string }>(c.env, `/plan/${encodeURIComponent(paystackPlanCode)}`);
      charge = { currency: paystackPlan.currency, amountCents: paystackPlan.amount };
    } else {
      const converted = paystackCharge(c.env, input.method === "mpesa" ? "mpesa" : "card", product.priceCents);
      if (!converted) return c.json({ error: "This payment method isn't available yet", code: "billing_unavailable" }, 503);
      charge = converted;
    }
  }

  const [checkout] = await db
    .insert(schema.billingCheckouts)
    .values({
      userId: user.id,
      kind: input.kind,
      provider,
      planId: product.plan ? product.id : null,
      creditPackId: product.plan ? null : product.id,
      billingInterval: interval,
      idempotencyKey: input.idempotencyKey,
      currency: charge.currency,
      amountCents: charge.amountCents,
      status: "created",
      providerMetadata: { method: input.method },
    })
    .returning();
  if (!checkout) return c.json({ error: "Could not create checkout" }, 500);

  try {
    const back = returnUrl(c, checkout.id, provider);
    let providerId: string;
    let url: string;
    if (provider === "paypal") {
      const applicationContext = { return_url: `${back}&paypal=return`, cancel_url: `${back}&paypal=cancel` };
      const paypalPlanId = product.plan ? (interval === "year" ? product.plan.paypalYearlyPlanId : product.plan.paypalPlanId) : null;
      const created = product.plan
        ? await paypalRequest<PaypalSubscription>(c.env, "/v1/billing/subscriptions", { method: "POST", headers: { "PayPal-Request-Id": checkout.id }, body: JSON.stringify({ plan_id: paypalPlanId, custom_id: checkout.id, application_context: applicationContext }) })
        : await paypalRequest<PaypalOrder>(c.env, "/v2/checkout/orders", { method: "POST", headers: { "PayPal-Request-Id": checkout.id }, body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ reference_id: checkout.id, custom_id: checkout.id, amount: { currency_code: charge.currency, value: (charge.amountCents / 100).toFixed(2) } }], application_context: applicationContext }) });
      providerId = created.id;
      url = approvalUrl(created);
    } else {
      const initialized = await paystackRequest<{ authorization_url: string; reference: string }>(c.env, "/transaction/initialize", {
        method: "POST",
        body: JSON.stringify({
          email: user.email,
          amount: charge.amountCents,
          currency: charge.currency,
          reference: checkout.id,
          callback_url: back.toString(),
          channels: input.method === "mpesa" ? ["mobile_money"] : ["card"],
          ...(paystackPlanCode ? { plan: paystackPlanCode } : {}),
          metadata: { checkoutId: checkout.id, cancel_action: `${back}&cancelled=1` },
        }),
      });
      providerId = initialized.reference;
      url = initialized.authorization_url;
    }
    await db.update(schema.billingCheckouts).set({ providerCheckoutId: providerId, status: "pending", providerMetadata: { method: input.method, approvalUrl: url }, updatedAt: new Date() }).where(eq(schema.billingCheckouts.id, checkout.id));
    const response: CreateCheckoutResponse = { checkoutId: checkout.id, status: "pending", approvalUrl: url };
    return c.json(response, 201);
  } catch (error) {
    await db.update(schema.billingCheckouts).set({ status: "failed", providerMetadata: { method: input.method, error: error instanceof Error ? error.message : "Checkout creation failed" }, updatedAt: new Date() }).where(eq(schema.billingCheckouts.id, checkout.id));
    return c.json({ error: provider === "paypal" ? "Could not start PayPal checkout" : "Could not start Paystack checkout" }, 502);
  }
}

billing.post("/checkouts", requireActiveAccount, rateLimit("checkout"), async (c) => startCheckout(c, checkoutRequest.parse(await c.req.json())));

/** The original PayPal-only endpoint, kept for Studio builds that still call it. */
billing.post("/checkouts/paypal", requireActiveAccount, rateLimit("checkout"), async (c) => startCheckout(c, checkoutRequest.parse({ ...(await c.req.json()), method: "paypal" })));

/**
 * Called when the customer comes back from paying. Settles what can be settled right away:
 * a PayPal order is captured, a Paystack charge is verified. PayPal subscriptions start from
 * their signed payment webhook, so for those this only reports the status.
 */
async function confirmCheckout(c: Context<AppContext>) {
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, c.get("auth").clerkId);
  const [checkout] = await db.select().from(schema.billingCheckouts).where(and(eq(schema.billingCheckouts.id, c.req.param("id")!), eq(schema.billingCheckouts.userId, user.id))).limit(1);
  if (!checkout) return c.json({ error: "Checkout not found" }, 404);
  if (checkout.status === "paid") return c.json({ checkoutId: checkout.id, status: "paid" });
  if (!checkout.providerCheckoutId) return c.json({ error: "Checkout has no provider order" }, 409);

  if (checkout.provider === "paystack") {
    if (!paystackReady(c.env)) return c.json({ error: "Paystack is not configured" }, 503);
    try {
      const transaction = await paystackRequest<PaystackTransaction>(c.env, `/transaction/verify/${encodeURIComponent(checkout.providerCheckoutId)}`);
      if (transaction.status !== "success") {
        const final = transaction.status === "failed" || transaction.status === "abandoned" || transaction.status === "reversed";
        if (final) await db.update(schema.billingCheckouts).set({ status: transaction.status === "abandoned" ? "canceled" : "failed", updatedAt: new Date() }).where(eq(schema.billingCheckouts.id, checkout.id));
        return c.json({ checkoutId: checkout.id, status: final ? (transaction.status === "abandoned" ? "canceled" : "failed") : "pending" });
      }
      await settlePaystackTransaction(c.env, db, transaction, `verify:${transaction.id}`);
      return c.json({ checkoutId: checkout.id, status: "paid" });
    } catch (error) {
      // The webhook settles it if this didn't; a pending checkout is never marked failed here.
      return c.json({ error: error instanceof Error ? error.message : "Could not confirm the Paystack payment" }, 502);
    }
  }

  if (!paypalReady(c.env)) return c.json({ error: "PayPal checkout is not configured" }, 503);
  if (checkout.kind !== "credit_pack") return c.json({ checkoutId: checkout.id, status: checkout.status });
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
}

billing.post("/checkouts/:id/confirm", confirmCheckout);
billing.post("/checkouts/:id/capture", confirmCheckout);

/** The customer left the provider without paying. */
billing.post("/checkouts/:id/cancel", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, c.get("auth").clerkId);
  await db
    .update(schema.billingCheckouts)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(and(eq(schema.billingCheckouts.id, c.req.param("id")), eq(schema.billingCheckouts.userId, user.id), eq(schema.billingCheckouts.status, "pending")));
  return c.json({ status: "canceled" });
});

async function cancelSubscription(c: Context<AppContext>, db: Database, userId: string) {
  const { entitlement, basePlan } = await ensureEntitlement(db, userId);
  if (basePlan.interval === "none") return c.json({ error: "You're on the Free plan; there's nothing to cancel." }, 404);
  if (entitlement.cancelAtPeriodEnd) return c.json({ status: "cancellation_requested", endsAt: entitlement.currentPeriodEnd?.toISOString() ?? null });
  if (!entitlement.providerSubscriptionId) return c.json({ error: "This plan doesn't renew automatically, so there's nothing to cancel. It ends on its own." }, 409);
  try {
    await cancelProviderSubscription(c.env, entitlement);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Could not cancel the subscription" }, 502);
  }
  // Paid time is kept: the plan runs to the end of its period, then the daily sweep moves it to Free.
  await db.update(schema.userEntitlements).set({ cancelAtPeriodEnd: true, updatedAt: new Date() }).where(eq(schema.userEntitlements.id, entitlement.id));
  return c.json({ status: "cancellation_requested", endsAt: entitlement.currentPeriodEnd?.toISOString() ?? null });
}

/** Stops the current subscription renewing. The plan stays until the end of what was paid for. */
billing.post("/subscription/cancel", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, c.get("auth").clerkId);
  return cancelSubscription(c, db, user.id);
});

/** The original endpoint, addressed by entitlement ID. */
billing.post("/subscriptions/:id/cancel", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, c.get("auth").clerkId);
  const [entitlement] = await db.select({ id: schema.userEntitlements.id }).from(schema.userEntitlements).where(and(eq(schema.userEntitlements.id, c.req.param("id")), eq(schema.userEntitlements.userId, user.id))).limit(1);
  if (!entitlement) return c.json({ error: "Subscription not found" }, 404);
  return cancelSubscription(c, db, user.id);
});
