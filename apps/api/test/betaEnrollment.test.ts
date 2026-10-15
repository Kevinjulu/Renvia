import { eq } from "drizzle-orm";
import { schema } from "@renvia/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminBetaInvitationCreated, AdminBetaProgram, AdminBetaProgramDetailResponse, BetaInvitationAccepted, BetaInvitationPreview } from "@renvia/types";
import { adminEnv, callAdmin, DAY } from "./support/admin.js";
import { callApi } from "./support/api.js";
import { bucketsOf, db, makeBetaProgram, makeUser, putOnPlan } from "./support/db.js";

// Beta enrollment: invitations that never promise more places than the program has, redemption
// that is safe under races and never creates or alters accounts, the tester lifecycle, and the
// audited, approval-gated credit grants and budget changes.
const clerk = vi.hoisted(() => ({ createInvitation: vi.fn() }));
vi.mock("@clerk/backend", async () => {
  const stub = (await import("./support/clerkStub.js")).clerkStub();
  return {
    ...stub,
    createClerkClient: () => ({
      users: { getUser: async (id: string) => ({ primaryEmailAddress: { emailAddress: `${id}@example.test` }, emailAddresses: [] }) },
      invitations: { createInvitation: clerk.createInvitation },
    }),
  };
});

const STUDIO = "https://studio.renvia.test";
const studioEnv = { ...adminEnv, STUDIO_URL: STUDIO };

beforeEach(async () => {
  clerk.createInvitation.mockReset().mockResolvedValue({ id: "inv_1" });
  await db.insert(schema.billingPlans).values({ slug: "starter", name: "Starter", description: "Free" });
  // Approvals only where a test turns them on.
  await db.insert(schema.governanceSettings).values({ id: 1, bulkCreditApprovalThreshold: 0, roleChangeApprovalThreshold: 0, refundApprovalThresholdCents: 0, maintenanceApprovalThreshold: 0, studioChangeApprovalThreshold: 0 });
  await makeUser({ clerkId: "admin", email: "admin@renvia.test", role: "admin" });
  await makeUser({ clerkId: "admin2", email: "admin2@renvia.test", role: "admin" });
  await makeUser({ clerkId: "support", email: "support@renvia.test", role: "support" });
  await makeUser({ clerkId: "billing", email: "billing@renvia.test", role: "billing" });
  await makeUser({ clerkId: "analyst", email: "analyst@renvia.test", role: "analyst" });
});

async function invite(programId: string, body: Record<string, unknown>, as = "admin", env = adminEnv) {
  return callAdmin(as, "POST", `/beta/programs/${programId}/invitations`, body, env);
}
async function inviteLink(programId: string, maxRedemptions = 1) {
  const res = await invite(programId, { kind: "link", maxRedemptions });
  expect(res.status).toBe(201);
  return (await res.json()) as AdminBetaInvitationCreated;
}
const accept = (clerkId: string, token: string) => callApi(clerkId, "POST", "/beta/invitations/accept", { token });
const detail = async (id: string) => (await (await callAdmin("admin", "GET", `/beta/programs/${id}`)).json()) as AdminBetaProgramDetailResponse;
const code = async (res: Response) => ((await res.json()) as { code?: string }).code;
const key = () => crypto.randomUUID();

