import { Hono } from "hono";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Database } from "@renvia/db";
import type { AdminBulkGrantCreditsResponse } from "@renvia/types";
import { getSettings } from "../../lib/settings.js";
import { denyUnless } from "./permissions.js";
import { findAdminUser, recordAdminEvent } from "./shared.js";
import type { AdminContext } from "./context.js";

export const governanceRoutes = new Hono<AdminContext>();

export async function governance(db: Database) {
  const [row] = await db.select().from(schema.governanceSettings).where(eq(schema.governanceSettings.id, 1));
  if (row) return row;
  const [created] = await db.insert(schema.governanceSettings).values({ id: 1 }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(schema.governanceSettings).where(eq(schema.governanceSettings.id, 1)))[0]!;
}

export async function requestApproval(db: Database, input: { action: "bulk_credits" | "refund" | "role_change" | "maintenance"; actorId: string; targetType: string; targetId?: string; riskValue: number; threshold: number; reason: string; payload: Record<string, unknown> }) {
  const [request] = await db.insert(schema.approvalRequests).values({ action: input.action, requestedBy: input.actorId, targetType: input.targetType, targetId: input.targetId ?? null, riskValue: input.riskValue, threshold: input.threshold, reason: input.reason, payload: input.payload }).returning();
  await db.batch([
    db.insert(schema.approvalEvents).values({ approvalId: request!.id, actorId: input.actorId, action: "requested", note: input.reason }),
    db.insert(schema.adminEvents).values({ actorId: input.actorId, action: "approval.request", targetType: input.targetType, targetId: input.targetId ?? null, summary: `Approval requested for ${input.action}`, detail: { approvalId: request!.id, riskValue: input.riskValue, threshold: input.threshold, reason: input.reason } }),
  ]);
  return request!;
}

governanceRoutes.get("/governance", async (c) => {
  const denied = denyUnless(c, "settings.read"); if (denied) return c.json(denied, 403);
  const [settings, pending] = await Promise.all([governance(c.get("db")), c.get("db").select({ id: schema.approvalRequests.id, action: schema.approvalRequests.action, reason: schema.approvalRequests.reason, riskValue: schema.approvalRequests.riskValue, threshold: schema.approvalRequests.threshold, createdAt: schema.approvalRequests.createdAt, requestedBy: schema.users.email }).from(schema.approvalRequests).innerJoin(schema.users, eq(schema.approvalRequests.requestedBy, schema.users.id)).where(eq(schema.approvalRequests.status, "pending")).orderBy(desc(schema.approvalRequests.createdAt)).limit(100)]);
  return c.json({ settings, pending: pending.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })) });
});

governanceRoutes.put("/governance", async (c) => {
  const denied = denyUnless(c, "settings.manage"); if (denied) return c.json(denied, 403);
  const body = z.object({ bulkCreditApprovalThreshold: z.number().int().min(0).max(1_000_000), refundApprovalThresholdCents: z.number().int().min(0).max(10_000_000), roleChangeApprovalThreshold: z.number().int().min(0).max(100), maintenanceApprovalThreshold: z.number().int().min(0).max(100), reason: z.string().trim().min(1).max(300) }).parse(await c.req.json());
  const [updated] = await c.get("db").insert(schema.governanceSettings).values({ id: 1, ...body, updatedBy: c.get("admin").id, updatedAt: new Date() }).onConflictDoUpdate({ target: schema.governanceSettings.id, set: { ...body, updatedBy: c.get("admin").id, updatedAt: new Date() } }).returning();
  await recordAdminEvent(c.get("db"), { actorId: c.get("admin").id, action: "settings.update", targetType: "governance_settings", targetId: "1", summary: "Updated high-risk action thresholds", detail: { ...body } });
  return c.json(updated);
});

