import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";

export async function findOwnedProject(db: Database, projectId: string, ownerId: string) {
  return db.query.projects.findFirst({
    where: and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, ownerId)),
  });
}
