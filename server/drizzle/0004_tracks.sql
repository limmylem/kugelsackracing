CREATE TABLE "track_courses" (
	"code" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"hash" text NOT NULL,
	"course" jsonb NOT NULL,
	"info" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "track_days" (
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_days_kind_key_pk" PRIMARY KEY("kind","key")
);
--> statement-breakpoint
DROP INDEX "results_board";--> statement-breakpoint
ALTER TABLE "track_records" ADD COLUMN "best_score" real;--> statement-breakpoint
ALTER TABLE "track_records" ADD COLUMN "result_id" bigint;--> statement-breakpoint
ALTER TABLE "track_records" ADD COLUMN "runs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "track_results" ADD COLUMN "rank" real;--> statement-breakpoint
ALTER TABLE "track_results" ADD COLUMN "score" real;--> statement-breakpoint
ALTER TABLE "track_results" ADD COLUMN "result" jsonb;--> statement-breakpoint
CREATE INDEX "results_board_score" ON "track_results" USING btree ("event_id","accepted","score");--> statement-breakpoint
CREATE INDEX "results_board" ON "track_results" USING btree ("event_id","accepted","rank");