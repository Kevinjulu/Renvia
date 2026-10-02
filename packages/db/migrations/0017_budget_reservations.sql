CREATE TABLE "budget_reservations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "cost_micros" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "budget_reservations_cost_non_negative" CHECK ("budget_reservations"."cost_micros" >= 0)
);
