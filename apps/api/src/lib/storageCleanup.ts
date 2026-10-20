import { sql, type SQL } from "drizzle-orm";
import type { Database } from "@renvia/db";
import type { Env } from "../index.js";
import { CLOSED_STATUSES } from "./betaFeedback.js";
import { deleteObject } from "./storage.js";

/**
 * Storage only grows unless something removes what nothing uses. This daily sweep deletes:
 *
 * - uploads (sources, references, selection masks) that no project, canvas, asset, render or
 *   open beta report points at any more, once they're older than UPLOAD_GRACE;
 * - the files of renders the owner removed from history more than HIDDEN_GRACE ago, or whose
 *   project was deleted, unless something else still points at them (an edit made from them,
 *   a canvas node, a reference, an open beta report).
 *
 * "Points at" means the stored key, or the render's id in a renders/ key, appears in a live row.
 * Rows of renders hidden past the grace don't count, so their own links don't keep them alive.
 * The render rows themselves stay: spend caps, credit history and the admin log still count them.
 */
const UPLOAD_GRACE = "3 days";
const HIDDEN_GRACE = "7 days";
/** Nothing younger than this is touched, so a file is never deleted while its row is being written. */
const MIN_AGE = "1 hour";
/** Objects per kind per run; a backlog clears over a few days. */
const BATCH = 500;
/** Deletes in flight at once. */
const PARALLEL = 10;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Every live text that may hold one of our image links. */
function liveText(): SQL {
  const closed = sql.join(CLOSED_STATUSES.map((status) => sql`${status}`), sql`, `);
  return sql`
    select thumbnail_url as t from projects where thumbnail_url is not null
    union all select data::text from canvas_nodes
    union all select url from reference_images
    union all select concat_ws(' ', source_image_url, result_image_url, settings::text) from renders
      where hidden_at is null or hidden_at > now() - ${HIDDEN_GRACE}::interval
    union all select image_url from segmentations where created_at > now() - ${UPLOAD_GRACE}::interval
    union all select concat_ws(' ', 'renders/' || render_id::text, diagnostics::text, annotations::text) from beta_feedback
      where status not in (${closed})
  `;
}

/** Uploads nothing points at, each with its thumbnail when one was made. */
export async function unusedUploads(db: Database, limit = BATCH): Promise<string[]> {
  const result = await db.execute<{ key: string; thumb: string | null }>(sql`
    with live as (${liveText()}),
    referenced as (
      select distinct m[1] as key from live, regexp_matches(live.t, '(elevations/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)', 'g') as m
    )
    select o.key, t.key as thumb
    from storage_objects o
    left join storage_objects t on t.key = 'thumbs/' || o.key || '.webp'
    where o.kind = 'upload' and starts_with(o.key, 'elevations/')
      and o.created_at < now() - ${UPLOAD_GRACE}::interval
      and not exists (select 1 from referenced r where r.key = o.key)
    order by o.created_at
    limit ${limit}
  `);
  return result.rows.flatMap((row) => (row.thumb ? [row.key, row.thumb] : [row.key]));
}

/** Results, watermarked copies and thumbnails of renders that are hidden or gone, and unused. */
export async function unusedRenderFiles(db: Database, limit = BATCH): Promise<string[]> {
  const result = await db.execute<{ key: string }>(sql`
    with live as (${liveText()}),
    referenced as (
      select distinct (m[1])::uuid as id from live, regexp_matches(live.t, ${`renders/(${UUID})`}, 'g') as m
    ),
    files as (
      select o.key, o.created_at, (substring(o.key from ${`renders/(${UUID})`}))::uuid as render_id
      from storage_objects o
      where o.kind in ('render', 'watermark', 'thumbnail') and o.created_at < now() - ${MIN_AGE}::interval
    )
    select f.key
    from files f
    left join renders r on r.id = f.render_id
    where f.render_id is not null
      and (r.id is null or r.hidden_at < now() - ${HIDDEN_GRACE}::interval)
      and not exists (select 1 from referenced x where x.id = f.render_id)
    order by f.created_at
    limit ${limit}
  `);
  return result.rows.map((row) => row.key);
}

/** Deletes `keys`, a few at a time; a failure is logged and left for the next run. */
async function deleteAll(env: Env, keys: string[]): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  for (let index = 0; index < keys.length; index += PARALLEL) {
    const results = await Promise.allSettled(keys.slice(index, index + PARALLEL).map((key) => deleteObject(env, key)));
    results.forEach((outcome, offset) => {
      if (outcome.status === "fulfilled") deleted += 1;
      else {
        failed += 1;
        const error = outcome.reason;
        console.error(JSON.stringify({ level: "warn", event: "storage.cleanup_delete_failed", key: keys[index + offset], error: error instanceof Error ? error.message : String(error) }));
      }
    });
  }
  return { deleted, failed };
}

export async function runStorageCleanup(env: Env, db: Database) {
  const uploads = await deleteAll(env, await unusedUploads(db));
  const renders = await deleteAll(env, await unusedRenderFiles(db));
  return { uploadsDeleted: uploads.deleted, renderFilesDeleted: renders.deleted, failed: uploads.failed + renders.failed };
}
