import { and, eq } from "drizzle-orm";
import { schema } from "@renvia/db";
import { describe, expect, it, vi } from "vitest";
import { getBillingEntitlement } from "../src/lib/billing.js";
import {
  createChargedRender,
  createChargedSegmentation,
  InsufficientBetaCreditsError,
  InsufficientCreditsError,
  refundIfFailed,
  refundRender,
  refundSegmentationIfNeeded,
} from "../src/lib/credits.js";
import { reserveBudget } from "../src/lib/engine.js";
import {
  expireBetaCredits,
  grantBetaCredits,
  liveBetaContext,
  noteProgramSpend,
  programSpendMicros,
  reserveProgramBudget,
  settleBetaCredits,
} from "../src/lib/beta.js";
import { ensureCreditPeriod } from "../src/lib/planCredits.js";
import { assertPaypalPurchaseRefundable, reversePaypalPurchaseCredits } from "../src/lib/paypalSettlement.js";
import { ago, callAdmin, DAY } from "./support/admin.js";
import { bucketsOf, db, enroll, makeBetaProgram, makeProject, makeRender, makeSegmentation, makeUser } from "./support/db.js";

// Beta credits: a bucket inside the balance that only beta-funded jobs spend, granted within the
// program's limits, expired exactly once, and never mixed with what the customer paid for.
vi.mock("@clerk/backend", async () => (await import("./support/clerkStub.js")).clerkStub());

const USD = 1_000_000;
const ledger = schema.creditLedger;
const rows = (userId: string) => db.select().from(ledger).where(eq(ledger.userId, userId)).orderBy(ledger.createdAt);

/** A tester holding `beta` beta credits (granted through the real path) and `own` other credits. */
async function tester({ beta = 25, own = 0, plan = 0, program }: { beta?: number; own?: number; plan?: number; program?: typeof schema.betaPrograms.$inferSelect } = {}) {
  program ??= await makeBetaProgram();
  const user = await makeUser({ creditBalance: own + plan, planCredits: plan });
  const enrollment = await enroll(program.id, user.id);
  if (beta > 0) expect(await grantBetaCredits(db, { enrollmentId: enrollment.id, amount: beta, note: "welcome", idempotencyKey: `enroll:${enrollment.id}` })).toMatchObject({ status: "granted" });
  const project = await makeProject(user.id);
  return { program, user, enrollment, project };
}

const renderValues = (projectId: string, costMicros = 40_000) => ({
  projectId,
  sourceImageUrl: "https://example.test/source.png",
  prompt: "test",
  status: "pending" as const,
  costMicros,
});

