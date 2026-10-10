import { and, eq } from "drizzle-orm";
import { schema } from "@renvia/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBillingEntitlement } from "../src/lib/billing.js";
import { createChargedRender, refundIfFailed } from "../src/lib/credits.js";
import { addMonthsClamped, creditPeriodFor, ensureCreditPeriod, renewDueCreditPeriods, startPaidPeriod, topUpPlanCredits } from "../src/lib/planCredits.js";
import { ago, callAdmin as call, DAY } from "./support/admin.js";
import { db, makeProject, makeUser } from "./support/db.js";

// Monthly plan credits: what expires, what never does, and that each period's allowance is
// granted exactly once however often, or however concurrently, a renewal runs.
vi.mock("@clerk/backend", async () => (await import("./support/clerkStub.js")).clerkStub());

const users = schema.users;
const ledger = schema.creditLedger;

async function plans() {
  const [starter] = await db.insert(schema.billingPlans).values({ slug: "starter", name: "Starter", description: "Free", monthlyCredits: 20 }).returning();
  const [studio] = await db.insert(schema.billingPlans).values({ slug: "studio", name: "Studio", description: "Paid", priceCents: 2900, interval: "month", monthlyCredits: 200 }).returning();
  const [team] = await db.insert(schema.billingPlans).values({ slug: "team", name: "Team", description: "Paid", priceCents: 7900, interval: "month", monthlyCredits: 600 }).returning();
  return { starter: starter!, studio: studio!, team: team! };
}

let plan: Awaited<ReturnType<typeof plans>>;
beforeEach(async () => {
  plan = await plans();
});

const credits = async (userId: string) => {
  const [row] = await db.select({ balance: users.creditBalance, plan: users.planCredits }).from(users).where(eq(users.id, userId));
  return row!;
};
const rows = (userId: string) => db.select().from(ledger).where(eq(ledger.userId, userId)).orderBy(ledger.createdAt);
const renew = async (userId: string, signup: Date, now = new Date()) => {
  const billing = await getBillingEntitlement(db, userId);
  return ensureCreditPeriod(db, userId, signup, billing!, now);
};

/** A pre-launch or brand-new account: a balance and no credit period yet. */
async function accountWithoutPeriod(balance: number, createdAt = ago(10 * DAY)) {
  const user = await makeUser({ creditBalance: balance, createdAt }, { inCreditPeriod: false });
  await db.insert(schema.userEntitlements).values({ userId: user.id, planId: plan.starter.id, status: "active" });
  return user;
}

/** An account part-way through a period that started `daysAgo` and is due again at `dueAt`. */
async function accountInPeriod(balance: number, planCredits: number, { signup = ago(40 * DAY), start = ago(10 * DAY), dueAt = new Date(Date.now() + 20 * DAY), granted = 20 } = {}) {
  const user = await makeUser({ creditBalance: balance, planCredits, createdAt: signup }, { inCreditPeriod: false });
  await db.insert(schema.userEntitlements).values({ userId: user.id, planId: plan.starter.id, status: "active", creditPeriodStart: start, nextCreditGrantAt: dueAt, periodCreditsGranted: granted });
  return user;
}

