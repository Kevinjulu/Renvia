import { Hono } from "hono";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@renvia/db";
import type { AdminSegmentation, AdminSegmentationMode, AdminSegmentationOrder, AdminSegmentationSort, SegmentationStatus } from "@renvia/types";
import { getSettings, effectiveEngineMode } from "../../lib/settings.js";
import { runSegmentation } from "../../lib/segment.js";
import { resolveIncidentsForSource } from "../../lib/incidents.js";
import { denyUnless } from "./permissions.js";
import { MICROS_PER_USD, stuckBeforeSql, isSegStuck, paging, recordAdminEvent } from "./shared.js";
import type { AdminContext } from "./context.js";

export const segmentationsRoutes = new Hono<AdminContext>();

function toAdminSegmentation(
  segmentation: typeof schema.segmentations.$inferSelect,
  userEmail: string,
  stuckMinutes = 15,
): AdminSegmentation {
  const mode: AdminSegmentationMode = segmentation.prompt ? "prompt" : "click";
  return {
    id: segmentation.id,
    userId: segmentation.userId,
    userEmail,
    imageUrl: segmentation.imageUrl,
    prompt: segmentation.prompt,
    point: segmentation.point,
    mode,
    status: segmentation.status as SegmentationStatus,
    objectCount: segmentation.objectCount,
    model: segmentation.model,
    costUsd: segmentation.costMicros / MICROS_PER_USD,
    creditsCharged: segmentation.creditsCharged,
    errorMessage: segmentation.errorMessage,
    stuck: isSegStuck(segmentation.status as SegmentationStatus, segmentation.createdAt, stuckMinutes),
    createdAt: segmentation.createdAt.toISOString(),
  };
}

segmentationsRoutes.get("/segmentations", async (c) => {
  const denied = denyUnless(c, "segmentations.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const settings = await getSettings(db);
  const stuckMinutes = settings.stuckTimeoutMinutes;
  const { limit, offset } = paging.parse(c.req.query());
  const status = z.enum(["pending", "succeeded", "failed"]).optional().parse(c.req.query("status") || undefined);
  const mode = z.enum(["prompt", "click"]).optional().parse(c.req.query("mode") || undefined) as AdminSegmentationMode | undefined;
  const stuck = c.req.query("stuck") === "1" || c.req.query("stuck") === "true";
  const userId = z.string().uuid().optional().parse(c.req.query("userId") || undefined);
  const model = c.req.query("model")?.trim() || undefined;
  const search = c.req.query("search")?.trim();
  const sort = z
    .enum(["createdAt", "costUsd", "creditsCharged", "objectCount"])
    .default("createdAt")
    .parse(c.req.query("sort") || "createdAt") as AdminSegmentationSort;
  const order = z.enum(["asc", "desc"]).default("desc").parse(c.req.query("order") || "desc") as AdminSegmentationOrder;

  const filters: SQL[] = [];
  if (status) filters.push(eq(schema.segmentations.status, status));
  if (userId) filters.push(eq(schema.segmentations.userId, userId));
  if (model) filters.push(eq(schema.segmentations.model, model));
  if (mode === "prompt") filters.push(sql`${schema.segmentations.prompt} is not null`);
  if (mode === "click") filters.push(sql`${schema.segmentations.prompt} is null`);
  if (stuck) {
    filters.push(
      and(eq(schema.segmentations.status, "pending"), sql`${schema.segmentations.createdAt} < ${stuckBeforeSql(stuckMinutes)}`)!,
    );
  }
  if (search) {
    const escaped = `%${search.replace(/[%_\\]/g, "\\$&")}%`;
    filters.push(or(ilike(schema.users.email, escaped), ilike(schema.segmentations.prompt, escaped), ilike(schema.segmentations.model, escaped))!);
  }
  const where = filters.length ? and(...filters) : undefined;

  const direction = order === "asc" ? asc : desc;
  const orderBy =
    sort === "costUsd"
      ? direction(schema.segmentations.costMicros)
      : sort === "creditsCharged"
        ? direction(schema.segmentations.creditsCharged)
        : sort === "objectCount"
          ? direction(schema.segmentations.objectCount)
          : direction(schema.segmentations.createdAt);

  const [rows, [count], statusRows, [stuckRow], [spendRow], modelRows] = await Promise.all([
    db
      .select({
        segmentation: schema.segmentations,
        userEmail: schema.users.email,
      })
      .from(schema.segmentations)
      .innerJoin(schema.users, eq(schema.segmentations.userId, schema.users.id))
      .where(where)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.segmentations)
      .innerJoin(schema.users, eq(schema.segmentations.userId, schema.users.id))
      .where(where),
    db
      .select({ status: schema.segmentations.status, count: sql<number>`count(*)::int` })
      .from(schema.segmentations)
      .groupBy(schema.segmentations.status),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.segmentations)
      .where(
        and(eq(schema.segmentations.status, "pending"), sql`${schema.segmentations.createdAt} < ${stuckBeforeSql(stuckMinutes)}`),
      ),
    db
      .select({
        spentMicros: sql<number>`coalesce(sum(${schema.segmentations.costMicros}) filter (where ${schema.segmentations.status} <> 'failed'), 0)::bigint`,
      })
      .from(schema.segmentations),
    db
      .select({
        model: schema.segmentations.model,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.segmentations)
      .groupBy(schema.segmentations.model)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
  ]);

  const byStatus: Record<SegmentationStatus, number> = { pending: 0, succeeded: 0, failed: 0 };
  for (const row of statusRows) byStatus[row.status as SegmentationStatus] = row.count;

  return c.json({
    segmentations: rows.map(({ segmentation, userEmail }) => toAdminSegmentation(segmentation, userEmail, stuckMinutes)),
    total: count?.total ?? 0,
    summary: {
      total: byStatus.pending + byStatus.succeeded + byStatus.failed,
      byStatus,
      pending: byStatus.pending,
      stuckCount: stuckRow?.count ?? 0,
      stuckTimeoutMinutes: stuckMinutes,
      failed: byStatus.failed,
      spentUsd: Number(spendRow?.spentMicros ?? 0) / MICROS_PER_USD,
      models: modelRows.map((row) => ({ model: row.model, count: row.count })),
    },
  });
});