describe("granting beta credits", () => {
  it("adds them to the beta bucket and the balance, and records the grant against the enrollment", async () => {
    const { user, enrollment } = await tester({ beta: 25, own: 7, plan: 3 });

    expect(await bucketsOf(user.id)).toEqual({ balance: 35, plan: 3, beta: 25 });
    const [grant] = (await rows(user.id)).filter((row) => row.reason === "beta_grant");
    expect(grant).toMatchObject({ amount: 25, betaAmount: 25, planAmount: 0, betaEnrollmentId: enrollment.id });
    const [after] = await db.select().from(schema.betaEnrollments).where(eq(schema.betaEnrollments.id, enrollment.id));
    expect(after!.creditsGranted).toBe(25);
  });

  it("treats a retry with the same key as the same grant", async () => {
    const { user, enrollment } = await tester({ beta: 0 });
    const grant = { enrollmentId: enrollment.id, amount: 10, note: "top-up", idempotencyKey: "topup-1" };

    expect(await grantBetaCredits(db, grant)).toMatchObject({ status: "granted" });
    expect(await grantBetaCredits(db, grant)).toMatchObject({ status: "replayed" });

    expect(await bucketsOf(user.id)).toEqual({ balance: 10, plan: 0, beta: 10 });
    expect((await rows(user.id)).filter((row) => row.reason === "beta_grant")).toHaveLength(1);
  });

  it("refuses to take a tester past the per-tester ceiling", async () => {
    const program = await makeBetaProgram({ creditsPerTester: 25, maxCreditsPerTester: 30 });
    const { user, enrollment } = await tester({ beta: 25, program });

    expect(await grantBetaCredits(db, { enrollmentId: enrollment.id, amount: 6, note: "too much", idempotencyKey: "k1" })).toEqual({ status: "refused", reason: "tester_limit" });
    expect(await grantBetaCredits(db, { enrollmentId: enrollment.id, amount: 5, note: "fits", idempotencyKey: "k2" })).toMatchObject({ status: "granted" });
    expect((await bucketsOf(user.id)).beta).toBe(30);
  });

  it("refuses to take the program past its credit pool", async () => {
    const program = await makeBetaProgram({ creditPool: 40 });
    await tester({ beta: 25, program });
    const second = await tester({ beta: 0, program });

    expect(await grantBetaCredits(db, { enrollmentId: second.enrollment.id, amount: 25, note: "x", idempotencyKey: "k" })).toEqual({ status: "refused", reason: "pool_limit" });
    expect(await grantBetaCredits(db, { enrollmentId: second.enrollment.id, amount: 15, note: "x", idempotencyKey: "k2" })).toMatchObject({ status: "granted" });
  });

  it("grants nothing to a suspended, completed or revoked enrollment", async () => {
    for (const status of ["suspended", "completed", "revoked"] as const) {
      const program = await makeBetaProgram();
      const user = await makeUser();
      const enrollment = await enroll(program.id, user.id, { status });
      expect(await grantBetaCredits(db, { enrollmentId: enrollment.id, amount: 5, note: "x", idempotencyKey: status })).toEqual({ status: "refused", reason: "not_active" });
      expect((await bucketsOf(user.id)).beta).toBe(0);
    }
  });

  it("never exceeds the per-tester ceiling when top-ups race", async () => {
    const program = await makeBetaProgram({ creditsPerTester: 0, maxCreditsPerTester: 30 });
    const { user, enrollment } = await tester({ beta: 0, program });

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => grantBetaCredits(db, { enrollmentId: enrollment.id, amount: 10, note: "race", idempotencyKey: `race-${i}` })),
    );

    expect(results.filter((result) => result.status === "granted")).toHaveLength(3);
    expect((await bucketsOf(user.id)).beta).toBe(30);
  });

  it("never exceeds the program pool when grants to different testers race", async () => {
    const program = await makeBetaProgram({ creditsPerTester: 0, creditPool: 50 });
    const testers = await Promise.all(Array.from({ length: 4 }, () => tester({ beta: 0, program })));

    const results = await Promise.all(testers.map(({ enrollment }) => grantBetaCredits(db, { enrollmentId: enrollment.id, amount: 20, note: "race", idempotencyKey: "pool" })));

    expect(results.filter((result) => result.status === "granted")).toHaveLength(2);
  });
});

describe("beta-funded charges", () => {
  it("take only beta credits and attribute the job to the program", async () => {
    const { program, user, enrollment, project } = await tester({ beta: 25, own: 10, plan: 5 });

    const render = await createChargedRender(db, user.id, 2, renderValues(project.id), { programId: program.id, enrollmentId: enrollment.id });

    expect(render.betaProgramId).toBe(program.id);
    expect(await bucketsOf(user.id)).toEqual({ balance: 38, plan: 5, beta: 23 });
    const [charge] = (await rows(user.id)).filter((row) => row.reason === "render");
    expect(charge).toMatchObject({ amount: -2, betaAmount: -2, planAmount: 0, betaEnrollmentId: enrollment.id });
  });

  it("refuse when beta credits run short, even with plenty of the tester's own credits", async () => {
    const { program, user, enrollment, project } = await tester({ beta: 1, own: 50 });

    await expect(createChargedRender(db, user.id, 2, renderValues(project.id), { programId: program.id, enrollmentId: enrollment.id })).rejects.toBeInstanceOf(InsufficientBetaCreditsError);

    expect(await bucketsOf(user.id)).toEqual({ balance: 51, plan: 0, beta: 1 });
    expect(await db.select().from(schema.renders)).toHaveLength(0);
  });

  it("never overdraw beta credits when submissions race", async () => {
    const { program, user, enrollment, project } = await tester({ beta: 5, own: 100 });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => createChargedRender(db, user.id, 1, renderValues(project.id), { programId: program.id, enrollmentId: enrollment.id })),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(5);
    expect(await bucketsOf(user.id)).toEqual({ balance: 100, plan: 0, beta: 0 });
  });

  it("work for automatic selections too", async () => {
    const { program, user, enrollment } = await tester({ beta: 3, own: 4 });

    const selection = await createChargedSegmentation(db, user.id, 1, { imageUrl: "https://example.test/a.png", model: "mock", costMicros: 5_000 }, { programId: program.id, enrollmentId: enrollment.id });

    expect(selection.betaProgramId).toBe(program.id);
    expect(await bucketsOf(user.id)).toEqual({ balance: 6, plan: 0, beta: 2 });
  });
});

