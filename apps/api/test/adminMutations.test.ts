import { and, eq } from "drizzle-orm";
import { schema } from "@renvia/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClerkClient } from "@clerk/backend";
import { ago, callAdmin as call, DAY, MISSING_ID } from "./support/admin.js";
import { balanceOf, db, ledgerFor, makeProject, makeRender, makeUser } from "./support/db.js";

// Behaviour of the admin write endpoints. These sit on top of money, roles and audit history,
// so the router can be reorganised only if every one of these still holds.
vi.mock("@clerk/backend", async () => (await import("./support/clerkStub.js")).clerkStub());

let actors: Awaited<ReturnType<typeof seed>>;

async function seed() {
  await db.insert(schema.billingPlans).values({ slug: "starter", name: "Starter", description: "Starter plan" });
  const admin = await makeUser({ clerkId: "admin", email: "admin@renvia.test", role: "admin" });
  const admin2 = await makeUser({ clerkId: "admin2", email: "admin2@renvia.test", role: "admin" });
  const support = await makeUser({ clerkId: "support", email: "support@renvia.test", role: "support" });
  const billing = await makeUser({ clerkId: "billing", email: "billing@renvia.test", role: "billing" });
  const analyst = await makeUser({ clerkId: "analyst", email: "analyst@renvia.test", role: "analyst" });
  const customer = await makeUser({ clerkId: "customer", email: "customer@example.test", creditBalance: 15 });
  const customer2 = await makeUser({ clerkId: "customer2", email: "customer2@example.test", creditBalance: 0 });
  return { admin, admin2, support, billing, analyst, customer, customer2 };
}

beforeEach(async () => {
  actors = await seed();
});

const events = (action?: string) =>
  db
    .select()
    .from(schema.adminEvents)
    .where(action ? eq(schema.adminEvents.action, action as never) : undefined);

/** Turns off the approval gates so role changes and bulk grants run directly. */
const disableApprovals = () =>
  db.insert(schema.governanceSettings).values({
    id: 1, bulkCreditApprovalThreshold: 0, roleChangeApprovalThreshold: 0, refundApprovalThresholdCents: 0, maintenanceApprovalThreshold: 0,
  });

describe("POST /users/:id/credits", () => {
  it("grants credits, writes a ledger entry and audits it", async () => {
    const res = await call("admin", "POST", `/users/${actors.customer.id}/credits`, { amount: 10, note: "goodwill" });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { creditBalance: number } }).user.creditBalance).toBe(25);
    expect(await balanceOf(actors.customer.id)).toBe(25);
    expect(await ledgerFor(actors.customer.id)).toEqual([
      expect.objectContaining({ amount: 10, reason: "admin_grant", note: "goodwill", actorId: actors.admin.id }),
    ]);
    const [event] = await events("credits.adjust");
    expect(event).toMatchObject({ actorId: actors.admin.id, targetId: actors.customer.id, summary: "Granted 10 credits for customer@example.test" });
  });

  it("removes credits", async () => {
    await call("admin", "POST", `/users/${actors.customer.id}/credits`, { amount: -5, note: "correction" });
    expect(await balanceOf(actors.customer.id)).toBe(10);
    expect((await events("credits.adjust"))[0]!.summary).toBe("Removed 5 credits for customer@example.test");
  });

  it("refuses to take a balance below zero and changes nothing", async () => {
    const res = await call("admin", "POST", `/users/${actors.customer.id}/credits`, { amount: -16, note: "too much" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "balance_negative" });
    expect(await balanceOf(actors.customer.id)).toBe(15);
    expect(await ledgerFor(actors.customer.id)).toHaveLength(0);
    expect(await events("credits.adjust")).toHaveLength(0);
  });

  it("enforces the maximum balance on grants but not on removals", async () => {
    await db.insert(schema.appSettings).values({ id: 1, maxCreditBalance: 20 });

    const grant = await call("admin", "POST", `/users/${actors.customer.id}/credits`, { amount: 10, note: "over cap" });
    expect(grant.status).toBe(400);
    expect(await grant.json()).toMatchObject({ code: "balance_cap", limit: 20, used: 15 });
    expect(await balanceOf(actors.customer.id)).toBe(15);

    const removal = await call("admin", "POST", `/users/${actors.customer.id}/credits`, { amount: -1, note: "ok" });
    expect(removal.status).toBe(200);
  });

  it("rejects a zero amount, an oversized adjustment and a missing note", async () => {
    for (const body of [{ amount: 0, note: "x" }, { amount: 10_001, note: "x" }, { amount: 5, note: "" }]) {
      expect((await call("admin", "POST", `/users/${actors.customer.id}/credits`, body)).status).toBe(400);
    }
    expect(await balanceOf(actors.customer.id)).toBe(15);
  });

  it("answers 404 for an unknown user", async () => {
    expect((await call("admin", "POST", `/users/${MISSING_ID}/credits`, { amount: 1, note: "x" })).status).toBe(404);
  });

  it("lets billing adjust credits but not support or analysts", async () => {
    const body = { amount: 1, note: "x" };
    expect((await call("billing", "POST", `/users/${actors.customer.id}/credits`, body)).status).toBe(200);
    expect((await call("support", "POST", `/users/${actors.customer.id}/credits`, body)).status).toBe(403);
    expect((await call("analyst", "POST", `/users/${actors.customer.id}/credits`, body)).status).toBe(403);
    expect(await balanceOf(actors.customer.id)).toBe(16);
  });
});

