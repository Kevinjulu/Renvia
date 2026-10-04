CREATE TABLE "customer_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "author_id" uuid NOT NULL REFERENCES "users"("id"),
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "customer_notes_user_created_idx" ON "customer_notes" ("user_id", "created_at");

CREATE TABLE "customer_tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "normalized_label" text NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "customer_tags_user_label_unique" ON "customer_tags" ("user_id", "normalized_label");

CREATE TABLE "governance_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "bulk_credit_approval_threshold" integer DEFAULT 500 NOT NULL,
  "refund_approval_threshold_cents" integer DEFAULT 5000 NOT NULL,
  "role_change_approval_threshold" integer DEFAULT 1 NOT NULL,
  "maintenance_approval_threshold" integer DEFAULT 1 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" uuid REFERENCES "users"("id"),
  CONSTRAINT "governance_settings_single_row" CHECK ("governance_settings"."id" = 1)
);
INSERT INTO "governance_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "approval_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "action" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "requested_by" uuid NOT NULL REFERENCES "users"("id"),
  "approved_by" uuid REFERENCES "users"("id"),
  "target_type" text NOT NULL,
  "target_id" text,
  "risk_value" integer NOT NULL,
  "threshold" integer NOT NULL,
  "reason" text NOT NULL,
  "payload" jsonb NOT NULL,
  "decision_note" text,
  "approved_at" timestamp with time zone,
  "executed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "approval_requests_status_created_idx" ON "approval_requests" ("status", "created_at");
CREATE TABLE "approval_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "approval_id" uuid NOT NULL REFERENCES "approval_requests"("id") ON DELETE CASCADE,
  "actor_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "approval_events_approval_created_idx" ON "approval_events" ("approval_id", "created_at");

CREATE TABLE "audit_exports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "requested_by" uuid NOT NULL REFERENCES "users"("id"),
  "reason" text NOT NULL,
  "sha256" text NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "audit_exports_created_idx" ON "audit_exports" ("created_at");
