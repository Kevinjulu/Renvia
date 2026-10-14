import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema } from "@renvia/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBillingEntitlement } from "../src/lib/billing.js";
import { addMonthsClamped, ensureCreditPeriod } from "../src/lib/planCredits.js";
import { endLapsedSubscriptions } from "../src/lib/subscriptions.js";
import { paystackWebhook } from "../src/routes/webhooks/paystack.js";
import { paypalWebhook } from "../src/routes/webhooks/paypal.js";
import { DAY } from "./support/admin.js";
import { db, makeCreditPack, makeUser, testEnv } from "./support/db.js";

// Paid plans: what a payment starts, renews, extends or switches, how yearly and pay-per-period
// plans still get credits monthly, and when a plan ends. Paystack and PayPal are stubbed; every
// key here is a placeholder.

const SECRET = "sk_test_placeholder";
const env = testEnv({ PAYSTACK_SECRET_KEY: SECRET, PAYSTACK_KES_PER_USD: "130", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret", PAYPAL_WEBHOOK_ID: "hook", PAYPAL_ENV: "sandbox" });

async function plans() {
  const [starter] = await db.insert(schema.billingPlans).values({ slug: "starter", name: "Free", description: "Free", monthlyCredits: 20 }).returning();
  const [pro] = await db.insert(schema.billingPlans).values({ slug: "studio", name: "Pro", description: "Pro", priceCents: 2900, yearlyPriceCents: 29000, interval: "month", monthlyCredits: 300 }).returning();
  const [premium] = await db.insert(schema.billingPlans).values({ slug: "team", name: "Premium", description: "Premium", priceCents: 7900, yearlyPriceCents: 79000, interval: "month", monthlyCredits: 1000 }).returning();
  return { starter: starter!, pro: pro!, premium: premium! };
}

let plan: Awaited<ReturnType<typeof plans>>;
beforeEach(async () => {
  plan = await plans();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const credits = async (userId: string) => {
  const [row] = await db.select({ balance: schema.users.creditBalance, plan: schema.users.planCredits }).from(schema.users).where(eq(schema.users.id, userId));
  return row!;
};
const entitlementOf = async (userId: string) => (await getBillingEntitlement(db, userId))!;

async function paystackCheckout(userId: string, product: { planId?: string; creditPackId?: string }, amountCents: number, interval: "month" | "year" | null = "month") {
  const [checkout] = await db
    .insert(schema.billingCheckouts)
    .values({ userId, kind: product.planId ? "subscription" : "credit_pack", provider: "paystack", planId: product.planId ?? null, creditPackId: product.creditPackId ?? null, billingInterval: product.planId ? interval : null, currency: "KES", amountCents, status: "pending" })
    .returning();
  await db.update(schema.billingCheckouts).set({ providerCheckoutId: checkout!.id }).where(eq(schema.billingCheckouts.id, checkout!.id));
  return checkout!;
}

function charge(reference: string, amount: number, extra: Record<string, unknown> = {}) {
  return { event: "charge.success", data: { id: Math.floor(Math.random() * 1e9), status: "success", reference, amount, currency: "KES", paid_at: new Date().toISOString(), customer: { customer_code: "CUS_1", email: "a@example.test" }, ...extra } };
}

function deliverPaystack(event: unknown, signature?: string) {
  const body = JSON.stringify(event);
  const sig = signature ?? createHmac("sha512", SECRET).update(body).digest("hex");
  return paystackWebhook.request("/", { method: "POST", headers: { "content-type": "application/json", "x-paystack-signature": sig }, body }, env);
}

describe("Paystack webhook", () => {
  it("rejects a delivery without a valid signature", async () => {
    const user = await makeUser({ creditBalance: 0 });
    const checkout = await paystackCheckout(user.id, { planId: plan.pro.id }, 377000);
    const response = await deliverPaystack(charge(checkout.id, 377000), "bad");
    expect(response.status).toBe(400);
    expect((await entitlementOf(user.id)).plan.slug).toBe("starter");
  });

  it("starts Pro from an M-Pesa payment for one month, granting its credits once", async () => {
    const user = await makeUser({ creditBalance: 5 });
    const checkout = await paystackCheckout(user.id, { planId: plan.pro.id }, 377000);
    const event = charge(checkout.id, 377000);

    expect((await deliverPaystack(event)).status).toBe(200);
    expect((await deliverPaystack(event)).status).toBe(200);

    const billing = await entitlementOf(user.id);
    expect(billing.plan.slug).toBe("studio");
    expect(billing.entitlement).toMatchObject({ provider: "paystack", billingInterval: "month", cancelAtPeriodEnd: true, providerSubscriptionId: null, status: "active" });
    const days = (billing.entitlement.currentPeriodEnd!.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);
    expect((await credits(user.id)).plan).toBe(300);
    expect(await db.select().from(schema.billingPayments)).toHaveLength(1);
    const [saved] = await db.select().from(schema.billingCheckouts).where(eq(schema.billingCheckouts.id, checkout.id));
    expect(saved!.status).toBe("paid");
  });

  it("refuses a charge whose amount differs from the checkout", async () => {
    const user = await makeUser({ creditBalance: 0 });
    const checkout = await paystackCheckout(user.id, { planId: plan.pro.id }, 377000);
    expect((await deliverPaystack(charge(checkout.id, 100))).status).toBe(500);
    expect((await entitlementOf(user.id)).plan.slug).toBe("starter");
  });

  it("adds a credit pack bought by card", async () => {
    const user = await makeUser({ creditBalance: 3 });
    const pack = await makeCreditPack({ credits: 50, priceCents: 900 });
    const checkout = await paystackCheckout(user.id, { creditPackId: pack.id }, 117000, null);
    expect((await deliverPaystack(charge(checkout.id, 117000))).status).toBe(200);
    expect((await credits(user.id)).balance).toBe(53);
  });

  it("attaches the subscription code, then renews from Paystack's own charge", async () => {
    const user = await makeUser({ creditBalance: 0 });
    const checkout = await paystackCheckout(user.id, { planId: plan.premium.id }, 1027000);
    await deliverPaystack(charge(checkout.id, 1027000, { plan: { plan_code: "PLN_premium" } }));
    expect((await entitlementOf(user.id)).entitlement.cancelAtPeriodEnd).toBe(false);

    await deliverPaystack({ event: "subscription.create", data: { subscription_code: "SUB_1", email_token: "tok", customer: { customer_code: "CUS_1" } } });
    const firstEnd = (await entitlementOf(user.id)).entitlement.currentPeriodEnd!;
    expect((await entitlementOf(user.id)).entitlement).toMatchObject({ providerSubscriptionId: "SUB_1", providerMetadata: expect.objectContaining({ emailToken: "tok" }) });

    // Spend some plan credits, then renew: the unspent remainder expires and the allowance is granted again.
    await db.update(schema.users).set({ creditBalance: 400, planCredits: 400 }).where(eq(schema.users.id, user.id));
    const renewal = charge("renewal-ref-1", 1027000, { plan: { plan_code: "PLN_premium" }, paid_at: firstEnd.toISOString() });
    expect((await deliverPaystack(renewal)).status).toBe(200);
    const billing = await entitlementOf(user.id);
    expect(billing.entitlement.currentPeriodEnd!.getTime()).toBe(addMonthsClamped(firstEnd, 1).getTime());
    expect((await credits(user.id)).plan).toBe(1000);
  });

  it("marks a subscription Paystack won't renew as ending", async () => {
    const user = await makeUser({ creditBalance: 0 });
    const checkout = await paystackCheckout(user.id, { planId: plan.pro.id }, 377000);
    await deliverPaystack(charge(checkout.id, 377000, { plan: { plan_code: "PLN_pro" } }));
    await deliverPaystack({ event: "subscription.create", data: { subscription_code: "SUB_2", email_token: "tok", customer: { customer_code: "CUS_1" } } });
    await deliverPaystack({ event: "subscription.not_renew", data: { subscription_code: "SUB_2" } });
    expect((await entitlementOf(user.id)).entitlement.cancelAtPeriodEnd).toBe(true);
  });
});

describe("paid periods", () => {
  it("extends the same plan from its current end without granting credits early", async () => {
    const user = await makeUser({ creditBalance: 0 });
    const first = await paystackCheckout(user.id, { planId: plan.pro.id }, 377000);
    await deliverPaystack(charge(first.id, 377000));
    const end = (await entitlementOf(user.id)).entitlement.currentPeriodEnd!;
    await db.update(schema.users).set({ creditBalance: 120, planCredits: 120 }).where(eq(schema.users.id, user.id));

    const second = await paystackCheckout(user.id, { planId: plan.pro.id }, 377000);
    await deliverPaystack(charge(second.id, 377000));

    expect((await entitlementOf(user.id)).entitlement.currentPeriodEnd!.getTime()).toBe(addMonthsClamped(end, 1).getTime());
    expect((await credits(user.id)).plan).toBe(120);
  });

  it("switches Pro to Premium straight away with Premium's allowance", async () => {
    const user = await makeUser({ creditBalance: 0 });
    await deliverPaystack(charge((await paystackCheckout(user.id, { planId: plan.pro.id }, 377000)).id, 377000));
    await deliverPaystack(charge((await paystackCheckout(user.id, { planId: plan.premium.id }, 1027000)).id, 1027000));
    expect((await entitlementOf(user.id)).plan.slug).toBe("team");
    expect((await credits(user.id)).plan).toBe(1000);
  });

  it("grants a yearly plan's credits every month, not all at once", async () => {
    const user = await makeUser({ creditBalance: 0 });
    const checkout = await paystackCheckout(user.id, { planId: plan.pro.id }, 3770000, "year");
    await deliverPaystack(charge(checkout.id, 3770000));
    const billing = await entitlementOf(user.id);
    expect(billing.entitlement.billingInterval).toBe("year");
    expect((billing.entitlement.currentPeriodEnd!.getTime() - Date.now()) / DAY).toBeGreaterThan(360);
    expect((await credits(user.id)).plan).toBe(300);

    // Nothing more within the first month.
    expect(await ensureCreditPeriod(db, user.id, user.createdAt, billing, new Date(Date.now() + 10 * DAY))).toBe(false);
    // A month later the allowance renews.
    await db.update(schema.users).set({ creditBalance: 40, planCredits: 40 }).where(eq(schema.users.id, user.id));
    const later = new Date(addMonthsClamped(billing.entitlement.currentPeriodStart!, 1).getTime() + DAY);
    expect(await ensureCreditPeriod(db, user.id, user.createdAt, await entitlementOf(user.id), later)).toBe(true);
    expect(await credits(user.id)).toEqual({ balance: 300, plan: 300 });
  });
});

describe("endLapsedSubscriptions", () => {
  it("moves an ended pay-per-period plan to Free, removing plan credits but keeping purchases", async () => {
    const user = await makeUser({ creditBalance: 0 });
    await deliverPaystack(charge((await paystackCheckout(user.id, { planId: plan.pro.id }, 377000)).id, 377000));
    await db.update(schema.users).set({ creditBalance: 350, planCredits: 300 }).where(eq(schema.users.id, user.id));
    const end = (await entitlementOf(user.id)).entitlement.currentPeriodEnd!;

    expect(await endLapsedSubscriptions(db, new Date(end.getTime() - DAY))).toEqual({ ended: 0 });
    expect(await endLapsedSubscriptions(db, new Date(end.getTime() + 1000))).toEqual({ ended: 1 });

    const billing = await entitlementOf(user.id);
    expect(billing.plan.slug).toBe("starter");
    expect(billing.entitlement).toMatchObject({ provider: null, billingInterval: null, currentPeriodEnd: null });
    expect(await credits(user.id)).toEqual({ balance: 50, plan: 0 });
  });

  it("gives an auto-renewing subscription a grace week for a late renewal", async () => {
    const user = await makeUser({ creditBalance: 0 });
    await deliverPaystack(charge((await paystackCheckout(user.id, { planId: plan.pro.id }, 377000)).id, 377000, { plan: { plan_code: "PLN_pro" } }));
    await deliverPaystack({ event: "subscription.create", data: { subscription_code: "SUB_3", email_token: "tok", customer: { customer_code: "CUS_1" } } });
    const end = (await entitlementOf(user.id)).entitlement.currentPeriodEnd!;

    expect(await endLapsedSubscriptions(db, new Date(end.getTime() + 3 * DAY))).toEqual({ ended: 0 });
    expect(await endLapsedSubscriptions(db, new Date(end.getTime() + 8 * DAY))).toEqual({ ended: 1 });
  });
});

describe("PayPal yearly subscription", () => {
  it("starts a yearly plan from its first payment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "token" });
        if (url.endsWith("/v1/notifications/verify-webhook-signature")) return Response.json({ verification_status: "SUCCESS" });
        return new Response("unexpected", { status: 500 });
      }),
    );
    const user = await makeUser({ creditBalance: 0 });
    await db.insert(schema.billingCheckouts).values({ userId: user.id, kind: "subscription", provider: "paypal", planId: plan.premium.id, billingInterval: "year", providerCheckoutId: "I-SUB", currency: "USD", amountCents: 79000, status: "pending" });
    const headers = { "content-type": "application/json", "paypal-transmission-id": "t", "paypal-transmission-time": "2026-01-01T00:00:00Z", "paypal-cert-url": "https://x", "paypal-auth-algo": "a", "paypal-transmission-sig": "s" };
    const event = { id: "WH-SALE-1", event_type: "PAYMENT.SALE.COMPLETED", resource: { id: "SALE-1", billing_agreement_id: "I-SUB", amount: { total: "790.00", currency: "USD" } } };

    const response = await paypalWebhook.request("/", { method: "POST", headers, body: JSON.stringify(event) }, env);

    expect(response.status).toBe(200);
    const billing = await entitlementOf(user.id);
    expect(billing.plan.slug).toBe("team");
    expect(billing.entitlement).toMatchObject({ provider: "paypal", billingInterval: "year", providerSubscriptionId: "I-SUB", cancelAtPeriodEnd: false });
    expect((billing.entitlement.currentPeriodEnd!.getTime() - Date.now()) / DAY).toBeGreaterThan(360);
    expect((await credits(user.id)).plan).toBe(1000);
  });
});