describe("PATCH /users/:id", () => {
  it("disables an account with a reason and audits the change", async () => {
    const res = await call("admin", "PATCH", `/users/${actors.customer.id}`, { disabled: true, reason: "abuse" });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { disabled: boolean } }).user.disabled).toBe(true);
    const [event] = await events("user.update");
    expect(event!.summary).toBe("customer@example.test: disabled account, signed out 2 session(s)");
    expect(event!.detail).toMatchObject({ reason: "abuse", before: { disabled: false }, sessionsRevoked: 2 });
  });

  it("still disables the account when Clerk cannot revoke its sessions", async () => {
    vi.mocked(createClerkClient).mockReturnValueOnce({
      sessions: { getSessionList: vi.fn(async () => { throw new Error("Clerk is down"); }) },
    } as never);

    const res = await call("admin", "PATCH", `/users/${actors.customer.id}`, { disabled: true, reason: "abuse" });

    expect(res.status).toBe(200);
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, actors.customer.id));
    expect(row!.disabled).toBe(true);
    const [event] = await events("user.update");
    expect(event!.summary).toBe("customer@example.test: disabled account");
    expect(event!.detail).toMatchObject({ sessionRevokeError: "Clerk is down" });
  });

  it("requires a reason for account changes and something to change", async () => {
    expect((await call("admin", "PATCH", `/users/${actors.customer.id}`, { disabled: true })).status).toBe(400);
    expect((await call("admin", "PATCH", `/users/${actors.customer.id}`, {})).status).toBe(400);
  });

  it("stops an admin disabling or demoting themselves", async () => {
    const res = await call("admin", "PATCH", `/users/${actors.admin.id}`, { disabled: true, reason: "oops" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "self_lockout" });
  });

  it("stops an admin demoting themselves to a staff role", async () => {
    await disableApprovals();
    for (const role of ["support", "billing", "analyst", "user"]) {
      const res = await call("admin", "PATCH", `/users/${actors.admin.id}`, { role, confirmEmail: "admin@renvia.test", reason: "r" });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "self_lockout" });
    }
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, actors.admin.id));
    expect(row!.role).toBe("admin");
  });

  it("describes a staff role change accurately in the audit trail", async () => {
    await disableApprovals();
    await call("admin", "PATCH", `/users/${actors.customer.id}`, { role: "support", confirmEmail: "customer@example.test", reason: "r" });
    await call("admin", "PATCH", `/users/${actors.admin2.id}`, { role: "billing", confirmEmail: "admin2@renvia.test", reason: "r" });
    expect((await events("user.update")).map((e) => e.summary)).toEqual([
      "customer@example.test: role changed from user to support",
      "admin2@renvia.test: role changed from admin to billing",
    ]);
  });

  it("sets and clears per-user limit overrides", async () => {
    await call("admin", "PATCH", `/users/${actors.customer.id}`, { dailyRenderLimitOverride: 5, limitsExempt: true });
    let [row] = await db.select().from(schema.users).where(eq(schema.users.id, actors.customer.id));
    expect(row).toMatchObject({ dailyRenderLimitOverride: 5, limitsExempt: true });

    await call("admin", "PATCH", `/users/${actors.customer.id}`, { dailyRenderLimitOverride: null });
    [row] = await db.select().from(schema.users).where(eq(schema.users.id, actors.customer.id));
    expect(row!.dailyRenderLimitOverride).toBeNull();
    expect((await events("user.update")).map((e) => e.summary)).toEqual([
      "customer@example.test: exempted from limits, daily renders override set to 5",
      "customer@example.test: daily renders override cleared",
    ]);
  });

  it("routes a role change through approval by default and leaves the role alone", async () => {
    const res = await call("admin", "PATCH", `/users/${actors.customer.id}`, {
      role: "support", confirmEmail: "customer@example.test", reason: "needs access",
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as { pendingApproval: boolean; approvalId: string };
    expect(body.pendingApproval).toBe(true);
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, actors.customer.id));
    expect(row!.role).toBe("user");
    const [request] = await db.select().from(schema.approvalRequests);
    expect(request).toMatchObject({ id: body.approvalId, action: "role_change", status: "pending", requestedBy: actors.admin.id });
  });

  it("changes a role directly when approvals are off, once the email is confirmed", async () => {
    await disableApprovals();

    const mismatch = await call("admin", "PATCH", `/users/${actors.customer.id}`, { role: "admin", confirmEmail: "wrong@example.test", reason: "r" });
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toMatchObject({ code: "confirm_email_mismatch" });

    const ok = await call("admin", "PATCH", `/users/${actors.customer.id}`, { role: "admin", confirmEmail: "Customer@Example.test", reason: "r" });
    expect(ok.status).toBe(200);
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, actors.customer.id));
    expect(row!.role).toBe("admin");
    expect((await events("user.update"))[0]!.summary).toBe("customer@example.test: promoted to admin");
  });

  it("will not promote a disabled account", async () => {
    await disableApprovals();
    await db.update(schema.users).set({ disabled: true }).where(eq(schema.users.id, actors.customer.id));

    const res = await call("admin", "PATCH", `/users/${actors.customer.id}`, { role: "admin", confirmEmail: "customer@example.test", reason: "r" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "disabled_user" });
  });

  it("is restricted to admins", async () => {
    for (const who of ["support", "billing", "analyst"]) {
      expect((await call(who, "PATCH", `/users/${actors.customer.id}`, { limitsExempt: true })).status).toBe(403);
    }
  });
});

