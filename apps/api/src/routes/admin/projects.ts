import { Hono } from "hono";
import { and, asc, desc, eq, gte, ilike, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { schema, type Database } from "@renvia/db";
import type { AdminProject, AdminProjectHealth, AdminProjectOrder, AdminProjectSort } from "@renvia/types";
import type { Env } from "../../index.js";
import { getSettings } from "../../lib/settings.js";
import { presentUploadUrl } from "../../lib/storage.js";
import { denyUnless } from "./permissions.js";
import { MICROS_PER_USD, selectAdminRenders, toAdminRender, paging } from "./shared.js";
import type { AdminContext } from "./context.js";

export const projectsRoutes = new Hono<AdminContext>();

const HIGH_SPEND_MICROS = 1_000_000; // $1

function projectRenderStats(db: Database) {
  return db
    .select({
      projectId: schema.renders.projectId,
      renderCount: sql<number>`count(*) filter (where ${schema.renders.status} <> 'failed')::int`.as("render_count"),
      failedCount: sql<number>`count(*) filter (where ${schema.renders.status} = 'failed')::int`.as("failed_count"),
      inFlightCount: sql<number>`count(*) filter (where ${schema.renders.status} in ('pending', 'processing'))::int`.as(
        "in_flight_count",
      ),
      totalRenders: sql<number>`count(*)::int`.as("total_renders"),
      spentMicros: sql<number>`coalesce(sum(${schema.renders.costMicros}) filter (where ${schema.renders.status} <> 'failed'), 0)::bigint`.as(
        "spent_micros",
      ),
      lastRenderAt: sql<Date | null>`max(${schema.renders.createdAt})`.as("last_render_at"),
    })
    .from(schema.renders)
    .groupBy(schema.renders.projectId)
    .as("project_render_stats");
}

type ProjectStats = ReturnType<typeof projectRenderStats>;

async function toAdminProject(env: Env, origin: string, row: {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  ownerId: string;
  ownerEmail: string;
  createdAt: Date;
  updatedAt: Date;
  renderCount: number;
  failedCount: number;
  inFlightCount: number;
  spentMicros: number;
  lastRenderAt: Date | null;
}): Promise<AdminProject> {
  return {
    id: row.id,
    name: row.name,
    thumbnailUrl: await presentUploadUrl(env, origin, row.thumbnailUrl),
    ownerId: row.ownerId,
    ownerEmail: row.ownerEmail,
    renderCount: row.renderCount,
    failedCount: row.failedCount,
    inFlightCount: row.inFlightCount,
    spentUsd: Number(row.spentMicros) / MICROS_PER_USD,
    lastRenderAt: row.lastRenderAt ? new Date(row.lastRenderAt).toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function projectSelect(db: Database, stats: ProjectStats) {
  return db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      thumbnailUrl: schema.projects.thumbnailUrl,
      ownerId: schema.users.id,
      ownerEmail: schema.users.email,
      createdAt: schema.projects.createdAt,
      updatedAt: schema.projects.updatedAt,
      renderCount: sql<number>`coalesce(${stats.renderCount}, 0)::int`,
      failedCount: sql<number>`coalesce(${stats.failedCount}, 0)::int`,
      inFlightCount: sql<number>`coalesce(${stats.inFlightCount}, 0)::int`,
      spentMicros: sql<number>`coalesce(${stats.spentMicros}, 0)::bigint`,
      lastRenderAt: stats.lastRenderAt,
    })
    .from(schema.projects)
    .innerJoin(schema.users, eq(schema.projects.ownerId, schema.users.id))
    .leftJoin(stats, eq(stats.projectId, schema.projects.id));
}

projectsRoutes.get("/projects", async (c) => {
  const denied = denyUnless(c, "projects.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const { limit, offset } = paging.parse(c.req.query());
  const search = c.req.query("search")?.trim();
  const health = z
    .enum(["active", "failures", "inflight", "never", "high_spend"])
    .optional()
    .parse(c.req.query("health") || undefined) as AdminProjectHealth | undefined;
  const sort = z
    .enum(["updatedAt", "createdAt", "lastRenderAt", "renderCount", "spentUsd", "failedCount"])
    .default("updatedAt")
    .parse(c.req.query("sort") || "updatedAt") as AdminProjectSort;
  const order = z.enum(["asc", "desc"]).default("desc").parse(c.req.query("order") || "desc") as AdminProjectOrder;

  const stats = projectRenderStats(db);
  const filters: SQL[] = [];
  if (search) {
    const escaped = `%${search.replace(/[%_\\]/g, "\\$&")}%`;
    filters.push(or(ilike(schema.projects.name, escaped), ilike(schema.users.email, escaped))!);
  }
  if (health === "active") {
    filters.push(
      or(
        gte(schema.projects.updatedAt, sql`now() - interval '7 days'`),
        gte(stats.lastRenderAt, sql`now() - interval '7 days'`),
      )!,
    );
  }
  if (health === "failures") filters.push(sql`coalesce(${stats.failedCount}, 0) > 0`);
  if (health === "inflight") filters.push(sql`coalesce(${stats.inFlightCount}, 0) > 0`);
  if (health === "never") filters.push(sql`coalesce(${stats.totalRenders}, 0) = 0`);
  if (health === "high_spend") filters.push(sql`coalesce(${stats.spentMicros}, 0) >= ${HIGH_SPEND_MICROS}`);
  const where = filters.length ? and(...filters) : undefined;

  const direction = order === "asc" ? asc : desc;
  const orderBy =
    sort === "createdAt"
      ? direction(schema.projects.createdAt)
      : sort === "lastRenderAt"
        ? direction(stats.lastRenderAt)
        : sort === "renderCount"
          ? direction(sql`coalesce(${stats.renderCount}, 0)`)
          : sort === "spentUsd"
            ? direction(sql`coalesce(${stats.spentMicros}, 0)`)
            : sort === "failedCount"
              ? direction(sql`coalesce(${stats.failedCount}, 0)`)
              : direction(schema.projects.updatedAt);

  const [rows, [count], [summary]] = await Promise.all([
    projectSelect(db, stats).where(where).orderBy(orderBy).limit(limit).offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.projects)
      .innerJoin(schema.users, eq(schema.projects.ownerId, schema.users.id))
      .leftJoin(stats, eq(stats.projectId, schema.projects.id))
      .where(where),
    db
      .select({
        total: sql<number>`count(*)::int`,
        activeLast7Days: sql<number>`count(*) filter (where ${schema.projects.updatedAt} >= now() - interval '7 days' or ${stats.lastRenderAt} >= now() - interval '7 days')::int`,
        withFailures: sql<number>`count(*) filter (where coalesce(${stats.failedCount}, 0) > 0)::int`,
        neverRendered: sql<number>`count(*) filter (where coalesce(${stats.totalRenders}, 0) = 0)::int`,
        spentMicros: sql<number>`coalesce(sum(${stats.spentMicros}), 0)::bigint`,
      })
      .from(schema.projects)
      .leftJoin(stats, eq(stats.projectId, schema.projects.id)),
  ]);

  return c.json({
    projects: await Promise.all(rows.map((row) => toAdminProject(c.env, new URL(c.req.url).origin, row))),
    total: count?.total ?? 0,
    summary: {
      total: summary?.total ?? 0,
      activeLast7Days: summary?.activeLast7Days ?? 0,
      withFailures: summary?.withFailures ?? 0,
      neverRendered: summary?.neverRendered ?? 0,
      spentUsd: Number(summary?.spentMicros ?? 0) / MICROS_PER_USD,
    },
  });
});

projectsRoutes.get("/projects/:id", async (c) => {
  const denied = denyUnless(c, "projects.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const settings = await getSettings(db);
  const stats = projectRenderStats(db);
  const [row] = await projectSelect(db, stats).where(eq(schema.projects.id, id));
  if (!row) return c.json({ error: "Project not found" }, 404);

  const renders = await selectAdminRenders(db)
    .where(eq(schema.renders.projectId, id))
    .orderBy(desc(schema.renders.createdAt))
    .limit(25);

  return c.json({
    project: await toAdminProject(c.env, new URL(c.req.url).origin, row),
    renders: await Promise.all(renders.map((render) => toAdminRender(c.env, new URL(c.req.url).origin, render, settings.stuckTimeoutMinutes))),
  });
});
