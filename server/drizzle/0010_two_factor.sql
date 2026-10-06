-- (Phase 6 Step 5) two-factor sign-in (Better Auth's two-factor plugin: an authenticator app's codes, with backup
-- codes): the account's switch, its secret (encrypted with the server's secret) and backup codes; and on each
-- session, when it passed the second step (editor and admin tools need a session that did, recently).
-- Additive only: the running version ignores what it doesn't know (docs/DEPLOYMENT.md, safe deploys).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "mfa_verified_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "two_factors" (
  "id" text PRIMARY KEY NOT NULL,
  "secret" text NOT NULL,
  "backup_codes" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "verified" boolean DEFAULT true,
  "failed_verification_count" integer DEFAULT 0,
  "locked_until" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "two_factors_user" ON "two_factors" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "two_factors_secret" ON "two_factors" ("secret");
