-- The roadmap (docs/ROADMAP.md): what's being worked on — features and bugs the team adds, and players' ideas once an
-- admin has accepted them — and the players' votes. Only adds (docs/OPERATIONS.md safe deploys).
-- kind: feature | bug | idea; status: pending (an idea waiting for an admin) | rejected | open | planned | working | done
CREATE TABLE IF NOT EXISTS "roadmap_items" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"author_id" text REFERENCES "users"("id") ON DELETE SET NULL,
	"reviewed_by" text REFERENCES "users"("id") ON DELETE SET NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roadmap_items_status" ON "roadmap_items" ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roadmap_items_author" ON "roadmap_items" ("author_id", "created_at");
--> statement-breakpoint
-- one vote a player for each item
CREATE TABLE IF NOT EXISTS "roadmap_votes" (
	"item_id" text NOT NULL REFERENCES "roadmap_items"("id") ON DELETE CASCADE,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roadmap_votes_pk" PRIMARY KEY ("item_id", "user_id")
);
