import { and, eq, ne, sql } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { Env } from "../index.js";

type IncidentRow = typeof schema.incidents.$inferSelect;
type IncidentSourceType = "render" | "segmentation" | "webhook" | "system";
type IncidentSeverity = "low" | "medium" | "high" | "critical";

export async function openOperationalIncident(
  db: Database,
  input: { fingerprint: string; sourceType: IncidentSourceType; sourceId: string; severity: IncidentSeverity; title: string; summary: string; context?: Record<string, unknown> },
): Promise<{ incident: IncidentRow; created: boolean }> {
  const [existing] = await db.select().from(schema.incidents).where(and(eq(schema.incidents.fingerprint, input.fingerprint), ne(schema.incidents.status, "resolved"))).limit(1);
  if (existing) {
    const [incident] = await db.update(schema.incidents).set({
      severity: input.severity,
      title: input.title,
      summary: input.summary,
      context: input.context,
      occurrenceCount: sql`${schema.incidents.occurrenceCount} + 1`,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(schema.incidents.id, existing.id)).returning();
    return { incident: incident!, created: false };
  }
  const id = crypto.randomUUID();
  try {
    await db.batch([
      db.insert(schema.incidents).values({ id, ...input }),
      db.insert(schema.incidentEvents).values({ incidentId: id, action: "opened", note: input.summary, detail: { sourceType: input.sourceType, sourceId: input.sourceId } }),
    ]);
  } catch {
    // A simultaneous alert sync can hit the partial unique index. Return the winning row.
    const [winning] = await db.select().from(schema.incidents).where(and(eq(schema.incidents.fingerprint, input.fingerprint), ne(schema.incidents.status, "resolved"))).limit(1);
    if (!winning) throw new Error("Could not create incident");
    return { incident: winning, created: false };
  }
  const [incident] = await db.select().from(schema.incidents).where(eq(schema.incidents.id, id)).limit(1);
  if (!incident) throw new Error("Could not load created incident");
  return { incident, created: true };
}

export async function recordIncidentEvent(
  db: Database,
  incidentId: string,
  action: "assigned" | "acknowledged" | "recovered" | "resolved" | "reopened" | "notification",
  actorId?: string | null,
  note?: string | null,
  detail?: Record<string, unknown>,
) {
  await db.insert(schema.incidentEvents).values({ incidentId, actorId: actorId ?? null, action, note: note ?? null, detail });
}

export async function resolveIncidentsForSource(db: Database, sourceType: IncidentSourceType, sourceId: string, actorId: string, note: string) {
  const open = await db.select({ id: schema.incidents.id }).from(schema.incidents).where(and(eq(schema.incidents.sourceType, sourceType), eq(schema.incidents.sourceId, sourceId), ne(schema.incidents.status, "resolved")));
  if (open.length === 0) return 0;
  await db.batch([
    db.update(schema.incidents).set({ status: "resolved", resolvedAt: new Date(), resolvedBy: actorId, resolutionNote: note, updatedAt: new Date() }).where(and(eq(schema.incidents.sourceType, sourceType), eq(schema.incidents.sourceId, sourceId), ne(schema.incidents.status, "resolved"))),
    ...open.map((incident) => db.insert(schema.incidentEvents).values({ incidentId: incident.id, actorId, action: "recovered", note })),
  ]);
  return open.length;
}

/** Sends a concise, non-customer-data alert to an optional server-only operations webhook. */
export async function deliverIncidentNotification(env: Env, db: Database, incident: IncidentRow, reason: string) {
  const configured = env.OPS_NOTIFICATION_WEBHOOK_URL?.trim();
  let status: "delivered" | "failed" | "skipped" = "skipped";
  let destination: string | null = null;
  let failureMessage: string | null = null;
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol !== "https:") throw new Error("Operations notification URL must use HTTPS");
      destination = url.origin;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "incident.opened", reason, incident: { id: incident.id, severity: incident.severity, title: incident.title, sourceType: incident.sourceType, sourceId: incident.sourceId, status: incident.status, occurredAt: incident.lastSeenAt.toISOString() } }),
      });
      if (!response.ok) throw new Error(`Notification endpoint returned ${response.status}`);
      status = "delivered";
    } catch (error) {
      status = "failed";
      failureMessage = error instanceof Error ? error.message.slice(0, 500) : "Notification delivery failed";
    }
  }
  await db.batch([
    db.insert(schema.incidentNotifications).values({ incidentId: incident.id, status, destination, failureMessage, deliveredAt: status === "delivered" ? new Date() : null }),
    db.insert(schema.incidentEvents).values({ incidentId: incident.id, action: "notification", note: reason, detail: { status, destination } }),
  ]);
  return status;
}
