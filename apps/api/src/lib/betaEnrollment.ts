import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { BetaInvitationState, BetaProgramCapacity } from "@renvia/types";
import { expireBetaCredits, grantBetaCredits, programEnrollmentLock, type BetaEnrollmentRow, type BetaProgramRow, type GrantResult } from "./beta.js";

/**
 * Invitations, capacity and redemption for beta programs (docs/beta-testing-system.md §5).
 * Redemption never creates accounts: the caller is already signed in through Clerk, and an
 * enrollment only ever links that existing user to a program.
 */

type UserRow = typeof schema.users.$inferSelect;
export type BetaInvitationRow = typeof schema.betaInvitations.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 (hex) of an invitation token: all the database ever holds. */
export async function hashInvitationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 32 random bytes: unguessable, so the link alone is the credential for a link invitation. */
export async function newInvitationToken(): Promise<{ token: string; hash: string }> {
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  return { token, hash: await hashInvitationToken(token) };
}

/** a•••@example.com: enough for someone to recognise their own address, not to learn another's. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}•••@${domain}`;
}

export function invitationState(invitation: Pick<BetaInvitationRow, "revokedAt" | "expiresAt" | "redemptions" | "maxRedemptions">, now = new Date()): BetaInvitationState {
  if (invitation.revokedAt) return "revoked";
  if (invitation.redemptions >= invitation.maxRedemptions) return "redeemed";
  if (invitation.expiresAt <= now) return "expired";
  return "pending";
}

/** Slots in use: live enrollments plus the unused redemptions of open invitations. */
function occupiedSql(programId: string) {
  return sql`(
    (select count(*) from beta_enrollments e where e.program_id = ${programId} and e.status in ('active', 'suspended'))
    + (select coalesce(sum(i.max_redemptions - i.redemptions), 0) from beta_invitations i
       where i.program_id = ${programId} and i.revoked_at is null and i.expires_at > now())
  )`;
}

export async function programCapacity(db: Database, program: Pick<BetaProgramRow, "id" | "maxTesters">): Promise<BetaProgramCapacity> {
  const result = await db.execute<{ active: number; suspended: number; pending: number }>(sql`
    select
      (select count(*) from beta_enrollments where program_id = ${program.id} and status = 'active')::int as active,
      (select count(*) from beta_enrollments where program_id = ${program.id} and status = 'suspended')::int as suspended,
      (select coalesce(sum(max_redemptions - redemptions), 0) from beta_invitations
        where program_id = ${program.id} and revoked_at is null and expires_at > now())::int as pending
  `);
  const row = result.rows[0] ?? { active: 0, suspended: 0, pending: 0 };
  const used = Number(row.active) + Number(row.suspended) + Number(row.pending);
  return { maxTesters: program.maxTesters, active: Number(row.active), suspended: Number(row.suspended), pendingSlots: Number(row.pending), free: Math.max(0, program.maxTesters - used) };
}

export interface NewInvitation {
  programId: string;
  kind: "email" | "link" | "existing_user";
  email?: string | null;
  userId?: string | null;
  maxRedemptions?: number;
  creditsOverride?: number | null;
  cohort?: string | null;
  expiresAt?: Date;
  createdBy: string | null;
}

export type CreateInvitationResult =
  | { ok: true; invitation: BetaInvitationRow; token: string }
  | { ok: false; code: "program_full" | "program_closed" | "not_found" };

/**
 * Creates an invitation only while its redemptions fit in the program's free slots, so pending
 * invitations can never promise more places than the program has. The capacity check and insert
 * are one statement behind the program's enrollment lock.
 */
export async function createInvitation(db: Database, input: NewInvitation): Promise<CreateInvitationResult> {
  const { token, hash } = await newInvitationToken();
  const id = crypto.randomUUID();
  const maxRedemptions = input.kind === "link" ? (input.maxRedemptions ?? 1) : 1;
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 14 * DAY_MS);
  const [, result] = await db.batch([
    programEnrollmentLock(db, input.programId),
    db.execute<{ created: boolean; status: string | null }>(sql`
      with prog as (select id, status, max_testers, ends_at from beta_programs where id = ${input.programId}),
      inserted as (
        insert into beta_invitations (id, program_id, kind, email, user_id, token_hash, max_redemptions, credits_override, cohort, expires_at, created_by)
        select ${id}::uuid, prog.id, ${input.kind}::text, ${input.email?.trim().toLowerCase() ?? null}::text, ${input.userId ?? null}::uuid, ${hash}::text,
          ${maxRedemptions}::int, ${input.creditsOverride ?? null}::int, ${input.cohort ?? null}::text, ${expiresAt.toISOString()}::timestamptz, ${input.createdBy}::uuid
        from prog
        where prog.status <> 'ended' and prog.ends_at > now() and ${occupiedSql(input.programId)} + ${maxRedemptions} <= prog.max_testers
        returning id
      )
      select exists (select 1 from inserted) as created, (select status from prog) as status
    `),
  ]);
  const row = result.rows[0];
  if (!row?.status) return { ok: false, code: "not_found" };
  if (!row.created) return { ok: false, code: row.status === "ended" ? "program_closed" : "program_full" };
  const [invitation] = await db.select().from(schema.betaInvitations).where(eq(schema.betaInvitations.id, id));
  return { ok: true, invitation: invitation!, token };
}

