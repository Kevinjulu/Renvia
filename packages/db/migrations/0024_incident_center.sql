CREATE TABLE "incidents" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "fingerprint" text NOT NULL,
  "source_type" text NOT NULL,
  "source_id" text NOT NULL,
  "severity" text NOT NULL DEFAULT 'medium',
  "status" text NOT NULL DEFAULT 'open',
  "title" text NOT NULL,
  "summary" text NOT NULL,
  "context" jsonb,
  "owner_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "acknowledged_at" timestamp with time zone,
  "acknowledged_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "resolved_at" timestamp with time zone,
  "resolved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "resolution_note" text,
  "occurrence_count" integer NOT NULL DEFAULT 1,
  "first_seen_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_seen_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "incidents_status_severity_seen_idx" ON "incidents" ("status", "severity", "last_seen_at");
--> statement-breakpoint
CREATE INDEX "incidents_source_idx" ON "incidents" ("source_type", "source_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_open_fingerprint_unique" ON "incidents" ("fingerprint") WHERE "status" <> 'resolved';
--> statement-breakpoint
CREATE TABLE "incident_events" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "incident_id" uuid NOT NULL REFERENCES "incidents"("id") ON DELETE CASCADE,
  "actor_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "note" text,
  "detail" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "incident_events_incident_created_idx" ON "incident_events" ("incident_id", "created_at");
--> statement-breakpoint
CREATE TABLE "incident_notifications" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "incident_id" uuid NOT NULL REFERENCES "incidents"("id") ON DELETE CASCADE,
  "channel" text NOT NULL DEFAULT 'ops_webhook',
  "status" text NOT NULL,
  "destination" text,
  "failure_message" text,
  "attempted_at" timestamp with time zone NOT NULL DEFAULT now(),
  "delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "incident_notifications_incident_idx" ON "incident_notifications" ("incident_id", "attempted_at");
