CREATE TABLE "car_build_slots" (
	"user_id" text NOT NULL,
	"car_instance_id" text NOT NULL,
	"socket" text NOT NULL,
	"part_instance_id" text NOT NULL,
	CONSTRAINT "car_build_slots_user_id_car_instance_id_socket_pk" PRIMARY KEY("user_id","car_instance_id","socket")
);
--> statement-breakpoint
CREATE TABLE "economy_config" (
	"version" integer PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"based_on" integer,
	"actor_id" text,
	"reason" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "economy_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"quest_id" text,
	"attempt_id" text,
	"car_instance_id" text,
	"fee" bigint DEFAULT 0 NOT NULL,
	"state" text NOT NULL,
	"quest" jsonb,
	"result" jsonb,
	"end_reason" text,
	"paid" boolean DEFAULT false NOT NULL,
	"damage_reports" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "item_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"item_type" text NOT NULL,
	"instance_id" text NOT NULL,
	"event" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ledger_id" bigint,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"ref" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"session_id" text,
	"idem_key" text,
	"actor_id" text,
	"reverses" bigint,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owned_cars" (
	"user_id" text NOT NULL,
	"instance_id" text NOT NULL,
	"car_id" text NOT NULL,
	"price" bigint DEFAULT 0 NOT NULL,
	"paint" jsonb,
	"damage" jsonb,
	"active_setup" text,
	"setups" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owned_cars_user_id_instance_id_pk" PRIMARY KEY("user_id","instance_id")
);
--> statement-breakpoint
CREATE TABLE "owned_parts" (
	"user_id" text NOT NULL,
	"instance_id" text NOT NULL,
	"part_id" text NOT NULL,
	"condition" real NOT NULL,
	"price" bigint DEFAULT 0 NOT NULL,
	"tuning" jsonb,
	"paint" jsonb,
	"damage" jsonb,
	"dent_log" jsonb,
	"attach" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owned_parts_user_id_instance_id_pk" PRIMARY KEY("user_id","instance_id")
);
--> statement-breakpoint
CREATE TABLE "player_economy" (
	"user_id" text PRIMARY KEY NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"xp" bigint DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"rev" bigint DEFAULT 0 NOT NULL,
	"profile_version" integer NOT NULL,
	"next_id" integer DEFAULT 1 NOT NULL,
	"current_car" text,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_recordings" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_recordings_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "quest_progress" (
	"user_id" text NOT NULL,
	"quest_id" text NOT NULL,
	"medal" text,
	"data" jsonb NOT NULL,
	CONSTRAINT "quest_progress_user_id_quest_id_pk" PRIMARY KEY("user_id","quest_id")
);
--> statement-breakpoint
ALTER TABLE "economy_sessions" ADD CONSTRAINT "economy_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_history" ADD CONSTRAINT "item_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owned_cars" ADD CONSTRAINT "owned_cars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owned_parts" ADD CONSTRAINT "owned_parts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_economy" ADD CONSTRAINT "player_economy_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_recordings" ADD CONSTRAINT "player_recordings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_progress" ADD CONSTRAINT "quest_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "build_part_once" ON "car_build_slots" USING btree ("user_id","part_instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "economy_config_one_active" ON "economy_config" USING btree ("active") WHERE active;--> statement-breakpoint
CREATE INDEX "sessions_user_state" ON "economy_sessions" USING btree ("user_id","state");--> statement-breakpoint
CREATE INDEX "sessions_active_seen" ON "economy_sessions" USING btree ("state","last_seen");--> statement-breakpoint
CREATE INDEX "item_history_item" ON "item_history" USING btree ("user_id","instance_id","id");--> statement-breakpoint
CREATE INDEX "ledger_user" ON "ledger" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "ledger_at" ON "ledger" USING btree ("at");--> statement-breakpoint
CREATE INDEX "ledger_kind_at" ON "ledger" USING btree ("kind","at");