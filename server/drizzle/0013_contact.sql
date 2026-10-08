CREATE TABLE "mp_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"race_id" text,
	"kind" text NOT NULL,
	"fault_id" text,
	"victim_id" text,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mp_race_players" ADD COLUMN "incidents" jsonb;--> statement-breakpoint
ALTER TABLE "mp_race_players" ADD COLUMN "safety_before" real;--> statement-breakpoint
ALTER TABLE "mp_race_players" ADD COLUMN "safety_after" real;--> statement-breakpoint
ALTER TABLE "mp_races" ADD COLUMN "contacts" jsonb;--> statement-breakpoint
ALTER TABLE "mp_ratings" ADD COLUMN "safety" real DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "mp_ratings" ADD COLUMN "safety_races" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "mp_evidence_race" ON "mp_evidence" USING btree ("race_id");