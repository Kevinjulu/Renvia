import { Hono } from "hono";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@renvia/db";
import type { AdminRenderKind, AdminRenderOrder, AdminRenderSort, RenderStatus } from "@renvia/types";
import { getSettings } from "../../lib/settings.js";
import { cancelRender, refreshRender } from "../../lib/engine.js";
import { resolveIncidentsForSource } from "../../lib/incidents.js";
import { denyUnless } from "./permissions.js";
import { MICROS_PER_USD, stuckBeforeSql, selectAdminRenders, toAdminRender, paging, recordAdminEvent } from "./shared.js";
import type { AdminContext } from "./context.js";

export const rendersRoutes = new Hono<AdminContext>();

rendersRoutes.get("/renders", async (c) => {
  const denied = denyUnless(c, "renders.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const settings = await getSettings(db);
  const stuckMinutes = settings.stuckTimeoutMinutes;
  const stuckCutoff = stuckBeforeSql(stuckMinutes);
  const { limit, offset } = paging.parse(c.req.query());
  const status = z.enum(["pending", "processing", "succeeded", "failed"]).optional().parse(c.req.query("status") || undefined);
  const kind = z.enum(["render", "edit"]).optional().parse(c.req.query("kind") || undefined) as AdminRenderKind | undefined;
  const stuck = c.req.query("stuck") === "1" || c.req.query("stuck") === "true";
  const userId = z.string().uuid().optional().parse(c.req.query("userId") || undefined);
  const projectId = z.string().uuid().optional().parse(c.req.query("projectId") || undefined);
  const model = c.req.query("model")?.trim() || undefined;
  const search = c.req.query("search")?.trim();
  const sort = z
    .enum(["createdAt", "costUsd", "creditsCharged"])
    .default("createdAt")
    .parse(c.req.query("sort") || "createdAt") as AdminRenderSort;
  const order = z.enum(["asc", "desc"]).default("desc").parse(c.req.query("order") || "desc") as AdminRenderOrder;

  const filters: SQL[] = [];
  if (status) filters.push(eq(schema.renders.status, status));
  if (userId) filters.push(eq(schema.users.id, userId));
  if (projectId) filters.push(eq(schema.renders.projectId, projectId));
  if (model) filters.push(eq(schema.renders.model, model));
  if (kind === "edit") filters.push(sql`${schema.renders.settings}->'edit' is not null`);
  if (kind === "render") filters.push(sql`${schema.renders.settings}->'edit' is null`);
  if (stuck) {
    filters.push(and(inArray(schema.renders.status, ["pending", "processing"]), sql`${schema.renders.updatedAt} < ${stuckCutoff}`)!);
  }
  if (search) {
    const escaped = `%${search.replace(/[%_\\]/g, "\\$&")}%`;
    filters.push(
      or(
        ilike(schema.users.email, escaped),
        ilike(schema.projects.name, escaped),
        ilike(schema.renders.prompt, escaped),
        ilike(schema.renders.model, escaped),
      )!,
    );
  }
  const where = filters.length ? and(...filters) : undefined;

  const direction = order === "asc" ? asc : desc;
  const orderBy =
    sort === "costUsd"
      ? direction(schema.renders.costMicros)
      : sort === "creditsCharged"
        ? direction(schema.renders.creditsCharged)
        : direction(schema.renders.createdAt);

  const [rows, [count], statusRows, [stuckRow], [spendRow], modelRows] = await Promise.all([
    selectAdminRenders(db).where(where).orderBy(orderBy).limit(limit).offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.renders)
      .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
      .innerJoin(schema.users, eq(schema.projects.ownerId, schema.users.id))
      .where(where),
    db
      .select({ status: schema.renders.status, count: sql<number>`count(*)::int` })
      .from(schema.renders)
      .groupBy(schema.renders.status),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.renders)
      .where(and(inArray(schema.renders.status, ["pending", "processing"]), sql`${schema.renders.updatedAt} < ${stuckCutoff}`)),
    db
      .select({
        spentMicros: sql<number>`coalesce(sum(${schema.renders.costMicros}) filter (where ${schema.renders.status} <> 'failed'), 0)::bigint`,
      })
      .from(schema.renders),
    db
      .select({
        model: schema.renders.model,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.renders)
      .where(sql`${schema.renders.model} is not null`)
      .groupBy(schema.renders.model)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
  ]);

  const byStatus: Record<RenderStatus, number> = { pending: 0, processing: 0, succeeded: 0, failed: 0 };
  for (const row of statusRows) byStatus[row.status] = row.count;
  const inFlight = byStatus.pending + byStatus.processing;

  return c.json({
    renders: await Promise.all(rows.map((row) => toAdminRender(c.env, new URL(c.req.url).origin, row, stuckMinutes))),
    total: count?.total ?? 0,
    summary: {
      total: byStatus.pending + byStatus.processing + byStatus.succeeded + byStatus.failed,
      byStatus,
      inFlight,
      stuckCount: stuckRow?.count ?? 0,
      stuckTimeoutMinutes: stuckMinutes,
      failed: byStatus.failed,
      spentUsd: Number(spendRow?.spentMicros ?? 0) / MICROS_PER_USD,
      models: modelRows
        .filter((row): row is { model: string; count: number } => row.model !== null)
        .map((row) => ({ model: row.model, count: row.count })),
    },
  });
});

