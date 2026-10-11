-- Object storage accounting for Cloudflare R2's free tier (10 GB). Every object the API writes
-- is recorded with its size, so usage is a cheap indexed sum here instead of a paid bucket
-- listing, and the API can refuse new work before stored files cross the operator's cap.
--
-- Additive only.

CREATE TABLE IF NOT EXISTS "storage_objects" (
  "key" text PRIMARY KEY NOT NULL,
  "bytes" bigint NOT NULL,
  "content_type" text NOT NULL,
  -- upload | render | watermark
  "kind" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "storage_objects_bytes_non_negative" CHECK ("bytes" >= 0)
);
CREATE INDEX IF NOT EXISTS "storage_objects_kind_idx" ON "storage_objects" ("kind");

-- New uploads and renders are refused once stored bytes reach this. Megabytes of 10^6 bytes,
-- as Cloudflare counts them; at most 10 000 (the free tier), 9 000 by default for headroom.
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "storage_cap_mb" integer DEFAULT 9000 NOT NULL;
DO $$ BEGIN
  ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_storage_cap_range" CHECK ("storage_cap_mb" BETWEEN 100 AND 10000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
