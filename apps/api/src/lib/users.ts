import { createClerkClient } from "@clerk/backend";
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { Env } from "../index.js";
import { ensureEntitlement, getBillingEntitlement } from "./billing.js";
import { normalizeEmail, reassessOnVerifiedEmail } from "./freeAllowance.js";
import { recordSecurityLinks, type HashedSignals } from "./securitySignals.js";
import { ensureCreditPeriod } from "./planCredits.js";

type UserRow = typeof schema.users.$inferSelect;

/** The account's email from Clerk, and whether Clerk has verified it. */
async function fetchClerkEmail(env: Env, clerkId: string): Promise<{ email: string; verified: boolean }> {
  const user = await createClerkClient({ secretKey: env.CLERK_SECRET_KEY }).users.getUser(clerkId);
  const address = user.primaryEmailAddress ?? user.emailAddresses[0];
  if (!address?.emailAddress) throw new Error(`Clerk user ${clerkId} has no email address`);
  return { email: address.emailAddress, verified: address.verification?.status === "verified" };
}

/**
 * Starts the user's monthly credit period when one is due (the first at signup, then each
 * signup anniversary) and returns the row with the resulting balance. With `emailNewlyVerified`,
 * a Free allowance held only for an unverified email is assessed again first.
 */
async function withCurrentCredits(db: Database, user: UserRow, emailNewlyVerified = false): Promise<UserRow> {
  let billing = await ensureEntitlement(db, user.id);
  if (emailNewlyVerified && (await reassessOnVerifiedEmail(db, user.id, billing.entitlement))) {
    billing = (await getBillingEntitlement(db, user.id)) ?? billing;
  }
  if (!(await ensureCreditPeriod(db, user.id, user.createdAt, billing))) return user;
  const [fresh] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  return fresh ? { ...fresh, lastActiveAt: user.lastActiveAt } : user;
}

/**
 * Creates or refreshes the user's row from Clerk. An upsert, so concurrent first requests
 * can't race into a unique-key violation, and email changes made in Clerk are picked up (with
 * their normalized form and verification, which the Free-allowance rules read). A new account
 * starts at 0 and receives its plan's monthly allowance as its first credit period, once it is
 * eligible for it; if that step fails, the next request (or the daily renewal) starts it.
 */
export async function syncUser(env: Env, db: Database, clerkId: string, signals: HashedSignals | null = null): Promise<UserRow> {
  const { email, verified } = await fetchClerkEmail(env, clerkId);
  const emailNormalized = normalizeEmail(email);
  const [row] = await db
    .insert(schema.users)
    .values({ clerkId, email, emailNormalized, emailVerified: verified })
    .onConflictDoUpdate({ target: schema.users.clerkId, set: { email, emailNormalized, emailVerified: verified, updatedAt: sql`now()` } })
    // A subquery in RETURNING reads the table as it was before this statement: the old flag.
    .returning({ ...getTableColumns(schema.users), wasVerified: sql<boolean | null>`(select u.email_verified from users u where u.clerk_id = ${clerkId})` });
  if (!row) throw new Error("Failed to sync user");
  const { wasVerified, ...user } = row;
  // Browser and network evidence goes in before any credit period starts, so a new account's
  // first assessment can see it. A failure here never blocks the account.
  if (signals) await recordSecurityLinks(db, user.id, signals).catch((error: unknown) => console.error("security links not recorded", error));
  return withCurrentCredits(db, user, verified && wasVerified === false);
}

/** The user's row; only calls Clerk the first time a user is seen. */
export async function getOrCreateUser(env: Env, db: Database, clerkId: string): Promise<UserRow> {
  const existing = await db.query.users.findFirst({ where: eq(schema.users.clerkId, clerkId) });
  if (!existing) return syncUser(env, db, clerkId);
  // Every authenticated Studio/API visit counts as activity, but no more than one
  // database write per five minutes per user (admin polling remains cheap).
  await db
    .update(schema.users)
    .set({ lastActiveAt: sql`now()` })
    .where(and(eq(schema.users.id, existing.id), sql`(${schema.users.lastActiveAt} is null or ${schema.users.lastActiveAt} < now() - interval '5 minutes')`));
  return withCurrentCredits(db, { ...existing, lastActiveAt: new Date() });
}

export async function getOrCreateUserId(env: Env, db: Database, clerkId: string): Promise<string> {
  return (await getOrCreateUser(env, db, clerkId)).id;
}