describe("programs", () => {
  it("are created as drafts with the authorized defaults, and audited", async () => {
    const res = await callAdmin("admin", "POST", "/beta/programs", { slug: "private-beta", name: "Private beta", reason: "first cohort" });

    expect(res.status).toBe(201);
    const program = (await res.json()) as AdminBetaProgram;
    expect(program).toMatchObject({ status: "draft", maxTesters: 10, creditsPerTester: 25, budgetUsd: 10, budgetWarningPercent: 80, downloadsUnlocked: true, capacity: { free: 10 } });
    expect(new Date(program.endsAt).getTime() - new Date(program.startsAt).getTime()).toBe(21 * DAY);
    const [event] = await db.select().from(schema.adminEvents).where(eq(schema.adminEvents.targetId, program.id));
    expect(event).toMatchObject({ action: "beta.update", targetType: "beta_program" });
  });

  it("can't be created with more than the $10 initially authorized, or outside 14–21 days", async () => {
    expect((await callAdmin("admin", "POST", "/beta/programs", { slug: "big", name: "Big", budgetUsd: 20, reason: "x" })).status).toBe(400);
    expect((await callAdmin("admin", "POST", "/beta/programs", { slug: "long", name: "Long", durationDays: 30, reason: "x" })).status).toBe(400);
    expect((await callAdmin("admin", "POST", "/beta/programs", { slug: "short", name: "Short", durationDays: 14, reason: "x" })).status).toBe(201);
  });

  it("are created for chosen dates, 14 to 21 days long", async () => {
    const start = new Date(Date.now() + 2 * DAY);
    const create = (slug: string, days: number) =>
      callAdmin("admin", "POST", "/beta/programs", { slug, name: slug, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + days * DAY - 1000).toISOString(), reason: "x" });

    const ok = await create("dated", 14);
    expect(ok.status).toBe(201);
    expect((await ok.json()) as AdminBetaProgram).toMatchObject({ startsAt: start.toISOString() });
    expect((await create("too-long", 30)).status).toBe(400);
    expect((await create("too-short", 7)).status).toBe(400);
  });

  it("can be rescheduled before they start, but only extended once running", async () => {
    const draft = await makeBetaProgram({ status: "draft", startsAt: new Date(Date.now() + 5 * DAY), endsAt: new Date(Date.now() + 25 * DAY) });
    const later = new Date(Date.now() + 7 * DAY).toISOString();
    expect((await callAdmin("admin", "PATCH", `/beta/programs/${draft.id}`, { startsAt: later, reason: "moved" })).status).toBe(200);
    expect((await callAdmin("admin", "PATCH", `/beta/programs/${draft.id}`, { endsAt: new Date(Date.now() + 6 * DAY).toISOString(), reason: "bad" })).status).toBe(400);

    const running = await makeBetaProgram();
    const moved = await callAdmin("admin", "PATCH", `/beta/programs/${running.id}`, { startsAt: new Date().toISOString(), reason: "x" });
    expect(moved.status).toBe(409);
    expect(((await moved.json()) as { code: string }).code).toBe("already_started");
    expect((await callAdmin("admin", "PATCH", `/beta/programs/${running.id}`, { endsAt: new Date(running.endsAt.getTime() + 3 * DAY).toISOString(), reason: "more time" })).status).toBe(200);
  });

  it("are managed by admins only, and readable by every operator", async () => {
    const program = await makeBetaProgram();
    for (const role of ["support", "billing", "analyst"]) {
      expect((await callAdmin(role, "POST", "/beta/programs", { slug: `p-${role}`, name: "P", reason: "x" })).status).toBe(403);
      expect((await callAdmin(role, "GET", `/beta/programs/${program.id}`)).status).toBe(200);
    }
    expect((await callAdmin("analyst", "POST", `/beta/programs/${program.id}/invitations`, { kind: "link" })).status).toBe(403);
  });

  it("extend for everyone without touching credits or the budget", async () => {
    const program = await makeBetaProgram();
    const later = new Date(program.endsAt.getTime() + 7 * DAY);

    const res = await callAdmin("admin", "PATCH", `/beta/programs/${program.id}`, { endsAt: later.toISOString(), reason: "more time" });

    expect(res.status).toBe(200);
    expect((await res.json()) as AdminBetaProgram).toMatchObject({ endsAt: later.toISOString(), budgetUsd: 10, creditsPerTester: 25 });
  });

  it("raise the budget directly below the approval threshold, through a second admin above it, and never the global cap", async () => {
    await db.insert(schema.appSettings).values({ id: 1, falBudgetUsd: "50" });
    const program = await makeBetaProgram();

    const small = await callAdmin("admin", "POST", `/beta/programs/${program.id}/budget`, { budgetUsd: 15, reason: "good feedback" });
    expect(small.status).toBe(200);
    expect(((await small.json()) as AdminBetaProgram).budgetUsd).toBe(15);

    await db.update(schema.governanceSettings).set({ refundApprovalThresholdCents: 500 });
    const large = await callAdmin("admin", "POST", `/beta/programs/${program.id}/budget`, { budgetUsd: 20, reason: "second week" });
    expect(large.status).toBe(202);
    const { approvalId } = (await large.json()) as { approvalId: string };
    expect((await callAdmin("admin", "POST", `/approvals/${approvalId}/approve`, {})).status).toBe(403);
    expect((await callAdmin("admin2", "POST", `/approvals/${approvalId}/approve`, {})).status).toBe(200);
    expect((await callAdmin("admin", "POST", `/approvals/${approvalId}/execute`, {})).status).toBe(200);

    const [after] = await db.select().from(schema.betaPrograms).where(eq(schema.betaPrograms.id, program.id));
    expect(Number(after!.budgetUsd)).toBe(20);
    const [settings] = await db.select().from(schema.appSettings);
    expect(settings!.falBudgetUsd).toBe("50.00");
  });

  it("complete every tester and expire their beta credits when ended", async () => {
    const program = await makeBetaProgram();
    const { token } = await inviteLink(program.id, 2);
    const tester = await makeUser({ clerkId: "tester", email: "tester@example.test", creditBalance: 5 });
    expect((await accept("tester", token)).status).toBe(201);

    const res = await callAdmin("admin", "POST", `/beta/programs/${program.id}/status`, { status: "ended", reason: "done" });

    expect(res.status).toBe(200);
    expect(await bucketsOf(tester.id)).toEqual({ balance: 5, plan: 0, beta: 0 });
    expect((await detail(program.id)).enrollments[0]).toMatchObject({ status: "completed", endedReason: "program_ended" });
  });
});

