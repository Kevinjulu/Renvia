import { Hono } from "hono";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Database } from "@renvia/db";
import type { AdminIncidentsResponse } from "@renvia/types";
import { deliverIncidentNotification, recordIncidentEvent, syncOperationalIncidents } from "../../lib/incidents.js";
import { denyUnless } from "./permissions.js";
import { recordAdminEvent } from "./shared.js";
import type { AdminContext } from "./context.js";

export const incidentsRoutes = new Hono<AdminContext>();

async function incidentResponse(db: Database, status?: "open" | "acknowledged" | "resolved"): Promise<AdminIncidentsResponse> {
  const incidents = await db.select().from(schema.incidents).where(status ? eq(schema.incidents.status, status) : undefined).orderBy(desc(schema.incidents.lastSeenAt)).limit(100);
  const ids = incidents.map((incident) => incident.id);
  const [events, notifications, staff, allIncidents] = await Promise.all([
    ids.length ? db.select().from(schema.incidentEvents).where(inArray(schema.incidentEvents.incidentId, ids)).orderBy(desc(schema.incidentEvents.createdAt)) : Promise.resolve([]),
    ids.length ? db.select().from(schema.incidentNotifications).where(inArray(schema.incidentNotifications.incidentId, ids)).orderBy(desc(schema.incidentNotifications.attemptedAt)) : Promise.resolve([]),
    db.select({ id: schema.users.id, email: schema.users.email, role: schema.users.role }).from(schema.users).where(and(inArray(schema.users.role, ["support", "billing", "admin"]), eq(schema.users.disabled, false))).orderBy(asc(schema.users.email)),
    db.select({ status: schema.incidents.status, severity: schema.incidents.severity, count: sql<number>`count(*)::int` }).from(schema.incidents).groupBy(schema.incidents.status, schema.incidents.severity),
  ]);
  const peopleIds = new Set<string>();
  for (const incident of incidents) [incident.ownerId, incident.acknowledgedBy, incident.resolvedBy].forEach((id) => { if (id) peopleIds.add(id); });
  for (const event of events) if (event.actorId) peopleIds.add(event.actorId);
  const people = peopleIds.size ? await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, [...peopleIds])) : [];
  const emailById = new Map(people.map((person) => [person.id, person.email]));
  const eventsByIncident = new Map<string, typeof events>();
  for (const event of events) eventsByIncident.set(event.incidentId, [...(eventsByIncident.get(event.incidentId) ?? []), event]);
  const notificationsByIncident = new Map<string, typeof notifications>();
  for (const notification of notifications) notificationsByIncident.set(notification.incidentId, [...(notificationsByIncident.get(notification.incidentId) ?? []), notification]);
  const summary = { open: 0, acknowledged: 0, resolved: 0, criticalOpen: 0, failedNotifications: 0 };
  for (const row of allIncidents) {
    summary[row.status as "open" | "acknowledged" | "resolved"] += row.count;
    if ((row.status === "open" || row.status === "acknowledged") && row.severity === "critical") summary.criticalOpen += row.count;
  }
  summary.failedNotifications = notifications.filter((notification) => notification.status === "failed").length;
  return {
    incidents: incidents.map((incident) => ({
      id: incident.id,
      sourceType: incident.sourceType as AdminIncidentsResponse["incidents"][number]["sourceType"],
      sourceId: incident.sourceId,
      severity: incident.severity as AdminIncidentsResponse["incidents"][number]["severity"],
      status: incident.status as AdminIncidentsResponse["incidents"][number]["status"],
      title: incident.title,
      summary: incident.summary,
      context: incident.context ?? null,
      ownerId: incident.ownerId,
      ownerEmail: incident.ownerId ? emailById.get(incident.ownerId) ?? null : null,
      acknowledgement: incident.acknowledgedAt ? { at: incident.acknowledgedAt.toISOString(), byEmail: incident.acknowledgedBy ? emailById.get(incident.acknowledgedBy) ?? null : null } : null,
      resolution: incident.resolvedAt ? { at: incident.resolvedAt.toISOString(), byEmail: incident.resolvedBy ? emailById.get(incident.resolvedBy) ?? null : null, note: incident.resolutionNote } : null,
      occurrenceCount: incident.occurrenceCount,
      firstSeenAt: incident.firstSeenAt.toISOString(),
      lastSeenAt: incident.lastSeenAt.toISOString(),
      events: (eventsByIncident.get(incident.id) ?? []).slice(0, 8).map((event) => ({ id: event.id, action: event.action as AdminIncidentsResponse["incidents"][number]["events"][number]["action"], note: event.note, actorEmail: event.actorId ? emailById.get(event.actorId) ?? null : null, createdAt: event.createdAt.toISOString() })),
      notifications: (notificationsByIncident.get(incident.id) ?? []).slice(0, 5).map((notification) => ({ id: notification.id, status: notification.status as "delivered" | "failed" | "skipped", destination: notification.destination, failureMessage: notification.failureMessage, attemptedAt: notification.attemptedAt.toISOString(), deliveredAt: notification.deliveredAt?.toISOString() ?? null })),
    })),
    staff,
    summary,
  };
}

incidentsRoutes.get("/incidents", async (c) => {
  const denied = denyUnless(c, "incidents.read"); if (denied) return c.json(denied, 403);
  const status = z.enum(["open", "acknowledged", "resolved"]).optional().parse(c.req.query("status") || undefined);
  return c.json(await incidentResponse(c.get("db"), status));
});

