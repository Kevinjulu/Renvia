-- Every "Polish prompt" request, for the per-user daily cap and so its AI cost counts toward the
-- fal spending cap like renders and selections do. Polishing is free to users (no credits).
--
-- Additive only.

CREATE TABLE IF NOT EXISTS "prompt_polishes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  -- render | edit
  "kind" text NOT NULL,
  -- ai: rewritten by the language model; rules: the deterministic fallback, which costs nothing
  "engine" text NOT NULL,
  "model" text,
  -- succeeded | failed
  "status" text NOT NULL,
  "cost_micros" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "prompt_polishes_user_created_idx" ON "prompt_polishes" ("user_id", "created_at");