export type RedeemFailure =
  | "invite_not_found"
  | "invite_revoked"
  | "invite_expired"
  | "invite_used"
  | "invite_wrong_account"
  | "program_closed"
  | "program_full"
  | "already_in_program"
  | "enrolled_before";

export type RedeemResult =
  | { ok: true; enrollment: BetaEnrollmentRow; program: BetaProgramRow; alreadyEnrolled: boolean; grant: GrantResult | null }
  | { ok: false; code: RedeemFailure; invitedEmail?: string };

/** Why this user can't redeem this invitation now, or null when they can. */
function redeemProblem(invitation: BetaInvitationRow, program: BetaProgramRow, user: UserRow, now: Date): Exclude<RedeemFailure, "already_in_program" | "enrolled_before" | "program_full"> | null {
  if (invitation.kind === "email" && invitation.email?.toLowerCase() !== user.email.toLowerCase()) return "invite_wrong_account";
  if (invitation.kind === "existing_user" && invitation.userId !== user.id) return "invite_wrong_account";
  if (invitation.revokedAt) return "invite_revoked";
  if (invitation.expiresAt <= now) return "invite_expired";
  if (invitation.redemptions >= invitation.maxRedemptions) return "invite_used";
  if (program.status !== "active" || program.endsAt <= now) return "program_closed";
  return null;
}

/** Grants an enrollment's welcome credits; keyed by enrollment, so a retried accept never doubles them. */
async function welcomeGrant(db: Database, enrollment: BetaEnrollmentRow, program: BetaProgramRow, invitation: BetaInvitationRow | null): Promise<GrantResult | null> {
  const amount = invitation?.creditsOverride ?? program.creditsPerTester;
  if (amount <= 0) return null;
  return grantBetaCredits(db, { enrollmentId: enrollment.id, amount, note: `Welcome to ${program.name}`, idempotencyKey: `enroll:${enrollment.id}` });
}

/**
 * Enrolls the signed-in user through an invitation, found by its token (any kind) or, for one
 * addressed to them, by id. The enrollment is inserted in one statement behind the program's lock,
 * only while the invitation is still open, the program is running and has room, and the user has
 * no other live enrollment; the redemption count moves with it. The welcome credits follow.
 */
