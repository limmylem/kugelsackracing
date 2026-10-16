-- Phase 8 Step 4: final polish and launch (docs/DEPLOYMENT.md). Only adds (docs/OPERATIONS.md safe deploys).
-- a player's settings, so they follow them between devices (all but the graphics: ui/settingsSync.js)
CREATE TABLE IF NOT EXISTS "player_settings" (
	"user_id" text PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"changed_at" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- the profile: favourite cars and what's shown (docs/PROGRESSION.md)
CREATE TABLE IF NOT EXISTS "player_profiles" (
	"user_id" text PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"favourite_cars" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"public" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- the onboarding's one-time steps and the driving school's medals (each medal's small reward paid once)
CREATE TABLE IF NOT EXISTS "school_results" (
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"lesson_id" text NOT NULL,
	"medal" text NOT NULL,
	"best" real,
	"paid" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_results_pk" PRIMARY KEY ("user_id", "lesson_id")
);
--> statement-breakpoint
-- photos a player keeps on their profile (photo mode: a few, small; docs/PHOTO_MODE.md)
CREATE TABLE IF NOT EXISTS "player_photos" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"caption" text,
	"place" text,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"data" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_photos_user" ON "player_photos" ("user_id", "created_at");
--> statement-breakpoint
-- crews: a name, a tag, its members
CREATE TABLE IF NOT EXISTS "crews" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tag" text NOT NULL,
	"owner_id" text REFERENCES "users"("id") ON DELETE SET NULL,
	"invite_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "crews_tag" ON "crews" (lower("tag"));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "crews_invite" ON "crews" ("invite_code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crew_members" (
	"user_id" text PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"crew_id" text NOT NULL REFERENCES "crews"("id") ON DELETE CASCADE,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crew_members_crew" ON "crew_members" ("crew_id");
--> statement-breakpoint
-- anonymous play statistics, only with consent (docs/ANALYTICS.md): no user id, no IP address — a random id of the
-- browser's own (hashed again here), the game's version, the kind of device, what happened
CREATE TABLE IF NOT EXISTS "analytics_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"anon" text NOT NULL,
	"session" text NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"version" text,
	"device" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_events_at" ON "analytics_events" ("at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_events_kind" ON "analytics_events" ("kind", "at");
--> statement-breakpoint
-- the news panel, patch notes and maintenance notices (the admin page's Live tab)
CREATE TABLE IF NOT EXISTS "news_items" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"version" text,
	"link" text,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"published" boolean DEFAULT false NOT NULL,
	"created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_items_start" ON "news_items" ("published", "starts_at");
--> statement-breakpoint
-- the event calendar: scheduled events, meets and tournaments
CREATE TABLE IF NOT EXISTS "calendar_events" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link" text,
	"region" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_start" ON "calendar_events" ("starts_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calendar_rsvps" (
	"event_id" text NOT NULL REFERENCES "calendar_events"("id") ON DELETE CASCADE,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_rsvps_pk" PRIMARY KEY ("event_id", "user_id")
);
