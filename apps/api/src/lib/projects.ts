import { and, eq, isNull } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";

/** The owner's project, or undefined. A deleted project is gone to its owner too. */
export async function findOwnedProject(db: Database, projectId: string, ownerId: string) {
  return db.query.projects.findFirst({
    where: and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, ownerId), isNull(schema.projects.deletedAt)),
  });
}
