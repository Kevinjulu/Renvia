import { Hono, type Context } from "hono";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { createClerkClient } from "@clerk/backend";
import { schema, type Database } from "@renvia/db";
import {
  STUDIO_FEATURES,
  type AdminBetaEnrollment,
  type AdminBetaInvitation,
  type AdminBetaInvitationCreated,
  type AdminBetaProgram,
  type AdminBetaProgramDetailResponse,
  type AdminBetaProgramsResponse,
  type StudioFeatureKey,
} from "@renvia/types";
import type { Env } from "../../index.js";
import { effectiveEndsAt, expireBetaCredits, grantBetaCredits, programSpendMicros, type BetaProgramRow, type GrantResult } from "../../lib/beta.js";
import { completeProgramEnrollments, createInvitation, invitationState, programCapacity, type BetaInvitationRow } from "../../lib/betaEnrollment.js";
import { denyUnless } from "./permissions.js";
import { governance, requestApproval } from "./governance.js";
import { adminEventInsert, MICROS_PER_USD } from "./shared.js";
import type { AdminContext } from "./context.js";

/**
 * Beta Management (docs/beta-testing-system.md §5, §8): programs, invitations within capacity,
 * the tester lifecycle, credit grants and the program budget. Every change is audited as
 * beta.update; large grants and budget increases go through the approval queue.
 */
export const betaRoutes = new Hono<AdminContext>();

const DAY_MS = 24 * 60 * 60 * 1000;
/** Only this much is authorized when a program is created; more needs the audited budget action. */
const INITIAL_BUDGET_CAP_USD = 10;

const CHECK_VIOLATION = "23514";
function isCheckViolation(error: unknown): boolean {
  for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
    if ((current as { code?: string }).code === CHECK_VIOLATION) return true;
  }
  return false;
}

// ── Presentation ─────────────────────────────────────────────────────────────────

async function presentProgram(db: Database, program: BetaProgramRow): Promise<AdminBetaProgram> {
  const [capacity, spent, [granted]] = await Promise.all([
    programCapacity(db, program),
    programSpendMicros(db, program.id),
    db.select({ total: sql<number>`coalesce(sum(${schema.betaEnrollments.creditsGranted}), 0)::int` }).from(schema.betaEnrollments).where(eq(schema.betaEnrollments.programId, program.id)),
  ]);
  return {
    id: program.id,
    slug: program.slug,
    name: program.name,
    description: program.description,
    status: program.status,
    startsAt: program.startsAt.toISOString(),
    endsAt: program.endsAt.toISOString(),
    maxTesters: program.maxTesters,
    creditsPerTester: program.creditsPerTester,
    maxCreditsPerTester: program.maxCreditsPerTester,
    creditPool: program.creditPool,
    budgetUsd: Number(program.budgetUsd),
    budgetWarningPercent: program.budgetWarningPercent,
    dailyRenderLimit: program.dailyRenderLimit,
    monthlyRenderLimit: program.monthlyRenderLimit,
    concurrentRenderLimit: program.concurrentRenderLimit,
    featureGrants: program.featureGrants as StudioFeatureKey[],
    downloadsUnlocked: program.downloadsUnlocked,
    welcome: program.welcome ?? null,
    attachmentBudgetMb: program.attachmentBudgetMb,
    createdAt: program.createdAt.toISOString(),
    updatedAt: program.updatedAt.toISOString(),
    capacity,
    spentUsd: spent / MICROS_PER_USD,
    creditsGranted: Number(granted?.total ?? 0),
  };
}

async function enrollmentsOf(db: Database, program: BetaProgramRow): Promise<AdminBetaEnrollment[]> {
  const rows = await db
    .select({ enrollment: schema.betaEnrollments, email: schema.users.email, betaCredits: schema.users.betaCredits })
    .from(schema.betaEnrollments)
    .innerJoin(schema.users, eq(schema.users.id, schema.betaEnrollments.userId))
    .where(eq(schema.betaEnrollments.programId, program.id))
    .orderBy(desc(schema.betaEnrollments.enrolledAt))
    .limit(500);
  return rows.map(({ enrollment, email, betaCredits }) => {
    const live = enrollment.status === "active" || enrollment.status === "suspended";
    return {
      id: enrollment.id,
      programId: enrollment.programId,
      userId: enrollment.userId,
      email,
      status: enrollment.status,
      cohort: enrollment.cohort,
      profession: enrollment.profession,
      creditsGranted: enrollment.creditsGranted,
      betaCredits: live ? betaCredits : 0,
      endsAt: effectiveEndsAt(program, enrollment).toISOString(),
      endsAtOverride: enrollment.endsAt?.toISOString() ?? null,
      enrolledAt: enrollment.enrolledAt.toISOString(),
      endedAt: enrollment.endedAt?.toISOString() ?? null,
      endedReason: enrollment.endedReason,
      welcomeSeenAt: enrollment.welcomeSeenAt?.toISOString() ?? null,
      tourCompletedAt: enrollment.tourCompletedAt?.toISOString() ?? null,
    };
  });
}

