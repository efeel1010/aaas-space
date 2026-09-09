CREATE TYPE "public"."doc_access_permission" AS ENUM('read', 'edit', 'manage');--> statement-breakpoint
CREATE TYPE "public"."doc_base_permission" AS ENUM('read', 'edit');--> statement-breakpoint
CREATE TYPE "public"."doc_visibility" AS ENUM('private', 'team', 'public');--> statement-breakpoint
CREATE TABLE "document_access" (
	"doc_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"permission" "doc_access_permission" DEFAULT 'read' NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "visibility" "doc_visibility" DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "base_permission" "doc_base_permission" DEFAULT 'edit' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_access" ADD CONSTRAINT "document_access_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access" ADD CONSTRAINT "document_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access" ADD CONSTRAINT "document_access_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;