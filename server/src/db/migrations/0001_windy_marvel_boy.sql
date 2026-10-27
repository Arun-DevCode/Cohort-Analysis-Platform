ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "created_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "name" varchar(255) DEFAULT '' NOT NULL;--> statement-breakpoint

-- Backfill created_by with the user who uploaded the batch's reports (from uploads.uploaded_by)
UPDATE "batches" b
SET "created_by" = (
  SELECT u."uploaded_by"
  FROM "uploads" u
  WHERE u."batch_id" = b."id"
  ORDER BY u."created_at" ASC
  LIMIT 1
)
WHERE b."created_by" IS NULL;--> statement-breakpoint

-- Backfill any remaining orphan batches with the first admin user
UPDATE "batches" b
SET "created_by" = (
  SELECT id FROM "users" WHERE "role" = 'admin' ORDER BY "created_at" ASC LIMIT 1
)
WHERE b."created_by" IS NULL;--> statement-breakpoint

-- Fallback to first user in database if no admin exists
UPDATE "batches" b
SET "created_by" = (
  SELECT id FROM "users" ORDER BY "created_at" ASC LIMIT 1
)
WHERE b."created_by" IS NULL;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "batches" ADD CONSTRAINT "batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

ALTER TABLE "batches" ALTER COLUMN "created_by" SET NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "batches_created_by_idx" ON "batches" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snapshots_batch_id_idx" ON "snapshots" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uploads_batch_id_idx" ON "uploads" USING btree ("batch_id");