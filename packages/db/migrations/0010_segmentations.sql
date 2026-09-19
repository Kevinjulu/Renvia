CREATE TABLE "segmentations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"image_url" text NOT NULL,
	"prompt" text,
	"point" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"object_count" integer,
	"model" text NOT NULL,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "segmentations" ADD CONSTRAINT "segmentations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "segmentations_user_created_idx" ON "segmentations" USING btree ("user_id","created_at");
--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "segmentation_id" uuid;
--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_segmentation_id_segmentations_id_fk" FOREIGN KEY ("segmentation_id") REFERENCES "public"."segmentations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_segmentation_reason_unique" ON "credit_ledger" USING btree ("segmentation_id","reason");
