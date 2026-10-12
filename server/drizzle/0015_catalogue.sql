-- Phase 8 Step 3: the content manager (docs/CONTENT_PIPELINE.md). Only adds (docs/OPERATIONS.md safe deploys).
-- each part's (or car's) place in the content workflow and what the content manager changed: its latest version
-- (status draft / review / published, the fields it sets, the edit as asked, the live checks of it) and the version
-- players have (live: published at some point; live_set: what that version sets). No row: the game's own file.
CREATE TABLE IF NOT EXISTS "catalogue_items" (
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"set" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"edits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checks" jsonb,
	"live" boolean DEFAULT false NOT NULL,
	"live_version" integer,
	"live_set" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_items_pk" PRIMARY KEY ("kind", "id")
);
--> statement-breakpoint
-- every change to one, append-only: who, why, what it became
CREATE TABLE IF NOT EXISTS "catalogue_history" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"set" jsonb,
	"edits" jsonb,
	"actor_id" text,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_history_item" ON "catalogue_history" ("kind", "id", "seq");