describe("capacity", () => {
  it("never promises more than ten places, counting pending invitations", async () => {
    const program = await makeBetaProgram({ maxTesters: 10 });

    await inviteLink(program.id, 6);
    for (let i = 0; i < 4; i++) expect((await invite(program.id, { kind: "email", email: `person${i}@example.test`, sendEmail: false })).status).toBe(201);
    const eleventh = await invite(program.id, { kind: "email", email: "one-too-many@example.test", sendEmail: false });

    expect(eleventh.status).toBe(409);
    expect(await code(eleventh)).toBe("program_full");
    expect((await detail(program.id)).program.capacity).toMatchObject({ active: 0, pendingSlots: 10, free: 0 });
  });

  it("frees a place when an invitation is revoked or expires", async () => {
    const program = await makeBetaProgram({ maxTesters: 2 });
    const first = await inviteLink(program.id);
    const second = await inviteLink(program.id);
    expect((await invite(program.id, { kind: "link" })).status).toBe(409);

    expect((await callAdmin("admin", "POST", `/beta/invitations/${first.invitation.id}/revoke`, { reason: "wrong person" })).status).toBe(200);
    await db.update(schema.betaInvitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.betaInvitations.id, second.invitation.id));

    expect((await detail(program.id)).program.capacity.free).toBe(2);
    expect((await invite(program.id, { kind: "link", maxRedemptions: 2 })).status).toBe(201);
  });

  it("keeps a suspended tester's place, and frees a completed one's", async () => {
    const program = await makeBetaProgram({ maxTesters: 1 });
    const { token } = await inviteLink(program.id);
    await makeUser({ clerkId: "tester", email: "tester@example.test" });
    await accept("tester", token);
    const [enrollment] = (await detail(program.id)).enrollments;

    await callAdmin("admin", "POST", `/beta/enrollments/${enrollment!.id}/status`, { status: "suspended", reason: "pause" });
    expect((await invite(program.id, { kind: "link" })).status).toBe(409);

    await callAdmin("admin", "POST", `/beta/enrollments/${enrollment!.id}/status`, { status: "completed", reason: "done" });
    expect((await invite(program.id, { kind: "link" })).status).toBe(201);
  });

  it("admits exactly as many people as a shared link has places, however many accept at once", async () => {
    const program = await makeBetaProgram();
    const { token } = await inviteLink(program.id, 3);
    await Promise.all(Array.from({ length: 6 }, (_, i) => makeUser({ clerkId: `racer${i}`, email: `racer${i}@example.test` })));

    const responses = await Promise.all(Array.from({ length: 6 }, (_, i) => accept(`racer${i}`, token)));

    expect(responses.filter((res) => res.status === 201)).toHaveLength(3);
    const { program: after, enrollments } = await detail(program.id);
    expect(enrollments).toHaveLength(3);
    expect(after.capacity).toMatchObject({ active: 3, pendingSlots: 0 });
  });

  it("never seats an eleventh tester when invitations race for the last places", async () => {
    const program = await makeBetaProgram({ maxTesters: 10 });
    const links = await Promise.all(Array.from({ length: 10 }, () => inviteLink(program.id)));
    // An operator lowers the cap while invitations are out: the open ones still hold their places,
    // but no redemption may take the program past what is now allowed.
    await db.update(schema.betaPrograms).set({ maxTesters: 8 }).where(eq(schema.betaPrograms.id, program.id));
    await Promise.all(Array.from({ length: 10 }, (_, i) => makeUser({ clerkId: `t${i}`, email: `t${i}@example.test` })));

    await Promise.all(links.map(({ token }, i) => accept(`t${i}`, token)));

    const live = (await detail(program.id)).enrollments.filter((enrollment) => enrollment.status === "active");
    expect(live.length).toBeLessThanOrEqual(8);
  });
});