describe("bulk credit grants and approvals", () => {
  const ids = () => [actors.customer.id, actors.customer2.id];

  it("grants directly below the approval threshold", async () => {
    const res = await call("billing", "POST", "/users/bulk-credits", { userIds: ids(), amount: 10, note: "promo" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 2 });
    expect(await balanceOf(actors.customer.id)).toBe(25);
    expect(await balanceOf(actors.customer2.id)).toBe(10);
    expect(await ledgerFor(actors.customer2.id)).toEqual([
      expect.objectContaining({ amount: 10, reason: "admin_grant", note: "promo", actorId: actors.billing.id }),
    ]);
    expect((await events("credits.adjust"))[0]!.summary).toBe("Granted 10 credits to 2 users");
  });

  it("holds a large grant for approval without touching any balance", async () => {
    const res = await call("admin", "POST", "/users/bulk-credits", { userIds: ids(), amount: 300, note: "big promo" });

    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ pendingApproval: true, updated: 0 });
    expect(await balanceOf(actors.customer.id)).toBe(15);
    expect(await balanceOf(actors.customer2.id)).toBe(0);
    const [request] = await db.select().from(schema.approvalRequests);
    expect(request).toMatchObject({ action: "bulk_credits", status: "pending", riskValue: 600, threshold: 500 });
  });

  it("completes the request, approve and execute cycle with a second admin", async () => {
    const held = await call("admin", "POST", "/users/bulk-credits", { userIds: ids(), amount: 300, note: "big promo" });
    const { approvalId } = (await held.json()) as { approvalId: string };

    // Cannot be executed before approval, nor approved by its requester.
    expect((await call("admin2", "POST", `/approvals/${approvalId}/execute`, {})).status).toBe(409);
    const self = await call("admin", "POST", `/approvals/${approvalId}/approve`, {});
    expect(self.status).toBe(403);
    expect(await self.json()).toMatchObject({ code: "self_approval" });

    const approved = await call("admin2", "POST", `/approvals/${approvalId}/approve`, { note: "ok" });
    expect(approved.status).toBe(200);
    expect(await approved.json()).toEqual({ id: approvalId, status: "approved" });
    expect(await balanceOf(actors.customer.id)).toBe(15); // approval alone moves no credits

    const executed = await call("admin2", "POST", `/approvals/${approvalId}/execute`, {});
    expect(executed.status).toBe(200);
    expect(await executed.json()).toEqual({ id: approvalId, status: "executed", updated: 2 });
    expect(await balanceOf(actors.customer.id)).toBe(315);
    expect(await balanceOf(actors.customer2.id)).toBe(300);

    // Cannot be executed twice.
    expect((await call("admin2", "POST", `/approvals/${approvalId}/execute`, {})).status).toBe(409);
    expect(await balanceOf(actors.customer.id)).toBe(315);
  });

  it("lets a different admin reject a request", async () => {
    const held = await call("admin", "POST", "/users/bulk-credits", { userIds: ids(), amount: 300, note: "big promo" });
    const { approvalId } = (await held.json()) as { approvalId: string };

    expect((await call("admin", "POST", `/approvals/${approvalId}/reject`, { note: "no" })).status).toBe(403);
    const rejected = await call("admin2", "POST", `/approvals/${approvalId}/reject`, { note: "not justified" });
    expect(await rejected.json()).toEqual({ id: approvalId, status: "rejected" });
    expect((await call("admin2", "POST", `/approvals/${approvalId}/approve`, {})).status).toBe(409);
  });

  it("applies an approved role change", async () => {
    const held = await call("admin", "PATCH", `/users/${actors.customer.id}`, { role: "support", confirmEmail: "customer@example.test", reason: "r" });
    const { approvalId } = (await held.json()) as { approvalId: string };
    await call("admin2", "POST", `/approvals/${approvalId}/approve`, {});

    const executed = await call("admin2", "POST", `/approvals/${approvalId}/execute`, {});

    expect(executed.status).toBe(200);
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, actors.customer.id));
    expect(row!.role).toBe("support");
  });

  it("only lets an admin execute an approved role change", async () => {
    const held = await call("admin", "PATCH", `/users/${actors.customer.id}`, { role: "support", confirmEmail: "customer@example.test", reason: "r" });
    const { approvalId } = (await held.json()) as { approvalId: string };
    await call("admin2", "POST", `/approvals/${approvalId}/approve`, {});

    expect((await call("billing", "POST", `/approvals/${approvalId}/execute`, {})).status).toBe(403);
    let [row] = await db.select().from(schema.users).where(eq(schema.users.id, actors.customer.id));
    expect(row!.role).toBe("user");

    expect((await call("admin2", "POST", `/approvals/${approvalId}/execute`, {})).status).toBe(200);
    [row] = await db.select().from(schema.users).where(eq(schema.users.id, actors.customer.id));
    expect(row!.role).toBe("support");
  });

  type Approvals = { open: { summary: string; status: string; canApprove: boolean; canReject: boolean; canExecute: boolean }[]; recent: { status: string }[] };
  const approvals = async (who: string) => (await (await call(who, "GET", "/approvals")).json()) as Approvals;

  it("lists open approvals with what each viewer may do", async () => {
    const held = await call("admin", "POST", "/users/bulk-credits", { userIds: ids(), amount: 300, note: "big promo" });
    const { approvalId } = (await held.json()) as { approvalId: string };

    const expected = { summary: "Grant 300 credits to 2 users: big promo", status: "pending" };
    expect((await approvals("admin")).open).toEqual([expect.objectContaining({ ...expected, canApprove: false, canReject: false, canExecute: false })]);
    expect((await approvals("admin2")).open).toEqual([expect.objectContaining({ ...expected, canApprove: true, canReject: true, canExecute: false })]);
    expect((await approvals("billing")).open).toEqual([expect.objectContaining({ ...expected, canApprove: false, canReject: false, canExecute: false })]);

    await call("admin2", "POST", `/approvals/${approvalId}/approve`, {});
    expect((await approvals("billing")).open).toEqual([expect.objectContaining({ status: "approved", canApprove: false, canExecute: true })]);

    await call("billing", "POST", `/approvals/${approvalId}/execute`, {});
    const after = await approvals("admin");
    expect(after.open).toEqual([]);
    expect(after.recent).toEqual([expect.objectContaining({ status: "executed" })]);
  });

  it("only offers an approved role change to admins", async () => {
    const held = await call("admin", "PATCH", `/users/${actors.customer.id}`, { role: "support", confirmEmail: "customer@example.test", reason: "r" });
    const { approvalId } = (await held.json()) as { approvalId: string };
    await call("admin2", "POST", `/approvals/${approvalId}/approve`, {});

    expect((await approvals("billing")).open).toEqual([expect.objectContaining({ summary: "Change customer@example.test to support", canExecute: false })]);
    expect((await approvals("admin2")).open).toEqual([expect.objectContaining({ canExecute: true })]);
  });

  it("hides approvals from staff who cannot execute them", async () => {
    for (const who of ["support", "analyst"]) expect((await call(who, "GET", "/approvals")).status).toBe(403);
  });

  it("rejects unknown users and the caps", async () => {
    expect((await call("admin", "POST", "/users/bulk-credits", { userIds: [MISSING_ID], amount: 1, note: "x" })).status).toBe(404);
    await db.insert(schema.appSettings).values({ id: 1, maxCreditBalance: 20 });
    const res = await call("billing", "POST", "/users/bulk-credits", { userIds: ids(), amount: 10, note: "x" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "balance_cap" });
    expect(await balanceOf(actors.customer.id)).toBe(15);
  });

  it("keeps governance thresholds admin-only and audited", async () => {
    const body = { bulkCreditApprovalThreshold: 50, refundApprovalThresholdCents: 100, roleChangeApprovalThreshold: 2, maintenanceApprovalThreshold: 1, reason: "tighten" };
    expect((await call("billing", "PUT", "/governance", body)).status).toBe(403);
    const res = await call("admin", "PUT", "/governance", body);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ bulkCreditApprovalThreshold: 50, updatedBy: actors.admin.id });
    expect((await events("settings.update"))[0]!.summary).toBe("Updated high-risk action thresholds");
  });
});

