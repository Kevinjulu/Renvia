import { eq } from "drizzle-orm";
import { schema } from "@renvia/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { paypalWebhook } from "../src/routes/webhooks/paypal.js";
import { balanceOf, db, makeCreditPack, makePaypalCheckout, makeUser, testEnv } from "./support/db.js";

// Placeholder values only: PayPal's API is stubbed, so no real credentials are involved.
const env = testEnv({
  PAYPAL_CLIENT_ID: "test-client-id",
  PAYPAL_CLIENT_SECRET: "test-client-secret",
  PAYPAL_WEBHOOK_ID: "test-webhook-id",
  PAYPAL_ENV: "sandbox",
});

const signatureHeaders = {
  "paypal-transmission-id": "tx-1",
  "paypal-transmission-time": "2026-01-01T00:00:00Z",
  "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-transmission-sig": "signature",
};

/** Stands in for PayPal's OAuth and webhook-verification endpoints. */
function stubPaypal(verificationStatus: "SUCCESS" | "FAILURE" = "SUCCESS") {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "test-token" });
      if (url.endsWith("/v1/notifications/verify-webhook-signature")) {
        return Response.json({ verification_status: verificationStatus });
      }
      return new Response("unexpected", { status: 500 });
    }),
  );
  return calls;
}

function deliver(event: unknown, { headers = signatureHeaders, bindings = env } = {}) {
  return paypalWebhook.request(
    "/",
    { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(event) },
    bindings,
  );
}

const captureEvent = (orderId: string, overrides: Record<string, unknown> = {}) => ({
  id: "WH-CAPTURE-1",
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  resource: {
    id: "CAPTURE-1",
    amount: { value: "10.00", currency_code: "USD" },
    supplementary_data: { related_ids: { order_id: orderId } },
  },
  ...overrides,
});

async function checkoutFixture() {
  const user = await makeUser({ creditBalance: 0 });
  const pack = await makeCreditPack({ credits: 50, priceCents: 1000 });
  const checkout = await makePaypalCheckout(user.id, pack.id);
  return { user, orderId: checkout.providerCheckoutId! };
}

const storedEvents = () => db.select().from(schema.billingWebhookEvents);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /webhooks/paypal", () => {
  it("rejects a body that is not a PayPal event", async () => {
    stubPaypal();
    const response = await deliver({ nope: true });
    expect(response.status).toBe(400);
  });

  it("reports verification as unavailable until PayPal is configured", async () => {
    stubPaypal();
    const { orderId } = await checkoutFixture();

    const response = await deliver(captureEvent(orderId), { bindings: testEnv() });

    expect(response.status).toBe(503);
    expect(await storedEvents()).toHaveLength(0);
  });

  it("rejects a delivery that lacks PayPal's signature headers", async () => {
    const calls = stubPaypal();
    const { user, orderId } = await checkoutFixture();

    const response = await deliver(captureEvent(orderId), { headers: {} as typeof signatureHeaders });

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(await balanceOf(user.id)).toBe(0);
  });

  it("rejects an event PayPal does not vouch for, without recording or crediting it", async () => {
    stubPaypal("FAILURE");
    const { user, orderId } = await checkoutFixture();

    const response = await deliver(captureEvent(orderId));

    expect(response.status).toBe(400);
    expect(await storedEvents()).toHaveLength(0);
    expect(await balanceOf(user.id)).toBe(0);
  });

  it("settles a verified capture, grants the credits and marks the event processed", async () => {
    stubPaypal();
    const { user, orderId } = await checkoutFixture();

    const response = await deliver(captureEvent(orderId));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(await balanceOf(user.id)).toBe(50);
    const [event] = await storedEvents();
    expect(event).toMatchObject({ providerEventId: "WH-CAPTURE-1", verificationStatus: "verified", failedAt: null });
    expect(event!.processedAt).not.toBeNull();
  });

  it("treats a redelivered event as a duplicate and does not credit twice", async () => {
    stubPaypal();
    const { user, orderId } = await checkoutFixture();

    await deliver(captureEvent(orderId));
    const second = await deliver(captureEvent(orderId));

    expect(await second.json()).toEqual({ received: true, duplicate: true });
    expect(await balanceOf(user.id)).toBe(50);
    expect(await db.select().from(schema.billingPayments)).toHaveLength(1);
  });

  it("fails and records a capture whose amount does not match the checkout", async () => {
    stubPaypal();
    const { user, orderId } = await checkoutFixture();
    const event = captureEvent(orderId, {
      resource: {
        id: "CAPTURE-1",
        amount: { value: "0.01", currency_code: "USD" },
        supplementary_data: { related_ids: { order_id: orderId } },
      },
    });

    const response = await deliver(event);

    expect(response.status).toBe(500);
    expect(await balanceOf(user.id)).toBe(0);
    const [stored] = await storedEvents();
    expect(stored!.processedAt).toBeNull();
    expect(stored!.failedAt).not.toBeNull();
    expect(stored!.failureMessage).toContain("does not match");
  });

  it("retries a previously failed event successfully once the cause is fixed", async () => {
    stubPaypal();
    const { user } = await checkoutFixture();
    const event = captureEvent("ORDER-NOT-CREATED-YET");

    expect((await deliver(event)).status).toBe(500);
    const pack = await makeCreditPack({ credits: 50, priceCents: 1000 });
    await makePaypalCheckout(user.id, pack.id, { providerCheckoutId: "ORDER-NOT-CREATED-YET" });
    const retry = await deliver(event);

    expect(retry.status).toBe(200);
    expect(await balanceOf(user.id)).toBe(50);
    const [stored] = await storedEvents();
    expect(stored).toMatchObject({ attempts: 2, failedAt: null, failureMessage: null });
    expect(stored!.processedAt).not.toBeNull();
  });

  it("reverses the credits when PayPal reports a refund", async () => {
    stubPaypal();
    const { user, orderId } = await checkoutFixture();
    await deliver(captureEvent(orderId));
    expect(await balanceOf(user.id)).toBe(50);

    const response = await deliver({
      id: "WH-REFUND-1",
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      resource: { id: "REFUND-1", supplementary_data: { related_ids: { capture_id: "CAPTURE-1" } } },
    });

    expect(response.status).toBe(200);
    expect(await balanceOf(user.id)).toBe(0);
    const [payment] = await db.select().from(schema.billingPayments).where(eq(schema.billingPayments.providerPaymentId, "CAPTURE-1"));
    expect(payment!.status).toBe("refunded");
  });

  it("fails a refund for a capture Renvia has no record of", async () => {
    stubPaypal();

    const response = await deliver({
      id: "WH-REFUND-2",
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      resource: { id: "REFUND-2", supplementary_data: { related_ids: { capture_id: "UNKNOWN" } } },
    });

    expect(response.status).toBe(500);
    const [stored] = await storedEvents();
    expect(stored!.failureMessage).toContain("does not match a Renvia payment");
  });
});
