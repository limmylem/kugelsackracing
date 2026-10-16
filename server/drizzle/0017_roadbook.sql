-- The ROADBOOK, Expeditions and Season Tokens (docs/ROADBOOK.md). Only adds (docs/OPERATIONS.md safe deploys).
-- the seasons, chapters, challenges, Expeditions, shop and places as versions (the admin page's ROADBOOK tab), one active
CREATE TABLE IF NOT EXISTS "roadbook_config" (
	"version" integer PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"based_on" integer,
	"actor_id" text REFERENCES "users"("id") ON DELETE SET NULL,
	"reason" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "roadbook_config_one_active" ON "roadbook_config" ("active") WHERE active;
--> statement-breakpoint
-- each season's clock: testing (admins and editors only), live (started_at to ends_at), ended (its tokens turned into cash)
CREATE TABLE IF NOT EXISTS "roadbook_seasons" (
	"season_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'testing' NOT NULL,
	"started_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- a player's progress in a season: points, challenges, chapters, places, Expeditions (roadbook/engine.js), as data
CREATE TABLE IF NOT EXISTS "roadbook_progress" (
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"season_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roadbook_progress_pk" PRIMARY KEY ("user_id", "season_id")
);
--> statement-breakpoint
-- what the game's own systems reported for the ROADBOOK, each once (a race by its session, a purchase by its ledger row)
CREATE TABLE IF NOT EXISTS "roadbook_seen" (
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"key" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roadbook_seen_pk" PRIMARY KEY ("user_id", "key")
);
--> statement-breakpoint
-- Season Tokens: every one earned and spent, and why — a season's balance is its rows' sum (each key once: an award, a
-- purchase, the season's end can't happen twice)
CREATE TABLE IF NOT EXISTS "token_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"season_id" text NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"key" text NOT NULL,
	"ref" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" text REFERENCES "users"("id") ON DELETE SET NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "token_ledger_balance" CHECK ("balance_after" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "token_ledger_key" ON "token_ledger" ("user_id", "season_id", "key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "token_ledger_user" ON "token_ledger" ("user_id", "season_id", "id");
--> statement-breakpoint
-- what a player bought in a season's shop: theirs for good
CREATE TABLE IF NOT EXISTS "player_items" (
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"item_id" text NOT NULL,
	"season_id" text NOT NULL,
	"price" integer NOT NULL,
	"bought_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_items_pk" PRIMARY KEY ("user_id", "item_id")
);
--> statement-breakpoint
-- a player's Personal History: what never resets (distance driven, by car; places found; Expeditions finished)
CREATE TABLE IF NOT EXISTS "player_history" (
	"user_id" text PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
