CREATE TABLE IF NOT EXISTS "batch_dropout_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid NOT NULL,
  "slipping_at" integer DEFAULT 1 NOT NULL,
  "at_risk_at" integer DEFAULT 2 NOT NULL,
  "dropout_at" integer DEFAULT 3 NOT NULL,
  "min_due" integer DEFAULT 3 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "batch_dropout_settings_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "batch_dropout_settings_thresholds_check" CHECK (slipping_at >= 1 AND slipping_at < at_risk_at AND at_risk_at < dropout_at AND min_due >= 1)
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "batch_dropout_settings_batch_id_unique" 
  ON "batch_dropout_settings" USING btree ("batch_id");

