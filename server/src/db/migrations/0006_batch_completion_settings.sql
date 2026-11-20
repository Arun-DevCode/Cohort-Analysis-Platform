CREATE TABLE IF NOT EXISTS "batch_completion_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL REFERENCES "batches"("id") ON DELETE restrict,
	"min_assignments" integer DEFAULT 70 NOT NULL,
	"min_content" integer DEFAULT 60 NOT NULL,
	"min_attendance" integer DEFAULT 50 NOT NULL,
	"w_assignments" integer DEFAULT 50 NOT NULL,
	"w_content" integer DEFAULT 30 NOT NULL,
	"w_attendance" integer DEFAULT 20 NOT NULL,
	"too_early_min_due" integer DEFAULT 3 NOT NULL,
	"too_early_min_elapsed_pct" integer DEFAULT 25 NOT NULL,
	"catchup_limit" numeric(4, 2) DEFAULT '2.00' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_completion_settings_batch_id_unique" UNIQUE("batch_id"),
	CONSTRAINT "chk_batch_completion_settings_minimums" CHECK (
		"min_assignments" >= 0 AND "min_assignments" <= 100 AND
		"min_content" >= 0 AND "min_content" <= 100 AND
		"min_attendance" >= 0 AND "min_attendance" <= 100
	),
	CONSTRAINT "chk_batch_completion_settings_weights" CHECK (
		"w_assignments" >= 0 AND
		"w_content" >= 0 AND
		"w_attendance" >= 0 AND
		("w_assignments" + "w_content" + "w_attendance" = 100)
	),
	CONSTRAINT "chk_batch_completion_settings_too_early" CHECK (
		"too_early_min_due" >= 1 AND
		"too_early_min_elapsed_pct" >= 0 AND "too_early_min_elapsed_pct" <= 100
	),
	CONSTRAINT "chk_batch_completion_settings_catchup_limit" CHECK (
		"catchup_limit" > 0
	)
);