describe("accepting an invitation", () => {
  it("enrolls the signed-in account and grants 25 beta credits, once", async () => {
    const program = await makeBetaProgram();
    const { token } = await inviteLink(program.id);
    const tester = await makeUser({ clerkId: "tester", email: "tester@example.test", creditBalance: 7 });

    const first = await accept("tester", token);
    const again = await accept("tester", token);

    expect(first.status).toBe(201);
    expect((await first.json()) as BetaInvitationAccepted).toMatchObject({ programId: program.id, creditsGranted: 25, alreadyEnrolled: false });
    expect(again.status).toBe(200);
    expect(((await again.json()) as BetaInvitationAccepted).alreadyEnrolled).toBe(true);
    expect(await bucketsOf(tester.id)).toEqual({ balance: 32, plan: 0, beta: 25 });
    expect(await db.select().from(schema.users).where(eq(schema.users.email, "tester@example.test"))).toHaveLength(1);
  });

  it("leaves an existing customer's role, plan and own credits as they were", async () => {
    const program = await makeBetaProgram();
    const customer = await makeUser({ clerkId: "customer", email: "customer@example.test", creditBalance: 40, planCredits: 15 });
    await putOnPlan(customer.id, "studio");
    const res = await invite(program.id, { kind: "existing_user", userId: customer.id });
    const { token } = (await res.json()) as AdminBetaInvitationCreated;

    await accept("customer", token);
    const [enrollment] = (await detail(program.id)).enrollments;
    await callAdmin("admin", "POST", `/beta/enrollments/${enrollment!.id}/status`, { status: "completed", reason: "done" });

    const [after] = await db.select().from(schema.users).where(eq(schema.users.id, customer.id));
    expect(after).toMatchObject({ role: "user", creditBalance: 40, planCredits: 15, betaCredits: 0 });
    const [entitlement] = await db.select({ slug: schema.billingPlans.slug }).from(schema.userEntitlements).innerJoin(schema.billingPlans, eq(schema.billingPlans.id, schema.userEntitlements.planId)).where(eq(schema.userEntitlements.userId, customer.id));
    expect(entitlement!.slug).toBe("studio");
  });

  it("is refused for the wrong account, showing only a masked address", async () => {
    const program = await makeBetaProgram();
    const res = await invite(program.id, { kind: "email", email: "alice@example.test", sendEmail: false });
    const { token } = (await res.json()) as AdminBetaInvitationCreated;
    await makeUser({ clerkId: "mallory", email: "mallory@example.test" });

    const wrong = await accept("mallory", token);

    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ code: "invite_wrong_account", invitedEmail: "a•••@example.test" });
    expect((await detail(program.id)).enrollments).toHaveLength(0);
  });

  it("is refused when the invitation has expired, been revoked or used, or the program is closed", async () => {
    const program = await makeBetaProgram();
    await Promise.all(["a", "b", "c", "d", "e"].map((id) => makeUser({ clerkId: id, email: `${id}@example.test` })));
    const expired = await inviteLink(program.id);
    await db.update(schema.betaInvitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.betaInvitations.id, expired.invitation.id));
    const revoked = await inviteLink(program.id);
    await callAdmin("admin", "POST", `/beta/invitations/${revoked.invitation.id}/revoke`, { reason: "x" });
    const used = await inviteLink(program.id);
    await accept("a", used.token);

    expect(await code(await accept("b", expired.token))).toBe("invite_expired");
    expect(await code(await accept("b", revoked.token))).toBe("invite_revoked");
    expect(await code(await accept("b", used.token))).toBe("invite_used");
    expect(await code(await accept("b", "x".repeat(43)))).toBe("invite_not_found");

    const pausedLink = await inviteLink(program.id);
    await db.update(schema.betaPrograms).set({ status: "paused" }).where(eq(schema.betaPrograms.id, program.id));
    expect(await code(await accept("c", pausedLink.token))).toBe("program_closed");
  });

  it("is refused while the account is in another program", async () => {
    const first = await makeBetaProgram();
    const second = await makeBetaProgram();
    await makeUser({ clerkId: "tester", email: "tester@example.test" });
    await accept("tester", (await inviteLink(first.id)).token);

    expect(await code(await accept("tester", (await inviteLink(second.id)).token))).toBe("already_in_program");
  });

  it("is previewed before sign-in with the program and the state of the link", async () => {
    const program = await makeBetaProgram({ name: "Renvia Private Beta", creditsPerTester: 25 });
    const created = (await (await invite(program.id, { kind: "email", email: "alice@example.test", sendEmail: false })).json()) as AdminBetaInvitationCreated;

    const res = await callApi(null, "GET", `/beta/invitations/preview?t=${encodeURIComponent(created.token)}`);

    expect(res.status).toBe(200);
    expect((await res.json()) as BetaInvitationPreview).toMatchObject({ programName: "Renvia Private Beta", state: "pending", invitedEmail: "a•••@example.test", credits: 25 });
  });

  it("can be accepted in the Studio without a link when addressed to the account", async () => {
    const program = await makeBetaProgram();
    const customer = await makeUser({ clerkId: "customer", email: "customer@example.test" });
    await invite(program.id, { kind: "existing_user", userId: customer.id });

    const listed = (await (await callApi("customer", "GET", "/beta/invitations")).json()) as { invitations: { id: string }[] };
    expect(listed.invitations).toHaveLength(1);
    expect((await callApi("customer", "POST", `/beta/invitations/${listed.invitations[0]!.id}/accept`)).status).toBe(201);
    expect((await bucketsOf(customer.id)).beta).toBe(25);
    // Someone else can't use it by id.
    await makeUser({ clerkId: "other", email: "other@example.test" });
    expect((await callApi("other", "POST", `/beta/invitations/${listed.invitations[0]!.id}/accept`)).status).toBe(404);
  });
});

