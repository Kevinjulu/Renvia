-- Render telemetry for the admin Performance page, the scheduled-job ledger behind frequent
-- incident sync, and indexes for the admin's hot queries.
--
-- Additive only: two generated columns, two new tables, one trigger, and indexes. No existing
-- column changes meaning, and nothing reads the new objects except the admin performance API.
-- Adding the generated columns rewrites "renders" once; the indexes are built with plain
-- CREATE INDEX because drizzle-kit runs each migration in a transaction (no CONCURRENTLY).

-- What kind of job a render is. Mirrors renderRouteFor in packages/types — keep them in step.
ALTER TABLE "renders" ADD COLUMN IF NOT EXISTS "job_type" text GENERATED ALWAYS AS (
  CASE
    WHEN jsonb_typeof("settings" -> 'upscale') = 'object' THEN 'upscale'
    WHEN jsonb_typeof("settings" -> 'edit') = 'object' THEN
      CASE WHEN coalesce(jsonb_array_length(CASE WHEN jsonb_typeof("settings" -> 'referenceImageUrls') = 'array' THEN "settings" -> 'referenceImageUrls' END), 0) > 0
        THEN 'edit-references' ELSE 'edit' END
    WHEN coalesce(jsonb_array_length(CASE WHEN jsonb_typeof("settings" -> 'referenceImageUrls') = 'array' THEN "settings" -> 'referenceImageUrls' END), 0) > 0 THEN
      CASE WHEN "settings" -> 'fidelity' ->> 'mode' = 'strict' THEN 'fidelity' ELSE 'references' END
    ELSE coalesce("settings" ->> 'sourceType', 'photo')
  END
) STORED;

-- "4k" or "8k" when the job delivers a high-resolution copy (or is a standalone upscale).
ALTER TABLE "renders" ADD COLUMN IF NOT EXISTS "output_resolution" text GENERATED ALWAYS AS (
  coalesce("settings" -> 'highRes' ->> 'target', "settings" -> 'upscale' ->> 'target')
) STORED;

-- Lifecycle history, one row per transition. Written by the trigger below, so every code path
-- that moves a render (create, fal webhook, polling, sweep, cancel, admin recovery) records its
-- events in the same transaction as the change. Renders from before this migration have none;
-- the admin labels their timings as estimates from created_at/updated_at.
CREATE TABLE IF NOT EXISTS "render_job_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "render_id" uuid NOT NULL REFERENCES "renders"("id") ON DELETE CASCADE,
  -- created | submitted | environment_started | upscale_started | upscale_completed
  -- | upscale_failed | completed | failed | cancelled
  "event_type" text NOT NULL,
  -- Which pass was running: render | environment | upscale.
  "stage" text NOT NULL,
  "provider_request_id" text,
  "model" text,
  "detail" jsonb,
  "occurred_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
