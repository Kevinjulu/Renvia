import { and, eq } from "drizzle-orm";
import { schema } from "@renvia/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decideFreeAllowance, normalizeEmail } from "../src/lib/freeAllowance.js";
import { renewDueCreditPeriods } from "../src/lib/planCredits.js";
import { reserveBudget } from "../src/lib/engine.js";
import { reservePromoBudget } from "../src/lib/promotions.js";
import { callApi } from "./support/api.js";
import { callAdmin } from "./support/admin.js";
import { db, makeProject, makeUser } from "./support/db.js";

// The Free plan's monthly credits go only to eligible accounts once checks are enforced, and jobs
// paid from them count against a monthly promotional budget. Nothing here calls Clerk or fal.
const clerk = vi.hoisted(() => ({ users: new Map<string, { email: string; verified: boolean }>() }));
vi.mock("@clerk/backend", () => ({
  verifyToken: vi.fn(async (token: string) => ({ sub: token })),
  createClerkClient: vi.fn(() => ({
    users: {
      getUser: vi.fn(async (id: string) => {
        const user = clerk.users.get(id);
        if (!user) throw new Error(`No Clerk user ${id}`);
        const address = { emailAddress: user.email, verification: { status: user.verified ? "verified" : "unverified" } };
        return { primaryEmailAddress: address, emailAddresses: [address] };
      }),
    },
    sessions: { getSessionList: vi.fn(async () => ({ data: [] })), revokeSession: vi.fn(async () => ({})) },
  })),
}));

// fal is never called for real: a stub accepts every job and leaves it queued.
vi.mock("@fal-ai/client", async () => {
  const actual = await vi.importActual<typeof import("@fal-ai/client")>("@fal-ai/client");
  let requests = 0;
  return {
    ...actual,
    createFalClient: () => ({
      storage: { upload: async () => "https://fal.test/input.jpg" },
      queue: {
        submit: async () => ({ request_id: `req-${++requests}` }),
        status: async () => ({ status: "IN_QUEUE" }),
        result: async () => ({ data: {} }),
        cancel: async () => undefined,
      },
    }),
  };
});

const ALLOWANCE = 20;

async function setup(settings: Partial<typeof schema.appSettings.$inferInsert> = {}) {
  await db.insert(schema.billingPlans).values({ slug: "starter", name: "Free", description: "Free plan", monthlyCredits: ALLOWANCE });
  await db.insert(schema.appSettings).values({ id: 1, falMode: "mock", ...settings });
  clerk.users.clear();
}

/** Signs up in Clerk; the account is created on its first /me. */
function signUp(clerkId: string, email: string, verified = true) {
  clerk.users.set(clerkId, { email, verified });
}

async function me(clerkId: string) {
  const response = await callApi(clerkId, "GET", "/me");
  expect(response.status).toBe(200);
  return (await response.json()) as { id: string; creditBalance: number; freeCredits: { status: string; held: boolean } };
}

const grants = async (userId: string) =>
  (await db.select().from(schema.creditLedger).where(and(eq(schema.creditLedger.userId, userId), eq(schema.creditLedger.reason, "plan_grant")))).length;
const assessments = async (userId: string) =>
  db.select().from(schema.freeAllowanceAssessments).where(eq(schema.freeAllowanceAssessments.userId, userId));
const entitlement = async (userId: string) => (await db.select().from(schema.userEntitlements).where(eq(schema.userEntitlements.userId, userId)))[0]!;

/** An account whose next monthly period is due now, with this eligibility status. */
async function dueAccount(overrides: Partial<typeof schema.users.$inferInsert>, status: typeof schema.userEntitlements.$inferInsert["freeAllowanceStatus"]) {
  const user = await makeUser(overrides);
  const start = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  await db.update(schema.userEntitlements)
    .set({ creditPeriodStart: start, nextCreditGrantAt: new Date(Date.now() - 1000), freeAllowanceStatus: status, ...(status === "review_required" ? { freeAllowanceDecidedAt: new Date(), freeAllowanceRuleVersion: 1, freeAllowanceAssessedAt: new Date() } : {}) })
    .where(eq(schema.userEntitlements.userId, user.id));
  await db.update(schema.users).set({ createdAt: start }).where(eq(schema.users.id, user.id));
  return user;
}

async function staff(role: "analyst" | "support" | "billing" | "admin") {
  return makeUser({ clerkId: role, email: `${role}@renvia.test`, role });
}

beforeEach(() => clerk.users.clear());

