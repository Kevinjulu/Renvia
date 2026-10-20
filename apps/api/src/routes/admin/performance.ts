import { Hono } from "hono";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type {
  AdminFailureCategory,
  AdminFailureGroup,
  AdminLatencyStats,
  AdminPerformanceCounts,
  AdminPerformanceCosts,
  AdminPerformanceFailuresResponse,
  AdminPerformanceRange,
  AdminPerformanceRow,
  AdminPerformanceSummaryResponse,
  AdminPerformanceTimeseriesResponse,
  AdminPerformanceTimings,
} from "@renvia/types";
import { UPSCALE_COST_MICROS } from "../../lib/models.js";
import { denyUnless } from "./permissions.js";
import { MICROS_PER_USD } from "./shared.js";
import type { AdminContext } from "./context.js";

export const performanceRoutes = new Hono<AdminContext>();

const RANGE_INTERVAL: Record<AdminPerformanceRange, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days" };
const rangeSchema = z.enum(["24h", "7d", "30d"]).default("7d");

/** Percentiles over fewer samples than this are flagged as weak. */
const WEAK_SAMPLE_SIZE = 20;

function since(range: AdminPerformanceRange): SQL {
  return sql`now() - ${RANGE_INTERVAL[range]}::interval`;
}

/**
 * One row per render created in the range, with its timings. Timings come from the lifecycle
 * events the renders trigger writes; renders from before that have none (has_events = false).
 * The model is the first pass's — a high-resolution job's renders.model ends as the upscaler.
 */
export function jobs(range: AdminPerformanceRange): SQL {
  return sql`
    select r.id, r.status, r.job_type, r.output_resolution, r.cost_micros, r.credits_charged,
           r.created_at, r.updated_at, r.error_message,
           r.settings -> 'highRes' ->> 'error' as upscale_error,
           coalesce(ev.render_model, r.model, 'unknown') as model,
           coalesce(ev.has_events, false) as has_events,
           ev.first_submitted, ev.first_pass_done, ev.completed_at, ev.upscale_started, ev.upscale_completed,
           -- Upscale share of the estimated cost: the whole job for a standalone upscale, the
           -- target's price for a high-res render whose upscale ran (a failed one stops counting).
           case
             when r.job_type = 'upscale' then r.cost_micros
             when r.output_resolution is not null and r.status <> 'failed' and r.settings -> 'highRes' ->> 'error' is null
               then least(r.cost_micros, case r.output_resolution when '4k' then ${UPSCALE_COST_MICROS["4k"]}::int when '8k' then ${UPSCALE_COST_MICROS["8k"]}::int else 0 end)
             else 0
           end as upscale_micros
    from renders r
    left join lateral (
      select true as has_events,
             min(e.occurred_at) filter (where e.event_type = 'submitted') as first_submitted,
             (array_agg(e.model order by e.occurred_at) filter (where e.event_type = 'submitted'))[1] as render_model,
             min(e.occurred_at) filter (where e.event_type in ('environment_started', 'upscale_started', 'completed', 'failed')) as first_pass_done,
             max(e.occurred_at) filter (where e.event_type = 'completed') as completed_at,
             min(e.occurred_at) filter (where e.event_type = 'upscale_started') as upscale_started,
             max(e.occurred_at) filter (where e.event_type = 'upscale_completed') as upscale_completed
      from render_job_events e
      where e.render_id = r.id
      having count(*) > 0
    ) ev on true
    where r.created_at >= ${since(range)}`;
}