describe("customer notes, tags and sessions", () => {
  it("lets support add a note and audits it", async () => {
    const res = await call("support", "POST", `/users/${actors.customer.id}/notes`, { body: "Called about billing" });

    expect(res.status).toBe(200);
    const [note] = await db.select().from(schema.customerNotes);
    expect(note).toMatchObject({ userId: actors.customer.id, authorId: actors.support.id, body: "Called about billing" });
    expect((await events("customer.note"))[0]).toMatchObject({ summary: "Added internal customer note", targetId: actors.customer.id });
  });

  it("rejects notes from analysts, empty notes and unknown users", async () => {
    expect((await call("analyst", "POST", `/users/${actors.customer.id}/notes`, { body: "x" })).status).toBe(403);
    expect((await call("support", "POST", `/users/${actors.customer.id}/notes`, { body: "  " })).status).toBe(400);
    expect((await call("support", "POST", `/users/${MISSING_ID}/notes`, { body: "x" })).status).toBe(404);
  });

  it("tags a customer once regardless of letter case", async () => {
    await call("support", "POST", `/users/${actors.customer.id}/tags`, { label: "VIP" });
    await call("support", "POST", `/users/${actors.customer.id}/tags`, { label: "vip" });

    const tags = await db.select().from(schema.customerTags).where(eq(schema.customerTags.userId, actors.customer.id));
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({ label: "VIP", normalizedLabel: "vip" });
  });

  it("revokes sessions only after the email is typed exactly", async () => {
    const path = `/users/${actors.customer.id}/revoke-sessions`;
    const mismatch = await call("admin", "POST", path, { reason: "compromised", confirmEmail: "nope@example.test" });
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toMatchObject({ code: "confirm_email_mismatch" });

    const ok = await call("admin", "POST", path, { reason: "compromised", confirmEmail: "customer@example.test" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ revoked: 2 });
    expect((await events("user.session_revoke"))[0]!.summary).toBe("Revoked 2 session(s) for customer@example.test");

    const self = await call("admin", "POST", `/users/${actors.admin.id}/revoke-sessions`, { reason: "x", confirmEmail: "admin@renvia.test" });
    expect(await self.json()).toMatchObject({ code: "self_revoke" });
    expect((await call("support", "POST", path, { reason: "x", confirmEmail: "customer@example.test" })).status).toBe(403);
  });
});