describe("the rules", () => {
  it("normalizes one mailbox however it's written", () => {
    expect(normalizeEmail(" A.Rch.Itect+free@Gmail.com ")).toBe("architect@gmail.com");
    expect(normalizeEmail("architect@googlemail.com")).toBe("architect@gmail.com");
    expect(normalizeEmail("jane.doe+promo@studio.co.ke")).toBe("jane.doe@studio.co.ke");
  });

  it("approves a clean account and holds risky ones, never denying on its own", () => {
    const clean = { emailVerified: true, emailDomain: "studio.co.ke", disposableDomain: false, sameMailboxAccounts: 0, approvalsToday: 0, dailyApprovalLimit: 100, sameBrowserAccounts: 0, networkSignups24h: 0, signupSpike: false };
    expect(decideFreeAllowance(clean).outcome).toBe("approved");
    expect(decideFreeAllowance({ ...clean, sameMailboxAccounts: 1 })).toMatchObject({ outcome: "review_required", score: 60 });
    expect(decideFreeAllowance({ ...clean, disposableDomain: true })).toMatchObject({ outcome: "verification_required", score: 40 });
    expect(decideFreeAllowance({ ...clean, emailVerified: false }).outcome).toBe("verification_required");
    expect(decideFreeAllowance({ ...clean, emailVerified: null }).outcome).toBe("approved");
    expect(decideFreeAllowance({ ...clean, approvalsToday: 100 }).outcome).toBe("verification_required");
    expect(decideFreeAllowance({ ...clean, sameMailboxAccounts: 3, disposableDomain: true, emailVerified: false }).outcome).toBe("review_required");
  });
});

