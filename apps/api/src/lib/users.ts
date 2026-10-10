import { createClerkClient } from "@clerk/backend";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { Env } from "../index.js";
import { ensureEntitlement } from "./billing.js";
import { ensureCreditPeriod } from "./planCredits.js";

type UserRow = typeof schema.users.$inferSelect;

async function fetchClerkEmail(env: Env, clerkId: string): Promise<string> {
  const user = await createClerkClient({ secretKey: env.CLERK_SECRET_KEY }).users.getUser(clerkId);
  const email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
  if (!email) throw new Error(`Clerk user ${clerkId} has no email address`);
  return email;
}

/**
 * Starts the user's monthly credit period when one is due (the first at signup, then each
 * signup anniversary) and returns the row with the resulting balance.
 */
async function withCurrentCredits(db: Database, user: UserRow): Promise<UserRow> {
  const billing = await ensureEntitlement(db, user.id);
  if (!(await ensureCreditPeriod(db, user.id, user.createdAt, billing))) return user;
  const [fresh] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  return fresh ? { ...fresh, lastActiveAt: user.lastActiveAt } : user;
}

/**
 * Creates or refreshes the user's row from Clerk. An upsert, so concurrent first requests
 * can't race into a unique-key violation, and email changes made in Clerk are picked up.
 * A new account starts at 0 and receives its plan's monthly allowance as its first credit
 * period; if that step fails, the next request (or the daily renewal) starts it.
 */
export async function syncUser(env: Env, db: Database, clerkId: string): Promise<UserRow> {
  const email = await fetchClerkEmail(env, clerkId);
  const [user] = await db
    .insert(schema.users)
    .values({ clerkId, email })
    .onConflictDoUpdate({ target: schema.users.clerkId, set: { email, updatedAt: sql`now()` } })
    .returning();
  if (!user) throw new Error("Failed to sync user");
  return withCurrentCredits(db, user);
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