/** The aggregate columns shared by the totals row and each grouped row. */
export const AGGREGATES = sql`
  count(*)::int as total,
  count(*) filter (where status = 'succeeded')::int as succeeded,
  count(*) filter (where status = 'failed' and error_message is distinct from 'Cancelled')::int as failed,
  count(*) filter (where status = 'failed' and error_message = 'Cancelled')::int as cancelled,
  count(*) filter (where status in ('pending', 'processing'))::int as in_flight,
  count(*) filter (where status = 'succeeded' and upscale_error is not null)::int as upscale_failed,
  coalesce(sum(cost_micros - upscale_micros), 0)::bigint as generation_micros,
  coalesce(sum(upscale_micros), 0)::bigint as upscale_micros,
  coalesce(sum(credits_charged), 0)::int as credits_charged,
  ${latency("e2e", sql`completed_at - created_at`, sql`status = 'succeeded' and has_events and completed_at is not null`)},
  ${latency("est", sql`updated_at - created_at`, sql`status = 'succeeded' and completed_at is null`)},
  ${latency("submit", sql`first_submitted - created_at`, sql`first_submitted is not null`)},
  ${latency("provider", sql`first_pass_done - first_submitted`, sql`first_submitted is not null and first_pass_done is not null`)},
  ${latency("upscale", sql`upscale_completed - upscale_started`, sql`upscale_completed is not null and upscale_started is not null`)}`;

function latency(prefix: string, interval: SQL, where: SQL): SQL {
  const ms = sql`extract(epoch from (${interval})) * 1000`;
  const pct = (fraction: number, suffix: string) =>
    sql`percentile_cont(${sql.raw(String(fraction))}) within group (order by ${ms}) filter (where ${where}) as ${sql.raw(`${prefix}_${suffix}`)}`;
  return sql`
    count(*) filter (where ${where})::int as ${sql.raw(`${prefix}_samples`)},
    ${pct(0.5, "p50")}, ${pct(0.95, "p95")}, ${pct(0.99, "p99")}`;
}

/** A percentile column, rounded to whole milliseconds. */
function ms(value: unknown): number | null {
  return value == null ? null : Math.round(Number(value));
}

export type Row = Record<string, unknown>;

export function stats(row: Row, prefix: string): AdminLatencyStats {
  const samples = Number(row[`${prefix}_samples`] ?? 0);
  return { samples, p50Ms: ms(row[`${prefix}_p50`]), p95Ms: ms(row[`${prefix}_p95`]), p99Ms: ms(row[`${prefix}_p99`]), weak: samples < WEAK_SAMPLE_SIZE };
}

export function counts(row: Row): AdminPerformanceCounts {
  const succeeded = Number(row.succeeded);
  const failed = Number(row.failed);
  return {
    total: Number(row.total),
    succeeded,
    failed,
    cancelled: Number(row.cancelled),
    inFlight: Number(row.in_flight),
    successRate: succeeded + failed > 0 ? succeeded / (succeeded + failed) : null,
    upscaleFailed: Number(row.upscale_failed),
  };
}

export function costs(row: Row): AdminPerformanceCosts {
  const generationUsd = Number(row.generation_micros) / MICROS_PER_USD;
  const upscaleUsd = Number(row.upscale_micros) / MICROS_PER_USD;
  const succeeded = Number(row.succeeded);
  return { generationUsd, upscaleUsd, costPerSuccessUsd: succeeded > 0 ? (generationUsd + upscaleUsd) / succeeded : null, creditsCharged: Number(row.credits_charged) };
}

function timings(row: Row): AdminPerformanceTimings {
  return { endToEnd: stats(row, "e2e"), estimatedEndToEnd: stats(row, "est"), submission: stats(row, "submit"), provider: stats(row, "provider"), upscale: stats(row, "upscale") };
}

function parseRange(value: string | undefined): AdminPerformanceRange {
  return rangeSchema.parse(value || undefined);
}

