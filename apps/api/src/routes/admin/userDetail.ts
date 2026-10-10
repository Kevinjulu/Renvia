import { Hono } from "hono";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { createClerkClient } from "@clerk/backend";
import { schema } from "@renvia/db";
import type { AdminLedgerEntry } from "@renvia/types";
import { getSettings } from "../../lib/settings.js";
import { getUsage, resolveLimits } from "../../lib/limits.js";
import { denyUnless } from "./permissions.js";
import { selectAdminRenders, toAdminRender, findAdminUser, recordAdminEvent } from "./shared.js";
import { governance, requestApproval } from "./governance.js";
import type { AdminContext } from "./context.js";

export const userDetailRoutes = new Hono<AdminContext>();

userDetailRoutes.get("/users/:id", async (c) => {
  const denied = denyUnless(c, "users.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const [user, settings] = await Promise.all([findAdminUser(db, id), getSettings(db)]);
  if (!user) return c.json({ error: "Not found" }, 404);

  const actor = alias(schema.users, "actor");
  const [ledgerRows, renderRows, notes, tags, projects, payments, entitlement, failures] = await Promise.all([
    db
      .select({ entry: schema.creditLedger, actorEmail: actor.email })
      .from(schema.creditLedger)
      .leftJoin(actor, eq(schema.creditLedger.actorId, actor.id))
      .where(eq(schema.creditLedger.userId, id))
      .orderBy(desc(schema.creditLedger.createdAt))
      .limit(50),
    selectAdminRenders(db).where(eq(schema.users.id, id)).orderBy(desc(schema.renders.createdAt)).limit(20),
    db.select({ id: schema.customerNotes.id, body: schema.customerNotes.body, createdAt: schema.customerNotes.createdAt, authorEmail: actor.email })
      .from(schema.customerNotes).innerJoin(actor, eq(schema.customerNotes.authorId, actor.id)).where(eq(schema.customerNotes.userId, id)).orderBy(desc(schema.customerNotes.createdAt)).limit(50),
    db.select({ id: schema.customerTags.id, label: schema.customerTags.label, createdAt: schema.customerTags.createdAt })
      .from(schema.customerTags).where(eq(schema.customerTags.userId, id)).orderBy(asc(schema.customerTags.label)),
    db.select({ id: schema.projects.id, name: schema.projects.name, createdAt: schema.projects.createdAt, updatedAt: schema.projects.updatedAt })
      .from(schema.projects).where(eq(schema.projects.ownerId, id)).orderBy(desc(schema.projects.updatedAt)).limit(20),
    db.select({ id: schema.billingPayments.id, provider: schema.billingPayments.provider, status: schema.billingPayments.status, amountCents: schema.billingPayments.amountCents, currency: schema.billingPayments.currency, createdAt: schema.billingPayments.createdAt, paidAt: schema.billingPayments.paidAt })
      .from(schema.billingPayments).where(eq(schema.billingPayments.userId, id)).orderBy(desc(schema.billingPayments.createdAt)).limit(50),
    db.select({ status: schema.userEntitlements.status, currentPeriodEnd: schema.userEntitlements.currentPeriodEnd, planName: schema.billingPlans.name, planSlug: schema.billingPlans.slug })
      .from(schema.userEntitlements).leftJoin(schema.billingPlans, eq(schema.userEntitlements.planId, schema.billingPlans.id)).where(eq(schema.userEntitlements.userId, id)).limit(1),
    db.select({ id: schema.renders.id, errorMessage: schema.renders.errorMessage, createdAt: schema.renders.updatedAt, projectName: schema.projects.name })
      .from(schema.renders).innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id)).where(and(eq(schema.projects.ownerId, id), eq(schema.renders.status, "failed"))).orderBy(desc(schema.renders.updatedAt)).limit(20),
  ]);

  const ledger: AdminLedgerEntry[] = ledgerRows.map(({ entry, actorEmail }) => ({
    id: entry.id,
    amount: entry.amount,
    reason: entry.reason,
    renderId: entry.renderId,
    segmentationId: entry.segmentationId,
    note: entry.note,
    createdAt: entry.createdAt.toISOString(),
    actorEmail,
  }));
  const [userRow] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  return c.json({
    user,
    ledger,
    renders: await Promise.all(renderRows.map((row) => toAdminRender(c.env, new URL(c.req.url).origin, row, settings.stuckTimeoutMinutes))),
    limits: resolveLimits(userRow!, settings),
    usage: await getUsage(db, user.id),
    notes: notes.map((note) => ({ ...note, createdAt: note.createdAt.toISOString() })),
    tags: tags.map((tag) => ({ ...tag, createdAt: tag.createdAt.toISOString() })),
    projects: projects.map((project) => ({ ...project, createdAt: project.createdAt.toISOString(), updatedAt: project.updatedAt.toISOString() })),
    payments: payments.map((payment) => ({ ...payment, createdAt: payment.createdAt.toISOString(), paidAt: payment.paidAt?.toISOString() ?? null })),
    entitlement: entitlement[0] ? { ...entitlement[0], currentPeriodEnd: entitlement[0].currentPeriodEnd?.toISOString() ?? null } : null,
    recentErrors: failures.map((failure) => ({ ...failure, createdAt: failure.createdAt.toISOString() })),
  });
});