incidentsRoutes.post("/incidents/sync", async (c) => {
  const denied = denyUnless(c, "incidents.manage"); if (denied) return c.json(denied, 403);
  return c.json(await syncOperationalIncidents(c.env, c.get("db")));
});

async function managedIncident(c: { get: (key: "db") => Database }, id: string) {
  const [incident] = await c.get("db").select().from(schema.incidents).where(eq(schema.incidents.id, id)).limit(1);
  return incident;
}

incidentsRoutes.post("/incidents/:id/assign", async (c) => {
  const denied = denyUnless(c, "incidents.manage"); if (denied) return c.json(denied, 403);
  const id = z.string().uuid().parse(c.req.param("id"));
  const { ownerId } = z.object({ ownerId: z.string().uuid().nullable() }).parse(await c.req.json());
  const incident = await managedIncident(c, id); if (!incident) return c.json({ error: "Incident not found" }, 404);
  if (ownerId) {
    const [owner] = await c.get("db").select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.id, ownerId), eq(schema.users.disabled, false), inArray(schema.users.role, ["support", "billing", "admin"]))).limit(1);
    if (!owner) return c.json({ error: "Owner must be active operations staff" }, 409);
  }
  await c.get("db").update(schema.incidents).set({ ownerId, updatedAt: new Date() }).where(eq(schema.incidents.id, id));
  await recordIncidentEvent(c.get("db"), id, "assigned", c.get("admin").id, ownerId ? "Incident owner changed" : "Incident unassigned", { ownerId });
  await recordAdminEvent(c.get("db"), { actorId: c.get("admin").id, action: "incident.update", targetType: "incident", targetId: id, summary: ownerId ? "Assigned incident" : "Unassigned incident", detail: { ownerId } });
  return c.json({ id, ownerId });
});

incidentsRoutes.post("/incidents/:id/acknowledge", async (c) => {
  const denied = denyUnless(c, "incidents.manage"); if (denied) return c.json(denied, 403);
  const id = z.string().uuid().parse(c.req.param("id"));
  const { note } = z.object({ note: z.string().trim().max(500).optional() }).parse(await c.req.json());
  const incident = await managedIncident(c, id); if (!incident) return c.json({ error: "Incident not found" }, 404);
  if (incident.status === "resolved") return c.json({ error: "Resolved incidents cannot be acknowledged" }, 409);
  await c.get("db").update(schema.incidents).set({ status: "acknowledged", acknowledgedAt: new Date(), acknowledgedBy: c.get("admin").id, updatedAt: new Date() }).where(eq(schema.incidents.id, id));
  await recordIncidentEvent(c.get("db"), id, "acknowledged", c.get("admin").id, note ?? "Incident acknowledged");
  await recordAdminEvent(c.get("db"), { actorId: c.get("admin").id, action: "incident.update", targetType: "incident", targetId: id, summary: "Acknowledged incident" });
  return c.json({ id, status: "acknowledged" });
});

incidentsRoutes.post("/incidents/:id/severity", async (c) => {
  const denied = denyUnless(c, "incidents.manage"); if (denied) return c.json(denied, 403);
  const id = z.string().uuid().parse(c.req.param("id"));
  const { severity } = z.object({ severity: z.enum(["low", "medium", "high", "critical"]) }).parse(await c.req.json());
  const incident = await managedIncident(c, id); if (!incident) return c.json({ error: "Incident not found" }, 404);
  await c.get("db").update(schema.incidents).set({ severity, updatedAt: new Date() }).where(eq(schema.incidents.id, id));
  await recordIncidentEvent(c.get("db"), id, "reopened", c.get("admin").id, `Severity set to ${severity}`, { severity });
  return c.json({ id, severity });
});

incidentsRoutes.post("/incidents/:id/resolve", async (c) => {
  const denied = denyUnless(c, "incidents.manage"); if (denied) return c.json(denied, 403);
  const id = z.string().uuid().parse(c.req.param("id"));
  const { note } = z.object({ note: z.string().trim().min(3).max(1000) }).parse(await c.req.json());
  const incident = await managedIncident(c, id); if (!incident) return c.json({ error: "Incident not found" }, 404);
  await c.get("db").update(schema.incidents).set({ status: "resolved", resolvedAt: new Date(), resolvedBy: c.get("admin").id, resolutionNote: note, updatedAt: new Date() }).where(eq(schema.incidents.id, id));
  await recordIncidentEvent(c.get("db"), id, "resolved", c.get("admin").id, note);
  await recordAdminEvent(c.get("db"), { actorId: c.get("admin").id, action: "incident.update", targetType: "incident", targetId: id, summary: "Resolved incident", detail: { note } });
  return c.json({ id, status: "resolved" });
});

incidentsRoutes.post("/incidents/:id/notify", async (c) => {
  const denied = denyUnless(c, "incidents.manage"); if (denied) return c.json(denied, 403);
  const id = z.string().uuid().parse(c.req.param("id"));
  const incident = await managedIncident(c, id); if (!incident) return c.json({ error: "Incident not found" }, 404);
  const status = await deliverIncidentNotification(c.env, c.get("db"), incident, "Operator requested notification retry");
  return c.json({ id, notification: status });
});