performanceRoutes.get("/performance/summary", async (c) => {
  const denied = denyUnless(c, "renders.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const range = parseRange(c.req.query("range"));
  const [totals, grouped, segs, coverage] = await Promise.all([
    db.execute<Row>(sql`with j as (${jobs(range)}) select ${AGGREGATES} from j`),
    db.execute<Row>(sql`with j as (${jobs(range)})
      select job_type, model, output_resolution, ${AGGREGATES} from j
      group by job_type, model, output_resolution
      order by count(*) desc, job_type, model`),
    db.execute<Row>(sql`select
        count(*)::int as total,
        count(*) filter (where status = 'succeeded')::int as succeeded,
        count(*) filter (where status = 'failed')::int as failed,
        count(*) filter (where status = 'pending')::int as pending,
        coalesce(sum(cost_micros), 0)::bigint as cost_micros
      from segmentations where created_at >= ${since(range)}`),
    db.execute<Row>(sql`select count(*)::int as total,
        count(*) filter (where exists (select 1 from render_job_events e where e.render_id = r.id))::int as with_events
      from renders r where r.created_at >= ${since(range)}`),
  ]);
  const total = totals.rows[0]!;
  const seg = segs.rows[0]!;
  const segFinished = Number(seg.succeeded) + Number(seg.failed);
  const response: AdminPerformanceSummaryResponse = {
    range,
    generatedAt: new Date().toISOString(),
    totals: { ...counts(total), ...costs(total), ...timings(total) },
    rows: grouped.rows.map((row): AdminPerformanceRow => ({
      jobType: String(row.job_type ?? "photo"),
      model: String(row.model),
      outputResolution: (row.output_resolution as "4k" | "8k" | null) ?? null,
      ...counts(row),
      ...costs(row),
      ...timings(row),
    })),
    segmentations: {
      total: Number(seg.total),
      succeeded: Number(seg.succeeded),
      failed: Number(seg.failed),
      pending: Number(seg.pending),
      failureRate: segFinished > 0 ? Number(seg.failed) / segFinished : null,
      costUsd: Number(seg.cost_micros) / MICROS_PER_USD,
    },
    coverage: { withEvents: Number(coverage.rows[0]!.with_events), total: Number(coverage.rows[0]!.total) },
  };
  return c.json(response);
});

performanceRoutes.get("/performance/timeseries", async (c) => {
  const denied = denyUnless(c, "renders.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const range = parseRange(c.req.query("range"));
  const bucket = range === "24h" ? "hour" : "day";
  const step = bucket === "hour" ? "1 hour" : "1 day";
  // Measured timings where a job has events, estimated from timestamps where it doesn't.
  const result = await db.execute<Row>(sql`
    with j as (${jobs(range)}),
    buckets as (
      select generate_series(date_trunc(${bucket}, ${since(range)}), date_trunc(${bucket}, now()), ${step}::interval) as start
    )
    select b.start,
           count(j.id)::int as total,
           count(j.id) filter (where j.status = 'succeeded')::int as succeeded,
           count(j.id) filter (where j.status = 'failed' and j.error_message is distinct from 'Cancelled')::int as failed,
           coalesce(sum(j.cost_micros), 0)::bigint as cost_micros,
           count(j.id) filter (where j.status = 'succeeded')::int as samples,
           percentile_cont(0.5) within group (order by extract(epoch from (coalesce(j.completed_at, j.updated_at) - j.created_at)) * 1000)
             filter (where j.status = 'succeeded') as p50,
           percentile_cont(0.95) within group (order by extract(epoch from (coalesce(j.completed_at, j.updated_at) - j.created_at)) * 1000)
             filter (where j.status = 'succeeded') as p95
    from buckets b
    left join j on date_trunc(${bucket}, j.created_at) = b.start
    group by b.start
    order by b.start`);
  const response: AdminPerformanceTimeseriesResponse = {
    range,
    bucket,
    points: result.rows.map((row) => ({
      start: new Date(row.start as string).toISOString(),
      total: Number(row.total),
      succeeded: Number(row.succeeded),
      failed: Number(row.failed),
      costUsd: Number(row.cost_micros) / MICROS_PER_USD,
      samples: Number(row.samples),
      p50Ms: ms(row.p50),
      p95Ms: ms(row.p95),
    })),
  };
  return c.json(response);
});

/**
 * Sorts an error message into a category. Keyword rules over the stored text, so it works on
 * every failure ever recorded; the raw message stays on the render for debugging.
 */
const CATEGORY = (message: SQL) => sql`case
    when lower(${message}) = 'cancelled' then 'cancelled'
    when lower(${message}) like '%timed out%' or lower(${message}) like '%timeout%' then 'timeout'
    when lower(${message}) like '%never submitted%' then 'submission'
    when lower(${message}) like '%returned no image%' or lower(${message}) like '%without dimensions%' then 'provider_output'
    when lower(${message}) ~ '(nsfw|safety|content policy|moderation|flagged)' then 'content_policy'
    when lower(${message}) ~ '(download|storage|upload|bucket|s3)' then 'storage'
    when lower(${message}) ~ '(invalid|unprocessable|unsupported|not supported|must be|too large|too small)' then 'invalid_input'
    when lower(${message}) ~ '([[:<:]]fal[[:>:]]|provider|rate limit|unavailable|overloaded|[[:<:]]5[0-9][0-9][[:>:]]|[[:<:]]429[[:>:]])' then 'provider'
    else 'internal'
  end`;

/** The message with ids and numbers masked, so one recurring problem groups together. */
const NORMALIZED = (message: SQL) => sql`left(regexp_replace(regexp_replace(lower(coalesce(${message}, 'no error message')),
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<id>', 'g'), '[0-9]+', '#', 'g'), 160)`;

performanceRoutes.get("/performance/failures", async (c) => {
  const denied = denyUnless(c, "renders.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const range = parseRange(c.req.query("range"));
  const classified = sql`
    with failures as (
      select 'render' as source, r.id, r.job_type, coalesce(r.model, 'unknown') as model, r.error_message as message, p.owner_id as user_id, r.updated_at as at
      from renders r join projects p on p.id = r.project_id
      where r.status = 'failed' and r.created_at >= ${since(range)}
      union all
      select 'upscale', r.id, r.job_type, coalesce(r.model, 'unknown'), r.settings -> 'highRes' ->> 'error', p.owner_id, r.updated_at
      from renders r join projects p on p.id = r.project_id
      where r.status = 'succeeded' and r.settings -> 'highRes' ->> 'error' is not null and r.created_at >= ${since(range)}
      union all
      select 'segmentation', s.id, 'selection', s.model, s.error_message, s.user_id, s.created_at
      from segmentations s
      where s.status = 'failed' and s.created_at >= ${since(range)}
    ),
    classified as (
      select f.*, ${CATEGORY(sql`f.message`)} as category, ${NORMALIZED(sql`f.message`)} as normalized from failures f
    )`;
  const [result, categories] = await Promise.all([
    db.execute<Row>(sql`${classified}
    select source, category, job_type, model, normalized,
           count(*)::int as count,
           count(distinct user_id)::int as affected_users,
           min(at) as first_seen, max(at) as last_seen,
           (array_agg(id order by at desc))[1] as sample_id
    from classified
    group by source, category, job_type, model, normalized
    order by count(*) desc, max(at) desc
    limit 100`),
    db.execute<Row>(sql`${classified} select category, count(*)::int as count from classified group by category order by count(*) desc`),
  ]);

  const groups = result.rows.map((row): AdminFailureGroup => ({
    fingerprint: [row.source, row.category, row.job_type, row.model, row.normalized].join("|"),
    source: row.source as AdminFailureGroup["source"],
    category: row.category as AdminFailureCategory,
    jobType: String(row.job_type ?? "photo"),
    model: String(row.model),
    message: String(row.normalized),
    count: Number(row.count),
    affectedUsers: Number(row.affected_users),
    firstSeen: new Date(row.first_seen as string).toISOString(),
    lastSeen: new Date(row.last_seen as string).toISOString(),
    sampleId: String(row.sample_id),
  }));
  const response: AdminPerformanceFailuresResponse = {
    range,
    byCategory: categories.rows.map((row) => ({ category: row.category as AdminFailureCategory, count: Number(row.count) })),
    groups,
  };
  return c.json(response);
});