describe("email invitations", () => {
  it("send a Clerk invitation to a new address, linking back to the join page", async () => {
    const program = await makeBetaProgram();

    const res = await invite(program.id, { kind: "email", email: "New.Person@example.test" }, "admin", studioEnv);

    expect(res.status).toBe(201);
    const created = (await res.json()) as AdminBetaInvitationCreated;
    expect(created).toMatchObject({ emailSent: true, invitation: { kind: "email", email: "new.person@example.test" } });
    expect(created.joinUrl).toBe(`${STUDIO}/beta/join?t=${encodeURIComponent(created.token)}`);
    expect(clerk.createInvitation).toHaveBeenCalledWith(expect.objectContaining({ emailAddress: "new.person@example.test", redirectUrl: created.joinUrl }));
  });

  it("invite an address that already has an account to that account instead, sending no Clerk invitation", async () => {
    const program = await makeBetaProgram();
    const customer = await makeUser({ clerkId: "customer", email: "customer@example.test" });

    const res = await invite(program.id, { kind: "email", email: "Customer@Example.test" }, "admin", studioEnv);

    const created = (await res.json()) as AdminBetaInvitationCreated;
    expect(created.invitation).toMatchObject({ kind: "existing_user", userId: customer.id });
    expect(created.emailSent).toBe(false);
    expect(clerk.createInvitation).not.toHaveBeenCalled();
  });

  it("still work as a link when Clerk can't send, or no Studio address is configured", async () => {
    const program = await makeBetaProgram();
    clerk.createInvitation.mockRejectedValue(new Error("form_identifier_exists"));

    const failed = (await (await invite(program.id, { kind: "email", email: "a@example.test" }, "admin", studioEnv)).json()) as AdminBetaInvitationCreated;
    const unconfigured = (await (await invite(program.id, { kind: "email", email: "b@example.test" })).json()) as AdminBetaInvitationCreated;

    expect(failed).toMatchObject({ emailSent: false, joinUrl: expect.stringContaining("/beta/join?t=") });
    expect(unconfigured).toMatchObject({ emailSent: false, joinUrl: null, joinPath: expect.stringMatching(/^\/beta\/join\?t=/) });
  });

  it("refuse a second open invitation for the same person, and stop a bulk send at capacity", async () => {
    const program = await makeBetaProgram({ maxTesters: 3 });
    expect((await invite(program.id, { kind: "email", email: "dup@example.test", sendEmail: false })).status).toBe(201);
    expect(await code(await invite(program.id, { kind: "email", email: "dup@example.test", sendEmail: false }))).toBe("already_invited");

    const res = await callAdmin("admin", "POST", `/beta/programs/${program.id}/invitations/bulk`, { emails: ["x@example.test", "y@example.test", "z@example.test"], sendEmail: false });
    const { results } = (await res.json()) as { results: { email: string; ok: boolean; code?: string }[] };

    expect(results.map((result) => result.ok)).toEqual([true, true, false]);
    expect(results[2]!.code).toBe("program_full");
  });

  it("only offer more than the welcome credits to staff who may grant credits", async () => {
    const program = await makeBetaProgram();
    expect((await invite(program.id, { kind: "link", creditsOverride: 40 }, "support")).status).toBe(403);
    expect((await invite(program.id, { kind: "link", creditsOverride: 10 }, "support")).status).toBe(201);
    expect((await invite(program.id, { kind: "link", creditsOverride: 40 })).status).toBe(201);
  });
});

