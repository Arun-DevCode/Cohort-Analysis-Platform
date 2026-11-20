CREATE TABLE IF NOT EXISTS "report_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid NOT NULL,
  "snapshot_id" uuid,
  "kind" varchar(32) NOT NULL,
  "version" integer NOT NULL,
  "is_current" boolean DEFAULT true NOT NULL,
  "original_name" varchar(255) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "object_key" text NOT NULL,
  "content_type" varchar(100) DEFAULT 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' NOT NULL,
  "uploaded_by" uuid NOT NULL,
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "report_files_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "report_files_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "report_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "report_files_batch_kind_sha256_unique" 
  ON "report_files" USING btree ("batch_id", "kind", "sha256");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "report_files_batch_kind_idx" 
  ON "report_files" USING btree ("batch_id", "kind");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "report_files_snapshot_id_idx" 
  ON "report_files" USING btree ("snapshot_id");

