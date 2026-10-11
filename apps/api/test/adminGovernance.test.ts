import { eq } from "drizzle-orm";
import { schema } from "@renvia/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settlePaypalCapture } from "../src/lib/paypalSettlement.js";
import { adminEventInsert, balanceCapGuard, isBalanceCapViolation } from "../src/routes/admin/shared.js";
import { adminEnv, callAdmin as call, MISSING_ID } from "./support/admin.js";
import { balanceOf, db, makeCreditPack, makePaypalCheckout, makeUser } from "./support/db.js";

// The governed actions: what a single operator can't do alone, and the checks that run again
// when an approved request is finally executed.
vi.mock("@clerk/backend", async () => (await import("./support/clerkStub.js")).clerkStub());

const paypalEnv = { ...adminEnv, PAYPAL_CLIENT_ID: "test-client-id", PAYPAL_CLIENT_SECRET: "test-client-secret", PAYPAL_WEBHOOK_ID: "test-webhook-id", PAYPAL_ENV: "sandbox" as const };

let actors: Awaited<ReturnType<typeof seed>>;

async function seed() {
  await db.insert(schema.billingPlans).values({ slug: "starter", name: "Starter", description: "Starter plan" });
  const admin = await makeUser({ clerkId: "admin", email: "admin@renvia.test", role: "admin" });
  const admin2 = await makeUser({ clerkId: "admin2", email: "admin2@renvia.test", role: "admin" });
  const billing = await makeUser({ clerkId: "billing", email: "billing@renvia.test", role: "billing" });
  const customer = await makeUser({ clerkId: "customer", email: "customer@example.test", creditBalance: 15 });
  const customer2 = await makeUser({ clerkId: "customer2", email: "customer2@example.test", creditBalance: 0 });
  return { admin, admin2, billing, customer, customer2 };
}

beforeEach(async () => {
  actors = await seed();
});

const events = (action: string) => db.select().from(schema.adminEvents).where(eq(schema.adminEvents.action, action));
const setGovernance = (values: Partial<typeof schema.governanceSettings.$inferInsert>) =>
  db.insert(schema.governanceSettings).values({ id: 1, ...values }).onConflictDoUpdate({ target: schema.governanceSettings.id, set: values });
const approvals = () => db.select().from(schema.approvalRequests);

/** Approves as admin2 and executes as `executor`, returning the execute response. */
async function approveAndExecute(approvalId: string, executor = "admin2") {
  expect((await call("admin2", "POST", `/approvals/${approvalId}/approve`, {})).status).toBe(200);
  return call(executor, "POST", `/approvals/${approvalId}/execute`, {}, paypalEnv);
}

