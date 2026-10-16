-- Sample reference images the team uploads for every Studio user, shown as categories in the
-- reference library. Images live under stock/ in storage (storage_objects kind "stock").
--
-- Additive only.

CREATE TABLE IF NOT EXISTS "stock_references" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- windows | roof | doors | pillars | outdoors | exterior
  "category" text NOT NULL,
  "key" text NOT NULL UNIQUE,
  "caption" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "hidden" boolean DEFAULT false NOT NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "stock_references_category_idx" ON "stock_references" ("category", "sort_order");