describe("PUT /settings", () => {
  it("updates settings, reports them back and audits the change", async () => {
    const res = await call("admin", "PUT", "/settings", { signupBonusCredits: 30, maxUploadMb: 20 });

    expect(res.status).toBe(200);
    const [row] = await db.select().from(schema.appSettings);
    expect(row).toMatchObject({ signupBonusCredits: 30, maxUploadMb: 20, updatedBy: actors.admin.id });
    expect((await events("settings.update"))[0]!.summary).toBe("Updated settings: signupBonusCredits, maxUploadMb");
    const read = await call("admin", "GET", "/settings");
    expect(((await read.json()) as { signupBonusCredits: number }).signupBonusCredits).toBe(30);
  });

  it("validates input", async () => {
    expect((await call("admin", "PUT", "/settings", { budgetWarningPercent: 90, budgetCriticalPercent: 80 })).status).toBe(400);
    expect((await call("admin", "PUT", "/settings", { signupBonusCredits: -1 })).status).toBe(400);
    expect((await call("admin", "PUT", "/settings", { notASetting: true })).status).toBe(400);
    expect(await events("settings.update")).toHaveLength(0);
  });

  it("is restricted to admins", async () => {
    for (const who of ["support", "billing", "analyst"]) {
      expect((await call(who, "PUT", "/settings", { signupBonusCredits: 1 })).status).toBe(403);
    }
  });
});