CREATE INDEX IF NOT EXISTS "render_job_events_render_time_idx" ON "render_job_events" ("render_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "render_job_events_type_time_idx" ON "render_job_events" ("event_type", "occurred_at");

CREATE OR REPLACE FUNCTION "record_render_job_event"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pass text := CASE
    WHEN NEW."settings" -> 'highRes' ->> 'baseImageUrl' IS NOT NULL THEN 'upscale'
    WHEN NEW."settings" -> 'edit' ->> 'intermediateImageUrl' IS NOT NULL THEN 'environment'
    ELSE 'render'
  END;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "render_job_events" ("render_id", "event_type", "stage", "model", "occurred_at", "detail")
    VALUES (NEW."id", 'created', 'render', NEW."model", NEW."created_at", jsonb_build_object('jobType', NEW."job_type", 'outputResolution', NEW."output_resolution"));
    RETURN NEW;
  END IF;

  IF NEW."settings" -> 'edit' ->> 'intermediateImageUrl' IS NOT NULL AND OLD."settings" -> 'edit' ->> 'intermediateImageUrl' IS NULL THEN
    INSERT INTO "render_job_events" ("render_id", "event_type", "stage", "model") VALUES (NEW."id", 'environment_started', 'environment', NEW."model");
  END IF;
  IF NEW."settings" -> 'highRes' ->> 'baseImageUrl' IS NOT NULL AND OLD."settings" -> 'highRes' ->> 'baseImageUrl' IS NULL THEN
    INSERT INTO "render_job_events" ("render_id", "event_type", "stage", "model") VALUES (NEW."id", 'upscale_started', 'upscale', NEW."model");
  END IF;

  -- First hand-off (pending -> processing; mock renders have no request id), or a later pass
  -- getting its own fal request.
  IF (OLD."status" = 'pending' AND NEW."status" = 'processing')
     OR (NEW."fal_request_id" IS NOT NULL AND NEW."fal_request_id" IS DISTINCT FROM OLD."fal_request_id" AND OLD."status" = 'processing') THEN
    INSERT INTO "render_job_events" ("render_id", "event_type", "stage", "provider_request_id", "model")
    VALUES (NEW."id", 'submitted', pass, NEW."fal_request_id", NEW."model");
  END IF;

  IF NEW."settings" -> 'highRes' ->> 'imageUrl' IS NOT NULL AND OLD."settings" -> 'highRes' ->> 'imageUrl' IS NULL THEN
    INSERT INTO "render_job_events" ("render_id", "event_type", "stage", "model") VALUES (NEW."id", 'upscale_completed', 'upscale', NEW."model");
  END IF;
  IF NEW."settings" -> 'highRes' ->> 'error' IS NOT NULL AND OLD."settings" -> 'highRes' ->> 'error' IS NULL THEN
    INSERT INTO "render_job_events" ("render_id", "event_type", "stage", "model", "detail")
    VALUES (NEW."id", 'upscale_failed', 'upscale', NEW."model", jsonb_build_object('error', left(NEW."settings" -> 'highRes' ->> 'error', 500)));
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" AND NEW."status" = 'succeeded' THEN
    INSERT INTO "render_job_events" ("render_id", "event_type", "stage", "model") VALUES (NEW."id", 'completed', pass, NEW."model");
  ELSIF NEW."status" IS DISTINCT FROM OLD."status" AND NEW."status" = 'failed' THEN
    INSERT INTO "render_job_events" ("render_id", "event_type", "stage", "model", "detail")
    VALUES (NEW."id", CASE WHEN NEW."error_message" = 'Cancelled' THEN 'cancelled' ELSE 'failed' END, pass, NEW."model", jsonb_build_object('error', left(NEW."error_message", 500)));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "renders_record_job_events" ON "renders";
CREATE TRIGGER "renders_record_job_events"
  AFTER INSERT OR UPDATE OF "status", "fal_request_id", "settings" ON "renders"
  FOR EACH ROW EXECUTE FUNCTION "record_render_job_event"();

-- One row per scheduled job: a lease so overlapping runs skip, and the last outcome for the admin.
CREATE TABLE IF NOT EXISTS "scheduled_jobs" (
  "name" text PRIMARY KEY NOT NULL,
  "lease_until" timestamp with time zone,
  "last_started_at" timestamp with time zone,
  "last_success_at" timestamp with time zone,
  "last_failure_at" timestamp with time zone,
  "last_error" text,
  "last_result" jsonb,
  "run_count" integer DEFAULT 0 NOT NULL
);

-- Admin list, overview and performance queries filter renders by status, time, model, project
-- and job type. The only existing renders index is the partial idempotency one.
CREATE INDEX IF NOT EXISTS "renders_status_created_idx" ON "renders" ("status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "renders_created_idx" ON "renders" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "renders_model_created_idx" ON "renders" ("model", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "renders_project_created_idx" ON "renders" ("project_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "renders_job_type_created_idx" ON "renders" ("job_type", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "projects_owner_idx" ON "projects" ("owner_id");
CREATE INDEX IF NOT EXISTS "segmentations_status_created_idx" ON "segmentations" ("status", "created_at" DESC);
