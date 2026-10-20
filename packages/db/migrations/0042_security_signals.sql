-- Browser and network evidence for the Free-allowance rules, and the human-check claim. Additive.
--
-- security_links: which accounts were used from which browser (the Studio's first-party id) and
-- network (/24 or /48), stored only as keyed hashes. Nothing is written until
-- app_settings.security_signals_enabled is turned on (default off) and SECURITY_HASH_KEY is set.
CREATE TABLE IF NOT EXISTS "security_links" (
  "kind" text NOT NULL,
  "hash" text NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "security_links_pk" PRIMARY KEY ("kind", "hash", "user_id"),
  CONSTRAINT "security_links_kind_values" CHECK ("kind" IN ('device', 'network'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "security_links_user_idx" ON "security_links" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "security_links_kind_last_seen_idx" ON "security_links" ("kind", "last_seen_at");
--> statement-breakpoint
ALTER TABLE "free_allowance_assessments" DROP CONSTRAINT IF EXISTS "free_allowance_assessments_kind_values";
--> statement-breakpoint
ALTER TABLE "free_allowance_assessments" ADD CONSTRAINT "free_allowance_assessments_kind_values" CHECK ("kind" IN ('signup', 'renewal', 'evidence', 'claim', 'operator'));
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "security_signals_enabled" boolean DEFAULT false NOT NULL;
