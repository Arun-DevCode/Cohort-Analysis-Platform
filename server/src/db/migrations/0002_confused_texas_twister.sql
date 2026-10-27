-- 1. Add created_by column as nullable for safe backfill
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "created_by" uuid;--> statement-breakpoint

-- 2. Backfill created_by from the batch owner via batch_students
UPDATE "students" s
SET "created_by" = (
  SELECT b."created_by"
  FROM "batch_students" bs
  JOIN "batches" b ON b."id" = bs."batch_id"
  WHERE bs."student_id" = s."id"
  ORDER BY bs."batch_id" ASC
  LIMIT 1
)
WHERE s."created_by" IS NULL;--> statement-breakpoint

-- 3. Fallback for any orphan students to the first admin user (no students are deleted)
UPDATE "students" s
SET "created_by" = (
  SELECT id FROM "users" WHERE "role" = 'admin' ORDER BY "created_at" ASC LIMIT 1
)
WHERE s."created_by" IS NULL;--> statement-breakpoint

-- 4. Fallback to first user in database if no admin exists
UPDATE "students" s
SET "created_by" = (
  SELECT id FROM "users" ORDER BY "created_at" ASC LIMIT 1
)
WHERE s."created_by" IS NULL;--> statement-breakpoint

-- 5. Add foreign key with ON DELETE RESTRICT
DO $$ BEGIN
  ALTER TABLE "students" ADD CONSTRAINT "students_created_by_users_id_fk" 
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") 
    ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- 6. Enforce NOT NULL on created_by
ALTER TABLE "students" ALTER COLUMN "created_by" SET NOT NULL;--> statement-breakpoint

-- 7. Drop the old global unique constraint on external_student_id
ALTER TABLE "students" DROP CONSTRAINT IF EXISTS "students_external_student_id_unique";--> statement-breakpoint

-- 8. Create scoped composite unique key on (created_by, external_student_id)
CREATE UNIQUE INDEX IF NOT EXISTS "students_created_by_external_id_unique" 
  ON "students" USING btree ("created_by", "external_student_id");--> statement-breakpoint

-- 9. Create index on students.created_by
CREATE INDEX IF NOT EXISTS "students_created_by_idx" 
  ON "students" USING btree ("created_by");