describe("credit period dates", () => {
  it("keeps the signup day, clamped to short months", () => {
    const jan31 = new Date("2026-01-31T09:30:00Z");
    expect(addMonthsClamped(jan31, 1).toISOString()).toBe("2026-02-28T09:30:00.000Z");
    expect(addMonthsClamped(jan31, 2).toISOString()).toBe("2026-03-31T09:30:00.000Z");
    expect(addMonthsClamped(new Date("2027-12-31T00:00:00Z"), 2).toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("finds the period containing now, catching up over missed months to the current one only", () => {
    const signup = new Date("2026-01-15T12:00:00Z");
    expect(creditPeriodFor(signup, new Date("2026-05-20T00:00:00Z"))).toEqual({ start: new Date("2026-05-15T12:00:00Z"), next: new Date("2026-06-15T12:00:00Z") });
    expect(creditPeriodFor(signup, new Date("2026-05-15T11:59:59Z")).start).toEqual(new Date("2026-04-15T12:00:00Z"));
    expect(creditPeriodFor(signup, signup).start).toEqual(signup);
  });
});

describe("the first period", () => {
  it("replaces unspent signup credits with the allowance and keeps admin grants", async () => {
    const user = await accountWithoutPeriod(35);
    await db.insert(ledger).values([
      { userId: user.id, amount: 25, reason: "signup_bonus" },
      { userId: user.id, amount: 10, reason: "admin_grant", note: "promised" },
    ]);

    expect(await renew(user.id, user.createdAt)).toBe(true);

    expect(await credits(user.id)).toEqual({ balance: 30, plan: 20 });
    const added = (await rows(user.id)).filter((row) => row.reason === "plan_grant" || row.reason === "promo_expiry");
    expect(added.map((row) => [row.reason, row.amount, row.planAmount])).toEqual(expect.arrayContaining([["plan_grant", 20, 20], ["promo_expiry", -25, 0]]));
    const [entitlement] = await db.select().from(schema.userEntitlements).where(eq(schema.userEntitlements.userId, user.id));
    expect(entitlement).toMatchObject({ periodCreditsGranted: 20 });
    expect(entitlement!.nextCreditGrantAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("keeps purchased credits, and a new account simply gets the allowance", async () => {
    const buyer = await accountWithoutPeriod(50);
    await db.insert(ledger).values({ userId: buyer.id, amount: 50, reason: "purchase" });
    const fresh = await accountWithoutPeriod(0, new Date());

    await renew(buyer.id, buyer.createdAt);
    await renew(fresh.id, fresh.createdAt);

    expect(await credits(buyer.id)).toEqual({ balance: 70, plan: 20 });
    expect(await credits(fresh.id)).toEqual({ balance: 20, plan: 20 });
    expect((await rows(fresh.id)).map((row) => row.reason)).toEqual(["plan_grant"]);
  });

  it("starts once when two requests start it at the same time", async () => {
    const user = await accountWithoutPeriod(25);
    const [first, second] = await Promise.all([getBillingEntitlement(db, user.id), getBillingEntitlement(db, user.id)]);

    await Promise.all([ensureCreditPeriod(db, user.id, user.createdAt, first!), ensureCreditPeriod(db, user.id, user.createdAt, second!)]);

    expect(await credits(user.id)).toEqual({ balance: 20, plan: 20 });
    expect((await rows(user.id)).filter((row) => row.reason === "plan_grant")).toHaveLength(1);
  });
});

describe("renewal", () => {
  it("expires unspent plan credits, keeps the rest and grants the allowance again", async () => {
    // 5 unspent plan credits on top of 10 permanent ones.
    const user = await accountInPeriod(15, 5, { start: ago(31 * DAY), dueAt: ago(DAY) });

    expect(await renew(user.id, user.createdAt)).toBe(true);

    expect(await credits(user.id)).toEqual({ balance: 30, plan: 20 });
    const reasons = (await rows(user.id)).map((row) => [row.reason, row.amount]);
    expect(reasons).toEqual(expect.arrayContaining([["plan_grant", 20], ["plan_expiry", -5]]));
  });

  it("does nothing before the renewal date, and grants once when run twice", async () => {
    const early = await accountInPeriod(15, 5);
    expect(await renew(early.id, early.createdAt)).toBe(false);
    expect(await credits(early.id)).toEqual({ balance: 15, plan: 5 });

    const due = await accountInPeriod(15, 5, { start: ago(31 * DAY), dueAt: ago(DAY) });
    const stale = await getBillingEntitlement(db, due.id);
    await ensureCreditPeriod(db, due.id, due.createdAt, stale!);
    // Spend between the runs, so a second grant would show as restored credits.
    const project = await makeProject(due.id);
    await createChargedRender(db, due.id, 3, { projectId: project.id, sourceImageUrl: "https://example.test/s.png", prompt: "p" });
    await ensureCreditPeriod(db, due.id, due.createdAt, stale!); // a second run with the same stale view
    expect(await credits(due.id)).toEqual({ balance: 27, plan: 17 });
    expect((await rows(due.id)).filter((row) => row.reason === "plan_grant")).toHaveLength(1);
  });

  it("catches up after missed months with a single grant", async () => {
    const user = await accountInPeriod(4, 4, { signup: ago(200 * DAY), start: ago(150 * DAY), dueAt: ago(120 * DAY) });

    await renew(user.id, user.createdAt);

    expect(await credits(user.id)).toEqual({ balance: 20, plan: 20 });
    expect((await rows(user.id)).filter((row) => row.reason === "plan_grant")).toHaveLength(1);
    const [entitlement] = await db.select().from(schema.userEntitlements).where(eq(schema.userEntitlements.userId, user.id));
    expect(entitlement!.creditPeriodStart!.getTime()).toBeGreaterThan(ago(32 * DAY).getTime());
  });

  it("leaves a paid subscription to its provider unless an admin granted a plan", async () => {
    const user = await accountInPeriod(5, 5, { start: ago(31 * DAY), dueAt: ago(DAY) });
    await db.update(schema.userEntitlements).set({ planId: plan.studio.id, provider: "paypal" }).where(eq(schema.userEntitlements.userId, user.id));

    expect(await renew(user.id, user.createdAt)).toBe(false);
    expect(await credits(user.id)).toEqual({ balance: 5, plan: 5 });
  });

  it("renews due accounts from the daily job", async () => {
    const due = await accountInPeriod(15, 5, { start: ago(31 * DAY), dueAt: ago(DAY) });
    const notDue = await accountInPeriod(15, 5);

    expect(await renewDueCreditPeriods(db)).toEqual({ renewed: 1 });
    expect(await credits(due.id)).toEqual({ balance: 30, plan: 20 });
    expect(await credits(notDue.id)).toEqual({ balance: 15, plan: 5 });
  });
});

describe("spending and refunds", () => {
  it("spends plan credits first and returns them to plan credits on refund", async () => {
    const user = await accountInPeriod(30, 20);
    const project = await makeProject(user.id);
    const render = (charge: number) => createChargedRender(db, user.id, charge, { projectId: project.id, sourceImageUrl: "https://example.test/s.png", prompt: "p" });

    await render(2);
    expect(await credits(user.id)).toEqual({ balance: 28, plan: 18 });
    const big = await render(25);
    expect(await credits(user.id)).toEqual({ balance: 3, plan: 0 });
    const [charge] = await db.select().from(ledger).where(and(eq(ledger.renderId, big.id), eq(ledger.reason, "render")));
    expect(charge).toMatchObject({ amount: -25, planAmount: -18 });

    const [failed] = await db.update(schema.renders).set({ status: "failed" }).where(eq(schema.renders.id, big.id)).returning();
    await refundIfFailed(db, failed!);
    expect(await credits(user.id)).toEqual({ balance: 28, plan: 18 });
  });

  it("keeps plan credits within the balance when concurrent charges race", async () => {
    const user = await accountInPeriod(10, 10);
    const project = await makeProject(user.id);
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, () => createChargedRender(db, user.id, 3, { projectId: project.id, sourceImageUrl: "https://example.test/s.png", prompt: "p" })),
    );

    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    expect(await credits(user.id)).toEqual({ balance: 1, plan: 1 });
    const charged = await db.select().from(ledger).where(and(eq(ledger.userId, user.id), eq(ledger.reason, "render")));
    expect(charged.reduce((sum, row) => sum + row.planAmount, 0)).toBe(-9);
  });

  it("takes an admin removal from the balance without leaving plan credits above it", async () => {
    await makeUser({ clerkId: "admin", email: "admin@renvia.test", role: "admin" });
    const user = await accountInPeriod(25, 20);

    const res = await call("admin", "POST", `/users/${user.id}/credits`, { amount: -10, note: "correction" });

    expect(res.status).toBe(200);
    expect(await credits(user.id)).toEqual({ balance: 15, plan: 15 });
  });
});

describe("upgrades within a period", () => {
  it("adds only the difference from the highest allowance already granted", async () => {
    // 20 granted, 15 spent: upgrading to Studio adds 180, leaving 185.
    const user = await accountInPeriod(5, 5);

    expect(await topUpPlanCredits(db, user.id, 200)).toBe(180);
    expect(await credits(user.id)).toEqual({ balance: 185, plan: 185 });

    // Back down and up again: nothing more until a higher allowance is reached.
    expect(await topUpPlanCredits(db, user.id, 20)).toBe(0);
    expect(await topUpPlanCredits(db, user.id, 200)).toBe(0);
    expect(await topUpPlanCredits(db, user.id, 600)).toBe(400);
    expect(await credits(user.id)).toEqual({ balance: 585, plan: 585 });
  });

  it("never exceeds the highest allowance when top-ups race", async () => {
    const user = await accountInPeriod(20, 20);

    await Promise.all([topUpPlanCredits(db, user.id, 200), topUpPlanCredits(db, user.id, 600), topUpPlanCredits(db, user.id, 200)]);

    expect(await credits(user.id)).toEqual({ balance: 600, plan: 600 });
  });

  it("tops up when an admin grants a plan, and not again for the same plan", async () => {
    await makeUser({ clerkId: "admin", email: "admin@renvia.test", role: "admin" });
    const user = await accountInPeriod(5, 5);
    const grant = () => call("admin", "PUT", `/users/${user.id}/plan`, { planId: plan.studio.id, endsAt: null, reason: "demo" });

    expect((await grant()).status).toBe(200);
    expect(await credits(user.id)).toEqual({ balance: 185, plan: 185 });
    await call("admin", "POST", `/users/${user.id}/plan/clear`, { reason: "done" });
    expect((await grant()).status).toBe(200);
    expect(await credits(user.id)).toEqual({ balance: 185, plan: 185 });
  });
});

describe("paid renewals", () => {
  it("grants a payment's period once, even when the event is replayed", async () => {
    const user = await accountInPeriod(50, 30);
    const paidAt = new Date();
    const period = { userId: user.id, allowance: 200, start: paidAt, next: addMonthsClamped(paidAt, 1) };

    await startPaidPeriod(db, period);
    await startPaidPeriod(db, period);

    // 30 unspent plan credits expire; the 20 permanent ones stay.
    expect(await credits(user.id)).toEqual({ balance: 220, plan: 200 });
    expect((await rows(user.id)).filter((row) => row.reason === "plan_grant")).toHaveLength(1);
  });
});
