CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_id" text,
	"reason" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_history" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"author_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" text NOT NULL,
	"view" text NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"geom" geometry(point,4326) NOT NULL,
	"heading" real DEFAULT 0 NOT NULL,
	"cell" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"data" jsonb NOT NULL,
	"marker" jsonb NOT NULL,
	"author_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "content_items_id_view_pk" PRIMARY KEY("id","view")
);
--> statement-breakpoint
CREATE TABLE "content_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"request_hash" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"status" integer,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "replays" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"event_id" text,
	"code" text,
	"title" text NOT NULL,
	"duration" real NOT NULL,
	"cars" integer NOT NULL,
	"bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "track_records" (
	"user_id" text NOT NULL,
	"code" text NOT NULL,
	"version" integer NOT NULL,
	"car_class" text NOT NULL,
	"best_time" real,
	"best_lap" real,
	"replay_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_records_user_id_code_version_car_class_pk" PRIMARY KEY("user_id","code","version","car_class")
);
--> statement-breakpoint
CREATE TABLE "track_results" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"event_id" text NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"version" integer NOT NULL,
	"car_class" text NOT NULL,
	"type" text NOT NULL,
	"time" real NOT NULL,
	"best_lap" real,
	"laps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accepted" boolean NOT NULL,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recording" "bytea",
	"replay_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_anonymous" boolean DEFAULT false,
	"role" text DEFAULT 'player' NOT NULL,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"terms_version" text,
	"terms_accepted_at" timestamp with time zone,
	"name_changed_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_history" ADD CONSTRAINT "content_history_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replays" ADD CONSTRAINT "replays_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_records" ADD CONSTRAINT "track_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_results" ADD CONSTRAINT "track_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "audit_target" ON "audit_log" USING btree ("target_id","at");--> statement-breakpoint
CREATE INDEX "audit_at" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "content_history_id" ON "content_history" USING btree ("id","seq");--> statement-breakpoint
CREATE INDEX "content_geom" ON "content_items" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "content_view_cell" ON "content_items" USING btree ("view","cell");--> statement-breakpoint
CREATE INDEX "content_view_kind" ON "content_items" USING btree ("view","kind");--> statement-breakpoint
CREATE INDEX "idempotency_created" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "replays_owner" ON "replays" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "results_board" ON "track_results" USING btree ("event_id","accepted","time");--> statement-breakpoint
CREATE INDEX "results_user" ON "track_results" USING btree ("user_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_name_lower" ON "users" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "verifications_identifier" ON "verifications" USING btree ("identifier");