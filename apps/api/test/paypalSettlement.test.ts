import { eq } from "drizzle-orm";
import { schema } from "@renvia/db";
import { describe, expect, it } from "vitest";
import {
  assertPaypalPurchaseRefundable,
  reversePaypalPurchaseCredits,
  settlePaypalCapture,
  type PaypalCapture,
} from "../src/lib/paypalSettlement.js";
import { balanceOf, db, ledgerFor, makeCreditPack, makePaypalCheckout, makeUser } from "./support/db.js";

async function setup(packCredits = 50) {
  const user = await makeUser({ creditBalance: 5 });
  const pack = await makeCreditPack({ credits: packCredits, priceCents: 1000 });
  const checkout = await makePaypalCheckout(user.id, pack.id);
  const capture: PaypalCapture = {
    eventId: "WH-1",
    captureId: "CAPTURE-1",
    orderId: checkout.providerCheckoutId!,
    amountCents: 1000,
    currency: "USD",
  };
  return { user, pack, checkout, capture };
}

const payments = () => db.select().from(schema.billingPayments);
const invoices = () => db.select().from(schema.billingInvoices);

describe("settlePaypalCapture", () => {
  it("records the payment and invoice, marks the checkout paid and grants the pack's credits", async () => {
    const { user, checkout, capture } = await setup(50);

    await settlePaypalCapture(db, capture);

    const [payment] = await payments();
    expect(payment).toMatchObject({
      userId: user.id,
      checkoutId: checkout.id,
      provider: "paypal",
      providerPaymentId: "CAPTURE-1",
      status: "paid",
      amountCents: 1000,
      currency: "USD",
    });
    expect(await invoices()).toHaveLength(1);
    const [updated] = await db.select().from(schema.billingCheckouts).where(eq(schema.billingCheckouts.id, checkout.id));
    expect(updated!.status).toBe("paid");
    expect(await balanceOf(user.id)).toBe(55);
    expect(await ledgerFor(user.id)).toEqual([
      expect.objectContaining({ amount: 50, reason: "purchase", paymentId: payment!.id }),
    ]);
  });

  it("ignores a repeated delivery of the same capture", async () => {
    const { user, capture } = await setup(50);

    await settlePaypalCapture(db, capture);
    await settlePaypalCapture(db, { ...capture, eventId: "WH-2" });

    expect(await payments()).toHaveLength(1);
    expect(await balanceOf(user.id)).toBe(55);
  });

  it("grants credits once when the return flow and the webhook race", async () => {
    const { user, capture } = await setup(50);

    const results = await Promise.allSettled([
      settlePaypalCapture(db, capture),
      settlePaypalCapture(db, { ...capture, eventId: "WH-2" }),
    ]);

    // A loser may surface the unique-capture violation (PayPal then retries and no-ops);
    // what must hold is that the money is only ever applied once.
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(await payments()).toHaveLength(1);
    expect(await invoices()).toHaveLength(1);
    expect(await balanceOf(user.id)).toBe(55);
    expect(await ledgerFor(user.id)).toHaveLength(1);
  });

  it("rejects a capture for an order Renvia never created", async () => {
    const { user, capture } = await setup();

    await expect(settlePaypalCapture(db, { ...capture, orderId: "UNKNOWN-ORDER" })).rejects.toThrow(
      "No Renvia PayPal checkout matches this order",
    );
    expect(await balanceOf(user.id)).toBe(5);
    expect(await payments()).toHaveLength(0);
  });

  it("rejects a capture whose amount differs from the checkout", async () => {
    const { user, capture } = await setup();

    await expect(settlePaypalCapture(db, { ...capture, amountCents: 1 })).rejects.toThrow("does not match");
    expect(await balanceOf(user.id)).toBe(5);
    expect(await payments()).toHaveLength(0);
  });

  it("rejects a capture whose currency differs from the checkout", async () => {
    const { user, capture } = await setup();

    await expect(settlePaypalCapture(db, { ...capture, currency: "EUR" })).rejects.toThrow("does not match");
    expect(await balanceOf(user.id)).toBe(5);
  });

  it("refuses to settle a subscription checkout as a one-off capture", async () => {
    const user = await makeUser();
    const [plan] = await db
      .insert(schema.billingPlans)
      .values({ slug: "pro", name: "Pro", description: "Pro plan", priceCents: 1000, monthlyCredits: 100, interval: "month" })
      .returning();
    const checkout = await makePaypalCheckout(user.id, "", {
      kind: "subscription",
      planId: plan!.id,
      creditPackId: null,
    });

    await expect(
      settlePaypalCapture(db, {
        eventId: "WH-1",
        captureId: "CAPTURE-S",
        orderId: checkout.providerCheckoutId!,
        amountCents: 1000,
        currency: "USD",
      }),
    ).rejects.toThrow("subscription cannot be settled");
    expect(await balanceOf(user.id)).toBe(0);
  });
});

describe("PayPal purchase reversal", () => {
  async function paid(packCredits = 50) {
    const ctx = await setup(packCredits);
    await settlePaypalCapture(db, ctx.capture);
    const [payment] = await payments();
    return { ...ctx, payment: payment! };
  }

  it("takes the purchased credits back once, however many times the refund arrives", async () => {
    const { user, payment } = await paid(50);

    await reversePaypalPurchaseCredits(db, payment.id, "REFUND-1");
    await reversePaypalPurchaseCredits(db, payment.id, "REFUND-1");

    expect(await balanceOf(user.id)).toBe(5);
    const reversals = (await ledgerFor(user.id)).filter((l) => l.reason === "purchase_refund");
    expect(reversals).toHaveLength(1);
    expect(reversals[0]).toMatchObject({ amount: -50, paymentId: payment.id });
  });

  it("is refundable while the purchased credits are unspent", async () => {
    const { payment } = await paid(50);
    await expect(assertPaypalPurchaseRefundable(db, payment.id)).resolves.toBeUndefined();
  });

  it("requires manual review once the purchased credits have been spent", async () => {
    const { user, payment } = await paid(50);
    await db.update(schema.users).set({ creditBalance: 10 }).where(eq(schema.users.id, user.id));

    await expect(assertPaypalPurchaseRefundable(db, payment.id)).rejects.toThrow("manual review");
    await expect(reversePaypalPurchaseCredits(db, payment.id, "REFUND-1")).rejects.toThrow("manual review");
    expect(await balanceOf(user.id)).toBe(10);
    expect((await ledgerFor(user.id)).filter((l) => l.reason === "purchase_refund")).toHaveLength(0);
  });

  it("reports an already-reversed payment as not refundable", async () => {
    const { payment } = await paid(50);
    await reversePaypalPurchaseCredits(db, payment.id, "REFUND-1");

    await expect(assertPaypalPurchaseRefundable(db, payment.id)).rejects.toThrow("already had its credits reversed");
  });
});