describe("account-funded charges", () => {
  it("can never reach into beta credits", async () => {
    const { user, project } = await tester({ beta: 25, own: 1 });

    await expect(createChargedRender(db, user.id, 2, renderValues(project.id))).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(await bucketsOf(user.id)).toEqual({ balance: 26, plan: 0, beta: 25 });
  });

  it("still spend plan credits first, then purchased ones, leaving beta credits alone", async () => {
    const { user, project } = await tester({ beta: 25, own: 4, plan: 3 });

    const render = await createChargedRender(db, user.id, 5, renderValues(project.id));

    expect(render.betaProgramId).toBeNull();
    expect(await bucketsOf(user.id)).toEqual({ balance: 27, plan: 0, beta: 25 });
  });
});

describe("refunds", () => {
  it("return a failed beta-funded render's credits to the beta bucket, once", async () => {
    const { program, user, enrollment, project } = await tester({ beta: 25, own: 5 });
    const render = await createChargedRender(db, user.id, 2, renderValues(project.id), { programId: program.id, enrollmentId: enrollment.id });
    const [failed] = await db.update(schema.renders).set({ status: "failed" }).where(eq(schema.renders.id, render.id)).returning();

    await Promise.all([refundIfFailed(db, failed!), refundIfFailed(db, failed!)]);

    expect(await bucketsOf(user.id)).toEqual({ balance: 30, plan: 0, beta: 25 });
    const [refund] = (await rows(user.id)).filter((row) => row.reason === "render_refund");
    expect(refund).toMatchObject({ amount: 2, betaAmount: 2, betaEnrollmentId: enrollment.id });
  });

  it("return only the refunded part of a beta-funded charge", async () => {
    const { program, user, enrollment, project } = await tester({ beta: 25 });
    const render = await createChargedRender(db, user.id, 3, renderValues(project.id), { programId: program.id, enrollmentId: enrollment.id });

    await refundRender(db, render, 1);

    expect(await bucketsOf(user.id)).toEqual({ balance: 23, plan: 0, beta: 23 });
  });

  it("return a failed selection's beta credits", async () => {
    const { program, user, enrollment } = await tester({ beta: 4 });
    const selection = await createChargedSegmentation(db, user.id, 1, { imageUrl: "https://example.test/a.png", model: "mock" }, { programId: program.id, enrollmentId: enrollment.id });

    await refundSegmentationIfNeeded(db, { ...selection, status: "failed" });

    expect(await bucketsOf(user.id)).toEqual({ balance: 4, plan: 0, beta: 4 });
  });

  it("expire straight away when the program has already ended for the tester", async () => {
    const { program, user, enrollment, project } = await tester({ beta: 25, own: 5 });
    const render = await createChargedRender(db, user.id, 2, renderValues(project.id), { programId: program.id, enrollmentId: enrollment.id });
    await db.update(schema.betaEnrollments).set({ status: "completed" }).where(eq(schema.betaEnrollments.id, enrollment.id));
    await expireBetaCredits(db, user.id, enrollment.id);
    expect(await bucketsOf(user.id)).toEqual({ balance: 5, plan: 0, beta: 0 });

    await refundRender(db, { ...render, status: "failed" }, 2);

    expect(await bucketsOf(user.id)).toEqual({ balance: 5, plan: 0, beta: 0 });
    const reasons = (await rows(user.id)).map((row) => [row.reason, row.amount]);
    expect(reasons).toEqual(expect.arrayContaining([["render_refund", 2], ["beta_expiry", -2]]));
  });
});

