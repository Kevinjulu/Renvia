import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { STUDIO_FEATURES, type AdminModel, type AdminModelsResponse, type RenderEngineMode, type RenderRoute } from "@renvia/types";
import { modelRoutes } from "../../lib/models.js";
import { SAM_CLICK_MODEL_ID, SAM_COST_MICROS, SAM_MODEL_ID } from "../../lib/segment.js";
import { effectiveEngineMode, getSettings } from "../../lib/settings.js";
import { currentStudioRevision, featureModels, type SelectionRoute } from "../../lib/studioControl.js";
import { denyUnless } from "./permissions.js";
import { AGGREGATES, counts, jobs, stats, type Row } from "./performance.js";
import { MICROS_PER_USD } from "./shared.js";
import { publishOrRequest } from "./studioControl.js";
import type { AdminContext } from "./context.js";

export const modelsRoutes = new Hono<AdminContext>();

interface CatalogEntry {
  id: string;
  costMicros: number;
  serves: { mode: RenderEngineMode; route: RenderRoute | SelectionRoute }[];
}

/**
 * The models Renvia's code can call. A model's request format is code, so the registry can hold
 * one back but can't route a job to a model that wasn't built for it.
 */
function catalog(): CatalogEntry[] {
  const byId = new Map<string, CatalogEntry>();
  for (const { mode, route, model } of modelRoutes()) {
    const entry = byId.get(model.id) ?? { id: model.id, costMicros: model.costMicros, serves: [] };
    entry.serves.push({ mode, route });
    byId.set(model.id, entry);
  }
  for (const [id, route] of [[SAM_MODEL_ID, "selection"], [SAM_CLICK_MODEL_ID, "selection-click"]] as const) {
    const sam = byId.get(id) ?? { id, costMicros: SAM_COST_MICROS, serves: [] };
    sam.serves.push({ mode: "dev", route }, { mode: "prod", route });
    byId.set(id, sam);
    byId.get("mock")?.serves.push({ mode: "mock", route });
  }
  return [...byId.values()];
}

modelsRoutes.get("/models", async (c) => {
  const denied = denyUnless(c, "studio.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const [settings, revision] = await Promise.all([getSettings(db), currentStudioRevision(db)]);
  const mode = effectiveEngineMode(c.env, settings);
  // Seven days of jobs by the model that ran their first pass, plus automatic selections.
  const [renderStats, selectionStats] = await Promise.all([
    db.execute<Row>(sql`with j as (${jobs("7d")}) select model, max(created_at) as last_used, ${AGGREGATES} from j group by model`),
    db.execute<Row>(sql`select model, count(*)::int as total,
        count(*) filter (where status = 'succeeded')::int as succeeded,
        count(*) filter (where status = 'failed')::int as failed,
        coalesce(sum(cost_micros) filter (where status <> 'failed'), 0)::bigint as cost_micros,
        max(created_at) as last_used
      from segmentations where created_at >= now() - interval '7 days' group by model`),
  ]);
  const renderRows = new Map(renderStats.rows.map((row) => [String(row.model), row]));
  const selectionRows = new Map(selectionStats.rows.map((row) => [String(row.model), row]));

  const models = catalog().map((entry): AdminModel => {
    const render = renderRows.get(entry.id);
    const selection = selectionRows.get(entry.id);
    const renderCounts = render ? counts(render) : null;
    const jobsTotal = (renderCounts?.total ?? 0) + Number(selection?.total ?? 0);
    const succeeded = (renderCounts?.succeeded ?? 0) + Number(selection?.succeeded ?? 0);
    const failed = (renderCounts?.failed ?? 0) + Number(selection?.failed ?? 0);
    // Measured timings where jobs have lifecycle events, otherwise the timestamp estimate.
    const measured = render ? stats(render, "e2e") : null;
    const latency = measured && measured.samples > 0 ? measured : render ? stats(render, "est") : null;
    const lastUsed = [render?.last_used, selection?.last_used].filter(Boolean).map((value) => new Date(value as string)).sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      id: entry.id,
      provider: entry.id === "mock" ? "mock" : "fal",
      costUsd: entry.costMicros / MICROS_PER_USD,
      serves: entry.serves,
      inUse: entry.serves.some((serve) => serve.mode === mode),
      rule: revision.config.models?.[entry.id] ?? { paused: false, message: null },
      affects: STUDIO_FEATURES.map((feature) => feature.key).filter((key) => featureModels(mode, key).includes(entry.id)),
      stats: {
        jobs: jobsTotal,
        succeeded,
        failed,
        successRate: succeeded + failed > 0 ? succeeded / (succeeded + failed) : null,
        p50Ms: latency?.p50Ms ?? null,
        p95Ms: latency?.p95Ms ?? null,
        samples: latency?.samples ?? 0,
        costUsd: (Number(render?.generation_micros ?? 0) + Number(render?.upscale_micros ?? 0) + Number(selection?.cost_micros ?? 0)) / MICROS_PER_USD,
        lastUsedAt: lastUsed?.toISOString() ?? null,
      },
    };
  });
  // Models serving the current mode first, then the rest.
  models.sort((a, b) => Number(b.inUse) - Number(a.inUse) || b.stats.jobs - a.stats.jobs || a.id.localeCompare(b.id));
  const response: AdminModelsResponse = { mode, configVersion: revision.version, models };
  return c.json(response);
});

/**
 * Pauses or resumes one model. A paused model takes no new jobs; jobs already running finish.
 * It's a Studio Control change: versioned, audited, and held for approval when that rule is on.
 */
modelsRoutes.post("/models/hold", async (c) => {
  const denied = denyUnless(c, "studio.manage"); if (denied) return c.json(denied, 403);
  const body = z
    .object({ modelId: z.string().min(1).max(200), paused: z.boolean(), message: z.string().trim().max(280).nullable(), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(1).max(300) })
    .parse(await c.req.json());
  if (!catalog().some((entry) => entry.id === body.modelId)) return c.json({ error: "Unknown model" }, 404);
  const current = await currentStudioRevision(c.get("db"));
  const models = { ...(current.config.models ?? {}) };
  if (body.paused) models[body.modelId] = { paused: true, message: body.message || null };
  else delete models[body.modelId];
  return publishOrRequest(c, { expectedVersion: body.expectedVersion, config: { ...current.config, models }, reason: body.reason });
});
