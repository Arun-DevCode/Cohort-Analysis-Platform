CREATE TYPE "public"."followup_status" AS ENUM('open', 'in_progress', 'done');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'manager', 'trainer');--> statement-breakpoint
CREATE TYPE "public"."segment" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('processing', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "assignment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_item_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" varchar(50) NOT NULL,
	"score" numeric(6, 2),
	"max_score" numeric(6, 2)
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"live_status" varchar(50) NOT NULL,
	"live_or_rec_status" varchar(50) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" varchar(100) NOT NULL,
	"entity" varchar(100) NOT NULL,
	"entity_id" varchar(100),
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_students" (
	"batch_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	CONSTRAINT "batch_students_batch_id_student_id_pk" PRIMARY KEY("batch_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "batch_trainers" (
	"batch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "batch_trainers_batch_id_user_id_pk" PRIMARY KEY("batch_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"external_batch_id" varchar(100) NOT NULL,
	"start_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batches_external_batch_id_unique" UNIQUE("external_batch_id")
);
--> statement-breakpoint
CREATE TABLE "followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"snapshot_id" uuid,
	"owner_id" uuid NOT NULL,
	"note" text NOT NULL,
	"status" "followup_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"session_date" date
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"upload_id" uuid,
	"snapshot_date" date NOT NULL,
	"parser_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"total_consumption_pct" numeric(5, 2) NOT NULL,
	"video_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"pdf_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"quiz_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"flashcards_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"ai_content_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"assignment_submission_pct" numeric(5, 2) NOT NULL,
	"assignment_score_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"live_pct" numeric(5, 2) NOT NULL,
	"live_or_rec_pct" numeric(5, 2) NOT NULL,
	"assignments_total" integer DEFAULT 0 NOT NULL,
	"assignments_submitted" integer DEFAULT 0 NOT NULL,
	"assignments_delayed" integer DEFAULT 0 NOT NULL,
	"live_total" integer DEFAULT 0 NOT NULL,
	"live_attended" integer DEFAULT 0 NOT NULL,
	"segment" "segment" NOT NULL,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_student_id" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"phone_e164" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_external_student_id_unique" UNIQUE("external_student_id")
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"file_hash" varchar(64) NOT NULL,
	"status" "upload_status" DEFAULT 'processing' NOT NULL,
	"error_report" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) DEFAULT '' NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "weekly_consumption" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"week_no" integer NOT NULL,
	"consumed" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignment_items" ADD CONSTRAINT "assignment_items_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_results" ADD CONSTRAINT "assignment_results_assignment_item_id_assignment_items_id_fk" FOREIGN KEY ("assignment_item_id") REFERENCES "public"."assignment_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_results" ADD CONSTRAINT "assignment_results_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_students" ADD CONSTRAINT "batch_students_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_students" ADD CONSTRAINT "batch_students_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_trainers" ADD CONSTRAINT "batch_trainers_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_trainers" ADD CONSTRAINT "batch_trainers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_snapshots" ADD CONSTRAINT "student_snapshots_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_snapshots" ADD CONSTRAINT "student_snapshots_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_consumption" ADD CONSTRAINT "weekly_consumption_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_consumption" ADD CONSTRAINT "weekly_consumption_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_batch_date_unique" ON "snapshots" USING btree ("batch_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "student_snapshots_snapshot_student_idx" ON "student_snapshots" USING btree ("snapshot_id","student_id");