const customerNoteSchema = z.object({ body: z.string().trim().min(1).max(2000) });
userDetailRoutes.post("/users/:id/notes", async (c) => {
  const denied = denyUnless(c, "customers.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db"); const userId = z.string().uuid().parse(c.req.param("id"));
  const { body } = customerNoteSchema.parse(await c.req.json());
  if (!(await findAdminUser(db, userId))) return c.json({ error: "Not found" }, 404);
  const [note] = await db.insert(schema.customerNotes).values({ userId, authorId: c.get("admin").id, body }).returning();
  await recordAdminEvent(db, { actorId: c.get("admin").id, action: "customer.note", targetType: "user", targetId: userId, summary: "Added internal customer note", detail: { noteId: note!.id } });
  return c.json({ id: note!.id });
});

const customerTagSchema = z.object({ label: z.string().trim().min(1).max(50) });
userDetailRoutes.post("/users/:id/tags", async (c) => {
  const denied = denyUnless(c, "customers.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db"); const userId = z.string().uuid().parse(c.req.param("id"));
  const { label } = customerTagSchema.parse(await c.req.json());
  if (!(await findAdminUser(db, userId))) return c.json({ error: "Not found" }, 404);
  const normalizedLabel = label.toLocaleLowerCase();
  await db.insert(schema.customerTags).values({ userId, label, normalizedLabel, createdBy: c.get("admin").id }).onConflictDoNothing();
  await recordAdminEvent(db, { actorId: c.get("admin").id, action: "customer.tag", targetType: "user", targetId: userId, summary: `Tagged customer: ${label}`, detail: { label } });
  return c.json({ ok: true });
});

/** Signs a user out everywhere by revoking every active Clerk session. Returns how many were revoked. */
async function revokeActiveSessions(secretKey: string, clerkId: string): Promise<number> {
  const clerk = createClerkClient({ secretKey });
  const sessions = await clerk.sessions.getSessionList({ userId: clerkId, status: "active", limit: 100 });
  await Promise.all(sessions.data.map((session) => clerk.sessions.revokeSession(session.id)));
  return sessions.data.length;
}

userDetailRoutes.post("/users/:id/revoke-sessions", async (c) => {
  const denied = denyUnless(c, "users.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db"); const userId = z.string().uuid().parse(c.req.param("id"));
  const body = z.object({ reason: z.string().trim().min(1).max(300), confirmEmail: z.string().trim().email() }).parse(await c.req.json());
  const target = await findAdminUser(db, userId); const actor = c.get("admin");
  if (!target) return c.json({ error: "Not found" }, 404);
  if (target.id === actor.id) return c.json({ error: "You cannot revoke your own sessions here", code: "self_revoke" }, 400);
  if (body.confirmEmail.toLowerCase() !== target.email.toLowerCase()) return c.json({ error: "Type the user's email exactly to confirm", code: "confirm_email_mismatch" }, 400);
  const revoked = await revokeActiveSessions(c.env.CLERK_SECRET_KEY, target.clerkId);
  await recordAdminEvent(db, { actorId: actor.id, action: "user.session_revoke", targetType: "user", targetId: target.id, summary: `Revoked ${revoked} session(s) for ${target.email}`, detail: { reason: body.reason, sessionCount: revoked } });
  return c.json({ revoked });
});

const grantSchema = z.object({
  amount: z
    .number()
    .int()
    .refine((value) => value !== 0, "Amount can't be zero")
    .refine((value) => Math.abs(value) <= 10_000, "At most 10,000 credits per adjustment"),
  note: z.string().trim().min(1).max(200),
});

/** Postgres check violation: the users_credit_balance_non_negative constraint. */
function isCheckViolation(error: unknown): boolean {
  for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
    if ((current as { code?: string }).code === "23514") return true;
  }
  return false;
}