describe("the tester lifecycle", () => {
  async function enrolled() {
    const program = await makeBetaProgram();
    const tester = await makeUser({ clerkId: "tester", email: "tester@example.test", creditBalance: 3 });
    await accept("tester", (await inviteLink(program.id)).token);
    const [enrollment] = (await detail(program.id)).enrollments;
    return { program, tester, enrollmentId: enrollment!.id };
  }
  const setStatus = (id: string, status: string, as = "admin") => callAdmin(as, "POST", `/beta/enrollments/${id}/status`, { status, reason: "test" });

  it("suspends with credits frozen, reactivates, and revokes with credits expired", async () => {
    const { tester, enrollmentId } = await enrolled();

    expect((await setStatus(enrollmentId, "suspended", "support")).status).toBe(200);
    expect((await bucketsOf(tester.id)).beta).toBe(25);
    expect((await setStatus(enrollmentId, "active", "support")).status).toBe(200);
    expect((await setStatus(enrollmentId, "revoked", "support")).status).toBe(200);

    expect(await bucketsOf(tester.id)).toEqual({ balance: 3, plan: 0, beta: 0 });
    expect((await setStatus(enrollmentId, "active")).status).toBe(409);
    const ledger = await db.select().from(schema.creditLedger).where(eq(schema.creditLedger.userId, tester.id));
    expect(ledger.map((row) => row.reason).sort()).toEqual(["beta_expiry", "beta_grant"]);
  });

  it("extends one tester past the program's end without granting credits", async () => {
    const { program, tester, enrollmentId } = await enrolled();
    const later = new Date(program.endsAt.getTime() + 5 * DAY);

    const res = await callAdmin("admin", "POST", `/beta/enrollments/${enrollmentId}/extend`, { endsAt: later.toISOString(), reason: "finishing a mission" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ endsAt: later.toISOString(), endsAtOverride: later.toISOString() });
    expect((await bucketsOf(tester.id)).beta).toBe(25);
  });

  it("tops up one tester or several, idempotently, within the per-tester ceiling", async () => {
    const { program, tester, enrollmentId } = await enrolled();
    const grant = { amount: 10, note: "extra missions", idempotencyKey: key() };

    expect((await callAdmin("support", "POST", `/beta/enrollments/${enrollmentId}/grant`, grant)).status).toBe(403);
    expect((await callAdmin("billing", "POST", `/beta/enrollments/${enrollmentId}/grant`, grant)).status).toBe(200);
    await callAdmin("billing", "POST", `/beta/enrollments/${enrollmentId}/grant`, grant);
    expect((await bucketsOf(tester.id)).beta).toBe(35);

    const bulk = await callAdmin("admin", "POST", `/beta/programs/${program.id}/grant`, { enrollmentIds: [enrollmentId], amount: 100, note: "too much", idempotencyKey: key() });
    expect(await bulk.json()).toMatchObject({ results: [{ status: "refused", reason: "tester_limit" }] });
  });

  it("holds a large grant for a second admin, then grants it once", async () => {
    const { tester, enrollmentId } = await enrolled();
    await db.update(schema.governanceSettings).set({ bulkCreditApprovalThreshold: 20 });

    const res = await callAdmin("admin", "POST", `/beta/enrollments/${enrollmentId}/grant`, { amount: 25, note: "second round", idempotencyKey: key() });
    expect(res.status).toBe(202);
    const { approvalId } = (await res.json()) as { approvalId: string };
    expect((await bucketsOf(tester.id)).beta).toBe(25);

    await callAdmin("admin2", "POST", `/approvals/${approvalId}/approve`, {});
    expect((await callAdmin("admin", "POST", `/approvals/${approvalId}/execute`, {})).status).toBe(200);
    expect((await callAdmin("admin", "POST", `/approvals/${approvalId}/execute`, {})).status).toBe(409);
    expect((await bucketsOf(tester.id)).beta).toBe(50);
  });

  it("records every change in the audit trail", async () => {
    const { enrollmentId } = await enrolled();
    await setStatus(enrollmentId, "suspended");

    const events = await db.select().from(schema.adminEvents).where(eq(schema.adminEvents.action, "beta.update"));
    expect(events.map((event) => event.targetType).sort()).toEqual(["beta_enrollment", "beta_invitation"]);
  });
});
