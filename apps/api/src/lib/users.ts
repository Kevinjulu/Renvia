import { createClerkClient } from "@clerk/backend";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { Env } from "../index.js";
import { SIGNUP_BONUS_CREDITS } from "./credits.js";

type UserRow = typeof schema.users.$inferSelect;

async function fetchClerkEmail(env: Env, clerkId: string): Promise<string> {
  const user = await createClerkClient({ secretKey: env.CLERK_SECRET_KEY }).users.getUser(clerkId);
  const email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
  if (!email) throw new Error(`Clerk user ${clerkId} has no email address`);
  return email;
}

/**
 * Creates or refreshes the user's row from Clerk. An upsert, so concurrent first requests
 * can't race into a unique-key violation, and email changes made in Clerk are picked up.
 * A brand-new row starts with the signup bonus, recorded in the ledger.
 */
export async function syncUser(env: Env, db: Database, clerkId: string): Promise<UserRow> {
  const email = await fetchClerkEmail(env, clerkId);
  const [result] = await db
    .insert(schema.users)
    .values({ clerkId, email, creditBalance: SIGNUP_BONUS_CREDITS })
    .onConflictDoUpdate({ target: schema.users.clerkId, set: { email, updatedAt: sql`now()` } })
    // xmax is 0 only for a freshly inserted row, not one the conflict clause updated.
    .returning({ ...getTableColumns(schema.users), inserted: sql<boolean>`(xmax = 0)` });
  if (!result) throw new Error("Failed to sync user");

  const { inserted, ...user } = result;
  if (inserted) {
    await db.insert(schema.creditLedger).values({ userId: user.id, amount: SIGNUP_BONUS_CREDITS, reason: "signup_bonus" });
  }
  return user;
}

/** The user's row; only calls Clerk the first time a user is seen. */
export async function getOrCreateUser(env: Env, db: Database, clerkId: string): Promise<UserRow> {
  const existing = await db.query.users.findFirst({ where: eq(schema.users.clerkId, clerkId) });
  return existing ?? syncUser(env, db, clerkId);
}

export async function getOrCreateUserId(env: Env, db: Database, clerkId: string): Promise<string> {
  return (await getOrCreateUser(env, db, clerkId)).id;
}