async function presentInvitations(db: Database, invitations: BetaInvitationRow[]): Promise<AdminBetaInvitation[]> {
  const ids = [...new Set(invitations.flatMap((row) => [row.userId, row.createdBy]).filter((id): id is string => Boolean(id)))];
  const people = ids.length ? await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, ids)) : [];
  const emailById = new Map(people.map((person) => [person.id, person.email]));
  return invitations.map((row) => ({
    id: row.id,
    programId: row.programId,
    kind: row.kind,
    email: row.email,
    userId: row.userId,
    userEmail: row.userId ? emailById.get(row.userId) ?? null : null,
    maxRedemptions: row.maxRedemptions,
    redemptions: row.redemptions,
    creditsOverride: row.creditsOverride,
    cohort: row.cohort,
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    createdByEmail: row.createdBy ? emailById.get(row.createdBy) ?? null : null,
    state: invitationState(row),
  }));
}

async function findProgram(db: Database, id: string) {
  const [program] = await db.select().from(schema.betaPrograms).where(eq(schema.betaPrograms.id, id));
  return program ?? null;
}

// ── Programs ─────────────────────────────────────────────────────────────────────

const featureKey = z.enum(STUDIO_FEATURES.map((feature) => feature.key) as [StudioFeatureKey, ...StudioFeatureKey[]]);
const lines = z.array(z.string().trim().min(1).max(200)).max(10);
const welcomeSchema = z.object({ heading: z.string().trim().min(1).max(120), body: z.string().trim().max(2000), benefits: lines, expectations: lines }).strict();
const optionalLimit = (max: number) => z.number().int().min(1).max(max).nullable();

const settingsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000),
  maxTesters: z.number().int().min(1).max(1000),
  creditsPerTester: z.number().int().min(0).max(10_000),
  maxCreditsPerTester: z.number().int().min(0).max(100_000),
  creditPool: z.number().int().min(0).max(10_000_000).nullable(),
  budgetWarningPercent: z.number().int().min(1).max(99),
  dailyRenderLimit: optionalLimit(10_000),
  monthlyRenderLimit: optionalLimit(100_000),
  concurrentRenderLimit: optionalLimit(100),
  featureGrants: z.array(featureKey).max(STUDIO_FEATURES.length),
  downloadsUnlocked: z.boolean(),
  welcome: welcomeSchema.nullable(),
  attachmentBudgetMb: z.number().int().min(0).max(10_000),
});

const createProgramSchema = settingsSchema.partial().extend({
  slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/),
  name: z.string().trim().min(1).max(120),
  startsAt: z.coerce.date().optional(),
  /** First programs run 14–21 days; extensions later are unrestricted. */
  durationDays: z.number().int().min(14).max(21).default(21),
  budgetUsd: z.number().min(0).max(INITIAL_BUDGET_CAP_USD).multipleOf(0.01).default(INITIAL_BUDGET_CAP_USD),
  reason: z.string().trim().min(1).max(300),
});