describe("refunds", () => {
  let refundCalls: { url: string; requestId: string | null }[];
  let failNextRefund: boolean;

  /** A captured $10 PayPal payment that bought 50 still-unspent credits. */
  async function paidPayment() {
    const pack = await makeCreditPack({ credits: 50, priceCents: 1000 });
    const checkout = await makePaypalCheckout(actors.customer.id, pack.id);
    await settlePaypalCapture(db, { eventId: "WH-1", captureId: "CAPTURE-1", orderId: checkout.providerCheckoutId!, amountCents: 1000, currency: "USD" });
    const [payment] = await db.select().from(schema.billingPayments);
    return payment!;
  }

  beforeEach(() => {
    refundCalls = [];
    failNextRefund = false;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "token" });
      if (url.includes("/refund")) {
        refundCalls.push({ url, requestId: new Headers(init?.headers).get("PayPal-Request-Id") });
        if (failNextRefund) { failNextRefund = false; return new Response("upstream", { status: 500 }); }
        return Response.json({ id: "REFUND-1" });
      }
      throw new Error(`Unexpected fetch ${url}`);
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("refunds directly below the approval threshold", async () => {
    const payment = await paidPayment();

    const res = await call("billing", "POST", `/billing/payments/${payment.id}/refund`, {}, paypalEnv);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: payment.id, status: "refunded" });
    expect(refundCalls).toHaveLength(1);
    expect(await balanceOf(actors.customer.id)).toBe(15);
    expect((await events("billing.payment"))[0]!.summary).toBe("Refunded PayPal payment CAPTURE-1");
  });

  it("holds a refund at the threshold for approval without calling PayPal", async () => {
    await setGovernance({ refundApprovalThresholdCents: 1000 });
    const payment = await paidPayment();

    const res = await call("billing", "POST", `/billing/payments/${payment.id}/refund`, { reason: "customer asked" }, paypalEnv);

    expect(res.status).toBe(202);
    const { approvalId } = (await res.json()) as { approvalId: string };
    expect(refundCalls).toHaveLength(0);
    const [request] = await approvals();
    expect(request).toMatchObject({ id: approvalId, action: "refund", status: "pending", riskValue: 1000, threshold: 1000, reason: "customer asked", targetId: payment.id });
    const [row] = await db.select().from(schema.billingPayments);
    expect(row!.status).toBe("paid");

    // Asking again points at the request already waiting rather than opening another.
    const again = await call("billing", "POST", `/billing/payments/${payment.id}/refund`, {}, paypalEnv);
    expect(await again.json()).toMatchObject({ pendingApproval: true, approvalId });
    expect(await approvals()).toHaveLength(1);
  });

  it("refunds once an approved request is executed, and only once", async () => {
    await setGovernance({ refundApprovalThresholdCents: 1000 });
    const payment = await paidPayment();
    const { approvalId } = (await (await call("billing", "POST", `/billing/payments/${payment.id}/refund`, {}, paypalEnv)).json()) as { approvalId: string };
    expect((await call("billing", "POST", `/approvals/${approvalId}/approve`, {})).status).toBe(403); // not an admin, and the requester

    const executed = await approveAndExecute(approvalId, "billing");

    expect(executed.status).toBe(200);
    expect(await executed.json()).toEqual({ id: approvalId, status: "executed" });
    expect(refundCalls).toEqual([expect.objectContaining({ requestId: `refund-${payment.id}` })]);
    const [row] = await db.select().from(schema.billingPayments);
    expect(row!.status).toBe("refunded");
    expect(await balanceOf(actors.customer.id)).toBe(15);
    expect((await call("billing", "POST", `/approvals/${approvalId}/execute`, {}, paypalEnv)).status).toBe(409);
    expect(refundCalls).toHaveLength(1);
  });

  it("checks refundability again at execution", async () => {
    await setGovernance({ refundApprovalThresholdCents: 1000 });
    const payment = await paidPayment();
    const { approvalId } = (await (await call("billing", "POST", `/billing/payments/${payment.id}/refund`, {}, paypalEnv)).json()) as { approvalId: string };
    // The purchased credits get spent between approval and execution.
    await db.update(schema.users).set({ creditBalance: 10 }).where(eq(schema.users.id, actors.customer.id));

    const executed = await approveAndExecute(approvalId, "billing");

    expect(executed.status).toBe(409);
    expect(await executed.json()).toMatchObject({ code: "refund_manual_review" });
    expect(refundCalls).toHaveLength(0);
    const [request] = await approvals();
    expect(request!.status).toBe("approved");
  });

  it("hands a failed execution back, and the retry reuses the PayPal request id", async () => {
    await setGovernance({ refundApprovalThresholdCents: 1000 });
    const payment = await paidPayment();
    const { approvalId } = (await (await call("billing", "POST", `/billing/payments/${payment.id}/refund`, {}, paypalEnv)).json()) as { approvalId: string };
    failNextRefund = true;

    expect((await approveAndExecute(approvalId, "billing")).status).toBe(502);
    expect((await approvals())[0]!.status).toBe("approved");

    expect((await call("billing", "POST", `/approvals/${approvalId}/execute`, {}, paypalEnv)).status).toBe(200);
    expect(refundCalls.map((call) => call.requestId)).toEqual([`refund-${payment.id}`, `refund-${payment.id}`]);
  });
});