describe("incidents", () => {
  async function stuckIncident() {
    const owner = await makeUser();
    const project = await makeProject(owner.id);
    await makeRender(project.id, { status: "processing", updatedAt: ago(DAY), createdAt: ago(DAY) });
    const sync = await call("support", "POST", "/incidents/sync", {});
    expect(sync.status).toBe(200);
    const list = (await (await call("support", "GET", "/incidents")).json()) as { incidents: { id: string; status: string }[] };
    expect(list.incidents.length).toBeGreaterThan(0);
    return list.incidents[0]!;
  }

  it("opens an incident for a stuck render when synced", async () => {
    const incident = await stuckIncident();
    expect(incident.status).toBe("open");
  });

  it("acknowledges, reprioritises, assigns and resolves an incident", async () => {
    const incident = await stuckIncident();

    expect(await (await call("support", "POST", `/incidents/${incident.id}/acknowledge`, { note: "looking" })).json()).toEqual({ id: incident.id, status: "acknowledged" });
    expect(await (await call("support", "POST", `/incidents/${incident.id}/severity`, { severity: "critical" })).json()).toEqual({ id: incident.id, severity: "critical" });
    expect(await (await call("support", "POST", `/incidents/${incident.id}/assign`, { ownerId: actors.support.id })).json()).toEqual({ id: incident.id, ownerId: actors.support.id });
    expect((await call("support", "POST", `/incidents/${incident.id}/assign`, { ownerId: actors.analyst.id })).status).toBe(409);
    expect(await (await call("support", "POST", `/incidents/${incident.id}/resolve`, { note: "restarted worker" })).json()).toEqual({ id: incident.id, status: "resolved" });
    expect((await call("support", "POST", `/incidents/${incident.id}/acknowledge`, {})).status).toBe(409);

    const [row] = await db.select().from(schema.incidents).where(eq(schema.incidents.id, incident.id));
    expect(row).toMatchObject({ status: "resolved", severity: "critical", ownerId: actors.support.id, resolutionNote: "restarted worker", resolvedBy: actors.support.id });
    expect((await events("incident.update")).map((e) => e.summary)).toEqual(["Acknowledged incident", "Assigned incident", "Resolved incident"]);
    const trail = await db.select().from(schema.incidentEvents).where(eq(schema.incidentEvents.incidentId, incident.id));
    expect(trail.find((event) => event.note === "Severity set to critical")!.action).toBe("severity_changed");
  });

  it("only lets incident managers change incidents", async () => {
    const incident = await stuckIncident();
    expect((await call("analyst", "POST", `/incidents/${incident.id}/acknowledge`, {})).status).toBe(403);
    expect((await call("analyst", "POST", "/incidents/sync", {})).status).toBe(403);
    expect((await call("analyst", "GET", "/incidents")).status).toBe(200);
  });
});

