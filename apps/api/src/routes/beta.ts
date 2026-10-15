import { Hono, type Context } from "hono";
import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { createDb, schema } from "@renvia/db";
import type { BetaAnnouncement, BetaInvitationAccepted, BetaInvitationPreview, BetaMeResponse, BetaPendingInvitation, BetaTester, StudioFeatureKey } from "@renvia/types";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrCreateUser } from "../lib/users.js";
import { hashInvitationToken, invitationState, maskEmail, pendingInvitationsFor, redeemInvitation, type RedeemResult } from "../lib/betaEnrollment.js";
import { settleBetaCredits, type BetaContext } from "../lib/beta.js";
import { completeManualMission, missionsFor } from "../lib/betaMissions.js";
import { unreadRepliesFor } from "./betaFeedback.js";
import type { Database } from "@renvia/db";

/**
 * The tester side of beta invitations: preview a link, list invitations addressed to me, accept.
 * Program state (credits, missions, feedback) comes in later stages.
 */
export const beta = new Hono<AppContext>();

const tokenSchema = z.string().trim().min(20).max(200);

/** Shown on the join page, before sign-in: which program, and whether the link still works. */
beta.get("/invitations/preview", async (c) => {
  const token = tokenSchema.safeParse(c.req.query("t"));
  if (!token.success) return c.json({ error: "Invitation not found", code: "invite_not_found" }, 404);
  const db = createDb(c.env.DATABASE_URL);
  const [found] = await db
    .select({ invitation: schema.betaInvitations, program: schema.betaPrograms })
    .from(schema.betaInvitations)
    .innerJoin(schema.betaPrograms, eq(schema.betaPrograms.id, schema.betaInvitations.programId))
    .where(eq(schema.betaInvitations.tokenHash, await hashInvitationToken(token.data)));
  if (!found) return c.json({ error: "Invitation not found", code: "invite_not_found" }, 404);
  const { invitation, program } = found;
  const closed = program.status !== "active" || program.endsAt <= new Date();
  const preview: BetaInvitationPreview = {
    programName: program.name,
    programDescription: program.description,
    kind: invitation.kind,
    state: closed ? "closed" : invitationState(invitation),
    invitedEmail: invitation.email ? maskEmail(invitation.email) : null,
    credits: invitation.creditsOverride ?? program.creditsPerTester,
    endsAt: program.endsAt.toISOString(),
  };
  return c.json(preview);
});

const REDEEM_STATUS: Record<Exclude<RedeemResult, { ok: true }>["code"], 403 | 404 | 409 | 410> = {
  invite_not_found: 404,
  invite_revoked: 410,
  invite_expired: 410,
  invite_used: 410,
  invite_wrong_account: 403,
  program_closed: 410,
  program_full: 409,
  already_in_program: 409,
  enrolled_before: 409,
};

const REDEEM_MESSAGE: Record<keyof typeof REDEEM_STATUS, string> = {
  invite_not_found: "This invitation link isn't valid.",
  invite_revoked: "This invitation has been withdrawn.",
  invite_expired: "This invitation has expired.",
  invite_used: "This invitation has already been used.",
  invite_wrong_account: "This invitation is for a different account.",
  program_closed: "This beta program isn't accepting testers right now.",
  program_full: "This beta program is full.",
  already_in_program: "You're already part of another beta program.",
  enrolled_before: "You've already taken part in this beta program.",
};

function redeemResponse(c: Context<AppContext>, result: RedeemResult) {
  if (!result.ok) {
    return c.json({ error: REDEEM_MESSAGE[result.code], code: result.code, ...(result.invitedEmail ? { invitedEmail: result.invitedEmail } : {}) }, REDEEM_STATUS[result.code]);
  }
  const accepted: BetaInvitationAccepted = {
    enrollmentId: result.enrollment.id,
    programId: result.program.id,
    programName: result.program.name,
    creditsGranted: result.grant && result.grant.status !== "refused" ? result.grant.amount : 0,
    alreadyEnrolled: result.alreadyEnrolled,
  };
  return c.json(accepted, result.alreadyEnrolled ? 200 : 201);
}

beta.post("/invitations/accept", requireAuth, async (c) => {
  const { token } = z.object({ token: tokenSchema }).parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, c.get("auth").clerkId);
  if (user.disabled) return c.json({ error: "Account disabled", code: "account_disabled" }, 403);
  return redeemResponse(c, await redeemInvitation(db, user, { tokenHash: await hashInvitationToken(token) }));
});

type UserRow = typeof schema.users.$inferSelect;

async function pendingFor(db: Database, user: UserRow): Promise<BetaPendingInvitation[]> {
  const rows = await pendingInvitationsFor(db, user);
  return rows.map(({ invitation, program }) => ({
    id: invitation.id,
    programName: program.name,
    programDescription: program.description,
    credits: invitation.creditsOverride ?? program.creditsPerTester,
    expiresAt: invitation.expiresAt.toISOString(),
    endsAt: program.endsAt.toISOString(),
    downloadsUnlocked: program.downloadsUnlocked,
    featureGrants: program.featureGrants as StudioFeatureKey[],
    invitedAt: invitation.createdAt.toISOString(),
  }));
}

/** Invitations addressed to me (my account or my email), accepted in-app without the link. */
beta.get("/invitations", requireAuth, async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, c.get("auth").clerkId);
  return c.json({ invitations: await pendingFor(db, user) });
});