governanceRoutes.post("/users/bulk-credits", async (c) => {
  const denied = denyUnless(c, "credits.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const adminUser = c.get("admin");
  const body = z
    .object({
      userIds: z.array(z.string().uuid()).min(1).max(100),
      amount: z.number().int().min(1).max(10_000),
      note: z.string().trim().min(1).max(200),
    })
    .parse(await c.req.json());

  const uniqueIds = [...new Set(body.userIds)];
  const existing = await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, uniqueIds));
  if (existing.length !== uniqueIds.length) return c.json({ error: "One or more selected users no longer exist" }, 404);
  const rules = await governance(db);
  const riskValue = body.amount * existing.length;
  if (rules.bulkCreditApprovalThreshold > 0 && riskValue >= rules.bulkCreditApprovalThreshold) {
    const approval = await requestApproval(db, { action: "bulk_credits", actorId: adminUser.id, targetType: "users", riskValue, threshold: rules.bulkCreditApprovalThreshold, reason: body.note, payload: { userIds: uniqueIds, amount: body.amount, note: body.note } });
    return c.json({ pendingApproval: true, approvalId: approval.id, updated: 0 }, 202);
  }
  const settings = await getSettings(db);
  if (settings.maxCreditBalance !== null) {
    const balances = await db.select({ id: schema.users.id, creditBalance: schema.users.creditBalance }).from(schema.users).where(inArray(schema.users.id, uniqueIds));
    const aboveCap = balances.find((user) => user.creditBalance + body.amount > settings.maxCreditBalance!);
    if (aboveCap) {
      return c.json({ error: `A selected balance would exceed the ${settings.maxCreditBalance}-credit cap`, code: "balance_cap" }, 400);
    }
  }

  // Neon executes a batch as one transaction. The ledger rows and the audit event
  // therefore cannot be separated from a partially completed bulk grant.
  const writes = existing.flatMap((user) => [
    db.update(schema.users).set({ creditBalance: sql`${schema.users.creditBalance} + ${body.amount}` }).where(eq(schema.users.id, user.id)),
    db.insert(schema.creditLedger).values({ userId: user.id, amount: body.amount, reason: "admin_grant", note: body.note, actorId: adminUser.id }),
  ]);
  const [firstWrite, ...remainingWrites] = writes;
  if (!firstWrite) return c.json({ error: "No users selected" }, 400);
  await db.batch([
    firstWrite,
    ...remainingWrites,
    db.insert(schema.adminEvents).values({
      actorId: adminUser.id,
      action: "credits.adjust",
      targetType: "users",
      targetId: null,
      summary: `Granted ${body.amount} credits to ${existing.length} users`,
      detail: { amount: body.amount, note: body.note, userIds: existing.map((user) => user.id), emails: existing.map((user) => user.email) },
    }),
  ]);

  const response: AdminBulkGrantCreditsResponse = { updated: existing.length };
  return c.json(response);
});

governanceRoutes.post("/approvals/:id/approve", async (c) => {
  const denied = denyUnless(c, "settings.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db"); const approver = c.get("admin"); const id = z.string().uuid().parse(c.req.param("id"));
  const [request] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, id));
  if (!request) return c.json({ error: "Approval request not found" }, 404);
  if (request.status !== "pending") return c.json({ error: "Approval request is no longer pending" }, 409);
  if (request.requestedBy === approver.id) return c.json({ error: "A requester cannot approve their own action", code: "self_approval" }, 403);
  if (approver.role !== "admin") return c.json({ error: "A second administrator must approve this action" }, 403);
  const note = z.object({ note: z.string().trim().max(300).optional() }).parse(await c.req.json()).note ?? null;
  await db.batch([
    db.update(schema.approvalRequests).set({ status: "approved", approvedBy: approver.id, approvedAt: new Date(), decisionNote: note }).where(eq(schema.approvalRequests.id, id)),
    db.insert(schema.approvalEvents).values({ approvalId: id, actorId: approver.id, action: "approved", note }),
    db.insert(schema.adminEvents).values({ actorId: approver.id, action: "approval.approve", targetType: request.targetType, targetId: request.targetId, summary: `Approved ${request.action}`, detail: { approvalId: id } }),
  ]);
  // Approval is intentionally separate from execution. This prevents a review click from triggering a provider refund or a bulk mutation.
  return c.json({ id, status: "approved" });
});