describe("maintenance", () => {
  it("holds a maintenance switch for approval and saves the rest of the change", async () => {
    const res = await call("admin", "PUT", "/settings", { maintenanceRenders: true, maxUploadMb: 20, reason: "fal outage" });

    expect(res.status).toBe(202);
    const body = (await res.json()) as { maintenanceRenders: boolean; maxUploadMb: number; pendingApproval: { approvalId: string; fields: string[] } };
    expect(body).toMatchObject({ maintenanceRenders: false, maxUploadMb: 20, pendingApproval: { fields: ["maintenanceRenders"] } });
    const [request] = await approvals();
    expect(request).toMatchObject({ id: body.pendingApproval.approvalId, action: "maintenance", reason: "fal outage", payload: { maintenanceRenders: true } });
    expect((await events("settings.update"))[0]!.summary).toBe("Updated settings: maxUploadMb");
  });

  it("turns maintenance on once a second admin approves and it is executed", async () => {
    const held = await call("admin", "PUT", "/settings", { maintenanceRenders: true });
    const { pendingApproval } = (await held.json()) as { pendingApproval: { approvalId: string } };
    expect((await call("billing", "POST", `/approvals/${pendingApproval.approvalId}/execute`, {})).status).toBe(403);

    const executed = await approveAndExecute(pendingApproval.approvalId, "admin");

    expect(executed.status).toBe(200);
    const [row] = await db.select().from(schema.appSettings);
    expect(row!.maintenanceRenders).toBe(true);
    const [change] = await events("settings.update");
    expect(change!.summary).toBe("Updated settings: maintenanceRenders (approved request)");
    expect(change!.detail).toMatchObject({ before: { maintenanceRenders: false }, after: { maintenanceRenders: true } });
  });

  it("needs no approval to resave the current state, or when the rule is off", async () => {
    expect((await call("admin", "PUT", "/settings", { maintenanceRenders: false })).status).toBe(200);
    await setGovernance({ maintenanceApprovalThreshold: 0 });
    expect((await call("admin", "PUT", "/settings", { maintenanceSegments: true })).status).toBe(200);
    const [row] = await db.select().from(schema.appSettings);
    expect(row!.maintenanceSegments).toBe(true);
    expect(await approvals()).toHaveLength(0);
  });
});

describe("the credit balance cap", () => {
  it("applies the current cap when an approved bulk grant is executed", async () => {
    const held = await call("admin", "POST", "/users/bulk-credits", { userIds: [actors.customer.id, actors.customer2.id], amount: 300, note: "promo" });
    const { approvalId } = (await held.json()) as { approvalId: string };
    await db.insert(schema.appSettings).values({ id: 1, maxCreditBalance: 100 });

    const executed = await approveAndExecute(approvalId);

    expect(executed.status).toBe(409);
    expect(await executed.json()).toMatchObject({ code: "balance_cap" });
    expect(await balanceOf(actors.customer.id)).toBe(15);
    expect(await balanceOf(actors.customer2.id)).toBe(0);
    expect((await approvals())[0]!.status).toBe("approved");
  });

  it("lets only one of two simultaneous grants fill the last room under the cap", async () => {
    await db.insert(schema.appSettings).values({ id: 1, maxCreditBalance: 20 });

    const results = await Promise.all([
      call("admin", "POST", `/users/${actors.customer.id}/credits`, { amount: 5, note: "a" }),
      call("admin2", "POST", `/users/${actors.customer.id}/credits`, { amount: 5, note: "b" }),
    ]);

    expect(results.map((res) => res.status).sort()).toEqual([200, 400]);
    expect(await balanceOf(actors.customer.id)).toBe(20);
  });

  it("rolls back every write in a batch that breaks the cap", async () => {
    let caught: unknown;
    try {
      await db.batch([
        db.update(schema.users).set({ creditBalance: 500 }).where(eq(schema.users.id, actors.customer.id)),
        balanceCapGuard(db, [actors.customer.id], 100),
      ]);
    } catch (error) {
      caught = error;
    }
    expect(isBalanceCapViolation(caught)).toBe(true);
    expect(await balanceOf(actors.customer.id)).toBe(15);
  });
});

describe("audit atomicity", () => {
  it("rolls back a change when its audit row can't be written", async () => {
    await expect(db.batch([
      db.update(schema.users).set({ disabled: true }).where(eq(schema.users.id, actors.customer.id)),
      adminEventInsert(db, { actorId: MISSING_ID, action: "user.update", targetType: "user", targetId: actors.customer.id, summary: "x" }),
    ])).rejects.toThrow();
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, actors.customer.id));
    expect(row!.disabled).toBe(false);
  });
});