/** Published announcements that haven't expired, newest first. */
async function announcementsFor(db: Database, context: BetaContext): Promise<BetaAnnouncement[]> {
  const now = new Date();
  const rows = await db
    .select()
    .from(schema.betaAnnouncements)
    .where(and(
      eq(schema.betaAnnouncements.programId, context.program.id),
      lte(schema.betaAnnouncements.publishedAt, now),
      or(isNull(schema.betaAnnouncements.expiresAt), gt(schema.betaAnnouncements.expiresAt, now)),
    ))
    .orderBy(desc(schema.betaAnnouncements.publishedAt))
    .limit(20);
  const seenAt = context.enrollment.announcementsSeenAt;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    severity: row.severity,
    publishedAt: row.publishedAt.toISOString(),
    unread: !seenAt || row.publishedAt > seenAt,
  }));
}

async function presentTester(db: Database, user: UserRow, context: BetaContext): Promise<BetaTester> {
  const { program, enrollment } = context;
  const [missions, announcements, unreadReplies] = await Promise.all([missionsFor(db, enrollment), announcementsFor(db, context), unreadRepliesFor(db, user.id, enrollment.repliesSeenAt)]);
  return {
    enrollmentId: enrollment.id,
    status: enrollment.status === "suspended" ? "suspended" : "active",
    running: context.running,
    program: {
      id: program.id,
      name: program.name,
      description: program.description,
      status: program.status,
      welcome: program.welcome ?? null,
      downloadsUnlocked: program.downloadsUnlocked,
      featureGrants: program.featureGrants as StudioFeatureKey[],
    },
    enrolledAt: enrollment.enrolledAt.toISOString(),
    endsAt: context.endsAt.toISOString(),
    credits: { remaining: user.betaCredits, granted: enrollment.creditsGranted },
    welcomeSeenAt: enrollment.welcomeSeenAt?.toISOString() ?? null,
    tourCompletedAt: enrollment.tourCompletedAt?.toISOString() ?? null,
    missions,
    announcements,
    unreadAnnouncements: announcements.filter((announcement) => announcement.unread).length,
    unreadReplies,
  };
}

/** The Beta Program area: the tester's program, credits, missions and announcements, or invitations waiting for them. */
beta.get("/me", requireAuth, async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const clerkId = c.get("auth").clerkId;
  let user = await getOrCreateUser(c.env, db, clerkId);
  const { context, expired } = await settleBetaCredits(db, user.id, { betaCredits: user.betaCredits });
  if (expired > 0) user = await getOrCreateUser(c.env, db, clerkId);
  const response: BetaMeResponse = context
    ? { tester: await presentTester(db, user, context), invitations: [] }
    : { tester: null, invitations: await pendingFor(db, user) };
  return c.json(response);
});

/** Records a one-time onboarding moment on the tester's live enrollment, so it holds across devices. */
async function markSeen(c: Context<AppContext>, column: "welcomeSeenAt" | "tourCompletedAt" | "announcementsSeenAt" | "repliesSeenAt") {
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, c.get("auth").clerkId);
  const target = schema.betaEnrollments[column];
  const updated = await db
    .update(schema.betaEnrollments)
    // Welcome and tour keep their first time; announcements and replies move forward each time they are read.
    .set({ [column]: column === "announcementsSeenAt" || column === "repliesSeenAt" ? new Date() : sql`coalesce(${target}, now())`, updatedAt: new Date() })
    .where(and(eq(schema.betaEnrollments.userId, user.id), inArray(schema.betaEnrollments.status, ["active", "suspended"])))
    .returning({ id: schema.betaEnrollments.id });
  if (updated.length === 0) return c.json({ error: "You're not in a beta program", code: "not_enrolled" }, 404);
  return c.json({ ok: true });
}

beta.post("/me/welcome-seen", requireAuth, (c) => markSeen(c, "welcomeSeenAt"));
beta.post("/me/tour-complete", requireAuth, (c) => markSeen(c, "tourCompletedAt"));
beta.post("/me/announcements-seen", requireAuth, (c) => markSeen(c, "announcementsSeenAt"));
beta.post("/me/replies-seen", requireAuth, (c) => markSeen(c, "repliesSeenAt"));

beta.post("/missions/:id/complete", requireAuth, async (c) => {
  const id = z.string().uuid().parse(c.req.param("id"));
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, c.get("auth").clerkId);
  const { context } = await settleBetaCredits(db, user.id, { betaCredits: user.betaCredits });
  if (!context) return c.json({ error: "You're not in a beta program", code: "not_enrolled" }, 404);
  const outcome = await completeManualMission(db, context.enrollment, id);
  if (outcome === "not_found") return c.json({ error: "Not found", code: "not_found" }, 404);
  if (outcome === "verified_only") return c.json({ error: "This mission completes itself once you've done it", code: "verified_only" }, 409);
  return c.json({ missions: await missionsFor(db, context.enrollment) });
});

beta.post("/invitations/:id/accept", requireAuth, async (c) => {
  const id = z.string().uuid().parse(c.req.param("id"));
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, c.get("auth").clerkId);
  if (user.disabled) return c.json({ error: "Account disabled", code: "account_disabled" }, 403);
  return redeemResponse(c, await redeemInvitation(db, user, { invitationId: id }));
});