segmentationsRoutes.get("/segmentations/:id", async (c) => {
  const denied = denyUnless(c, "segmentations.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const settings = await getSettings(db);
  const id = z.string().uuid().parse(c.req.param("id"));
  const [row] = await db
    .select({
      segmentation: schema.segmentations,
      userEmail: schema.users.email,
    })
    .from(schema.segmentations)
    .innerJoin(schema.users, eq(schema.segmentations.userId, schema.users.id))
    .where(eq(schema.segmentations.id, id));
  if (!row) return c.json({ error: "Segmentation not found" }, 404);
  return c.json({
    segmentation: toAdminSegmentation(row.segmentation, row.userEmail, settings.stuckTimeoutMinutes),
  });
});

/** Retries a failed or stuck automatic selection without silently charging the customer again. */
segmentationsRoutes.post("/segmentations/:id/recover", async (c) => {
  const denied = denyUnless(c, "segmentations.recover"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const [segmentation] = await db.select().from(schema.segmentations).where(eq(schema.segmentations.id, id)).limit(1);
  if (!segmentation) return c.json({ error: "Segmentation not found" }, 404);
  const settings = await getSettings(db);
  const stuck = isSegStuck(segmentation.status as SegmentationStatus, segmentation.createdAt, settings.stuckTimeoutMinutes);
  if (segmentation.status !== "failed" && !stuck) return c.json({ error: "Only failed or stuck segmentations can be recovered" }, 409);
  const [pending] = await db.update(schema.segmentations).set({ status: "pending", errorMessage: null }).where(eq(schema.segmentations.id, id)).returning();
  const result = await runSegmentation(c.env, db, pending!, new URL(c.req.url).origin, effectiveEngineMode(c.env, settings));
  await recordAdminEvent(db, {
    actorId: c.get("admin").id,
    action: "segmentation.recover",
    targetType: "segmentation",
    targetId: id,
    summary: `Recovered segmentation ${id}`,
    detail: { statusBefore: segmentation.status, statusAfter: result.segmentation.status },
  });
  if (result.segmentation.status === "succeeded") {
    await resolveIncidentsForSource(db, "segmentation", id, c.get("admin").id, "Segmentation recovery completed successfully");
  }
  const [owner] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, result.segmentation.userId)).limit(1);
  return c.json({ segmentation: toAdminSegmentation(result.segmentation, owner?.email ?? "Unknown", settings.stuckTimeoutMinutes) });
});
