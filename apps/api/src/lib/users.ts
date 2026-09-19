import { createClerkClient } from "@clerk/backend";
import { eq, sql } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { Env } from "../index.js";

async function fetchClerkEmail(env: Env, clerkId: string): Promise<string> {
  const user = await createClerkClient({ secretKey: env.CLERK_SECRET_KEY }).users.getUser(clerkId);
  const email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
  if (!email) throw new Error(`Clerk user ${clerkId} has no email address`);
  return email;
}

/**
 * Creates or refreshes the user's row from Clerk. An upsert, so concurrent first requests
 * can't race into a unique-key violation, and email changes made in Clerk are picked up.
 */
export async function syncUser(env: Env, db: Database, clerkId: string) {
  const email = await fetchClerkEmail(env, clerkId);
  const [user] = await db
    .insert(schema.users)
    .values({ clerkId, email })
    .onConflictDoUpdate({ target: schema.users.clerkId, set: { email, updatedAt: sql`now()` } })
    .returning();
  if (!user) throw new Error("Failed to sync user");
  return user;
}

/** The user's row id; only calls Clerk the first time a user is seen. */
export async function getOrCreateUserId(env: Env, db: Database, clerkId: string): Promise<string> {
  const existing = await db.query.users.findFirst({
    where: eq(schema.users.clerkId, clerkId),
    columns: { id: true },
  });
  return existing?.id ?? (await syncUser(env, db, clerkId)).id;
}
