CREATE TABLE "billing_plans" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "slug" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "description" text NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "price_cents" integer DEFAULT 0 NOT NULL,
  "interval" text DEFAULT 'none' NOT NULL,
  "monthly_credits" integer DEFAULT 0 NOT NULL,
  "rollover_credits" integer DEFAULT 0 NOT NULL,
  "daily_render_limit" integer,
  "monthly_render_limit" integer,
  "max_projects" integer,
  "concurrent_render_limit" integer,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "billing_plans_price_non_negative" CHECK ("price_cents" >= 0),
  CONSTRAINT "billing_plans_monthly_credits_non_negative" CHECK ("monthly_credits" >= 0),
  CONSTRAINT "billing_plans_rollover_non_negative" CHECK ("rollover_credits" >= 0 AND "rollover_credits" <= "monthly_credits"),
  CONSTRAINT "billing_plans_daily_limit_range" CHECK ("daily_render_limit" IS NULL OR "daily_render_limit" BETWEEN 1 AND 10000),
  CONSTRAINT "billing_plans_monthly_limit_range" CHECK ("monthly_render_limit" IS NULL OR "monthly_render_limit" BETWEEN 1 AND 100000),
  CONSTRAINT "billing_plans_max_projects_range" CHECK ("max_projects" IS NULL OR "max_projects" BETWEEN 1 AND 10000),
  CONSTRAINT "billing_plans_concurrent_limit_range" CHECK ("concurrent_render_limit" IS NULL OR "concurrent_render_limit" BETWEEN 1 AND 100)
);--> statement-breakpoint

CREATE TABLE "user_entitlements" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL UNIQUE REFERENCES "users"("id"),
  "plan_id" uuid NOT NULL REFERENCES "billing_plans"("id"),
  "status" text DEFAULT 'active' NOT NULL,
  "provider" text,
  "provider_customer_id" text,
  "provider_subscription_id" text,
  "current_period_start" timestamp with time zone,
  "current_period_end" timestamp with time zone,
  "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  "monthly_credits_remaining" integer DEFAULT 0 NOT NULL,
  "next_credit_grant_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_entitlements_monthly_credits_non_negative" CHECK ("monthly_credits_remaining" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX "user_entitlements_provider_subscription_unique" ON "user_entitlements" ("provider", "provider_subscription_id");--> statement-breakpoint
CREATE INDEX "user_entitlements_grant_due_idx" ON "user_entitlements" ("status", "next_credit_grant_at");--> statement-breakpoint

CREATE TABLE "credit_packs" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "sku" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "price_cents" integer NOT NULL,
  "credits" integer NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "credit_packs_price_positive" CHECK ("price_cents" > 0),
  CONSTRAINT "credit_packs_credits_positive" CHECK ("credits" > 0)
);--> statement-breakpoint

CREATE TABLE "billing_checkouts" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "plan_id" uuid REFERENCES "billing_plans"("id"),
  "credit_pack_id" uuid REFERENCES "credit_packs"("id"),
  "kind" text NOT NULL,
  "provider" text NOT NULL,
  "provider_checkout_id" text UNIQUE,
  "status" text DEFAULT 'created' NOT NULL,
  "currency" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "billing_checkouts_amount_non_negative" CHECK ("amount_cents" >= 0),
  CONSTRAINT "billing_checkouts_one_product" CHECK (("plan_id" IS NOT NULL) <> ("credit_pack_id" IS NOT NULL))
);--> statement-breakpoint
CREATE INDEX "billing_checkouts_user_created_idx" ON "billing_checkouts" ("user_id", "created_at");--> statement-breakpoint

CREATE TABLE "billing_payments" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "checkout_id" uuid REFERENCES "billing_checkouts"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "provider" text NOT NULL,
  "provider_payment_id" text NOT NULL,
  "status" text NOT NULL,
  "currency" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "paid_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "billing_payments_amount_non_negative" CHECK ("amount_cents" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX "billing_payments_provider_payment_unique" ON "billing_payments" ("provider", "provider_payment_id");--> statement-breakpoint
CREATE INDEX "billing_payments_user_created_idx" ON "billing_payments" ("user_id", "created_at");--> statement-breakpoint

CREATE TABLE "billing_invoices" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "payment_id" uuid REFERENCES "billing_payments"("id"),
  "provider" text NOT NULL,
  "provider_invoice_id" text,
  "number" text NOT NULL UNIQUE,
  "status" text NOT NULL,
  "currency" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "hosted_url" text,
  "pdf_url" text,
  "issued_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "billing_invoices_amount_non_negative" CHECK ("amount_cents" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX "billing_invoices_provider_invoice_unique" ON "billing_invoices" ("provider", "provider_invoice_id");--> statement-breakpoint
CREATE INDEX "billing_invoices_user_issued_idx" ON "billing_invoices" ("user_id", "issued_at");--> statement-breakpoint

CREATE TABLE "billing_webhook_events" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "provider" text NOT NULL,
  "provider_event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "processed_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "failure_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "billing_webhook_events_provider_event_unique" ON "billing_webhook_events" ("provider", "provider_event_id");--> statement-breakpoint

INSERT INTO "billing_plans" ("id", "slug", "name", "description", "price_cents", "interval", "monthly_credits", "rollover_credits", "daily_render_limit", "monthly_render_limit", "max_projects", "concurrent_render_limit") VALUES
  ('11111111-1111-4111-8111-111111111111', 'starter', 'Starter', 'Free plan with a one-time welcome credit grant.', 0, 'none', 0, 0, 5, 25, 2, 1),
  ('22222222-2222-4222-8222-222222222222', 'studio', 'Studio', 'Professional monthly rendering workspace.', 2900, 'month', 200, 0, 50, 200, 50, 3),
  ('33333333-3333-4333-8333-333333333333', 'team', 'Team', 'High-volume monthly workspace for design teams.', 7900, 'month', 600, 0, 150, 600, 200, 8)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint

INSERT INTO "credit_packs" ("id", "sku", "name", "price_cents", "credits") VALUES
  ('44444444-4444-4444-8444-444444444444', 'credits-50', '50 credits', 900, 50),
  ('55555555-5555-4555-8555-555555555555', 'credits-150', '150 credits', 2500, 150)
ON CONFLICT ("sku") DO NOTHING;--> statement-breakpoint

INSERT INTO "user_entitlements" ("user_id", "plan_id", "status")
SELECT "id", '11111111-1111-4111-8111-111111111111', 'active'
FROM "users"
ON CONFLICT ("user_id") DO NOTHING;