describe("audit exports", () => {
  it("creates an immutable CSV export that can be downloaded and verified", async () => {
    await call("admin", "POST", `/users/${actors.customer.id}/credits`, { amount: 2, note: "seed event" });

    const created = await call("analyst", "POST", "/audit/exports", { reason: "quarterly review" });
    expect(created.status).toBe(200);
    const { id, sha256, rows } = (await created.json()) as { id: string; sha256: string; rows: number };
    expect(rows).toBeGreaterThanOrEqual(1);

    const download = await call("analyst", "GET", `/audit/exports/${id}`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toContain("text/csv");
    expect(download.headers.get("x-content-sha256")).toBe(sha256);
    expect(download.headers.get("content-disposition")).toContain(`renvia-audit-${id}.csv`);
    const csv = await download.text();
    expect(csv.split("\n")[0]).toBe("id,created_at,action,actor_email,target_type,target_id,summary");
    expect(csv).toContain("Granted 2 credits for customer@example.test");

    const [row] = await db.select().from(schema.auditExports).where(and(eq(schema.auditExports.id, id)));
    expect(row!.sha256).toBe(sha256);
    expect((await events("audit.export"))[0]!.summary).toBe(`Created immutable audit export (${rows} rows)`);
  });

  it("requires a reason and audit access", async () => {
    expect((await call("analyst", "POST", "/audit/exports", {})).status).toBe(400);
    expect((await call("support", "POST", "/audit/exports", { reason: "x" })).status).toBe(403);
  });
});
