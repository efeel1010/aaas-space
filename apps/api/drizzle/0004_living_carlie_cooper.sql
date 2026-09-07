CREATE TABLE "project_collaborators" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "project_collaborators_pk" PRIMARY KEY ("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "requirement_collaborators" (
	"requirement_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "requirement_collaborators_pk" PRIMARY KEY ("requirement_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "task_collaborators" (
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "task_collaborators_pk" PRIMARY KEY ("task_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "plan_start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "plan_end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "actual_start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "actual_end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "plan_start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "plan_end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "actual_start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "actual_end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "plan_start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "plan_end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "actual_start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "actual_end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_collaborators" ADD CONSTRAINT "project_collaborators_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_collaborators" ADD CONSTRAINT "project_collaborators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_collaborators" ADD CONSTRAINT "requirement_collaborators_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_collaborators" ADD CONSTRAINT "requirement_collaborators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_collaborators" ADD CONSTRAINT "task_collaborators_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_collaborators" ADD CONSTRAINT "task_collaborators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;