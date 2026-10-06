-- (Phase 6 Step 5) launch readiness, additive only (docs/OPERATIONS.md, safe deploys):
--   account_signals: what links accounts for abuse review — a hashed device id, the address — per account, kept 90 days
--   abuse_flags: accounts flagged for an admin to review (never banned by themselves)
--   reports: players reporting another (cheating, an offensive name…), the admins' queue
--   support_tickets: "Contact support" and the feedback button, with the game's version and basic device info (1 year)
--   invite_codes / invite_uses: the closed beta's sign-up codes
--   site_settings: switches the admins flip without a deploy (feature flags, maintenance mode and its message)
--   alerts: what's been sent (so an alert isn't sent again every minute)
CREATE TABLE IF NOT EXISTS "account_signals" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "value" text NOT NULL,
  "first_seen" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen" timestamp with time zone DEFAULT now() NOT NULL,
  "hits" integer DEFAULT 1 NOT NULL,
  PRIMARY KEY ("user_id", "kind", "value")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_signals_value" ON "account_signals" ("kind", "value");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "abuse_flags" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "key" text NOT NULL UNIQUE,
  "user_ids" text[] NOT NULL,
  "score" integer NOT NULL,
  "evidence" jsonb NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reviewed_by" text,
  "reviewed_at" timestamp with time zone,
  "note" text
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "abuse_flags_status" ON "abuse_flags" ("status", "score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "abuse_flags_users" ON "abuse_flags" USING gin ("user_ids");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reports" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "reporter_id" text REFERENCES "users"("id") ON DELETE set null,
  "target_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "target_name" text NOT NULL,
  "kind" text NOT NULL,
  "details" text NOT NULL,
  "ref" jsonb,
  "status" text DEFAULT 'open' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_by" text,
  "resolved_at" timestamp with time zone,
  "resolution" text,
  "note" text
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reports_status" ON "reports" ("status", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reports_target" ON "reports" ("target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reports_reporter" ON "reports" ("reporter_id", "created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_tickets" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "user_id" text REFERENCES "users"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "category" text,
  "message" text NOT NULL,
  "contact_email" text,
  "client" jsonb NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "handled_by" text,
  "handled_at" timestamp with time zone,
  "note" text
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_tickets_status" ON "support_tickets" ("kind", "status", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_tickets_user" ON "support_tickets" ("user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invite_codes" (
  "code" text PRIMARY KEY NOT NULL,
  "note" text,
  "max_uses" integer DEFAULT 1 NOT NULL,
  "uses" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp with time zone,
  "revoked" boolean DEFAULT false NOT NULL,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invite_uses" (
  "code" text NOT NULL REFERENCES "invite_codes"("code") ON DELETE cascade,
  "user_id" text REFERENCES "users"("id") ON DELETE set null,
  "email_hash" text,
  "used_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invite_uses_code" ON "invite_uses" ("code");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" jsonb NOT NULL,
  "updated_by" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alerts" (
  "key" text PRIMARY KEY NOT NULL,
  "state" text NOT NULL,
  "message" text NOT NULL,
  "first_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  "count" integer DEFAULT 1 NOT NULL
);
