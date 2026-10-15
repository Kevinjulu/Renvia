import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createDb, schema } from "@renvia/db";
import type { BetaInvitationAccepted, BetaInvitationPreview, BetaPendingInvitation } from "@renvia/types";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrCreateUser } from "../lib/users.js";
import { hashInvitationToken, invitationState, maskEmail, pendingInvitationsFor, redeemInvitation, type RedeemResult } from "../lib/betaEnrollment.js";

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

/** Invitations addressed to me (my account or my email), accepted in-app without the link. */
beta.get("/invitations", requireAuth, async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, c.get("auth").clerkId);
  const rows = await pendingInvitationsFor(db, user);
  const invitations: BetaPendingInvitation[] = rows.map(({ invitation, program }) => ({
    id: invitation.id,
    programName: program.name,
    programDescription: program.description,
    credits: invitation.creditsOverride ?? program.creditsPerTester,
    expiresAt: invitation.expiresAt.toISOString(),
    endsAt: program.endsAt.toISOString(),
  }));
  return c.json({ invitations });
});

beta.post("/invitations/:id/accept", requireAuth, async (c) => {
  const id = z.string().uuid().parse(c.req.param("id"));
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, c.get("auth").clerkId);
  if (user.disabled) return c.json({ error: "Account disabled", code: "account_disabled" }, 403);
  return redeemResponse(c, await redeemInvitation(db, user, { invitationId: id }));
});
