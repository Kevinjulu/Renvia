-- Per-account request rate limits for the routes that cost money or storage (lib/rateLimit.ts):
-- one counter row per account, route group and minute, deleted after a day. Additive.
CREATE TABLE IF NOT EXISTS "rate_limit_hits" (
  "bucket" text NOT NULL,
  "subject" text NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "hits" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "rate_limit_hits_pk" PRIMARY KEY ("bucket", "subject", "window_start")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limit_hits_window_idx" ON "rate_limit_hits" ("window_start");