describe("expiry", () => {
  it("removes only beta credits and records it once, however many callers race", async () => {
    const { user, enrollment } = await tester({ beta: 25, own: 10, plan: 4 });

    const removed = await Promise.all([expireBetaCredits(db, user.id, enrollment.id), expireBetaCredits(db, user.id, enrollment.id), expireBetaCredits(db, user.id, enrollment.id)]);

    expect(removed.reduce((sum, n) => sum + n, 0)).toBe(25);
    expect(await bucketsOf(user.id)).toEqual({ balance: 14, plan: 4, beta: 0 });
    const expiries = (await rows(user.id)).filter((row) => row.reason === "beta_expiry");
    expect(expiries).toHaveLength(1);
    expect(expiries[0]).toMatchObject({ amount: -25, betaAmount: -25, betaEnrollmentId: enrollment.id });
  });

  it("completes an enrollment that has passed its end date and expires its credits", async () => {
    const program = await makeBetaProgram({ startsAt: ago(30 * DAY), endsAt: ago(DAY) });
    const { user, enrollment } = await tester({ beta: 0, own: 3, program });
    // Granted while it was running.
    await db.update(schema.users).set({ creditBalance: 28, betaCredits: 25 }).where(eq(schema.users.id, user.id));

    await settleBetaCredits(db, user.id);

    const [after] = await db.select().from(schema.betaEnrollments).where(eq(schema.betaEnrollments.id, enrollment.id));
    expect(after).toMatchObject({ status: "completed", endedReason: "ended" });
    expect(await bucketsOf(user.id)).toEqual({ balance: 3, plan: 0, beta: 0 });
  });

  it("keeps a tester running past the program's end when their own end date was extended", async () => {
    const program = await makeBetaProgram({ startsAt: ago(30 * DAY), endsAt: ago(DAY) });
    const { user, enrollment } = await tester({ beta: 0, program });
    await db.update(schema.betaEnrollments).set({ endsAt: new Date(Date.now() + 5 * DAY) }).where(eq(schema.betaEnrollments.id, enrollment.id));

    await settleBetaCredits(db, user.id);

    expect(await liveBetaContext(db, user.id)).toMatchObject({ running: true, enrollment: { status: "active" } });
  });

  it("expires leftover beta credits of a user with no live enrollment", async () => {
    const { user, enrollment } = await tester({ beta: 10, own: 2 });
    await db.update(schema.betaEnrollments).set({ status: "revoked" }).where(eq(schema.betaEnrollments.id, enrollment.id));

    await settleBetaCredits(db, user.id);

    expect(await bucketsOf(user.id)).toEqual({ balance: 2, plan: 0, beta: 0 });
  });

  it("leaves a suspended tester's credits frozen, not expired", async () => {
    const { user, enrollment } = await tester({ beta: 10 });
    await db.update(schema.betaEnrollments).set({ status: "suspended" }).where(eq(schema.betaEnrollments.id, enrollment.id));

    await settleBetaCredits(db, user.id);

    expect((await bucketsOf(user.id)).beta).toBe(10);
    expect(await liveBetaContext(db, user.id)).toMatchObject({ running: false, enrollment: { status: "suspended" } });
  });
});

describe("the program budget", () => {
  it("holds spend within the cap, counting the program's live jobs and holds only", async () => {
    const { program, project } = await tester({ beta: 25 });
    const other = await makeBetaProgram();
    await makeRender(project.id, { status: "succeeded", costMicros: 6 * USD, betaProgramId: program.id });
    // fal refused it, so it carries no cost; one cancelled after fal took it keeps its 1 USD.
    await makeRender(project.id, { status: "failed", costMicros: 0, betaProgramId: program.id });
    await makeRender(project.id, { status: "failed", costMicros: 1 * USD, costState: "uncertain", uncertainCostMicros: 1 * USD, betaProgramId: program.id });
    await makeRender(project.id, { status: "succeeded", costMicros: 100 * USD }); // account-funded
    await makeRender(project.id, { status: "succeeded", costMicros: 100 * USD, betaProgramId: other.id });

    expect(await programSpendMicros(db, program.id)).toBe(7 * USD);
    expect(await reserveProgramBudget(db, program.id, 4 * USD, 10 * USD)).toBeNull();
    expect(await reserveProgramBudget(db, program.id, 2 * USD, 10 * USD)).not.toBeNull();
    expect(await reserveProgramBudget(db, program.id, 2 * USD, 10 * USD)).toBeNull();
  });

  it("counts the program's selections too", async () => {
    const { program, user } = await tester({ beta: 25 });
    await makeSegmentation(user.id, { status: "succeeded", costMicros: 9 * USD, betaProgramId: program.id });

    expect(await reserveProgramBudget(db, program.id, 2 * USD, 10 * USD)).toBeNull();
  });

  it("never grants more than the cap when requests arrive together", async () => {
    const { program } = await tester({ beta: 25 });

    const holds = await Promise.all(Array.from({ length: 8 }, () => reserveProgramBudget(db, program.id, 40_000, 100_000)));

    expect(holds.filter((id) => id !== null)).toHaveLength(2);
  });

  it("is invisible to the global cap, which already holds the same job", async () => {
    const { program } = await tester({ beta: 25 });
    expect(await reserveProgramBudget(db, program.id, 9 * USD, 10 * USD)).not.toBeNull();

    expect(await reserveBudget(db, 9 * USD, 10)).not.toBeNull();
  });

  it("warns operators once spend reaches the warning threshold, and again at the cap", async () => {
    const program = await makeBetaProgram({ budgetUsd: "10", budgetWarningPercent: 80 });
    const { project } = await tester({ beta: 25, program });
    const incidents = () => db.select().from(schema.incidents).where(eq(schema.incidents.sourceId, program.id));

    await makeRender(project.id, { status: "succeeded", costMicros: 7 * USD, betaProgramId: program.id });
    await noteProgramSpend(db, program);
    expect(await incidents()).toHaveLength(0);

    await makeRender(project.id, { status: "succeeded", costMicros: 1 * USD, betaProgramId: program.id });
    await noteProgramSpend(db, program);
    await noteProgramSpend(db, program);
    expect((await incidents()).map((row) => row.fingerprint)).toEqual([`beta-budget:${program.id}:80`]);

    await makeRender(project.id, { status: "succeeded", costMicros: 2 * USD, betaProgramId: program.id });
    await noteProgramSpend(db, program);
    expect((await incidents()).map((row) => row.fingerprint).sort()).toEqual([`beta-budget:${program.id}:100`, `beta-budget:${program.id}:80`]);
  });
});