userDetailRoutes.post("/users/:id/credits", async (c) => {
  const denied = denyUnless(c, "credits.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const { amount, note } = grantSchema.parse(await c.req.json());
  const adminUser = c.get("admin");
  const target = await findAdminUser(db, id);
  if (!target) return c.json({ error: "Not found" }, 404);

  // The balance ceiling applies to grants only — a removal is always allowed.
  if (amount > 0) {
    const settings = await getSettings(db);
    if (settings.maxCreditBalance !== null && target.creditBalance + amount > settings.maxCreditBalance) {
      return c.json(
        {
          error: `That would take the balance past the ${settings.maxCreditBalance}-credit cap`,
          code: "balance_cap",
          limit: settings.maxCreditBalance,
          used: target.creditBalance,
        },
        400,
      );
    }
  }

  try {
    // Balance and ledger entry commit together; a removal past zero rolls both back.
    const [updated] = await db.batch([
      db
        .update(schema.users)
        .set({ creditBalance: sql`${schema.users.creditBalance} + ${amount}` })
        .where(eq(schema.users.id, id))
        .returning({ id: schema.users.id }),
      db.insert(schema.creditLedger).values({ userId: id, amount, reason: "admin_grant", note, actorId: adminUser.id }),
      db.insert(schema.adminEvents).values({
        actorId: adminUser.id,
        action: "credits.adjust",
        targetType: "user",
        targetId: id,
        summary: `${amount > 0 ? "Granted" : "Removed"} ${Math.abs(amount)} credits for ${target.email}`,
        detail: { amount, note, email: target.email },
      }),
    ]);
    if (updated.length === 0) return c.json({ error: "Not found" }, 404);
  } catch (error) {
    if (isCheckViolation(error)) {
      return c.json({ error: "That would take the balance below zero", code: "balance_negative" }, 400);
    }
    // The ledger's user foreign key fails for an unknown id.
    if ((error as { code?: string }).code === "23503") return c.json({ error: "Not found" }, 404);
    throw error;
  }

  return c.json({ user: await findAdminUser(db, id) });
});

const updateUserSchema = z
  .object({
    disabled: z.boolean().optional(),
    role: z.enum(["user", "analyst", "support", "billing", "admin"]).optional(),
    confirmEmail: z.string().trim().email().optional(),
    reason: z.string().trim().min(1).max(300).optional(),
    // 0 blocks the user outright; null clears the override so the global setting applies.
    dailyRenderLimitOverride: z.number().int().min(0).max(10_000).nullable().optional(),
    dailySegmentLimitOverride: z.number().int().min(0).max(10_000).nullable().optional(),
    monthlyRenderLimitOverride: z.number().int().min(0).max(100_000).nullable().optional(),
    monthlySegmentLimitOverride: z.number().int().min(0).max(100_000).nullable().optional(),
    limitsExempt: z.boolean().optional(),
  })
  .refine(
    (body) => Object.keys(body).some((key) => key !== "confirmEmail" && body[key as keyof typeof body] !== undefined),
    "Nothing to update",
  )
  .superRefine((body, ctx) => {
    if (body.role !== undefined && !body.confirmEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "confirmEmail is required when changing role",
        path: ["confirmEmail"],
      });
    }
    if ((body.role !== undefined || body.disabled !== undefined) && !body.reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A reason is required for account or role changes", path: ["reason"] });
    }
  });

/** Audit wording for each per-user override. */
const LIMIT_OVERRIDE_LABELS = [
  ["dailyRenderLimitOverride", "daily renders"],
  ["dailySegmentLimitOverride", "daily selections"],
  ["monthlyRenderLimitOverride", "monthly renders"],
  ["monthlySegmentLimitOverride", "monthly selections"],
] as const;

