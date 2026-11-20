CREATE TABLE IF NOT EXISTS "assignment_schedule" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid NOT NULL,
  "lms_assignment_name" varchar(255) NOT NULL,
  "roadmap_key" varchar(255),
  "type" varchar(32) DEFAULT 'regular' NOT NULL,
  "due_date" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "assignment_schedule_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "assignment_schedule_batch_lms_name_unique" 
  ON "assignment_schedule" USING btree ("batch_id", "lms_assignment_name");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "assignment_schedule_batch_id_idx" 
  ON "assignment_schedule" USING btree ("batch_id");

