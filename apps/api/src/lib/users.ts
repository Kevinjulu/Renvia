import { eq } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";

export async function getOrCreateUser(db: Database, clerkId: string, email: string) {
  const existing = await db.query.users.findFirst({
    where: eq(schema.users.clerkId, clerkId),
  });

  if (existing) {
    return existing;
  }

  const [created] = await db.insert(schema.users).values({ clerkId, email }).returning();
  if (!created) {
    throw new Error("Failed to create user");
  }
  return created;
}

export async function getOrCreateUserId(db: Database, clerkId: string, email: string) {
  const user = await getOrCreateUser(db, clerkId, email);
  return user.id;
}