rendersRoutes.get("/renders/:id", async (c) => {
  const denied = denyUnless(c, "renders.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const settings = await getSettings(db);
  const [row] = await selectAdminRenders(db).where(eq(schema.renders.id, id));
  if (!row) return c.json({ error: "Render not found" }, 404);
  return c.json({ render: await toAdminRender(c.env, new URL(c.req.url).origin, row, settings.stuckTimeoutMinutes) });
});

/**
 * Operator recovery uses the same idempotent engine paths as customer polling.
 * It never fabricates a result or a refund: refresh asks fal for the authoritative
 * state; cancel is best-effort at fal and records the normal failed/refund outcome.
 */
rendersRoutes.post("/renders/:id/refresh", async (c) => {
  const denied = denyUnless(c, "renders.recover"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const [render] = await db.select().from(schema.renders).where(eq(schema.renders.id, id)).limit(1);
  if (!render) return c.json({ error: "Render not found" }, 404);
  const refreshed = await refreshRender(c.env, db, render, new URL(c.req.url).origin);
  await recordAdminEvent(db, {
    actorId: c.get("admin").id,
    action: "render.refresh",
    targetType: "render",
    targetId: id,
    summary: `Refreshed render ${id}`,
    detail: { statusBefore: render.status, statusAfter: refreshed.status },
  });
  if (refreshed.status === "succeeded") {
    await resolveIncidentsForSource(db, "render", id, c.get("admin").id, "Render refresh completed successfully");
  }
  const settings = await getSettings(db);
  const [row] = await selectAdminRenders(db).where(eq(schema.renders.id, id));
  return c.json({ render: row ? await toAdminRender(c.env, new URL(c.req.url).origin, row, settings.stuckTimeoutMinutes) : refreshed });
});

rendersRoutes.post("/renders/:id/cancel", async (c) => {
  const denied = denyUnless(c, "renders.recover"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const [render] = await db.select().from(schema.renders).where(eq(schema.renders.id, id)).limit(1);
  if (!render) return c.json({ error: "Render not found" }, 404);
  if (render.status !== "pending" && render.status !== "processing") {
    return c.json({ error: "Only pending or processing renders can be cancelled" }, 409);
  }
  const cancelled = await cancelRender(c.env, db, render);
  await recordAdminEvent(db, {
    actorId: c.get("admin").id,
    action: "render.cancel",
    targetType: "render",
    targetId: id,
    summary: `Cancelled render ${id}`,
    detail: { statusBefore: render.status, statusAfter: cancelled.status, creditsCharged: render.creditsCharged },
  });
  await resolveIncidentsForSource(db, "render", id, c.get("admin").id, "Render was intentionally cancelled by an operator");
  const settings = await getSettings(db);
  const [row] = await selectAdminRenders(db).where(eq(schema.renders.id, id));
  return c.json({ render: row ? await toAdminRender(c.env, new URL(c.req.url).origin, row, settings.stuckTimeoutMinutes) : cancelled });
});