describe("existing credit writers leave beta credits alone", () => {
  it("the first plan period keeps beta credits instead of expiring them as promotional", async () => {
    await db.insert(schema.billingPlans).values({ slug: "starter", name: "Starter", description: "Free", monthlyCredits: 20 });
    const [starter] = await db.select().from(schema.billingPlans);
    const program = await makeBetaProgram();
    const user = await makeUser({ createdAt: ago(10 * DAY) }, { inCreditPeriod: false });
    await db.insert(schema.userEntitlements).values({ userId: user.id, planId: starter!.id, status: "active" });
    const enrollment = await enroll(program.id, user.id);
    await grantBetaCredits(db, { enrollmentId: enrollment.id, amount: 25, note: "welcome", idempotencyKey: "w" });

    await ensureCreditPeriod(db, user.id, user.createdAt, (await getBillingEntitlement(db, user.id))!);

    expect(await bucketsOf(user.id)).toEqual({ balance: 45, plan: 20, beta: 25 });
    expect((await rows(user.id)).some((row) => row.reason === "promo_expiry")).toBe(false);
  });

  it("an admin removal takes only non-beta credits", async () => {
    await db.insert(schema.billingPlans).values({ slug: "starter", name: "Starter", description: "Free" });
    await makeUser({ clerkId: "admin", email: "admin@renvia.test", role: "admin" });
    const { user } = await tester({ beta: 25, own: 5, plan: 3 });

    const tooMuch = await callAdmin("admin", "POST", `/users/${user.id}/credits`, { amount: -9, note: "correction" });
    expect(tooMuch.status).toBe(400);
    expect(await bucketsOf(user.id)).toEqual({ balance: 33, plan: 3, beta: 25 });

    const res = await callAdmin("admin", "POST", `/users/${user.id}/credits`, { amount: -6, note: "correction" });
    expect(res.status).toBe(200);
    expect(await bucketsOf(user.id)).toEqual({ balance: 27, plan: 2, beta: 25 });
  });

  it("a PayPal refund can't be reversed out of beta credits", async () => {
    const { user } = await tester({ beta: 25, own: 0 });
    const [payment] = await db.insert(schema.billingPayments).values({ userId: user.id, provider: "paypal", providerPaymentId: "CAP-1", status: "paid", currency: "USD", amountCents: 1000 }).returning();
    // The 10 purchased credits were bought and then spent.
    await db.insert(ledger).values({ userId: user.id, paymentId: payment!.id, amount: 10, reason: "purchase" });

    await expect(assertPaypalPurchaseRefundable(db, payment!.id)).rejects.toThrow(/manual review/);
    await expect(reversePaypalPurchaseCredits(db, payment!.id, "REF-1")).rejects.toThrow(/manual review/);
    expect(await bucketsOf(user.id)).toEqual({ balance: 25, plan: 0, beta: 25 });
  });

  it("purchased and plan credits are untouched by enrolling, spending beta credits and expiry", async () => {
    const { program, user, enrollment, project } = await tester({ beta: 25, own: 12, plan: 8 });
    await createChargedRender(db, user.id, 3, renderValues(project.id), { programId: program.id, enrollmentId: enrollment.id });
    await db.update(schema.betaEnrollments).set({ status: "completed" }).where(eq(schema.betaEnrollments.id, enrollment.id));
    await settleBetaCredits(db, user.id);

    expect(await bucketsOf(user.id)).toEqual({ balance: 20, plan: 8, beta: 0 });
    const own = (await rows(user.id)).filter((row) => !["beta_grant", "beta_expiry"].includes(row.reason) && row.betaAmount === 0);
    expect(own).toHaveLength(0);
    const [ended] = await db.select().from(schema.betaEnrollments).where(and(eq(schema.betaEnrollments.id, enrollment.id)));
    expect(ended!.status).toBe("completed");
  });
});
