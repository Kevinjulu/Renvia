ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "credit_balance" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_credit_balance_non_negative" CHECK ("credit_balance" >= 0);
--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN "credits_charged" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "render_id" uuid;
--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "note" text;
--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "actor_id" uuid;
--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_render_id_renders_id_fk" FOREIGN KEY ("render_id") REFERENCES "public"."renders"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_render_reason_unique" ON "credit_ledger" USING btree ("render_id","reason");
--> statement-breakpoint
CREATE INDEX "credit_ledger_user_created_idx" ON "credit_ledger" USING btree ("user_id","created_at");
--> statement-breakpoint
-- Everyone who signed up before credits existed starts with the same 25 as new users.
UPDATE "users" SET "credit_balance" = 25;
--> statement-breakpoint
INSERT INTO "credit_ledger" ("user_id", "amount", "reason", "note") SELECT "id", 25, 'initial_grant', 'Credits introduced' FROM "users";