betaRoutes.get("/beta/programs", async (c) => {
  const denied = denyUnless(c, "beta.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const rows = await db.select().from(schema.betaPrograms).orderBy(desc(schema.betaPrograms.createdAt)).limit(100);
  const response: AdminBetaProgramsResponse = { programs: await Promise.all(rows.map((row) => presentProgram(db, row))) };
  return c.json(response);
});

betaRoutes.get("/beta/programs/:id", async (c) => {
  const denied = denyUnless(c, "beta.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const program = await findProgram(db, z.string().uuid().parse(c.req.param("id")));
  if (!program) return c.json({ error: "Not found" }, 404);
  const invitations = await db.select().from(schema.betaInvitations).where(eq(schema.betaInvitations.programId, program.id)).orderBy(desc(schema.betaInvitations.createdAt)).limit(500);
  const response: AdminBetaProgramDetailResponse = {
    program: await presentProgram(db, program),
    enrollments: await enrollmentsOf(db, program),
    invitations: await presentInvitations(db, invitations),
  };
  return c.json(response);
});

betaRoutes.post("/beta/programs", async (c) => {
  const denied = denyUnless(c, "beta.programs.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const actor = c.get("admin");
  const { reason, durationDays, startsAt = new Date(), budgetUsd, ...settings } = createProgramSchema.parse(await c.req.json());
  const endsAt = new Date(startsAt.getTime() + durationDays * DAY_MS);
  const id = crypto.randomUUID();
  try {
    await db.batch([
      db.insert(schema.betaPrograms).values({ id, ...settings, budgetUsd: budgetUsd.toFixed(2), startsAt, endsAt, status: "draft", createdBy: actor.id }),
      adminEventInsert(db, {
        actorId: actor.id, action: "beta.update", targetType: "beta_program", targetId: id,
        summary: `Created beta program ${settings.name} ($${budgetUsd.toFixed(2)} budget, ${durationDays} days)`,
        detail: { reason, after: { ...settings, budgetUsd, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() } },
      }),
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505" || (error as { cause?: { code?: string } }).cause?.code === "23505") return c.json({ error: "A program with that slug already exists", code: "slug_taken" }, 409);
    if (isCheckViolation(error)) return c.json({ error: "Those settings are inconsistent (check the credit ceiling and dates)", code: "invalid_settings" }, 400);
    throw error;
  }
  return c.json(await presentProgram(db, (await findProgram(db, id))!), 201);
});

const updateProgramSchema = settingsSchema.partial().extend({
  /** Moves the whole program's end: an extension (or shortening) for every tester without their own date. */
  endsAt: z.coerce.date().optional(),
  reason: z.string().trim().min(1).max(300),
});

betaRoutes.patch("/beta/programs/:id", async (c) => {
  const denied = denyUnless(c, "beta.programs.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const actor = c.get("admin");
  const program = await findProgram(db, z.string().uuid().parse(c.req.param("id")));
  if (!program) return c.json({ error: "Not found" }, 404);
  const { reason, ...patch } = updateProgramSchema.parse(await c.req.json());
  if (program.status === "ended") return c.json({ error: "An ended program can't be changed", code: "program_ended" }, 409);
  if (patch.maxTesters !== undefined) {
    const capacity = await programCapacity(db, program);
    const occupied = capacity.active + capacity.suspended + capacity.pendingSlots;
    if (patch.maxTesters < occupied) {
      return c.json({ error: `${occupied} places are already taken or promised; revoke invitations or end enrollments first`, code: "below_occupied" }, 409);
    }
  }
  if (patch.endsAt && patch.endsAt <= program.startsAt) return c.json({ error: "The end must be after the start", code: "invalid_dates" }, 400);
  const before = Object.fromEntries(Object.keys(patch).map((key) => [key, program[key as keyof BetaProgramRow]]));
  try {
    await db.batch([
      db.update(schema.betaPrograms).set({ ...patch, updatedAt: new Date() }).where(eq(schema.betaPrograms.id, program.id)),
      adminEventInsert(db, {
        actorId: actor.id, action: "beta.update", targetType: "beta_program", targetId: program.id,
        summary: patch.endsAt ? `Moved ${program.name}'s end to ${patch.endsAt.toISOString().slice(0, 10)}` : `Updated ${program.name}`,
        detail: { reason, before, after: patch },
      }),
    ]);
  } catch (error) {
    if (isCheckViolation(error)) return c.json({ error: "Those settings are inconsistent (check the credit ceiling and dates)", code: "invalid_settings" }, 400);
    throw error;
  }
  return c.json(await presentProgram(db, (await findProgram(db, program.id))!));
});

const STATUS_FROM: Record<"active" | "paused" | "ended", BetaProgramRow["status"][]> = {
  active: ["draft", "paused"],
  paused: ["active"],
  ended: ["draft", "active", "paused"],
};

betaRoutes.post("/beta/programs/:id/status", async (c) => {
  const denied = denyUnless(c, "beta.programs.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const actor = c.get("admin");
  const id = z.string().uuid().parse(c.req.param("id"));
  const { status, reason } = z.object({ status: z.enum(["active", "paused", "ended"]), reason: z.string().trim().min(1).max(300) }).parse(await c.req.json());
  const program = await findProgram(db, id);
  if (!program) return c.json({ error: "Not found" }, 404);
  const [updated] = await db
    .update(schema.betaPrograms)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(schema.betaPrograms.id, id), inArray(schema.betaPrograms.status, STATUS_FROM[status])))
    .returning();
  if (!updated) return c.json({ error: `A ${program.status} program can't become ${status}`, code: "invalid_transition" }, 409);
  // Ending completes every tester and expires their beta credits; their own credits are untouched.
  const completed = status === "ended" ? await completeProgramEnrollments(db, id, "program_ended") : 0;
  await adminEventInsert(db, {
    actorId: actor.id, action: "beta.update", targetType: "beta_program", targetId: id,
    summary: `${status === "active" ? "Started" : status === "paused" ? "Paused" : "Ended"} ${program.name}${completed ? ` (${completed} testers completed)` : ""}`,
    detail: { reason, before: program.status, after: status, completed },
  });
  return c.json(await presentProgram(db, updated));
});

export interface BetaBudgetPayload {
  programId: string;
  budgetUsd: number;
  /** The budget the change was requested against; a different current budget refuses it. */
  expectedBudgetUsd: number;
  reason: string;
}

/** Sets a program's budget if it is still what the change was decided against. Never touches the global cap. */
export async function applyBetaBudget(db: Database, payload: BetaBudgetPayload, actorId: string, approvalId?: string) {
  const [updated] = await db
    .update(schema.betaPrograms)
    .set({ budgetUsd: payload.budgetUsd.toFixed(2), updatedAt: new Date() })
    .where(and(eq(schema.betaPrograms.id, payload.programId), eq(schema.betaPrograms.budgetUsd, payload.expectedBudgetUsd.toFixed(2))))
    .returning();
  if (!updated) return { ok: false as const, status: 409 as const, error: "The budget changed since this was requested; review it again", code: "budget_changed" };
  await adminEventInsert(db, {
    actorId, action: "beta.update", targetType: "beta_program", targetId: payload.programId,
    summary: `Changed ${updated.name}'s beta budget from $${payload.expectedBudgetUsd.toFixed(2)} to $${payload.budgetUsd.toFixed(2)}`,
    detail: { reason: payload.reason, before: payload.expectedBudgetUsd, after: payload.budgetUsd, ...(approvalId ? { approvalId } : {}) },
  });
  return { ok: true as const, program: updated };
}

/**
 * Raising a program's fal budget is the one way beta spend grows. An increase at or above the
 * governance money threshold (the refund threshold, in cents) waits for a second admin; a
 * decrease always applies at once. The global fal cap is never changed here.
 */
betaRoutes.post("/beta/programs/:id/budget", async (c) => {
  const denied = denyUnless(c, "beta.programs.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const actor = c.get("admin");
  const id = z.string().uuid().parse(c.req.param("id"));
  const { budgetUsd, reason } = z.object({ budgetUsd: z.number().min(0).max(10_000).multipleOf(0.01), reason: z.string().trim().min(1).max(300) }).parse(await c.req.json());
  const program = await findProgram(db, id);
  if (!program) return c.json({ error: "Not found" }, 404);
  if (program.status === "ended") return c.json({ error: "An ended program can't be changed", code: "program_ended" }, 409);
  const payload: BetaBudgetPayload = { programId: id, budgetUsd, expectedBudgetUsd: Number(program.budgetUsd), reason };
  const increaseCents = Math.round((budgetUsd - payload.expectedBudgetUsd) * 100);
  const rules = await governance(db);
  if (increaseCents > 0 && rules.refundApprovalThresholdCents > 0 && increaseCents >= rules.refundApprovalThresholdCents) {
    const approval = await requestApproval(db, { action: "beta_budget", actorId: actor.id, targetType: "beta_program", targetId: id, riskValue: increaseCents, threshold: rules.refundApprovalThresholdCents, reason, payload: { ...payload } });
    return c.json({ pendingApproval: true, approvalId: approval.id }, 202);
  }
  const outcome = await applyBetaBudget(db, payload, actor.id);
  if (!outcome.ok) return c.json({ error: outcome.error, code: outcome.code }, outcome.status);
  return c.json(await presentProgram(db, outcome.program));
});

// ── Invitations ──────────────────────────────────────────────────────────────────

const invitationCommon = {
  creditsOverride: z.number().int().min(0).max(10_000).nullable().optional(),
  cohort: z.string().trim().min(1).max(60).nullable().optional(),
  expiresInDays: z.number().int().min(1).max(60).default(14),
};
const createInvitationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("email"), email: z.string().trim().email().max(254), sendEmail: z.boolean().default(true), ...invitationCommon }),
  z.object({ kind: z.literal("existing_user"), userId: z.string().uuid(), ...invitationCommon }),
  z.object({ kind: z.literal("link"), maxRedemptions: z.number().int().min(1).max(100).default(1), ...invitationCommon }),
]);
type InvitationRequest = z.infer<typeof createInvitationSchema>;

type InvitationOutcome =
  | { ok: true; created: AdminBetaInvitationCreated }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string; code: string };

function joinLinks(env: Env, token: string) {
  const joinPath = `/beta/join?t=${encodeURIComponent(token)}`;
  const base = env.STUDIO_URL?.trim();
  return { joinPath, joinUrl: base ? new URL(joinPath, base).toString() : null };
}

/**
 * Creates one invitation. An email that already belongs to a Renvia account becomes an
 * existing-user invitation for that account, accepted in the Studio; only a new address gets a
 * Clerk invitation email, so nobody ends up with a second account.
 */
async function inviteOne(env: Env, db: Database, actor: { id: string }, canGrantExtra: boolean, program: BetaProgramRow, request: InvitationRequest): Promise<InvitationOutcome> {
  if (request.creditsOverride != null) {
    if (request.creditsOverride > program.maxCreditsPerTester) return { ok: false, status: 400, error: `At most ${program.maxCreditsPerTester} credits per tester in this program`, code: "tester_limit" };
    if (request.creditsOverride > program.creditsPerTester && !canGrantExtra) return { ok: false, status: 403, error: "Granting more than the program's welcome credits needs beta credit permission", code: "forbidden" };
  }
  let kind = request.kind;
  let userId = request.kind === "existing_user" ? request.userId : null;
  const email = request.kind === "email" ? request.email.toLowerCase() : null;
  if (email) {
    const [account] = await db.select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.email}) = ${email}`).limit(1);
    if (account) {
      kind = "existing_user";
      userId = account.id;
    }
  }
  if (userId) {
    const [account] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId));
    if (!account) return { ok: false, status: 404, error: "No such user", code: "not_found" };
    const [enrolled] = await db.select({ id: schema.betaEnrollments.id }).from(schema.betaEnrollments).where(and(eq(schema.betaEnrollments.programId, program.id), eq(schema.betaEnrollments.userId, userId)));
    if (enrolled) return { ok: false, status: 409, error: "That account is already in this program", code: "already_enrolled" };
  }
  if (kind !== "link") {
    const target = userId ? eq(schema.betaInvitations.userId, userId) : sql`lower(${schema.betaInvitations.email}) = ${email}`;
    const [open] = await db
      .select({ id: schema.betaInvitations.id })
      .from(schema.betaInvitations)
      .where(and(eq(schema.betaInvitations.programId, program.id), target, isNull(schema.betaInvitations.revokedAt), sql`${schema.betaInvitations.expiresAt} > now()`, sql`${schema.betaInvitations.redemptions} < ${schema.betaInvitations.maxRedemptions}`));
    if (open) return { ok: false, status: 409, error: "There is already an open invitation for them; revoke it to send a new one", code: "already_invited" };
  }

  const expiresAt = new Date(Math.min(Date.now() + request.expiresInDays * DAY_MS, program.endsAt.getTime()));
  const result = await createInvitation(db, {
    programId: program.id,
    kind,
    email: kind === "email" ? email : null,
    userId,
    maxRedemptions: request.kind === "link" ? request.maxRedemptions : 1,
    creditsOverride: request.creditsOverride ?? null,
    cohort: request.cohort ?? null,
    expiresAt,
    createdBy: actor.id,
  });
  if (!result.ok) {
    if (result.code === "program_full") return { ok: false, status: 409, error: "Every place in this program is taken or promised", code: "program_full" };
    if (result.code === "program_closed") return { ok: false, status: 409, error: "This program has ended", code: "program_closed" };
    return { ok: false, status: 404, error: "Not found", code: "not_found" };
  }
  const { joinPath, joinUrl } = joinLinks(env, result.token);

  let emailSent = false;
  if (kind === "email" && request.kind === "email" && request.sendEmail && joinUrl) {
    try {
      await createClerkClient({ secretKey: env.CLERK_SECRET_KEY }).invitations.createInvitation({ emailAddress: email!, redirectUrl: joinUrl, ignoreExisting: true, notify: true });
      emailSent = true;
    } catch (error) {
      // Clerk refuses addresses that already have an account; the link still works for them.
      console.error(JSON.stringify({ level: "warn", event: "beta.invitation_email_failed", invitationId: result.invitation.id, error: error instanceof Error ? error.message : String(error) }));
    }
  }
  await adminEventInsert(db, {
    actorId: actor.id, action: "beta.update", targetType: "beta_invitation", targetId: result.invitation.id,
    summary: `Invited ${email ?? (kind === "link" ? `anyone with a link (${result.invitation.maxRedemptions} places)` : "an existing account")} to ${program.name}`,
    detail: { programId: program.id, kind, requestedKind: request.kind, userId, emailSent, creditsOverride: request.creditsOverride ?? null },
  });
  const [invitation] = await presentInvitations(db, [result.invitation]);
  return { ok: true, created: { invitation: invitation!, token: result.token, joinPath, joinUrl, emailSent } };
}

betaRoutes.post("/beta/programs/:id/invitations", async (c) => {
  const denied = denyUnless(c, "beta.testers.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const program = await findProgram(db, z.string().uuid().parse(c.req.param("id")));
  if (!program) return c.json({ error: "Not found" }, 404);
  const request = createInvitationSchema.parse(await c.req.json());
  const outcome = await inviteOne(c.env, db, c.get("admin"), !denyUnless(c, "beta.credits.manage"), program, request);
  if (!outcome.ok) return c.json({ error: outcome.error, code: outcome.code }, outcome.status);
  return c.json(outcome.created, 201);
});

/** Many email invitations at once, one result per address; capacity stops it when the program fills. */
betaRoutes.post("/beta/programs/:id/invitations/bulk", async (c) => {
  const denied = denyUnless(c, "beta.testers.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const program = await findProgram(db, z.string().uuid().parse(c.req.param("id")));
  if (!program) return c.json({ error: "Not found" }, 404);
  const body = z
    .object({ emails: z.array(z.string().trim().email().max(254)).min(1).max(100), sendEmail: z.boolean().default(true), ...invitationCommon })
    .parse(await c.req.json());
  const canGrantExtra = !denyUnless(c, "beta.credits.manage");
  const results = [];
  for (const email of [...new Set(body.emails.map((address) => address.toLowerCase()))]) {
    const outcome = await inviteOne(c.env, db, c.get("admin"), canGrantExtra, program, { kind: "email", email, sendEmail: body.sendEmail, creditsOverride: body.creditsOverride, cohort: body.cohort, expiresInDays: body.expiresInDays });
    results.push(outcome.ok ? { email, ok: true, ...outcome.created } : { email, ok: false, error: outcome.error, code: outcome.code });
  }
  return c.json({ results });
});

betaRoutes.post("/beta/invitations/:id/revoke", async (c) => {
  const denied = denyUnless(c, "beta.testers.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const actor = c.get("admin");
  const id = z.string().uuid().parse(c.req.param("id"));
  const { reason } = z.object({ reason: z.string().trim().min(1).max(300) }).parse(await c.req.json());
  const [revoked] = await db
    .update(schema.betaInvitations)
    .set({ revokedAt: new Date(), revokedBy: actor.id })
    .where(and(eq(schema.betaInvitations.id, id), isNull(schema.betaInvitations.revokedAt)))
    .returning();
  if (!revoked) return c.json({ error: "No open invitation with that id", code: "not_found" }, 404);
  await adminEventInsert(db, { actorId: actor.id, action: "beta.update", targetType: "beta_invitation", targetId: id, summary: "Revoked a beta invitation", detail: { reason, programId: revoked.programId, unusedPlaces: revoked.maxRedemptions - revoked.redemptions } });
  const [invitation] = await presentInvitations(db, [revoked]);
  return c.json(invitation);
});

// ── Testers ──────────────────────────────────────────────────────────────────────

const ENROLLMENT_FROM: Record<"active" | "suspended" | "completed" | "revoked", ("active" | "suspended")[]> = {
  suspended: ["active"],
  active: ["suspended"],
  completed: ["active", "suspended"],
  revoked: ["active", "suspended"],
};

async function enrollmentWithProgram(db: Database, id: string) {
  const [row] = await db
    .select({ enrollment: schema.betaEnrollments, program: schema.betaPrograms, email: schema.users.email })
    .from(schema.betaEnrollments)
    .innerJoin(schema.betaPrograms, eq(schema.betaPrograms.id, schema.betaEnrollments.programId))
    .innerJoin(schema.users, eq(schema.users.id, schema.betaEnrollments.userId))
    .where(eq(schema.betaEnrollments.id, id));
  return row ?? null;
}

async function presentEnrollment(db: Database, id: string): Promise<AdminBetaEnrollment> {
  const row = (await enrollmentWithProgram(db, id))!;
  return (await enrollmentsOf(db, row.program)).find((enrollment) => enrollment.id === id)!;
}

/** Suspend (credits frozen), reactivate, or end (credits expire). The tester keeps everything else. */
betaRoutes.post("/beta/enrollments/:id/status", async (c) => {
  const denied = denyUnless(c, "beta.testers.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const actor = c.get("admin");
  const id = z.string().uuid().parse(c.req.param("id"));
  const { status, reason } = z.object({ status: z.enum(["active", "suspended", "completed", "revoked"]), reason: z.string().trim().min(1).max(300) }).parse(await c.req.json());
  const row = await enrollmentWithProgram(db, id);
  if (!row) return c.json({ error: "Not found" }, 404);
  if (status === "active" && row.program.status === "ended") return c.json({ error: "The program has ended", code: "program_ended" }, 409);
  const ending = status === "completed" || status === "revoked";
  const [updated] = await db
    .update(schema.betaEnrollments)
    .set({ status, updatedAt: new Date(), ...(ending ? { endedAt: new Date(), endedReason: status === "revoked" ? "revoked" : "completed" } : {}) })
    .where(and(eq(schema.betaEnrollments.id, id), inArray(schema.betaEnrollments.status, ENROLLMENT_FROM[status])))
    .returning();
  if (!updated) return c.json({ error: `A ${row.enrollment.status} tester can't become ${status}`, code: "invalid_transition" }, 409);
  const expired = ending ? await expireBetaCredits(db, updated.userId, id, { unlessLive: true }) : 0;
  const verb = { active: "Reactivated", suspended: "Suspended", completed: "Completed", revoked: "Revoked" }[status];
  await adminEventInsert(db, {
    actorId: actor.id, action: "beta.update", targetType: "beta_enrollment", targetId: id,
    summary: `${verb} ${row.email} in ${row.program.name}${expired ? ` (${expired} beta credits expired)` : ""}`,
    detail: { reason, before: row.enrollment.status, after: status, expiredCredits: expired },
  });
  return c.json(await presentEnrollment(db, id));
});