describe("granting the Free allowance", () => {
  it("grants as before while checks are off, without assessing anyone", async () => {
    await setup();
    signUp("first", "architect@gmail.com");
    const account = await me("first");

    expect(account.creditBalance).toBe(ALLOWANCE);
    expect(account.freeCredits).toMatchObject({ status: "pending", held: false });
    expect(await assessments(account.id)).toHaveLength(0);
  });

  it("in observe mode records what it would hold but still grants", async () => {
    await setup({ freeAllowanceMode: "observe" });
    signUp("first", "architect@gmail.com");
    await me("first");
    signUp("second", "Archi.tect+again@gmail.com");
    const second = await me("second");

    expect(second.creditBalance).toBe(ALLOWANCE);
    const [assessment] = await assessments(second.id);
    expect(assessment).toMatchObject({ kind: "signup", outcome: "review_required", mode: "observe", score: 60 });
    expect(assessment!.signals).toMatchObject({ sameMailboxAccounts: 1, emailDomain: "gmail.com" });
    expect(second.freeCredits.held).toBe(false);
  });

  it("when enforced, grants a clean account once and withholds a repeat mailbox", async () => {
    await setup({ freeAllowanceMode: "enforce" });
    signUp("first", "architect@gmail.com");
    const first = await me("first");
    expect(first.creditBalance).toBe(ALLOWANCE);
    expect((await entitlement(first.id)).freeAllowanceStatus).toBe("approved");

    signUp("second", "architect+2@gmail.com");
    const second = await me("second");
    expect(second.creditBalance).toBe(0);
    expect(second.freeCredits).toMatchObject({ status: "review_required", held: true });
    expect(await grants(second.id)).toBe(0);

    // Later requests don't grant it either, or assess it again within the period.
    await me("second");
    await callApi("second", "GET", "/me/credits");
    expect(await grants(second.id)).toBe(0);
    expect(await assessments(second.id)).toHaveLength(1);
  });

  it("grants exactly once when an approved account's first requests arrive together", async () => {
    await setup({ freeAllowanceMode: "enforce" });
    signUp("racer", "racer@studio.co.ke");
    await Promise.all(Array.from({ length: 5 }, () => callApi("racer", "GET", "/me")));
    const [user] = await db.select().from(schema.users).where(eq(schema.users.clerkId, "racer"));

    expect(await grants(user!.id)).toBe(1);
    expect(user!.creditBalance).toBe(ALLOWANCE);
  });

  it("releases a hold the moment Clerk reports the email verified", async () => {
    await setup({ freeAllowanceMode: "enforce" });
    signUp("late", "late@studio.co.ke", false);
    const before = await me("late");
    expect(before).toMatchObject({ creditBalance: 0, freeCredits: { status: "verification_required", held: true } });

    signUp("late", "late@studio.co.ke", true);
    const after = await me("late");
    expect(after).toMatchObject({ creditBalance: ALLOWANCE, freeCredits: { status: "approved", held: false } });
    expect((await assessments(after.id)).map((row) => row.kind).sort()).toEqual(["evidence", "signup"]);
  });

  it("holds new accounts past the day's automatic approvals", async () => {
    await setup({ freeAllowanceMode: "enforce", freeAllowanceDailyApprovals: 1 });
    signUp("one", "one@studio.co.ke");
    signUp("two", "two@studio.co.ke");
    expect((await me("one")).creditBalance).toBe(ALLOWANCE);
    expect((await me("two")).freeCredits.status).toBe("verification_required");
  });

  it("starts no Free period while paused", async () => {
    await setup({ freeAllowanceMode: "paused" });
    signUp("paused", "clean@studio.co.ke");
    expect(await me("paused")).toMatchObject({ creditBalance: 0, freeCredits: { held: true } });
  });

  it("leaves paid, purchased and admin-granted credit untouched by a hold", async () => {
    await setup({ freeAllowanceMode: "enforce" });
    signUp("first", "architect@gmail.com");
    await me("first");
    signUp("second", "architect+2@gmail.com");
    const second = await me("second");
    await staff("admin");

    const granted = await callAdmin("admin", "POST", `/users/${second.id}/credits`, { amount: 15, note: "Goodwill" });
    expect(granted.status).toBe(200);
    expect((await me("second")).creditBalance).toBe(15);

    // An admin-granted plan isn't the Free allowance: its monthly credits aren't held.
    const [pro] = await db.insert(schema.billingPlans).values({ slug: "studio", name: "Pro", description: "Pro", priceCents: 2900, interval: "month", monthlyCredits: 300 }).returning();
    await db.update(schema.userEntitlements).set({ overridePlanId: pro!.id, overrideSetAt: new Date() }).where(eq(schema.userEntitlements.userId, second.id));
    expect((await me("second")).creditBalance).toBe(315);
  });

  it("keeps accounts from before the checks approved, without reassessing them", async () => {
    await setup({ freeAllowanceMode: "enforce" });
    // An existing account: approved by migration 0041, never assessed, its next period now due.
    // Its throwaway domain would hold a new account, so a reassessment would show.
    const old = await dueAccount({ clerkId: "old", email: "old@mailinator.com", creditBalance: 0 }, "approved");
    signUp("old", "old@mailinator.com");

    expect((await me("old")).creditBalance).toBe(ALLOWANCE);
    expect(await assessments(old.id)).toHaveLength(0);
  });

  it("leaves held Free accounts out of the daily renewal batch", async () => {
    await setup({ freeAllowanceMode: "enforce" });
    const held = await dueAccount({ email: "held@studio.co.ke" }, "review_required");
    const due = await dueAccount({ email: "due@studio.co.ke", emailVerified: true }, "pending");

    expect(await renewDueCreditPeriods(db, new Date(), 1)).toEqual({ renewed: 1 });
    expect(await grants(due.id)).toBe(1);
    expect(await grants(held.id)).toBe(0);
  });
});

