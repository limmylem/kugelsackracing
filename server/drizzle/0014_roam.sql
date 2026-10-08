-- Phase 7 Step 4: multiplayer free roam (docs/FREE_ROAM.md). Only adds (docs/OPERATIONS.md safe deploys).
-- each player's free roam: their privacy and contact settings, where they were (saved as they drive and when they leave:
-- they come back there), and the automatic protection's record (ghosted until, how often)
CREATE TABLE IF NOT EXISTS "roam_players" (
	"user_id" text PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"region" text,
	"pos" jsonb,
	"heading" real,
	"car_id" text,
	"instance_id" text,
	"damage" jsonb,
	"saved_at" timestamp with time zone,
	"ghost_until" timestamp with time zone,
	"auto_ghosts" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- a free roam challenge as the zone server recorded it, the API's check of it, and who was paid what
CREATE TABLE IF NOT EXISTS "roam_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"region" text,
	"players" text[] NOT NULL,
	"group_key" text NOT NULL,
	"km" real,
	"record" jsonb NOT NULL,
	"verdict" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roam_challenges_group" ON "roam_challenges" USING btree ("group_key","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roam_challenge_players" (
	"challenge_id" text NOT NULL REFERENCES "roam_challenges"("id") ON DELETE cascade,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"place" integer,
	"status" text NOT NULL,
	"time_ms" integer,
	"money" integer DEFAULT 0 NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"why" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roam_challenge_players_pk" PRIMARY KEY("challenge_id","user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roam_challenge_players_user" ON "roam_challenge_players" USING btree ("user_id","created_at");
--> statement-breakpoint
-- scheduled car meets (made on the admin page) at a meet spot (world content of kind 'meet')
CREATE TABLE IF NOT EXISTS "meet_events" (
	"id" text PRIMARY KEY NOT NULL,
	"meet_id" text NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"hours" real DEFAULT 2 NOT NULL,
	"created_by" text REFERENCES "users"("id") ON DELETE set null,
	"cancelled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meet_events_start" ON "meet_events" USING btree ("starts_at");