userDetailRoutes.patch("/users/:id", async (c) => {
  const denied = denyUnless(c, "users.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const body = updateUserSchema.parse(await c.req.json());
  const adminUser = c.get("admin");

  // Guard against an admin locking themselves (and possibly everyone) out. Only admins reach
  // this route, so any other role on their own account is a demotion.
  if (id === adminUser.id && (body.disabled === true || (body.role !== undefined && body.role !== "admin"))) {
    return c.json({ error: "You can't disable or demote your own account", code: "self_lockout" }, 400);
  }

  const before = await findAdminUser(db, id);
  if (!before) return c.json({ error: "Not found" }, 404);

  if (body.role !== undefined && body.role !== before.role) {
    const rules = await governance(db);
    if (rules.roleChangeApprovalThreshold > 0 && 1 >= rules.roleChangeApprovalThreshold) {
      const approval = await requestApproval(db, { action: "role_change", actorId: adminUser.id, targetType: "user", targetId: id, riskValue: 1, threshold: rules.roleChangeApprovalThreshold, reason: body.reason!, payload: { id, role: body.role, confirmEmail: body.confirmEmail } });
      return c.json({ pendingApproval: true, approvalId: approval.id }, 202);
    }
    const typed = body.confirmEmail?.trim().toLowerCase() ?? "";
    if (typed !== before.email.trim().toLowerCase()) {
      return c.json(
        { error: "Type the user's email exactly to confirm the role change", code: "confirm_email_mismatch" },
        400,
      );
    }
    if (body.role === "admin" && before.disabled) {
      return c.json(
        { error: "Enable the account before promoting them to admin", code: "disabled_user" },
        400,
      );
    }
    if (before.role === "admin" && body.role !== "admin") {
      const [adminCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.users)
        .where(and(eq(schema.users.role, "admin"), eq(schema.users.disabled, false)));
      if ((adminCount?.count ?? 0) <= 1) {
        return c.json(
          { error: "Can't demote the last active admin — promote someone else first", code: "last_admin" },
          400,
        );
      }
    }
  }

  const [updated] = await db
    .update(schema.users)
    .set({
      ...(body.disabled !== undefined ? { disabled: body.disabled } : {}),
      ...(body.role !== undefined ? { role: body.role } : {}),
      ...(body.limitsExempt !== undefined ? { limitsExempt: body.limitsExempt } : {}),
      ...(body.dailyRenderLimitOverride !== undefined ? { dailyRenderLimitOverride: body.dailyRenderLimitOverride } : {}),
      ...(body.dailySegmentLimitOverride !== undefined ? { dailySegmentLimitOverride: body.dailySegmentLimitOverride } : {}),
      ...(body.monthlyRenderLimitOverride !== undefined ? { monthlyRenderLimitOverride: body.monthlyRenderLimitOverride } : {}),
      ...(body.monthlySegmentLimitOverride !== undefined ? { monthlySegmentLimitOverride: body.monthlySegmentLimitOverride } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, id))
    .returning({ id: schema.users.id });
  if (!updated) return c.json({ error: "Not found" }, 404);

  // A disabled account is refused by the API already; revoking its sessions also signs it out of
  // the apps. Best effort: the disable has been saved, so a Clerk failure is recorded, not thrown.
  let sessionsRevoked: number | null = null;
  let sessionRevokeError: string | null = null;
  if (body.disabled === true && !before.disabled) {
    try { sessionsRevoked = await revokeActiveSessions(c.env.CLERK_SECRET_KEY, before.clerkId); }
    catch (error) { sessionRevokeError = error instanceof Error ? error.message : "Session revocation failed"; }
  }

  const user = await findAdminUser(db, id);
  const parts: string[] = [];
  if (body.disabled !== undefined && body.disabled !== before.disabled) {
    parts.push(body.disabled ? (sessionsRevoked !== null ? `disabled account, signed out ${sessionsRevoked} session(s)` : "disabled account") : "enabled account");
  }
  if (body.role !== undefined && body.role !== before.role) {
    parts.push(body.role === "admin" ? "promoted to admin" : `role changed from ${before.role} to ${body.role}`);
  }
  if (body.limitsExempt !== undefined && body.limitsExempt !== before.limitsExempt) {
    parts.push(body.limitsExempt ? "exempted from limits" : "limits re-applied");
  }
  for (const [key, label] of LIMIT_OVERRIDE_LABELS) {
    const next = body[key];
    if (next !== undefined && next !== before[key]) {
      parts.push(next === null ? `${label} override cleared` : `${label} override set to ${next}`);
    }
  }
  await recordAdminEvent(db, {
    actorId: adminUser.id,
    action: "user.update",
    targetType: "user",
    targetId: id,
    summary: `${before.email}: ${parts.join(", ") || "updated"}`,
    detail: {
      before: {
        role: before.role,
        disabled: before.disabled,
        limitsExempt: before.limitsExempt,
        dailyRenderLimitOverride: before.dailyRenderLimitOverride,
        dailySegmentLimitOverride: before.dailySegmentLimitOverride,
        monthlyRenderLimitOverride: before.monthlyRenderLimitOverride,
        monthlySegmentLimitOverride: before.monthlySegmentLimitOverride,
      },
      after: { role: body.role, disabled: body.disabled, limitsExempt: body.limitsExempt,
        dailyRenderLimitOverride: body.dailyRenderLimitOverride,
        dailySegmentLimitOverride: body.dailySegmentLimitOverride,
        monthlyRenderLimitOverride: body.monthlyRenderLimitOverride,
        monthlySegmentLimitOverride: body.monthlySegmentLimitOverride,
      },
      confirmEmail: body.confirmEmail ?? null,
      reason: body.reason ?? null,
      ...(sessionsRevoked !== null ? { sessionsRevoked } : {}),
      ...(sessionRevokeError ? { sessionRevokeError } : {}),
    },
  });

  return c.json({ user });
});
