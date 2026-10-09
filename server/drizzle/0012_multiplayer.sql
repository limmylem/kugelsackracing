CREATE TABLE IF NOT EXISTS "blocks" (
	"user_id" text NOT NULL,
	"blocked_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_user_id_blocked_id_pk" PRIMARY KEY("user_id","blocked_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "friendships" (
	"a_id" text NOT NULL,
	"b_id" text NOT NULL,
	"status" text NOT NULL,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "friendships_a_id_b_id_pk" PRIMARY KEY("a_id","b_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mp_race_players" (
	"race_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provisional_place" integer NOT NULL,
	"place" integer,
	"status" text NOT NULL,
	"left_early" boolean DEFAULT false NOT NULL,
	"server_time_ms" integer,
	"run" jsonb,
	"recording" "bytea",
	"verdict" jsonb,
	"pay" jsonb,
	"rating_before" jsonb,
	"rating_after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mp_race_players_race_id_user_id_pk" PRIMARY KEY("race_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mp_races" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"ranked" boolean NOT NULL,
	"venue" jsonb NOT NULL,
	"settings" jsonb NOT NULL,
	"course_version" text,
	"track_hash" text,
	"km" real NOT NULL,
	"humans" integer NOT NULL,
	"npcs" integer NOT NULL,
	"state" text NOT NULL,
	"provisional" jsonb NOT NULL,
	"confirmed" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mp_ratings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"mu" real NOT NULL,
	"sigma" real NOT NULL,
	"races" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_a_id_users_id_fk" FOREIGN KEY ("a_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_b_id_users_id_fk" FOREIGN KEY ("b_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mp_race_players" ADD CONSTRAINT "mp_race_players_race_id_mp_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."mp_races"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mp_race_players" ADD CONSTRAINT "mp_race_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mp_ratings" ADD CONSTRAINT "mp_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "friendships_b" ON "friendships" USING btree ("b_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_race_players_user" ON "mp_race_players" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_races_state" ON "mp_races" USING btree ("state","created_at");
