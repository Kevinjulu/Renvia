import { Hono } from "hono";
import { and, asc, desc, eq, gte, ilike, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { schema } from "@renvia/db";
import type { AdminAuditAction, AdminAuditEvent, AdminAuditRange } from "@renvia/types";
import { denyUnless } from "./permissions.js";
import { paging, recordAdminEvent } from "./shared.js";
import type { AdminContext } from "./context.js";

export const auditRoutes = new Hono<AdminContext>();

function toAdminAuditEvent(event: typeof schema.adminEvents.$inferSelect, actorEmail: string): AdminAuditEvent {
  return {
    id: event.id,
    actorId: event.actorId,
    actorEmail,
    action: event.action as AdminAuditAction,
    targetType: event.targetType,
    targetId: event.targetId,
    summary: event.summary,
    detail: event.detail,
    createdAt: event.createdAt.toISOString(),
  };
}

auditRoutes.get("/audit", async (c) => {
  const denied = denyUnless(c, "audit.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const { limit, offset } = paging.parse(c.req.query());
  const action = z
    .enum(["credits.adjust", "user.update", "settings.update", "render.refresh", "render.cancel", "segmentation.recover", "incident.update", "billing.webhook", "billing.payment", "billing.entitlement", "customer.note", "customer.tag", "user.session_revoke", "approval.request", "approval.approve", "approval.reject", "approval.execute", "audit.export"])
    .optional()
    .parse(c.req.query("action") || undefined) as AdminAuditAction | undefined;
  const actorId = z.string().uuid().optional().parse(c.req.query("actorId") || undefined);
  const range = z.enum(["today", "7d", "30d"]).optional().parse(c.req.query("range") || undefined) as AdminAuditRange | undefined;
  const search = c.req.query("search")?.trim();

  const actor = schema.users;
  const targetUser = alias(schema.users, "audit_target");
  /** target_id is text (user uuids or "1" for settings) — compare as text to avoid uuid=text errors. */
  const targetJoinOn = and(
    eq(schema.adminEvents.targetType, "user"),
    sql`${schema.adminEvents.targetId} = ${targetUser.id}::text`,
  );

  const filters: SQL[] = [];
  if (action) filters.push(eq(schema.adminEvents.action, action));
  if (actorId) filters.push(eq(schema.adminEvents.actorId, actorId));
  if (range === "today") {
    filters.push(gte(schema.adminEvents.createdAt, sql`date_trunc('day', now() at time zone 'utc') at time zone 'utc'`));
  } else if (range === "7d") {
    filters.push(gte(schema.adminEvents.createdAt, sql`now() - interval '7 days'`));
  } else if (range === "30d") {
    filters.push(gte(schema.adminEvents.createdAt, sql`now() - interval '30 days'`));
  }
  if (search) {
    const escaped = `%${search.replace(/[%_\\]/g, "\\$&")}%`;
    filters.push(or(ilike(schema.adminEvents.summary, escaped), ilike(actor.email, escaped), ilike(targetUser.email, escaped))!);
  }
  const where = filters.length ? and(...filters) : undefined;

  // Only join the target user when searching by email; otherwise keep the list query simple.
  const listBase = db
    .select({
      event: schema.adminEvents,
      actorEmail: actor.email,
    })
    .from(schema.adminEvents)
    .innerJoin(actor, eq(schema.adminEvents.actorId, actor.id));
  const listQuery = search ? listBase.leftJoin(targetUser, targetJoinOn) : listBase;

  const countBase = db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.adminEvents)
    .innerJoin(actor, eq(schema.adminEvents.actorId, actor.id));
  const countQuery = search ? countBase.leftJoin(targetUser, targetJoinOn) : countBase;

  const [rows, [count], [totals], actionRows, actorRows, [lastSettings]] = await Promise.all([
    listQuery.where(where).orderBy(desc(schema.adminEvents.createdAt)).limit(limit).offset(offset),
    countQuery.where(where),
    db
      .select({
        total: sql<number>`count(*)::int`,
        last7Days: sql<number>`count(*) filter (where ${schema.adminEvents.createdAt} >= now() - interval '7 days')::int`,
        uniqueActors: sql<number>`count(distinct ${schema.adminEvents.actorId})::int`,
      })
      .from(schema.adminEvents),
    db
      .select({
        action: schema.adminEvents.action,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.adminEvents)
      .groupBy(schema.adminEvents.action),
    db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.adminEvents)
      .innerJoin(schema.users, eq(schema.adminEvents.actorId, schema.users.id))
      .groupBy(schema.users.id, schema.users.email)
      .orderBy(desc(sql`count(*)`))
      .limit(20),
    db
      .select({ createdAt: schema.adminEvents.createdAt })
      .from(schema.adminEvents)
      .where(eq(schema.adminEvents.action, "settings.update"))
      .orderBy(desc(schema.adminEvents.createdAt))
      .limit(1),
  ]);

  const byAction: Record<AdminAuditAction, number> = {
    "credits.adjust": 0,
    "user.update": 0,
    "settings.update": 0,
    "render.refresh": 0,
    "render.cancel": 0,
    "segmentation.recover": 0,
    "incident.update": 0,
    "billing.webhook": 0,
    "billing.payment": 0,
    "billing.entitlement": 0,
    "customer.note": 0,
    "customer.tag": 0,
    "user.session_revoke": 0,
    "approval.request": 0,
    "approval.approve": 0,
    "approval.reject": 0,
    "approval.execute": 0,
    "audit.export": 0,
  };
  for (const row of actionRows) {
    if (row.action in byAction) byAction[row.action as AdminAuditAction] = row.count;
  }

  return c.json({
    events: rows.map(({ event, actorEmail }) => toAdminAuditEvent(event, actorEmail)),
    total: count?.total ?? 0,
    summary: {
      total: totals?.total ?? 0,
      last7Days: totals?.last7Days ?? 0,
      byAction,
      uniqueActors: totals?.uniqueActors ?? 0,
      lastSettingsAt: lastSettings?.createdAt ? lastSettings.createdAt.toISOString() : null,
      actors: actorRows.map((row) => ({ id: row.id, email: row.email, count: row.count })),
    },
  });
});

/** Creates a retained CSV snapshot; later reads return the exact stored bytes, not a regenerated report. */
auditRoutes.post("/audit/exports", async (c) => {
  const denied = denyUnless(c, "audit.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db"); const { reason } = z.object({ reason: z.string().trim().min(1).max(300) }).parse(await c.req.json());
  const actor = alias(schema.users, "audit_export_actor");
  const rows = await db.select({ id: schema.adminEvents.id, createdAt: schema.adminEvents.createdAt, action: schema.adminEvents.action, actorEmail: actor.email, targetType: schema.adminEvents.targetType, targetId: schema.adminEvents.targetId, summary: schema.adminEvents.summary }).from(schema.adminEvents).innerJoin(actor, eq(schema.adminEvents.actorId, actor.id)).orderBy(asc(schema.adminEvents.createdAt));
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const content = ["id,created_at,action,actor_email,target_type,target_id,summary", ...rows.map((row) => [row.id, row.createdAt.toISOString(), row.action, row.actorEmail, row.targetType, row.targetId, row.summary].map(escape).join(","))].join("\n");
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const [exported] = await db.insert(schema.auditExports).values({ requestedBy: c.get("admin").id, reason, sha256, content }).returning();
  await recordAdminEvent(db, { actorId: c.get("admin").id, action: "audit.export", targetType: "audit_export", targetId: exported!.id, summary: `Created immutable audit export (${rows.length} rows)`, detail: { sha256, reason } });
  return c.json({ id: exported!.id, sha256, rows: rows.length });
});

auditRoutes.get("/audit/exports/:id", async (c) => {
  const denied = denyUnless(c, "audit.read"); if (denied) return c.json(denied, 403);
  const id = z.string().uuid().parse(c.req.param("id"));
  const [exported] = await c.get("db").select().from(schema.auditExports).where(eq(schema.auditExports.id, id));
  if (!exported) return c.json({ error: "Audit export not found" }, 404);
  c.header("Content-Type", "text/csv; charset=utf-8"); c.header("Content-Disposition", `attachment; filename=renvia-audit-${id}.csv`); c.header("X-Content-SHA256", exported.sha256);
  return c.body(exported.content);
});
