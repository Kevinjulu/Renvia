import { Hono } from "hono";
import { createDb } from "@renvia/db";
import { z } from "zod";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { deliverIncidentNotification, openOperationalIncident } from "../lib/incidents.js";

const reportSchema = z.object({
  app: z.enum(["studio", "admin"]),
  name: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(500),
  fingerprint: z.string().regex(/^[a-f0-9]{8,64}$/),
  stack: z.string().max(4_000).nullable().optional(),
  path: z.string().startsWith("/").max(500),
  requestId: z.string().max(128).nullable().optional(),
  componentStack: z.string().max(2_000).nullable().optional(),
});

/**
 * Receives only authenticated, deliberately sanitised browser failure reports.
 * Reports are deduplicated into the existing incident centre rather than creating
 * an unbounded table of raw client telemetry.
 */
export const clientErrors = new Hono<AppContext>();

clientErrors.use("*", requireAuth);

clientErrors.post("/client", async (c) => {
  const report = reportSchema.parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);
  const result = await openOperationalIncident(db, {
    fingerprint: `client:${report.app}:${report.fingerprint}`,
    sourceType: "system",
    sourceId: `client:${report.app}:${report.fingerprint}`,
    severity: report.requestId ? "medium" : "low",
    title: `${report.app === "studio" ? "Studio" : "Admin"} client error`,
    summary: report.message,
    context: {
      app: report.app,
      name: report.name,
      path: report.path,
      requestId: report.requestId ?? null,
      stack: report.stack ?? null,
      componentStack: report.componentStack ?? null,
      reportedAt: new Date().toISOString(),
    },
  });
  // Reuse the existing optional, server-only operations webhook for a newly seen
  // browser failure. Repeated failures update the incident without alert spam.
  if (result.created) await deliverIncidentNotification(c.env, db, result.incident, "New authenticated client error");
  return c.json({ accepted: true, incidentId: result.incident.id, requestId: c.get("requestId") }, 202);
});
