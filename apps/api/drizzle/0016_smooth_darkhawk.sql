ALTER TABLE "requirements" ADD COLUMN "milestone_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "milestone_id" uuid;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE set null ON UPDATE no action;