export async function redeemInvitation(db: Database, user: UserRow, by: { tokenHash: string } | { invitationId: string }, now = new Date()): Promise<RedeemResult> {
  const [found] = await db
    .select({ invitation: schema.betaInvitations, program: schema.betaPrograms })
    .from(schema.betaInvitations)
    .innerJoin(schema.betaPrograms, eq(schema.betaPrograms.id, schema.betaInvitations.programId))
    .where("tokenHash" in by ? eq(schema.betaInvitations.tokenHash, by.tokenHash) : eq(schema.betaInvitations.id, by.invitationId));
  // By id, only invitations addressed to this user exist as far as they can tell.
  if (!found || ("invitationId" in by && found.invitation.kind === "link")) return { ok: false, code: "invite_not_found" };
  const { invitation, program } = found;
  if ("invitationId" in by && redeemProblem(invitation, program, user, now) === "invite_wrong_account") return { ok: false, code: "invite_not_found" };

  // Already in: through this invitation or this program, it's the same enrollment (a retry).
  const [mine] = await db
    .select()
    .from(schema.betaEnrollments)
    .where(and(eq(schema.betaEnrollments.userId, user.id), eq(schema.betaEnrollments.programId, program.id)));
  if (mine && (mine.status === "active" || mine.status === "suspended")) {
    return { ok: true, enrollment: mine, program, alreadyEnrolled: true, grant: await welcomeGrant(db, mine, program, mine.invitationId === invitation.id ? invitation : null) };
  }
  if (mine) return { ok: false, code: "enrolled_before" };

  const problem = redeemProblem(invitation, program, user, now);
  if (problem) return { ok: false, code: problem, ...(problem === "invite_wrong_account" && invitation.email ? { invitedEmail: maskEmail(invitation.email) } : {}) };
  const [elsewhere] = await db
    .select({ id: schema.betaEnrollments.id })
    .from(schema.betaEnrollments)
    .where(and(eq(schema.betaEnrollments.userId, user.id), inArray(schema.betaEnrollments.status, ["active", "suspended"])));
  if (elsewhere) return { ok: false, code: "already_in_program" };

  const [, result] = await db.batch([
    programEnrollmentLock(db, program.id),
    db.execute<{ enrollment_id: string | null }>(sql`
      with inv as (
        select i.id, i.program_id, i.cohort from beta_invitations i
        where i.id = ${invitation.id} and i.revoked_at is null and i.expires_at > now() and i.redemptions < i.max_redemptions
        for update
      ),
      prog as (
        select p.id, p.max_testers from beta_programs p join inv on p.id = inv.program_id
        where p.status = 'active' and p.ends_at > now()
      ),
      inserted as (
        insert into beta_enrollments (program_id, user_id, invitation_id, cohort)
        select prog.id, ${user.id}::uuid, inv.id, inv.cohort
        from inv join prog on true
        -- The invitation's own slot is already counted, so a full program still admits it.
        where ${occupiedSql(program.id)} <= prog.max_testers
          and not exists (select 1 from beta_enrollments e where e.user_id = ${user.id} and e.status in ('active', 'suspended'))
        on conflict do nothing
        returning id, invitation_id
      ),
      redeemed as (
        update beta_invitations set redemptions = redemptions + 1 where id in (select invitation_id from inserted) returning id
      )
      select (select id from inserted) as enrollment_id
    `),
  ]);
  const enrollmentId = result.rows[0]?.enrollment_id;
  if (!enrollmentId) {
    // Something changed between the checks and the insert: report what it was.
    const [current] = await db.select().from(schema.betaInvitations).where(eq(schema.betaInvitations.id, invitation.id));
    const [currentProgram] = await db.select().from(schema.betaPrograms).where(eq(schema.betaPrograms.id, program.id));
    const raced = current && currentProgram ? redeemProblem(current, currentProgram, user, new Date()) : "invite_not_found";
    return { ok: false, code: raced ?? "program_full" };
  }
  const [enrollment] = await db.select().from(schema.betaEnrollments).where(eq(schema.betaEnrollments.id, enrollmentId));
  return { ok: true, enrollment: enrollment!, program, alreadyEnrolled: false, grant: await welcomeGrant(db, enrollment!, program, invitation) };
}

/** Open invitations addressed to this user: bound to their account, or to their email address. */
export async function pendingInvitationsFor(db: Database, user: UserRow) {
  return db
    .select({ invitation: schema.betaInvitations, program: schema.betaPrograms })
    .from(schema.betaInvitations)
    .innerJoin(schema.betaPrograms, eq(schema.betaPrograms.id, schema.betaInvitations.programId))
    .where(sql`(${schema.betaInvitations.userId} = ${user.id} or lower(${schema.betaInvitations.email}) = lower(${user.email}))
      and ${schema.betaInvitations.revokedAt} is null and ${schema.betaInvitations.expiresAt} > now()
      and ${schema.betaInvitations.redemptions} < ${schema.betaInvitations.maxRedemptions}
      and ${schema.betaPrograms.status} = 'active' and ${schema.betaPrograms.endsAt} > now()
      and not exists (select 1 from beta_enrollments e where e.user_id = ${user.id} and e.program_id = ${schema.betaPrograms.id})`);
}

/**
 * Ends every live enrollment of a program (it ended) and expires their beta credits. Each user's
 * expiry is its own single statement; a crash part-way leaves the rest to the lazy settle on /me.
 */
export async function completeProgramEnrollments(db: Database, programId: string, reason: string): Promise<number> {
  const ended = await db
    .update(schema.betaEnrollments)
    .set({ status: "completed", endedAt: new Date(), endedReason: reason, updatedAt: new Date() })
    .where(and(eq(schema.betaEnrollments.programId, programId), inArray(schema.betaEnrollments.status, ["active", "suspended"])))
    .returning({ id: schema.betaEnrollments.id, userId: schema.betaEnrollments.userId });
  for (const row of ended) await expireBetaCredits(db, row.userId, row.id, { unlessLive: true });
  return ended.length;
}