governanceRoutes.post("/approvals/:id/reject", async (c) => {
  const denied = denyUnless(c, "settings.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db"); const actor = c.get("admin"); const id = z.string().uuid().parse(c.req.param("id"));
  const { note } = z.object({ note: z.string().trim().min(1).max(300) }).parse(await c.req.json());
  const [request] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, id));
  if (!request) return c.json({ error: "Approval request not found" }, 404);
  if (request.status !== "pending") return c.json({ error: "Approval request is no longer pending" }, 409);
  if (request.requestedBy === actor.id) return c.json({ error: "A requester cannot reject their own action", code: "self_approval" }, 403);
  await db.batch([
    db.update(schema.approvalRequests).set({ status: "rejected", approvedBy: actor.id, approvedAt: new Date(), decisionNote: note }).where(eq(schema.approvalRequests.id, id)),
    db.insert(schema.approvalEvents).values({ approvalId: id, actorId: actor.id, action: "rejected", note }),
    db.insert(schema.adminEvents).values({ actorId: actor.id, action: "approval.reject", targetType: request.targetType, targetId: request.targetId, summary: `Rejected ${request.action}`, detail: { approvalId: id, note } }),
  ]);
  return c.json({ id, status: "rejected" });
});

governanceRoutes.post("/approvals/:id/execute", async (c) => {
  const denied = denyUnless(c, "credits.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db"); const actor = c.get("admin"); const id = z.string().uuid().parse(c.req.param("id"));
  const [request] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, id));
  if (!request) return c.json({ error: "Approval request not found" }, 404);
  if (request.status !== "approved") return c.json({ error: "Approval request must be approved before execution" }, 409);
  if (request.action === "role_change") {
    const payload = z.object({ id: z.string().uuid(), role: z.enum(["user", "analyst", "support", "billing", "admin"]), confirmEmail: z.string().email() }).parse(request.payload);
    const target = await findAdminUser(db, payload.id);
    if (!target) return c.json({ error: "Target user no longer exists" }, 409);
    if (target.id === actor.id || payload.confirmEmail.toLowerCase() !== target.email.toLowerCase()) return c.json({ error: "Role change confirmation is no longer valid" }, 409);
    if (payload.role === "admin" && target.disabled) return c.json({ error: "Enable the account before promoting them to admin" }, 409);
    if (payload.role === "user" && target.role === "admin") {
      const [count] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.users).where(and(eq(schema.users.role, "admin"), eq(schema.users.disabled, false)));
      if ((count?.count ?? 0) <= 1) return c.json({ error: "Can't demote the last active admin" }, 409);
    }
    await db.batch([db.update(schema.users).set({ role: payload.role, updatedAt: new Date() }).where(eq(schema.users.id, target.id)), db.update(schema.approvalRequests).set({ status: "executed", executedAt: new Date() }).where(eq(schema.approvalRequests.id, id)), db.insert(schema.approvalEvents).values({ approvalId: id, actorId: actor.id, action: "executed" }), db.insert(schema.adminEvents).values({ actorId: actor.id, action: "approval.execute", targetType: "user", targetId: target.id, summary: `Executed approved role change for ${target.email}`, detail: { approvalId: id, role: payload.role } })]);
    return c.json({ id, status: "executed" });
  }
  if (request.action !== "bulk_credits") return c.json({ error: "This approved action is executed from its protected operation" }, 409);
  const payload = z.object({ userIds: z.array(z.string().uuid()).min(1).max(100), amount: z.number().int().min(1).max(10_000), note: z.string().min(1).max(200) }).parse(request.payload);
  const users = await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, payload.userIds));
  if (users.length !== payload.userIds.length) return c.json({ error: "A target user no longer exists; create a new approval request" }, 409);
  const writes = users.flatMap((user) => [db.update(schema.users).set({ creditBalance: sql`${schema.users.creditBalance} + ${payload.amount}` }).where(eq(schema.users.id, user.id)), db.insert(schema.creditLedger).values({ userId: user.id, amount: payload.amount, reason: "admin_grant", note: payload.note, actorId: actor.id })]);
  const [firstWrite, ...remainingWrites] = writes;
  await db.batch([firstWrite!, ...remainingWrites, db.update(schema.approvalRequests).set({ status: "executed", executedAt: new Date() }).where(eq(schema.approvalRequests.id, id)), db.insert(schema.approvalEvents).values({ approvalId: id, actorId: actor.id, action: "executed" }), db.insert(schema.adminEvents).values({ actorId: actor.id, action: "approval.execute", targetType: "users", summary: `Executed approved bulk credit grant to ${users.length} users`, detail: { approvalId: id, amount: payload.amount } })]);
  return c.json({ id, status: "executed", updated: users.length });
});