describe("operator decisions", () => {
  async function heldAccount() {
    await setup({ freeAllowanceMode: "enforce" });
    signUp("first", "architect@gmail.com");
    await me("first");
    signUp("second", "architect+2@gmail.com");
    return me("second");
  }

  it("lets support approve, granting the period straight away and auditing it", async () => {
    const held = await heldAccount();
    await staff("support");

    const response = await callAdmin("support", "POST", `/users/${held.id}/free-allowance`, { decision: "approve", reason: "Same person, new studio email confirmed by phone" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "approved", granted: true, held: false });
    expect((await me("second")).creditBalance).toBe(ALLOWANCE);
    expect(await grants(held.id)).toBe(1);

    const [event] = await db.select().from(schema.adminEvents).where(eq(schema.adminEvents.action, "security.decision"));
    expect(event).toMatchObject({ targetId: held.id });
    const operator = (await assessments(held.id)).find((row) => row.kind === "operator");
    expect(operator).toMatchObject({ outcome: "approved", reason: "Same person, new studio email confirmed by phone" });

    // Approving again grants nothing more.
    await callAdmin("support", "POST", `/users/${held.id}/free-allowance`, { decision: "approve", reason: "Again" });
    expect(await grants(held.id)).toBe(1);
  });

  it("keeps denial with admins, and never takes back what was granted", async () => {
    await setup({ freeAllowanceMode: "enforce" });
    signUp("clean", "clean@studio.co.ke");
    const clean = await me("clean");
    await staff("support");
    await staff("admin");

    expect((await callAdmin("support", "POST", `/users/${clean.id}/free-allowance`, { decision: "deny", reason: "Farm" })).status).toBe(403);
    const denied = await callAdmin("admin", "POST", `/users/${clean.id}/free-allowance`, { decision: "deny", reason: "Confirmed farm" });
    expect(denied.status).toBe(200);
    expect(await me("clean")).toMatchObject({ creditBalance: ALLOWANCE, freeCredits: { status: "denied", held: true } });
    // Support can't lift it either.
    expect((await callAdmin("support", "POST", `/users/${clean.id}/free-allowance`, { decision: "approve", reason: "Appeal" })).status).toBe(403);
  });

  it("shows the evidence to analysts but lets them change nothing", async () => {
    const held = await heldAccount();
    await staff("analyst");

    const view = await callAdmin("analyst", "GET", `/users/${held.id}/free-allowance`);
    expect(view.status).toBe(200);
    expect(await view.json()).toMatchObject({ status: "review_required", mode: "enforce", freePlan: true, held: true, assessments: [{ kind: "signup", outcome: "review_required" }] });
    expect((await callAdmin("analyst", "POST", `/users/${held.id}/free-allowance`, { decision: "approve", reason: "No" })).status).toBe(403);
    expect((await callApi("second", "GET", `/admin/users/${held.id}/free-allowance`)).status).toBe(403);
  });

  it("has the rules look again on request", async () => {
    const held = await heldAccount();
    await staff("support");
    // The other account changes its email, so the mailbox is no longer shared.
    await db.update(schema.users).set({ emailNormalized: "someone-else@gmail.com" }).where(eq(schema.users.clerkId, "first"));

    const response = await callAdmin("support", "POST", `/users/${held.id}/free-allowance`, { decision: "reassess", reason: "Other account changed email" });
    expect(await response.json()).toMatchObject({ status: "approved", granted: true });
  });
});

describe("the promotional budget", () => {
  async function freeUser(clerkId: string, credits: number) {
    const user = await makeUser({ clerkId, email: `${clerkId}@studio.co.ke`, creditBalance: credits, planCredits: credits });
    return { user, project: await makeProject(user.id) };
  }

  function render(clerkId: string, projectId: string) {
    return callApi(clerkId, "POST", "/renders", {
      projectId, sourceImageUrl: "https://example.test/source.jpg", prompt: "", aspectRatio: "auto", style: "Photorealistic",
      generationSettings: { sourceType: "photo" },
    });
  }

  it("caps jobs paid from Free credits, and only those", async () => {
    // dev mode prices a render at $0.003; a $0.01 budget fits three.
    await setup({ falMode: "dev", falBudgetUsd: "10", promoBudgetUsd: "0.01" });
    await db.update(schema.billingPlans).set({ concurrentRenderLimit: 10 }).where(eq(schema.billingPlans.slug, "starter"));
    const { project } = await freeUser("free", 5);

    for (let index = 0; index < 3; index += 1) expect((await render("free", project.id)).status).toBe(201);
    expect((await db.select().from(schema.renders)).map((job) => job.fundingPool)).toEqual(["promo", "promo", "promo"]);

    const fourth = await render("free", project.id);
    expect(fourth.status).toBe(402);
    expect(await fourth.json()).toMatchObject({ code: "promo_budget_exhausted" });
    const [incident] = await db.select().from(schema.incidents).where(eq(schema.incidents.fingerprint, `promo-budget:${new Date().toISOString().slice(0, 7)}:100`));
    expect(incident).toBeDefined();

    // Bought credits (not plan credits) are account-funded and keep working.
    const buyer = await makeUser({ clerkId: "buyer", email: "buyer@studio.co.ke", creditBalance: 5, planCredits: 0 });
    const paid = await render("buyer", (await makeProject(buyer.id)).id);
    expect(paid.status).toBe(201);
    expect((await db.select().from(schema.renders).where(eq(schema.renders.fundingPool, "account")))).toHaveLength(1);
  });

  it("doesn't count promotional holds twice against the global budget", async () => {
    await setup();
    expect(await reservePromoBudget(db, 4_000_000, 5_000_000)).not.toBeNull();
    expect(await reserveBudget(db, 10_000_000, 10)).not.toBeNull();
  });
});