/** One tester's own end date; null returns them to the program's. Never changes credits or budget. */
betaRoutes.post("/beta/enrollments/:id/extend", async (c) => {
  const denied = denyUnless(c, "beta.testers.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const actor = c.get("admin");
  const id = z.string().uuid().parse(c.req.param("id"));
  const { endsAt, reason } = z.object({ endsAt: z.coerce.date().nullable(), reason: z.string().trim().min(1).max(300) }).parse(await c.req.json());
  const row = await enrollmentWithProgram(db, id);
  if (!row) return c.json({ error: "Not found" }, 404);
  if (endsAt && endsAt <= new Date()) return c.json({ error: "The new end must be in the future", code: "invalid_dates" }, 400);
  const [updated] = await db
    .update(schema.betaEnrollments)
    .set({ endsAt, updatedAt: new Date() })
    .where(and(eq(schema.betaEnrollments.id, id), inArray(schema.betaEnrollments.status, ["active", "suspended"])))
    .returning();
  if (!updated) return c.json({ error: "Only a current tester can be extended", code: "invalid_transition" }, 409);
  await adminEventInsert(db, {
    actorId: actor.id, action: "beta.update", targetType: "beta_enrollment", targetId: id,
    summary: endsAt ? `Extended ${row.email} to ${endsAt.toISOString().slice(0, 10)}` : `Returned ${row.email} to the program's end date`,
    detail: { reason, before: row.enrollment.endsAt?.toISOString() ?? null, after: endsAt?.toISOString() ?? null },
  });
  return c.json(await presentEnrollment(db, id));
});

export interface BetaGrantPayload {
  enrollmentIds: string[];
  amount: number;
  note: string;
  idempotencyKey: string;
}

/** Grants to each enrollment within the program's limits; a retry with the same key grants nothing twice. */
export async function applyBetaGrant(db: Database, payload: BetaGrantPayload, actorId: string, approvalId?: string) {
  const results: { enrollmentId: string; status: GrantResult["status"]; reason?: string }[] = [];
  for (const enrollmentId of payload.enrollmentIds) {
    const result = await grantBetaCredits(db, { enrollmentId, amount: payload.amount, note: payload.note, idempotencyKey: `${payload.idempotencyKey}:${enrollmentId}`, actorId });
    results.push(result.status === "refused" ? { enrollmentId, status: result.status, reason: result.reason } : { enrollmentId, status: result.status });
  }
  const granted = results.filter((result) => result.status === "granted").length;
  if (granted > 0) {
    await adminEventInsert(db, {
      actorId, action: "beta.update", targetType: "beta_enrollment", targetId: payload.enrollmentIds.length === 1 ? payload.enrollmentIds[0]! : null,
      summary: `Granted ${payload.amount} beta credits to ${granted} tester${granted === 1 ? "" : "s"}`,
      detail: { note: payload.note, amount: payload.amount, results, ...(approvalId ? { approvalId } : {}) },
    });
  }
  return results;
}

const grantSchema = z.object({ amount: z.number().int().min(1).max(1000), note: z.string().trim().min(1).max(200), idempotencyKey: z.string().uuid() });

/** Grants beta credits, with large amounts held for a second admin like any bulk credit grant. */
async function grantOrRequest(c: Context<AdminContext>, payload: BetaGrantPayload, targetId: string | null) {
  const db = c.get("db");
  const actor = c.get("admin");
  const rules = await governance(db);
  const riskValue = payload.amount * payload.enrollmentIds.length;
  if (rules.bulkCreditApprovalThreshold > 0 && riskValue >= rules.bulkCreditApprovalThreshold) {
    const approval = await requestApproval(db, { action: "beta_grant", actorId: actor.id, targetType: "beta_enrollment", targetId: targetId ?? undefined, riskValue, threshold: rules.bulkCreditApprovalThreshold, reason: payload.note, payload: { ...payload } });
    return c.json({ pendingApproval: true, approvalId: approval.id }, 202);
  }
  return c.json({ results: await applyBetaGrant(db, payload, actor.id) });
}

betaRoutes.post("/beta/enrollments/:id/grant", async (c) => {
  const denied = denyUnless(c, "beta.credits.manage"); if (denied) return c.json(denied, 403);
  const id = z.string().uuid().parse(c.req.param("id"));
  const body = grantSchema.parse(await c.req.json());
  if (!(await enrollmentWithProgram(c.get("db"), id))) return c.json({ error: "Not found" }, 404);
  return grantOrRequest(c, { ...body, enrollmentIds: [id] }, id);
});

betaRoutes.post("/beta/programs/:id/grant", async (c) => {
  const denied = denyUnless(c, "beta.credits.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const programId = z.string().uuid().parse(c.req.param("id"));
  const body = grantSchema.extend({ enrollmentIds: z.array(z.string().uuid()).min(1).max(100) }).parse(await c.req.json());
  const enrollmentIds = [...new Set(body.enrollmentIds)];
  const inProgram = await db
    .select({ id: schema.betaEnrollments.id })
    .from(schema.betaEnrollments)
    .where(and(eq(schema.betaEnrollments.programId, programId), inArray(schema.betaEnrollments.id, enrollmentIds), or(eq(schema.betaEnrollments.status, "active"), eq(schema.betaEnrollments.status, "suspended"))));
  if (inProgram.length !== enrollmentIds.length) return c.json({ error: "Every selected tester must be current in this program", code: "invalid_selection" }, 400);
  return grantOrRequest(c, { ...body, enrollmentIds }, null);
});
